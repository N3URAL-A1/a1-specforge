# Part 18 (spec 027 slice 3, Task 3.1) — `--groups-file`. Sourced by run-tests.sh (after 17-json-out).
# The runner reads its declaration file from the named path (D6): the long path takes the runner's own tree,
# never the head's.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  G1: rs_load_groups back to $RS_ROOT/... / G2: rs_load_nocount back to $RS_ROOT/...

mk_workdir W_GF gfw
printf '{"serial":[],"no_count":[],"ci_jobs":{},"timings":{"measured":null,"seconds":{}}}\n' > "$W_GF/good.json"

mk_tree T_G1 g1
plant_ok "$T_G1" a/run-tests.sh
printf '{not json\n' > "$T_G1/_test-fixtures/suite-groups.json"
rs_run "$T_G1" --groups-file "$W_GF/good.json"
assert_eq "G1a a valid --groups-file overrides an invalid tree file" "$RS_RC" "0"
rs_run "$T_G1"
assert_eq "G1b control: without the option the invalid tree file exits 2" "$RS_RC" "2"

printf '{"serial":[],"no_count":["n/run-tests.sh"],"ci_jobs":{},"timings":{"measured":null,"seconds":{}}}\n' > "$W_GF/nc.json"
mk_tree T_G2 g2
plant_suite "$T_G2" n/run-tests.sh 'exit 0'
rs_run "$T_G2" --groups-file "$W_GF/nc.json"
assert_eq "G2a no_count only in --groups-file: PASS" "$RS_RC" "0"
assert_absent "G2b no summary note" "$RS_OUT" "no assert summary"
write_groups "$T_G2" '[]' '["n/run-tests.sh"]'
rs_run "$T_G2" --groups-file "$W_GF/good.json" --json-out "$W_GF/g2.json"
assert_eq "G2c no_count only in the tree file: FAIL" "$RS_RC" "1"
assert_eq "G2d summary_note names the missing summary" "$(jo_get "$W_GF/g2.json" 'j.results[0].summary_note')" '"no assert summary"'

rs_run "$T_G1" --groups-file "$W_GF/good.json" --check-groups
assert_eq "G3 --groups-file with --check-groups exits 2" "$RS_RC" "2"

rs_run "$T_G1" --groups-file good.json
assert_eq "G4a a relative --groups-file exits 2" "$RS_RC" "2"
ln -s "$W_GF/good.json" "$W_GF/link.json"
rs_run "$T_G1" --groups-file "$W_GF/link.json"
assert_eq "G4b a symlinked --groups-file exits 2" "$RS_RC" "2"
