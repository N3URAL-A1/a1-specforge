#!/usr/bin/env bash
# bin/run-suites-proc.sh — process side of the fixture-suite runner (spec 026). Sourced by
# bin/run-suites.sh; defines functions and globals only, nothing runs at source time.
#
# Wave 3 holds the lock, run marker and signal parts (rs_lock_*, rs_export_marker, rs_on_signal); keep
# rs_default_workers (part 02 sources it),
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

# rs_group_gone <pgid> — true when no process of the group is left.
rs_group_gone() { ! kill -0 -- "-$1" 2>/dev/null; }

# rs_leader_settle <pid> — reaps a worker leader that already ended (a zombie still answers kill -0).
rs_leader_settle() {
  local st
  st="$(ps -o stat= -p "$1" 2>/dev/null)"
  case "$st" in Z*) wait "$1" 2>/dev/null ;; esac
  return 0
}

# rs_kill_workers — SIGTERM every recorded worker process group (never a bare pid, so grandchildren
# go too), poll until the groups are empty, then SIGKILL stragglers. Only groups recorded from `$!`
# in a slot are signalled; a slot is cleared once its group is empty.
rs_kill_workers() {
  local i tick alive pid
  i=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    pid="${RS_SLOT_PID[$i]:-}"
    [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null
    i=$((i + 1))
  done
  tick=0
  while [ "$tick" -lt "$RS_KILL_GRACE_TICKS" ]; do
    alive=0; i=0
    while [ "$i" -lt "$RS_N_SLOTS" ]; do
      pid="${RS_SLOT_PID[$i]:-}"
      if [ -n "$pid" ]; then
        rs_leader_settle "$pid"
        if rs_group_gone "$pid"; then RS_SLOT_PID[$i]=""; else alive=1; fi
      fi
      i=$((i + 1))
    done
    [ "$alive" -eq 0 ] && break
    sleep 0.1
    tick=$((tick + 1))
  done
  i=0
  while [ "$i" -lt "$RS_N_SLOTS" ]; do
    pid="${RS_SLOT_PID[$i]:-}"
    if [ -n "$pid" ]; then
      kill -KILL -- "-$pid" 2>/dev/null
      rs_leader_settle "$pid"
      RS_SLOT_PID[$i]=""
    fi
    i=$((i + 1))
  done
  RS_RUNNING=0
}

# rs_on_signal <INT|TERM> — stop the workers, exit 130/143 (the EXIT trap releases the lock).
rs_on_signal() {
  trap '' INT TERM
  echo "run-suites: $1 received, stopping workers" >&2
  rs_kill_workers
  case "$1" in INT) exit 130 ;; *) exit 143 ;; esac
}

# ---- per-machine lock (FR-008, FR-009, FR-026) ----
RS_LOCK_RUNNER_NAME="run-suites.sh"
RS_LOCK_INIT_TICKS=10      # x 0.1 s a fresh lock may lack its pid file
RS_LOCK_ATTEMPTS=8
RS_GUARD_TICKS=50         # x 0.1 s to wait for another takeover
RS_LOCK_DIR=""
RS_LOCK_HELD=0
RS_RUN_ID=""

# rs_lock_path — the fixed per-user path (never from the temp-dir variable); the seam overrides it.
rs_lock_path() { printf '%s\n' "${A1_SUITE_LOCK_DIR:-/tmp/a1-suite-runner-$(id -u)}"; }

# rs_lock_is_runner <pid> — alive AND its command line contains the runner name (PID reuse proof).
rs_lock_is_runner() {
  local cmd
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null || return 1
  cmd="$(ps -o command= -p "$1" 2>/dev/null)"
  case "$cmd" in *"$RS_LOCK_RUNNER_NAME"*) return 0 ;; esac
  return 1
}

# rs_lock_read_pid <lockdir> — the holder pid; a fresh lock gets a moment to write it.
rs_lock_read_pid() {
  local n=0 p=""
  while [ "$n" -lt "$RS_LOCK_INIT_TICKS" ]; do
    p=""
    [ -f "$1/pid" ] && read -r p < "$1/pid"
    [ -n "$p" ] && break
    sleep 0.1
    n=$((n + 1))
  done
  printf '%s\n' "$p"
}

rs_lock_file_line() { local v=""; [ -f "$1" ] && read -r v < "$1"; printf '%s\n' "$v"; }

# rs_lock_write <lockdir> — run id and runner first, the pid last (atomic rename).
rs_lock_write() {
  printf '%s\n' "$RS_RUN_ID" > "$1/run_id" || return 1
  printf '%s\n' "$RS_BIN_DIR/$RS_LOCK_RUNNER_NAME" > "$1/runner" || return 1
  printf '%s\n' "$$" > "$1/pid.tmp" || return 1
  mv "$1/pid.tmp" "$1/pid"
}

# rs_lock_drop_dir <dir> — removes a lock directory this runner moved aside or created (flat files only).
rs_lock_drop_dir() {
  [ -n "$1" ] && [ -d "$1" ] && [ ! -L "$1" ] || return 0
  rm -f "$1/pid" "$1/pid.tmp" "$1/run_id" "$1/runner"
  rmdir "$1" 2>/dev/null || true
}

