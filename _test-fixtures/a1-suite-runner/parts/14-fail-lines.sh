# Part 14 (spec 028 Wave 6, Task 6.1/6.3) — FR-029: the report of a red suite shows the FAIL lines of its log. Sourced by run-tests.sh.
# rs_print_failures prints, for each failing suite, up to 20 log lines that contain FAIL (case-sensitive, each cut to RS_TAIL_WIDTH characters)
# under the heading "FAIL lines:" BEFORE the 40-line tail, so an early FAIL line of a 200-line log is shown (the tail alone loses it).
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  FL1: no "FAIL lines:" section (the early FAIL line is lost, as before this spec) · FL2: no cap of 20 lines
#  FL3: no cut to RS_TAIL_WIDTH · FL4: a case-insensitive match (the lowercase line shows) · FL5: the section comes after the tail

mk_tree T_FLN fln
plant_suite "$T_FLN" big/run-tests.sh 'echo "PASS  FL9 INTENT_FAILURE_REASONS is listed (a passing line with a longer word)"
echo "FAIL long $(printf "x%.0s" $(seq 1 400)) TAILEND"
echo "FAIL first-marker"
echo "fail lowercase-marker"
i=3; while [ $i -le 30 ]; do echo "FAIL case $i"; i=$((i + 1)); done
i=31; while [ $i -le 200 ]; do echo "L$i end"; i=$((i + 1)); done
echo "big: 0 passed, 30 failed"; exit 1'
plant_suite "$T_FLN" ok/run-tests.sh 'echo "FAIL in a green suite marker"; echo "ok: 1 passed, 0 failed"'
rs_run "$T_FLN"
assert_eq "FL0 the red suite exits 1" "$RS_RC" "1"
assert_contains "FL1a the FAIL lines heading is printed" "$RS_OUT" "FAIL lines:"
assert_contains "FL1b an early FAIL line of a 200-line log is shown (it is outside the 40-line tail)" "$RS_OUT" "FAIL first-marker"
assert_contains "FL2a the 20th FAIL line is shown" "$RS_OUT" "FAIL case 20"
assert_absent "FL2b the 21st FAIL line is not (cap of 20)" "$RS_OUT" "FAIL case 21"
assert_contains "FL3a a long FAIL line is shown" "$RS_OUT" "FAIL long xxxx"
assert_absent "FL3b a long FAIL line is cut to RS_TAIL_WIDTH (the end of it is gone)" "$RS_OUT" "TAILEND"
assert_absent "FL4 the match is case-sensitive: a lowercase 'fail' line is not shown" "$RS_OUT" "lowercase-marker"
assert_absent "FL9 review round m10: a PASS line containing FAILURE is not listed (FAIL matches as a whole word)" "$RS_OUT" "INTENT_FAILURE_REASONS"
assert_absent "FL6 a green suite's log is not scanned for FAIL lines" "$RS_OUT" "FAIL in a green suite marker"
assert_eq "FL7 exactly one FAIL lines heading (one failing suite)" "$(printf '%s\n' "$RS_OUT" | grep -c 'FAIL lines:')" "1"
FL_HEAD_AT="$(printf '%s\n' "$RS_OUT" | grep -n 'FAIL lines:' | head -1 | cut -d: -f1)"
FL_TAIL_AT="$(printf '%s\n' "$RS_OUT" | grep -n 'last 40 lines of the log:' | head -1 | cut -d: -f1)"
if [[ -n "$FL_HEAD_AT" && -n "$FL_TAIL_AT" && "$FL_HEAD_AT" -lt "$FL_TAIL_AT" ]]; then ok "FL5 the FAIL lines come before the 40-line tail"; else bad "FL5 order" "heading at line [$FL_HEAD_AT], tail heading at line [$FL_TAIL_AT]"; fi
assert_contains "FL8 the tail is still printed" "$RS_OUT" "L200 end"

# FL10 (PR #94 CI): only lines that START with FAIL are failure lines; a PASS line ending in "-> FAIL" is not listed, an indented "FAIL:" is
mk_tree T_FL2 fl2
plant_suite "$T_FL2" two/run-tests.sh 'echo "PASS  FL10 a wait without a cell -> FAIL"
echo "  FAIL: indented-marker"
echo "two: 1 passed, 1 failed"; exit 1'
rs_run "$T_FL2"
FL10_SEC="$(printf '%s\n' "$RS_OUT" | sed -n '/FAIL lines:/,/last [0-9]* lines of the log:/p')"
assert_absent "FL10a a PASS line that names FAIL is not a failure line" "$FL10_SEC" "FL10 a wait"
assert_contains "FL10b an indented FAIL: line is a failure line" "$FL10_SEC" "indented-marker"
