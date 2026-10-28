'use strict';

// profile-ears — spec 006-specforge-kritis-profile, Wave 3 (FR-002). Owns
// `profile ears-check`: a deterministic check that every FR in a spec's
// `## Functional Requirements` section (and the profile's NFR section)
// matches one of the five canonical EARS patterns.
//
// Wave 1 scaffold only: a stub. Takes no `--phase` flag (installGateLog
// strips it once Wave 8 registers the gates) and never reads a real file.
// Wave 3 replaces this module whole.

/**
 * `checkEars(text)` — Wave 3 contract. Stub: exit 2.
 */
function checkEars() {
  process.stderr.write('profile ears-check: not_implemented\n');
  process.exit(2);
}

module.exports = { checkEars };
