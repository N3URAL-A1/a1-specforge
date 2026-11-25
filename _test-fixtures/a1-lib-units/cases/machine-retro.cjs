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
//   gates_fired item without `caught`                           -> MR3 (item-format assert; retro validate itself still exits 0)
// Measured red 2026-11-25 (audit F-004, F-008):
//   renderEntry writes project raw                              -> MR23a-c
//   validGate on String(g.id) / String(g.verdict) (null-guarded) -> MR24a, MR24b, MR24d
// Measured red 2026-11-25 (bug project-slug-source; delete the one `if (bad(<field>, ...)) throw refuse(...)` line in renderEntry):
//   date check -> MR25a; spec check -> MR25b; pr check -> MR25c; issue-tag check -> MR25d; result check -> MR25e
//   any of them loosened to accept a newline (e.g. /m flag) -> the same case; MR25f is the green control (valid fields still render)

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
  // `retro validate` forbids the machine-only keys (review round 1): the gates_fired item format is checked on a copy without them.
  fs.writeFileSync(file, entry.replace(/^(kind|machine_record): .*\n/gm, ''));
  const full = path.join(WORK, 'mr3-full.md');
  fs.writeFileSync(full, entry);
  const cwd = path.join(WORK, 'mr3-repo');
  fs.mkdirSync(cwd, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd, env: ENV });
  const r = spawnSync(process.execPath, [TOOLS, 'retro', 'validate', file, '--gate-log', logOf(root, 's'), '--gate-log', logOf(root, 'pr-7'), '--phase', 'retro-mr'], { cwd, env: ENV, encoding: 'utf8' });
  check('MR3 retro validate exit 0 on the rendered entry without the machine-only keys', r.status === 0, `rc=${r.status} out=${r.stdout} err=${r.stderr}`);
  const rf = spawnSync(process.execPath, [TOOLS, 'retro', 'validate', full], { cwd, env: ENV, encoding: 'utf8' });
  check('MR3 retro validate exit 1 on the entry WITH kind: machine / machine_record (only feature close writes them)', rf.status === 1 && /forbidden_machine_keys/.test(rf.stdout), `rc=${rf.status} out=${rf.stdout}`);
  check('MR3 gates_fired items carry verdict and caught (retro validate alone does not require caught)', entry.includes('\n  - {id: test-fidelity, verdict: pass, caught: true}\n') && entry.includes('\n  - {id: pr-merge-check, verdict: pass, caught: false}\n'), entry);
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

// Review fix round 1 (R3 + SEC-4, SEC-1). Measured red before the fix (this file, pre-fix machine-retro.cjs):
//   whole-file rewrite (tmp + rename)                          -> MR12 (inode changed), MR13 (lstat on the store path)
//   gate id inserted raw into the YAML                         -> MR14 (forged machine_record line in the store), MR15
//   idempotency key matched anywhere in the file               -> MR16

const STORE_FILE = 'a1-new-feature.md';
const mkStore = (name, text) => { const s = path.join(WORK, name); fs.mkdirSync(s, { recursive: true }); if (text !== null) fs.writeFileSync(path.join(s, STORE_FILE), text); return s; };
const entryOf = (spec, pr, gates) => M.renderEntry({ date: '2026-11-23', spec, pr, project: 'p', retro: { gates_fired: gates || [], result: 'pass' }, decision: { required: false, reasons: [] }, issues: [] });

