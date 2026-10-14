'use strict';

// Fixture stand-in for _shared/lib/xprov-owner-home.cjs (spec 016 plan decision D-2).
// run-tests.sh make_tree() copies this file over the module in its tree COPY, so the
// suite — which runs under a suite $HOME — keeps its owner stores in $HOME/.a1-xprov
// while production resolves them from the OS user record. The real module is exercised
// by parts/22-owner-store.sh on a tree whose passwd home is a temp directory.
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
