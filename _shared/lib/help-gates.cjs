'use strict';

// Help text of the `gates` group (spec 017). Kept out of help.cjs (622 lines).
const GATES_HELP = `  a1-tools gates lint [--root <path>] [--registry <path>] [--today YYYY-MM-DD]
                  Spec 017-enforced-self-checks, Wave 1. Reads the registry
                  (_shared/gates-registry.md) and checks the \`invoke\` column:
                  each cell is \`<subcommand>\` @ skill[,skill] (the named skills
                  must call it in a fenced bash block of SKILL.md or
                  workflows/*.md - prose does not count), \`external\`, or
                  \`none\` (prompt / human gates). Optional exemption suffix
                  "; unwired_until=<YYYY-MM-DD>; unwired_reason=<text>": listed
                  on every run, passes until the date, fails the day after.
                  Findings: no_invoke_column, malformed_row, invoke_invalid,
                  blocking_unwired, prompt_names_command, duplicate_subcommand,
                  unknown_skill, unwired, exemption_expired.
                  Exit: 0 all wired / 1 at least one finding / 2 usage, unknown
                  flag, hostile value, unreadable root or registry.
                  --registry and --today are test escape hatches (a fixture
                  registry; a fixed date for the expiry cases); production call
                  sites (CI) pass neither.
  a1-tools gates lint --log <file>
                  Spec 017, Wave 2 (FR-010). Checks one gate log
                  (.a1/phases/<scope>/gate-log.jsonl): every line must be a
                  well-formed record and its \`prev\` must equal the sha256 of
                  the previous line (first line: 64 zeros). Registry checks do
                  not run in this mode. Exit: 0 intact / 1 malformed line or
                  broken chain / 2 log unreadable.
  a1-tools gates fired --log <file>
                  Spec 017, Wave 2 (FR-009). Prints the gates_fired YAML block
                  derived from a gate log: one item per gate id with the verdict
                  of its LAST line (log verdict "error" prints as "fail") and
                  caught: true when the log holds a fail line for it. Paste it
                  into the retro. Exit: 0 / 2 log unreadable or not intact.
  Gate log (FR-008): every call of a subcommand named in a registry invoke cell
                  appends one line to .a1/phases/<scope>/gate-log.jsonl of the
                  current git work tree. Call sites pass --phase <scope>
                  (a1-execute: phase name; a1-new-feature: spec id; a1-fix:
                  fix-<bug-slug>; a1-pr-review: pr-<number>); without it the
                  line goes to _unscoped with one stderr notice. A bad scope is
                  exit 2 before the command runs. The log is git-excluded.`;

module.exports = { GATES_HELP };
