# Part 16 (spec 027 FR-009, Task 7.2) — ci_extra_jobs, snapshot_incompatible, ci_job_workers: `--extra-job`,
# the D12 keys and their `--check-groups` findings. Sourced by run-tests.sh (after 15-locale-native; the
# cg_tree/cg_wf helpers come from part 11, which is sourced first). Planted trees have three suites a, b, c.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  (a) export guard removed (LC_ALL=C always exported) -> part 15 L2 · (b) extra-job call accepted without
#  --locale-native -> E4 · (c) .git refusal removed -> E11 · (d) needs: check removed -> E9 ·
#  (e) "rest" ignores the explicit ids of other jobs -> E10 · (f) exactly-once check removed -> E16 ·
#  (g) A1_XPROV_ONLY ban removed -> E17 · (h) ci_job_workers ignored -> E18a

EX_OKLINE="check-groups: ok, 3 suites in 1 ci jobs"
EX_KEYS='"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"]},"x-rest":{"kind":"snapshot-locale","suites":"rest"}},"snapshot_incompatible":{"b/run-tests.sh":"needs .git (fixture)"}'
EX_CALL='bash bin/run-suites.sh --locale-native --extra-job'
mk_workdir EX_W exw
# ex_json <extra-keys> [workers-json] — one ci job j1 over a, b, c plus the extra keys.
ex_json() {
  printf '{"serial":[],"no_count":[],"ci_jobs":{"j1":["a/run-tests.sh","b/run-tests.sh","c/run-tests.sh"]},%s%s"timings":{"measured":null,"seconds":{}}}' \
    "${1:+$1,}" "${2:+\"ci_job_workers\":$2,}"
}
# ex_tree <label> <extra-keys> [workers-json] — planted tree T_EX with probe suites a b c and the j1 workflow.
ex_tree() {
  local id
  cg_tree T_EX "ex-$1" "$(ex_json "$2" "${3:-}")"
  for id in a b c; do
    plant_suite "$T_EX" "$id/run-tests.sh" "echo ran >> \"$EX_W/probe-$id\"; echo '$id: 1 passed, 0 failed'"
  done
  cg_wf "$T_EX" j1
  rm -f "$EX_W"/probe-*
}
# ex_block <tree> <job> <call> [mods...] — appends one extra job block. mods: noarchive nogit nolocale needs
# xprov xprov-run sete if
ex_block() {
  local t="$1" job="$2" call="$3" m mods=" ${*:4} "
  {
    printf '  %s:\n' "$job"
    [[ "$mods" != *" needs "* ]] || printf '    needs: [j1]\n'
    [[ "$mods" != *" xprov "* ]] || printf '    env:\n      A1_XPROV_ONLY: "01"\n'
    printf '    steps:\n      - name: Snapshot\n'
    [[ "$mods" != *" if "* ]] || printf '        if: always()\n'
    printf '        run: |\n'
    [[ "$mods" != *" sete "* ]] || printf '          set +e\n'
    [[ "$mods" == *" noarchive "* ]] || printf '          git archive HEAD | tar -x -C "$RUNNER_TEMP/snap"\n'
    [[ "$mods" == *" nogit "* ]] || printf '          test ! -e "$RUNNER_TEMP/snap/.git"\n'
    [[ "$mods" == *" nolocale "* ]] || printf '          locale -a | grep -qi en_US\n'
    [[ "$mods" != *" xprov-run "* ]] || printf '          A1_XPROV_ONLY=01 true\n'
    printf '          %s\n' "$call"
  } >> "$t/.github/workflows/test.yml"
}
ex_both() { ex_block "$T_EX" x-one "$EX_CALL x-one"; ex_block "$T_EX" x-rest "$EX_CALL x-rest"; }
ex_check() { # label want-rc want-text — --check-groups on T_EX
  rs_run "$T_EX" --check-groups
  assert_eq "$1 exit code" "$RS_RC" "$2"
  [[ -z "${3:-}" ]] || assert_contains "$1 finding" "$RS_OUT" "$3"
}

