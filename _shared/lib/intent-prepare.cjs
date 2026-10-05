'use strict';

// ---------------------------------------------------------------------------
// intent-prepare — everything `intent run` does from the run dir up to the
// running rewrite (spec 011; moved out of intent-run.cjs unchanged in Wave 8
// so the cancel poll fits): the binary lookup, the empty outputs, the
// rollback of a stop before the spawn, the in-process `complete`, a failure
// before the spawn, the before-snapshot, the running rewrite, argv + env +
// guard, and prepareRun, which strings them together.
//
// intent-run.cjs requires this module lazily (the two require each other);
// the helpers below come from intent-run.cjs, which is fully loaded by then.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const ARGV = require('./intent-argv.cjs');
const { runPreSteps } = require('./intent-steps.cjs');
const {
  OUTPUT_FLAGS, RUN_EXIT, RUN_FILE_MODE, RUN_OUTPUTS, RUN_SNAPSHOT, SEAL_REWRITE, createRunDir, dropCancel, logRun, readCancel,
  readClaimedFile, rejectRun, removeRunDir, runOut, sha256, spawnEnvSecrets, tamperDetail,
} = require('./intent-run.cjs');

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

module.exports = {
  which, ensureOutputs, dropRunDir, rollback, completeRun, failBeforeSpawn, writeSnapshot, markRunning, prepareSpawn, prepareRun, withRollback,
};
