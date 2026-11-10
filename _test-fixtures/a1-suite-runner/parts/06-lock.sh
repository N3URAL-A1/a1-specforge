# Part 06 (Wave 3) — per-machine lock, stale takeover, seam. Sourced by run-tests.sh.
# FR-008 (exclusive lock, holder named, no log for a refused run, fixed /tmp path without TMPDIR),
# FR-009 (dead PID and live unrelated PID are taken over, atomically), FR-026 (seam; the real
# /tmp/a1-suite-runner-<uid> is never touched). Every start sets A1_SUITE_LOCK_DIR to a fixture dir.
#
# Red-making changes (one production-code line each, on a git archive snapshot; for the seam
# mutation the fixed path is first redirected to a scratch path so the real lock is never created):
#  K1: second run not refused (lock ignored) · K1b: holder PID not named · K1c: refused run still
#      creates its log dir · K1d: lock files missing (pid / run_id / runner) · K1e: marker not exported
#  K2: static: the default path built from the temp-dir variable
#  K3: dead-PID lock not taken over · K4: command-line check dropped (live `sleep` PID blocks)
#  K5: takeover guard dropped (rs_guard_take always succeeds): racing runners both take the lock
#  K6: release not guarded by the run id (a lock re-owned by someone else is removed)
#  K7: symlink at the lock path not refused · K8: uncreatable lock dir not exit 2
#  K9: seam ignored (nested run refused, or the seam directory stays empty)
#  K10: lock never released at exit (EXIT trap)

REAL_LOCK="/tmp/a1-suite-runner-$(id -u)"
# lk_real_state — absent, or present with holder PID and run id (read only; never created or removed here).
lk_real_state() {
  local p="" r=""
  if [[ -e "$REAL_LOCK" || -L "$REAL_LOCK" ]]; then
    [[ -f "$REAL_LOCK/pid" ]] && p="$(head -n 1 "$REAL_LOCK/pid")"
    [[ -f "$REAL_LOCK/run_id" ]] && r="$(head -n 1 "$REAL_LOCK/run_id")"
    echo "present pid=$p run_id=$r"
  else
    echo "absent"
  fi
}
LK_REAL_BEFORE="$(lk_real_state)"

