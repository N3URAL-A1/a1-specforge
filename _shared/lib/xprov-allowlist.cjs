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

const { isPlainObject } = C;
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
const TOP_KEYS_V2 = Object.freeze(['version', 'owner', 'entries', 'scopes']); // spec 012 FR-019
const SCOPE_KEYS = Object.freeze(['prefix', 'pattern', 'class', 'max_count', 'reason', 'reviewed_by', 'added_on']);
const HIGH_CONFIDENCE = new Set(X.HIGH_CONFIDENCE_PATTERNS);
const ENTRY_KEYS = Object.freeze(['path', 'pattern', 'max_count', 'fingerprints', 'class', 'reason', 'reviewed_by', 'added_on']);
const PATTERN_NAMES = new Set(X.SECRET_PATTERNS.map((p) => p.name));
const STORE_MODE = 0o600;
const STORE_DIR_MODE = 0o700;

const NO_ALLOWLIST = Object.freeze({
  fail: null, unresolved: false, anchor: null, approved_blob: null, allowlisted_hits: 0,
  allowlisted: Object.freeze([]), uncovered: Object.freeze([]), stale: Object.freeze([]), note: null,
  scoped_hits: Object.freeze([]), scoped_uncovered: Object.freeze([]),
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

/** One scope of a v2 document (spec 012 FR-019): exact keys, a directory prefix
 * ending in `/` (never the root, no glob or escape, no `.`/`..` segment), a
 * pattern that is known and NOT high-confidence (real key shapes are never
 * scoped), a max_count of 1..ALLOWLIST_SCOPE_MAX_COUNT. The tree check at the
 * anchor needs git and lives in scopeTreeProblem. */
function scopeProblem(sc, n) {
  const at = `scopes[${n}]`;
  if (!exactKeys(sc, SCOPE_KEYS)) return `${at}: keys must be exactly ${SCOPE_KEYS.join(', ')}`;
  if (typeof sc.prefix !== 'string' || !sc.prefix.endsWith('/')) return `${at}.prefix: a directory path ending in /`;
  const pp = pathProblem(sc.prefix.slice(0, -1));
  if (pp) return `${at}.prefix: ${pp}`;
  if (!PATTERN_NAMES.has(sc.pattern)) return `${at}.pattern: unknown pattern name`;
  if (HIGH_CONFIDENCE.has(sc.pattern)) return `${at}.pattern: ${sc.pattern} is a high-confidence key shape and is never scoped`;
  if (!Number.isInteger(sc.max_count) || sc.max_count < 1 || sc.max_count > X.ALLOWLIST_SCOPE_MAX_COUNT) return `${at}.max_count: integer 1–${X.ALLOWLIST_SCOPE_MAX_COUNT}`;
  if (!X.ALLOWLIST_CLASSES.includes(sc.class)) return `${at}.class: one of ${X.ALLOWLIST_CLASSES.join('|')}`;
  if (!nonEmpty(sc.reason, REASON_MAX_CHARS)) return `${at}.reason: non-empty, ≤ ${REASON_MAX_CHARS} characters`;
  if (!nonEmpty(sc.reviewed_by, OWNER_MAX_CHARS)) return `${at}.reviewed_by: non-empty name`;
  if (typeof sc.added_on !== 'string' || !DATE_RE.test(sc.added_on)) return `${at}.added_on: YYYY-MM-DD`;
  return null;
}

/** Problem text for the scopes array of a v2 document, or null. */
function scopesProblem(scopes) {
  if (!Array.isArray(scopes)) return 'scopes must be an array';
  if (scopes.length > X.ALLOWLIST_MAX_SCOPES) return `more than ${X.ALLOWLIST_MAX_SCOPES} scopes (${scopes.length})`;
  const keys = new Set();
  for (let n = 0; n < scopes.length; n++) {
    const problem = scopeProblem(scopes[n], n);
    if (problem) return problem;
    const key = `${scopes[n].prefix}\0${scopes[n].pattern}`;
    if (keys.has(key)) return `scopes[${n}]: duplicate (prefix, pattern) pair`;
    keys.add(key);
  }
  return null;
}

/** { ok: true, doc } or { ok: false, detail } — never throws. A document is
 * version 1 (keys version, owner, entries) or version 2 (the same plus scopes). */
function parseAllowlist(text) {
  let doc;
  try { doc = parseStrictJson(String(text)); } catch (e) { return { ok: false, detail: `invalid JSON: ${e.message}` }; }
  const v2 = isPlainObject(doc) && doc.version === 2;
  const topKeys = v2 ? TOP_KEYS_V2 : TOP_KEYS;
  if (!exactKeys(doc, topKeys)) return { ok: false, detail: `top level must have exactly ${topKeys.join(', ')}` };
  if (!v2 && doc.version !== 1) return { ok: false, detail: 'version must be 1 or 2' };
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
  if (v2) {
    const sp = scopesProblem(doc.scopes);
    if (sp) return { ok: false, detail: sp };
  }
  return { ok: true, doc };
}

// ---------- git reads against the primary checkout ----------

/** Raw bytes of `<rev>:<file>`, or null when the path does not exist there. */
function blobAt(root, rev, file) {
  if (git(['-C', root, 'cat-file', '-e', `${rev}:${file}`]).status !== 0) return null;
  const r = spawnSync('git', ['--no-replace-objects', '-C', root, 'cat-file', 'blob', `${rev}:${file}`], { env: diffEnv(), timeout: gitTimeoutMs(), killSignal: 'SIGKILL', maxBuffer: MAX_BLOB_BYTES + 1, stdio: ['ignore', 'pipe', 'pipe'] });
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

// ---------- changed lines (spec 012 FR-020) ----------
// A scope covers a match only on a line that is UNCHANGED between the anchor and
// the reviewed commit (head side) resp. the anchor and --base (base side).
// "Changed" = on the `+` side of `git diff --unified=0 --no-renames <anchor> <rev>`.
// Strict, fail closed: a status other than a plain modification (added, deleted,
// type change, anything a rename or copy would leave), a binary diff, a diff that
// cannot be parsed or verified, output over the size bound, a failing git call —
// every line of that path counts as changed. Paths travel as argv elements behind
// --literal-pathspecs, never through a shell; names are read from `--raw -z`,
// never from the (quoted) patch text.

const DIFF_MAX_BYTES = 5 * 1024 * 1024; // one patch; the same size as the scan window
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const RAW_RE = /^:\d{6} \d{6} ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])\d*$/;
const PATCH_HEADER_PREFIXES = Object.freeze(['index ', 'old mode ', 'new mode ', 'new file mode ', 'deleted file mode ', 'similarity index ', 'dissimilarity index ', 'rename from ', 'rename to ', 'copy from ', 'copy to ']);
const PATCH_BODY_CHARS = '+- \\';

/** The new-side line ranges of one file's `git diff --unified=0` text:
 * { ok: true, ranges: [[start, end], …], hunks } (ranges ascending, 1-based, inclusive; `hunks` counts all hunks, deleted-only ones too) or
 * { ok: false, binary, reason }. Hunk counts are verified against the lines, so a
 * truncated or garbled patch is "unparseable", never "fewer changes". */
function parseChangedRanges(text) {
  const lines = String(text).split('\n');
  if (lines[lines.length - 1].replace(/\r$/, '') === '') lines.pop();
  const bad = (reason) => ({ ok: false, binary: false, reason });
  const ranges = [];
  let cur = null; // { oldLeft, newLeft } of the open hunk
  let files = 0;
  let hunks = 0;
  let lastEnd = 0;
  const closed = () => cur === null || (cur.oldLeft === 0 && cur.newLeft === 0);
  for (const raw of lines) {
    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) return { ok: false, binary: true, reason: 'binary diff' };
    if (raw.startsWith('@@')) {
      if (!closed()) return bad('hunk shorter than its header');
      const m = HUNK_RE.exec(raw);
      if (!m) return bad('malformed hunk header');
      const [oldCount, newStart, newCount] = [m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      if (![Number(m[1]), oldCount, newStart, newCount].every(Number.isSafeInteger)) return bad('hunk numbers out of range');
      if (newCount > 0) {
        if (newStart < 1 || newStart <= lastEnd) return bad('hunks out of order');
        lastEnd = newStart + newCount - 1;
        ranges.push([newStart, lastEnd]);
      }
      hunks++;
      cur = { oldLeft: oldCount, newLeft: newCount };
      continue;
    }
    // inside a hunk every line is body: `+` / `-` or the `\ No newline` marker
    const body = cur !== null && PATCH_BODY_CHARS.includes(raw[0] || 'x');
    if (cur !== null && !closed() && !body) return bad('unknown line inside a hunk');
    if (body) {
      if (raw[0] === '+') cur.newLeft--; // a surplus line leaves a negative count, which closed() rejects
      else if (raw[0] === '-') cur.oldLeft--;
      else if (raw[0] === ' ') return bad('context line in a --unified=0 patch');
      continue;
    }
    if (raw.startsWith('diff --git ')) { files++; if (files > 1) return bad('more than one file'); continue; }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ') || PATCH_HEADER_PREFIXES.some((h) => raw.startsWith(h))) continue;
    return bad('unknown line outside a hunk');
  }
  return closed() ? { ok: true, ranges, hunks } : bad('hunk shorter than its header');
}

/** Whether any of the ascending, disjoint `ranges` meets lines [a, b] (binary search). */
function rangesIntersect(ranges, a, b) {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] < a) lo = mid + 1; else hi = mid;
  }
  return lo < ranges.length && ranges[lo][0] <= b;
}

