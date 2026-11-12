# Part 13 (PR review fix round, spec 026) — learnings check, failure log tail, pid-less lock, docs. Sourced by run-tests.sh.
# SEC-1(b): a suite that writes into <root>/.a1/learnings (A1_VAULT_ROOT unset, the fallback store) turns red.
# SEC-6: a red suite's last 40 log lines are printed (bounded, not only in CI).
# Lock race (a): a lock directory without a pid file is held until it is older than a bound, not 1 s.
# Docs: the log path names the per-user base; README "Run them all" is the runner.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  N1  the learnings listing/cksum comparison dropped · N2  checked only without --ignored (ignored dir invisible)
#  N3  a modified existing learning not seen (listing only) · N4  no skip line outside a git work tree
#  T1  no log tail on failure · T2  tail not bounded (whole log)
#  P1  pid-less lock taken over after 1 s

# ---- N: learnings state before/after the run ----
mk_lt_tree() { # VAR <suite-body> — git work tree with .a1/learnings ignored, one planted suite l/run-tests.sh
  mk_tree "$1" ltree
  local __t="${!1}"
  printf '.a1/learnings/\n' > "$__t/.gitignore"
  plant_suite "$__t" l/run-tests.sh "$2"
  mkdir -p "$__t/.a1/learnings/project/old" && echo before > "$__t/.a1/learnings/project/old/keep.md"
  git -C "$__t" init -q 2>/dev/null
  git -C "$__t" config user.name fixture
  git -C "$__t" config user.email fixture@example.invalid
  git -C "$__t" add -A
  git -C "$__t" -c commit.gpgsign=false commit -q -m base
}
mk_lt_tree T_N1 "echo 'l: 1 passed, 0 failed'"
rs_run "$T_N1"
assert_eq "N1a a suite that writes no learning: exit 0" "$RS_RC" "0"
assert_contains "N1b the check is announced" "$RS_OUT" "learnings check: .a1/learnings unchanged"
mk_lt_tree T_N2 "unset A1_VAULT_ROOT; mkdir -p .a1/learnings/project/x && echo l > .a1/learnings/project/x/n.md
echo 'l: 1 passed, 0 failed'"
rs_run "$T_N2"
assert_eq "N2a a suite writing a new learning (A1_VAULT_ROOT unset): exit 1" "$RS_RC" "1"
assert_contains "N2b the check names .a1/learnings" "$RS_OUT" "learnings check FAILED"
assert_contains "N2c the new file is listed" "$RS_OUT" ".a1/learnings/project/x/n.md"
mk_lt_tree T_N3 "echo more >> .a1/learnings/project/old/keep.md
echo 'l: 1 passed, 0 failed'"
rs_run "$T_N3"
assert_eq "N3a a suite changing an existing learning: exit 1" "$RS_RC" "1"
assert_contains "N3b the check fails" "$RS_OUT" "learnings check FAILED"
mk_tree T_N4 nogit-lt
plant_ok "$T_N4" l/run-tests.sh
rs_run "$T_N4"
assert_contains "N4a not a git top level: the skip is announced" "$RS_OUT" "learnings check skipped:"
assert_eq "N4b no git work tree: exit 0" "$RS_RC" "0"

# ---- T: the log tail of a red suite ----
mk_tree T_T1 tail
plant_suite "$T_T1" t/run-tests.sh 'i=1; while [ $i -le 60 ]; do echo "L$i end"; i=$((i + 1)); done
echo "t: 0 passed, 1 failed"; exit 1'
plant_suite "$T_T1" ok/run-tests.sh 'echo "OKLINE marker"; echo "ok: 1 passed, 0 failed"'
rs_run "$T_T1"
assert_eq "T1a the red suite exits 1" "$RS_RC" "1"
assert_contains "T1b the last log line is printed" "$RS_OUT" "L60 end"
assert_contains "T1c the first line of the last 40 is printed" "$RS_OUT" "L22 end"
assert_absent "T2a lines before the last 40 are not printed" "$RS_OUT" "L21 end"
assert_absent "T2b a green suite's log is not printed" "$RS_OUT" "OKLINE marker"

# ---- P: a pid-less lock is held while it is young ----
mk_tree T_P1 pidless
mk_workdir W_P1 pidlessw
plant_suite "$T_P1" b/run-tests.sh ": > \"$W_P1/probe-b\"; echo 'b: 1 passed, 0 failed'"
mk_tree T_P1H pidless-holder
plant_suite "$T_P1H" h/run-tests.sh "$(lk_holder_body "$W_P1/h" 6)"
lk_start "$T_P1H" "$W_P1/lockH" "$W_P1/tmpH" "$W_P1/outH.txt"
P1_H="$LK_PID"
lk_wait_file "$W_P1/h.ran"
mkdir "$W_P1/lock2" && echo young > "$W_P1/lock2/run_id"
lk_start "$T_P1" "$W_P1/lock2" "$W_P1/tmpB" "$W_P1/outB.txt"
P1_B="$LK_PID"
sleep 2   # deliberate-timeout: the holder writes its pid into the young lock 2 s after the lock appeared (race window under test)
echo "$P1_H" > "$W_P1/lock2/pid"
lk_finish "$P1_B"
assert_eq "P1a a young pid-less lock is not taken over before its holder writes the pid: exit 2" "$LK_RC" "2"
assert_file_absent "P1b no suite of the refused run started" "$W_P1/probe-b"
lk_finish "$P1_H"

# ---- D: documentation facts ----
assert_eq "D1 CONTRIBUTING names the per-user log base" \
  "$(grep -c 'a1-suite-runs-<uid>/<run id>' "$REPO_ROOT/CONTRIBUTING.md")" "1"
assert_eq "D2 README runs the suites through the runner" \
  "$(grep -c '^bash bin/run-suites.sh$' "$REPO_ROOT/README.md")" "1"
assert_eq "D3 README no longer shows the serial for-loop" \
  "$(grep -c '^for r in _test-fixtures/\*/run\*.sh' "$REPO_ROOT/README.md")" "0"
