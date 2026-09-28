'use strict';

// ---------------------------------------------------------------------------
// intent-run — `a1-tools intent run` (spec 011, Wave 6). Part A (entry
// conditions, 2026-09-28) built the executor-side pieces the spawn stands on;
// part B (after the owner measurements B1/B4/B5/B6, 2026-09-28) adds
// runIntent, the spawn and the CLI:
//
//   writeChildContextLock / removeChildContextLock (FR-047, FR-025)
//     ~/.a1-intents/executor.lock of the passwd home, O_WRONLY|O_CREAT|O_EXCL|
//     O_NOFOLLOW at 0600, exactly the eight LOCK_KEYS; `run` takes it as its
//     first lock, before the project lock, and removes it in `finally` and
//     on process exit. Wave 7 adds the busy semantics (stale reclaim).
//   createRunDir / openRunOutputs / removeRunDir (FR-049)
//     ~/.a1-intents/runs/<id>/ (0700) with stdout.txt, stderr.txt and the
//     before-snapshot (0600, O_EXCL|O_NOFOLLOW); `complete` accepts
//     --stdout/--stderr only there.
//   spawnEnvSecrets (FR-049): every spawn-env value beyond the fixed names
//     of FR-021, for the exact-value redaction of FR-031 (none in v1).
//   guardArgv / guardStageArgv (FR-039), buildArgv, buildEnv: intent-argv.cjs
//     (moved there in part B; the guards are re-exported here unchanged).
//   runIntent / cmdIntentRun (FR-020 to FR-025, FR-043): see the run section.
// ---------------------------------------------------------------------------

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LOCK_KEYS, readLock, lockPath, childDeps } = require('./intent-child.cjs');
const { assertPrivateDir, openPrivate } = require('./intent-devices.cjs');
const { INTENT_ACTIONS } = require('./status-constants.cjs');
const { INTENT_ID_RE, INTENT_CHILD_ENV_NAMES, INTENT_CLAIMED_MAX_BYTES, ACTION_TABLE } = require('./intent-constants.cjs');
const ARGV = require('./intent-argv.cjs');
const { INTENT_PROJECT_SLUG_RE: SLUG_RE } = require('./intent-sandbox.cjs'); // not worktree-registry: it takes execFileSync at load

const LOCK_MODE = 0o600;
const RUNS_DIR = 'runs';
const RUN_DIR_MODE = 0o700;
const RUN_FILE_MODE = 0o600;
const RUN_OUTPUTS = Object.freeze(['stdout.txt', 'stderr.txt']);
const RUN_SNAPSHOT = 'snapshot.json'; // FR-030 before-snapshot, private like the outputs
const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;

const defaultDeps = () => ({
  pid: process.pid,
  hostname: os.hostname,
  now: Date.now,
  homedir: os.homedir,
  passwdHome: () => os.userInfo().homedir,
  getuid: process.getuid,
});

const inputError = (what) => Object.assign(new Error(`intent run: invalid ${what}`), { code: 'A1_INPUT' });

// Review MINOR-3 — every intent command and `run` refuse fail closed when
// $HOME (os.homedir(), where devices, ledger, log, run dir and seal live)
// is not the passwd home (where the lock, the anchor and the read-deny
// rules point). Throws A1_HOME_SPLIT; returns the passwd home's realpath.
function assertHomeConsistent(deps = {}) {
  const d = { ...childDeps(), ...deps };
  const real = (p) => {
    try {
      return d.realpath(p);
    } catch (_e) {
      return null; // a home that does not resolve matches nothing
    }
  };
  const [home, passwd] = [real((d.homedir || os.homedir)()), real(d.passwdHome())];
  if (home === null || home !== passwd) {
    throw Object.assign(new Error(`$HOME (${home}) is not the passwd home (${passwd}); intent commands refuse until they are the same`), { code: 'A1_HOME_SPLIT' });
  }
  return passwd;
}

// ---------- child-context lock (FR-047) ----------

// -> the frozen lock document in LOCK_KEYS order. Throws on a bad context.
function lockDocument(ctx, d) {
  const pid = ctx.pid === undefined ? d.pid : ctx.pid;
  const checks = [
    [Number.isSafeInteger(pid) && pid > 1, 'pid'], [INTENT_ID_RE.test(String(ctx.intent_id)), 'intent_id'],
    [INTENT_ACTIONS.has(ctx.action), 'action'], [SLUG_RE.test(String(ctx.project)), 'project'],
    [typeof ctx.vault_root === 'string' && path.isAbsolute(ctx.vault_root), 'vault_root'],
    [typeof ctx.anchor === 'string' && path.isAbsolute(ctx.anchor), 'anchor'],
  ];
  const bad = checks.find(([ok]) => !ok);
  if (bad) throw inputError(bad[1]);
  const values = [pid, d.hostname(), new Date(d.now()).toISOString(), ctx.intent_id, ctx.action, ctx.project, ctx.vault_root, ctx.anchor];
  return Object.freeze(Object.fromEntries(LOCK_KEYS.map((k, i) => [k, values[i]])));
}

