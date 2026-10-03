'use strict';

// ---------------------------------------------------------------------------
// xprov-allowlist — the snapshot secret-scan allowlist (spec
// 009-cross-provider-review-gate, Wave 6b; FR-030 (a)–(j)). No CLI surface:
// `xprov snapshot` calls evaluate() after its counting scan, and
// xprov-approve.cjs (propose / approve) uses the reader and the store helpers.
//
// Threat model (FR-030): the allowlist defends against REVIEWED CONTENT and
// PIPELINE AGENTS turning a red gate green. Hence:
//   - it is read only from the TRUST ANCHOR in the primary checkout — the
//     merge-base of the reviewed commit with refs/remotes/origin/<default>,
//     verified against `git ls-remote origin` — never from the snapshot, the
//     reviewed commit or a working tree (b);
//   - a reviewed range that touches the file fails before dispatch (d);
//   - its blob must be approved by the owner at a TTY, recorded outside every
//     repository in ~/.a1-xprov/allowlist-approvals.json (j) — `owner` and
//     `reviewed_by` are responsibility records, they authenticate nothing.
// Everything that cannot be verified is "not applied": every hit fails, as
// before the allowlist existed. There is no fallback ref and no retry.
//
// Store format (documented in the xprov help block; the fixture writes it
// directly): {"version":1,"repos":{"<realpath of git-common-dir>":["<sha256 of
// the allowlist blob>", …]}} — file 0600, directory ~/.a1-xprov 0700, both
// owned by the current user, neither a symlink.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const { PERMIT_FILE, isValidBranchName } = require('./xprov-permit.cjs');

const { gitSpawn: git, gitOut, isPlainObject } = C;
const DETAIL = X.ALLOWLIST_DETAILS;

const LS_REMOTE_TIMEOUT_MS = 30 * 1000; // FR-030 (b)
const LS_REMOTE_GRACE_MS = 20 * 1000; // outer bound for the helper itself; well above the 30 s + kill path so a missed group kill shows as > 40 s
const MAX_BLOB_BYTES = 256 * 1024; // 32 entries never come close; anything larger is not an allowlist
const MAX_JSON_DEPTH = 8;
const REASON_MAX_CHARS = 200;
const OWNER_MAX_CHARS = 64;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PATH_FORBIDDEN_RE = /[*?[\]{}\\\0-\x1f\x7f]/;
const TOP_KEYS = Object.freeze(['version', 'owner', 'entries']);
const ENTRY_KEYS = Object.freeze(['path', 'pattern', 'max_count', 'fingerprints', 'class', 'reason', 'reviewed_by', 'added_on']);
const PATTERN_NAMES = new Set(X.SECRET_PATTERNS.map((p) => p.name));
const STORE_MODE = 0o600;
const STORE_DIR_MODE = 0o700;

const NO_ALLOWLIST = Object.freeze({
  fail: null, unresolved: false, anchor: null, approved_blob: null, allowlisted_hits: 0,
  allowlisted: Object.freeze([]), uncovered: Object.freeze([]), stale: Object.freeze([]), note: null,
});

// ---------- strict JSON (duplicate keys are an error at any level) ----------

const WS_RE = /[ \t\n\r]*/y;
const STRING_RE = /"(?:[^"\\\0-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL_RE = /true|false|null/y;

/** JSON.parse, except that a repeated key in one object throws (plain
 * JSON.parse keeps the LAST value — FR-030 a). Objects are built with
 * Object.fromEntries, so a `__proto__` key stays a plain own property. */
function parseStrictJson(text) {
  let i = 0;
  const fail = (msg) => { throw new Error(`${msg} at offset ${i}`); };
  const token = (re) => { re.lastIndex = i; const m = re.exec(text); if (m) i = re.lastIndex; return m ? m[0] : null; };
  const ws = () => token(WS_RE);
  const expect = (ch) => { ws(); if (text[i++] !== ch) fail(`expected "${ch}"`); };
  // One loop for objects and arrays: `close` ends it, `,` continues; objects read `"key":` first.
  function collection(isObject, depth) {
    i++;
    const items = [];
    const seen = new Set();
    ws();
    if (text[i] === (isObject ? '}' : ']')) { i++; return isObject ? Object.fromEntries(items) : items; }
    for (;;) {
      if (isObject) {
        ws();
        const key = JSON.parse(token(STRING_RE) || fail('expected a key'));
        if (seen.has(key)) fail(`duplicate key ${JSON.stringify(C.clip(key, 40))}`);
        seen.add(key);
        expect(':');
        items.push([key, value(depth + 1)]);
      } else items.push(value(depth + 1));
      ws();
      const sep = text[i++];
      if (sep === (isObject ? '}' : ']')) return isObject ? Object.fromEntries(items) : items;
      if (sep !== ',') fail(`expected "," or "${isObject ? '}' : ']'}"`);
    }
  }
  function value(depth) {
    if (depth > MAX_JSON_DEPTH) fail('nesting too deep');
    ws();
    if (text[i] === '{' || text[i] === '[') return collection(text[i] === '{', depth);
    const t = text[i] === '"' ? token(STRING_RE) : token(LITERAL_RE) || token(NUMBER_RE);
    return t === null ? fail('unexpected token') : JSON.parse(t);
  }
  const v = value(0);
  ws();
  if (i !== text.length) fail('trailing data');
  return v;
}