// MR12 the append keeps the inode and the existing bytes (append, not rewrite): a concurrent bash '>>' writer is not lost.
{
  const store = mkStore('store12', '# Retros\n\n---\ndate: 2026-11-01\nresult: pass\n---\n');
  const file = path.join(store, STORE_FILE);
  const before = fs.readFileSync(file, 'utf8'); const ino = fs.statSync(file).ino;
  const r = M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) });
  const after = fs.readFileSync(file, 'utf8');
  eq('MR12 appended, same inode, old bytes are a prefix', [r.status, fs.statSync(file).ino === ino, after.startsWith(before)], ['appended', true, true]);
  eq('MR12 exactly one blank line between the old text and the new entry', after.slice(before.length, before.length + 5), '\n---\n');
}
// MR12b separators: no trailing newline -> blank line added; already a blank line -> none; missing file -> entry only.
{
  const s1 = mkStore('store12b1', 'x'); M.appendMachineRetro({ store: s1, spec: 'a', pr: 1, entry: '---\ndate: d\nkind: machine\nmachine_record: a#1\ngates_fired: []\n---\n' });
  const s2 = mkStore('store12b2', 'x\n\n'); M.appendMachineRetro({ store: s2, spec: 'a', pr: 1, entry: '---\ndate: d\nkind: machine\nmachine_record: a#1\ngates_fired: []\n---\n' });
  const s3 = mkStore('store12b3', null); M.appendMachineRetro({ store: s3, spec: 'a', pr: 1, entry: '---\ndate: d\nkind: machine\nmachine_record: a#1\ngates_fired: []\n---\n' });
  const rd = (s) => fs.readFileSync(path.join(s, STORE_FILE), 'utf8');
  eq('MR12b separators', [rd(s1).startsWith('x\n\n---'), rd(s2).startsWith('x\n\n---'), rd(s3).startsWith('---')], [true, true, true]);
}
// MR13 the store is read and checked through one fd: no lstat/stat of the path (TOCTOU), links and non-regular files and 20 MB refused.
{
  const store = mkStore('store13', '# Retros\n');
  const calls = []; const lstat = fs.lstatSync; const stat = fs.statSync;
  fs.lstatSync = (...a) => { calls.push(String(a[0])); return lstat.apply(fs, a); };
  fs.statSync = (...a) => { calls.push(String(a[0])); return stat.apply(fs, a); };
  try { M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }); M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }); } finally { fs.lstatSync = lstat; fs.statSync = stat; }
  eq('MR13 no path stat on the store file', calls.filter((c) => c.endsWith(STORE_FILE)), []);
  const refused = (name, setup) => { const s = mkStore(name, null); setup(s); let err = null; try { M.appendMachineRetro({ store: s, spec: 'a', pr: 1, entry: '---\ndate: d\n---\n' }); } catch (e) { err = e; } return err && err.exit; };
  eq('MR13 dangling symlink refused, nothing created', [refused('store13a', (s) => fs.symlinkSync(path.join(WORK, 'nowhere'), path.join(s, STORE_FILE))), fs.existsSync(path.join(WORK, 'nowhere'))], [2, false]);
  eq('MR13 a directory at the store path refused', refused('store13b', (s) => fs.mkdirSync(path.join(s, STORE_FILE))), 2);
  eq('MR13 a store over 20 MB refused, file untouched', [refused('store13c', (s) => { fs.writeFileSync(path.join(s, STORE_FILE), ''); fs.truncateSync(path.join(s, STORE_FILE), 21 * 1024 * 1024); }), fs.statSync(path.join(WORK, 'store13c', STORE_FILE)).size], [2, 21 * 1024 * 1024]);
  const sl = mkStore('store13d', null); fs.symlinkSync(path.join(WORK, 'victim.md'), path.join(sl, STORE_FILE));
  eq('MR13 findMachineRecord through a symlink: not found, prose required', M.findMachineRecord({ store: sl, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
}
// MR14 a forged gate id (newlines plus a fake machine_record line, Samuel's probe) never reaches the store; prose is required.
{
  const forged = 'x\nmachine_record: other-spec#999\nprose_required: false';
  const gates = [{ id: 'gate-c-ac-dryrun', verdict: 'pass', caught: false }, { id: forged, verdict: 'pass', caught: false }];
  const dec = M.proseDecision({ gates_fired: gates, result: 'pass', issues: [] });
  eq('MR14 decision names the invalid id', [dec.required, dec.reasons], [true, ['invalid_gate_id']]);
  const entry = M.renderEntry({ date: '2026-11-23', spec: 'fx-spec', pr: 7, project: 'p', retro: { gates_fired: gates, result: 'pass' }, decision: { required: false, reasons: [] }, issues: [] });
  check('MR14 entry holds no forged line, keeps the valid gate, prose_required true', !entry.includes('other-spec') && entry.includes('{id: gate-c-ac-dryrun,') && /\nprose_required: true\n/.test(entry), entry);
  const store = mkStore('store14', null);
  M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry });
  eq('MR14 other-spec#999 is not found after the append', M.findMachineRecord({ store, spec: 'other-spec', pr: 999 }), { found: false, prose_required: true });
}
// MR15 valid registry-style ids pass untouched (dots, digits, hyphens).
{
  const gates = ['gate-4.5-fr-consistency', 'phase-6-verify', 'a'].map((id) => ({ id, verdict: 'pass', caught: false }));
  eq('MR15 no reason for valid ids', M.proseDecision({ gates_fired: gates, result: 'pass', issues: [] }), { required: false, reasons: [] });
  check('MR15 all three rendered', gates.every((g) => entryOf('s', 1, gates).includes(`{id: ${g.id},`)));
}
// MR16 the idempotency key and findMachineRecord match only in a block's frontmatter head, not in a body line.
{
  const body = '---\ndate: 2026-11-01\nresult: pass\n---\n\nNotes quote:\nmachine_record: fx-spec#7\nprose_required: false\n';
  const store = mkStore('store16', body);
  eq('MR16 a body line is not a record', M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  eq('MR16 the append still happens', M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'appended');
  eq('MR16 now the real head is found', M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }), { found: true, prose_required: false });
}

