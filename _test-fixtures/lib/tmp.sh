#!/usr/bin/env bash
# Shared temp-dir helper for the fixture suites. Source it; do not execute it.
#
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/tmp.sh" || exit 2
#   mk_workdir WORK my-label      # sets $WORK to a fresh, real, empty directory
#   mk_tmpfile LIST my-label      # sets $LIST to a fresh empty file
#
# Why: macOS (BSD) `mktemp -d` WITHOUT a path template ignores $TMPDIR and
# writes to the per-user temp dir, where suites leaked ~15k dirs a day
# (fix suite-tmpdir-leak, 2026-10-20). Every site here passes an explicit
# "${TMPDIR:-/tmp}/..." template, which both BSD and GNU honour.
#
# Design: one private root per suite process ("a1-fx-<pid-label>.XXXXXX");
# every mk_workdir/mk_tmpfile creates inside it. The root is the only thing
# the EXIT trap has to remove, so registration survives $(...) subshells.
#
# Guards (postmortem 2026-10-13): mktemp failure, empty result, not-a-dir and
# a failed realpath all abort the CALLER with exit 2 before any trap can
# `rm -rf` an empty path. Call mk_workdir directly, never inside $(...).
#
# EXIT trap: installed here only when the suite has none yet. A suite with its
# own EXIT trap must call `a1_fx_cleanup` from it (or just drop its trap).
# Bash 3.2 (macOS) and GNU compatible: no namerefs, no mapfile, no ${var,,}.

if [[ -n "${A1_FX_ROOT:-}" && "${A1_FX_ROOT_PID:-}" == "$$" && -d "$A1_FX_ROOT" ]]; then
  return 0 2>/dev/null || true   # already sourced in this process
fi

# a1_fx_die <message> — harness failure; exits the calling suite.
a1_fx_die() { echo "FAIL  harness (tmp.sh): $*" >&2; exit 2; }

A1_FX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-root.XXXXXX")" || a1_fx_die "mktemp for the suite root failed"
[[ -n "$A1_FX_ROOT" && -d "$A1_FX_ROOT" ]] || a1_fx_die "suite root is empty or not a directory"
A1_FX_ROOT="$(cd "$A1_FX_ROOT" && pwd -P)" || a1_fx_die "realpath of the suite root failed"
[[ -n "$A1_FX_ROOT" && -d "$A1_FX_ROOT" ]] || a1_fx_die "suite root vanished after realpath"
A1_FX_ROOT_PID="$$"
export A1_FX_ROOT_PID

# a1_fx_cleanup — remove the suite root (chmod first: suites plant read-only dirs).
a1_fx_cleanup() {
  # Only the process that created the root removes it (child bash inherits nothing: not exported).
  [[ -n "${A1_FX_ROOT:-}" && "${A1_FX_ROOT_PID:-}" == "$$" && -d "$A1_FX_ROOT" ]] || return 0
  case "$A1_FX_ROOT" in */a1-fx-root.*) ;; *) return 0 ;; esac
  chmod -R u+w "$A1_FX_ROOT" 2>/dev/null
  rm -rf "$A1_FX_ROOT"
}

# mk_workdir <VAR> <label> — sets VAR (printf -v, no subshell) to a fresh real dir.
mk_workdir() {
  local __var="$1" __label="${2:-w}" __d
  [[ -n "$__var" ]] || a1_fx_die "mk_workdir: variable name missing"
  [[ -n "${A1_FX_ROOT:-}" && -d "$A1_FX_ROOT" ]] || a1_fx_die "mk_workdir: suite root is gone"
  __label="${__label//[^A-Za-z0-9._-]/_}"
  __d="$(mktemp -d "$A1_FX_ROOT/${__label}.XXXXXX")" || a1_fx_die "mk_workdir $__label: mktemp failed"
  [[ -n "$__d" && -d "$__d" ]] || a1_fx_die "mk_workdir $__label: no directory"
  __d="$(cd "$__d" && pwd -P)" || a1_fx_die "mk_workdir $__label: realpath failed"
  [[ -n "$__d" && -d "$__d" ]] || a1_fx_die "mk_workdir $__label: realpath gave no directory"
  printf -v "$__var" '%s' "$__d"
}

# mk_tmpfile <VAR> <label> — like mk_workdir, for an empty file.
mk_tmpfile() {
  local __var="$1" __label="${2:-f}" __f
  [[ -n "$__var" ]] || a1_fx_die "mk_tmpfile: variable name missing"
  [[ -n "${A1_FX_ROOT:-}" && -d "$A1_FX_ROOT" ]] || a1_fx_die "mk_tmpfile: suite root is gone"
  __label="${__label//[^A-Za-z0-9._-]/_}"
  __f="$(mktemp "$A1_FX_ROOT/${__label}.XXXXXX")" || a1_fx_die "mk_tmpfile $__label: mktemp failed"
  [[ -n "$__f" && -f "$__f" ]] || a1_fx_die "mk_tmpfile $__label: no file"
  printf -v "$__var" '%s' "$__f"
}

# Install the EXIT trap only if the suite has none (never clobber).
if [[ -z "$(trap -p EXIT)" ]]; then
  trap 'a1_fx_cleanup' EXIT
fi