// ---------- schema (FR-030 a, h) ----------

const exactKeys = (obj, keys) => isPlainObject(obj) && Object.keys(obj).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
const nonEmpty = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\0-\x1f\x7f]/.test(v);

/** Repo-relative path of one file: no leading `/`, no empty / `.` / `..`
 * segment, no trailing `/`, no glob or escape character, never the allowlist. */
function pathProblem(p) {
  if (typeof p !== 'string' || p === '') return 'empty path';
  if (p.startsWith('/') || p.endsWith('/')) return 'leading or trailing /';
  if (PATH_FORBIDDEN_RE.test(p)) return 'glob, escape or control character';
  if (p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return 'empty, . or .. segment';
  if (p === X.ALLOWLIST_FILE) return 'the allowlist file itself';
  return null;
}

function entryProblem(e, n) {
  const at = `entries[${n}]`;
  if (!exactKeys(e, ENTRY_KEYS)) return `${at}: keys must be exactly ${ENTRY_KEYS.join(', ')}`;
  const pp = pathProblem(e.path);
  if (pp) return `${at}.path: ${pp}`;
  if (!PATTERN_NAMES.has(e.pattern)) return `${at}.pattern: unknown pattern name`;
  if (!Number.isInteger(e.max_count) || e.max_count < 1 || e.max_count > X.ALLOWLIST_MAX_COUNT) return `${at}.max_count: integer 1–${X.ALLOWLIST_MAX_COUNT}`;
  const fps = e.fingerprints;
  if (!Array.isArray(fps) || fps.length < 1 || fps.length > e.max_count || !fps.every((f) => typeof f === 'string' && SHA256_RE.test(f)) || new Set(fps).size !== fps.length) {
    return `${at}.fingerprints: 1–max_count distinct lowercase sha256 values`;
  }
  if (!X.ALLOWLIST_CLASSES.includes(e.class)) return `${at}.class: one of ${X.ALLOWLIST_CLASSES.join('|')}`;
  if (!nonEmpty(e.reason, REASON_MAX_CHARS)) return `${at}.reason: non-empty, ≤ ${REASON_MAX_CHARS} characters`;
  if (!nonEmpty(e.reviewed_by, OWNER_MAX_CHARS)) return `${at}.reviewed_by: non-empty name`;
  if (typeof e.added_on !== 'string' || !DATE_RE.test(e.added_on)) return `${at}.added_on: YYYY-MM-DD`;
  return null;
}

/** { ok: true, doc } or { ok: false, detail } — never throws. */
function parseAllowlist(text) {
  let doc;
  try { doc = parseStrictJson(String(text)); } catch (e) { return { ok: false, detail: `invalid JSON: ${e.message}` }; }
  if (!exactKeys(doc, TOP_KEYS)) return { ok: false, detail: `top level must have exactly ${TOP_KEYS.join(', ')}` };
  if (doc.version !== 1) return { ok: false, detail: 'version must be 1' };
  if (!nonEmpty(doc.owner, OWNER_MAX_CHARS)) return { ok: false, detail: 'owner: non-empty name' };
  if (!Array.isArray(doc.entries)) return { ok: false, detail: 'entries must be an array' };
  if (doc.entries.length > X.ALLOWLIST_MAX_ENTRIES) return { ok: false, detail: `more than ${X.ALLOWLIST_MAX_ENTRIES} entries (${doc.entries.length})` };
  const pairs = new Set();
  for (let n = 0; n < doc.entries.length; n++) {
    const problem = entryProblem(doc.entries[n], n);
    if (problem) return { ok: false, detail: problem };
    const key = `${doc.entries[n].path}\0${doc.entries[n].pattern}`;
    if (pairs.has(key)) return { ok: false, detail: `entries[${n}]: duplicate (path, pattern) pair` };
    pairs.add(key);
  }
  return { ok: true, doc };
}

// ---------- git reads against the primary checkout ----------

/** Raw bytes of `<rev>:<file>`, or null when the path does not exist there. */
function blobAt(root, rev, file) {
  if (git(['-C', root, 'cat-file', '-e', `${rev}:${file}`]).status !== 0) return null;
  const r = spawnSync('git', ['-C', root, 'cat-file', 'blob', `${rev}:${file}`], { maxBuffer: MAX_BLOB_BYTES + 1, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0 || !Buffer.isBuffer(r.stdout)) throw new Error(`git cat-file blob ${rev}:${file} failed`);
  return r.stdout;
}

/** 'tree' | 'blob' | … | null for `path` at `rev` (literal pathspec). */
function typeAt(root, rev, p) {
  const r = git(['-C', root, '--literal-pathspecs', 'ls-tree', '-z', rev, '--', p]);
  if (r.status !== 0) return null;
  const hit = r.stdout.split('\0').find((line) => line.endsWith(`\t${p}`));
  return hit ? hit.split(' ')[1] : null;
}

/** { decidedBy } — null when the record or the field is absent — or { error }
 * when the record at <rev> exists but is not valid JSON. */
function decidedByAt(root, rev) {
  let buf;
  try { buf = blobAt(root, rev, PERMIT_FILE); } catch (e) { return { error: e.message }; }
  if (buf === null) return { decidedBy: null };
  let rec;
  try { rec = JSON.parse(buf.toString('utf8')); } catch (_e) { return { error: `${PERMIT_FILE} at the anchor is not valid JSON` }; }
  return { decidedBy: isPlainObject(rec) && typeof rec.decided_by === 'string' ? rec.decided_by : null };
}

/** The permit record of the primary checkout's WORKING TREE (FR-021 reads the same file). */
function permitRecord(root) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(root, PERMIT_FILE), 'utf8'));
    return isPlainObject(rec) ? rec : null;
  } catch (_e) { return null; }
}

