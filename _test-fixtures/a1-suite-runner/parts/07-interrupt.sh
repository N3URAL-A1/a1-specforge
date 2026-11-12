# Part 07 (Wave 3) — interrupts leave no worker, grandchild or lock. Sourced by run-tests.sh.
# FR-010: after SIGINT / SIGTERM to the runner, the runner, the worker and the worker's grandchild
# sleeper are gone within 10 s, the lock is removed and a control sleep outside the runner lives on.
#
# SIGINT note (Wave 1 finding): a background job of a non-interactive shell inherits SIGINT as
# ignored and bash cannot trap an ignored signal. The runner of the SIGINT case is therefore started
# under `set -m` (lk_start with LK_MONITOR=1): its own process group with the default SIGINT
# disposition, as a terminal's Ctrl-C finds it. The SIGTERM case runs the same way plus once plainly.
#
# Red-making changes (one production-code line each, on a git archive snapshot):
#  X1: workers signalled by `$!` instead of the process group (the grandchild survives)
#  X2: the lock is never created or never released (lock existence checks)
#  X3: the SIGINT trap missing · X4: exit code of an interrupt not 130 / 143
#  X5: the work directory left behind

# lk_interrupt <label> <signal> <expected rc> <monitor 0|1>
lk_interrupt() {
  local label="$1" sig="$2" want="$3" mon="$4" tree w gc wp rp ctl n all
  mk_tree tree "int-$label"
  mk_workdir w "int-$label-w"
  plant_suite "$tree" g/run-tests.sh "sleep 120 & echo \$! > \"$w/gc\"; echo \$\$ > \"$w/wp\"; wait"
  sleep 120 &
  ctl=$!
  LK_MONITOR="$mon" lk_start "$tree" "$w/lock" "$w/tmp" "$w/out.txt"
  rp="$LK_PID"
  lk_wait_file "$w/gc"; lk_wait_file "$w/wp"
  gc="$(cat "$w/gc" 2>/dev/null)"; wp="$(cat "$w/wp" 2>/dev/null)"
  assert_eq "X1-$label the lock exists while the suite works" "$([[ -s "$w/lock/pid" ]] && echo yes || echo no)" "yes"
  if [[ -n "$gc" && -n "$wp" ]] && ! lk_pid_gone "$gc" && ! lk_pid_gone "$wp"; then ok "X2-$label worker and grandchild are alive before the signal"
  else bad "X2-$label worker and grandchild are alive before the signal" "worker: [$wp] grandchild: [$gc]"; fi
  kill -s "$sig" "$rp"
  n=0; all=0
  while [[ $n -lt 100 ]]; do
    if lk_pid_gone "$rp" && lk_pid_gone "${wp:-0}" && lk_pid_gone "${gc:-0}"; then all=1; break; fi
    sleep 0.1; n=$((n + 1))
  done
  if [[ $all -eq 1 ]]; then ok "X3-$label runner, worker and grandchild are gone within 10 s"
  else
    bad "X3-$label runner, worker and grandchild are gone within 10 s" "runner $rp worker $wp grandchild $gc"
    # Leftovers are processes this part started (PIDs recorded from $!): end them by those PIDs.
    kill -TERM "$rp" 2>/dev/null; [[ -n "$wp" ]] && kill -TERM "$wp" 2>/dev/null; [[ -n "$gc" ]] && kill -TERM "$gc" 2>/dev/null
  fi
  wait "$rp"; LK_RC=$?
  assert_eq "X4-$label exit code of the interrupted runner" "$LK_RC" "$want"
  assert_file_absent "X5-$label the lock directory is removed" "$w/lock"
  assert_eq "X6-$label the runner work directory is removed" "$(find "$w/tmp" -maxdepth 1 -name 'a1-suite-??????' | grep -c '')" "0"
  if kill -0 "$ctl" 2>/dev/null; then ok "X7-$label the control process outside the runner is still alive"
  else bad "X7-$label the control process outside the runner is still alive" "control $ctl is gone"; fi
  kill "$ctl" 2>/dev/null; wait "$ctl" 2>/dev/null
}
lk_interrupt sigint INT 130 1
lk_interrupt sigterm TERM 143 1
lk_interrupt sigterm-plain TERM 143 0

assert_eq "X8 the real lock is in the same state as before the lock part" "$(lk_real_state)" "$LK_REAL_BEFORE"

