'use strict';

// intent-prepare.cjs — `intent run` from the run dir up to the running
// rewrite (spec 011). Covered here: the PATH lookup, the empty outputs, the
// run-dir drop and rollback helpers, the error-preserving withRollback and
// the stage-argv guard gate of prepareSpawn. The full prepareRun path runs
// end to end in _test-fixtures/a1-intent (cases/06-run.sh and later).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

if (!process.argv[3] || !os.homedir().startsWith(process.argv[3])) {
  check('P0 HOME is the suite temp home', false, `${os.homedir()} (run through run-tests.sh)`);
  done();
  process.exit(1);
}

const LIB = process.argv[2];
require(path.join(LIB, 'intent-run.cjs')); // intent-prepare is loaded through intent-run (they require each other)
const P = require(path.join(LIB, 'intent-prepare.cjs'));
const work = fs.mkdtempSync(path.join(process.argv[3], 'prep-'));
const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

// P1 — which: absolute PATH dirs only, executable regular files only, first wins.
// Red-making change: dropping the `p.startsWith('/')` filter (a relative dir is searched).
{
  const mk = (dir, name, mode) => { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, name); fs.writeFileSync(p, '#!/bin/sh\n'); fs.chmodSync(p, mode); return p; };
  const a = path.join(work, 'a');
  const b = path.join(work, 'b');
  mk(a, 'noexec', 0o644);
  const bExec = mk(b, 'tool', 0o755);
  mk(path.join(work, 'c'), 'tool', 0o755);
  fs.mkdirSync(path.join(a, 'tool'), { recursive: true }); // a directory named like the tool comes first
  eq('P1 first executable file wins, a dir of that name is skipped', P.which('tool', `${a}:${b}:${path.join(work, 'c')}`), bExec);
  eq('P1 non-executable file is skipped', P.which('noexec', a), null);
  process.chdir(work);
  mk(path.join(work, 'rel'), 'reltool', 0o755);
  eq('P1 relative PATH entries are ignored', P.which('reltool', 'rel:./rel'), null);
  eq('P1 empty PATH', P.which('tool', ''), null);
  eq('P1 undefined PATH', P.which('tool', undefined), null);
  eq('P1 injection-shaped name finds nothing', P.which('$(touch PWNED)', `${a}:${b}`), null);
}

// P2 — ensureOutputs: both files, 0600, idempotent, never through a link.
{
  const dir = path.join(work, 'run1');
  fs.mkdirSync(dir);
  P.ensureOutputs(dir);
  eq('P2 both outputs created', fs.readdirSync(dir).sort(), ['stderr.txt', 'stdout.txt']);
  eq('P2 mode 0600', [fs.statSync(path.join(dir, 'stdout.txt')).mode & 0o777, fs.statSync(path.join(dir, 'stderr.txt')).mode & 0o777], [0o600, 0o600]);
  fs.writeFileSync(path.join(dir, 'stdout.txt'), 'kept');
  P.ensureOutputs(dir);
  eq('P2 existing output kept', fs.readFileSync(path.join(dir, 'stdout.txt'), 'utf8'), 'kept');
  const dir2 = path.join(work, 'run2');
  fs.mkdirSync(dir2);
  fs.symlinkSync(path.join(work, 'victim.txt'), path.join(dir2, 'stdout.txt'));
  // O_EXCL fails with EEXIST on the (dangling) link, which ensureOutputs reads
  // as "already there": nothing is created through it, the link stays a link.
  P.ensureOutputs(dir2);
  check('P2 nothing created through a dangling link', !fs.existsSync(path.join(work, 'victim.txt')) && fs.lstatSync(path.join(dir2, 'stdout.txt')).isSymbolicLink());
}

// P3 — dropRunDir / rollback without anything to undo are no-ops.
{
  const d = { homedir: os.homedir };
  P.dropRunDir({ fm: { id: ID } }, d);
  check('P3 no runDir: nothing touched', !fs.existsSync(path.join(os.homedir(), '.a1-intents')));
  P.rollback({ fm: { id: ID }, createdWorktree: false }, d);
  check('P3 rollback without a created worktree: nothing touched', !fs.existsSync(path.join(os.homedir(), '.a1-intents')));
}

// P4 — withRollback keeps the original error; a failing rollback becomes its detail.
// Red-making change: returning the rollback error instead of the original one.
{
  const orig = new Error('original');
  const ctx = { fm: { id: ID, project: 'demo' }, projectReal: path.join(work, 'nope'), createdWorktree: true };
  const d = { homedir: os.homedir, passwdHome: () => { throw Object.assign(new Error('boom'), { code: 'EBOOM' }); }, env: {} };
  const e = P.withRollback(orig, ctx, d);
  check('P4 the original error is returned', e === orig && e.message === 'original');
  eq('P4 rollback failure named in rollbackDetail', e.rollbackDetail, 'rollback failed: EBOOM');
  const clean = P.withRollback(new Error('x'), { fm: { id: ID } }, { homedir: os.homedir });
  eq('P4 clean rollback adds no detail', clean.rollbackDetail, undefined);
}

// P5 — prepareSpawn (stage row): the built argv must pass guardStageArgv.
// Red-making change: skipping the guard result in the stage branch of prepareSpawn.
{
  const ctx = { row: { kind: 'stage' }, fm: { action: 'stage', project: 'demo', id: ID, target: 'F-001:review' } };
  const d = {
    realpath: (p) => p, passwdHome: () => os.homedir(), execPath: process.execPath, env: { PATH: '/usr/bin:/bin' },
    buildEnv: () => ({ PATH: '/usr/bin:/bin' }), user: () => 'robert', vault: '/vault',
    buildStageArgv: () => ({ sealDir: '/seal', argv: ['/seal/a1-tools.cjs', 'product', 'stage', '--by', 'F-001', '--set', 'review', '--dir', '../../etc'] }),
  };
  const r = P.prepareSpawn(ctx, {}, d);
  eq('P5 tampered stage argv refused', { ok: r.ok, reason: r.reason, detail: r.detail }, { ok: false, reason: 'sandbox_invalid', detail: 'guard: stage_argv' });
  eq('P5 refused argv is reported for the log row', r.argv[8], '../../etc');
}

done();
