'use strict';

// ---------------------------------------------------------------------------
// xprov allowlist propose | approve — spec 009-cross-provider-review-gate,
// Wave 6b (FR-030 h, j). Sole writer: this wave.
//
//   propose --commit <rev> [--json] [--scopes] [--repo <toplevel>]
//       Lists every secret-pattern match at <rev> as path:line:column, pattern,
//       proposed class, masked excerpt (first 4 characters + length) and
//       high_confidence — never the matched text. `--json` prints a DRAFT
//       allowlist whose `reason` fields are empty (the schema rejects it until
//       the owner fills them in). Never writes a file. `--scopes` (spec 012 FR-024) groups
//       the matches per (prefix, pattern) for an allowlist v2: count, proposed class, the
//       heuristic kinds (env reference, placeholder, code expression, unclassified) and the
//       masked path:line list of what the heuristics could not classify.
//
//   approve --repo <path> [--revoke <sha256>]
//       HUMAN ONLY. Records the sha256 of the allowlist blob at the verified
//       refs/remotes/origin/<default_branch> in ~/.a1-xprov/allowlist-approvals.json
//       (or removes one sha with --revoke). Exits 2 and writes nothing unless
//         (1) stdin and stdout are TTYs,
//         (2) no CLAUDECODE, CLAUDE_PID or CLAUDE_CODE_* variable is set, and
//         (3) no ancestor process (parent-pid walk to pid 1) is CLAUDE_PID or
//             Claude Code: start name `claude` (/proc/<pid>/comm on Linux,
//             `ps -o comm=` basename on macOS), an executable resolved under a
//             `claude/versions/` directory, or `@anthropic-ai/claude-code` in
//             its argv (npm install, where the executable is `node`).
//       A TTY alone is fakeable with script(1); (2) and (3) are what keep an
//       agent's Bash tool — and the `!` prefix, which descends from Claude
//       Code — out. The owner runs this in a separate terminal, reads the
//       listing and types the entry count; a wrong count exits 2. The store is
//       written through a temp file in the same directory and rename().
//       Measured 2026-09-28 on macOS: Claude Code runs as start name `claude`,
//       executable ~/.local/share/claude/versions/<version>, with CLAUDECODE,
//       CLAUDE_PID and CLAUDE_CODE_* set. The Linux form (aiserver) is not
//       measured yet — the guard covers comm, the versions path and npm argv.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const tty = require('tty');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const io = require('./io.cjs');
const X = require('./xprov.cjs');
const C = require('./xprov-common.cjs');
const AL = require('./xprov-allowlist.cjs');
const { cloneSnapshot, cleanupSnapshot, scanTrackedFiles, REF_RE } = require('./xprov-snapshot.cjs');

const EXIT_REFUSED = X.EXIT_USAGE; // every guard refusal is exit 2 with nothing written
const MAX_ANCESTRY_STEPS = 256;
const TYPED_MAX_BYTES = 64;
const CLAUDE_ENV_RE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$/;
const CLAUDE_VERSIONS_RE = /(^|\/)claude\/versions\//;
const CLAUDE_NPM_PACKAGE = '@anthropic-ai/claude-code';
const FIXTURE_PATH_RE = /(^|\/)(_test-fixtures|fixtures?|tests?|__tests__|spec)\//;

const usage = (msg) => C.usageExit('allowlist', msg);

// ---------- propose (FR-030 h) ----------

function proposeClass(p) {
  if (FIXTURE_PATH_RE.test(p)) return 'fixture_fake';
  if (/\.(md|markdown|txt|rst)$/i.test(p)) return 'doc_example';
  return 'code_pattern';
}

// ---------- propose --scopes: heuristic kinds (spec 012 FR-024) ----------
// The kinds are a review aid for the owner, never a decision: a match is `unclassified`
// unless the VALUE part is obviously an environment reference, a placeholder or a code
// expression. High-confidence key shapes are never classified.

