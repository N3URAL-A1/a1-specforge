'use strict';

// machine-retro.cjs (spec 027 slice 5, FR-031, plan D6, cases MR1-MR11): the machine record derived from real gate logs
// (written by the real gate-log writer into a temp worktree dir), the prose decision, and the idempotent store append.
// The vault is never touched: the store is a temp directory, A1_VAULT_ROOT is unset by the runner. Literals only.
//
// Measured red 2026-11-23 (scratch copy of machine-retro.cjs, one edit each, this file run):
//   scopes concatenated instead of mergeByTs                    -> MR1
//   proseDecision ignores `caught`                              -> MR4
//   no machine_record idempotency check                         -> MR8
//   retro-* scopes kept in readScopes                           -> MR10
//   gates_fired item without `caught`                           -> MR3

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'mr-'));
const TOOLS = path.join(LIB, '..', 'a1-tools.cjs');
const M = require(path.join(LIB, 'machine-retro.cjs'));
const { appendGateLine } = require(path.join(LIB, 'gate-log.cjs'));
const ENV = { PATH: process.env.PATH, HOME: path.join(WORK, 'home'), TMPDIR: process.env.TMPDIR || '/tmp', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
fs.mkdirSync(ENV.HOME, { recursive: true });

let n = 0;
/** A temp worktree dir with the given logs: scope -> [[gate, verdict, exit, isoTs]]. */
function plant(logs) {
  n += 1;
  const root = path.join(WORK, `wt${n}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [scope, lines] of Object.entries(logs)) {
    for (const [gateId, verdict, exitCode, ts] of lines) appendGateLine({ root, scope, gateId, verdict, exitCode, ts, headSha: 'none' });
  }
  return root;
}
const logOf = (root, scope) => path.join(root, '.a1', 'phases', scope, 'gate-log.jsonl');
const T = (s) => `2026-11-23T10:00:${String(s).padStart(2, '0')}.000Z`;
const TWO = {
  s: [['gate-c-ac-dryrun', 'pass', 0, T(1)], ['test-fidelity', 'fail', 1, T(2)], ['test-fidelity', 'pass', 0, T(3)]],
  'pr-7': [['pr-reinhard', 'pass', 0, T(4)], ['pr-merge-check', 'pass', 0, T(5)]],
};

// MR1 two scopes merge by timestamp: first-seen id order, last verdict per id, caught from any fail.
{
  const root = plant(TWO);
  const rs = M.readScopes(root);
  const got = M.deriveRetro({ records: rs.records, issues: [] });
  eq('MR1 gates_fired in merged first-seen order, test-fidelity caught', got.gates_fired, [
    { id: 'gate-c-ac-dryrun', verdict: 'pass', caught: false }, { id: 'test-fidelity', verdict: 'pass', caught: true },
    { id: 'pr-reinhard', verdict: 'pass', caught: false }, { id: 'pr-merge-check', verdict: 'pass', caught: false },
  ]);
  eq('MR1 result pass, scopes sorted, no problem', [got.result, rs.scopes, rs.problem], ['pass', ['pr-7', 's'], null]);
}

// MR2 one scope: the same ids, verdicts and caught as the run-record line entries.
{
  const root = plant({ s: TWO.s });
  const rs = M.readScopes(root);
  const got = M.deriveRetro({ records: rs.records, issues: [] }).gates_fired;
  eq('MR2 single scope gates_fired', got, [{ id: 'gate-c-ac-dryrun', verdict: 'pass', caught: false }, { id: 'test-fidelity', verdict: 'pass', caught: true }]);
}

// MR3 the rendered entry passes `retro validate` against the two real logs.
{
  const root = plant(TWO);
  const rs = M.readScopes(root);
  const retro = M.deriveRetro({ records: rs.records, issues: [] });
  const decision = M.proseDecision({ ...retro, issues: [] });
  const entry = M.renderEntry({ date: '2026-11-23', spec: 'fx-spec', pr: 7, project: 'proj-a', retro, decision, issues: [] });
  const file = path.join(WORK, 'mr3-entry.md');
  fs.writeFileSync(file, entry);
  const cwd = path.join(WORK, 'mr3-repo');
  fs.mkdirSync(cwd, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd, env: ENV });
  const r = spawnSync(process.execPath, [TOOLS, 'retro', 'validate', file, '--gate-log', logOf(root, 's'), '--gate-log', logOf(root, 'pr-7'), '--phase', 'retro-mr'], { cwd, env: ENV, encoding: 'utf8' });
  check('MR3 retro validate exit 0 on the rendered entry', r.status === 0, `rc=${r.status} out=${r.stdout} err=${r.stderr}`);
  check('MR3 entry has the machine keys', /\nkind: machine\n/.test(entry) && /\nmachine_record: fx-spec#7\n/.test(entry) && /\nissues: \[\]\n/.test(entry) && /\nprose_required: true\n/.test(entry), entry);
}

// MR4-MR7 the decision.
eq('MR4 caught gate requires prose', M.proseDecision({ gates_fired: [{ id: 'test-fidelity', verdict: 'pass', caught: true }], result: 'pass', issues: [] }), { required: true, reasons: ['caught:test-fidelity'] });
eq('MR5 result fail requires prose', M.proseDecision({ gates_fired: [], result: 'fail', issues: [] }), { required: true, reasons: ['result:fail'] });
eq('MR6 an issue requires prose', M.proseDecision({ gates_fired: [], result: 'pass', issues: ['x'] }), { required: true, reasons: ['issues'] });
eq('MR7 nothing requires no prose', M.proseDecision({ gates_fired: [{ id: 'a', verdict: 'pass', caught: false }], result: 'pass', issues: [] }), { required: false, reasons: [] });

// MR8 appending twice writes one entry, adds exactly one `^date:` line, and removes the lock directory.
{
  const store = path.join(WORK, 'store8');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'a1-new-feature.md'), '# Retros\n\n---\ndate: 2026-11-01\nresult: pass\n---\n');
  const entry = M.renderEntry({ date: '2026-11-23', spec: 'fx-spec', pr: 7, project: 'proj-a', retro: { gates_fired: [], result: 'pass' }, decision: { required: false, reasons: [] }, issues: [] });
  const dates = () => (fs.readFileSync(path.join(store, 'a1-new-feature.md'), 'utf8').match(/^date:/gm) || []).length;
  const a = M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry });
  const b = M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry });
  eq('MR8 appended then already_recorded', [a.status, b.status], ['appended', 'already_recorded']);
  eq('MR8 date lines 1 -> 2, lock dir gone', [dates(), fs.existsSync(path.join(store, 'a1-new-feature.lock.d'))], [2, false]);
  eq('MR8 findMachineRecord reads prose_required false', M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }), { found: true, prose_required: false });
  eq('MR8 findMachineRecord of another PR: not found, prose required', M.findMachineRecord({ store, spec: 'fx-spec', pr: 8 }), { found: false, prose_required: true });
}

// MR9 a symlinked store file is refused with exit 2, and the lock is released.
{
  const store = path.join(WORK, 'store9');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(WORK, 'victim.md'), 'victim\n');
  fs.symlinkSync(path.join(WORK, 'victim.md'), path.join(store, 'a1-new-feature.md'));
  let err = null;
  try { M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: '---\nx: 1\n---\n' }); } catch (e) { err = e; }
  check('MR9 symlink refused with exit 2', err !== null && err.exit === 2, err && err.message);
  eq('MR9 victim untouched, lock dir gone', [fs.readFileSync(path.join(WORK, 'victim.md'), 'utf8'), fs.existsSync(path.join(store, 'a1-new-feature.lock.d'))], ['victim\n', false]);
}

// MR10 retro-* scopes are not part of the record.
{
  const root = plant({ ...TWO, 'retro-x': [['retro-only-gate', 'pass', 0, T(6)]] });
  const rs = M.readScopes(root);
  check('MR10 retro-x excluded from scopes and records', !rs.scopes.includes('retro-x') && !rs.records.some((r) => r.gate === 'retro-only-gate'), JSON.stringify(rs.scopes));
}

// MR11 a corrupt log: problem gate_log_unreadable, no records, and the decision names it.
{
  const root = plant(TWO);
  const f = logOf(root, 's');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"verdict":"fail"', '"verdict":"pass"'));
  const rs = M.readScopes(root);
  eq('MR11 problem and empty records', [rs.problem, rs.records], ['gate_log_unreadable', []]);
  eq('MR11 decision names the problem', M.proseDecision({ gates_fired: [], result: 'pass', issues: [], problem: rs.problem }), { required: true, reasons: ['gate_log_unreadable'] });
}

done();
