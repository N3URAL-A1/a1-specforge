'use strict';

// optin-logs — the opt-in switch for the audit files a default run does not need (spec 027 slice 5, FR-032, D9).
// Scope: the single file in OPTIN_FILES. The `*.last-run.json` files all have a reader and stay always-on; the self-repair trail
// is written to the observation line (`recovery`), never to this log. `bin/check-optin-readers.cjs` lists the readers of a
// candidate file name: a line that names it is a reader unless a MENTIONS_ALLOWED entry matches that very line.
// Limit: that scan is literal and line-based. Not seen: a reader through a constant (a path built from LOG_FILE), a name from split or
// concatenated literals, a file with an extension outside the scanned set (.py, .ts, .txt), a non-executable file without an extension,
// and logic in this module itself (a redefined entry(): the checker executes it). The writer constants are pinned by their own entries below.

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
 * holds it. No whole-file entries. `bin/check-optin-readers.cjs` enforces this: a shorter `contains` is a contract violation,
 * an entry covers exactly one line (a second line with the same text is a reader), an entry that covers no line is stale.
 * Not covered (literal scan): a reader through a constant such as LOG_FILE, split literals, other extensions, logic in this module.
 * An entry whose `contains` names no OPTIN_FILES entry is a contract violation (it could never cover a line).
 * @type {ReadonlyArray<{file: string, contains: string, reason: string}>}
 */
const MENTIONS_ALLOWED = Object.freeze([
  entry('_shared/lib/xprov-run.cjs', 'a1 writes PLAN-REVIEW-LOG.md itself', 'writer comment'),
  entry('_shared/lib/xprov-run.cjs', "const LOG_FILE = 'PLAN-REVIEW-LOG.md';", 'writer constant'),
  entry('_shared/lib/xprov-run.cjs', 'log (a1 owns PLAN-REVIEW-LOG.md)', 'writer section comment'),
  entry('_shared/lib/xprov-gate.cjs', '.a1/phases/<name>/PLAN-REVIEW-LOG.md naming the step and', 'writer comment'),
  entry('_shared/lib/xprov-gate.cjs', "const LOG_FILE = 'PLAN-REVIEW-LOG.md';", 'writer constant'),
  entry('_shared/lib/xprov-gate.cjs', 'no a1 write at all — no PLAN-REVIEW-LOG.md entry', 'writer comment'),
  entry('_shared/lib/xprov-gate-nopermit.cjs', 'carries no a1 write: no PLAN-REVIEW-LOG.md entry', 'comment'),
  entry('_shared/lib/help-xprov.cjs', 'PLAN-REVIEW-LOG.md, .a1/xprov.json (permit record)', 'file list in the help text'),
  entry('_shared/lib/help-xprov-topics.cjs', 'with \\`A1_KEEP_REVIEW_LOGS=1\\`, in the log entry of \\`PLAN-REVIEW-LOG.md\\`', 'edge-cases topic, opt-in stated on the line'),
  entry('skills/a1-plan/SKILL.md', '`PLAN-REVIEW-LOG.md` (only with `A1_KEEP_REVIEW_LOGS=1`) |', 'phase table output cell, opt-in stated on the line'),
  entry('skills/a1-plan/SKILL.md', '├── PLAN-REVIEW-LOG.md    (Phase 4b, append-only, only with `A1_KEEP_REVIEW_LOGS=1`)', 'tree listing, opt-in stated on the line'),
  entry('skills/a1-plan/workflows/04b-xprov-review.md', 'with `A1_KEEP_REVIEW_LOGS=1` it also appends to `.a1/phases/<phase_name>/PLAN-REVIEW-LOG.md`', 'driver writes it, opt-in stated on the line'),
]);

module.exports = { OPTIN_ENV, OPTIN_FILES, MENTIONS_ALLOWED, keepReviewLogs };
