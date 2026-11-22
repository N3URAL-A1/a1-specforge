'use strict';

// ---------------------------------------------------------------------------
// gate-log — append-only, hash-chained log of gate firings (spec 017, Wave 2,
// FR-008 / FR-010). Contract: docs/adr/2026-10-14-gate-invoke-and-log.md §2.
//
// One JSON line per invocation of a subcommand named in a registry `invoke`
// cell, appended to <repo>/.a1/phases/<scope>/gate-log.jsonl:
//   {ts, gate, verdict, exit, head_sha, scope, started_at, duration_ms, [input_hash, reused, ci_evidence_why], prev}
// `prev` is the sha256 (hex) of the previous line's bytes WITHOUT its newline
// (first line: 64 zeros). Appends run under an exclusive lock with ONE
// O_APPEND write per record. The lock is a directory made with mkdir (atomic,
// no half-written state): locks.cjs acquireReservationsLock writes its payload
// AFTER creating the file, a reader in that window sees an empty lock, calls
// it stale and steals it - measured 2026-10-20 as a forked chain under load
// (two parallel writers x 50 lines, 12 broken links). The lock lives in the git
// common dir, so it never shows in `git status`. The log is never committed: the first write adds
// `.a1/phases/*/gate-log.jsonl` to <git-common-dir>/info/exclude.
//
// The facade hook (installGateLog) is the only caller. Modules that call each
// other in-process never reach it, so a nested call appends nothing.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { sleepSyncMs } = require('./locks.cjs');
const { invokeMap } = require('./gate-ids.cjs');
const { envWithoutGitRedirects } = require('./git-env.cjs');

const ZERO_HASH = '0'.repeat(64);
const UNSCOPED = '_unscoped';
const EXCLUDE_PATTERN = '.a1/phases/*/gate-log.jsonl';
const LOG_NAME = 'gate-log.jsonl';
const LOCK_NAME = 'a1-gate-log.lock.d';
const LOCK_RETRIES = 400;
const LOCK_RETRY_DELAY_MS = 25;
// A holder that died without releasing leaves the directory behind; the section
// takes milliseconds, so anything this old is abandoned.
const LOCK_STALE_MS = 30000;
const SCOPE_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const VERDICTS = Object.freeze(['pass', 'fail', 'error']);
const GIT_TIMEOUT_MS = 10000;
const WHY_RE = /^[a-z][a-z0-9_]{0,63}$/;
// Spec 027 D1: the only extras a running gate may hand to the hook.
const EXTRA_RULES = Object.freeze({
  input_hash: (v) => typeof v === 'string' && HEX64_RE.test(v),
  reused: (v) => typeof v === 'boolean',
  ci_evidence_why: (v) => typeof v === 'string' && WHY_RE.test(v),
  scanned: (v) => Number.isInteger(v) && v >= 0, // spec 028 FR-017: files a scanning gate looked at
});
const CORE_KEYS = Object.freeze(['ts', 'gate', 'verdict', 'exit', 'head_sha', 'scope', 'prev', 'started_at', 'duration_ms']);
const KEY_NOTE_MAX = 40;

// Request-scoped enough for a CLI process: set only after the hook installed, taken and reset in the exit handler.
let hookInstalled = false;
let hookScope = null;
let pendingExtra = null;

/**
 * @param {*} fields
 * @returns {{accepted: Object, rejected: {key: string, reason: string}[]}}
 */
function sanitizeExtra(fields) {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    return { accepted: Object.freeze({}), rejected: [{ key: '(value)', reason: 'not_an_object' }] };
  }
  const rejected = [];
  const ok = {};
  for (const key of Object.keys(fields)) {
    if (CORE_KEYS.includes(key)) rejected.push({ key, reason: 'core_field' });
    else if (!Object.prototype.hasOwnProperty.call(EXTRA_RULES, key)) rejected.push({ key, reason: 'unknown_key' });
    else if (!EXTRA_RULES[key](fields[key])) rejected.push({ key, reason: 'bad_value' });
    else ok[key] = fields[key];
  }
  const accepted = {};
  for (const key of Object.keys(EXTRA_RULES)) if (key in ok) accepted[key] = ok[key];
  return { accepted: Object.freeze(accepted), rejected };
}

/**
 * Hands allowlisted extra fields to the hook record of this process (D1). A no-op when the hook did not install.
 * @param {Object} fields
 * @returns {{active: boolean, accepted: string[], rejected: {key: string, reason: string}[]}}
 */
