'use strict';

// Stub of the `test-fidelity` command (spec 017, Wave 2). Fails closed: exit 2, no stdout.
// Wave 4 replaces the body.
const NOT_IMPLEMENTED_WAVE = 4;

/** @param {string|undefined} sub @param {string[]} _rest */
function cmdTestFidelity(sub, _rest) {
  process.stderr.write(`test-fidelity${sub ? ` ${sub}` : ''}: not implemented - spec 017 wave ${NOT_IMPLEMENTED_WAVE}\n`);
  process.exit(2);
}

module.exports = { cmdTestFidelity };