/** `git diff --raw -z --no-renames` output → Map(path → { status, oldSha, newSha }),
 * or null when it cannot be read with certainty (garbage, a record without a
 * path, an empty or replacement-character name, a path listed twice). */
function parseRawDiff(text) {
  const tokens = String(text).split('\0');
  if (tokens[tokens.length - 1] === '') tokens.pop();
  const map = new Map();
  for (let i = 0; i < tokens.length; i += 2) {
    const m = RAW_RE.exec(tokens[i]);
    const name = tokens[i + 1];
    if (!m || typeof name !== 'string' || name === '' || name.includes('�') || map.has(name)) return null;
    map.set(name, Object.freeze({ status: m[3], oldSha: m[1], newSha: m[2] }));
  }
  return map;
}

/** Variables that can redirect git to other objects, refs, config or a hidden diff. */
const GIT_ENV_DROP = Object.freeze([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_REPLACE_REF_BASE', 'GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_DIFF_OPTS', 'GIT_EXTERNAL_DIFF',
]);

/** git's environment for every read against the primary checkout (SEC-2): no redirecting
 * variables, replace objects switched off. */
function diffEnv() {
  const env = { ...process.env };
  for (const k of GIT_ENV_DROP) delete env[k];
  for (const k of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) delete env[k];
  env.GIT_NO_REPLACE_OBJECTS = '1';
  return env;
}