// ---------- trust anchor (FR-030 b) ----------

// Runs `git ls-remote` DETACHED so that a timeout kills its whole process group
// (git and the ssh it started — an orphaned ssh would hold the pipes open).
// Non-interactive by construction: no terminal prompt, ssh in batch mode.
const LS_REMOTE_HELPER = `
const { spawn } = require('child_process');
const [root, ref, ms] = process.argv.slice(1);
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
const child = spawn('git', ['-C', root, 'ls-remote', 'origin', ref], { detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; let err = ''; let timedOut = false; let done = false;
const finish = (status, extra) => { if (done) return; done = true; clearTimeout(timer); process.stdout.write(JSON.stringify({ status, out, err: extra || err, timedOut })); };
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });
const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch (_e) { /* already gone */ } }, Number(ms));
child.on('error', (e) => finish(null, String(e.message)));
child.on('close', (status) => finish(status));
`;

/** sha of refs/heads/<name> on origin, or { ok: false, detail, timedOut }. */
function lsRemote(root, name) {
  const ref = `refs/heads/${name}`;
  const r = spawnSync(process.execPath, ['-e', LS_REMOTE_HELPER, root, ref, String(LS_REMOTE_TIMEOUT_MS)],
    { encoding: 'utf8', timeout: LS_REMOTE_TIMEOUT_MS + LS_REMOTE_GRACE_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
  let res = null;
  try { res = JSON.parse(r.stdout); } catch (_e) { res = null; }
  if (!res) return { ok: false, timedOut: true, detail: 'ls-remote helper did not report' };
  if (res.timedOut) return { ok: false, timedOut: true, detail: `timed out after ${LS_REMOTE_TIMEOUT_MS / 1000} s` };
  if (res.status !== 0) return { ok: false, timedOut: false, detail: C.stderrTail(res.err) || `exit ${res.status}` };
  const line = res.out.split('\n').map((l) => l.split('\t')).find((f) => f[1] === ref);
  return line && /^[0-9a-f]{40,64}$/.test(line[0]) ? { ok: true, sha: line[0] } : { ok: false, timedOut: false, detail: `origin has no ${ref}` };
}

/** default_branch of the primary checkout's permit record ('main' when absent). */
function defaultBranch(root) {
  const rec = permitRecord(root);
  return rec && Object.prototype.hasOwnProperty.call(rec, 'default_branch') ? rec.default_branch : 'main';
}

/** { ok: true, ref, tip }: refs/remotes/origin/<default_branch>, verified to
 * equal origin's refs/heads/<name> via ls-remote — or { ok: false, note }.
 * Never consults refs/remotes/origin/HEAD or a local branch; no fallback. */
function verifiedTip(root) {
  const unresolved = (note) => ({ ok: false, note });
  const name = defaultBranch(root);
  if (!isValidBranchName(root, name)) return unresolved(`default_branch ${JSON.stringify(C.clip(String(name), 80))} in ${PERMIT_FILE} is not a valid branch name`);
  const ref = `refs/remotes/origin/${name}`;
  const local = gitOut(['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (local === null) return unresolved(`${ref} does not exist — run git fetch origin`);
  const tip = local.trim();
  const remote = lsRemote(root, name);
  if (!remote.ok) return unresolved(`git ls-remote origin refs/heads/${name} failed (${remote.detail})`);
  if (remote.sha !== tip) return unresolved(`${ref} is ${tip.slice(0, 12)} but origin has ${remote.sha.slice(0, 12)} — run git fetch origin`);
  return { ok: true, ref, tip };
}

/** { ok: true, anchor, ref, tip } or { ok: false, note }. */
function resolveAnchor(root, commitSha, gateKind) {
  const unresolved = (note) => ({ ok: false, note });
  const v = verifiedTip(root);
  if (!v.ok) return v;
  const { ref, tip } = v;
  const mb = gitOut(['-C', root, 'merge-base', commitSha, tip]);
  if (mb === null) return unresolved(`no merge-base between ${commitSha.slice(0, 12)} and ${ref}`);
  let anchor = mb.trim();
  if (anchor === commitSha) {
    // The reviewed commit is already on the default branch. A plan review steps
    // to its first parent so the reviewed commit stays inside the checked range;
    // a wave inspection of default-branch history is not a reviewed state.
    if (gateKind !== 'plan') return unresolved(`the inspected commit is already on ${ref}; the allowlist is not applied to wave-inspect`);
    const parent = gitOut(['-C', root, 'rev-parse', '--verify', '--quiet', `${commitSha}^1`]);
    if (parent === null) return unresolved('the reviewed commit has no parent');
    anchor = parent.trim();
  }
  return { ok: true, anchor, ref, tip };
}

// ---------- approval store (FR-030 j) ----------

const storePath = () => path.join(X.xprovHome(), X.ALLOWLIST_APPROVALS_FILE);
const ownedByMe = (st) => typeof process.getuid !== 'function' || st.uid === process.getuid();

/** One guarded store under ~/.a1-xprov (the approval store, FR-030 j, and
 * the waiver store, FR-007): { ok: true, value } or { ok: false, missing, why }.
 * A symlink at either place, a mode other than 0700/0600, a foreign owner or an
 * off-format file (`parse` returns null) all count as an ABSENT store. The
 * file is opened with O_NOFOLLOW and checked on the open descriptor, so a swap
 * between check and read changes nothing. */
function readGuardedStore(file, label, parse) {
  // `missing` = nothing there yet (the writer may create it); every other absence is a broken store.
  const absent = (why, missing) => ({ ok: false, missing: Boolean(missing), why });
  let d;
  try { d = fs.lstatSync(X.xprovHome()); } catch (_e) { return absent('~/.a1-xprov does not exist', true); }
  if (d.isSymbolicLink() || !d.isDirectory()) return absent('~/.a1-xprov is not a real directory');
  if ((d.mode & 0o777) !== STORE_DIR_MODE || !ownedByMe(d)) return absent('~/.a1-xprov is not 0700 and owned by the current user');
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (e) {
    return e.code === 'ENOENT' ? absent(`no ${label} yet`, true) : absent(`the ${label} is a symlink or cannot be opened`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o777) !== STORE_MODE || !ownedByMe(st)) return absent(`${label} is not a 0600 regular file owned by the current user`);
    const value = parse(parseStrictJson(fs.readFileSync(fd, 'utf8')));
    return value === null ? absent(`${label} has an unknown format`) : { ok: true, value };
  } catch (_e) {
    return absent(`${label} is unreadable`);
  } finally {
    fs.closeSync(fd);
  }
}

/** The approval store's repos map, or null when off-format. */
function parseApprovalsDoc(doc) {
  if (!exactKeys(doc, ['version', 'repos']) || doc.version !== 1 || !isPlainObject(doc.repos)) return null;
  const repos = {};
  for (const [k, v] of Object.entries(doc.repos)) {
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && SHA256_RE.test(s))) return null;
    repos[k] = [...v];
  }
  return repos;
}

/** { ok: true, repos } or { ok: false, missing, why, repos: {} } (readGuardedStore). */
function readApprovals() {
  const r = readGuardedStore(storePath(), 'approval store', parseApprovalsDoc);
  return r.ok ? { ok: true, repos: r.value } : { ...r, repos: {} };
}

// ---------- evaluation (called by xprov snapshot after the scan) ----------

/** Matches grouped by (path, pattern) in scan order. */
function groupPairs(matches) {
  const pairs = new Map();
  for (const m of matches) {
    const key = `${m.path}\0${m.pattern}`;
    const p = pairs.get(key) || { path: m.path, pattern: m.pattern, count: 0, fingerprints: new Set() };
    p.count++;
    p.fingerprints.add(m.fingerprint);
    pairs.set(key, p);
  }
  return pairs;
}

/** (d) The newest commit that touched the allowlist in the anchor's history
 * touches nothing else — keeps allowlist changes reviewable. Problem text or null. */
function separateCommitProblem(root, anchor) {
  const last = gitOut(['-C', root, 'log', '-1', '--format=%H', '--full-history', '--no-merges', anchor, '--', X.ALLOWLIST_FILE]);
  const touched = last && last.trim() ? gitOut(['-C', root, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--no-renames', '-z', last.trim()]) : null;
  const names = touched === null ? [] : touched.split('\0').filter(Boolean);
  return names.length === 1 && names[0] === X.ALLOWLIST_FILE ? null : `the last commit that changed ${X.ALLOWLIST_FILE} also changed other paths`;
}

/** (h) owner = decided_by at the anchor = decided_by in the working tree, and
 * every reviewed_by = owner. { detail, reasonDetail } or null. An unparsable
 * permit record is its own problem, not an owner mismatch. */
function ownerProblem(root, anchor, doc) {
  const at = decidedByAt(root, anchor);
  if (at.error) return { detail: at.error, reasonDetail: null };
  let inTree = null;
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(root, PERMIT_FILE), 'utf8'));
    inTree = isPlainObject(rec) && typeof rec.decided_by === 'string' ? rec.decided_by : null;
  } catch (e) {
    if (e.code !== 'ENOENT') return { detail: `${PERMIT_FILE} in the working tree is not valid JSON`, reasonDetail: null };
  }
  if (doc.owner === at.decidedBy && doc.owner === inTree && doc.entries.every((e) => e.reviewed_by === doc.owner)) return null;
  return { detail: `owner ${JSON.stringify(doc.owner)} must equal decided_by at the anchor (${JSON.stringify(at.decidedBy)}) and in the working tree (${JSON.stringify(inTree)}), and every reviewed_by`, reasonDetail: DETAIL.owner_mismatch };
}

