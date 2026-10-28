'use strict';

// profile-triggers — spec 006-specforge-kritis-profile, Wave 7 (FR-007).
// Owns `profile trigger-check`: measures trigger-phrase collisions across
// installed skill descriptions (`--skills-dir`), so the `specforge` alias
// never competes with another skill's trigger.
//
// Wave 1 scaffold only: a stub. Takes no `--phase` flag (installGateLog
// strips it once Wave 8 registers the gates) and never reads a real
// directory. Wave 7 replaces this module whole.
// `profile trigger-check` stays off every intent allowlist (Wave 8 brief).

/**
 * `checkTriggers({ skillsDirs, phrases, expect })` — Wave 7 contract. Stub: exit 2.
 */
function checkTriggers() {
  process.stderr.write('profile trigger-check: not_implemented\n');
  process.exit(2);
}

module.exports = { checkTriggers };
