'use strict';

// metrics — command group router (spec 018-pipeline-metrics). Report commands:
// exit 0 by default, 1 for a --fail-above breach or a usage error (help.cjs usage(),
// the a1-tools convention), 2 for an I/O error, an absent vault or unreadable input. Each subcommand owns its exit code.
// This module only routes; the logic lives in metrics-escaped.cjs and metrics-cost.cjs.

const path = require('path');
const { usage } = require('./help.cjs');

const SUBCOMMANDS = Object.freeze({
  escaped: ['metrics-escaped.cjs', 'cmdMetricsEscaped'],
  cost: ['metrics-cost.cjs', 'cmdMetricsCost'],
  'phase-time': ['metrics-phase-time.cjs', 'cmdMetricsPhaseTime'],
});

/**
 * @param {string|undefined} sub - 'escaped' | 'cost' | 'phase-time'
 * @param {string[]} args
 */
function cmdMetrics(sub, args) {
  if (!sub) usage('metrics requires a subcommand: metrics escaped | metrics cost | metrics phase-time');
  const entry = Object.prototype.hasOwnProperty.call(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : null;
  if (!entry) usage(`unknown metrics subcommand: ${sub} (expected: metrics escaped, metrics cost, metrics phase-time)`);
  require(path.join(__dirname, entry[0]))[entry[1]](args);
}

module.exports = { cmdMetrics };