# lk_start <tree> <lockdir> <tmpdir> <outfile> [runner args...] — runner in the background; sets LK_PID
# ($! is the runner: exec). LK_ENV="A=1" adds env assignments; LK_MONITOR=1 starts it in its own
# process group (set -m), which a runner needs to receive SIGINT (see part 07).
lk_start() {
  local tree="$1" lockd="$2" tmpd="$3" out="$4"
  shift 4
  mkdir -p "$tmpd" || return 1
  if [[ "${LK_MONITOR:-0}" == 1 ]]; then set -m; fi
  # shellcheck disable=SC2086
  ( cd "$tmpd" && exec env -u A1_SUITE_RUN_MARKER -u A1_VAULT_ROOT ${LK_ENV:-} \
    A1_SUITE_LOCK_DIR="$lockd" TMPDIR="$tmpd" bash "$RUNNER" --root "$tree" "$@" ) \
    > "$out" 2>&1 < /dev/null &
  LK_PID=$!
  set +m
}
# lk_pid_gone <pid> — true when the process is gone or only a zombie.
lk_pid_gone() {
  local st
  kill -0 "$1" 2>/dev/null || return 0
  st="$(ps -o stat= -p "$1" 2>/dev/null)"
  case "$st" in Z*|'') return 0 ;; esac
  return 1
}
# lk_wait_file <path> — up to 10 s for a non-empty file.
lk_wait_file() {
  local n=0
  while [[ ! -s "$1" && $n -lt 100 ]]; do sleep 0.1; n=$((n + 1)); done
  [[ -s "$1" ]]
}
# lk_finish <pid> — waits (max 60 s) for our own runner child, sets LK_RC; ends it by its own pid on timeout.
lk_finish() {
  local n=0
  while ! lk_pid_gone "$1" && [[ $n -lt 300 ]]; do sleep 0.2; n=$((n + 1)); done
  if ! lk_pid_gone "$1"; then kill -TERM "$1" 2>/dev/null; fi
  wait "$1"; LK_RC=$?
  [[ $n -lt 300 ]] || LK_RC=124
}
# lk_plant_lock <lockdir> <pid> — a lock directory as an earlier run would have left it.
lk_plant_lock() {
  mkdir -p "$1" && echo "$2" > "$1/pid" && echo "planted-run" > "$1/run_id" \
    && echo "/old/checkout/bin/run-suites.sh" > "$1/runner"
}
# lk_holder_suite — a suite that holds the lock for a while and records what it sees.
lk_holder_body() { # probe-prefix seconds
  echo "echo \"\$A1_SUITE_RUN_MARKER\" > \"$1.marker\"
if [ -f \"\$A1_SUITE_LOCK_DIR/pid\" ]; then echo seam > \"$1.seam\"; fi
echo ran >> \"$1.ran\"
sleep $2
echo 'h: 1 passed, 0 failed'"
}

# ---- K2: the default lock path is fixed and independent of the temp-dir variable (static) ----
LK_SRC="$REPO_ROOT/bin/run-suites-proc.sh"
assert_contains "K2a default lock path expression" "$(cat "$LK_SRC")" '/tmp/a1-suite-runner-$(id -u)'
LK_PATH_LINES="$(grep -h 'a1-suite-runner-' "$REPO_ROOT"/bin/run-suites*.sh | grep -v '^[[:space:]]*#')"
assert_eq "K2b exactly one code line builds the lock path" "$(printf '%s\n' "$LK_PATH_LINES" | grep -c 'a1-suite-runner-')" "1"
assert_absent "K2c that line does not use the temp-dir variable" "$LK_PATH_LINES" "TMPDIR"

# ---- K1: a second run while the first holds the lock is refused within 5 s ----
mk_tree T_K1 k1
mk_workdir W_K1 k1w
plant_suite "$T_K1" h/run-tests.sh "$(lk_holder_body "$W_K1/p1" 4)"
LK_LOCK1="$W_K1/lock"
lk_start "$T_K1" "$LK_LOCK1" "$W_K1/tmp1" "$W_K1/out1.txt"
LK_P1="$LK_PID"
lk_wait_file "$W_K1/p1.ran"
assert_file_present "K1a lock directory exists while the first run works" "$LK_LOCK1"
assert_eq "K1b lock holds the holder PID" "$(head -n 1 "$LK_LOCK1/pid" 2>/dev/null)" "$LK_P1"
assert_eq "K1c lock holds a run id" "$([[ -s "$LK_LOCK1/run_id" ]] && echo yes || echo no)" "yes"
assert_contains "K1d lock holds the runner path" "$(cat "$LK_LOCK1/runner" 2>/dev/null)" "run-suites.sh"
LK_RUN_ID1="$(head -n 1 "$LK_LOCK1/run_id" 2>/dev/null)"
assert_eq "K1e workers got the run marker (lock file path:run id)" \
  "$(head -n 1 "$W_K1/p1.marker" 2>/dev/null)" "$LK_LOCK1/run_id:$LK_RUN_ID1"
assert_eq "K1f the suite saw the lock under the seam directory" "$(cat "$W_K1/p1.seam" 2>/dev/null)" "seam"
LK_T0=$SECONDS
lk_start "$T_K1" "$LK_LOCK1" "$W_K1/tmp2" "$W_K1/out2.txt"
LK_P2="$LK_PID"
lk_finish "$LK_P2"
LK_ELAPSED=$((SECONDS - LK_T0))
LK_OUT2="$(cat "$W_K1/out2.txt")"
if [[ $LK_RC -ne 0 && $LK_RC -ne 124 ]]; then ok "K1g second run exits non-zero ($LK_RC)"; else bad "K1g second run exits non-zero" "rc: $LK_RC"; fi
if [[ $LK_ELAPSED -le 5 ]]; then ok "K1h refused within 5 s (${LK_ELAPSED}s)"; else bad "K1h refused within 5 s" "took ${LK_ELAPSED}s"; fi
assert_contains "K1i the refusal names the holder PID" "$LK_OUT2" "holder PID $LK_P1"
assert_eq "K1j the refused run created no log directory" "$(find "$W_K1/tmp2" -maxdepth 1 -name 'a1-suite-runs' | grep -c '')" "0"
assert_eq "K1k the refused run started no suite (one start in the probe)" "$(grep -c '' "$W_K1/p1.ran")" "1"
assert_eq "K1l the holder is untouched by the refusal" "$(head -n 1 "$LK_LOCK1/pid" 2>/dev/null)" "$LK_P1"
lk_finish "$LK_P1"
assert_eq "K1m the first run completes" "$LK_RC" "0"
assert_file_absent "K1n the lock is gone after a normal exit" "$LK_LOCK1"

# ---- K3/K4: stale lock takeover (dead PID, live unrelated PID) ----
mk_tree T_K3 k3
mk_workdir W_K3 k3w
plant_suite "$T_K3" s/run-tests.sh "$(lk_holder_body "$W_K3/p" 0)"
( exit 0 ) & LK_DEAD=$!
wait "$LK_DEAD"
lk_plant_lock "$W_K3/lock-dead" "$LK_DEAD"
lk_start "$T_K3" "$W_K3/lock-dead" "$W_K3/tmp-dead" "$W_K3/out-dead.txt"
lk_finish "$LK_PID"
assert_eq "K3a dead-PID lock: run completes with exit 0" "$LK_RC" "0"
assert_contains "K3b a takeover line is printed" "$(cat "$W_K3/out-dead.txt")" "took over"
assert_eq "K3c the suite ran" "$(grep -c '' "$W_K3/p.ran" 2>/dev/null)" "1"
assert_file_absent "K3d the lock is released afterwards" "$W_K3/lock-dead"
assert_eq "K3e no stale copy is left behind" "$(find "$W_K3" -maxdepth 1 -name 'lock-dead.stale.*' | grep -c '')" "0"

sleep 120 &
LK_SLEEPER=$!
lk_plant_lock "$W_K3/lock-live" "$LK_SLEEPER"
rm -f "$W_K3/p.ran"
lk_start "$T_K3" "$W_K3/lock-live" "$W_K3/tmp-live" "$W_K3/out-live.txt"
lk_finish "$LK_PID"
assert_eq "K4a live unrelated PID: run completes with exit 0" "$LK_RC" "0"
assert_contains "K4b a takeover line is printed" "$(cat "$W_K3/out-live.txt")" "took over"
assert_eq "K4c the suite ran" "$(grep -c '' "$W_K3/p.ran" 2>/dev/null)" "1"
if kill -0 "$LK_SLEEPER" 2>/dev/null; then ok "K4d the unrelated process was not signalled"; else bad "K4d the unrelated process was not signalled" "sleeper $LK_SLEEPER is gone"; fi
kill "$LK_SLEEPER" 2>/dev/null; wait "$LK_SLEEPER" 2>/dev/null

# ---- K5: takeover is atomic: racing runners against the same stale lock, exactly one runs ----
# Eight runners per round start at once on a lock held by a live unrelated process. The runners find
# slowed-down ps and mv first on PATH (each sleeps, then runs the real tool), which widens the windows
# between "judged stale", "renamed away" and "pid written" the way a loaded machine does; no production
# hook is involved.
# Three rounds. Each round: the suite starts once and exactly one runner exits 0.
sleep 120 &
LK_RACE_SLEEPER=$!
mk_tree T_K5 k5
mk_workdir W_K5 k5w
mkdir "$W_K5/slowbin"
for LK_TOOL in ps mv; do
  printf '#!/bin/bash\nsleep 0.15\nexec %s "$@"\n' "$(command -v "$LK_TOOL")" > "$W_K5/slowbin/$LK_TOOL"
  chmod +x "$W_K5/slowbin/$LK_TOOL"
done
plant_suite "$T_K5" r/run-tests.sh "$(lk_holder_body "$W_K5/p" 4)"
LK_ROUND=1
while [[ $LK_ROUND -le 3 ]]; do
  rm -f "$W_K5/p.ran"
  lk_plant_lock "$W_K5/lock" "$LK_RACE_SLEEPER"
  LK_RACERS=""
  for LK_K in 1 2 3 4 5 6 7 8; do
    LK_ENV="PATH=$W_K5/slowbin:$PATH" lk_start "$T_K5" "$W_K5/lock" "$W_K5/tmp-$LK_ROUND-$LK_K" "$W_K5/out-$LK_ROUND-$LK_K.txt"
    LK_RACERS="$LK_RACERS $LK_PID"
  done
  LK_ZERO=0
  for LK_PR in $LK_RACERS; do
    lk_finish "$LK_PR"
    [[ $LK_RC -eq 0 ]] && LK_ZERO=$((LK_ZERO + 1))
  done
  assert_eq "K5a round $LK_ROUND: the suite started exactly once" "$(grep -c '' "$W_K5/p.ran" 2>/dev/null)" "1"
  assert_eq "K5b round $LK_ROUND: exactly one of eight runners exited 0" "$LK_ZERO" "1"
  assert_eq "K5c round $LK_ROUND: no lock or stale copy is left behind" "$(find "$W_K5" -maxdepth 1 -name 'lock*' | grep -c '')" "0"
  LK_ROUND=$((LK_ROUND + 1))
done
kill "$LK_RACE_SLEEPER" 2>/dev/null; wait "$LK_RACE_SLEEPER" 2>/dev/null

# ---- K6: release only removes a lock that is still ours ----
mk_tree T_K6 k6
mk_workdir W_K6 k6w
plant_suite "$T_K6" o/run-tests.sh 'echo someone-else > "$A1_SUITE_LOCK_DIR/run_id"; echo "o: 1 passed, 0 failed"'
lk_start "$T_K6" "$W_K6/lock" "$W_K6/tmp" "$W_K6/out.txt"
lk_finish "$LK_PID"
assert_eq "K6a run exits 0" "$LK_RC" "0"
assert_eq "K6b a lock whose run id is no longer ours is left in place" "$(head -n 1 "$W_K6/lock/run_id" 2>/dev/null)" "someone-else"

# ---- K7/K8: unsafe or uncreatable lock path ----
mk_tree T_K7 k7
mk_workdir W_K7 k7w
plant_suite "$T_K7" y/run-tests.sh ": > \"$W_K7/probe\"; echo 'y: 1 passed, 0 failed'"
mkdir "$W_K7/target"
ln -s "$W_K7/target" "$W_K7/linked-lock"
lk_start "$T_K7" "$W_K7/linked-lock" "$W_K7/tmp1" "$W_K7/out1.txt"
lk_finish "$LK_PID"
assert_eq "K7a symlink at the lock path exits 2" "$LK_RC" "2"
assert_contains "K7b the message names the symbolic link" "$(cat "$W_K7/out1.txt")" "symbolic link"
assert_file_absent "K7c no suite started" "$W_K7/probe"
assert_eq "K7d the link target was not written" "$(find "$W_K7/target" -mindepth 1 | grep -c '')" "0"
lk_start "$T_K7" "$W_K7/missing-parent/sub/lock" "$W_K7/tmp2" "$W_K7/out2.txt"
lk_finish "$LK_PID"
assert_eq "K8a uncreatable lock directory exits 2" "$LK_RC" "2"
assert_contains "K8b the message names the lock" "$(cat "$W_K7/out2.txt")" "lock"
assert_file_absent "K8c no suite started" "$W_K7/probe"

# ---- K9: nested run (seam, inherited run marker) beside a held outer lock ----
mk_tree T_K9 k9
mk_workdir W_K9 k9w
plant_suite "$T_K9" h/run-tests.sh "$(lk_holder_body "$W_K9/outer" 5)"
mk_tree T_K9N k9n
plant_suite "$T_K9N" n/run-tests.sh "$(lk_holder_body "$W_K9/inner" 0)"
lk_start "$T_K9" "$W_K9/outer-lock" "$W_K9/tmp-o" "$W_K9/out-o.txt"
LK_PO="$LK_PID"
lk_wait_file "$W_K9/outer.ran"
LK_OUTER_ID="$(head -n 1 "$W_K9/outer-lock/run_id" 2>/dev/null)"
LK_ENV="A1_SUITE_RUN_MARKER=$W_K9/outer-lock/run_id:$LK_OUTER_ID" \
  lk_start "$T_K9N" "$W_K9/inner-lock" "$W_K9/tmp-i" "$W_K9/out-i.txt"
lk_finish "$LK_PID"
assert_eq "K9a nested run with the seam is not refused" "$LK_RC" "0"
assert_eq "K9b the nested lock was created under the seam directory" "$(cat "$W_K9/inner.seam" 2>/dev/null)" "seam"
assert_eq "K9c the outer lock is unchanged (holder PID)" "$(head -n 1 "$W_K9/outer-lock/pid" 2>/dev/null)" "$LK_PO"
assert_eq "K9d the outer lock is unchanged (run id)" "$(head -n 1 "$W_K9/outer-lock/run_id" 2>/dev/null)" "$LK_OUTER_ID"
assert_file_absent "K9e the nested lock is released" "$W_K9/inner-lock"
lk_finish "$LK_PO"
assert_eq "K9f the outer run completes" "$LK_RC" "0"

# ---- the real per-machine lock was never touched by any case above ----
assert_eq "K10 the real lock is in the same state as before the part" "$(lk_real_state)" "$LK_REAL_BEFORE"
