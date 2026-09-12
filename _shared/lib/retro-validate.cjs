'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, fail, parseFlags } = require('./io.cjs');
const { parseRegistryIds, expandRangeIds, resolveGateId } = require('./gate-ids.cjs');

// ---------------------------------------------------------------------------
// retro validate — Wave 2 of spec 007-retro-gate-id-validator.
//
// `node a1-tools.cjs retro validate <retro-path>` parses every
// `gates_fired[].id` in the given retro file and checks it against
// `_shared/gates-registry.md` (via gate-ids.cjs, Wave 1). This is the
// write-time half of invariant 7: a silently-invented or misspelled gate id
// looked like data to a1-evolve's gate-ROI step and contributed nothing —
// measured 2026-09-11 at 11 of the corpus's `gates_fired` entries, in 3
// distinct misspellings, discarded without a trace.
//
// Exit codes (documented again in help.cjs, per invariant 7):
//   0  every gates_fired[].id in the file is registered (literal or range).
//   1  at least one id is drift (known alias) or unknown (neither table nor
//      alias) — the file has something to fix before its entry counts.
//   2  missing file, unreadable registry, OR a `gates_fired` field that is
//      PRESENT but unparseable.
//
// NOT 2: a bad ARGUMENT exits 1. The header used to promise 2 for "usage
// error"; a1-victor-verifier measured 1 on 2026-09-12 and was right, so the
// documentation was corrected to the measured behaviour.
//
// CORRECTION (2026-09-12, a1-reinhard-reviewer): the justification I first
// wrote here claimed the facade consistently exits 1 on an unknown flag and
// that this command was the only offender. That was WRONG — measured cleanly,
// `learnings roots --bogus`, `quick stats --bogus` and `retro validate <file>
// --bogus` all exit **0**. My original measurement used an unquoted `$c` in a
// shell loop, which split the arguments differently from what I thought I was
// testing. So the silent-ignore behaviour was facade-wide, not unique to
// anything; `workflow lint` (abde955) and this command are now the two that
// reject leftovers, and the others still do not. An unverified claim, written
// into a commit, inside a feature built against unverified claims.
//
// Consequence a caller must know: exit 1 means EITHER "drift found" OR "you
// called me wrong". Distinguish them by stdout — a real run always emits the
// JSON report on stdout, a usage error emits nothing there.
//
// THE ASYMMETRY THAT MATTERS (do not "fix" this by treating both alike): a
// MISSING gates_fired field is exit 0 — read-only reporter skills legitimately
// omit it (retro-template.md, "Skills with no gates ... omit the field").
// A PRESENT-BUT-UNPARSEABLE gates_fired field is exit 2 — treating a
// malformed block as "no gates" would silently discard it exactly like the
// defect this feature exists to kill, just one layer earlier (a parse
// failure instead of a registry miss). See V6 in the fixture suite.
// ---------------------------------------------------------------------------

// Hostile-input guards on the retro-path argument (CONVENTIONS.md, mandatory
// for every new CLI subcommand). A retro path is a file argument, not a slug
// joined into a path (unlike the `product` commands' --id/--milestone, fixed
// in d639b8e) — so the applicable guard is: resolve to an absolute path,
// reject control-character/NUL/oversized shapes up front (before any fs
// call touches the string), and require the resolved path to be an existing
// REGULAR file. A `../../etc/passwd`-shaped argument is not rejected because
// it is "outside a store" (there is no single store a retro must live under
// — Wave 1's own fixtures and V4's snapshot both live in the repo, not the
// vault) but because it is treated as an opaque path: it either resolves to
// a real file or it does not, and nothing in between is trusted enough to
// read speculatively.
const MAX_PATH_LEN = 4096;

function rejectHostilePath(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    fail('retro validate requires <retro-path>');
  }
  if (raw.length > MAX_PATH_LEN) {
    const err = new Error(`retro-path too long (${raw.length} chars, max ${MAX_PATH_LEN})`);
    err.code = 'A1_INPUT';
    throw err;
  }
  if (/[\x00-\x1f\x7f]/.test(raw)) {
    const err = new Error('retro-path contains a control character');
    err.code = 'A1_INPUT';
    throw err;
  }
}

