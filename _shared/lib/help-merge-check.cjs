'use strict';

// Help text of `pr merge-check` (spec 017 FR-036/FR-037). Kept out of help.cjs (size).
const MERGE_CHECK_HELP = `  a1-tools pr merge-check --pr <n> [--base <ref>] [--bug <fix-report-id>] [--accept-config-change <reason>] [--project <dir>] [--slug <project>]
                  Spec 017-enforced-self-checks. The last check before \`gh pr merge\`. Runs the suites on head and on the
                  merge-base of <ref> (verify run --base, cache reused), reads \`gh pr checks <n> --required\` (binary
                  seam A1_GH_BIN; an override is announced on stderr and reported as gh_bin: "override"), compares
                  .a1/verify.json flaky_base with the base and reads the disposition review state.
                  Exit 0 nothing red; exit 1 reasons[] on stdout: head_mismatch (local HEAD is not the PR head from gh, or the tree is
                  dirty), dispositions_uncommitted (.a1/dispositions.json differs from HEAD: commit and push it), suite_red_on_head,
                  base_red_unreported, bug_unresolved, required_check_red, required_check_pending, flaky_base_grown,
                  disposition_unreviewed, disposition_overturned, disposition_self_reviewed (a verdict without reviewed_by/reviewed_at,
                  or by the entry's own author), fidelity_config_changed (.a1/fidelity.json differs from the base);
                  exit 2 usage, gh failure, unresolvable base. The report carries head_sha (pass it to
                  \`gh pr merge --match-head-commit\`), upheld_dispositions[] (entries new/changed on the branch that were upheld) and
                  config_change_accepted[].
                  --bug <id>: a test red on head AND base needs an a1-fix report (frontmatter type: bug-report, bug_slug, status) in the
                  vault (project/<slug>/fixes/<id>.md) or committed at the base (.a1/fixes/<id>.md); a report the branch adds does not count.
                  One --bug clears ALL base-red ids of the run, it is not matched per id. Required checks that are red on head are never
                  compared with the base: a required check red on both sides still blocks.
                  --accept-config-change <reason>: clears fidelity_config_changed once; the reason is written to config_change_accepted[].
                  The lasting alternative is an upheld config_change disposition from a second reviewer (see \`disposition add --kind config_change\`).`;

module.exports = { MERGE_CHECK_HELP };