# rs_guard_take <guarddir> — serialises takeovers: only one runner at a time may rename a lock away.
# A guard whose owner is not a running runner (crash) is removed. 0 = guard is ours.
rs_guard_take() {
  local g="$1" n=0 p
  while [ "$n" -lt "$RS_GUARD_TICKS" ]; do
    if mkdir "$g" 2>/dev/null; then printf '%s\n' "$$" > "$g/pid" && return 0; rs_lock_drop_dir "$g"; return 1; fi
    p="$(rs_lock_read_pid "$g")"
    if ! rs_lock_is_runner "$p"; then rs_lock_drop_dir "$g"; fi
    sleep 0.1
    n=$((n + 1))
  done
  return 1
}
rs_guard_drop() { [ "$(rs_lock_file_line "$1/pid")" = "$$" ] && rs_lock_drop_dir "$1"; return 0; }

# rs_lock_takeover <lockdir> <attempt> — under the takeover guard: re-judge, rename the stale directory
# away, mkdir, write. 0 = held, 1 = try again, 2 = refused (held by a running runner, or guard stuck).
rs_lock_takeover() {
  local lock="$1" stale holder run
  rs_guard_take "$lock.takeover" || { echo "run-suites: could not take the takeover guard for $lock" >&2; return 2; }
  if [ -d "$lock" ] && [ ! -L "$lock" ]; then
    holder="$(rs_lock_read_pid "$lock")"; run="$(rs_lock_file_line "$lock/run_id")"
    if rs_lock_is_runner "$holder"; then
      rs_guard_drop "$lock.takeover"
      echo "run-suites: another run holds the lock $lock (holder PID $holder, run $run); no suite started" >&2
      return 2
    fi
    stale="$lock.stale.$$.$2"
    if mv "$lock" "$stale" 2>/dev/null; then
      rs_lock_drop_dir "$stale"
      echo "run-suites: took over a stale lock at $lock (holder PID ${holder:-unknown} is not a running runner)"
    fi
  fi
  if mkdir "$lock" 2>/dev/null && rs_lock_write "$lock" 2>/dev/null; then
    RS_LOCK_DIR="$lock"; RS_LOCK_HELD=1; rs_guard_drop "$lock.takeover"; return 0
  fi
  rs_guard_drop "$lock.takeover"
  return 1
}

# rs_lock_acquire — 0 = held. 2 = refused or unusable (message on stderr). A fresh path is taken with
# one atomic mkdir. An existing lock counts as held only when its PID is alive AND is the runner;
# otherwise it is stale and rs_lock_takeover replaces it.
rs_lock_acquire() {
  local lock holder run attempt=0 rc
  lock="$(rs_lock_path)"
  [ -n "${RS_RUN_ID:-}" ] || RS_RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
  while [ "$attempt" -lt "$RS_LOCK_ATTEMPTS" ]; do
    attempt=$((attempt + 1))
    if [ -L "$lock" ]; then
      echo "run-suites: lock path $lock is a symbolic link; refusing to use it" >&2; return 2
    fi
    if mkdir "$lock" 2>/dev/null; then
      if rs_lock_write "$lock" 2>/dev/null; then RS_LOCK_DIR="$lock"; RS_LOCK_HELD=1; return 0; fi
      continue   # never delete here: the path may already hold another runner's lock
    fi
    if [ ! -d "$lock" ]; then
      echo "run-suites: cannot create the lock directory $lock" >&2; return 2
    fi
    if [ ! -O "$lock" ]; then
      echo "run-suites: lock $lock is not owned by the current user; refusing to use it" >&2; return 2
    fi
    holder="$(rs_lock_read_pid "$lock")"; run="$(rs_lock_file_line "$lock/run_id")"
    if rs_lock_is_runner "$holder"; then
      echo "run-suites: another run holds the lock $lock (holder PID $holder, run $run); no suite started" >&2
      return 2
    fi
    rs_lock_takeover "$lock" "$attempt"; rc=$?
    [ "$rc" -eq 1 ] || return "$rc"
  done
  echo "run-suites: could not take the lock $lock after $RS_LOCK_ATTEMPTS attempts" >&2
  return 2
}

# rs_lock_release — EXIT path: stop workers still recorded (normal exit has none), then remove the
# lock only while it is still ours (pid and run id match).
rs_lock_release() {
  local lock="$RS_LOCK_DIR"
  if [ "${RS_RUNNING:-0}" -gt 0 ]; then rs_kill_workers; fi
  [ "$RS_LOCK_HELD" -eq 1 ] || return 0
  RS_LOCK_HELD=0
  [ -n "$lock" ] && [ -d "$lock" ] && [ ! -L "$lock" ] || return 0
  [ "$(rs_lock_file_line "$lock/run_id")" = "$RS_RUN_ID" ] || return 0
  [ "$(rs_lock_file_line "$lock/pid")" = "$$" ] || return 0
  rs_lock_drop_dir "$lock"
  return 0
}

# rs_export_marker — workers see "<lock file path>:<run id>" (consumed by a1-vault-cockpit I1).
rs_export_marker() {
  [ -n "$RS_LOCK_DIR" ] || return 0
  A1_SUITE_RUN_MARKER="$RS_LOCK_DIR/run_id:$RS_RUN_ID"
  export A1_SUITE_RUN_MARKER
}