// -> { ok: true, lock, file } | { ok: false, reason: 'executor_busy' } when a
// lock (or a link in its place) already exists.
function writeChildContextLock(ctx, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const doc = lockDocument(ctx, d);
  const file = path.join(assertPrivateDir({ homedir: d.passwdHome }), path.basename(lockPath(d)));
  let fd;
  try {
    fd = fs.openSync(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, LOCK_MODE);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'ELOOP')) return { ok: false, reason: 'executor_busy' };
    throw e;
  }
  try {
    fs.fchmodSync(fd, LOCK_MODE);
    fs.writeSync(fd, `${JSON.stringify(doc)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, lock: doc, file };
}

// Removes the lock only while it still holds exactly `lock` (identity by
// content, never by inode: Linux reuses inode numbers at once).
function removeChildContextLock(lock, deps = {}) {
  const d = { ...defaultDeps(), ...deps, execArgv: [] };
  const now = readLock(d);
  if (!now.present) return { removed: false, why: 'absent' };
  if (now.doc === null || JSON.stringify(now.doc) !== JSON.stringify(lock)) return { removed: false, why: 'not_own_lock' };
  fs.unlinkSync(lockPath(d));
  return { removed: true };
}

// ---------- private run directory (FR-049) ----------

const runsRoot = (d) => path.join(assertPrivateDir({ homedir: d.homedir }), RUNS_DIR);

function sandboxInvalid(detail) {
  return Object.freeze({ ok: false, reason: 'sandbox_invalid', detail });
}

// mkdir 0700 without following a link, then the private-dir check on the
// descriptor. -> null, or why the entry is not such a directory.
function privateSubdir(dir, d) {
  try {
    fs.mkdirSync(dir, { mode: RUN_DIR_MODE });
  } catch (e) {
    if (!e || e.code !== 'EEXIST') return `cannot create (${e && e.code})`;
  }
  try {
    const fd = openPrivate(dir, 'directory', d, (why) => Object.assign(new Error(why), { code: 'A1_RUN_DIR_UNSAFE' }));
    if (fd === null) return 'missing';
    fs.closeSync(fd);
    return null;
  } catch (e) {
    if (e && e.code === 'A1_RUN_DIR_UNSAFE') return e.message;
    throw e;
  }
}

// -> { ok: true, dir } | sandboxInvalid(run_dir_unsafe). The dir of an
// earlier run of the same id is reused only when it is private and empty.
function createRunDir(id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) throw inputError('intent id');
  const root = runsRoot(d);
  const dir = path.join(root, id);
  const why = privateSubdir(root, d) || privateSubdir(dir, d);
  if (why !== null) return sandboxInvalid(`run_dir_unsafe: ${why}`);
  if (fs.readdirSync(dir).length > 0) return sandboxInvalid('run_dir_unsafe: not empty');
  return Object.freeze({ ok: true, dir });
}

// -> { stdout: fd, stderr: fd, paths } — both created O_EXCL|O_NOFOLLOW 0600.
function openRunOutputs(dir) {
  const fds = [];
  try {
    for (const name of RUN_OUTPUTS) {
      const fd = fs.openSync(path.join(dir, name), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, RUN_FILE_MODE);
      fds.push(fd);
      fs.fchmodSync(fd, RUN_FILE_MODE);
    }
  } catch (e) {
    fds.forEach((fd) => fs.closeSync(fd));
    throw e;
  }
  return Object.freeze({ stdout: fds[0], stderr: fds[1], paths: RUN_OUTPUTS.map((n) => path.join(dir, n)) });
}

// FR-049 — `complete` reads --stdout/--stderr only as a regular 0600 file of
// this uid directly inside ~/.a1-intents/runs/<id>/ of the intent's own id,
// every directory on the way opened O_NOFOLLOW and private, the file through
// one O_NOFOLLOW descriptor. -> { ok: true, fd } | { ok: false, why }.
function openRunOutput(file, id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) return { ok: false, why: 'belongs to no intent id' };
  const intents = path.join(d.homedir(), '.a1-intents');
  const dirs = [intents, path.join(intents, RUNS_DIR), path.join(intents, RUNS_DIR, id)];
  if (path.dirname(path.resolve(String(file))) !== dirs[2]) return { ok: false, why: `must lie directly in ~/.a1-intents/${RUNS_DIR}/${id}/` };
  const fail = (why) => Object.assign(new Error(why), { code: 'A1_RUN_DIR_UNSAFE' });
  try {
    for (const dir of dirs) {
      const fd = openPrivate(dir, 'directory', d, fail);
      if (fd === null) return { ok: false, why: 'has no run directory' };
      fs.closeSync(fd);
    }
    const fd = openPrivate(path.resolve(String(file)), 'file', d, fail);
    return fd === null ? { ok: false, why: 'file does not exist' } : { ok: true, fd };
  } catch (e) {
    if (e && e.code === 'A1_RUN_DIR_UNSAFE') return { ok: false, why: `is not a private run file (${e.message})` };
    throw e;
  }
}

// `run` removes the dir after `complete` succeeded; only the two outputs
// and the snapshot.
function removeRunDir(id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) throw inputError('intent id');
  const dir = path.join(runsRoot(d), id);
  for (const name of [...RUN_OUTPUTS, RUN_SNAPSHOT]) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmdirSync(dir);
}

// ---------- spawn-env secrets (FR-049 -> FR-031) ----------

// Values of every env key beyond the fixed names of FR-021.
function spawnEnvSecrets(env) {
  return Object.freeze(Object.entries(env || {})
    .filter(([k, v]) => !INTENT_CHILD_ENV_NAMES.includes(k) && typeof v === 'string' && v.length > 0)
    .map(([, v]) => v));
}

// ---------- run (FR-020 to FR-025, FR-043; spec 011 Wave 6 part B) ----------
//
// runIntent(path) -> Promise<{ exitCode, out, usage?, stderr? }>. Order
// (FR-020): executor host -> claimed/ file (one O_NOFOLLOW read, at most
// INTENT_CLAIMED_MAX_BYTES) -> open ledger row whose claimed_sha256 equals
// those bytes (else `tampered`) -> claimed_by is this host, status claimed
// and no started_at yet -> re-validation (signature, freshness, project) ->
// executor.lock with the child context (FR-025, FR-047) -> project lock
// (FR-024) -> intent worktree for a write action (FR-043) -> private run dir
// (FR-049) -> seal, rewritten skill lists (FR-040, FR-044) -> argv and env ->
// guard (FR-039) -> snapshot -> `running` rewrite + ledger row under one
// ledger lock -> spawn -> await exit -> `complete` (FR-029) in-process.
// A seal or guard failure spawns nothing, leaves started_at unset and
// completes the intent `failed: sandbox_invalid`; a missing binary, an exec
// failure of the spawn (the child's `error` event) or a failed capture of
// its output completes it `failed: spawn_error`. No decision rests on the
// unsigned a1-only keys before the claimed_sha256 check has passed.
// Cleanup (part B review M1): every stop between the worktree creation and
// the spawn that does not complete the intent (a ledger_busy, a tampered
// file, an unsafe run dir, any thrown error) removes the run dir and rolls
// the worktree back, so a retry of the same id starts clean and no entry
// eats the cap. SIGTERM/SIGINT during the run end the child's process group
// and release both locks (review m5); the intent stays claimed with
// started_at set, which a later `run` refuses (already_started) until Wave 7
// expires it.
// Exit: 0 a child ran and `complete` succeeded (whatever the outcome); 1
// nothing ran (refused, rejected, failed before or at the spawn, incl. every
// spawn_error); 2 usage or operator error.
// Wave 7 adds the timeout, the busy semantics of the global lock (stale
// reclaim), the hourly cap and the executor steps.

const RUN_EXIT = Object.freeze({ spawned: 0, notSpawned: 1, operator: 2 });
const OUTPUT_FLAGS = O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW;
const STOP_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
const SEAL_REWRITE = 'row-lists'; // FR-044: B1 WIDENS, a seal without the rewrite is refused

const runDeps = () => {
  const c = childDeps();
  return {
    pid: process.pid, hostname: os.hostname(), now: Date.now, homedir: os.homedir, passwdHome: c.passwdHome,
    realpath: fs.realpathSync.native, env: process.env, vault: process.env.A1_VAULT_ROOT || null,
    user: () => os.userInfo().username, execPath: process.execPath, spawn: childProcess.spawn,
    buildArgv: ARGV.buildArgv, buildStageArgv: ARGV.buildStageArgv, buildEnv: ARGV.buildEnv,
    verifySeal: (o) => require('./intent-seal.cjs').verifySeal(o),
    beforeMarkRunning: () => {}, // fixture seam (library calls only): between the snapshot and the running rewrite
  };
};

const sha256 = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const runOut = (exitCode, out, extra = {}) => Object.freeze({ exitCode, out, ...extra });
const stemOf = (p) => path.basename(String(p), '.md');

// One log line of `run` (FR-033); the decision helpers of intent-lifecycle.
function logRun(d, intentId, outcome, reason, extra = {}) {
  const { logDecision } = require('./intent-log.cjs');
  logDecision({ command: 'run', intentId, outcome, reason, hostname: d.hostname, ...extra }, { homedir: d.homedir, now: d.now });
}

function refuseRun(d, intentId, reason, detail) {
  logRun(d, intentId, 'refused', reason, { detail });
  return runOut(RUN_EXIT.notSpawned, { run: false, reasons: [reason], ...(detail ? { detail } : {}) });
}

// FR-019 via `intent reject`, with the run's own log line naming the part.
function rejectRun(d, loc, intentId, reason, detail) {
  logRun(d, intentId, 'rejected', reason, { detail });
  const r = require('./intent-lifecycle.cjs').rejectIntent(loc.path, reason, { hostname: d.hostname, homedir: d.homedir, now: d.now, vault: d.vault });
  return runOut(r.exitCode === 0 ? RUN_EXIT.notSpawned : r.exitCode, { ...(r.out || {}), run: false, rejected: r.exitCode === 0, reason, ...(detail ? { detail } : {}) });
}

// The claimed file's bytes through one O_NOFOLLOW descriptor, or null when
// it is larger than INTENT_CLAIMED_MAX_BYTES or not a regular file.
function readClaimedFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    if (e && ['ELOOP', 'EMLINK', 'ENOENT'].includes(e.code)) return null;
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > INTENT_CLAIMED_MAX_BYTES) return null;
    const buf = Buffer.alloc(INTENT_CLAIMED_MAX_BYTES + 1);
    let got = 0;
    for (let n = 1; n > 0 && got < buf.length;) {
      n = fs.readSync(fd, buf, got, buf.length - got, null);
      got += n;
    }
    return got > INTENT_CLAIMED_MAX_BYTES ? null : buf.subarray(0, got).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// null when the bytes are the ones recorded at claim time (FR-020).
function tamperDetail(content, row) {
  if (row === null) return 'no_ledger_row';
  if (row.finished_at !== null && row.finished_at !== undefined) return 'row_closed';
  if (content === null) return 'not_readable';
  return sha256(content) === row.claimed_sha256 ? null : 'sha_mismatch';
}

// Host, file, ledger row, hash, claimed_by, not started, re-validation.
// -> { ok: true, … } | { ok: false, result }.
function checkClaimed(filePath, d) {
  const L = require('./intent-lifecycle.cjs');
  const stem = stemOf(filePath);
  const config = L.requireExecutorHost(d);
  if (config === null) return { ok: false, result: refuseRun(d, stem, 'not_executor_host') };
  const loc = L.locateLifecycleFile(filePath, ['claimed'], d.vault);
  if (!loc.ok || loc.missing) return { ok: false, result: runOut(RUN_EXIT.operator, null, { usage: `intent run: ${loc.ok ? 'no such file' : loc.why}` }) };
  const content = readClaimedFile(loc.path);
  const { loadLedger, findRow } = require('./intent-ledger.cjs');
  const row = INTENT_ID_RE.test(stem) ? findRow(loadLedger({ homedir: d.homedir }).rows, stem) : null;
  const tampered = tamperDetail(content, row);
  if (tampered) return { ok: false, result: rejectRun(d, loc, stem, 'tampered', tampered) };
  const { parseIntentFrontmatter, validateIntentFile } = require('./intent-validate.cjs');
  const parsed = parseIntentFrontmatter(content);
  if (!parsed.ok || parsed.fm.id !== stem) return { ok: false, result: rejectRun(d, loc, stem, 'tampered', 'unparsable') };
  const { fm } = parsed;
  if (fm.claimed_by !== d.hostname) return { ok: false, result: refuseRun(d, stem, 'already_claimed', 'claimed_by_other_host') };
  // Review m1 (Samuel): a run that crashed after its running rewrite never runs twice.
  if (fm.status !== 'claimed' || (row.started_at !== null && row.started_at !== undefined)) {
    return { ok: false, result: refuseRun(d, stem, 'already_claimed', 'already_started') };
  }
  const action = ACTION_TABLE[fm.action];
  if (!action || action.kind === 'queue-control') {
    return { ok: false, result: runOut(RUN_EXIT.operator, null, { usage: `intent run: ${fm.action} intents are not run; tick finishes them` }) };
  }
  const v = validateIntentFile(loc.path, {
    readFile: () => content, maxBytes: INTENT_CLAIMED_MAX_BYTES, homedir: d.homedir, now: d.now, executorDevice: config.executor_device,
  });
  if (!v.valid) return { ok: false, result: rejectRun(d, loc, stem, v.reasons[0], v.detail || undefined) };
  return { ok: true, value: Object.freeze({ loc, fm, row: action, content, projectReal: v.realpath, payloadSha256: v.payloadSha256 }) };
}

// First executable `name` on the parent PATH (absolute dirs only), or null.
function which(name, pathVar) {
  for (const dir of String(pathVar || '').split(':').filter((p) => p.startsWith('/'))) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch (_e) {
      // not here: the next PATH entry
    }
  }
  return null;
}

// Empty stdout/stderr in the run dir when nothing ran (complete needs both).
function ensureOutputs(dir) {
  for (const name of RUN_OUTPUTS) {
    try {
      fs.closeSync(fs.openSync(path.join(dir, name), OUTPUT_FLAGS, RUN_FILE_MODE));
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
}

// The run dir goes, whatever is (still) in it: the outputs, the snapshot.
function dropRunDir(ctx, d) {
  if (!ctx.runDir) return;
  try {
    removeRunDir(ctx.fm.id, { homedir: d.homedir });
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }
}

// Review M1 — a stop before the spawn that leaves the intent in claimed/:
// run dir and the worktree this run created go again.
function rollback(ctx, d) {
  dropRunDir(ctx, d);
  if (!ctx.createdWorktree) return;
  const failed = require('./intent-worktree.cjs').rollbackIntentWorktree(
    { project: ctx.fm.project, projectReal: ctx.projectReal, id: ctx.fm.id }, { passwdHome: d.passwdHome, env: d.env },
  );
  if (failed.length > 0) logRun(d, ctx.fm.id, 'error', null, { detail: `worktree rollback incomplete: ${failed.join(',')}` });
}

// `complete` in-process; the run dir goes once it succeeded (FR-049).
function completeRun(ctx, opts, d) {
  const { completeIntent } = require('./intent-result.cjs');
  const [stdoutFile, stderrFile] = RUN_OUTPUTS.map((n) => path.join(ctx.runDir, n));
  const snapshot = path.join(ctx.runDir, RUN_SNAPSHOT);
  const r = completeIntent(ctx.loc.path, {
    stdoutFile, stderrFile, exitCode: opts.exitCode, ...(fs.existsSync(snapshot) ? { snapshotFile: snapshot } : {}),
    ...(opts.failureReason ? { failureReason: opts.failureReason } : {}),
  }, { hostname: d.hostname, homedir: d.homedir, now: d.now, vault: d.vault, envSecrets: opts.env ? spawnEnvSecrets(opts.env) : [] });
  if (r.exitCode === 0) dropRunDir(ctx, d);
  return r;
}

// A seal, guard or binary failure: nothing spawned, started_at unset. When
// `complete` itself refuses (e.g. ledger_busy), the intent stays claimed and
// the run rolls back like any other stop before the spawn.
function failBeforeSpawn(ctx, failure, d) {
  logRun(d, ctx.fm.id, 'failed', failure.reason, { detail: failure.detail, ...(failure.argv ? { argv: failure.argv } : {}) });
  ensureOutputs(ctx.runDir);
  const r = completeRun(ctx, { exitCode: null, failureReason: failure.reason }, d);
  if (r.exitCode !== 0) rollback(ctx, d);
  const out = r.out ? { ...r.out, run: false, detail: failure.detail } : { run: false, failure_reason: failure.reason, detail: failure.detail };
  return runOut(r.exitCode === 0 ? RUN_EXIT.notSpawned : r.exitCode, out, r.usage ? { usage: r.usage } : {});
}

// FR-030 before-snapshot of project/<slug>/ into the private run dir.
function writeSnapshot(ctx, d) {
  const { snapshotProject } = require('./intent-result.cjs');
  const text = JSON.stringify(snapshotProject(ctx.fm.project, { vault: d.vault }));
  const fd = fs.openSync(path.join(ctx.runDir, RUN_SNAPSHOT), OUTPUT_FLAGS, RUN_FILE_MODE);
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

// FR-020 — status running + started_at, and the row's started_at and
// claimed_sha256 of the rewritten bytes, under ONE ledger lock. -> null or a detail.
function markRunning(ctx, d) {
  const { withLedgerLock, loadLedger, findRow, updateRow, writeLedger } = require('./intent-ledger.cjs');
  const { rewriteFrontmatter } = require('./intent-lifecycle.cjs');
  const { writeTextAtomic } = require('./io.cjs');
  return withLedgerLock(() => {
    const { rows } = loadLedger({ homedir: d.homedir });
    const detail = tamperDetail(readClaimedFile(ctx.loc.path), findRow(rows, ctx.fm.id));
    if (detail) return detail;
    const startedAt = new Date(d.now()).toISOString();
    const text = rewriteFrontmatter(ctx.content, { status: 'running', started_at: startedAt });
    writeTextAtomic(ctx.loc.path, text);
    writeLedger(updateRow(rows, ctx.fm.id, { started_at: startedAt, claimed_sha256: sha256(text) }), { homedir: d.homedir });
    return null;
  }, { homedir: d.homedir, hostname: d.hostname, now: d.now });
}

// argv + env for the row, then the guard. -> { ok: true, cmd, argv, env }
// | { ok: false, reason, detail, argv }. `stage` needs no git on PATH (m7).
function prepareSpawn(ctx, seal, d) {
  const home = d.realpath(d.passwdHome());
  const claude = ctx.row.kind === 'claude';
  const bins = { node: d.execPath, claude: claude ? which('claude', d.env.PATH) : null, git: claude ? which('git', d.env.PATH) : null };
  const env = d.buildEnv(d.env, {
    home, user: d.user(), vaultRoot: d.realpath(d.vault), action: ctx.fm.action, project: ctx.fm.project, id: ctx.fm.id,
  }, [bins.node, bins.claude, bins.git]);
  if (!claude) {
    const built = d.buildStageArgv(ctx.fm.target, seal);
    const at = ctx.fm.target.lastIndexOf(':');
    const guard = ARGV.guardStageArgv(built.argv, {
      sealDir: built.sealDir, featureId: ctx.fm.target.slice(0, at), stage: ctx.fm.target.slice(at + 1), env, realpath: d.realpath,
    });
    if (!guard.ok) return { ok: false, reason: 'sandbox_invalid', detail: `guard: ${guard.rule}`, argv: built.argv };
    return { ok: true, cmd: d.execPath, argv: built.argv, env };
  }
  const primary = ctx.write ? ctx.projectReal : null;
  const built = d.buildArgv(ctx.row, ctx.fm.target, seal, { cwd: ctx.cwd, passwdHome: home, primary });
  const prompt = ctx.row.prompt.replace('{target}', ctx.fm.target === undefined ? '' : ctx.fm.target);
  const guard = ARGV.guardArgv(built.argv, {
    row: ctx.row.row, sealDir: built.sealDir, emptyMcpPath: built.emptyMcpPath, payload: ctx.fm.payload, prompt,
    denyRules: built.denyRules, env, cwd: ctx.cwd, passwdHome: home, primary, realpath: d.realpath,
  });
  if (!guard.ok) return { ok: false, reason: 'sandbox_invalid', detail: `guard: ${guard.rule}`, argv: built.argv };
  const missing = [['claude', bins.claude], ['git', bins.git]].find(([, p]) => !p);
  if (missing) return { ok: false, reason: 'spawn_error', detail: `${missing[0]} not found on PATH`, argv: built.argv };
  return { ok: true, cmd: bins.claude, argv: built.argv, env };
}

// Writes into a run-dir output; a failure is recorded, never thrown out of
// an event handler (review m5).
function capture(fd, state) {
  return (b) => {
    try {
      fs.writeSync(fd, b);
    } catch (e) {
      state.outputError = state.outputError || (e && e.code) || 'write_failed';
    }
  };
}

// FR-021 — spawn, payload on stdin, outputs into the run dir; resolves on
// close (or on the error event). `live.child` names the child for the stop
// signals. -> { code, signal } | { error } (+ outputError).
function spawnChild(ctx, sp, live, d) {
  const fds = openRunOutputs(ctx.runDir);
  const state = { outputError: null };
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      live.child = null;
      [fds.stdout, fds.stderr].forEach((fd) => fs.closeSync(fd));
      resolve({ ...r, outputError: state.outputError });
    };
    let child;
    try {
      child = d.spawn(sp.cmd, [...sp.argv], { cwd: ctx.cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...sp.env } });
    } catch (e) {
      done({ error: e });
      return;
    }
    live.child = child;
    child.on('error', (e) => done({ error: e }));
    child.stdout.on('data', capture(fds.stdout, state));
    child.stderr.on('data', capture(fds.stderr, state));
    child.stdin.on('error', () => {}); // a child that never reads stdin closes it early (EPIPE)
    child.stdin.end(String(ctx.fm.payload));
    child.on('close', (code, signal) => done({ code, signal }));
  });
}

const exitCodeOf = (r) => {
  if (Number.isInteger(r.code)) return r.code;
  const n = r.signal ? os.constants.signals[r.signal] : undefined;
  return Number.isInteger(n) ? 128 + n : 1;
};

// Everything from the run dir to the running rewrite; any stop that does
// not complete the intent rolls back. -> { ctx, sp, seal } | { result }.
function prepareRun(ctx0, d) {
  let ctx = ctx0;
  try {
    const dir = createRunDir(ctx.fm.id, { homedir: d.homedir });
    if (!dir.ok) {
      rollback(ctx, d);
      logRun(d, ctx.fm.id, 'error', 'sandbox_invalid', { detail: dir.detail });
      return { result: runOut(RUN_EXIT.operator, null, { stderr: `intent run: ${dir.detail}` }) };
    }
    ctx = Object.freeze({ ...ctx, runDir: dir.dir });
    const seal = d.verifySeal({ homedir: d.homedir });
    if (!seal.ok) return { result: failBeforeSpawn(ctx, { reason: 'sandbox_invalid', detail: seal.detail }, d) };
    if (seal.skillRewrite !== SEAL_REWRITE) return { result: failBeforeSpawn(ctx, { reason: 'sandbox_invalid', detail: 'seal_rewrite_off' }, d) };
    let sp;
    try {
      sp = prepareSpawn(ctx, seal, d);
    } catch (e) {
      sp = { ok: false, reason: 'sandbox_invalid', detail: `build: ${String(e && e.message).slice(0, 120)}` };
    }
    if (!sp.ok) return { result: failBeforeSpawn(ctx, sp, d) };
    writeSnapshot(ctx, d);
    d.beforeMarkRunning(ctx);
    const tampered = markRunning(ctx, d);
    if (tampered) {
      rollback(ctx, d);
      return { result: rejectRun(d, ctx.loc, ctx.fm.id, 'tampered', tampered) };
    }
    return { ctx, sp, seal };
  } catch (e) {
    rollback(ctx, d);
    throw e;
  }
}

// Everything under the two locks.
async function runLocked(ctx0, live, d) {
  let ctx = ctx0;
  if (ctx.write) {
    const { createIntentWorktree } = require('./intent-worktree.cjs');
    const wt = createIntentWorktree({ project: ctx.fm.project, projectReal: ctx.projectReal, id: ctx.fm.id, action: ctx.fm.action },
      { passwdHome: d.passwdHome, env: d.env, now: d.now });
    if (!wt.ok) return rejectRun(d, ctx.loc, ctx.fm.id, wt.reason, wt.detail);
    ctx = Object.freeze({ ...ctx, createdWorktree: true });
  }
  const p = prepareRun(ctx, d);
  if (p.result) return p.result;
  const { INTENT_CHILD_SYSTEM_PROMPT_VERSION } = require('./intent-constants.cjs');
  logRun(d, p.ctx.fm.id, 'spawned', null, {
    argv: [p.sp.cmd, ...p.sp.argv], envNames: Object.keys(p.sp.env), payloadSha256: p.ctx.payloadSha256,
    promptVersion: INTENT_CHILD_SYSTEM_PROMPT_VERSION, sealRootSha256: p.seal.rootSha,
  });
  const r = await spawnChild(p.ctx, p.sp, live, d);
  if (r.outputError) logRun(d, p.ctx.fm.id, 'failed', 'spawn_error', { detail: `output_capture_failed: ${r.outputError}` });
  const failed = r.error || r.outputError;
  const result = completeRun(p.ctx, failed ? { exitCode: null, failureReason: 'spawn_error', env: p.sp.env } : { exitCode: exitCodeOf(r), env: p.sp.env }, d);
  const code = r.error ? RUN_EXIT.notSpawned : RUN_EXIT.spawned; // review m2: an exec failure ran nothing, like a missing binary
  return runOut(result.exitCode === 0 ? code : result.exitCode, result.out ? { ...result.out, run: !r.error } : null,
    result.usage ? { usage: result.usage } : {});
}

// Review m5 — SIGTERM/SIGINT while `run` holds its locks: the child's
// process group gets SIGTERM, both locks go, the process exits 128+signo.
function onStopSignals(release, live) {
  const handlers = STOP_SIGNALS.map((sig) => {
    const h = () => {
      if (live.child && live.child.pid) {
        try {
          process.kill(-live.child.pid, 'SIGTERM');
        } catch (_e) {
          // the group is gone already
        }
      }
      release();
      process.exit(128 + os.constants.signals[sig]);
    };
    process.once(sig, h);
    return [sig, h];
  });
  return () => handlers.forEach(([sig, h]) => process.removeListener(sig, h));
}

// Executor lock (child context) -> project lock -> runLocked; both released
// on every path, the executor lock also on process exit and on the stop
// signals (FR-025, FR-047).
async function runWithLocks(pre, d) {
  const { INTENT_WRITE_ACTIONS } = require('./intent-constants.cjs');
  const { expectedIntentWorktree } = require('./intent-worktree.cjs');
  const write = INTENT_WRITE_ACTIONS.includes(pre.fm.action);
  const cwd = write ? expectedIntentWorktree(pre.fm.project, pre.fm.id, { passwdHome: d.passwdHome }) : pre.projectReal;
  const ctx = Object.freeze({ ...pre, write, cwd });
  const exec = writeChildContextLock({
    intent_id: ctx.fm.id, action: ctx.fm.action, project: ctx.fm.project, vault_root: d.realpath(d.vault), anchor: ctx.cwd,
  }, { pid: d.pid, hostname: () => d.hostname, now: d.now, passwdHome: d.passwdHome });
  if (!exec.ok) return refuseRun(d, ctx.fm.id, 'executor_busy');
  const { acquireProjectLock, releaseOwnedLock } = require('./intent-ledger.cjs');
  const locks = { project: null };
  const release = () => {
    if (locks.project) releaseOwnedLock(locks.project);
    locks.project = null;
    removeChildContextLock(exec.lock, { passwdHome: d.passwdHome, hostname: () => d.hostname });
  };
  const live = { child: null };
  const unhook = onStopSignals(release, live);
  process.once('exit', release);
  try {
    locks.project = acquireProjectLock(ctx.fm.project, ctx.fm.id, { homedir: d.homedir, hostname: d.hostname, now: d.now, pid: d.pid });
    if (locks.project === null) return refuseRun(d, ctx.fm.id, 'project_busy');
    return await runLocked(ctx, live, d);
  } finally {
    unhook();
    process.removeListener('exit', release);
    release();
  }
}

// FR-020 -> Promise<{ exitCode, out, usage?, stderr? }>.
async function runIntent(filePath, deps = {}) {
  const d = { ...runDeps(), ...deps };
  const L = require('./intent-lifecycle.cjs');
  const stem = stemOf(filePath);
  try {
    if (!d.vault) return runOut(RUN_EXIT.operator, null, { usage: 'intent run: A1_VAULT_ROOT is not set' });
    const pre = checkClaimed(filePath, d);
    if (!pre.ok) return pre.result;
    return await runWithLocks(pre.value, d);
  } catch (e) {
    if (e && e.code === 'A1_LEDGER_BUSY') return refuseRun(d, stem, 'ledger_busy');
    if (e && e.code === 'A1_LEDGER_UNREADABLE') return refuseRun(d, stem, 'ledger_unreadable');
    return L.decideError(d, 'run', stem, e);
  }
}

// `a1-tools intent run <path>`
function cmdIntentRun(args) {
  const { emit } = require('./intent-lifecycle.cjs');
  if (args.length !== 1 || String(args[0]).startsWith('-')) {
    return emit(runOut(RUN_EXIT.operator, null, { usage: 'intent run <path> (exactly one claimed/ intent file)' }));
  }
  return runIntent(args[0]).then(emit, (e) => {
    process.stderr.write(`internal error: ${e && e.message}\n`);
    process.exitCode = RUN_EXIT.operator;
  });
}

module.exports = {
  assertHomeConsistent,
  CLAUDE_TEMPLATE_FLAGS: ARGV.CLAUDE_TEMPLATE_FLAGS, // moved to intent-argv.cjs in part B; re-exported unchanged
  guardArgv: ARGV.guardArgv,
  guardStageArgv: ARGV.guardStageArgv,
  runIntent,
  cmdIntentRun,
  writeChildContextLock,
  removeChildContextLock,
  createRunDir,
  openRunOutputs,
  openRunOutput,
  removeRunDir,
  spawnEnvSecrets,
  RUN_OUTPUTS,
};
