'use strict';

// Stub of the `verify` command (spec 017, Wave 2). Fails closed: exit 2, no stdout.
// Wave 3 replaces the body.
const NOT_IMPLEMENTED_WAVE = 3;

/** @param {string|undefined} sub @param {string[]} _rest */
function cmdVerify(sub, _rest) {
  process.stderr.write(`verify${sub ? ` ${sub}` : ''}: not implemented - spec 017 wave ${NOT_IMPLEMENTED_WAVE}\n`);
  process.exit(2);
}

module.exports = { cmdVerify };