// Locate the repo root the same way the rest of the facade does (git, not a
// hardcoded relative path from __dirname, so this works whether a1-tools.cjs
// is invoked from a worktree or the primary checkout).
function repoRoot() {
  const { execSync } = require('child_process');
  try {
    return execSync('git rev-parse --show-toplevel', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (_e) {
    // Fall back to two levels up from this file (_shared/lib/ -> repo root),
    // matching the fixture suites' own REPO_ROOT computation.
    return path.resolve(__dirname, '..', '..');
  }
}

function registryPath() {
  return path.join(repoRoot(), '_shared', 'gates-registry.md');
}

// Parse the `gates_fired:` block-of-objects shape
// (`- {id: x, verdict: y, caught: z}`) that parseFrontmatter() (io.cjs)
// already isolates as a list of RAW STRINGS (io.cjs does not parse nested
// objects — see its own header comment). This function turns those raw
// strings into {id, verdict, caught} without widening io.cjs: a second
// change to that shared parser in the same week it grew inline-array support
// is exactly how a regression enters, per the brief for this wave.
//
// Returns { entries, malformed } — `malformed` is true if gates_fired was
// present as a raw string (parseFrontmatter's "no list items matched"
// fallback keeps unparsed content as a bare string/null) or if any list item
// does not match the `{id: ..., ...}` shape at all. Distinguishing "field
// absent" (undefined) from "field present but garbage" (malformed: true) is
// the whole point of the exit-0-vs-exit-2 asymmetry above.
const GATES_ITEM_RE = /^\{\s*id:\s*([^,}]+?)\s*(?:,\s*verdict:\s*([^,}]+?)\s*)?(?:,\s*caught:\s*([^,}]+?)\s*)?\}$/;

function parseGatesFired(fm) {
  if (!Object.prototype.hasOwnProperty.call(fm, 'gates_fired')) {
    return { present: false, entries: [], malformed: false };
  }
  const raw = fm.gates_fired;
  if (!Array.isArray(raw)) {
    // parseFrontmatter emits a bare scalar/null when the key had a value but
    // no `- ` list items followed it (e.g. `gates_fired: garbage` or
    // `gates_fired:` immediately followed by non-list content). That is
    // "present but unparseable" — exactly the case the asymmetry names.
    return { present: true, entries: [], malformed: true };
  }
  const entries = [];
  let malformed = false;
  for (const item of raw) {
    const m = typeof item === 'string' ? item.match(GATES_ITEM_RE) : null;
    if (!m) {
      malformed = true;
      continue;
    }
    entries.push({
      id: m[1].trim(),
      verdict: m[2] ? m[2].trim() : undefined,
      caught: m[3] ? m[3].trim() : undefined,
    });
  }
  return { present: true, entries, malformed };
}

/**
 * `retro validate <retro-path> [--registry <path>]` — see module header for
 * the full contract. `--registry` overrides the repo-resolved
 * `_shared/gates-registry.md` and exists SOLELY so SC-002 (a registry
 * mutation must be able to turn a previously-green retro red) is testable
 * without mutating the real registry in place — mirrors realpath-check's own
 * `--evidence <path>` override for the same reason (a sane default derived
 * from context, plus an explicit escape hatch for fixtures/non-standard
 * layouts). Production call sites (retro-template.md's snippet) never pass
 * it.
 * @param {string[]} argv
 */
function resolveRetroPath(flags) {
  // Reject leftovers. `parseFlags` parks unrecognised tokens in `_` without
  // complaining, so `--registr <path>` (one character short) was silently
  // dropped and the run validated against the REAL registry while reporting
  // success — a green run over the wrong input, the class this command exists
  // to remove. Found by a1-reinhard-reviewer 2026-09-12: Wave 3 fixed exactly
  // this in `workflow lint` and did not apply it to its sibling.
  const leftovers = flags._.slice(1).concat(
    flags._.slice(0, 1).filter((t) => String(t).startsWith('--'))
  );
  if (leftovers.length > 0) {
    process.stderr.write(
      `usage error: unrecognised argument(s): ${leftovers.join(' ')}\n` +
        '  usage: retro validate <retro-path> [--registry <path>]\n'
    );
    process.exit(1);
  }

  const retroPathRaw = flags._[0];
  rejectHostilePath(retroPathRaw);

  const retroPath = path.resolve(process.cwd(), retroPathRaw);

  let stat;
  try {
    stat = fs.statSync(retroPath);
  } catch (_e) {
    process.stderr.write(`error: retro file not found: ${retroPath}\n`);
    process.exit(2);
  }
  if (!stat.isFile()) {
    process.stderr.write(`error: retro path is not a regular file: ${retroPath}\n`);
    process.exit(2);
  }
  return retroPath;
}

