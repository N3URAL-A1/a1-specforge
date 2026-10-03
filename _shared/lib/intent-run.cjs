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

const { childDeps, writeChildContextLock, removeChildContextLock } = require('./intent-child.cjs');
const { assertPrivateDir, openPrivate } = require('./intent-devices.cjs');
const {
  INTENT_ID_RE, INTENT_CHILD_ENV_NAMES, INTENT_CLAIMED_MAX_BYTES, ACTION_TABLE, INTENT_TIMEOUT_MS, INTENT_KILL_GRACE_MS, INTENT_MAX_RUNS_PER_HOUR,
} = require('./intent-constants.cjs');
const ARGV = require('./intent-argv.cjs');
const { createBudget, withinBudget, spawnChild, exitCodeOf, onStopSignals, killGroupSync } = require('./intent-spawn.cjs');
const { runPreSteps, runPostSteps } = require('./intent-steps.cjs');

const RUNS_DIR = 'runs';
const RUN_DIR_MODE = 0o700;
const RUN_FILE_MODE = 0o600;
const RUN_OUTPUTS = Object.freeze(['stdout.txt', 'stderr.txt']);
const RUN_SNAPSHOT = 'snapshot.json'; // FR-030 before-snapshot, private like the outputs
const RUN_MARKERS = Object.freeze(['child.json']); // Wave 7: the child's group (intent-spawn); a cancel request lies beside the dir (runs/<id>.cancel)
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

// ---------- child-context lock (FR-047): intent-child.cjs ----------
// writeChildContextLock / removeChildContextLock moved to intent-child.cjs
// (Wave 7 review n2: the lock's writer next to its reader); re-exported below.

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

// `run` removes the dir after `complete` succeeded; only the two outputs,
// the snapshot and the Wave 7 markers.
function removeRunDir(id, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!INTENT_ID_RE.test(String(id))) throw inputError('intent id');
  const dir = path.join(runsRoot(d), id);
  for (const name of [...RUN_OUTPUTS, RUN_SNAPSHOT, ...RUN_MARKERS]) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmdirSync(dir);
}

// ---------- spawn-env secrets (FR-049 -> FR-031) ----------

// Values of every env key beyond the fixed names of FR-021.
function spawnEnvSecrets(env) {
  return Object.freeze(Object.entries(env || {})
    .filter(([k, v]) => !INTENT_CHILD_ENV_NAMES.includes(k) && typeof v === 'string' && v.length > 0)
    .map(([, v]) => v));
}

// ---------- run (FR-020 to FR-028, FR-043, FR-051; spec 011 Waves 6B and 7) ----------
//
// runIntent(path) -> Promise<{ exitCode, out, usage?, stderr? }>. Order
// (FR-020): executor host -> claimed/ file (one O_NOFOLLOW read, at most
// INTENT_CLAIMED_MAX_BYTES) -> open ledger row whose claimed_sha256 equals
// those bytes (else `tampered`) -> claimed_by is this host, status claimed
// and no started_at yet -> expiry (FR-028: claimed more than
// INTENT_CLAIMED_MAX_AGE_MS ago -> failed: expired, never run) ->
// re-validation (signature, project; freshness was judged at claim time) ->
// executor.lock with the child context (FR-025, FR-047; always first, then
// the project lock: one fixed order, no lock-order inversion) -> hourly cap
// (FR-026: rows started in the trailing hour >= INTENT_MAX_RUNS_PER_HOUR ->
// rate_limited, nothing moves) -> project lock (FR-024) -> intent worktree
// for a write action (FR-043) -> private run dir (FR-049) -> seal,
// rewritten skill lists (FR-040, FR-044) -> argv and env -> guard (FR-039)
// -> the fix pre-step (FR-051) -> snapshot -> `running` rewrite + ledger row
// under one ledger lock -> spawn inside the time budget (FR-027) -> post-
// steps inside the same budget (FR-051) -> `complete` (FR-029) in-process.
// A seal or guard failure spawns nothing, leaves started_at unset (so it
// never counts toward the cap) and completes the intent `failed:
// sandbox_invalid`; a failed pre-step likewise with parent_step_failed. A
// missing binary, an exec failure of the spawn or a failed capture of its
// output completes it `failed: spawn_error`. First failure wins: timeout,
// cancelled (a cancel marker in the run dir, FR-028) or nonzero_exit of the
// child is never overwritten by a post-step. No decision rests on the
// unsigned a1-only keys before the claimed_sha256 check has passed.
// Cleanup (part B review M1): every stop between the worktree creation and
// the spawn that does not complete the intent (a ledger_busy, a tampered
// file, an unsafe run dir, any thrown error, a stop signal) removes the run
// dir and rolls the worktree back; a rollback that fails is named in the
// detail and never replaces the original error. SIGTERM/SIGINT during the
// run end the child's process group with the FR-027 sequence before both
// locks are released.
// Exit: 0 a child ran and `complete` succeeded (whatever the outcome); 1
// nothing ran (refused, rejected, expired, failed before or at the spawn,
// incl. every spawn_error); 2 usage or operator error.