/** Upper bound for one git read in the primary checkout (SEC-8). The env var may only
 * lower it (tests): a huge or malformed value falls back to the bound. */
const GIT_TIMEOUT_MS = 30000;
function gitTimeoutMs() {
  const n = Number(process.env.XPROV_GIT_TIMEOUT_MS);
  return Number.isSafeInteger(n) && n >= 1 && n <= GIT_TIMEOUT_MS ? n : GIT_TIMEOUT_MS;
}
const timedOut = (r) => Boolean(r.error && r.error.code === 'ETIMEDOUT');

/** One git read in the primary checkout: replace objects off, cleaned environment, bounded time. */
function git(args, opts) {
  return C.gitSpawn(['--no-replace-objects', ...args], { env: diffEnv(), timeout: gitTimeoutMs(), killSignal: 'SIGKILL', ...(opts || {}) });
}

/** stdout of a successful `git(...)`, else null. */
function gitOut(args) {
  const r = git(args);
  return r.status === 0 ? r.stdout : null;
}

/** The changed-line index of `<anchor> → <rev>` in `root`, computed lazily and
 * cached for the run: { refusal(path, firstLine, lastLine) → null | 'changed_line' | 'diff_unreadable' | 'git_timeout', isChanged }.
 * `diff_unreadable`: git failed, or its output is binary, unparseable or unexplained. Never throws; every doubt is a refusal. */
