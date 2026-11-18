# Part 15 (spec 027 FR-009, Task 7.2) — `--locale-native`. Sourced by run-tests.sh (after 14-fail-lines).
# Without the flag every worker runs under LC_ALL=C (FR-027) and the header is unchanged; with it the runner
# skips that export, so the worker sees the runner's own LC_ALL, and the header says `locale: native (...)`.
# No glob-order assert here: platform collation differs (U8 of part 08 keeps the C-order assert).
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  L2: the export guard removed (LC_ALL=C always exported) / L1: the export removed for a default run
#  L3: the flag exports a fixed value instead of leaving LC_ALL alone / L4: --check-groups refuses the flag

mk_tree T_LN ln
mk_workdir W_LN lnw
plant_suite "$T_LN" l/run-tests.sh "echo \"LC=\${LC_ALL-UNSET}\" > \"$W_LN/seen\"; echo 'l: 1 passed, 0 failed'"
ln_seen() { sed -n 's/^LC=//p' "$W_LN/seen"; }

rm -f "$W_LN/seen"
RS_ENV_EXTRA="LC_ALL= LANG=en_US.UTF-8" rs_run "$T_LN"
assert_eq "L1a default run exits 0" "$RS_RC" "0"
assert_eq "L1b the worker sees LC_ALL=C although the runner has none" "$(ln_seen)" "C"
assert_absent "L1c a default run prints no locale line" "$RS_OUT" "locale: native"

rm -f "$W_LN/seen"
RS_ENV_EXTRA="LC_ALL=en_US.UTF-8" rs_run "$T_LN" --locale-native
assert_eq "L2a --locale-native exits 0" "$RS_RC" "0"
assert_eq "L2b the worker sees the runner's LC_ALL" "$(ln_seen)" "en_US.UTF-8"
assert_contains "L2c the header names LANG" "$RS_OUT" "locale: native (LANG="
assert_contains "L2d the header names LC_ALL" "$RS_OUT" "LC_ALL=en_US.UTF-8)"

rm -f "$W_LN/seen"
RS_ENV_EXTRA="LC_ALL=" rs_run "$T_LN" --locale-native
assert_eq "L3a --locale-native with an empty LC_ALL exits 0" "$RS_RC" "0"
assert_eq "L3b the worker sees an empty LC_ALL" "$(ln_seen)" ""
assert_file_present "L3c the probe really wrote" "$W_LN/seen"

# cg_tree / cg_wf come from part 11 (sourced before this part).
cg_tree T_LN4 ln4 '{"serial":[],"no_count":[],"ci_jobs":{"j1":["l/run-tests.sh"]},"timings":{"measured":null,"seconds":{}}}'
plant_ok "$T_LN4" l/run-tests.sh
cg_wf "$T_LN4" j1
rs_run "$T_LN4" --locale-native --check-groups
assert_eq "L4 --locale-native with --check-groups exits 0 (nothing started)" "$RS_RC" "0"
