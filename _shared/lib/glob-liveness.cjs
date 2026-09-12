'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// glob-liveness — Wave 4 of spec 007-retro-gate-id-validator.
//
// A LIBRARY for fixtures, not a facade subcommand: no CLI dispatch, no
// registry row (it cannot block a pipeline on its own — the gates it serves
// are the fixture suites that call it). Its job is to turn "the glob is
// correctly shaped" from a reading into a measurement.
//
// THE DEFECT THIS EXISTS TO CATCH (measured 2026-09-11): the `quick` glob
// shipped as `.a1/learnings/projects/*/quick` (plural) where the real store
// is `project/` (singular). It matched ZERO files while 9 real quick records
// existed. It was CORRECTLY SHAPED and CORRECTLY DERIVED from the resolved
// root — a shape check (like a1-code-roots' caseF) passed it every time,
// because shape was never the defect. Only counting live matches catches it.
//
// THE DESIGN CONSTRAINT THAT MAKES THIS REAL (do not soften it): matches must
// be counted with the SAME expansion mechanism the consumer uses — the shell
// glob expansion documented in skills/a1-evolve/workflows/01-collect.md §1a
// (`ls -d "$R"/*/...`) — not a Node re-implementation (e.g. fs.readdir
// filtering) that could disagree with the shell's own `*` semantics. A
// helper that expands globs differently from its consumer can report matches
// while the consumer starves. `liveness()` therefore shells out to `ls -d`
// rather than walking directories itself. This is a deliberate, reviewed
// exception to the project's usual "no execSync with interpolated paths"
// rule (see learnings.cjs's header comment): the glob patterns handed to
// this helper are CLI-emitted or test-authored strings, never raw external
// input, and the whole point of this module is to measure the exact string
// the shell would receive — reimplementing it natively would defeat the
// purpose (see G5's expansion-parity fixture case).
// ---------------------------------------------------------------------------

/**
 * Materialise the shallowest concrete directory (or file) chain that
 * `globPattern` would match, substituting a literal token for each `*`
 * path segment, rooted under `baseDir`. Pure w.r.t. its inputs: returns the
 * planted path; the caller owns cleanup (its own `mktemp -d`).
 *
 * The last path segment decides directory vs. file: a segment containing a
 * `.` (e.g. `observations.jsonl`, `pack.yaml`) is planted as an empty file;
 * every other segment is planted as a directory. This matches the four glob
 * shapes `learnings roots --json` emits today (three directory-shaped, one
 * file-shaped) without hardcoding those specific names.
 *
 * @param {string} globPattern absolute glob pattern, e.g.
 *   "/tmp/x/*\/.a1/learnings/pattern/a1-learnings"
 * @param {string} baseDir directory the pattern is rooted under (used only
 *   to bound the literal token substitution; not otherwise consulted)
 * @returns {string} the concrete path that was planted
 */
function plantFor(globPattern, baseDir) {
  const relative = path.relative(baseDir, globPattern);
  const segments = relative.split(path.sep);
  const concreteSegments = segments.map((seg) => (seg === '*' ? 'planted' : seg));
  const concretePath = path.join(baseDir, ...concreteSegments);

  const lastSegment = concreteSegments[concreteSegments.length - 1];
  const isFileShaped = /\.[a-zA-Z0-9]+$/.test(lastSegment);

  if (isFileShaped) {
    fs.mkdirSync(path.dirname(concretePath), { recursive: true });
    fs.writeFileSync(concretePath, '');
  } else {
    fs.mkdirSync(concretePath, { recursive: true });
  }

  return concretePath;
}

/**
 * Count how many paths `globPattern` expands to via the SAME shell
 * expansion the real consumer uses (`ls -d`, per 01-collect.md §1a) —
 * never a Node-side re-implementation of glob semantics. Never throws on
 * zero matches: `ls -d` on a non-matching pattern exits non-zero, which is
 * swallowed here and reported as `matches: 0` so callers can assert `>= 1`
 * explicitly and fail loudly with the glob printed.
 *
 * @param {string} globPattern
 * @returns {number}
 */
function countLiveMatches(globPattern) {
  let out;
  try {
    // `ls -d <pattern>` under bash: the shell expands `*` before `ls` ever
    // runs, exactly as `01-collect.md`'s `ls -d "$R"/*/...` does. A pattern
    // with zero matches makes bash pass the literal (unexpanded) string to
    // `ls`, which then fails with "No such file or directory" — exit
    // non-zero, stdout empty. That failure IS the "zero matches" case, not
    // an error to propagate.
    out = execSync(`ls -d ${globPattern}`, {
      shell: '/bin/bash',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch (_e) {
    return 0;
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
}

/**
 * For each glob pattern: plant a matching target (unless `skipPlant` is
 * set), then count live matches with the consumer's own expansion
 * mechanism. Returns a new array — never mutates `globPatterns`.
 *
 * @param {string[]} globPatterns
 * @param {string} baseDir
 * @param {{skipPlant?: boolean}} [opts] skipPlant: measure the pattern
 *   as-is without planting anything for it first — used by fixtures that
 *   plant a DIFFERENT (mismatched) layout on purpose, to prove a glob whose
 *   target was never planted (or was planted under a different shape)
 *   reports zero rather than throwing.
 * @returns {{glob: string, planted: string|null, matches: number}[]}
 */
function liveness(globPatterns, baseDir, opts) {
  const options = opts || {};
  return globPatterns.map((glob) => {
    const planted = options.skipPlant ? null : plantFor(glob, baseDir);
    const matches = countLiveMatches(glob);
    return { glob, planted, matches };
  });
}

module.exports = { plantFor, liveness };
