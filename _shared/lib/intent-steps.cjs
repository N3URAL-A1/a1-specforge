'use strict';

// ---------------------------------------------------------------------------
// intent-steps — the executor steps (spec 011, Wave 7, FR-051; confirmed by
// Robert on 2026-09-28): what a skill needs but the child may not run. They
// run in the `run` process itself as library calls, never as a spawned
// a1-tools (a descendant of the executor.lock holder is in child mode and
// exits 77, FR-047).
//
//   pre-step  (fix)          the a1-fix integrity check, after the argv guard
//                            and before the running rewrite; a mismatch or a
//                            throw fails the intent parent_step_failed
//                            (detail integrity_check), nothing is spawned.
//   post-step (plan/execute) the xprov gate, only after the child exited 0;
//                            a failure -> parent_step_failed (xprov_gate).
//   post-step (fix)          the postmortem, whenever the run left a bug
//                            report under project/<slug>/fixes/ (whatever the
//                            child's exit); none -> log postmortem_skipped.
//
// First failure wins: a child's timeout, cancelled or nonzero_exit is never
// overwritten by a step's failure. Post-steps run inside the run's time
// budget (FR-027): an async step that starts its processes through
// budget.spawn is killed with the group sequence at the deadline; a
// synchronous step is judged after it returns (intent-spawn.cjs header).
//
// v1 runs no xprov gate inside `run` (team-lead decision (c), 2026-09-29;
// FR-051 amendment in spec round 9): xprov-gate.cjs gate() starts its own
// steps as a1-tools subprocesses (runSub), which the executor.lock puts in
// child mode (exit 77); an execute intent does not name the wave and base the
// gate needs; and an in-process gate (the long-term candidate) needs 009's
// xprov-gate.cjs plus a wave-selection rule. The owner runs the gate when
// reviewing the intent branch (the plan/execute prompt says so). The hook
// deps.xprovGate stays, with the first-failure rule and the budget; it is
// null in production (log xprov_gate_unwired) and injected by fixtures only.
//
// exitAsThrow convention (Samuel MINOR-3): fix.cjs and io.cjs end the process
// through fail() / process.exit. Inside a step that exit becomes a thrown
// A1_STEP_EXIT, which reaches the step's own catch only because nothing in
// between catches it: a try/catch around vaultRoot(), fail() or a whole
// cmdFix* body in fix.cjs would swallow it and let the step go on (an
// integrity check "passing" without a vault). Keep such catches narrow
// (around a single readFileSync, as today); fixture B32 runs the real
// integrity check without a learning-store root and pins this.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const WRITE_POSTMORTEM_ACTIONS = Object.freeze(['fix']);
const GATE_ACTIONS = Object.freeze(['plan', 'execute']);
const BUG_REPORT_RE = /^project\/([a-z0-9][a-z0-9-]*)\/fixes\/(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9._-]{0,120})\.md$/;
const failed = (detail) => Object.freeze({ reason: 'parent_step_failed', detail });

// W7 security: fix.cjs and io.cjs end the process through fail() /
// process.exit (no vault root, a bad argument). Inside `run` that would skip
// the completion and the rollback, so a step's synchronous part runs with
// process.exit turned into a throw, which the step's own catch turns into
// parent_step_failed. Only the synchronous part: no signal handler can run
// in it, so `run`'s own exits are never caught.
function exitAsThrow(fn) {
  const exit = process.exit;
  process.exit = (code) => {
    throw Object.assign(new Error(`step ended the process (exit ${code})`), { code: 'A1_STEP_EXIT' });
  };
  try {
    return fn();
  } finally {
    process.exit = exit;
  }
}

// Default integrity check: fix.cjs's own library function (no a1-tools spawn).
const integrityCheck = () => require('./fix.cjs').cmdFixIntegrityCheck([]);

// Default postmortem writer: fix.cjs's init-postmortem, with its arguments
// checked here first (its own checks end the process through fail()), and
// never over an existing postmortem. -> 'written' | 'exists'.
function writePostmortem({ project, date, bugSlug }) {
  const { projectsPath } = require('./io.cjs');
  if (fs.existsSync(projectsPath(project, 'postmortems', `${date}-${bugSlug}.md`))) return 'exists';
  require('./fix.cjs').cmdFixInitPostmortem([bugSlug, project, '--date', date]);
  return 'written';
}

const stepDeps = (d) => ({
  integrityCheck: d.integrityCheck || integrityCheck,
  xprovGate: d.xprovGate === undefined ? null : d.xprovGate,
  writePostmortem: d.writePostmortem || writePostmortem,
});

// FR-051 (a). -> null (passed, or no pre-step) | failed(detail).
async function runPreSteps(ctx, d, log) {
  if (!WRITE_POSTMORTEM_ACTIONS.includes(ctx.fm.action)) return null;
  const s = stepDeps(d);
  let r;
  try {
    r = await exitAsThrow(() => s.integrityCheck(ctx));
  } catch (e) {
    log('integrity_check: threw', String(e && e.message).slice(0, 120));
    return failed('integrity_check');
  }
  const ok = r && (r.status === 'ok' || r.status === 'bootstrapped');
  log(`integrity_check: ${ok ? 'passed' : 'failed'}`, r && r.status);
  return ok ? null : failed('integrity_check');
}

// The first bug report the run created or changed under project/<slug>/fixes/.
function bugReportOf(ctx, d) {
  const { snapshotProject, diffSnapshots } = require('./intent-result.cjs');
  let before;
  try {
    before = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'snapshot.json'), 'utf8'));
  } catch (_e) {
    return null;
  }
  const after = snapshotProject(ctx.fm.project, { vault: d.vault });
  const hit = diffSnapshots(before, after).map((rel) => BUG_REPORT_RE.exec(rel)).find((m) => m && m[1] === ctx.fm.project);
  return hit ? { project: hit[1], date: hit[2], bugSlug: hit[3] } : null;
}

async function gateStep(ctx, budget, s, log) {
  if (s.xprovGate === null) {
    log('xprov_gate_unwired');
    return null;
  }
  try {
    const r = await s.xprovGate(ctx, budget);
    log(`xprov_gate: ${r && r.ok ? 'passed' : 'failed'}`, r && r.detail);
    return r && r.ok ? null : failed('xprov_gate');
  } catch (e) {
    log('xprov_gate: threw', String(e && e.message).slice(0, 120));
    return failed('xprov_gate');
  }
}

async function postmortemStep(ctx, d, s, log) {
  const report = bugReportOf(ctx, d);
  if (report === null) {
    log('postmortem_skipped');
    return null;
  }
  try {
    const r = await exitAsThrow(() => s.writePostmortem(report));
    log(`postmortem: ${r}`);
    return null;
  } catch (e) {
    log('postmortem: failed', String(e && e.message).slice(0, 120));
    return failed('postmortem');
  }
}

// FR-051 (b)(c). `childFailure` is the child's own failure reason or null.
// -> null | failed(detail); the caller keeps the child's failure first.
async function runPostSteps(ctx, childFailure, budget, d, log) {
  const s = stepDeps(d);
  let first = null;
  if (GATE_ACTIONS.includes(ctx.fm.action) && childFailure === null) first = await gateStep(ctx, budget, s, log);
  if (WRITE_POSTMORTEM_ACTIONS.includes(ctx.fm.action)) {
    const pm = await postmortemStep(ctx, d, s, log);
    first = first || pm;
  }
  return first;
}

module.exports = { runPreSteps, runPostSteps, integrityCheck, writePostmortem };