function changedLines(root, anchor, rev) {
  const opts = { env: diffEnv(), maxBuffer: DIFF_MAX_BYTES };
  const base = ['--literal-pathspecs', '-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--inter-hunk-context=0'];
  let rawIndex; // undefined = not read yet, { why } = unreadable
  const patches = new Map();
  const readRaw = () => {
    const r = git([...base, '--raw', '--no-abbrev', '-z', anchor, rev, '--'], { ...opts, maxBuffer: C.GIT_MAX_BUFFER });
    if (timedOut(r)) return { why: 'git_timeout' };
    const map = r.status === 0 && !r.error ? parseRawDiff(r.stdout) : null;
    return map === null ? { why: 'diff_unreadable' } : { map };
  };
  const readPatch = (p, entry) => {
    const r = git([...base, '--unified=0', '--diff-algorithm=myers', anchor, rev, '--', p], opts);
    if (timedOut(r)) return { ok: false, why: 'git_timeout' };
    if (r.status !== 0 || r.error) return { ok: false, why: 'diff_unreadable' };
    const parsed = parseChangedRanges(r.stdout);
    // a different blob (not a mode-only change) that yields no hunk at all is unexplained: treat it as changed
    if (parsed.ok && parsed.hunks === 0 && entry.oldSha !== entry.newSha) return { ok: false, why: 'diff_unreadable' };
    return parsed.ok ? parsed : { ok: false, why: 'diff_unreadable' };
  };
  const check = (p, a, b) => {
    if (rawIndex === undefined) rawIndex = readRaw();
    if (rawIndex.why) return rawIndex.why;
    const entry = rawIndex.map.get(p);
    if (entry === undefined) return null; // not in the diff: identical at both ends
    if (entry.status !== 'M') return 'changed_line';
    if (!patches.has(p)) patches.set(p, readPatch(p, entry));
    const patch = patches.get(p);
    if (!patch.ok) return patch.why;
    return rangesIntersect(patch.ranges, a, b) ? 'changed_line' : null;
  };
  const refusal = (p, a, b) => {
    try { return check(p, a, b); } catch (_e) { return 'diff_unreadable'; }
  };
  return Object.freeze({ refusal, isChanged: (p, a, b) => refusal(p, a, b) !== null });
}


// ---------- scopes: which matches a v2 scope may cover (spec 012 FR-020, FR-021) ----------

/** The scope for (path, pattern): the LONGEST matching prefix, so a nested scope
 * counts its own matches and the broader one keeps its headroom. */
function scopeFor(scopes, m) {
  let best = null;
  for (const sc of scopes) {
    if (sc.pattern === m.pattern && m.path.startsWith(sc.prefix) && (best === null || sc.prefix.length > best.prefix.length)) best = sc;
  }
  return best;
}

const isLine = (n) => Number.isSafeInteger(n) && n >= 1;

/** Why one scope-eligible match cannot be covered by its scope, or null:
 * `no_line` (no determinable line, e.g. a UTF-16 view), `changed_line`. */
function scopeRefusal(m, changed) {
  if (m.view !== 'latin1' || !isLine(m.line) || !isLine(m.end_line) || m.end_line < m.line) return 'no_line';
  return changed === null ? 'changed_line' : changed.refusal(m.path, m.line, m.end_line);
}

/** Splits one side's matches into scope-covered ones and the rest. Returns
 * { rest: matches for the v1 judgement, hits: [{scope, count}], refused: [{scope, count, reason}] }.
 * `changed` is the changed-line index of this side (null: every match counts as changed).
 * A scope with more covered matches than its max_count covers nothing (reason max_count):
 * its matches go back to the v1 judgement. Matches in the allowlist file are never covered. */
function applyScopes(scopes, matches, changed) {
  const covered = new Map(); // scope → matches
  const refused = new Map(); // `${reason}\0${prefix}\0${pattern}` → { scope, reason, count }
  const refuse = (scope, reason, n) => {
    const key = `${reason}\0${scope.prefix}\0${scope.pattern}`;
    const prev = refused.get(key) || { scope, reason, count: 0 };
    refused.set(key, { ...prev, count: prev.count + n });
  };
  for (const m of matches) {
    const sc = m.path === X.ALLOWLIST_FILE ? null : scopeFor(scopes, m);
    if (sc === null) continue;
    const why = scopeRefusal(m, changed);
    if (why) { refuse(sc, why, 1); continue; }
    covered.set(sc, [...(covered.get(sc) || []), m]);
  }
  const taken = new Set();
  const hits = [];
  for (const [sc, list] of covered) {
    if (list.length > sc.max_count) { refuse(sc, 'max_count', list.length); continue; }
    list.forEach((m) => taken.add(m));
    hits.push({ scope: sc, count: list.length });
  }
  return { rest: matches.filter((m) => !taken.has(m)), hits, refused: [...refused.values()] };
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
  if (doc.owner === at.decidedBy && doc.owner === inTree && [...doc.entries, ...(doc.scopes || [])].every((e) => e.reviewed_by === doc.owner)) return null;
  return { detail: `owner ${JSON.stringify(doc.owner)} must equal decided_by at the anchor (${JSON.stringify(at.decidedBy)}) and in the working tree (${JSON.stringify(inTree)}), and every reviewed_by`, reasonDetail: DETAIL.owner_mismatch };
}

