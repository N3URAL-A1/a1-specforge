'use strict';

// Stub of the `disposition` command (spec 017, Wave 2). Fails closed: exit 2, no stdout.
// Wave 8 replaces the body.
const NOT_IMPLEMENTED_WAVE = 8;

/** @param {string|undefined} sub @param {string[]} _rest */
function cmdDisposition(sub, _rest) {
  process.stderr.write(`disposition${sub ? ` ${sub}` : ''}: not implemented - spec 017 wave ${NOT_IMPLEMENTED_WAVE}\n`);
  process.exit(2);
}

module.exports = { cmdDisposition };
