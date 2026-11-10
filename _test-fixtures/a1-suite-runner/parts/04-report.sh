# Part 04 (Wave 2) — per-suite logs, timing table, failure output, identity. Sourced by run-tests.sh.
# FR-004 (log directory named first, one log per suite with stdout+stderr, planted tree unchanged),
# FR-005 (table: status, seconds, count; rows by elapsed descending; one row per discovered suite),
# FR-006 (exit 1 suite + SIGTERM-killed suite: others finish, both named with log path, rc 1),
# FR-024 (identity with directory shown verbatim in list, row and failure line; two runners per dir).
#
# Red-making changes (one production-code line each, on a git archive snapshot):
#  G1a/G1b: logging only stdout (stderr marker missing) · G1c: log name without directory part
#           (two suites collide, log count 1) · G1d: log dir line printed after the discovery list.
#  T1a-T1c: sort ascending instead of descending · T1d: table dropping the count column (7/n/a) ·
#  T1e: table skipping a row (row count != discovered count).
#  F1a-F1d: failure line without the log path · signal exit not reported as "signal 15" (rc>128 branch
#           in rs_on_suite_done) · runner stopping at the first failure (the later suites vanish).
#  U1a-U1e: identity shortened to the basename in the row or the failure line.

# Sample line shapes below are the echo lines of the real runners, e.g.
# `echo "a1-intent: $pass passed, $fail failed"` in _test-fixtures/a1-intent/run-tests.sh.

# rows <output> — the table rows only (status word first), in printed order.
rows() { printf '%s\n' "$1" | grep -E '^  (PASS|FAIL) '; }

# ---- G1: log directory, one log per suite, stdout + stderr, planted tree untouched ----
mk_tree T_LOG log
plant_suite "$T_LOG" a1-log/run-one.sh 'echo "out-marker-one"; echo "err-marker-one" >&2; echo "one: 3 passed, 0 failed"'
plant_suite "$T_LOG" a1-log/run-two.sh 'echo "out-marker-two"; echo "err-marker-two" >&2; echo "two: 4 passed, 0 failed"'
plant_suite "$T_LOG" a1-other/run-one.sh 'echo "out-marker-three"; echo "three: 5 passed, 0 failed"'
git -C "$T_LOG" init -q && git -C "$T_LOG" add -A && \
  git -C "$T_LOG" -c user.name=t -c user.email=t@example.invalid commit -q -m planted
LOG_GIT_BEFORE="$(git -C "$T_LOG" status --porcelain)"
rs_run "$T_LOG"
assert_eq "G1z green run exits 0" "$RS_RC" "0"
LOG_DIR_LINE="$(printf '%s\n' "$RS_OUT" | sed -n '1p')"
LOG_DIR="${LOG_DIR_LINE#log dir: }"
assert_contains "G1d first output line names the log directory" "$LOG_DIR_LINE" "log dir: $RS_TMPD/a1-suite-runs/"
assert_eq "G1e exactly one log per suite (3 suites)" "$(find "$LOG_DIR" -type f -name '*.log' 2>/dev/null | grep -c '')" "3"
assert_eq "G1c the two run-one.sh suites have distinct logs" \
  "$(find "$LOG_DIR" -type f -name '*run-one.sh.log' 2>/dev/null | grep -c '')" "2"
LOG_ALL="$(cat "$LOG_DIR"/*.log 2>/dev/null)"
assert_contains "G1a a log holds the suite's stdout" "$LOG_ALL" "out-marker-two"
assert_contains "G1b a log holds the suite's stderr" "$LOG_ALL" "err-marker-two"
assert_eq "G1f the planted tree is unchanged by the run" "$(git -C "$T_LOG" status --porcelain)" "$LOG_GIT_BEFORE"

