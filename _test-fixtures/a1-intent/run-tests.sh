#!/usr/bin/env bash
# a1-intent — fixture suite for spec 011-intent-queue-consumer (the intent
# queue consumer). One runner; one case file per wave under cases/NN-*.sh,
# sourced in name order. Every result line names the requirement it belongs to
# (spec SC-001): "PASS  <case> ... [FR-NNN]".
#
# Isolation: every `a1-tools intent` call runs with HOME and A1_VAULT_ROOT
# pointed at a per-case sandbox under ONE mktemp -d work dir; the real vault
# and the real ~/.a1-intents are never touched. `claude` is replaced by
# stub/claude, first on PATH. stub/trace.cjs (NODE_OPTIONS preload) logs every
# file read and every child-process call of the CLI, so "no read outside" and
# "0 spawns" are measured, not assumed.
set -u
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID W6_SEAL_MODE

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SUITE_DIR/../.." && pwd)"

pass=0
fail=0

# Defense in depth: the suite must never change the permissions of its cwd (the
# checkout root). A case once stripped its write bit (2026-11-18 bug report).
START_PWD="$PWD"
# stat flavour picked once: GNU `-c %a`, BSD `-f %Lp` only if `-c` is unsupported
if stat -c %a / >/dev/null 2>&1; then pwd_mode() { stat -c %a "$1" 2>/dev/null; }
else pwd_mode() { stat -f %Lp "$1" 2>/dev/null; }; fi
START_PWD_MODE="$(pwd_mode "$PWD")"
CWD_CHECKED=""
# Runs before the summary and again from the EXIT trap (covers an exit-3 abort);
# counts at most one failure.
cwd_guard() {
  [[ -z "$CWD_CHECKED" ]] || return 0
  CWD_CHECKED=1
  local end; end="$(pwd_mode "$START_PWD")"
  if [[ -z "$end" ]]; then
    echo "FAIL  the suite's cwd vanished: $START_PWD" >&2; fail=$((fail + 1))
  elif [[ "$end" != "$START_PWD_MODE" ]]; then
    echo "FAIL  the suite changed the mode of its cwd $START_PWD: $START_PWD_MODE -> $end" >&2
    chmod "$START_PWD_MODE" "$START_PWD" 2>/dev/null
    fail=$((fail + 1))
  fi
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-intent.XXXXXX")"
if [[ -z "$WORK" || ! -d "$WORK" ]]; then
  echo "a1-intent: mktemp gave no directory — aborting before any case runs" >&2
  exit 3
fi
# seals are read-only by design; give write back before removing the work dir
suite_exit() {
  local rc=$?
  cwd_guard
  chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"
  if [[ $rc -eq 0 && $fail -ne 0 ]]; then exit 1; fi
}
trap suite_exit EXIT

# shellcheck source=lib.sh
source "$SUITE_DIR/lib.sh"

export LC_ALL=C
for case_file in "$SUITE_DIR"/cases/*.sh; do
  [[ -f "$case_file" ]] || continue
  # shellcheck disable=SC1090
  source "$case_file"
done

cwd_guard

echo "a1-intent: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
