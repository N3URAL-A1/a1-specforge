'use strict';

// Help text of `pr merge-check` (spec 017 FR-036/FR-037). Kept out of help.cjs (size).
const MERGE_CHECK_HELP = `  a1-tools pr merge-check --pr <n> [--base <ref>] [--bug <fix-report-id>] [--project <dir>] [--slug <project>]
                  Spec 017-enforced-self-checks. The last check before \`gh pr merge\`. Runs the suites on head and on the
                  merge-base of <ref> (verify run --base --no-cache: a result cache is never trusted), reads \`gh pr checks <n> --required\` (binary
                  seam A1_GH_BIN; an override is announced on stderr and reported as gh_bin: "override"), compares
                  .a1/verify.json flaky_base with the base and reads the disposition review state.
                  Exit 0 nothing red; exit 1 reasons[] on stdout: head_mismatch (local HEAD is not the PR head from gh, or the tree is
                  dirty), dispositions_uncommitted (.a1/dispositions.json differs from HEAD: commit and push it), suite_red_on_head,
                  base_red_unreported, bug_unresolved, required_check_red, required_check_pending, flaky_base_grown,
                  disposition_unreviewed, disposition_overturned, disposition_self_reviewed (a verdict without reviewed_by/reviewed_at,
                  or by the entry's own author), fidelity_config_changed (.a1/fidelity.json differs from the base);
                  suite_red_on_head with cause verify_config_changed (.a1/verify.json differs from the base) or suite_removed (an "each" suite of the
                  base is gone at HEAD; report suites.suite_removed.fingerprint);
                  exit 2 usage, gh failure, unresolvable base. The report carries head_sha (pass it to
                  \`gh pr merge --match-head-commit\`), upheld_dispositions[] (entries new/changed on the branch that were upheld).
                  --bug <id>: a test red on head AND base needs an a1-fix report (frontmatter type: bug-report, bug_slug, status) in the
                  vault (project/<slug>/fixes/<id>.md) or committed at the base (.a1/fixes/<id>.md); a report the branch adds does not count.
                  One --bug clears ALL base-red ids of the run, it is not matched per id. Required checks that are red on head are never
                  compared with the base: a required check red on both sides still blocks.
                  Clearing verify_config_changed / suite_removed / fidelity_config_changed: no flag exists. Run \`disposition add --kind config_change
                  --fingerprint <fp> --reason <why> --by <you>\` (fp = suites.config_changed.fingerprint or suites.suite_removed.fingerprint for verify.json, the
                  fingerprint of the fidelity_config_changed reason for fidelity.json), have a second reviewer run \`disposition review <fp> --verdict upheld --by <reviewer>\`,
                  commit and push .a1/dispositions.json, run the merge check again. The fingerprint covers the exact head content: change the
                  config again and the verdict no longer matches.`;

module.exports = { MERGE_CHECK_HELP };
