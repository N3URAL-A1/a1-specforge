'use strict';
// Test seam (same pattern as xprov-owner-home.cjs): the fixture harness swaps THIS file in its tree copy so that suite cases can
// seed acceptance lines without a pty. Production never changes it; no environment variable reaches it.
module.exports = require('./terminal-guard.cjs');