function setRecordExtra(fields) {
  const { accepted, rejected } = sanitizeExtra(fields);
  for (const r of rejected) {
    const k = String(r.key).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, KEY_NOTE_MAX);
    process.stderr.write(`gate-log: setRecordExtra ignored ${k} (${r.reason})\n`);
  }
  if (!hookInstalled) return { active: false, accepted: [], rejected };
  pendingExtra = Object.freeze({ ...(pendingExtra || {}), ...accepted });
  return { active: true, accepted: Object.keys(accepted), rejected };
}

/**
 * The `--phase` scope the hook stripped for this process (spec 027 D6); null without `--phase` or without the hook.
 * @returns {string|null}
 */
function currentScope() {
  return hookInstalled ? hookScope : null;
}

function inputError(msg) {
  const err = new Error(msg);
  err.code = 'A1_INPUT';
  return err;
}

/** @param {string} scope @returns {string} the scope when safe as one path segment */
function validateScope(scope) {
  if (typeof scope !== 'string' || !SCOPE_RE.test(scope) || scope.includes('..')) {
    throw inputError(`--phase value is not a safe scope name (letters, digits, ".", "_", "-", not starting with "." or "-"; no "..", no "/", max 100): ${JSON.stringify(String(scope).slice(0, 60))}`);
  }
  return scope;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** exit code -> log verdict (anything but 0 / 1 is an error) */
function verdictForExit(code) {
  if (code === 0) return 'pass';
  if (code === 1) return 'fail';
  return 'error';
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, shell: false, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/** @returns {{root: string, commonDir: string}|null} null outside a git work tree */
function gitContext(cwd) {
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  const common = root ? git(['rev-parse', '--git-common-dir'], root) : null;
  if (!root || !common) return null;
  return { root, commonDir: path.resolve(root, common) };
}

function ensureExcluded(commonDir) {
  const file = path.join(commonDir, 'info', 'exclude');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_e) { /* created below */ }
  if (text.split('\n').some((l) => l.trim() === EXCLUDE_PATTERN)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${EXCLUDE_PATTERN}\n`, 'utf8');
  return true;
}

const OWNER_FILE = 'owner';

function isStaleLock(lockDir) {
  try { return Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS; } catch (_e) { return false; }
}

/** pid + random nonce: names one acquisition, so a steal and a release can tell whose lock they hold. */
function newOwnerToken() {
  return `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
}

function readOwner(lockDir) {
  try { return fs.readFileSync(path.join(lockDir, OWNER_FILE), 'utf8'); } catch (_e) { return null; }
}

/**
 * Steals an abandoned lock (SEC-7). `observed` is the owner token read when the lock was judged stale.
 * The rename is atomic, but between "judged stale" and "renamed" the holder may have been replaced by a live
 * one: after the rename the moved directory must still carry the observed token and still be old, else it is
 * put back and the steal reports false.
 * @returns {boolean} true when an abandoned lock was removed
 */
function stealStaleLock(lockDir, observed) {
  const aside = `${lockDir}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(lockDir, aside); } catch (_e) { return false; } // lost the race, or already gone
  if (readOwner(aside) === observed && isStaleLock(aside)) {
    fs.rmSync(aside, { recursive: true, force: true });
    return true;
  }
  try { fs.renameSync(aside, lockDir); } catch (_e) { /* a newer lock took the place: leave the moved one aside */ }
  return false;
}

/** @returns {{dir: string, token: string}} the held lock; throws after ~10 s without getting it */
function acquireLock(lockDir) {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      const token = newOwnerToken();
      fs.writeFileSync(path.join(lockDir, OWNER_FILE), token, { flag: 'wx' });
      return { dir: lockDir, token };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (isStaleLock(lockDir)) { stealStaleLock(lockDir, readOwner(lockDir)); continue; }
      sleepSyncMs(LOCK_RETRY_DELAY_MS);
    }
  }
  throw new Error(`could not lock ${lockDir} after ${LOCK_RETRIES} attempts`);
}

/** Releases only a lock this acquisition still owns (a stolen one is somebody else's now). */
function releaseLock(lock) {
  if (readOwner(lock.dir) !== lock.token) return;
  try { fs.rmSync(path.join(lock.dir, OWNER_FILE), { force: true }); fs.rmdirSync(lock.dir); } catch (_e) { /* already gone */ }
}

function refuse(file, why) {
  const err = new Error(`refusing to write the gate log ${file}: ${why}`);
  err.code = 'A1_UNSAFE_PATH';
  return err;
}

function insideRoot(realRoot, real) {
  return real === realRoot || real.startsWith(realRoot + path.sep);
}

/**
 * SEC-8: `.a1`, `.a1/phases` and `.a1/phases/<scope>` (where they exist) and the log file itself must not lead
 * out of the repository, so a symlink planted in a checkout cannot redirect the append.
 */
function assertContained(root, scope, file) {
  const realRoot = fs.realpathSync(root);
  let cur = root;
  for (const seg of ['.a1', 'phases', scope]) {
    cur = path.join(cur, seg);
    try { fs.lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    let real;
    try { real = fs.realpathSync(cur); } catch (_e) { throw refuse(file, `${cur} is a dangling symlink`); }
    if (!insideRoot(realRoot, real)) throw refuse(file, `${path.relative(root, cur)} resolves outside the repository`);
  }
  try { if (fs.lstatSync(file).isSymbolicLink()) throw refuse(file, 'the log file is a symlink'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

function lastNonEmptyLine(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i] !== '') return lines[i];
  return null;
}

function logPathFor(root, scope) {
  return path.join(root, '.a1', 'phases', scope, LOG_NAME);
}

/**
 * Append one record. Never throws away a failure: the caller reports it.
 *
 * @param {{root: string, commonDir?: string, scope: string, gateId: string, verdict: string, exitCode: number, headSha?: string, ts?: string}} rec
 * @returns {{file: string, line: string}}
 */
function appendGateLine(rec) {
  const scope = validateScope(rec.scope);
  const file = logPathFor(rec.root, scope);
  assertContained(rec.root, scope, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertContained(rec.root, scope, file);
  const lock = acquireLock(path.join(rec.commonDir || path.dirname(file), LOCK_NAME));
  try {
    if (rec.commonDir) ensureExcluded(rec.commonDir); // inside the lock: one writer edits info/exclude at a time (SEC-7)
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const prevLine = lastNonEmptyLine(existing);
    const record = {
      ts: rec.ts || new Date().toISOString(),
      gate: rec.gateId,
      verdict: rec.verdict,
      exit: rec.exitCode,
      head_sha: rec.headSha || 'none',
      scope,
    };
    if (typeof rec.startedAt === 'string' && rec.startedAt.endsWith('Z') && !Number.isNaN(Date.parse(rec.startedAt))) record.started_at = rec.startedAt;
    if (Number.isInteger(rec.durationMs) && rec.durationMs >= 0) record.duration_ms = rec.durationMs;
    Object.assign(record, sanitizeExtra(rec.extra || {}).accepted);
    record.prev = prevLine === null ? ZERO_HASH : sha256(prevLine);
    const line = JSON.stringify(record);
    const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o644);
    try { fs.writeSync(fd, Buffer.from(`${lead}${line}\n`, 'utf8')); } finally { fs.closeSync(fd); }
    return { file, line };
  } finally {
    releaseLock(lock);
  }
}

function shapeProblem(rec) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return 'not a JSON object';
  if (typeof rec.ts !== 'string' || Number.isNaN(Date.parse(rec.ts))) return 'ts is not a UTC timestamp';
  if (typeof rec.gate !== 'string' || rec.gate === '') return 'gate is missing';
  if (!VERDICTS.includes(rec.verdict)) return `verdict is not one of ${VERDICTS.join('|')}`;
  if (!Number.isInteger(rec.exit)) return 'exit is not an integer';
  if (typeof rec.head_sha !== 'string' || rec.head_sha === '') return 'head_sha is missing';
  if (typeof rec.scope !== 'string' || rec.scope === '') return 'scope is missing';
  if (typeof rec.prev !== 'string' || !HEX64_RE.test(rec.prev)) return 'prev is not a sha256';
  if ('started_at' in rec && (typeof rec.started_at !== 'string' || Number.isNaN(Date.parse(rec.started_at)))) return 'started_at is not a UTC timestamp';
  if ('duration_ms' in rec && !(Number.isInteger(rec.duration_ms) && rec.duration_ms >= 0)) return 'duration_ms is not a non-negative integer';
  if ('input_hash' in rec && !EXTRA_RULES.input_hash(rec.input_hash)) return 'input_hash is not a sha256';
  if ('reused' in rec && !EXTRA_RULES.reused(rec.reused)) return 'reused is not a boolean';
  if ('ci_evidence_why' in rec && !EXTRA_RULES.ci_evidence_why(rec.ci_evidence_why)) return 'ci_evidence_why is malformed';
  if ('scanned' in rec && !EXTRA_RULES.scanned(rec.scanned)) return 'scanned is not a non-negative integer';
  return null;
}

const MAX_LOG_BYTES = 8 * 1024 * 1024;

/** A git call in `cwd`; returns `{status, stdout}`. A spawn failure or timeout has no status (treated as a refusal by the callers).
 * The env is the caller's minus the GIT_* repo-location variables (SEC-10): an inherited GIT_DIR / GIT_INDEX_FILE would make git answer
 * for another repository or index, so a tracked log could read as untracked. */
function gitIn(cwd, args) {
  const r = spawnSync('git', args, { cwd, shell: false, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env: envWithoutGitRedirects(process.env) });
  return { status: r.status, stdout: r.stdout || '' };
}

/**
 * Why the path of a log is not what this checkout's own hook wrote, or null (SEC-6). In-repo path tricks defeat a
 * plain "is it tracked" test: a tracked symlink on the path makes the file reachable but not itself tracked, a
 * submodule hides its files from the superproject index, and on a case-insensitive checkout the index may spell the
 * path in another case. So the path must be positively known as untracked content of THIS repository:
 *  1. `.a1`, `.a1/phases` and `.a1/phases/<scope>` are real directories (lstat), never symlinks;
 *  2. the work-tree root git reports for the phase directory is the repository root (no submodule, no embedded repo);
 *  3. the realpath of the log is exactly <realpath(root)>/.a1/phases/<scope>/gate-log.jsonl;
 *  4. `git ls-files -o` lists the log (untracked, present) and no case-insensitive match is tracked.
 * Returns `'missing'` when the log does not exist and nothing on the way to it is suspect.
 */
function evidencePathProblem(root, scope, file) {
  const realRoot = fs.realpathSync(root);
  let cur = root;
  for (const seg of ['.a1', 'phases', scope]) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') return 'missing'; return `lstat failed: ${e.code}`; }
    if (st.isSymbolicLink()) return `${path.relative(root, cur)} is a symlink`;
    if (!st.isDirectory()) return `${path.relative(root, cur)} is not a directory`;
  }
  let st;
  try { st = fs.lstatSync(file); } catch (e) { return e.code === 'ENOENT' ? 'missing' : `lstat failed: ${e.code}`; }
  if (st.isSymbolicLink()) return 'the log file is a symlink';
  const top = gitIn(path.dirname(file), ['rev-parse', '--show-toplevel']);
  let realTop = null;
  try { realTop = top.status === 0 ? fs.realpathSync(top.stdout.trim()) : null; } catch (_e) { realTop = null; }
  if (realTop !== realRoot) return 'the phase directory belongs to another repository (submodule or embedded repo)';
  let realFile;
  try { realFile = fs.realpathSync(file); } catch (_e) { return 'the log does not resolve'; }
  if (realFile !== path.join(realRoot, '.a1', 'phases', scope, LOG_NAME)) return 'the log resolves to another path';
  const rel = path.relative(root, file).split(path.sep).join('/');
  const untracked = gitIn(root, ['ls-files', '-o', '-z', '--', rel]);
  if (untracked.status !== 0 || !untracked.stdout.split('\0').includes(rel)) return 'git does not list the log as untracked';
  const tracked = gitIn(root, ['ls-files', '--error-unmatch', '--', `:(icase)${rel}`]);
  if (tracked.status !== 1) return 'tracked by git';
  return null;
}

/**
 * Open the log without following a final symlink, check the DESCRIPTOR (regular file, size under the cap) and read exactly
 * the `st.size` bytes it reported from it (SEC-9): no path is used between the check and the read. A log that grows after
 * the fstat is read up to that size (the appended tail is ignored); one that shrinks is refused. `afterStat` is a test seam.
 * @returns {{text: string} | {why: string}}
 */
function readCapped(file, afterStat) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)); } catch (e) { return { why: `unreadable: ${e.code}` }; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { why: 'not a regular file' };
    if (st.size > MAX_LOG_BYTES) return { why: 'too_large' };
    if (typeof afterStat === 'function') afterStat();
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const got = fs.readSync(fd, buf, n, st.size - n, null);
      if (got === 0) return { why: 'changed while reading' };
      n += got;
    }
    return { text: buf.toString('utf8', 0, n) };
  } catch (e) { return { why: `unreadable: ${e.code || e.message}` }; } finally { fs.closeSync(fd); }
}

/**
 * Read a gate log as EVIDENCE (a skip or a stop decision), never as a mere record (SEC-1, SEC-2, SEC-6, SEC-9).
 * The chain is local tamper-evidence, not authentication, so the file must be what this checkout's own hook wrote:
 * untracked content of this repository reached through no symlink or submodule (`evidencePathProblem`), a regular
 * file of bounded size read through one descriptor, and the chain must verify.
 *
 * @param {string} root repository work-tree root the log belongs to
 * @param {string} scope
 * @returns {{ok: true, chain: Object} | {ok: false, reason: 'no_log'|'untrusted_log', why: string}}
 */
function readTrustedChain(root, scope) {
  const file = logPathFor(root, scope);
  const bad = (why) => ({ ok: false, reason: 'untrusted_log', why });
  let problem;
  try { problem = evidencePathProblem(root, scope, file); } catch (e) { return bad(`path check failed: ${e.message}`); }
  if (problem === 'missing') return { ok: false, reason: 'no_log', why: 'missing' };
  if (problem !== null) return bad(problem);
  const read = readCapped(file);
  if (read.why) return bad(read.why);
  let chain;
  try { chain = verifyChainText(read.text); } catch (e) { return bad(`unreadable: ${e.message}`); }
  return chain.ok ? { ok: true, chain } : bad('chain does not verify');
}

/**
 * Check shape of every line and the hash chain.
 *
 * @param {string} file
 * @returns {{ok: boolean, lines: number, records: Object[], problems: {line: number, rule: string, reason: string}[]}}
 */
function verifyChain(file) {
  return verifyChainText(fs.readFileSync(file, 'utf8'));
}

/** `verifyChain` over text already read (the evidence reader hands over what it read from one descriptor). */
function verifyChainText(text) {
  const raw = text.split('\n');
  if (raw[raw.length - 1] === '') raw.pop();
  const problems = [];
  const records = [];
  let prevHash = ZERO_HASH;
  raw.forEach((line, idx) => {
    const n = idx + 1;
    let rec = null;
    let parsed = true;
    try { rec = JSON.parse(line); } catch (_e) {
      parsed = false;
      problems.push({ line: n, rule: 'malformed_line', reason: 'not valid JSON' });
    }
    if (parsed) {
      const bad = shapeProblem(rec);
      if (bad) problems.push({ line: n, rule: 'malformed_line', reason: bad });
      else if (rec.prev !== prevHash) problems.push({ line: n, rule: 'chain_broken', reason: 'prev does not match the sha256 of the previous line' });
      else records.push(rec);
    }
    prevHash = sha256(line);
  });
  return { ok: problems.length === 0, lines: raw.length, records, problems };
}

/**
 * Tokens of a registry subcommand key against argv. Token 0 is the group;
 * token 1 (when it is not a flag) the subcommand; later `--flag` tokens must
 * appear in argv (bare or `--flag=value`).
 *
 * @param {string[]} argv @param {Object<string,string>} map
 * @returns {string|null} gate id
 */
function matchInvoke(argv, map) {
  for (const [key, gateId] of Object.entries(map)) {
    const toks = key.split(' ');
    if (argv[0] !== toks[0]) continue;
    const hasSub = toks.length > 1 && !toks[1].startsWith('--');
    if (hasSub && argv[1] !== toks[1]) continue;
    const flags = toks.slice(hasSub ? 2 : 1);
    if (flags.every((f) => argv.some((a) => a === f || a.startsWith(`${f}=`)))) return gateId;
  }
  return null;
}

/** Remove `--phase <scope>` / `--phase=<scope>`; returns the remaining argv and the scope. */
function stripPhase(argv) {
  const out = [];
  let scope = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phase') {
      if (i + 1 >= argv.length) throw inputError('--phase needs a value');
      scope = validateScope(argv[++i]);
    } else if (a.startsWith('--phase=')) {
      scope = validateScope(a.slice('--phase='.length));
    } else {
      out.push(a);
    }
  }
  return { argv: out, scope };
}

/** The repo a gate call acts on: `--project <dir>` when it names a directory, else the working directory (m2). */
function projectDirOf(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = a === '--project' ? argv[i + 1] : (a.startsWith('--project=') ? a.slice('--project='.length) : null);
    if (typeof v !== 'string' || v === '' || v.includes('\0')) continue;
    const abs = path.resolve(process.cwd(), v);
    try { if (fs.statSync(abs).isDirectory()) return abs; } catch (_e) { /* not a path (a slug?): keep the cwd */ }
  }
  return process.cwd();
}

/**
 * True only for the fixture suites of the tools' own source checkout. All must hold:
 * realpath(A1_GATE_LOG_SKIP_ROOT) === realpath(root) === realpath(<this file>/../..) and
 * <root>/_test-fixtures/lib/tmp.sh is a regular file. In a plugin install __dirname is the plugin
 * cache, so the variable is inert in every consumer repo.
 */
function skipRoot(root) {
  const v = process.env.A1_GATE_LOG_SKIP_ROOT;
  if (typeof v !== 'string' || v === '') return false;
  try {
    const want = fs.realpathSync(v);
    const rootReal = fs.realpathSync(root);
    if (want !== rootReal) return false;
    if (rootReal !== fs.realpathSync(path.resolve(__dirname, '..', '..'))) return false;
    return fs.statSync(path.join(rootReal, '_test-fixtures', 'lib', 'tmp.sh')).isFile();
  } catch (_e) { return false; }
}

function recordRun(gateId, scope, exitCode, dir, timing) {
  const ctx = gitContext(dir || process.cwd());
  if (!ctx) {
    process.stderr.write(`gate-log: not inside a git work tree, ${gateId} (exit ${exitCode}) was not logged\n`);
    return;
  }
  // Fixture-only: the suites of the tools' own checkout export A1_GATE_LOG_SKIP_ROOT so their gate calls do
  // not append to that checkout's log. Silent (a1-fix parses 2>&1). A skipped run is invisible to retro
  // validate and the run record (it could mask a later fail after an earlier pass), which is why skipRoot()
  // confines it to the tools' own checkout. pr merge-check does not read the gate log.
  if (skipRoot(ctx.root)) return;
  if (scope === UNSCOPED) {
    process.stderr.write(`gate-log: no --phase given, line goes to .a1/phases/${UNSCOPED}/${LOG_NAME} (pass --phase <scope> at every call site)\n`);
  }
  appendGateLine({
    root: ctx.root, commonDir: ctx.commonDir, scope, gateId, exitCode,
    verdict: verdictForExit(exitCode),
    headSha: git(['rev-parse', 'HEAD'], ctx.root) || 'none',
    startedAt: timing && timing.startedAt,
    durationMs: timing && timing.durationMs,
    extra: timing && timing.extra,
  });
}

/**
 * Facade hook. When argv names a subcommand from a registry `invoke` cell:
 * strip `--phase`, and append one log line when the process exits (not in an
 * intent child: it appends nothing and writes no exclude entry). Any other
 * argv is returned untouched. A logging failure is reported on stderr and
 * never changes the gate's exit code.
 *
 * @param {string[]} argv @param {string} registryText
 * @returns {string[]} argv for the dispatcher
 */
function installGateLog(argv, registryText) {
  let gateId = null;
  try { gateId = matchInvoke(argv, invokeMap(registryText)); } catch (_e) { return argv; }
  if (!gateId) return argv;
  let stripped;
  try {
    stripped = stripPhase(argv);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }
  // Spec 017 Q20: an intent child (same detection as the sandbox guard) writes
  // nothing outside its project, so it appends no line and touches no
  // info/exclude, whatever the exit code (77 included).
  if (require('./intent-child.cjs').inChildMode()) return stripped.argv;
  const scope = stripped.scope || UNSCOPED;
  const dir = projectDirOf(stripped.argv);
  const startedAt = new Date().toISOString();
  const t0 = process.hrtime.bigint();
  hookScope = stripped.scope;
  hookInstalled = true;
  process.on('exit', (code) => {
    const durationMs = Number((process.hrtime.bigint() - t0) / 1000000n);
    const extra = pendingExtra;
    pendingExtra = null;
    try { recordRun(gateId, scope, code, dir, { startedAt, durationMs, extra }); } catch (e) {
      process.stderr.write(`gate-log: could not append the line for ${gateId}: ${e.message}\n`);
    }
  });
  return stripped.argv;
}

module.exports = {
  ZERO_HASH, UNSCOPED, EXCLUDE_PATTERN, SCOPE_RE,
  validateScope, verdictForExit, appendGateLine, verifyChain, verifyChainText, matchInvoke, stripPhase,
  installGateLog, readTrustedChain, setRecordExtra, gitContext, ensureExcluded, projectDirOf, stealStaleLock, assertContained,
  acquireLock, releaseLock, currentScope, logPathFor, readCapped,
};