const ENV_LINE_RE = /\$\{\{\s*secrets\.|\bprocess\.env\b|\bos\.environ\b|\bgetenv\s*\(/i;
const ENV_VALUE_RE = /^(?:\$\{?[A-Za-z_]|%[A-Za-z_]+%$|<%=|\{\{)/;
const PLACEHOLDER_RE = /^(?:change[-_ ]?me\w*|your[-_]?\w*|example\w*|placeholder\w*|dummy\w*|fake\w*|sample\w*|redacted|test\w*|x{4,}|\*{3,}|\.{3,}|todo|secret|password|passwd|123456\w*|<[^>]+>)$/i;
const CODE_VALUE_RE = /^[A-Za-z_$][\w$.]*\(/;
const LITERAL_REF_RE = /(['"`/])-----BEGIN/;
const KIND_ORDER = Object.freeze(['env_reference', 'placeholder', 'code_expression', 'unclassified']);
const READ_MAX_BYTES = 5 * 1024 * 1024;
const HIGH_CONFIDENCE = new Set(X.HIGH_CONFIDENCE_PATTERNS);

/** The value part of a matched text: after the first `:` / `=`, quotes stripped; a URL's password. */
function valueOf(pattern, text) {
  if (pattern === 'url_credentials') { const m = /:\/\/[^:]*:(.*)@$/.exec(text); return m ? m[1] : ''; }
  return text.replace(/^[^:=]*[:=]\s*/, '').replace(/^['"]+/, '');
}

/** env_reference | placeholder | code_expression | null (unclassified) for one match. */
function kindOf(m, line) {
  if (HIGH_CONFIDENCE.has(m.pattern) || typeof line !== 'string') return null;
  const spec = X.SECRET_PATTERNS.find((p) => p.name === m.pattern);
  const hit = spec ? new RegExp(spec.re.source, `${spec.re.flags.replace('g', '')}y`).exec(line.slice(m.column - 1)) : null;
  if (!hit) return null;
  if (m.pattern === 'pem_begin') return LITERAL_REF_RE.test(line) ? 'code_expression' : null;
  const value = valueOf(m.pattern, hit[0]);
  if (ENV_LINE_RE.test(line) || ENV_VALUE_RE.test(value)) return 'env_reference';
  if (PLACEHOLDER_RE.test(value)) return 'placeholder';
  return CODE_VALUE_RE.test(value) ? 'code_expression' : null;
}

/** Adds `kind` to every match: the line is read from the clone (never printed). */
function withKinds(dir, matches) {
  const cache = new Map();
  const lines = (rel) => {
    if (!cache.has(rel)) {
      let text = null;
      try {
        const full = path.join(dir, rel);
        const st = fs.lstatSync(full);
        if (st.isFile() && st.size <= READ_MAX_BYTES) text = fs.readFileSync(full, 'latin1').split('\n');
      } catch (_e) { text = null; }
      cache.set(rel, text);
    }
    return cache.get(rel);
  };
  return matches.map((m) => Object.freeze({ ...m, kind: m.view === 'latin1' && lines(m.path) ? kindOf(m, lines(m.path)[m.line - 1]) : null }));
}

/** Every match at <rev> with its 1-based position; the clone is removed again.
 * `opts.kinds` also classifies the matches (propose --scopes). */
function matchesAt(root, rev, opts) {
  if (!REF_RE.test(String(rev))) throw C.inputError(`--commit must be a git revision without a leading dash or whitespace (got ${JSON.stringify(C.clip(rev, 80))})`);
  const sha = C.gitOut(['-C', root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (sha === null) throw C.inputError(`--commit ${JSON.stringify(C.clip(rev, 80))} is not a commit in ${root}`);
  const cl = cloneSnapshot(root, sha.trim(), null);
  if (!cl.ok) return { ok: false, detail: cl.detail };
  try {
    const scan = scanTrackedFiles(cl.dir, { positions: true });
    if (scan.error) return { ok: false, detail: `ls-files: ${scan.error}` };
    return { ok: true, commit: cl.commit, matches: opts && opts.kinds ? withKinds(cl.dir, scan.matches) : scan.matches };
  } finally {
    cleanupSnapshot(cl.dir);
  }
}

function listing(matches) {
  return matches.map((m) => Object.freeze({
    location: `${m.path}:${m.line}:${m.column}`, path: m.path, line: m.line, column: m.column,
    pattern: m.pattern, class: proposeClass(m.path), excerpt: m.excerpt, high_confidence: X.HIGH_CONFIDENCE_PATTERNS.includes(m.pattern),
  }));
}

/** Draft allowlist: one entry per (path, pattern), fingerprints de-duplicated, reasons empty. */
function draft(root, matches) {
  const rec = AL.permitRecord(root);
  const owner = rec && typeof rec.decided_by === 'string' ? rec.decided_by : '';
  const today = io.nowIso().slice(0, 10);
  const entries = [...AL.groupPairs(matches).values()].map((p) => ({
    path: p.path, pattern: p.pattern, max_count: p.count, fingerprints: [...p.fingerprints],
    class: proposeClass(p.path), reason: '', reviewed_by: owner, added_on: today,
  }));
  return { version: 1, owner, entries };
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The longest common directory (ending in `/`) of the paths — they share a first segment. */
function commonDir(paths) {
  const dirs = paths.map((p) => p.split('/').slice(0, -1));
  const common = dirs.reduce((acc, d) => { let i = 0; while (i < acc.length && i < d.length && acc[i] === d[i]) i++; return acc.slice(0, i); });
  return `${common.join('/')}/`;
}

/** The class most matches of a prefix suggest; a tie goes to the more cautious `code_pattern`. */
function majorityClass(paths) {
  const n = {};
  for (const p of paths) n[proposeClass(p)] = (n[proposeClass(p)] || 0) + 1;
  return [...X.ALLOWLIST_CLASSES].reverse().sort((a, b) => (n[b] || 0) - (n[a] || 0))[0];
}

/** Spec 012 FR-024: per (prefix, pattern) counts, proposed class and kinds; the high-confidence
 * counts that need v1 entries; the matches the heuristics could not classify (masked). */
function proposeScopes(matches) {
  const scopable = matches.filter((m) => !HIGH_CONFIDENCE.has(m.pattern) && m.path.includes('/'));
  const groups = new Map();
  for (const m of scopable) {
    const key = `${m.path.split('/')[0]}\0${m.pattern}`;
    groups.set(key, [...(groups.get(key) || []), m]);
  }
  const scopes = [...groups.values()].map((g) => {
    const kinds = Object.fromEntries(KIND_ORDER.map((k) => [k, g.filter((m) => (m.kind || 'unclassified') === k).length]));
    return Object.freeze({ prefix: commonDir(g.map((m) => m.path)), pattern: g[0].pattern, count: g.length, class: majorityClass(g.map((m) => m.path)), kinds });
  }).sort((a, b) => byText(a.prefix, b.prefix) || byText(a.pattern, b.pattern));
  const hc = new Map();
  for (const m of matches) if (HIGH_CONFIDENCE.has(m.pattern)) hc.set(m.pattern, (hc.get(m.pattern) || 0) + 1);
  const unclassified = matches.filter((m) => !m.kind).sort((a, b) => byText(a.path, b.path) || a.line - b.line).map((m) => Object.freeze({
    location: `${m.path}:${m.line}`, pattern: m.pattern, excerpt: m.excerpt, high_confidence: HIGH_CONFIDENCE.has(m.pattern),
  }));
  return {
    scopes, unclassified,
    not_scopable: [...hc].map(([pattern, count]) => ({ pattern, count })).sort((a, b) => byText(a.pattern, b.pattern)),
    root_files: matches.filter((m) => !HIGH_CONFIDENCE.has(m.pattern) && !m.path.includes('/')).length,
  };
}

/** Draft v2 document for `--scopes --json`: one scope per proposal, reasons empty. */
function draftScopes(root, scopes) {
  const rec = AL.permitRecord(root);
  const owner = rec && typeof rec.decided_by === 'string' ? rec.decided_by : '';
  const today = io.nowIso().slice(0, 10);
  return { version: 2, owner, entries: [], scopes: scopes.map((s) => ({ prefix: s.prefix, pattern: s.pattern, class: s.class, max_count: s.count, reason: '', reviewed_by: owner, added_on: today })) };
}

function cmdProposeScopes(root, commit, asJson) {
  const r = matchesAt(root, commit, { kinds: true });
  if (!r.ok) {
    process.stderr.write(`xprov allowlist propose: snapshot_failed — ${r.detail}\n`);
    return C.emitJson({ ok: false, reason: X.REASONS.snapshot_failed, detail: r.detail }, X.EXIT_FAIL);
  }
  const p = proposeScopes(r.matches);
  const err = (line) => process.stderr.write(`${line}\n`);
  for (const s of p.scopes) err(`${s.prefix}  ${s.pattern}  ${s.count}  ${s.class}  ${KIND_ORDER.map((k) => `${k} ${s.kinds[k]}`).join(' · ')}`);
  for (const n of p.not_scopable) err(`not scopable (high confidence, needs v1 entries): ${n.pattern} ${n.count}`);
  if (p.root_files) err(`root-level files (no directory prefix, need v1 entries): ${p.root_files} match(es)`);
  for (const u of p.unclassified) err(`unclassified: ${u.location}  ${u.pattern}  ${u.excerpt}  high_confidence: ${u.high_confidence}`);
  err(`xprov allowlist propose --scopes: ${p.scopes.length} scope(s), ${p.unclassified.length} unclassified match(es) at ${r.commit.slice(0, 12)}; nothing written`);
  if (asJson) return C.emitJson(draftScopes(root, p.scopes), X.EXIT_PASS);
  return C.emitJson({ ok: true, commit: r.commit, ...p }, X.EXIT_PASS);
}

function cmdPropose(args) {
  const flags = io.parseFlags(args, { commit: 'str', json: 'bool', scopes: 'bool', repo: 'str' });
  if (flags._.length) return usage(`propose: unexpected argument ${JSON.stringify(C.clip(flags._[0], 80))}`);
  if (!flags.commit) return usage('propose requires --commit <rev> [--json] [--scopes] [--repo <toplevel>]');
  const root = C.resolveRepoFlag(flags.repo);
  if (flags.scopes) return cmdProposeScopes(root, flags.commit, Boolean(flags.json));
  const r = matchesAt(root, flags.commit);
  if (!r.ok) {
    process.stderr.write(`xprov allowlist propose: snapshot_failed — ${r.detail}\n`);
    return C.emitJson({ ok: false, reason: X.REASONS.snapshot_failed, detail: r.detail }, X.EXIT_FAIL);
  }
  const rows = listing(r.matches);
  for (const m of rows) process.stderr.write(`${m.location}  ${m.pattern}  ${m.class}  ${m.excerpt}  high_confidence: ${m.high_confidence}\n`);
  process.stderr.write(`xprov allowlist propose: ${rows.length} match(es) at ${r.commit.slice(0, 12)}; nothing written\n`);
  if (flags.json) return C.emitJson(draft(root, r.matches), X.EXIT_PASS);
  return C.emitJson({ ok: true, commit: r.commit, matches: rows }, X.EXIT_PASS);
}

// ---------- approve guards (FR-030 j) ----------

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.error) throw new Error(`${cmd}: ${r.error.code || r.error.message}`);
  return r.status === 0 ? String(r.stdout) : null;
}

/** { ppid, name, exe, args } of one process, or null when it cannot be read. */
function processInfo(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const name = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      let exe = '';
      try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch (_e) { exe = ''; } // another user's process
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ');
      return { ppid, name, exe, args };
    } catch (_e) { return null; }
  }
  const ppid = run('ps', ['-o', 'ppid=', '-p', String(pid)]);
  const name = run('ps', ['-o', 'comm=', '-p', String(pid)]);
  const args = run('ps', ['-o', 'args=', '-p', String(pid)]);
  if (ppid === null || name === null) return null;
  const txt = run('lsof', ['-a', '-d', 'txt', '-p', String(pid), '-Fn']) || '';
  const exe = (txt.split('\n').find((l) => l.startsWith('n')) || '').slice(1);
  return { ppid: Number(ppid.trim()), name: name.trim(), exe, args: (args || '').trim() };
}

/** Why this process may not approve, or null. Fails closed when the walk cannot be completed. */
function ancestryRefusal() {
  const claudePid = /^\d+$/.test(String(process.env.CLAUDE_PID || '')) ? Number(process.env.CLAUDE_PID) : null;
  let pid = process.pid;
  for (let step = 0; step < MAX_ANCESTRY_STEPS && pid > 1; step++) {
    let info;
    try { info = processInfo(pid); } catch (e) { return `cannot read the process tree (${e.message})`; }
    if (!info) return `cannot read process ${pid} of the ancestry`;
    if (pid === claudePid) return `ancestor ${pid} is CLAUDE_PID`;
    // case-insensitive: a Claude Desktop-style start name "Claude" counts too (Samuel)
    if (path.basename(info.name).toLowerCase() === 'claude') return `ancestor ${pid} started as ${path.basename(info.name)}`;
    if (CLAUDE_VERSIONS_RE.test(info.exe)) return `ancestor ${pid} runs an executable under claude/versions/`;
    if (info.args.includes(CLAUDE_NPM_PACKAGE)) return `ancestor ${pid} runs ${CLAUDE_NPM_PACKAGE}`;
    if (!Number.isInteger(info.ppid) || info.ppid === pid) return `cannot read the parent of process ${pid}`;
    pid = info.ppid;
  }
  return pid > 1 ? 'process tree deeper than the walk limit' : null;
}

function guardRefusal() {
  if (!tty.isatty(0) || !tty.isatty(1)) return 'stdin and stdout must both be a terminal';
  const vars = Object.keys(process.env).filter((k) => CLAUDE_ENV_RE.test(k));
  if (vars.length) return `refusing under Claude Code (environment: ${vars.sort().join(', ')})`;
  return ancestryRefusal();
}

// ---------- store writer ----------

const EAGAIN_WAIT_MS = 50;
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** One line from the terminal (blocking reads on fd 0; a non-blocking fd waits, never spins). */
function readTypedLine() {
  const buf = Buffer.alloc(TYPED_MAX_BYTES);
  let s = '';
  while (s.length < TYPED_MAX_BYTES && !/[\r\n]/.test(s)) {
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch (e) { if (e.code === 'EAGAIN') { sleepMs(EAGAIN_WAIT_MS); continue; } throw e; }
    if (n === 0) break;
    s += buf.toString('utf8', 0, n);
  }
  return s.split(/[\r\n]/)[0].trim();
}

/** Atomic write of one guarded store `name` in ~/.a1-xprov (0700, never a
 * symlink): 0600 temp file in the same directory, fsync, then rename. */
function writeGuardedStore(name, doc) {
  const home = X.xprovHome();
  let st = null;
  try { st = fs.lstatSync(home); } catch (_e) { st = null; }
  if (st && (st.isSymbolicLink() || !st.isDirectory())) throw C.inputError(`${home} is not a real directory; refusing to write ${name}`);
  if (!st) fs.mkdirSync(home, { mode: AL.STORE_DIR_MODE });
  fs.chmodSync(home, AL.STORE_DIR_MODE);
  const tmp = path.join(home, `.${name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', AL.STORE_MODE);
  try {
    fs.fchmodSync(fd, AL.STORE_MODE); // umask-proof
    fs.writeSync(fd, `${JSON.stringify(doc, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const target = path.join(home, name);
  fs.renameSync(tmp, target);
  return target;
}

function writeStore(repos) {
  return writeGuardedStore(X.ALLOWLIST_APPROVALS_FILE, { version: 1, repos });
}

// ---------- approve / revoke ----------

/** The store as it is now: { repos } to extend, or { refusal } — an existing
 * store that fails the checks is never silently replaced (Samuel S-m5). */
function currentStore() {
  const current = AL.readApprovals();
  if (current.ok) return { repos: current.repos };
  if (current.missing) return { repos: {} };
  return { refusal: `the existing approval store is not usable (${current.why}); fix or remove ${AL.storePath()} yourself, then run approve again` };
}

/** What the owner reads before typing the count: one block per entry and per scope
 * (spec 012 FR-022: a v2 blob is approved like a v1 blob, the typed count is
 * entries + scopes). { lines, count, prompt } — masked excerpts only, never values. */
function approveListing(doc, rows) {
  const lines = [];
  for (const e of doc.entries) {
    lines.push(`- ${e.path} · ${e.pattern} · max_count ${e.max_count} · ${e.class} · ${e.reason}`);
    const hits = rows.filter((m) => m.path === e.path && m.pattern === e.pattern);
    if (!hits.length) lines.push('    (no match at this commit: stale)');
    for (const m of hits) lines.push(`    ${m.location}  ${m.excerpt}  high_confidence: ${m.high_confidence}`);
  }
  const scopes = doc.scopes || [];
  for (const sc of scopes) {
    const seen = rows.filter((m) => m.pattern === sc.pattern && AL.scopeFor(scopes, m) === sc).length;
    lines.push(`- scope ${sc.prefix} · ${sc.pattern} · max_count ${sc.max_count} · ${sc.class} · ${sc.reason}`);
    lines.push(`    observed ${seen} match(es) at this commit${seen === 0 ? ' — stale' : seen > sc.max_count ? ' — exceeds max_count' : ''}`);
  }
  const count = doc.entries.length + scopes.length;
  const prompt = doc.version === 2 ? `Type the number of entries and scopes (${count}) to approve this blob: ` : `Type the number of entries (${count}) to approve this blob: `;
  return { lines, count, prompt };
}

function approve(root) {
  const store = currentStore();
  if (store.refusal) return { code: X.EXIT_FAIL, msg: store.refusal };
  const t = AL.verifiedTip(root); // the same verification the gate's anchor needs
  if (!t.ok) return { code: X.EXIT_FAIL, msg: t.note };
  const blob = AL.blobAt(root, t.tip, X.ALLOWLIST_FILE);
  if (blob === null) return { code: X.EXIT_FAIL, msg: `no ${X.ALLOWLIST_FILE} at ${t.tip.slice(0, 12)}` };
  const parsed = AL.parseAllowlist(blob.toString('utf8'));
  if (!parsed.ok) return { code: X.EXIT_FAIL, msg: `${X.ALLOWLIST_FILE} at ${t.tip.slice(0, 12)} is invalid: ${parsed.detail}` };
  const r = matchesAt(root, t.tip);
  if (!r.ok) return { code: X.EXIT_FAIL, msg: `snapshot of ${t.tip.slice(0, 12)} failed: ${r.detail}` };
  const sha = C.sha256(blob);
  const rows = listing(r.matches);
  const err = (line) => process.stderr.write(`${line}\n`);
  // Warn, never block: a blob the gate will reject anyway is not worth approving.
  const sep = AL.separateCommitProblem(root, t.tip);
  if (sep) err(`warning: ${sep} — the gate reports allowlist_not_separate_commit for this blob`);
  const tree = AL.scopeTreeProblem(root, t.tip, parsed.doc);
  if (tree) err(`warning: ${tree} — the gate reports allowlist_invalid for this blob`);
  const owner = AL.ownerProblem(root, t.tip, parsed.doc);
  if (owner) err(`warning: owner check fails — ${owner.detail}`);
  err(`Allowlist ${X.ALLOWLIST_FILE} at ${t.tip.slice(0, 12)} — owner ${parsed.doc.owner}, blob sha256 ${sha}`);
  const view = approveListing(parsed.doc, rows);
  for (const line of view.lines) err(line);
  process.stderr.write(view.prompt);
  const typed = readTypedLine();
  if (typed !== String(view.count)) return { code: EXIT_REFUSED, msg: `typed ${JSON.stringify(C.clip(typed, 16))}, expected ${view.count}; nothing written` };
  const key = C.commonDirOf(root);
  const repos = { ...store.repos, [key]: [...new Set([...(store.repos[key] || []), sha])] };
  const file = writeStore(repos);
  return { code: X.EXIT_PASS, msg: `approved ${sha} for ${key} in ${file}`, out: { ok: true, repo: key, approved: sha, store: file } };
}

function revoke(root, sha) {
  if (!AL.SHA256_RE.test(String(sha))) return { code: EXIT_REFUSED, msg: '--revoke needs a lowercase sha256' };
  const key = C.commonDirOf(root);
  const current = AL.readApprovals();
  if (!current.ok) return { code: X.EXIT_FAIL, msg: `no valid approval store (${current.why}); nothing to revoke` };
  const list = current.repos[key] || [];
  if (!list.includes(sha)) return { code: X.EXIT_FAIL, msg: `${sha} is not approved for ${key}` };
  const file = writeStore({ ...current.repos, [key]: list.filter((s) => s !== sha) });
  return { code: X.EXIT_PASS, msg: `revoked ${sha} for ${key} in ${file}`, out: { ok: true, repo: key, revoked: sha, store: file } };
}

function cmdApprove(args) {
  const flags = io.parseFlags(args, { repo: 'str', revoke: 'str' });
  if (flags._.length) return usage(`approve: unexpected argument ${JSON.stringify(C.clip(flags._[0], 80))}`);
  if (!flags.repo) return usage('approve requires --repo <path> [--revoke <sha256>]');
  const refusal = guardRefusal();
  if (refusal) {
    process.stderr.write(`xprov allowlist approve: ${refusal}. Run it yourself in a separate terminal (not through an agent and not via the ! prefix). Nothing written.\n`);
    process.exitCode = EXIT_REFUSED;
    return null;
  }
  const root = C.resolveRepoFlag(flags.repo);
  let r;
  try {
    r = flags.revoke !== undefined ? revoke(root, flags.revoke) : approve(root);
  } catch (e) {
    if (e && e.code === 'A1_INPUT') throw e;
    // git, blob, clone and write failures: one line, exit 1, nothing half-written (Reinhard R-M4)
    process.stderr.write(`[a1-tools] xprov allowlist approve: failed — ${C.clip(String(e && e.message ? e.message : e).replace(/\s+/g, ' '), C.DETAIL_MAX_CHARS)}; nothing written\n`);
    process.exitCode = X.EXIT_FAIL;
    return null;
  }
  process.stderr.write(`xprov allowlist approve: ${r.msg}\n`);
  if (r.out) return C.emitJson(r.out, r.code);
  process.exitCode = r.code;
  return null;
}

// ---------- dispatch ----------

function cmdXprovAllowlist(args) {
  const [sub, ...rest] = Array.isArray(args) ? args : [];
  try {
    if (sub === 'propose') return cmdPropose(rest);
    if (sub === 'approve') return cmdApprove(rest);
  } catch (e) {
    if (e && e.code === 'A1_INPUT') return usage(`${sub}: ${e.message}`);
    throw e;
  }
  return usage(`<propose|approve> is required, got ${JSON.stringify(C.clip(sub == null ? '' : sub, 40))}`);
}

module.exports = {
  cmdXprovAllowlist, approveListing, proposeScopes, guardRefusal, ancestryRefusal, processInfo, proposeClass, draft, listing, writeStore, writeGuardedStore, readTypedLine,
  CLAUDE_ENV_RE, CLAUDE_VERSIONS_RE, CLAUDE_NPM_PACKAGE,
};