/**
 * Read the registry text, honouring the test-only `--registry` override.
 * Exits 2 when it cannot be read: an unreadable registry must never be
 * mistaken for "no ids are registered", which would turn every drift entry
 * into a silent pass.
 * @param {object} flags parsed flags
 * @returns {string} raw registry markdown
 */
function loadRegistryText(flags) {
  const regPath = flags.registry ? path.resolve(process.cwd(), flags.registry) : registryPath();
  let registryText;
  try {
    registryText = fs.readFileSync(regPath, 'utf8');
  } catch (_e) {
    process.stderr.write(`error: registry unreadable: ${regPath}\n`);
    process.exit(2);
  }
  return registryText;
}

/**
 * `retro validate <retro-path> [--registry <path>]` — see module header for
 * the full contract and the exit-code semantics.
 *
 * Argument resolution and registry loading were split into their own
 * functions on 2026-09-12 (a1-reinhard-reviewer NIT, coding-style.md's
 * 50-line rule): this was 94 logic lines and read as three unrelated phases.
 * @param {string[]} argv
 */
function cmdRetroValidate(argv) {
  const flags = parseFlags(argv, { registry: 'value' });
  const retroPath = resolveRetroPath(flags);
  const expanded = expandRangeIds(parseRegistryIds(loadRegistryText(flags)));

  const retroText = fs.readFileSync(retroPath, 'utf8');
  let fm;
  try {
    ({ fm } = parseFrontmatter(retroText));
  } catch (e) {
    process.stderr.write(`error: retro file frontmatter unreadable: ${e.message}\n`);
    process.exit(2);
  }

  const { present, entries: rawEntries, malformed } = parseGatesFired(fm);

  if (present && malformed) {
    process.stderr.write(
      `error: gates_fired block in ${retroPath} is present but unparseable — ` +
        'expected "- {id: <slug>, verdict: <pass|fail>, caught: <true|false>}" items.\n' +
        'A malformed block is NOT treated as "no gates": fix the shape rather than ' +
        'removing it, or this run\'s gate attributions vanish exactly like an ' +
        'unregistered id would (invariant 7).\n'
    );
    process.exit(2);
  }

  if (!present) {
    // Missing field is legitimate for read-only reporter skills
    // (retro-template.md). Nothing to validate; still print the JSON shape
    // so callers can rely on a stable contract regardless of exit path.
    const out = { file: retroPath, entries: [], valid: 0, drift: 0, unknown: 0 };
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  }

  const results = rawEntries.map((entry, idx) => {
    const r = resolveGateId(entry.id, expanded);
    return { id: entry.id, status: r.status, canonical: r.canonical, line: idx + 1 };
  });

  reportAndExit(retroPath, results);
}

/**
 * Emit the JSON report on stdout, the fix instructions on stderr, and own the
 * exit code (0 all registered / 1 at least one drift or unknown). Split out
 * with the two resolvers on 2026-09-12 — see `cmdRetroValidate`.
 *
 * The stream split is part of the contract, not formatting: a caller
 * distinguishes "drift found" from "you called me wrong" — both exit 1 — by
 * whether stdout carries the report.
 * @param {string} retroPath
 * @param {{id: string, status: string, canonical?: string, line: number}[]} results
 */
function reportAndExit(retroPath, results) {
  const valid = results.filter((r) => r.status === 'ok').length;
  const drift = results.filter((r) => r.status === 'drift').length;
  const unknown = results.filter((r) => r.status === 'unknown').length;

  const toEntry = (r) =>
    r.canonical
      ? { id: r.id, status: r.status, canonical: r.canonical, line: r.line }
      : { id: r.id, status: r.status, line: r.line };

  process.stdout.write(
    JSON.stringify({ file: retroPath, entries: results.map(toEntry), valid, drift, unknown }) + '\n'
  );

  if (drift === 0 && unknown === 0) {
    process.exit(0);
  }

  for (const r of results) {
    if (r.status === 'drift') {
      process.stderr.write(
        `fix: "${r.id}" is not a registered gate id — use \`${r.canonical}\` instead ` +
          `(gates_fired entry ${r.line}).\n`
      );
    } else if (r.status === 'unknown') {
      process.stderr.write(
        `fix: "${r.id}" is not registered and has no known canonical id — add a row to ` +
          `_shared/gates-registry.md per invariant 7 (gates are registered), or correct ` +
          `the id if this was a typo (gates_fired entry ${r.line}).\n`
      );
    }
  }
  process.exit(1);
}

module.exports = { cmdRetroValidate, parseGatesFired, registryPath };
