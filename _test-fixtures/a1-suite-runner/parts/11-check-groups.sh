# Part 11 (Wave 7, spec 026 FR-016/FR-017) — CI job groups: `--job <name>` and `--check-groups`.
# Sourced by run-tests.sh (after 10-failure).
# `--job <name>` runs exactly the identities listed under ci_jobs.<name> in suite-groups.json (unknown name
# or an entry that vanished: exit 2, nothing started). `--check-groups` starts nothing (no lock, no work dir,
# no log dir) and exits 1 naming the entry when: a discovered runner is in zero jobs or in two jobs; a path
# listed under serial/no_count/ci_jobs/timings.seconds is no discovered runner any more; a
# `run-suites.sh --job <name>` call in .github/workflows/test.yml names no ci_jobs entry; a ci_jobs entry is
# called by no workflow line. Exit 0 on a consistent tree.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  Q1  --job ignored (all suites run, probe count differs) / unknown job not exit 2
#  Q2  --check-groups starts suites or creates the lock/work/log dir
#  Q3  zero-jobs check dropped (new-suite/run-tests.sh passes)
#  Q4  two-jobs check dropped
#  Q5  vanished-path check only for ci_jobs (serial/no_count/timings entry passes)
#  Q6  workflow job name not compared with ci_jobs / ci_jobs name never required in the workflow
#  Q7  a discovery from a fixed list: the planted new suite is not in the pool of a full run

# cg_tree <VAR> <label> <groups-json> — a planted tree with the given declaration file and green suites a,b.
cg_tree() {
  mk_workdir "$1" "$2"
  local d="${!1}"
  mkdir -p "$d/_test-fixtures" "$d/.github/workflows"
  printf '%s\n' "$3" > "$d/_test-fixtures/suite-groups.json"
}
# cg_wf <tree> <job>... — a workflow with one `--job` line per name.
cg_wf() {
  local t="$1" j; shift
  { echo "jobs:"; for j in "$@"; do
      printf '  %s:\n    steps:\n      - name: Fixtures\n        run: bash bin/run-suites.sh --job %s\n' "$j" "$j"
    done
    echo "  # a comment naming bin/run-suites.sh --job ghost is no call"; } > "$t/.github/workflows/test.yml"
}
cg_state() { find "$RS_TMPD" -mindepth 1 | grep -c ''; }
cg_probe() { # tree identity — a green suite that leaves a probe line
  plant_suite "$1" "$2" "echo ran >> \"$CG_W/probe-\${0//\//__}\"; echo '$2: 1 passed, 0 failed'"
}
mk_workdir CG_W cgw
GOOD='{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh"],"j2":["b/run-tests.sh"]},"timings":{"measured":null,"seconds":{"a/run-tests.sh":5}}}'

# consistent tree
cg_tree T_CG cg1 "$GOOD"; cg_probe "$T_CG" a/run-tests.sh; cg_probe "$T_CG" b/run-tests.sh; cg_wf "$T_CG" j1 j2
rs_run "$T_CG" --check-groups
assert_eq "Q0a consistent tree: exit 0" "$RS_RC" "0"
assert_eq "Q2a --check-groups started no suite" "$(find "$CG_W" -maxdepth 1 -name 'probe-*' | grep -c '')" "0"
assert_eq "Q2b --check-groups left no lock, work dir or log dir" "$(cg_state)" "0"

