'use strict';

// profile-resolve — spec 006-specforge-kritis-profile, Wave 2 (FR-001). Owns
// `profile resolve` and `profile set`: fail-closed detection of the `kritis`
// profile (flag > spec frontmatter > index.json > constitution marker) and
// persistence of the decision into a spec's frontmatter.
//
// Wave 1 scaffold only: both entry points are stubs. They take no
// `--phase` flag (installGateLog strips it once Wave 8 registers the
// gates) and never touch a real file. Wave 2 replaces this module whole.

/**
 * `resolveProfile({ flag, specPath, repoRoot })` — Wave 2 contract. Stub: exit 2.
 */
function resolveProfile() {
  process.stderr.write('profile resolve: not_implemented\n');
  process.exit(2);
}

/**
 * `setProfile({ specPath, name })` — Wave 2 contract. Stub: exit 2.
 */
function setProfile() {
  process.stderr.write('profile set: not_implemented\n');
  process.exit(2);
}

module.exports = { resolveProfile, setProfile };
