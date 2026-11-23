'use strict';

// optin-logs — the opt-in switch for the audit files a default run does not need (spec 027 slice 5, FR-032, D9).
// Scope: PLAN-REVIEW-LOG.md only. The `*.last-run.json` files all have a reader and stay always-on; the self-repair trail
// is written to the observation line (`recovery`), never to this log. `bin/check-optin-readers.cjs` lists the readers of a
// candidate file name: a line that names it is a reader unless a MENTIONS_ALLOWED entry matches that very line.

const OPTIN_ENV = 'A1_KEEP_REVIEW_LOGS';

/** The opt-in files: written only when `keepReviewLogs()` is true. */
const OPTIN_FILES = Object.freeze(['PLAN-REVIEW-LOG.md']);

/** True only for the exact value `1`. Any other value (`yes`, `true`, `0`, empty) keeps the log off. */
function keepReviewLogs(env = process.env) {
  return env[OPTIN_ENV] === '1';
}

const entry = (file, contains, reason) => Object.freeze({ file, contains, reason });

/**
 * Line-exact allowlist of lines that name an opt-in file without reading it. `contains` is an exact substring (at least 20
 * characters, unique in that file, measured on the final text); a mention passes only when its file matches and the line
 * holds it. No whole-file entries.
 * @type {ReadonlyArray<{file: string, contains: string, reason: string}>}
 */
const MENTIONS_ALLOWED = Object.freeze([
  entry('_shared/lib/xprov-run.cjs', 'a1 writes PLAN-REVIEW-LOG.md itself', 'writer comment'),
  entry('_shared/lib/xprov-run.cjs', "const LOG_FILE = 'PLAN-REVIEW-LOG.md';", 'writer constant'),
  entry('_shared/lib/xprov-run.cjs', "const LOG_HEADER = '# PLAN-REVIEW-LOG", 'writer constant'),
  entry('_shared/lib/xprov-run.cjs', 'log (a1 owns PLAN-REVIEW-LOG.md)', 'writer section comment'),
  entry('_shared/lib/xprov-gate.cjs', '.a1/phases/<name>/PLAN-REVIEW-LOG.md naming the step and', 'writer comment'),
  entry('_shared/lib/xprov-gate.cjs', "const LOG_FILE = 'PLAN-REVIEW-LOG.md';", 'writer constant'),
  entry('_shared/lib/xprov-gate.cjs', 'no a1 write at all — no PLAN-REVIEW-LOG.md entry', 'writer comment'),
  entry('_shared/lib/xprov-gate-nopermit.cjs', 'carries no a1 write: no PLAN-REVIEW-LOG.md entry', 'comment'),
  entry('_shared/lib/help-xprov.cjs', 'PLAN-REVIEW-LOG.md, .a1/xprov.json (permit record)', 'file list in the help text'),
  entry('_shared/lib/help-xprov-topics.cjs', 'with \\`A1_KEEP_REVIEW_LOGS=1\\`, in the log entry of \\`PLAN-REVIEW-LOG.md\\`', 'edge-cases topic, opt-in stated on the line'),
  entry('skills/a1-plan/SKILL.md', '`xreview/index.json`, PLAN-REVIEW-LOG.md |', 'phase table output cell'),
  entry('skills/a1-plan/SKILL.md', '├── PLAN-REVIEW-LOG.md    (Phase 4b, append-only)', 'tree listing'),
  entry('skills/a1-plan/workflows/04b-xprov-review.md', '`.a1/phases/<phase_name>/PLAN-REVIEW-LOG.md`', 'driver writes it'),
  entry('skills/a1-plan/workflows/04b-xprov-review.md', 'log entry of `PLAN-REVIEW-LOG.md`: a `runner_failed`', 'moves to the edge-cases topic in Task 6.1'),
]);

module.exports = { OPTIN_ENV, OPTIN_FILES, MENTIONS_ALLOWED, keepReviewLogs };