/** Spec 012 FR-019: every scope prefix is a TREE at the anchor
 * (`git cat-file -t <anchor>:<prefix>`; a missing path, a blob, a symlink and
 * a submodule are not). Problem text or null. */
function scopeTreeProblem(root, anchor, doc) {
  for (const sc of doc.scopes || []) {
    const t = git(['-C', root, 'cat-file', '-t', `${anchor}:${sc.prefix.slice(0, -1)}`]);
    if (timedOut(t)) return `git timed out checking scope prefix ${sc.prefix}`;
    if (t.status !== 0 || t.stdout.trim() !== 'tree') return `scope prefix ${sc.prefix} is not a directory at the anchor`;
  }
  return null;
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
  const tree = scopeTreeProblem(root, anchor, doc);
  if (tree) return invalid(tree);
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

/** The report rows of one side's applyScopes result: counts per (prefix, pattern), never values. */
function scopeRows(res, side, tag) {
  return {
    hits: res.hits.map((h) => tag(side, { prefix: h.scope.prefix, pattern: h.scope.pattern, class: h.scope.class, count: h.count, max_count: h.scope.max_count })),
    refused: res.refused.map((r) => tag(side, { prefix: r.scope.prefix, pattern: r.scope.pattern, count: r.count, reason: r.reason })),
  };
}

/** Applies the anchor's allowlist to the scan. Returns the NO_ALLOWLIST shape
 * with the fields filled in; `fail` set means stop before dispatch.
 * `o.matches` is the reviewed tree (side head); `o.baseSha` the resolved --base (scopes judge the base side against it). `o.extra` (Wave 7, Samuel:
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
  const scopes = doc.scopes || [];
  // Scopes judge the head side against anchor..commit and the base side against anchor..base; the
  // input side and path names are never scope-covered (FR-020).
  const index = (rev) => (scopes.length && rev ? changedLines(o.root, anc.anchor, rev) : null);
  const baseExtra = (o.extra || []).find((e) => e.side === 'base');
  const headScoped = applyScopes(scopes, o.matches, index(o.commitSha));
  const baseScoped = baseExtra ? applyScopes(scopes, baseExtra.matches, index(o.baseSha)) : null;
  const scopedHits = [...scopeRows(headScoped, null, tag).hits, ...(baseScoped ? scopeRows(baseScoped, 'base', tag).hits : [])];
  const scopedUncovered = [...scopeRows(headScoped, null, tag).refused, ...(baseScoped ? scopeRows(baseScoped, 'base', tag).refused : [])];
  const restPairs = groupPairs(headScoped.rest);
  const restSides = sides.map((x) => ({ side: x.side, pairs: x.side === 'base' && baseScoped ? groupPairs(baseScoped.rest) : x.pairs }));
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
  judge(restPairs, null);
  for (const x of restSides) judge(x.pairs, x.side);
  const tracked = new Set(o.tracked);
  const stale = doc.entries.filter((e) => !tracked.has(e.path) || !pairs.has(`${e.path}\0${e.pattern}`)).map((e) => Object.freeze({ path: e.path, pattern: e.pattern }));
  return result({
    anchor: anc.anchor, approved_blob: blobSha, allowlisted, uncovered, stale, scoped_hits: scopedHits, scoped_uncovered: scopedUncovered,
    allowlisted_hits: allowlisted.reduce((n, a) => n + a.count, 0) + scopedHits.reduce((n, h) => n + h.count, 0),
  });
}

module.exports = {
  NO_ALLOWLIST, STORE_MODE, STORE_DIR_MODE, SHA256_RE,
  parseStrictJson, parseAllowlist, parseChangedRanges, rangesIntersect, parseRawDiff, changedLines, gitTimeoutMs, scopeFor, scopesProblem, scopeTreeProblem, pathProblem, blobAt, separateCommitProblem, ownerProblem, verifiedTip, resolveAnchor, defaultBranch, lsRemote,
  readApprovals, readGuardedStore, exactKeys, storePath, groupPairs, evaluate, permitRecord,
};
