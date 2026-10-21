'use strict';

// Help text of `pr merge-check` (spec 017 FR-036/FR-037). Kept out of help.cjs (size).
const MERGE_CHECK_HELP = `  a1-tools pr merge-check --pr <n> [--base <ref>] [--bug <fix-report-id>] [--project <dir>] [--slug <project>]
                  Spec 017-enforced-self-checks. The last check before \`gh pr merge\`. Runs the suites on head and on the
                  merge-base of <ref> (verify run --base, cache reused), reads \`gh pr checks <n> --required\` (binary
                  seam A1_GH_BIN), compares .a1/verify.json flaky_base with the base and reads the disposition review state.
                  Exit 0 nothing red; exit 1 reasons[] on stdout: suite_red_on_head, base_red_unreported, bug_unresolved,
                  required_check_red, required_check_pending, flaky_base_grown, disposition_unreviewed, disposition_overturned;
                  exit 2 usage, gh failure, unresolvable base. A test red on head AND base needs --bug <id> naming an a1-fix report
                  (vault project/<slug>/fixes/<id>.md or repo .a1/fixes/<id>.md).`;

module.exports = { MERGE_CHECK_HELP };
