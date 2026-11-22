'use strict';

// `a1-tools feature <sub>` group dispatcher (spec 027 slice 4, plan D15). Task 8.2 adds `close`.

const { emitExit } = require('./emit-exit.cjs');

const USAGE = 'a1-tools feature plan-steps <spec-path>';

/** @param {string} sub @param {string[]} rest */
function cmdFeature(sub, rest) {
  if (sub === 'plan-steps') return require('./feature-plan-steps.cjs').cmdPlanSteps(rest);
  return emitExit(2, '', `feature: unknown subcommand ${JSON.stringify(String(sub))}\nusage: ${USAGE}\n`);
}

module.exports = { cmdFeature };
