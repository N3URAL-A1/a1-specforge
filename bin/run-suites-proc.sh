#!/usr/bin/env bash
# bin/run-suites-proc.sh — process side of the fixture-suite runner (spec 026). Sourced by
# bin/run-suites.sh; defines functions and globals only, nothing runs at source time.
#
# Wave 1 holds minimal working versions behind the contract names; Wave 3 replaces the lock, marker and
# signal parts (rs_lock_*, rs_export_marker, rs_on_signal) and must keep rs_default_workers,
# rs_is_posint and the slot functions.
#
# Portability: Bash 3.2 and GNU. Indexed arrays only, no `wait -n`, no `setsid`, no associative arrays.
# Never `pkill`/`killall`: only process groups this runner started are signalled.

RS_WORKER_MIN=1
RS_WORKER_MAX=6
RS_WORKER_RESERVE=2
RS_CORES_FALLBACK=2
RS_POLL_INTERVAL=0.2
RS_KILL_GRACE_TICKS=50   # x 0.1 s between SIGTERM and SIGKILL of a worker group

# Worker slots (parallel indexed arrays, index = slot).
RS_N_SLOTS=0
RS_RUNNING=0
RS_SLOT_PID=()
RS_SLOT_ID=()
RS_SLOT_START=()
RS_SLOT_LOG=()
RS_SLOT_DIR=()
RS_LAST_PGID=""

# rs_is_posint <value> — 0 when value is a decimal integer >= 1 with at most 4 digits.
rs_is_posint() {
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
  [ "${#1}" -le 4 ] || return 1
  [ "$((10#$1))" -ge 1 ]
}

# rs_default_workers <getconf-out> <sysctl-out> — pure. Online cores minus 2, clamped 1..6;
# getconf first, then sysctl, then 2 cores.
rs_default_workers() {
  local g="${1:-}" s="${2:-}" cores="$RS_CORES_FALLBACK" n
  if rs_is_posint "$g"; then cores=$((10#$g))
  elif rs_is_posint "$s"; then cores=$((10#$s)); fi
  n=$((cores - RS_WORKER_RESERVE))
  [ "$n" -ge "$RS_WORKER_MIN" ] || n="$RS_WORKER_MIN"
  [ "$n" -le "$RS_WORKER_MAX" ] || n="$RS_WORKER_MAX"
  printf '%s\n' "$n"
}

# rs_slots_reset <width> — empty pool of <width> slots.
rs_slots_reset() {
  local i=0
  RS_N_SLOTS="$1"
  RS_RUNNING=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    RS_SLOT_PID[$i]=""; RS_SLOT_ID[$i]=""; RS_SLOT_START[$i]=0; RS_SLOT_LOG[$i]=""; RS_SLOT_DIR[$i]=""
    i=$((i + 1))
  done
}

# rs_spawn_worker <identity> <logfile> <home> <vault> — starts the suite in its own process group
# (job control in the subshell, no setsid) under the isolation environment. Sets RS_LAST_PGID
# (the group leader's pid, from $!); it cannot print it, because a command substitution would make
# the worker a child of a subshell and `wait` could no longer collect its status.
rs_spawn_worker() {
  local id="$1" log="$2" home="$3" vault="$4"
  set -m
  ( cd "$RS_ROOT" && exec env -u A1_VAULT_WRITER_HOST A1_HOST_ID=leak A1_VAULT_ROOT="$vault" HOME="$home" \
      bash "_test-fixtures/$id" </dev/null >"$log" 2>&1 ) &
  RS_LAST_PGID=$!
  set +m
}

# rs_free_slot — prints the index of a free slot (empty output when none).
rs_free_slot() {
  local i=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    if [ -z "${RS_SLOT_PID[$i]:-}" ]; then printf '%s\n' "$i"; return 0; fi
    i=$((i + 1))
  done
  return 1
}

# rs_reap — collects every finished worker: kill -0 polling, then `wait <pid>` for the status.
# Calls rs_on_suite_done <slot> <rc> (defined by the entry script). Sets RS_REAPED.
rs_reap() {
  local i=0 pid rc
  RS_REAPED=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    pid="${RS_SLOT_PID[$i]:-}"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"; rc=$?
      RS_SLOT_PID[$i]=""
      RS_RUNNING=$((RS_RUNNING - 1))
      RS_REAPED=$((RS_REAPED + 1))
      rs_on_suite_done "$i" "$rc"
    fi
    i=$((i + 1))
  done
}

# rs_wait_any — one polling step: reap, and sleep a tick when nothing finished.
rs_wait_any() {
  rs_reap
  if [ "$RS_REAPED" -eq 0 ] && [ "$RS_RUNNING" -gt 0 ]; then sleep "$RS_POLL_INTERVAL"; fi
}

# rs_kill_workers — SIGTERM every recorded worker process group, wait, then SIGKILL stragglers.
rs_kill_workers() {
  local i tick alive
  i=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    [ -n "${RS_SLOT_PID[$i]:-}" ] && kill -TERM -- "-${RS_SLOT_PID[$i]}" 2>/dev/null
    i=$((i + 1))
  done
  tick=0
  while [ "$tick" -lt "$RS_KILL_GRACE_TICKS" ]; do
    alive=0; i=0
    while [ "$i" -lt "$RS_N_SLOTS" ]; do
      if [ -n "${RS_SLOT_PID[$i]:-}" ] && kill -0 "${RS_SLOT_PID[$i]}" 2>/dev/null; then alive=1; fi
      i=$((i + 1))
    done
    [ "$alive" -eq 0 ] && break
    sleep 0.1
    tick=$((tick + 1))
  done
  i=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    [ -n "${RS_SLOT_PID[$i]:-}" ] && kill -KILL -- "-${RS_SLOT_PID[$i]}" 2>/dev/null
    i=$((i + 1))
  done
}

# rs_on_signal <INT|TERM> — W1 minimum: stop the workers, exit 130/143 (the EXIT trap cleans up).
# Wave 3 owns the full version (lock release only when the run id is ours, grandchild proof).
rs_on_signal() {
  trap '' INT TERM
  echo "run-suites: $1 received, stopping workers" >&2
  rs_kill_workers
  case "$1" in INT) exit 130 ;; *) exit 143 ;; esac
}

# Lock and run marker: Wave 3 (FR-008..010, FR-026). Wave 1 places them behind the contract names.
rs_lock_acquire() { return 0; }
rs_lock_release() { return 0; }
rs_export_marker() { return 0; }
