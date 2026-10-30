'use strict';

// profile-resolve — spec 006-specforge-kritis-profile, Wave 2 (FR-001). Owns
// `profile resolve` and `profile set`: fail-closed detection of the `kritis`
// profile (flag > spec frontmatter > index.json > constitution marker) and
// persistence of the decision into a spec's frontmatter. See
// docs/adr/2026-10-28-optional-profile-lane.md section 3 for the binding
// precedence and fail-closed rules this module implements.
//
// Both entry points take their inputs as parameters only (repo root, spec
// path, flag value) — no module-level state, per the wave contract's
// request-scoped-state rule.

const fs = require('fs');
const path = require('path');
const { parseFlags, readMd, writeMdAtomic, resolveVaultPath } = require('./io.cjs');

// The only known profile today (ADR section 1/3: frozen set, no heuristics).
const KNOWN_PROFILES = Object.freeze(['kritis']);

const CONSTITUTION_MARKER_RE = /^a1-profile:\s*(\S+)\s*$/;

/** Writes one JSON line to stdout and sets the process exit code. Never
 * throws; the caller still controls when the process actually exits. */
function emit(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

function usageExit(msg) {
  process.stderr.write(`usage error: profile resolve: ${msg}\n`);
  process.exit(1);
}

function internalExit(msg) {
  process.stderr.write(`profile resolve: ${msg}\n`);
  process.exit(2);
}

/** Refuse a symlinked path (we read it, never follow a link planted to
 * redirect the read). Returns true when `p` exists and is a symlink. */
function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch (_e) {
    return false;
  }
}

/**
 * Fail-closed handling of a symlinked rung file (ADR section 3). The link is
 * never trusted as a source of the profile value, but it must not let a
 * declared profile silently vanish either: the target is only PEEKED at, with
 * the rung's own declaration test, and a declaration (or an unreadable
 * target) is an error naming the file. No declaration -> the rung is skipped
 * and not reported as checked.
 */
function refuseSymlink(file, declares) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { error: { code: 'rung_unreadable', file, reason: `symlinked and unreadable (${e.code || e.message})` } };
  }
  if (declares(text)) {
    return { error: { code: 'rung_unreadable', file, reason: 'symlinked file declares a profile; refusing to follow a symlink' } };
  }
  return { profile: null, checked: false, skipped: true };
}

/** A read error other than ENOENT must not read as "no profile declared". */
function readError(file, e) {
  if (e && e.code === 'ENOENT') return { profile: null, checked: false };
  return { error: { code: 'rung_unreadable', file, reason: (e && e.code) || (e && e.message) || 'read failed' } };
}

/**
 * Resolve the `index.json` rung: `{ profile, checked }` on success, or
 * `{ error }` when the file's raw text names a profile but cannot be parsed
 * (ADR section 3 / brief: "index_json_unreadable_with_profile").
 * A missing file, a symlinked file, or a parse failure with no "profile"
 * substring are all silently `{ profile: null, checked: true }` — exactly as
 * silent as today for a project that never declared a profile.
 */
function resolveFromIndexJson(repoRoot) {
  const indexPath = path.join(repoRoot, 'docs', 'product', 'index.json');
  if (isSymlink(indexPath)) return refuseSymlink(indexPath, (t) => t.includes('"profile"'));
  let raw;
  try {
    raw = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    return readError(indexPath, e);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    if (raw.includes('"profile"')) {
      return { error: { code: 'index_json_unreadable_with_profile', file: indexPath } };
    }
    return { profile: null, checked: true };
  }
  const value = parsed && typeof parsed === 'object' && parsed.project && typeof parsed.project === 'object'
    ? parsed.project.profile
    : undefined;
  if (value === undefined || value === null) return { profile: null, checked: true };
  if (typeof value !== 'string' || !KNOWN_PROFILES.includes(value)) {
    return { error: { code: 'unknown_profile_value', file: indexPath, value } };
  }
  return { profile: value, checked: true };
}

/**
 * Resolve the spec-frontmatter rung. `specPath` may be undefined (no --spec
 * given — the rung is simply not checked, same as the brief's precedence
 * list). A missing or unreadable file at a GIVEN --spec is an error, not a
 * silent null — the operator named this exact file.
 */
function resolveFromSpec(specPath) {
  if (!specPath) return { profile: null, checked: false };
  const resolved = resolveVaultPath(specPath);
  if (isSymlink(resolved)) {
    return { error: { code: 'spec_unreadable', file: resolved, reason: 'refusing to follow a symlinked --spec path' } };
  }
  if (!fs.existsSync(resolved)) {
    return { error: { code: 'spec_unreadable', file: resolved, reason: 'file not found' } };
  }
  let fm;
  try {
    ({ fm } = readMd(resolved));
  } catch (e) {
    return { error: { code: 'spec_unreadable', file: resolved, reason: e.message } };
  }
  const value = fm.profile;
  if (value === undefined || value === null) return { profile: null, checked: true };
  if (typeof value !== 'string' || !KNOWN_PROFILES.includes(value)) {
    return { error: { code: 'unknown_profile_value', file: resolved, value } };
  }
  return { profile: value, checked: true };
}

/**
 * Resolve the constitution-marker rung: the exact line regex
 * `^a1-profile:\s*(\S+)\s*$` anywhere in `<repoRoot>/constitution.md`. Any
 * other value on a matching line is an error (ADR: "any other value exits
 * 2"); a SpecForge-shaped constitution without the explicit marker line
 * never enables the profile (no heuristics).
 */
