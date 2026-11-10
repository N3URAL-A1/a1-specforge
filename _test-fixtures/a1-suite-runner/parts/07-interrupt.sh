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
