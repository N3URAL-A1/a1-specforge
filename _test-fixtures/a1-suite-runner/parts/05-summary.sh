# Part 05 (Wave 2) — assert-summary parser and the "no assert summary" guard. Sourced by run-tests.sh.
# FR-007: rs_parse_count handles three formats (last matching line wins, n/a otherwise); a green suite
# without a summary that is not in no_count fails with "no assert summary"; the same suite in no_count
# passes with n/a; a no_count suite that prints a count is named in an end-of-run report line.
#
# Red-making changes (one production-code line each, on a git archive snapshot):
#  C1a: dropping the "N passed, M failed" regex · C1b: dropping the pass=N fail=M regex ·
#  C1c: dropping the "passed: N failed: M" regex · C1d: first match instead of last match ·
#  C1e: accepting the parser fixture's PASS line (count instead of n/a).
#  N1a/N1b: dropping the no_count lookup (n/a accepted everywhere, or never accepted) ·
#  N1c: no report line for a no_count suite that prints a count.

# Provenance of the sample shapes: the echo templates of the real runners (counted, not assumed).
# shellcheck disable=SC2016
{
  assert_eq "C0a real runner emits the 'N passed, M failed' shape" \
    "$(grep -c 'echo "a1-intent: \$pass passed, \$fail failed"' "$REPO_ROOT/_test-fixtures/a1-intent/run-tests.sh")" "1"
  assert_eq "C0b real runner emits the 'pass=N fail=M' shape" \
    "$(grep -c 'echo "pass=\$PASS fail=\$FAIL"' "$REPO_ROOT/_test-fixtures/product-modules/run-help.sh")" "1"
  assert_eq "C0c real runner emits the 'passed: N  failed: M' shape" \
    "$(grep -c 'echo "passed: \$pass  failed: \$fail"' "$REPO_ROOT/_test-fixtures/product-modules/run-index.sh")" "1"
  assert_eq "C0d real runner emits the skipped=N shape" \
    "$(grep -c 'passed, \$fail failed, skipped=\$skipped' "$REPO_ROOT/_test-fixtures/a1-probe/run-tests.sh")" "1"
  assert_eq "C0e real parser runner emits the PASS: shape" \
    "$(grep -c 'console.log("PASS: parser fixture' "$REPO_ROOT/_test-fixtures/a1-schema-check/parser/run-parser.sh")" "1"
}

# count_of <text> — rs_parse_count on a log holding exactly that text.
count_of() {
  local f
  mk_tmpfile f cnt
  printf '%s\n' "$1" > "$f"
  ( . "$REPO_ROOT/bin/run-suites-report.sh" && rs_parse_count "$f" )
}
assert_eq "C1a 'x: 12 passed, 0 failed' -> 12" "$(count_of 'x: 12 passed, 0 failed')" "12"
assert_eq "C1a2 skipped suffix -> 12" "$(count_of 'x: 12 passed, 0 failed, skipped=3')" "12"
assert_eq "C1a3 bare 'N passed, M failed' -> 12" "$(count_of '12 passed, 0 failed')" "12"
assert_eq "C1a4 'Total:' shape -> 12" "$(count_of 'Total: 12 passed, 0 failed')" "12"
assert_eq "C1b 'pass=12 fail=0' -> 12" "$(count_of 'pass=12 fail=0')" "12"
assert_eq "C1c 'passed: 12   failed: 0' -> 12" "$(count_of 'passed: 12   failed: 0')" "12"
assert_eq "C1c2 'passed: 12  failed: 0' (two spaces) -> 12" "$(count_of 'passed: 12  failed: 0')" "12"
assert_eq "C1d last matching line wins" "$(count_of $'x: 3 passed, 0 failed\nnoise\nx: 12 passed, 0 failed\ntrailing noise')" "12"
assert_eq "C1d2 last wins across formats" "$(count_of $'pass=3 fail=0\nx: 9 passed, 0 failed')" "9"
assert_eq "C1e PASS: parser line -> n/a" "$(count_of 'PASS: parser fixture (3 tables, 2 FKs, 3 triggers, RLS incl. FORCE)')" "n/a"
assert_eq "C1f empty log -> n/a" "$(count_of '')" "n/a"
assert_eq "C1g missing log -> n/a" "$( ( . "$REPO_ROOT/bin/run-suites-report.sh" && rs_parse_count "$RS_TMPD/does-not-exist.log" ) )" "n/a"

# ---- N1: summary guard and the no_count list ----
mk_tree T_NC nc
plant_suite "$T_NC" a-bare/run-tests.sh 'echo "no summary here"'
rs_run "$T_NC"
assert_eq "N1a green suite without summary, not in no_count: run exits 1" "$RS_RC" "1"
assert_contains "N1a2 reason names the missing summary" "$RS_OUT" "FAILED: a-bare/run-tests.sh (rc=0, no assert summary)"
assert_contains "N1a3 the live line says FAIL" "$RS_OUT" "done: FAIL a-bare/run-tests.sh"

write_groups "$T_NC" '[]' '["a-bare/run-tests.sh"]'
rs_run "$T_NC"
assert_eq "N1b same suite listed in no_count: run exits 0" "$RS_RC" "0"
assert_eq "N1b2 its row shows n/a" "$(printf '%s\n' "$RS_OUT" | grep -c '^  PASS .* n/a  a-bare/run-tests.sh$')" "1"
assert_absent "N1b3 no count report line when it prints no count" "$RS_OUT" "prints a count"

plant_suite "$T_NC" b-counted/run-tests.sh 'echo "counted: 4 passed, 0 failed"'
write_groups "$T_NC" '[]' '["a-bare/run-tests.sh","b-counted/run-tests.sh"]'
rs_run "$T_NC"
assert_eq "N1c no_count suite that prints a count still passes" "$RS_RC" "0"
assert_eq "N1c2 it is named in one report line" \
  "$(printf '%s\n' "$RS_OUT" | grep -c '^no_count: b-counted/run-tests.sh prints a count (4)')" "1"
assert_eq "N1c3 the real no_count entry is not reported" \
  "$(printf '%s\n' "$RS_OUT" | grep -c '^no_count: .*a-bare')" "0"

# A failing suite without summary keeps its own reason (rc), not "no assert summary".
mk_tree T_NC2 nc2
plant_suite "$T_NC2" x-crash/run-tests.sh 'echo boom; exit 3'
rs_run "$T_NC2"
assert_contains "N1d failing suite keeps its exit code reason" "$RS_OUT" "FAILED: x-crash/run-tests.sh (rc=3) log: "