# E1 consistent
ex_tree E1 "$EX_KEYS"; ex_both
ex_check E1 0 "$EX_OKLINE"
assert_absent "E1b no finding printed" "$RS_OUT" "extra job"
# E2 x-rest called by no line
ex_tree E2 "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one"
ex_check E2 1 "extra job x-rest is called by no workflow line"
# E3 a call naming ghost
ex_tree E3 "$EX_KEYS"; ex_both; ex_block "$T_EX" ghost "$EX_CALL ghost"
ex_check E3 1 "workflow calls --extra-job ghost but ci_extra_jobs has no such job"
# E4 no --locale-native
ex_tree E4 "$EX_KEYS"; ex_block "$T_EX" x-one "bash bin/run-suites.sh --extra-job x-one"; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E4 1 "workflow call of --extra-job x-one lacks --locale-native"
# E5 cannot gate
ex_tree E5a "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one || true"; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E5a 1 "workflow call of --extra-job x-one cannot gate (behind \`|| true\`)"
ex_tree E5b "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one" sete; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E5b 1 "workflow call of --extra-job x-one cannot gate (in a run block with \`set +e\`)"
ex_tree E5c "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one" if; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E5c 1 "workflow call of --extra-job x-one cannot gate (in a step with if:)"
# E6 an extra job name that is also a ci_jobs name: config error
cg_tree T_E6 ex-E6 '{"serial":[],"no_count":[],"ci_jobs":{"x-one":["a/run-tests.sh"]},"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"]}},"timings":{"measured":null,"seconds":{}}}'
plant_ok "$T_E6" a/run-tests.sh; cg_wf "$T_E6" x-one
rs_run "$T_E6" --check-groups
assert_eq "E6 extra job also under ci_jobs: exit 2" "$RS_RC" "2"
# E7 ids that do not exist
ex_tree E7a '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"]},"x-rest":{"kind":"snapshot-locale","suites":"rest"}},"snapshot_incompatible":{"ghost/run-tests.sh":"r"}'; ex_both
ex_check E7a 1 "ghost/run-tests.sh: listed under snapshot_incompatible but no such suite"
ex_tree E7b '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["ghost/run-tests.sh"]},"x-rest":{"kind":"snapshot-locale","suites":"rest"}}'; ex_both
ex_check E7b 1 "ghost/run-tests.sh: listed under ci_extra_jobs but no such suite (job x-one)"
# E8 job block content, E9 needs
for EX_M in noarchive nogit nolocale; do
  ex_tree "E8-$EX_M" "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one" "$EX_M"; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
  case "$EX_M" in
    noarchive) EX_W8="no \`git archive\` line" ;;
    nogit)     EX_W8="no \`test ! -e\` line naming .git" ;;
    nolocale)  EX_W8="no \`locale -a\` line" ;;
  esac
  ex_check "E8 $EX_M" 1 "extra job x-one: job block has $EX_W8"
done
ex_tree E9 "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one" needs; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E9 1 "extra job x-one: job block has needs:"
# E10 runs
ex_tree E10 "$EX_KEYS"
rs_run "$T_EX" --locale-native --extra-job x-rest
assert_eq "E10a x-rest exit 0" "$RS_RC" "0"
assert_eq "E10b only c ran (a is x-one's, b is snapshot-incompatible)" "$(cat "$EX_W"/probe-* 2>/dev/null | grep -c '')$(ls "$EX_W" | tr -d '\n')" "1probe-c"
assert_contains "E10c the header names the incompatible suite" "$RS_OUT" \
  "snapshot-incompatible (not run in any snapshot-locale job): b/run-tests.sh - needs .git (fixture)"
rm -f "$EX_W"/probe-*
rs_run "$T_EX" --locale-native --extra-job x-one
assert_eq "E10d x-one exit 0" "$RS_RC" "0"
assert_eq "E10e only a ran" "$(ls "$EX_W" | tr -d '\n')" "probe-a"
# E11 a .git at the root
rm -f "$EX_W"/probe-*; mkdir "$T_EX/.git"
rs_run "$T_EX" --locale-native --extra-job x-rest
assert_eq "E11a a .git at the root: exit 2" "$RS_RC" "2"
assert_eq "E11b nothing started" "$(ls "$EX_W" | grep -c '')" "0"
assert_contains "E11c the message names .git" "$RS_OUT" ".git"
rmdir "$T_EX/.git"
# E12 / E13 refusals
rs_run "$T_EX" --extra-job x-one
assert_eq "E12 --extra-job without --locale-native: exit 2" "$RS_RC" "2"
rs_run "$T_EX" --locale-native --extra-job x-one --job j1
assert_eq "E13a --extra-job with --job: exit 2" "$RS_RC" "2"
rs_run "$T_EX" --locale-native --extra-job x-one a/run-tests.sh
assert_eq "E13b --extra-job with a selector: exit 2" "$RS_RC" "2"
rs_run "$T_EX" --locale-native --extra-job nope
assert_eq "E13c unknown extra job: exit 2" "$RS_RC" "2"
assert_eq "E13d none of E11-E13 started a suite" "$(ls "$EX_W" | grep -c '')" "0"
# E14 config errors
EX_K=0
for EX_BAD in '"ci_extra_jobs":[]' \
  '"ci_extra_jobs":{"x-one":{"kind":"other","suites":["a/run-tests.sh"]}}' \
  '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"]}},"snapshot_incompatible":{"b/run-tests.sh":""}' \
  '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":[]}}' \
  '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":"rest"},"x-two":{"kind":"snapshot-locale","suites":"rest"}}' \
  '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"],"extra":1}}'; do
  EX_K=$((EX_K + 1))
  ex_tree "E14-$EX_K" "$EX_BAD"
  rs_run "$T_EX" --check-groups
  assert_eq "E14-$EX_K config error: exit 2" "$RS_RC" "2"