function resolveFromConstitution(repoRoot) {
  const constPath = path.join(repoRoot, 'constitution.md');
  if (isSymlink(constPath)) {
    return refuseSymlink(constPath, (t) => t.split('\n').some((l) => CONSTITUTION_MARKER_RE.test(l)));
  }
  let content;
  try {
    content = fs.readFileSync(constPath, 'utf8');
  } catch (e) {
    return readError(constPath, e);
  }
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(CONSTITUTION_MARKER_RE);
    if (!m) continue;
    const value = m[1];
    if (!KNOWN_PROFILES.includes(value)) {
      return { error: { code: 'unknown_profile_value', file: constPath, value } };
    }
    return { profile: value, checked: true };
  }
  return { profile: null, checked: true };
}

/** Validate --repo-root: required, absolute, and an existing directory.
 * Exits via usageExit/internalExit; returns nothing on success. */
function assertRepoRoot(repoRoot) {
  if (!repoRoot) {
    usageExit('--repo-root <dir> is required');
  }
  if (!path.isAbsolute(repoRoot)) {
    usageExit(`--repo-root must be an absolute path, got: ${repoRoot}`);
  }
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    internalExit(`--repo-root does not exist or is not a directory: ${repoRoot}`);
  }
}

// Rungs 2-4 of the precedence (ADR section 3): spec frontmatter > index.json
// > constitution marker. Each entry names the rung, how to resolve it, and
// the error-message shape for an unknown value found in that rung's file.
function rungErrorMessage(e) {
  if (e.code === 'index_json_unreadable_with_profile') return `index_json_unreadable_with_profile: ${e.file}`;
  if (e.code === 'spec_unreadable') return `spec_unreadable: ${e.file} (${e.reason})`;
  if (e.code === 'rung_unreadable') return `rung_unreadable: ${e.file} (${e.reason})`;
  return `unknown profile value ${JSON.stringify(e.value)} in ${e.file}`;
}

const FILE_RUNGS = [
  { source: 'spec', resolve: (repoRoot, specPath) => resolveFromSpec(specPath) },
  { source: 'index.json', resolve: (repoRoot) => resolveFromIndexJson(repoRoot) },
  { source: 'constitution', resolve: (repoRoot) => resolveFromConstitution(repoRoot) },
];

/**
 * `resolveProfile(argv)` — CLI entry for `profile resolve`. Pure apart from
 * reads (no write, ever). Precedence: --profile flag > spec frontmatter >
 * index.json > constitution marker (ADR section 3). Exit 0 on any resolved
 * result (including profile: null); exit 1 for an unknown --profile flag
 * value (usage error); exit 2 for an unknown value found in a file source
 * (named) or an unreadable --repo-root.
 */
function resolveProfile(argv) {
  const flags = parseFlags(argv || [], { profile: 'value', spec: 'value', 'repo-root': 'value', json: 'bool' });
  assertRepoRoot(flags['repo-root']);
  const repoRoot = flags['repo-root'];
  const sourcesChecked = [];

  if (flags.profile !== undefined) {
    sourcesChecked.push('flag');
    if (!KNOWN_PROFILES.includes(flags.profile)) {
      usageExit(`unknown --profile value: ${JSON.stringify(flags.profile)} (known: ${KNOWN_PROFILES.join(', ')})`);
    }
    emit({ profile: flags.profile, source: 'flag', isolation: 'blank_slate', sources_checked: sourcesChecked }, 0);
    return;
  }

  for (const rung of FILE_RUNGS) {
    const result = rung.resolve(repoRoot, flags.spec);
    if (result.error) {
      internalExit(rungErrorMessage(result.error));
    }
    // A rung that was refused (symlink) was not read: do not report it.
    if (!result.skipped) sourcesChecked.push(rung.source);
    if (result.profile) {
      emit({ profile: result.profile, source: rung.source, isolation: 'blank_slate', sources_checked: sourcesChecked }, 0);
      return;
    }
  }

  // No source found: profile: null, exit 0, nothing touched.
  emit({ profile: null, source: null, isolation: null, sources_checked: sourcesChecked }, 0);
}

/**
 * `setProfile(argv)` — CLI entry for `profile set --spec <path> <name>`.
 * Persists the decision into the spec's frontmatter. Copies the parsed
 * frontmatter before mutating (never mutates the object readMd returned —
 * contract item 7) and writes only when the value actually changes, so a
 * second run on an already-set spec leaves the file byte-identical.
 */
function setProfile(argv) {
  const args = argv || [];
  const flags = parseFlags(args, { spec: 'value' });
  const name = flags._[0];

  if (!flags.spec) {
    usageExit('set requires --spec <path> <name>');
  }
  if (!name) {
    usageExit('set requires --spec <path> <name>');
  }
  if (!KNOWN_PROFILES.includes(name)) {
    usageExit(`unknown profile name: ${JSON.stringify(name)} (known: ${KNOWN_PROFILES.join(', ')})`);
  }

  const resolved = resolveVaultPath(flags.spec);
  if (isSymlink(resolved)) {
    internalExit(`refusing to follow a symlinked --spec path: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) {
    internalExit(`spec file not found: ${resolved}`);
  }

  let fm;
  let body;
  try {
    ({ fm, body } = readMd(resolved));
  } catch (e) {
    internalExit(`cannot read spec frontmatter: ${e.message}`);
    return;
  }

  if (fm.profile === name) {
    // Already set to the requested value: nothing to write (byte-identical
    // second run), still reported as success.
    emit({ spec_path: resolved, profile: name, written: false }, 0);
    return;
  }

  const nextFm = { ...fm, profile: name };
  writeMdAtomic(resolved, nextFm, body);
  emit({ spec_path: resolved, profile: name, written: true }, 0);
}

module.exports = { resolveProfile, setProfile, KNOWN_PROFILES };
