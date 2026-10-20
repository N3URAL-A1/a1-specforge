'use strict';

// Stub of the `fix class-sweep` command (spec 017, Wave 2). Fails closed: exit 2, no stdout.
// Wave 9 replaces the body.
const NOT_IMPLEMENTED_WAVE = 9;

/** @param {string|undefined} _sub @param {string[]} _rest */
function cmdFixClassSweep(_sub, _rest) {
  process.stderr.write(`fix class-sweep: not implemented - spec 017 wave ${NOT_IMPLEMENTED_WAVE}\n`);
  process.exit(2);
}

module.exports = { cmdFixClassSweep };
