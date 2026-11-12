# Part 10 (Wave 4, Task 4.1) — failure fixture and not-writable directories. Sourced by run-tests.sh.
# FR-013: one planted failing suite and two green ones: exit 1, the failing identity and its log path are
# named, the green suites stay in the table. Edge case: read-only TMPDIR, read-only log base and read-only
# lock parent each exit 2 with a message and never a green report (skipped as uid 0, like C16b).
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  F1: exit code 0 although a suite failed · F2: "FAILED:" line without the identity or without a log path
#  F3: failing suite dropped from / green suites missing in the table
#  F4: failed work-dir mktemp (read-only TMPDIR) not exit 2 · F5: failed log-dir mkdir not exit 2
#  F6: failed lock mkdir under a read-only parent not exit 2

mk_tree T_FL fl
mk_workdir W_FL flw
plant_suite "$T_FL" a-ok/run-tests.sh "echo ran > \"$W_FL/ok1\"; echo 'a: 1 passed, 0 failed'"
plant_suite "$T_FL" z-ok/run-tests.sh "echo ran > \"$W_FL/ok2\"; echo 'z: 1 passed, 0 failed'"
plant_suite "$T_FL" m-bad/run-tests.sh "echo 'boom marker line'; echo 'm: 0 passed, 1 failed'; exit 1"
rs_run "$T_FL"
assert_eq "F1a a failing suite exits 1" "$RS_RC" "1"
FL_LINE="$(printf '%s\n' "$RS_OUT" | grep '^FAILED: ')"
assert_eq "F2a exactly one FAILED line" "$(printf '%s\n' "$RS_OUT" | grep -c '^FAILED: ')" "1"
assert_contains "F2b the FAILED line names the identity" "$FL_LINE" "m-bad/run-tests.sh"
FL_LOG="${FL_LINE##*log: }"
assert_contains "F2c the FAILED line carries a log path under the run's log dir" "$FL_LOG" "$RS_TMPD/a1-suite-runs-$(id -u)/"
assert_file_present "F2d the named log exists" "$FL_LOG"
assert_contains "F2e the log holds the suite output" "$(cat "$FL_LOG" 2>/dev/null)" "boom marker line"
assert_eq "F3a the table has 3 rows" "$(printf '%s\n' "$RS_OUT" | grep -cE '^  (PASS|FAIL) ')" "3"
assert_eq "F3b both green suites are PASS rows" \
  "$(printf '%s\n' "$RS_OUT" | grep -cE '^  PASS .*(a-ok|z-ok)/run-tests.sh$')" "2"
assert_eq "F3c the failing suite is a FAIL row" \
  "$(printf '%s\n' "$RS_OUT" | grep -cE '^  FAIL .*m-bad/run-tests.sh$')" "1"
assert_file_present "F3d first green suite ran" "$W_FL/ok1"
assert_file_present "F3e second green suite ran" "$W_FL/ok2"

# fl_run_ro <tmpdir> <lockdir> <out> — lk_start/lk_finish from part 06; sets LK_RC.
fl_run_ro() { lk_start "$T_FL" "$2" "$1" "$3"; lk_finish "$LK_PID"; }
fl_assert_refused() { # label out rc
  assert_eq "$1 exits 2" "$3" "2"
  assert_contains "$1 prints a message" "$(cat "$2")" "run-suites:"
  assert_absent "$1 prints no results table" "$(cat "$2")" "suite results"
  assert_absent "$1 prints no total" "$(cat "$2")" "total wall-clock"
}
if [[ "$(id -u)" == "0" ]]; then
  ok "F4-F6 skipped: running as uid 0 (permissions do not bind root)"
else
  rm -f "$W_FL/ok1" "$W_FL/ok2"
  # F4: read-only TMPDIR (no work dir possible)
  mkdir -p "$W_FL/ro-tmp" && chmod 0555 "$W_FL/ro-tmp"
  fl_run_ro "$W_FL/ro-tmp" "$W_FL/lock4" "$W_FL/out4.txt"
  fl_assert_refused "F4a read-only TMPDIR" "$W_FL/out4.txt" "$LK_RC"
  assert_file_absent "F4b no suite started" "$W_FL/ok1"
  assert_file_absent "F4c the lock was released" "$W_FL/lock4"
  # F5: log base exists but is read-only (work dir fine, log leaf impossible)
  mkdir -p "$W_FL/tmp5/a1-suite-runs-$(id -u)" && chmod 0700 "$W_FL/tmp5/a1-suite-runs-$(id -u)" \
    && chmod 0500 "$W_FL/tmp5/a1-suite-runs-$(id -u)"
  fl_run_ro "$W_FL/tmp5" "$W_FL/lock5" "$W_FL/out5.txt"
  fl_assert_refused "F5a read-only log base" "$W_FL/out5.txt" "$LK_RC"
  assert_file_absent "F5b no suite started" "$W_FL/ok1"
  assert_contains "F5c the message names the log directory" "$(cat "$W_FL/out5.txt")" "log directory"
  # F6: lock parent read-only
  mkdir -p "$W_FL/ro-seam" && chmod 0555 "$W_FL/ro-seam"
  fl_run_ro "$W_FL/tmp6" "$W_FL/ro-seam/lock" "$W_FL/out6.txt"
  fl_assert_refused "F6a read-only lock parent" "$W_FL/out6.txt" "$LK_RC"
  assert_file_absent "F6b no suite started" "$W_FL/ok1"
  find "$W_FL" -type d -exec chmod u+rwx {} + 2>/dev/null || true
fi
