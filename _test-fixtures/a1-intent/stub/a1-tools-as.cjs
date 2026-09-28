'use strict';

// stub/a1-tools-as.cjs — runs a1-tools with the passwd home (and optionally
// the git binary) injected through intent-child's library seam, never through
// a variable a child could set (spec 011 FR-047). Optionally writes a
// child-context lock through intent-run's writeChildContextLock first, with the pid of
// this process's parent (the calling shell: an ancestor of a1-tools), and
// removes it through removeChildContextLock on exit.
//
//   node a1-tools-as.cjs <passwd-home> <spec-json|-> <a1-tools.cjs> [args...]
//   spec: { "lock": { action, project, vault_root?, anchor?, intent_id? }, "gitBin": "<abs>", "psFail": true }
//
// A `_shared` copy whose intent-child.cjs has no seam (the H6 pass-through)
// runs unchanged. Fixture-only: production never loads this file.

const fs = require('fs');
const path = require('path');

const FIXTURE_INTENT_ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

const [home, specText, tools, ...args] = process.argv.slice(2);
const spec = specText === '-' ? {} : JSON.parse(specText);
const lib = path.join(path.dirname(tools), 'lib');
const child = require(path.join(lib, 'intent-child.cjs'));
const real = (p) => { try { return fs.realpathSync(p); } catch (_e) { return p; } };

if (typeof child.injectChildDeps === 'function') {
  child.injectChildDeps({
    passwdHome: () => home,
    ...(spec.gitBin ? { gitBin: spec.gitBin } : {}),
    ...(spec.psFail ? { parentOf: () => null } : {}), // an ancestry walk that cannot decide
  });
}
if (spec.lock) {
  const l = spec.lock;
  const run = require(path.join(lib, 'intent-run.cjs'));
  const r = run.writeChildContextLock({
    intent_id: l.intent_id || FIXTURE_INTENT_ID,
    action: l.action,
    project: l.project,
    vault_root: real(l.vault_root || path.join(home, 'no-vault')),
    anchor: l.anchor || real(path.join(home, 'claude-projects', l.project)),
    pid: process.ppid,
  }, { passwdHome: () => home });
  if (!r.ok) {
    process.stderr.write(`a1-tools-as: lock not written (${r.reason})\n`);
    process.exit(99);
  }
  process.on('exit', () => run.removeChildContextLock(r.lock, { passwdHome: () => home }));
}
process.argv = [process.argv[0], tools, ...args];
require(tools);
