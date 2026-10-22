'use strict';

// ---------------------------------------------------------------------------
// gate-log — append-only, hash-chained log of gate firings (spec 017, Wave 2,
// FR-008 / FR-010). Contract: docs/adr/2026-10-14-gate-invoke-and-log.md §2.
//
// One JSON line per invocation of a subcommand named in a registry `invoke`
// cell, appended to <repo>/.a1/phases/<scope>/gate-log.jsonl:
//   {ts, gate, verdict, exit, head_sha, scope, prev}
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
      prev: prevLine === null ? ZERO_HASH : sha256(prevLine),
    };
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
  return null;
}

/**
 * Check shape of every line and the hash chain.
 *
 * @param {string} file
 * @returns {{ok: boolean, lines: number, records: Object[], problems: {line: number, rule: string, reason: string}[]}}
 */
function verifyChain(file) {
  const text = fs.readFileSync(file, 'utf8');
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

function recordRun(gateId, scope, exitCode, dir) {
  const ctx = gitContext(dir || process.cwd());
  if (!ctx) {
    process.stderr.write(`gate-log: not inside a git work tree, ${gateId} (exit ${exitCode}) was not logged\n`);
    return;
  }
  if (scope === UNSCOPED) {
    process.stderr.write(`gate-log: no --phase given, line goes to .a1/phases/${UNSCOPED}/${LOG_NAME} (pass --phase <scope> at every call site)\n`);
  }
  appendGateLine({
    root: ctx.root, commonDir: ctx.commonDir, scope, gateId, exitCode,
    verdict: verdictForExit(exitCode),
    headSha: git(['rev-parse', 'HEAD'], ctx.root) || 'none',
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
  process.on('exit', (code) => {
    try { recordRun(gateId, scope, code, dir); } catch (e) {
      process.stderr.write(`gate-log: could not append the line for ${gateId}: ${e.message}\n`);
    }
  });
  return stripped.argv;
}

module.exports = {
  ZERO_HASH, UNSCOPED, EXCLUDE_PATTERN, SCOPE_RE,
  validateScope, verdictForExit, appendGateLine, verifyChain, matchInvoke, stripPhase,
  installGateLog, gitContext, ensureExcluded, projectDirOf, stealStaleLock, assertContained,
};