/** The allowlist document at the anchor after every check of (a), (d), (h),
 * (j): { doc, blobSha } | { fail } | { absent: true }. */
function loadAtAnchor(root, anchor, commitSha, approvals) {
  const invalid = (detail, reasonDetail) => ({ fail: { reason: X.REASONS.allowlist_invalid, reason_detail: reasonDetail || null, detail } });
  let blob;
  try { blob = blobAt(root, anchor, X.ALLOWLIST_FILE); } catch (e) { return invalid(e.message); }
  if (blob === null) return { absent: true };
  if (blob.length > MAX_BLOB_BYTES) return invalid(`${X.ALLOWLIST_FILE} exceeds ${MAX_BLOB_BYTES} bytes`);
  const parsed = parseAllowlist(blob.toString('utf8'));
  if (!parsed.ok) return invalid(parsed.detail);
  const doc = parsed.doc;
  for (const e of doc.entries) {
    if (typeAt(root, anchor, e.path) === 'tree' || typeAt(root, commitSha, e.path) === 'tree') return invalid(`${e.path} is a directory, not a file`);
  }
  const sep = separateCommitProblem(root, anchor);
  if (sep) return invalid(sep, DETAIL.not_separate_commit);
  const owner = ownerProblem(root, anchor, doc);
  if (owner) return invalid(owner.detail, owner.reasonDetail);
  // (j) the blob must be approved for this repository
  const blobSha = C.sha256(blob);
  const approved = (approvals && approvals.repos[C.commonDirOf(root)]) || [];
  if (!approved.includes(blobSha)) {
    return invalid(`allowlist blob ${blobSha.slice(0, 12)} is not approved on this machine (${approvals && approvals.why ? approvals.why : 'not in the store'}) — the owner runs \`a1-tools xprov allowlist approve --repo <checkout>\` in a terminal that does not descend from Claude Code`, DETAIL.unapproved);
  }
  return { doc, blobSha };
}