done
# E15 two call lines for x-one
ex_tree E15 "$EX_KEYS"; ex_both; ex_block "$T_EX" x-one "$EX_CALL x-one"
ex_check E15 1 "extra job x-one is called by 2 workflow lines"
# E16 exactly-once
ex_tree E16a '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"]},"x-two":{"kind":"snapshot-locale","suites":["a/run-tests.sh","b/run-tests.sh"]},"x-rest":{"kind":"snapshot-locale","suites":"rest"}}'
ex_both; ex_block "$T_EX" x-two "$EX_CALL x-two"
ex_check E16a 1 "a/run-tests.sh: in two snapshot-locale places (x-one, x-two)"
ex_tree E16b '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh","b/run-tests.sh"]},"x-rest":{"kind":"snapshot-locale","suites":"rest"}},"snapshot_incompatible":{"b/run-tests.sh":"needs .git"}'
ex_both
ex_check E16b 1 "b/run-tests.sh: in two snapshot-locale places (x-one, snapshot_incompatible)"
ex_tree E16c '"ci_extra_jobs":{"x-one":{"kind":"snapshot-locale","suites":["a/run-tests.sh"]}},"snapshot_incompatible":{"b/run-tests.sh":"needs .git"}'
ex_block "$T_EX" x-one "$EX_CALL x-one"
ex_check E16c 1 "c/run-tests.sh: in no snapshot-locale job"
# E17 A1_XPROV_ONLY in an extra job block
ex_tree E17a "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one" xprov; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E17a 1 "extra job x-one: job block sets A1_XPROV_ONLY"
ex_tree E17b "$EX_KEYS"; ex_block "$T_EX" x-one "$EX_CALL x-one" xprov-run; ex_block "$T_EX" x-rest "$EX_CALL x-rest"
ex_check E17b 1 "extra job x-one: job block sets A1_XPROV_ONLY"
# E18 ci_job_workers
EX_WK='A1_SUITE_WORKERS='
ex_tree E18 "" '{"j1":3}'
RS_ENV_EXTRA="$EX_WK" rs_run "$T_EX" --job j1
assert_contains "E18a --job j1 takes the ci_job_workers value" "$RS_OUT" "workers: 3"
RS_ENV_EXTRA="$EX_WK" rs_run "$T_EX" --job j1 --workers 1
assert_contains "E18b --workers wins" "$RS_OUT" "workers: 1"
RS_ENV_EXTRA="A1_SUITE_WORKERS=2" rs_run "$T_EX" --job j1
assert_contains "E18c A1_SUITE_WORKERS wins over ci_job_workers" "$RS_OUT" "workers: 2"
RS_ENV_EXTRA="$EX_WK" rs_run "$T_EX" a/run-tests.sh
EX_SEL="$(printf '%s\n' "$RS_OUT" | grep '^workers:')"
ex_tree E18d ""
RS_ENV_EXTRA="$EX_WK" rs_run "$T_EX" a/run-tests.sh
assert_eq "E18d a selector run (no --job) gets the default" "$EX_SEL" "$(printf '%s\n' "$RS_OUT" | grep '^workers:')"
# E19 invalid ci_job_workers
EX_K=0
for EX_BAD in '{"nope":3}' '{"j1":0}' '{"j1":7}' '{"j1":"3"}'; do
  EX_K=$((EX_K + 1))
  ex_tree "E19-$EX_K" "" "$EX_BAD"
  rs_run "$T_EX" --job j1
  assert_eq "E19-$EX_K ci_job_workers $EX_BAD: exit 2" "$RS_RC" "2"
  assert_eq "E19-$EX_K nothing started" "$(ls "$EX_W" | grep -c '')" "0"
done