# --job runs exactly its identities
rm -f "$CG_W"/probe-*
rs_run "$T_CG" --job j1
assert_eq "Q1a --job j1 exit 0" "$RS_RC" "0"
assert_file_present "Q1b a ran" "$CG_W/probe-_test-fixtures__a__run-tests.sh"
assert_file_absent "Q1c b did not run" "$CG_W/probe-_test-fixtures__b__run-tests.sh"
assert_contains "Q1d header is a subset run of a" "$RS_OUT" "subset run: a/run-tests.sh"
rm -f "$CG_W"/probe-*
rs_run "$T_CG" --job nope
assert_eq "Q1e unknown job: exit 2" "$RS_RC" "2"
assert_contains "Q1f unknown job named" "$RS_OUT" "nope"
assert_eq "Q1g unknown job: nothing started, nothing left" "$(find "$CG_W" -maxdepth 1 -name 'probe-*' | grep -c '')/$(cg_state)" "0/0"
rs_run "$T_CG" --job j1 b/run-tests.sh
assert_eq "Q1h --job together with a selector: exit 2" "$RS_RC" "2"
rs_run "$T_CG" --job
assert_eq "Q1i --job without a value: exit 2" "$RS_RC" "2"

# zero jobs: a runner nobody lists
cg_tree T_CG0 cg0 "$GOOD"; cg_probe "$T_CG0" a/run-tests.sh; cg_probe "$T_CG0" b/run-tests.sh
cg_probe "$T_CG0" new-suite/run-tests.sh; cg_wf "$T_CG0" j1 j2
rs_run "$T_CG0" --check-groups
assert_eq "Q3a runner in zero jobs: exit 1" "$RS_RC" "1"
assert_contains "Q3b the entry is named" "$RS_OUT" "new-suite/run-tests.sh"
assert_contains "Q3c the message says no job" "$RS_OUT" "in no ci job"
rm -f "$CG_W"/probe-*
rs_run "$T_CG0"
assert_contains "Q7a a full run picks the new suite up (pool, no edit)" "$RS_OUT" "new-suite/run-tests.sh"
assert_file_present "Q7b the new suite ran" "$CG_W/probe-_test-fixtures__new-suite__run-tests.sh"

# two jobs
cg_tree T_CG2 cg2 '{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh","b/run-tests.sh"],"j2":["b/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}'
cg_probe "$T_CG2" a/run-tests.sh; cg_probe "$T_CG2" b/run-tests.sh; cg_wf "$T_CG2" j1 j2
rs_run "$T_CG2" --check-groups
assert_eq "Q4a runner in two jobs: exit 1" "$RS_RC" "1"
assert_contains "Q4b the entry and both jobs are named" "$RS_OUT" "b/run-tests.sh: in two ci jobs (j1, j2)"

# vanished path, one case per list
for sect in serial no_count ci_jobs timings; do
  case "$sect" in
    serial)   js='{"serial":["gone/run-tests.sh"],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}' ;;
    no_count) js='{"serial":[],"no_count":["gone/run-tests.sh"],"ci_jobs":{"j1":["a/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}' ;;
    ci_jobs)  js='{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh","gone/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}' ;;
    timings)  js='{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh"]},"timings":{"measured":null,"seconds":{"gone/run-tests.sh":9}}}' ;;
  esac
  cg_tree T_CGV "cgv-$sect" "$js"; cg_probe "$T_CGV" a/run-tests.sh; cg_wf "$T_CGV" j1
  rs_run "$T_CGV" --check-groups
  assert_eq "Q5 vanished path under $sect: exit 1" "$RS_RC" "1"
  assert_contains "Q5 vanished path under $sect: named with its list" "$RS_OUT" "gone/run-tests.sh: listed under $sect but no such suite"
done

# workflow <-> ci_jobs
cg_tree T_CGW cgw1 "$GOOD"; cg_probe "$T_CGW" a/run-tests.sh; cg_probe "$T_CGW" b/run-tests.sh; cg_wf "$T_CGW" j1 j2 j3
rs_run "$T_CGW" --check-groups
assert_eq "Q6a workflow calls a job missing from ci_jobs: exit 1" "$RS_RC" "1"
assert_contains "Q6b the job is named" "$RS_OUT" "workflow calls --job j3 but ci_jobs has no such job"
assert_absent "Q6c a commented call is no call" "$RS_OUT" "ghost"
cg_tree T_CGX cgx "$GOOD"; cg_probe "$T_CGX" a/run-tests.sh; cg_probe "$T_CGX" b/run-tests.sh; cg_wf "$T_CGX" j1
rs_run "$T_CGX" --check-groups
assert_eq "Q6d a ci_jobs entry no workflow line calls: exit 1" "$RS_RC" "1"
assert_contains "Q6e the job is named" "$RS_OUT" "ci job j2 is called by no workflow line"
rm -f "$T_CGX/.github/workflows/test.yml"
rs_run "$T_CGX" --check-groups
assert_eq "Q6f no workflow file: exit 2" "$RS_RC" "2"