/** Applies the anchor's allowlist to the scan. Returns the NO_ALLOWLIST shape
 * with the fields filled in; `fail` set means stop before dispatch.
 * `o.matches` is the reviewed tree (side head). `o.extra` (Wave 7, Samuel:
 * everything that leaves is scanned) adds sides — `base` (base-side blobs of
 * every path the outbound diff touches) and `input` (the PLAN.md and
 * dispositions copies) — judged against the SAME anchored allowlist and the
 * same (path, pattern) entries, each side counted on its own against
 * max_count. A non-head entry carries `side`; `stale` reads the head side only. */
function evaluate(o) {
  const pairs = groupPairs(o.matches);
  const sides = (o.extra || []).map((s) => ({ side: s.side, pairs: groupPairs(s.matches) }));
  const tag = (side, obj) => Object.freeze(side ? { ...obj, side } : obj);
  const all = [
    ...[...pairs.values()].map((p) => tag(null, { path: p.path, pattern: p.pattern })),
    ...sides.flatMap((s) => [...s.pairs.values()].map((p) => tag(s.side, { path: p.path, pattern: p.pattern }))),
  ];
  const result = (fields) => Object.freeze({ ...NO_ALLOWLIST, uncovered: all, ...fields });
  const anc = resolveAnchor(o.root, o.commitSha, o.gateKind);
  if (!anc.ok) return result({ unresolved: true, note: anc.note });
  const diff = git(['-C', o.root, 'diff', '--no-renames', '--name-only', '-z', anc.anchor, o.commitSha]);
  if (diff.status !== 0) return result({ fail: { reason: X.REASONS.snapshot_failed, detail: `git diff ${anc.anchor.slice(0, 12)} ${o.commitSha.slice(0, 12)}: ${C.stderrTail(diff.stderr)}` } });
  if (diff.stdout.split('\0').includes(X.ALLOWLIST_FILE)) {
    return result({ fail: { reason: X.REASONS.allowlist_modified, detail: `the reviewed range ${anc.anchor.slice(0, 12)}..${o.commitSha.slice(0, 12)} changes ${X.ALLOWLIST_FILE}; allowlist changes land on the default branch in their own commit` } });
  }
  const loaded = loadAtAnchor(o.root, anc.anchor, o.commitSha, o.approvals);
  if (loaded.fail) return result({ fail: loaded.fail });
  if (loaded.absent) return result({});
  const { doc, blobSha } = loaded;
  const allowlisted = [];
  const uncovered = [];
  const judge = (pairMap, side) => {
    for (const p of pairMap.values()) {
      const e = doc.entries.find((x) => x.path === p.path && x.pattern === p.pattern);
      const covered = e && p.count <= e.max_count && [...p.fingerprints].every((fp) => e.fingerprints.includes(fp));
      if (covered) allowlisted.push(tag(side, { path: p.path, pattern: p.pattern, count: p.count, class: e.class }));
      else uncovered.push(tag(side, { path: p.path, pattern: p.pattern }));
    }
  };
  judge(pairs, null);
  for (const s of sides) judge(s.pairs, s.side);
  const tracked = new Set(o.tracked);
  const stale = doc.entries.filter((e) => !tracked.has(e.path) || !pairs.has(`${e.path}\0${e.pattern}`)).map((e) => Object.freeze({ path: e.path, pattern: e.pattern }));
  return result({
    anchor: anc.anchor, approved_blob: blobSha, allowlisted, uncovered, stale,
    allowlisted_hits: allowlisted.reduce((n, a) => n + a.count, 0),
  });
}

module.exports = {
  NO_ALLOWLIST, STORE_MODE, STORE_DIR_MODE, SHA256_RE,
  parseStrictJson, parseAllowlist, pathProblem, blobAt, separateCommitProblem, ownerProblem, verifiedTip, resolveAnchor, defaultBranch, lsRemote,
  readApprovals, readGuardedStore, exactKeys, storePath, groupPairs, evaluate, permitRecord,
};
