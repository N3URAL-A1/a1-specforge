'use strict';

// Fixture stand-in for _shared/lib/xprov-owner-home.cjs (spec 024 gate store; same seam as the a1-xprov suite, spec 016 plan D-2).
// run-tests.sh copies this file over the module in its tree COPY, so the suite, which runs under a suite $HOME,
// keeps the ux-studio gate store in $HOME/.a1-ux-studio while production resolves it from the OS user record.
// Never installed, never loaded by production code.

function ownerHome() {
  return process.env.HOME;
}

function homeMismatch() {
  return null;
}

function assertWritable() {
  // the fixture resolver has no tripwire
}

module.exports = { ownerHome, homeMismatch, assertWritable };