// MR17 (F-003) a pseudo head quoted inside a prose body (---, date:, kind: machine, machine_record:, gates_fired:, prose_required: false)
// is no entry: it neither suppresses the append nor reports prose_required: false. Real shape: a prose entry whose body quotes it.
// Measured red 2026-11-24 (scratch copy, one edit each): no blank-line rule in heads() -> MR17; no `bare` rule -> MR17c, MR17d;
// no `retro_of` rejection in isMachineHead -> MR17e; no `gates_fired` requirement -> MR17f; no blank-line rule -> MR17h; no `kind: machine` check -> MR18b.
{
  const quoted = '---\ndate: 2026-11-02\nkind: machine\nmachine_record: fx-spec#7\nprose_required: false\ngates_fired: []\n---\n';
  const prose = '---\ndate: 2026-11-01\nresult: pass\n---\n\nThe reviewer pasted this block:\n' + quoted + 'end of the paste.\n';
  const store = mkStore('store17', prose);
  eq('MR17 a quoted pseudo head is not found, prose required', M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  eq('MR17 the append still happens', M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'appended');
  eq('MR17 now the real head is found', M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }).found, true);
  const atStart = mkStore('store17b', quoted); // a head at the file start is real
  eq('MR17b a machine head at the file start is found', M.findMachineRecord({ store: atStart, spec: 'fx-spec', pr: 7 }), { found: true, prose_required: false });
  // MR17c a BLANK line before the pasted pseudo head (the head rule alone does not stop this), prose text after it.
  const blank = mkStore('store17c', '---\ndate: 2026-11-01\nresult: pass\n---\n\nPasted:\n\n' + quoted + '\nend of the paste.\n');
  eq('MR17c blank line before the pasted head: not found', M.findMachineRecord({ store: blank, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  eq('MR17c the append still happens', M.appendMachineRetro({ store: blank, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'appended');
  // MR17c2 the same paste followed by a `## Notes` heading: a `#` line is a body, not a delimiter.
  const notes = mkStore('store17c2', '---\ndate: 2026-11-01\nresult: pass\n---\n\nPasted:\n\n' + quoted + '\n## Notes\n\nthe reviewer said so\n');
  eq('MR17c2 pasted head followed by ## Notes: not found', M.findMachineRecord({ store: notes, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  // MR17d the pasted head is the last thing of the prose, but a prose body follows it: a machine head has no body.
  const body = mkStore('store17d', quoted + '\nA body under the head.\n');
  eq('MR17d a head with a body under it is not a machine record', M.findMachineRecord({ store: body, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  // MR17e a head that carries retro_of is a prose reference; MR17f a head without gates_fired is not a machine entry.
  const ref = mkStore('store17e', quoted.replace('gates_fired: []\n', 'gates_fired: []\nretro_of: fx-spec#7\n'));
  eq('MR17e retro_of in the head: not a machine record', M.findMachineRecord({ store: ref, spec: 'fx-spec', pr: 7 }).found, false);
  const nog = mkStore('store17f', quoted.replace('gates_fired: []\n', ''));
  eq('MR17f no gates_fired in the head: not a machine record', M.findMachineRecord({ store: nog, spec: 'fx-spec', pr: 7 }).found, false);
  // MR17h the pseudo head directly under a prose line and last in the file: bare, so only the blank-line rule rejects it.
  const tail = mkStore('store17h', '---\ndate: 2026-11-01\nresult: pass\n---\n\nPasted:\n' + quoted);
  eq('MR17h pseudo head under a text line at EOF: not found', M.findMachineRecord({ store: tail, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  // MR17g a machine head followed by another entry (blank line, then ---) stays found: the real store shape.
  const two = mkStore('store17g', quoted + '\n---\ndate: 2026-11-03\nresult: pass\n---\n\nprose\n');
  eq('MR17g machine head followed by a prose entry is found', M.findMachineRecord({ store: two, spec: 'fx-spec', pr: 7 }).found, true);
}
// MR18 (F-005) a prose entry that carries retro_of (or a stray machine_record without kind: machine) is not the machine record.
{
  const prose = '---\ndate: 2026-11-01\nresult: fail\nretro_of: fx-spec#7\n---\n\nbody\n\n---\ndate: 2026-11-01\nmachine_record: fx-spec#7\n---\n\nbody\n';
  const store = mkStore('store18', prose);
  eq('MR18 retro_of and a kind-less machine_record are not found', M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  eq('MR18 the machine entry is appended after the prose retro', M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'appended');
  const nokind = mkStore('store18b', '---\ndate: 2026-11-01\nmachine_record: fx-spec#7\nprose_required: false\ngates_fired: []\n---\n');
  eq('MR18b a bare head with machine_record and gates_fired but no kind: machine is not found', M.findMachineRecord({ store: nokind, spec: 'fx-spec', pr: 7 }).found, false);
  eq('MR18 and appending again is idempotent', M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'already_recorded');
}

// MR19 (review round 2, root cause A): the reviewers' forged-key files, verbatim (corpus/retro-r2-d.md: `---x` between the date and the
// machine keys; retro-r2-e.md: U+2028 inside header values). The store reader must not take either for the machine record of the run,
// so the real entry is still appended and prose_required stays true. Same files that `retro validate` refuses (L15d/L15e).
const R2 = (c) => fs.readFileSync(path.join(LIB, '..', '..', '_test-fixtures', 'a1-retro-validate', 'corpus', `retro-r2-${c}.md`), 'utf8');
for (const c of ['d', 'e']) {
  const store = mkStore(`store19${c}`, '---\ndate: 2026-11-01\ntask: older\n---\n\nold body\n\n' + R2(c));
  eq(`MR19${c} the forged key of retro-r2-${c}.md is not found`, M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }), { found: false, prose_required: true });
  eq(`MR19${c} the real entry is appended, not already_recorded`, M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'appended');
  eq(`MR19${c} and the real one is then found`, M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }).found, true);
}
// MR20 one view: a real machine entry written with CRLF (or lone CR / U+2028 / U+0085) line ends is still the record.
for (const [label, nl] of [['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['NEL', '\u0085']]) {
  const store = mkStore(`store20${label}`, entryOf('fx-spec', 7).split('\n').join(nl));
  eq(`MR20 ${label} line ends: the machine record is found`, M.findMachineRecord({ store, spec: 'fx-spec', pr: 7 }).found, true);
  eq(`MR20 ${label}: a second append is already_recorded`, M.appendMachineRetro({ store, spec: 'fx-spec', pr: 7, entry: entryOf('fx-spec', 7) }).status, 'already_recorded');
}
// MR21 (D) bare: the next non-blank line after the closing --- is `---` or EOF (round 3: a `#` line is a body); any other text makes it a prose entry.
{
  const head = entryOf('fx-spec', 7);
  let k = 0;
  const rec = (tail) => M.findMachineRecord({ store: mkStore(`store21-${k++}`, head + tail), spec: 'fx-spec', pr: 7 }).found;
  eq('MR21 followed by a # heading: not found (round 3)', rec('\n# Section\n\ntext\n'), false);
  eq('MR21 followed by a text line: not found', rec('\nsome prose line\n'), false);
  eq('MR21 followed by the next entry: found', rec('\n---\ndate: 2026-11-30\n---\n\nprose\n'), true);
  // the head's closing line is `---x`, not a delimiter: no machine head
  eq('MR21 closing line ---x: not found', M.findMachineRecord({ store: mkStore('store21x', head.replace(/\n---\n$/, '\n---x\n')), spec: 'fx-spec', pr: 7 }).found, false);
}

// MR22 (review round 3) the raw-text ban (retro-view) is a superset of what the store reader accepts as a head, and anchored at the end
// of the kind value: `kind: machinery` is no machine key. Measured red without the `\s*$` anchor: MR22a.
{
  const V = require(path.join(LIB, 'retro-view.cjs'));
  eq('MR22a kind: machinery is not banned', V.machineKeyLines('---\ndate: 2026-11-01\nkind: machinery\n---\n'), []);
  for (const tail of ['', '   ', '\t', '\u00a0', '\ufeff', '\u3000']) {
    const text = '---\ndate: 2026-11-01\nkind: machine' + tail + '\ngates_fired: []\nmachine_record: fx-spec#7\n---\n';
    const head = M.findMachineRecord({ store: mkStore('store22', text), spec: 'fx-spec', pr: 7 }).found;
    const banned = V.machineKeyLines(text).some((l) => /^kind\s*:\s*machine/.test(l));
    check('MR22b kind: machine + ' + JSON.stringify(tail) + ': banned whenever the store reader accepts it', !head || banned);
    check('MR22c kind: machine + ' + JSON.stringify(tail) + ': banned', banned);
  }
}

// MR23 (audit F-004) a project value outside SLUG_RE is never written raw: a checkout name with a newline cannot add head lines.
{
  const render = (project) => M.renderEntry({ date: '2026-11-25', spec: 'fx-spec', pr: 7, project, retro: { gates_fired: [], result: 'pass' }, decision: { required: false, reasons: [] }, issues: [] });
  const evil = render('x\nkind: machine\nmachine_record: other#9');
  eq('MR23a project with a newline: written as unknown', evil.split('\n').filter((l) => l.startsWith('project:')), ['project: unknown']);
  eq('MR23b project with a newline: exactly one machine_record line', evil.split('\n').filter((l) => l.startsWith('machine_record:')).length, 1);
  eq('MR23c project with a space or upper case: unknown', [render('My Repo'), render(undefined)].map((e) => /^project: (.*)$/m.exec(e)[1]), ['unknown', 'unknown']);
  eq('MR23d a valid slug is kept', /^project: (.*)$/m.exec(render('a1-specforge'))[1], 'a1-specforge');
}

// MR24 (audit F-008) a gate item without string id or verdict is dropped, never rendered as `id: undefined`; the drop asks for prose.
{
  const gates = [{ verdict: 'pass', caught: false }, { id: 'lint', caught: false }, null, { id: 'ok-gate', verdict: 'pass', caught: false }];
  const entry = M.renderEntry({ date: '2026-11-25', spec: 'fx-spec', pr: 7, project: 'p', retro: { gates_fired: gates, result: 'pass' }, decision: { required: false, reasons: [] }, issues: [] });
  eq('MR24a no undefined in the entry', /undefined|null/.test(entry), false);
  eq('MR24b only the valid gate is written', entry.split('\n').filter((l) => l.startsWith('  - {id:')), ['  - {id: ok-gate, verdict: pass, caught: false}']);
  eq('MR24c a dropped gate sets prose_required: true', /^prose_required: true$/m.test(entry), true);
  eq('MR24d proseDecision flags the invalid gate', M.proseDecision({ gates_fired: gates.filter(Boolean), result: 'pass' }).reasons.includes('invalid_gate_id'), true);
}

// MR25 (bug project-slug-source) renderEntry refuses (exit 2) every head field outside its pattern; nothing is written raw.
{
  const base = { date: '2026-11-25', spec: 'fx-spec', pr: 7, project: 'p', retro: { gates_fired: [], result: 'pass' }, decision: { required: false, reasons: [] }, issues: [] };
  const refused = (patch) => { try { M.renderEntry({ ...base, ...patch }); return 'rendered'; } catch (e) { return e.exit === 2 ? 'refused' : `threw ${e.message}`; } };
  eq('MR25a date with a newline: refused', refused({ date: '2026-11-25\nkind: machine' }), 'refused');
  eq('MR25b spec with an injected head line: refused', [refused({ spec: 'x\nprose_required: false' }), refused({ spec: 'a..b' }), refused({ spec: undefined })], ['refused', 'refused', 'refused']);
  eq('MR25c pr outside a positive integer: refused', [refused({ pr: '7\nx' }), refused({ pr: 0 }), refused({ pr: '7;' }), refused({ pr: 12345678 })], ['refused', 'refused', 'refused', 'refused']);
  eq('MR25d an issue tag with a newline or a space: refused', [refused({ issues: ['ok', 'a\nb'] }), refused({ issues: ['a b'] })], ['refused', 'refused']);
  eq('MR25e a forged result: refused', [refused({ retro: { gates_fired: [], result: 'pass\nprose_required: false' } }), refused({ retro: { gates_fired: [], result: 'maybe' } })], ['refused', 'refused']);
  eq('MR25f valid fields still render, project keeps the unknown fallback', [refused({}), refused({ issues: ['voice-input'], retro: { gates_fired: [], result: 'fail' } }), /^project: unknown$/m.test(M.renderEntry({ ...base, project: 'My Repo' }))], ['rendered', 'rendered', true]);
}

done();
