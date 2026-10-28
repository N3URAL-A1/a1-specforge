'use strict';

// profile-simulate — spec 006-specforge-kritis-profile, Wave 6 (FR-005).
// Owns `profile simulate-roles` and `profile simulate-check`: renders
// stakeholder/reviewer role cards (`_shared/profiles/kritis/
// stakeholder-roles.md`) and verifies a spec's resulting
// `## Stakeholder Simulation` section.
//
// Wave 1 scaffold only: both entry points are stubs. They take no
// `--phase` flag (installGateLog strips it once Wave 8 registers the
// gates) and never touch a real file. Wave 6 replaces this module whole.

/**
 * `renderRoles(ids, catalogue)` — Wave 6 contract. Stub: exit 2.
 */
function renderRoles() {
  process.stderr.write('profile simulate-roles: not_implemented\n');
  process.exit(2);
}

/**
 * `checkSimulation(text, ids)` — Wave 6 contract. Stub: exit 2.
 */
function checkSimulation() {
  process.stderr.write('profile simulate-check: not_implemented\n');
  process.exit(2);
}

module.exports = { renderRoles, checkSimulation };
