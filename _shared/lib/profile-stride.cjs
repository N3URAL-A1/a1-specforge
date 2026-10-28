'use strict';

// profile-stride — spec 006-specforge-kritis-profile, Wave 5 (FR-003). Owns
// `profile threat-model-check`: proves a `docs/product/features/<id>/
// threat-model.md` covers all six STRIDE categories and leaves no high risk
// open without a named acceptance.
//
// Wave 1 scaffold only: a stub. Takes no `--phase` flag (installGateLog
// strips it once Wave 8 registers the gates) and never reads a real file.
// Wave 5 replaces this module whole.

/**
 * `checkThreatModel(text)` — Wave 5 contract. Stub: exit 2.
 */
function checkThreatModel() {
  process.stderr.write('profile threat-model-check: not_implemented\n');
  process.exit(2);
}

module.exports = { checkThreatModel };