# the real tree
rs_run "$REPO_ROOT" --check-groups
assert_eq "Q8 the real tree is consistent (exit 0)" "$RS_RC" "0"

# ---- PR review fix round (SEC-4): the call regex and calls that cannot gate ----
# cg_wf_raw <tree> <job-block> — a workflow whose single job holds the given step text (indented 6).
cg_wf_raw() { printf 'jobs:\n  fx:\n    runs-on: ubuntu-latest\n    steps:\n%s\n' "$2" > "$1/.github/workflows/test.yml"; }
cg_one() { # label step-text want-rc want-text — a tree with one ci job j1 and one workflow step
  cg_tree T_CGS "cgs-$1" '{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}'
  cg_probe "$T_CGS" a/run-tests.sh
  cg_wf_raw "$T_CGS" "$2"
  rs_run "$T_CGS" --check-groups
  assert_eq "Q9-$1 exit code" "$RS_RC" "$3"
  [[ -z "${4:-}" ]] || assert_contains "Q9-$1 names the job" "$RS_OUT" "$4"
}
cg_one accept-eq   '      - name: Fixtures
        run: bash bin/run-suites.sh --job=j1' 0
cg_one accept-quote '      - name: Fixtures
        run: bash bin/run-suites.sh --job "j1"' 0
cg_one accept-flags '      - name: Fixtures
        run: bash bin/run-suites.sh --workers 2 --job j1' 0
cg_one accept-dup '      - name: Fixtures
        run: |
          bash bin/run-suites.sh --job j1
          bash bin/run-suites.sh --job j1' 0
cg_one refuse-if '      - name: Fixtures
        if: ${{ always() }}
        run: bash bin/run-suites.sh --job j1' 1 "j1"
assert_contains "Q9-refuse-if says why" "$RS_OUT" "if:"
cg_one refuse-coe '      - name: Fixtures
        continue-on-error: true
        run: bash bin/run-suites.sh --job j1' 1 "j1"
assert_contains "Q9-refuse-coe says why" "$RS_OUT" "continue-on-error"
cg_one refuse-or-true '      - name: Fixtures
        run: bash bin/run-suites.sh --job j1 || true' 1 "j1"
cg_one refuse-echo '      - name: Fixtures
        run: echo bash bin/run-suites.sh --job j1' 1 "j1"
cg_one refuse-job-coe '      - name: Fixtures
        run: bash bin/run-suites.sh --job j1
    continue-on-error: true' 1 "j1"
# an `if:` on ANOTHER step does not taint the call
cg_one other-step-if '      - name: Other
        if: always()
        run: echo hi
      - name: Fixtures
        run: bash bin/run-suites.sh --job j1' 0
# a ghost job called twice is one finding
cg_tree T_CGD cgd '{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}'
cg_probe "$T_CGD" a/run-tests.sh
cg_wf_raw "$T_CGD" '      - name: Fixtures
        run: |
          bash bin/run-suites.sh --job j1
          bash bin/run-suites.sh --job ghost
          bash bin/run-suites.sh --job=ghost'
rs_run "$T_CGD" --check-groups
assert_eq "Q9-dedupe a ghost job called twice is reported once" "$(printf '%s\n' "$RS_OUT" | grep -c 'calls --job ghost')" "1"
