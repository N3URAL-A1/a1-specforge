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
                  sites (CI) pass neither.`;

module.exports = { GATES_HELP };
