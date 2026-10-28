'use strict';

// profile — command group `profile` (spec 006-specforge-kritis-profile,
// Wave 1 scaffold). Folds SpecForge's three exclusive assets (EARS, STRIDE,
// NIS2/KRITIS NFRs) plus the stakeholder simulation and the blank-slate
// rule into a1-new-feature as an opt-in `kritis` profile.
//
// `cmdProfile(sub, rest)` only dispatches; every subcommand's own module
// owns its exit code (0 pass / 1 finding or usage / 2 unreadable, unsafe
// path or hostile input — the house contract). A missing or unknown
// subcommand is a usage error (exit 1) through the shared `usage()` of
// help.cjs, the same helper every other group's "unknown subcommand" path
// uses.
//
// Lazy require per subcommand: a `profile ears-check` call never loads the
// STRIDE, NFR, simulate or trigger modules. Six subcommands are still
// stubs (Waves 2–7 replace them one at a time); none of them parses
// `--phase` — `installGateLog` strips it only once Wave 8 registers the
// two deterministic gates.

const path = require('path');

const KNOWN_SUBCOMMANDS = Object.freeze([
  'resolve', 'set', 'ears-check', 'nfr-inject', 'threat-model-check',
  'simulate-roles', 'simulate-check', 'trigger-check',
]);

/**
 * `cmdProfile(sub, rest)` — dispatch table for the `profile` group.
 * @param {string|undefined} sub subcommand name
 * @param {string[]} rest remaining argv
 */
function cmdProfile(sub, rest) {
  const { usage } = require('./help.cjs');
  if (!sub || !KNOWN_SUBCOMMANDS.includes(sub)) {
    usage(`unknown profile subcommand: ${sub || '<none>'} (expected one of: ${KNOWN_SUBCOMMANDS.join(', ')})`);
    return; // unreachable — usage() calls process.exit(1)
  }

  if (sub === 'resolve') {
    require(path.join(__dirname, 'profile-resolve.cjs')).resolveProfile(rest);
    return;
  }
  if (sub === 'set') {
    require(path.join(__dirname, 'profile-resolve.cjs')).setProfile(rest);
    return;
  }
  if (sub === 'ears-check') {
    require(path.join(__dirname, 'profile-ears.cjs')).checkEars(rest);
    return;
  }
  if (sub === 'nfr-inject') {
    require(path.join(__dirname, 'profile-nfr.cjs')).planInjection(rest);
    return;
  }
  if (sub === 'threat-model-check') {
    require(path.join(__dirname, 'profile-stride.cjs')).checkThreatModel(rest);
    return;
  }
  if (sub === 'simulate-roles') {
    require(path.join(__dirname, 'profile-simulate.cjs')).renderRoles(rest);
    return;
  }
  if (sub === 'simulate-check') {
    require(path.join(__dirname, 'profile-simulate.cjs')).checkSimulation(rest);
    return;
  }
  // sub === 'trigger-check'
  require(path.join(__dirname, 'profile-triggers.cjs')).checkTriggers(rest);
}

module.exports = { cmdProfile };