# ---- T1: timing table (sleeps 4 / 2 / 0 s, rows by elapsed descending) ----
mk_tree T_TAB tab
plant_suite "$T_TAB" b-slow/run-tests.sh 'sleep 4; echo "slow: 7 passed, 0 failed"'
plant_suite "$T_TAB" a-fast/run-tests.sh 'echo "fast: 2 passed, 0 failed"'
plant_suite "$T_TAB" c-mid/run-tests.sh 'sleep 2; echo "mid: 5 passed, 0 failed"'
rs_run "$T_TAB" --workers 3
assert_eq "T1z green run exits 0" "$RS_RC" "0"
TAB_ROWS="$(rows "$RS_OUT")"
TAB_ORDER="$(printf '%s\n' "$TAB_ROWS" | awk '{print $NF}' | tr '\n' ' ')"
assert_eq "T1a rows ordered by elapsed descending (literal)" "$TAB_ORDER" "b-slow/run-tests.sh c-mid/run-tests.sh a-fast/run-tests.sh "
assert_eq "T1e row count equals the discovered count (3)" "$(printf '%s\n' "$TAB_ROWS" | grep -c '')" "3"
assert_contains "T1e2 discovery announces 3 suites" "$RS_OUT" "discovered 3 suites"
assert_eq "T1d counts per row (7, 5, 2)" "$(printf '%s\n' "$TAB_ROWS" | awk '{print $3}' | tr '\n' ' ')" "7 5 2 "
assert_eq "T1f status per row" "$(printf '%s\n' "$TAB_ROWS" | awk '{print $1}' | sort -u | tr '\n' ' ')" "PASS "
assert_contains "T1g total wall-clock line" "$RS_OUT" "total wall-clock: "
SLOW_SEC="$(printf '%s\n' "$TAB_ROWS" | sed -n '1p' | awk '{sub(/s$/, "", $2); print $2}')"
if [[ "$SLOW_SEC" =~ ^[0-9]+$ && "$SLOW_SEC" -ge 3 ]]; then ok "T1h slowest row shows its elapsed seconds (>= 3)"; else bad "T1h slowest row shows its elapsed seconds (>= 3)" "got: [$SLOW_SEC]"; fi

# ---- F1: one suite exits 1, one kills itself with SIGTERM, the others still finish ----
mk_tree T_FAIL fail
FAIL_PROBE="$T_FAIL/later-ran"
plant_suite "$T_FAIL" f-exit/run-tests.sh 'echo "exit1-marker"; echo "exit: 1 passed, 1 failed"; exit 1'
plant_suite "$T_FAIL" g-term/run-tests.sh 'echo "term-marker"; kill -TERM $$; sleep 5'
plant_suite "$T_FAIL" h-ok/run-tests.sh ": > \"$FAIL_PROBE\"; echo 'ok: 2 passed, 0 failed'"
plant_suite "$T_FAIL" i-ok/run-tests.sh "echo 'ok2: 2 passed, 0 failed'"
rs_run "$T_FAIL" --workers 1
assert_eq "F1a run with failing suites exits 1" "$RS_RC" "1"
assert_file_present "F1b a suite after the failures still ran" "$FAIL_PROBE"
assert_contains "F1c the green suites passed" "$RS_OUT" "done: PASS i-ok/run-tests.sh"
FAIL_LINES="$(printf '%s\n' "$RS_OUT" | grep '^FAILED: ')"
assert_eq "F1d exactly two failure lines" "$(printf '%s\n' "$FAIL_LINES" | grep -c '')" "2"
assert_contains "F1e exit-1 suite named" "$FAIL_LINES" "FAILED: f-exit/run-tests.sh (rc=1"
assert_contains "F1f signal suite named with signal 15" "$FAIL_LINES" "FAILED: g-term/run-tests.sh (rc=143, killed by signal 15"
for fid in f-exit g-term; do
  fl="$(printf '%s\n' "$FAIL_LINES" | grep "FAILED: $fid/" | sed 's/.* log: //')"
  if [[ -n "$fl" && -f "$fl" ]]; then ok "F1g $fid failure line carries an existing log path"; else bad "F1g $fid failure line carries an existing log path" "path: [$fl]"; fi
done
assert_eq "F1h table shows 4 rows (2 FAIL)" "$(rows "$RS_OUT" | grep -c '')/$(rows "$RS_OUT" | grep -c '^  FAIL')" "4/2"

# ---- U1: identity with directory part, two runners in one directory ----
mk_tree T_IDN idn
plant_suite "$T_IDN" a1-gates-lint/run-wave13.sh 'echo "w13: 1 passed, 1 failed"; exit 1'
plant_suite "$T_IDN" a1-gates-lint/run-tests.sh 'echo "lint: 3 passed, 0 failed"'
plant_suite "$T_IDN" other/run-wave13.sh 'echo "other: 1 passed, 0 failed"'
rs_run "$T_IDN" --workers 3
IDN_ID="a1-gates-lint/run-wave13.sh"
assert_eq "U1a identity verbatim in the discovery list (1x)" "$(printf '%s\n' "$RS_OUT" | grep -cx "$IDN_ID")" "1"
assert_eq "U1b identity verbatim in the table row (1x)" "$(rows "$RS_OUT" | grep -c " $IDN_ID\$")" "1"
assert_eq "U1c identity verbatim in the failure line (1x)" "$(printf '%s\n' "$RS_OUT" | grep -c "^FAILED: $IDN_ID ")" "1"
assert_eq "U1d three distinct rows for three runners (two in one directory)" \
  "$(rows "$RS_OUT" | awk '{print $NF}' | sort -u | grep -c '')" "3"
assert_eq "U1e same basename in two directories gives two rows" "$(rows "$RS_OUT" | grep -c 'run-wave13.sh$')" "2"
