'use strict';

// Stub of the `pr merge-check` command (spec 017, Wave 2). Fails closed: exit 2, no stdout.
// Wave 10 replaces the body.
const NOT_IMPLEMENTED_WAVE = 10;

/** @param {string|undefined} _sub @param {string[]} _rest */
function cmdPrMergeCheck(_sub, _rest) {
  process.stderr.write(`pr merge-check: not implemented - spec 017 wave ${NOT_IMPLEMENTED_WAVE}\n`);
  process.exit(2);
}

module.exports = { cmdPrMergeCheck };
