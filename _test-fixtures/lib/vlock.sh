#!/usr/bin/env bash
# Shared helper for suites that run `verify run` / `pr merge-check` (spec 027 slice 3 review fix, Reinhard 2). Source it after tmp.sh.
#
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/vlock.sh"
#   vlock_private "$WORK"      # in the harness head, after mk_workdir
#   vlock_restore              # where a case used to `unset A1_VERIFY_LOCK_DIR ...`
#
# Why: run directly (no outer gate), such a suite takes the REAL per-uid verify lock and waits on a developer's own run.
# With no A1_VERIFY_LOCK_TOKEN in the environment this points A1_VERIFY_LOCK_DIR at a private dir under <workdir> and bounds the
# wait. With a token (an outer `verify run` holds the lock and the suites nest under it) nothing is changed: the token is never
# dropped in the suite shell. Bash 3.2 compatible.
vlock_private() {
  if [[ -z "${A1_VERIFY_LOCK_TOKEN:-}" ]]; then
    export A1_VERIFY_LOCK_DIR="$1/vlock-private" A1_VERIFY_LOCK_WAIT_MS=20000
  fi
  VLOCK_HAS_DIR="${A1_VERIFY_LOCK_DIR+x}"; VLOCK_DIR="${A1_VERIFY_LOCK_DIR-}"
  VLOCK_HAS_WAIT="${A1_VERIFY_LOCK_WAIT_MS+x}"; VLOCK_WAIT="${A1_VERIFY_LOCK_WAIT_MS-}"
}
# vlock_restore — back to the values vlock_private left (set or unset), after a case set its own lock dir.
vlock_restore() {
  if [[ -n "${VLOCK_HAS_DIR:-}" ]]; then export A1_VERIFY_LOCK_DIR="$VLOCK_DIR"; else unset A1_VERIFY_LOCK_DIR; fi
  if [[ -n "${VLOCK_HAS_WAIT:-}" ]]; then export A1_VERIFY_LOCK_WAIT_MS="$VLOCK_WAIT"; else unset A1_VERIFY_LOCK_WAIT_MS; fi
}
