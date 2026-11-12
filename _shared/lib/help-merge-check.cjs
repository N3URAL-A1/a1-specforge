'use strict';

// Help text of `pr merge-check` (spec 017 FR-036/FR-037). Kept out of help.cjs (size).
const MERGE_CHECK_HELP = `  a1-tools pr merge-check --pr <n> [--base <ref>] [--bug <fix-report-id>] [--project <dir>] [--slug <project>] [--no-ci-evidence]
                  Spec 017-enforced-self-checks. The last check before \`gh pr merge\`. Runs the suites on head and on the
                  merge-base of <ref> (verify run --base --no-cache: a result cache is never trusted), reads \`gh pr checks <n> --required\` (binary
                  seam A1_GH_BIN; an override is announced on stderr and reported as gh_bin: "override"), compares
                  .a1/verify.json flaky_base with the base and reads the disposition review state.
                  CI evidence (opt-in): .a1/verify.json key ci_evidence {workflow, checks:[names], unchanged:[repo-relative paths]}. Only entries of
                  that GitHub Actions workflow, event pull_request, linked to github.com/.../actions/runs/ count (commit statuses and other
                  apps are ignored); \`checks\` is the minimum set that must be present exactly once, and EVERY counted entry of the workflow
                  must pass. All green on the PR head, ci_evidence equal at the tip of the base ref, and neither .a1/verify.json nor an
                  unchanged path differs from the merge-base: the local suite runs are skipped (suites.verdict ci_evidence). A red or cancelled
                  entry gives ci_check_red, a pending one (or a configured name absent while the workflow still has a pending job) ci_check_pending,
                  and a PR head that moved while the checks were read head_moved (all exit 1, no local run). A missing or duplicated name, a skipped
                  unlisted job, a config or path change, a base without the same ci_evidence, --no-ci-evidence or an A1_GH_BIN override
                  fall back to the local run. The shortcut exists only for plans without a counting reporter (every command reporter none): skip_increase,
                  zero_tests, implausible_crash, retry and the --bug path are verdicts of the local run (why: counting_reporter); a base-red suite cleared with --bug
                  needs --no-ci-evidence (CI red stays ci_check_red). --no-ci-evidence does not parse ci_evidence at all.
                  The report carries ci_evidence {used, why, checks}.
                  Exit 0 nothing red; exit 1 reasons[] on stdout: head_mismatch (local HEAD is not the PR head from gh, or the tree is
                  dirty), dispositions_uncommitted (.a1/dispositions.json differs from HEAD: commit and push it), suite_red_on_head,
                  base_red_unreported, bug_unresolved, required_check_red, required_check_pending, flaky_base_grown,
                  disposition_unreviewed, disposition_overturned, disposition_self_reviewed (a verdict without reviewed_by/reviewed_at,
                  or by the entry's own author), fidelity_config_changed (.a1/fidelity.json differs from the base),
                  probes_config_changed (.a1/live-probes.yaml added, changed or deleted against the base; for both config files also a change of the
                  checkout-relevant .gitattributes values text/eol/crlf/working-tree-encoding/filter/ident, change=attributes);
                  suite_red_on_head with cause verify_config_changed (.a1/verify.json differs from the base) or suite_removed (an "each" suite of the
                  base is gone at HEAD; report suites.suite_removed.fingerprint);
                  exit 2 usage, gh failure, unresolvable base. The report carries head_sha (pass it to
                  \`gh pr merge --match-head-commit\`), upheld_dispositions[] (entries new/changed on the branch that were upheld).
                  --bug <id>: a test red on head AND base needs an a1-fix report (frontmatter type: bug-report, bug_slug, status) in the
                  vault (project/<slug>/fixes/<id>.md) or committed at the base (.a1/fixes/<id>.md); a report the branch adds does not count.
                  One --bug clears ALL base-red ids of the run, it is not matched per id. Required checks that are red on head are never
                  compared with the base: a required check red on both sides still blocks.
                  Clearing verify_config_changed / suite_removed / fidelity_config_changed / probes_config_changed: no flag exists. Run \`disposition add --kind config_change
                  --fingerprint <fp> --reason <why> --by <you>\` (fp = suites.config_changed.fingerprint or suites.suite_removed.fingerprint for verify.json, the
                  fingerprint of the fidelity_config_changed or probes_config_changed reason for those files), have a second reviewer run \`disposition review <fp> --verdict upheld --by <reviewer>\`,
                  commit and push .a1/dispositions.json, run the merge check again. The fingerprint covers the exact head content: change the
                  config again and the verdict no longer matches.
                  A special .a1 state (a symlinked .a1, an .a1 that is a submodule, or a non-ASCII or case-variant name under .a1) on either side
                  blocks every merge-check as fidelity_config_changed / probes_config_changed even when it is unchanged between base and head;
                  only a config_change disposition for the reported fingerprint clears it.`;

module.exports = { MERGE_CHECK_HELP };
