#!/usr/bin/env bash
# Shared "run this, but not forever" helper for the fixture suites.
# Source it; do not execute it.
#
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/bounded.sh" || exit 2
#   run_bounded 10 OUT ERR -- node "$TOOLS" profile resolve --repo-root "$long"
#   rc=$?            # the command's own exit code, or 124 if it was killed
#
# Why not `timeout`: the GNU coreutils `timeout` command does not exist on a
# stock macOS, and neither does `gtimeout` unless somebody installed coreutils
# by hand (measured 2026-10-28: `command -v timeout gtimeout` finds neither,
# `timeout 2 echo hi` exits 127). A suite that calls it is green in CI on
# GNU/Linux and silently wrong on the development machine, where every bounded
# case reports rc=127 instead of the exit code it asserts. a1-reservations,
# a1-learnings, a1-quick and a1-retro-validate each grew their own copy of the
# background-job workaround; this is that same shape, written once.
#
# 124 as the timeout code follows GNU `timeout`, so a caller can tell "the
# command refused the input quickly" (its own code) from "it hung" (124).
#
# Bash 3.2 (macOS) and GNU compatible: no namerefs, no mapfile, no ${var,,}.

# run_bounded <seconds> <stdout-file> <stderr-file> -- <command> [args...]
run_bounded() {
  local secs="$1" outf="$2" errf="$3" sep="$4"
  shift 4
  if [[ "$sep" != "--" ]]; then
    echo "run_bounded: expected -- after the two output files" >&2
    exit 2
  fi
  case "$secs" in
    ''|*[!0-9]*) echo "run_bounded: seconds must be a positive integer: $secs" >&2; exit 2 ;;
  esac
  if [[ $# -eq 0 ]]; then
    echo "run_bounded: no command given" >&2
    exit 2
  fi

  "$@" >"$outf" 2>"$errf" &
  local pid=$! waited=0
  # kill -0 asks "does this pid still exist", it sends no signal.
  while kill -0 "$pid" 2>/dev/null && [[ $waited -lt $secs ]]; do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    # Only ever our own pid, captured from $! — never a pkill pattern
    # (postmortem 2026-10-03: a pattern kill hit a foreign suite run).
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    return 124
  fi
  wait "$pid"
  return $?
}
