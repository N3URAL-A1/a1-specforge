'use strict';

// profile-nfr — spec 006-specforge-kritis-profile, Wave 4 (FR-004). Owns
// `profile nfr-inject`: appends every uncovered item of the NIS2/KRITIS NFR
// catalogue (`_shared/profiles/kritis/nfr-catalogue.md`) into a spec as an
// EARS-form `FR-NFR-###` entry, deduplicated and idempotent.
//
// Wave 1 scaffold only: a stub. Takes no `--phase` flag (installGateLog
// strips it once Wave 8 registers the gates) and never writes a real file.
// Wave 4 replaces this module whole.

/**
 * `planInjection(specText, catalogue)` — Wave 4 contract. Stub: exit 2.
 */
function planInjection() {
  process.stderr.write('profile nfr-inject: not_implemented\n');
  process.exit(2);
}

module.exports = { planInjection };
