'use strict';

// stub/route-probe.cjs — calls git the ways a1-tools modules do, inside an
// intent child (review MAJOR-B): the passwd home and the git binary are
// injected through intent-child's seam, the lock is written through
// writeChildContextLock (pid = the calling shell), guardDispatch installs the
// routing, then <mode> runs. Fixture-only.
//   node route-probe.cjs <passwd-home> <lib-dir> <vault> <git-bin> <mode>
//   mode: sync | shell | async | outside | status | envgit | other | shellstr | shellopt | modules

const path = require('path');

const [home, lib, vault, gitBin, mode] = process.argv.slice(2);
const child = require(path.join(lib, 'intent-child.cjs'));
const run = require(path.join(lib, 'intent-run.cjs'));
child.injectChildDeps({ passwdHome: () => home, gitBin });
const r = run.writeChildContextLock({
  intent_id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', action: 'execute', project: 'real-proj',
  vault_root: vault, anchor: require('fs').realpathSync(path.join(home, 'claude-projects', 'real-proj')), pid: process.ppid,
}, { passwdHome: () => home });
process.on('exit', () => run.removeChildContextLock(r.lock, { passwdHome: () => home }));
child.guardDispatch(['lane-split', 'check', '--plan', 'docs/PLAN.md']);
const cp = require('child_process');
if (mode === 'sync') {
  cp.execSync('git rev-parse --show-toplevel', { encoding: 'utf8' });
  cp.execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  cp.spawnSync('/usr/bin/git', ['log', '-1'], { encoding: 'utf8' });
  process.stdout.write('ran\n');
} else if (mode === 'shell') {
  cp.execSync(`git status; touch ${path.join(home, 'shell-ran')}`);
} else if (mode === 'async') {
  cp.spawn('git', ['status']);
} else if (mode === 'outside') {
  cp.execFileSync('git', ['-C', '/', 'status']);
} else if (mode === 'status') {
  process.stdout.write(cp.execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }));
} else if (mode === 'envgit') {
  cp.execFileSync('/usr/bin/env', ['git', 'status']); // git through an intermediate program, no shell
} else if (mode === 'other') {
  cp.spawnSync('/bin/echo', ['ran']);
} else if (mode === 'shellstr') {
  cp.execSync(`echo ran > ${path.join(home, 'shellstr-ran')}`);
} else if (mode === 'shellopt') {
  cp.spawnSync('echo', ['ran'], { shell: true });
} else if (mode === 'modules') {
  // Every module loaded when the routing was installed, other than the two
  // that own it: none may have taken a child_process function at load.
  const fs = require('fs');
  const own = ['intent-child.cjs', 'intent-git.cjs', 'route-probe.cjs'];
  const early = Object.keys(require.cache).filter((f) => !own.includes(path.basename(f)));
  const takes = early.filter((f) => /^(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\(['"]child_process['"]\)/m.test(fs.readFileSync(f, 'utf8')));
  const slugSame = String(require(path.join(lib, 'worktree-registry.cjs')).SLUG_RE) === String(require(path.join(lib, 'intent-sandbox.cjs')).INTENT_PROJECT_SLUG_RE);
  process.stdout.write(`${early.length} ${takes.map((f) => path.basename(f)).join(',') || 'none'} ${slugSame}\n`);
}