const RUN_EXIT = Object.freeze({ spawned: 0, notSpawned: 1, operator: 2 });
const OUTPUT_FLAGS = O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW;
const SEAL_REWRITE = 'row-lists'; // FR-044: B1 WIDENS, a seal without the rewrite is refused
const HOUR_MS = 3600 * 1000;

const runDeps = () => {
  const c = childDeps();
  return {
    pid: process.pid, hostname: os.hostname(), now: Date.now, homedir: os.homedir, passwdHome: c.passwdHome,
    realpath: fs.realpathSync.native, env: process.env, vault: process.env.A1_VAULT_ROOT || null,
    user: () => os.userInfo().username, execPath: process.execPath, spawn: childProcess.spawn,
    buildArgv: ARGV.buildArgv, buildStageArgv: ARGV.buildStageArgv, buildEnv: ARGV.buildEnv,
    verifySeal: (o) => require('./intent-seal.cjs').verifySeal(o),
    kill: (target, sig) => process.kill(target, sig), // FR-027 group signals (fixture seam)
    // Executor steps (FR-051): undefined -> the defaults of intent-steps.cjs.
    integrityCheck: undefined, xprovGate: undefined, writePostmortem: undefined,
    beforeMarkRunning: () => {}, // fixture seam (library calls only): between the snapshot and the running rewrite
    beforeSpawn: () => {}, // fixture seam (library calls only): between the running rewrite and the spawn
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
function rejectRun(d, loc, intentId, reason, detail, cancelledBy = null) {
  logRun(d, intentId, 'rejected', reason, { detail });
  const r = require('./intent-lifecycle.cjs').rejectIntent(loc.path, reason, { hostname: d.hostname, homedir: d.homedir, now: d.now, vault: d.vault }, cancelledBy);
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

// FR-028 cancel marker ~/.a1-intents/runs/<id>.cancel (intent-lifecycle
// cancelRunning): the cancel intent's id, or null.
const cancelPath = (id, d) => path.join(d.homedir(), '.a1-intents', RUNS_DIR, `${id}.cancel`);
function readCancel(id, d) {
  try {
    const text = fs.readFileSync(cancelPath(id, d), 'utf8').trim();
    return INTENT_ID_RE.test(text) ? text : '';
  } catch (_e) {
    return null;
  }
}
const dropCancel = (id, d) => fs.rmSync(cancelPath(id, d), { force: true });

// null when the bytes are the ones recorded at claim time (FR-020).
function tamperDetail(content, row) {
  if (row === null) return 'no_ledger_row';
  if (row.finished_at !== null && row.finished_at !== undefined) return 'row_closed';
  if (content === null) return 'not_readable';
  return sha256(content) === row.claimed_sha256 ? null : 'sha_mismatch';
}

// FR-028 — never run (again): complete it failed: expired. A run dir left by
// a run that stopped after its running rewrite is taken over: its known
// files go first (review W7-M1); an unknown file keeps it refused.
function expireRun(loc, stem, d) {
  logRun(d, stem, 'failed', 'expired');
  dropCancel(stem, d);
  try {
    removeRunDir(stem, { homedir: d.homedir });
  } catch (e) {
    if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTEMPTY')) throw e;
  }
  const dir = createRunDir(stem, { homedir: d.homedir });
  if (!dir.ok) return runOut(RUN_EXIT.operator, null, { stderr: `intent run: ${dir.detail}` });
  const ctx = Object.freeze({ loc, runDir: dir.dir, fm: { id: stem } });
  ensureOutputs(dir.dir);
  const r = completeRun(ctx, { exitCode: null, failureReason: 'expired' }, d);
  return runOut(r.exitCode === 0 ? RUN_EXIT.notSpawned : r.exitCode, r.out ? { ...r.out, run: false } : null, r.usage ? { usage: r.usage } : {});
}

// Host, file, ledger row, hash, claimed_by, not started, expiry, re-validation.
// -> { ok: true, value } | { ok: false, result }.
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
  // Review m1 (Samuel): a run that crashed after its running rewrite never
  // runs twice; review W7-M1/n1: it still expires. Both are judged under the
  // executor lock (runWithLocks), so a run in progress is never expired.
  const started = fm.status !== 'claimed' || (row.started_at !== null && row.started_at !== undefined);
  const action = ACTION_TABLE[fm.action];
  if (!action || action.kind === 'queue-control') {
    return { ok: false, result: runOut(RUN_EXIT.operator, null, { usage: `intent run: ${fm.action} intents are not run; tick finishes them` }) };
  }
  if (started) return { ok: true, value: Object.freeze({ loc, fm, row: action, started, claimedAt: row.claimed_at }) };
  const v = validateIntentFile(loc.path, {
    readFile: () => content, maxBytes: INTENT_CLAIMED_MAX_BYTES, homedir: d.homedir, now: d.now, executorDevice: config.executor_device, skipFreshness: true,
  });
  if (!v.valid) return { ok: false, result: rejectRun(d, loc, stem, v.reasons[0], v.detail || undefined) };
  return { ok: true, value: Object.freeze({ loc, fm, row: action, content, projectReal: v.realpath, payloadSha256: v.payloadSha256, started, claimedAt: row.claimed_at }) };
}

// FR-026 — ledger rows whose started_at lies in the trailing hour, or in
// the future (a clock set back must not reopen the cap; W7 security). Pure.
function countRunsInWindow(rows, nowMs) {
  return rows.filter((r) => {
    const t = Date.parse(String(r && r.started_at));
    return Number.isFinite(t) && nowMs - t < HOUR_MS;
  }).length;
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

// Everything from the run dir to the running rewrite; any stop that does
// not complete the intent rolls back, and a rollback that fails is named in
// the detail, never in place of the original error. live.rollback covers a
// stop signal that arrives while this runs (review r1).
// -> { ctx, sp, seal } | { result }.
async function prepareRun(ctx0, live, d) {
  let ctx = ctx0;
  live.rollback = () => rollback(ctx, d);
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
    const pre = await runPreSteps(ctx, d, (detail, reason) => logRun(d, ctx.fm.id, 'step', null, { detail: reason ? `${detail} (${reason})` : detail }));
    if (pre) return { result: failBeforeSpawn(ctx, { ...pre, argv: sp.argv }, d) };
    writeSnapshot(ctx, d);
    await d.beforeMarkRunning(ctx);
    const cancelId = readCancel(ctx.fm.id, d); // review m2: a cancel before started_at rejects
    if (cancelId !== null) {
      rollback(ctx, d);
      dropCancel(ctx.fm.id, d);
      return { result: rejectRun(d, ctx.loc, ctx.fm.id, 'cancelled_by_user', 'cancelled_before_start', cancelId || null) };
    }
    const tampered = markRunning(ctx, d);
    if (tampered) {
      rollback(ctx, d);
      return { result: rejectRun(d, ctx.loc, ctx.fm.id, 'tampered', tampered) };
    }
    // Review W7-M1: from here on a stop signal completes the intent.
    live.complete = () => completeRun(ctx, { exitCode: null, failureReason: 'cancelled' }, d);
    return { ctx, sp, seal };
  } catch (e) {
    throw withRollback(e, ctx, d);
  } finally {
    live.rollback = null;
  }
}

// Review NIT: the original error stays; a rollback failure becomes its detail.
function withRollback(e, ctx, d) {
  try {
    rollback(ctx, d);
  } catch (re) {
    if (e && typeof e === 'object') e.rollbackDetail = `rollback failed: ${String(re && (re.code || re.message)).slice(0, 80)}`;
  }
  return e;
}

// The child's own failure reason (FR-027, FR-028, FR-021), or null.
function childFailureOf(r, ctx, d) {
  if (r.timedOut) return 'timeout';
  if (readCancel(ctx.fm.id, d) !== null) return 'cancelled';
  if (r.error || r.outputError) return 'spawn_error';
  return exitCodeOf(r) === 0 ? null : 'nonzero_exit';
}

// Review m1, S-MAJOR-1: a pending timeout kill ends first, then every
// tracked group still alive gets the sequence; nothing of them outlives run.
async function reapGroups(ctx, budget, d) {
  await budget.settle();
  budget.reapSync((pgid) => logRun(d, ctx.fm.id, 'step', null, { detail: `leftover group -${pgid} killed` }));
}

// Spawn inside the budget, then the post-steps inside the same budget;
// first failure wins (FR-051). -> { failure, exitCode, r }.
async function spawnAndSteps(ctx, sp, live, budget, d) {
  // review m2: a cancel that came between the marker check and the spawn ends the child at once
  const afterSpawn = (pid) => { if (readCancel(ctx.fm.id, d) !== null) killGroupSync(pid, INTENT_KILL_GRACE_MS, { kill: d.kill }); };
  const r = await spawnChild(ctx, sp, live, budget, d, afterSpawn);
  await reapGroups(ctx, budget, d);
  if (r.outputError) logRun(d, ctx.fm.id, 'failed', 'spawn_error', { detail: `output_capture_failed: ${r.outputError}` });
  const childFailure = childFailureOf(r, ctx, d);
  const exitCode = r.error ? null : exitCodeOf(r);
  if (childFailure === 'timeout' || childFailure === 'cancelled' || r.error) return { failure: childFailure, exitCode, r };
  const log = (detail, reason) => logRun(d, ctx.fm.id, 'step', null, { detail: reason ? `${detail} (${reason})` : detail });
  const post = await withinBudget(budget, runPostSteps(ctx, childFailure, budget, d, log));
  if (post.timedOut) return { failure: childFailure || 'timeout', exitCode, r };
  if (post.value && !childFailure) logRun(d, ctx.fm.id, 'failed', 'parent_step_failed', { detail: post.value.detail });
  return { failure: childFailure || (post.value ? post.value.reason : null), exitCode, r };
}

// S-MAJOR-2 — a cancel marker found after the running rewrite but before
// the spawn: completed failed: cancelled, nothing spawned.
function cancelBeforeSpawn(ctx, sp, live, d) {
  live.complete = null;
  logRun(d, ctx.fm.id, 'failed', 'cancelled', { detail: 'cancelled_before_spawn' });
  ensureOutputs(ctx.runDir);
  const r = completeRun(ctx, { exitCode: null, failureReason: 'cancelled', env: sp.env }, d);
  dropCancel(ctx.fm.id, d);
  return runOut(r.exitCode === 0 ? RUN_EXIT.notSpawned : r.exitCode, r.out ? { ...r.out, run: false } : null, r.usage ? { usage: r.usage } : {});
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
  const p = await prepareRun(ctx, live, d);
  if (p.result) return p.result;
  await d.beforeSpawn(p.ctx);
  if (readCancel(p.ctx.fm.id, d) !== null) return cancelBeforeSpawn(p.ctx, p.sp, live, d); // S-MAJOR-2
  const { INTENT_CHILD_SYSTEM_PROMPT_VERSION } = require('./intent-constants.cjs');
  logRun(d, p.ctx.fm.id, 'spawned', null, {
    argv: [p.sp.cmd, ...p.sp.argv], envNames: Object.keys(p.sp.env), payloadSha256: p.ctx.payloadSha256,
    promptVersion: INTENT_CHILD_SYSTEM_PROMPT_VERSION, sealRootSha256: p.seal.rootSha,
  });
  const budget = createBudget({
    timeoutMs: INTENT_TIMEOUT_MS, graceMs: INTENT_KILL_GRACE_MS, now: d.now, kill: d.kill,
    onSignal: (sig, target) => logRun(d, p.ctx.fm.id, 'timeout', null, { detail: `kill ${sig} ${target}` }),
  });
  live.budget = budget; // S-MAJOR-4: the stop signals reap the post-steps' groups too
  const o = await spawnAndSteps(p.ctx, p.sp, live, budget, d);
  await reapGroups(p.ctx, budget, d); // S-MAJOR-1: every path, before complete and release
  live.complete = null; // the normal path completes below
  dropCancel(p.ctx.fm.id, d);
  const opts = o.failure === null || (o.failure === 'nonzero_exit' && o.exitCode !== null)
    ? { exitCode: o.exitCode, env: p.sp.env } : { exitCode: o.exitCode, failureReason: o.failure, env: p.sp.env };
  const result = completeRun(p.ctx, opts, d);
  const code = o.r.error ? RUN_EXIT.notSpawned : RUN_EXIT.spawned; // review m2: an exec failure ran nothing, like a missing binary
  return runOut(result.exitCode === 0 ? code : result.exitCode, result.out ? { ...result.out, run: !o.r.error } : null,
    result.usage ? { usage: result.usage } : {});
}

// Executor lock (child context) -> hourly cap -> project lock -> runLocked;
// both locks released on every path, also on process exit and on the stop
// signals, which first end the child's group (FR-025, FR-027, FR-047).
async function runWithLocks(pre, d) {
  const { INTENT_WRITE_ACTIONS } = require('./intent-constants.cjs');
  const { expectedIntentWorktree } = require('./intent-worktree.cjs');
  const write = INTENT_WRITE_ACTIONS.includes(pre.fm.action);
  // A started intent skipped the re-validation (it is only expired or
  // refused here), so it has no projectReal: its lock names the plain path.
  const project = pre.projectReal || path.join(d.realpath(d.passwdHome()), 'claude-projects', pre.fm.project);
  const cwd = write ? expectedIntentWorktree(pre.fm.project, pre.fm.id, { passwdHome: d.passwdHome }) : project;
  const ctx = Object.freeze({ ...pre, write, cwd });
  const exec = writeChildContextLock({
    intent_id: ctx.fm.id, action: ctx.fm.action, project: ctx.fm.project, vault_root: d.realpath(d.vault), anchor: ctx.cwd,
  }, { pid: d.pid, hostname: () => d.hostname, now: d.now, passwdHome: d.passwdHome });
  if (!exec.ok) return refuseRun(d, ctx.fm.id, 'executor_busy');
  const { acquireProjectLock, releaseOwnedLock, loadLedger } = require('./intent-ledger.cjs');
  const locks = { project: null };
  const release = () => {
    if (locks.project) releaseOwnedLock(locks.project);
    locks.project = null;
    removeChildContextLock(exec.lock, { passwdHome: d.passwdHome, hostname: () => d.hostname });
  };
  // Deliberate shared state (review n3): the stop-signal handler reads what
  // the run has reached (its child, a rollback before the running rewrite, a
  // completion after it).
  const live = { child: null, rollback: null, complete: null, budget: null };
  const unhook = onStopSignals(release, live, INTENT_KILL_GRACE_MS, d.kill);
  process.once('exit', release);
  try {
    const L = require('./intent-lifecycle.cjs');
    if (L.isExpired(ctx.claimedAt, d.now())) return expireRun(ctx.loc, ctx.fm.id, d); // review n1: under the lock
    if (ctx.started) return refuseRun(d, ctx.fm.id, 'already_claimed', 'already_started');
    const started = countRunsInWindow(loadLedger({ homedir: d.homedir }).rows, d.now());
    if (started >= INTENT_MAX_RUNS_PER_HOUR) return refuseRun(d, ctx.fm.id, 'rate_limited', `${started} runs in the last hour`);
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
    const code = e && e.code;
    if (code === 'A1_LEDGER_BUSY' || code === 'A1_LEDGER_UNREADABLE') {
      return refuseRun(d, stem, code === 'A1_LEDGER_BUSY' ? 'ledger_busy' : 'ledger_unreadable', e.rollbackDetail);
    }
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
  countRunsInWindow, // FR-026, pure
  writeChildContextLock,
  removeChildContextLock,
  createRunDir,
  openRunOutputs,
  openRunOutput,
  removeRunDir,
  spawnEnvSecrets,
  RUN_OUTPUTS,
};