# ---- PR review fix rounds, MAJOR-1: a suite is done when its whole process group is gone ----
# G1: leftovers are ended before the leak check and the slot-dir removal, and are a warning, not a failure.
# Red-making change: reap on the leader alone (no group TERM/KILL): the late writer is not stopped.
# G1a-e: a late writer (3 s) left behind: its write lands before the drain would end it only if the grace
# period is skipped; here it is ended (so no leak) and the run is green with a warning.
mk_tree T_LG lg
mk_workdir W_LG lgw
plant_suite "$T_LG" g/run-tests.sh "( sleep 30; mkdir -p \"\$A1_VAULT_ROOT/late\" ) &
echo \$! > \"$W_LG/bg\"
echo 'g: 1 passed, 0 failed'"
rs_run "$T_LG"
LG_BG="$(cat "$W_LG/bg" 2>/dev/null)"
assert_eq "G1a a harmless leftover keeps the suite green (exit 0)" "$RS_RC" "0"
assert_contains "G1b a warning line names the suite" "$RS_OUT" "warning: suite g/run-tests.sh left"
assert_contains "G1c the table notes the ended processes" "$RS_OUT" " leftover processes)"
if [[ -n "$LG_BG" ]] && lk_pid_gone "$LG_BG"; then ok "G1d the background process is gone when the run ends"
else bad "G1d the background process is gone when the run ends" "pid [$LG_BG] still alive"; fi
assert_eq "G1e no runner work directory is left" "$(find "$RS_TMPD" -maxdepth 1 -name 'a1-suite-??????' | grep -c '')" "0"
LG_N=0; while [[ -n "$LG_BG" ]] && ! lk_pid_gone "$LG_BG" && [[ $LG_N -lt 60 ]]; do sleep 0.1; LG_N=$((LG_N + 1)); done
assert_absent "G1f no FAILED line for a harmless leftover" "$RS_OUT" "FAILED:"

# G1g-i: a writer that writes into the sentinel vault inside the grace period: the leak check is red.
mk_tree T_LW lw
mk_workdir W_LW lww
plant_suite "$T_LW" g/run-tests.sh "( sleep 0.5; mkdir -p \"\$A1_VAULT_ROOT/late\" ) &
echo 'g: 1 passed, 0 failed'"
rs_run "$T_LW"
assert_eq "G1g a late writer inside the grace period turns the suite red" "$RS_RC" "1"
assert_contains "G1h the leak check names the sentinel vault" "$RS_OUT" "wrote into its sentinel vault"

# G1j-k: a helper that finishes within the grace period: green, no warning.
mk_tree T_LS ls
mk_workdir W_LS lsw
plant_suite "$T_LS" g/run-tests.sh "( sleep 0.5 ) &
echo 'g: 1 passed, 0 failed'"
rs_run "$T_LS"
assert_eq "G1j a helper that ends within the grace period stays green" "$RS_RC" "0"
assert_absent "G1k and produces no warning" "$RS_OUT" "warning:"

# ---- PR review fix round, MAJOR-2: a stale takeover ends the dead holder's worker groups first ----
# G2: kill -9 of the holder leaves the worker group (its own group) running; the next run must not run
# the same suite beside it. Red-making change: no pgids recorded, or the takeover not signalling them.
mk_tree T_TO to
mk_workdir W_TO tow
plant_suite "$T_TO" g/run-tests.sh "echo start >> \"$W_TO/log\"; sleep 3 & echo \$! >> \"$W_TO/sp\"; wait; echo end >> \"$W_TO/log\"
echo 'g: 1 passed, 0 failed'"
lk_start "$T_TO" "$W_TO/lock" "$W_TO/tmp1" "$W_TO/out1.txt"
TO_H="$LK_PID"
lk_wait_file "$W_TO/sp"
TO_N=0; while [[ ! -s "$W_TO/lock/pgids" && $TO_N -lt 20 ]]; do sleep 0.1; TO_N=$((TO_N + 1)); done
kill -9 "$TO_H"; wait "$TO_H" 2>/dev/null
lk_start "$T_TO" "$W_TO/lock" "$W_TO/tmp2" "$W_TO/out2.txt"
lk_finish "$LK_PID"
assert_eq "G2a the second run completes (exit 0)" "$LK_RC" "0"
assert_eq "G2b the dead holder's suite never finished beside the new run" "$(grep -c '^end$' "$W_TO/log")" "1"
assert_contains "G2c the takeover is announced" "$(cat "$W_TO/out2.txt")" "took over a stale lock"
TO_ALIVE=0
while IFS= read -r p; do [[ -n "$p" ]] && ! lk_pid_gone "$p" && TO_ALIVE=$((TO_ALIVE + 1)); done < "$W_TO/sp"
assert_eq "G2d no worker process of the dead holder is left" "$TO_ALIVE" "0"
