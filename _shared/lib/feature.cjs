'use strict';

// `a1-tools feature <sub>` group dispatcher (spec 027 slice 4, plan D15). `close` is Task 8.2.

const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools feature plan-steps <spec-path>\n       a1-tools feature close --by <spec-id> --pr <n> [--repo <dir>] [--spec <path>] [--worktree <id>]\n       a1-tools feature close --cleanup-only [--repo <dir>]';

/** @param {string} sub @param {string[]} rest */
function cmdFeature(sub, rest) {
  if (sub === 'plan-steps') return require('./feature-plan-steps.cjs').cmdPlanSteps(rest);
  if (sub === 'close') return require('./feature-close.cjs').cmdFeatureClose(rest);
  return emitExit(2, '', `feature: unknown subcommand ${JSON.stringify(String(sub))}\nusage: ${USAGE}\n`);
}

module.exports = { cmdFeature };
