#!/usr/bin/env bash
# Fixture: the parallel fixture-suite runner bin/run-suites.sh (spec 026-fast-fixture-suites).
#
# One part file per wave (parts/NN-*.sh, sourced in NN order, so waves never share a part):
#   01 discovery + declaration file · 02 worker pool + serial group · 03 isolation env + leak check
# Every runner start goes through rs_run: it sets the lock seam (A1_SUITE_LOCK_DIR) and TMPDIR under a
# fresh mk_workdir and clears an inherited run marker, so a run inside a worker of an outer runner
# is neither refused by the outer lock nor mistaken for it, and nothing touches /tmp/a1-suite-runner-<uid>.
# The runner is only ever started on PLANTED trees (--root), never on the real _test-fixtures/ set.
# Runtime budget: <= 60 s (this suite runs nested inside a1-vault-cockpit I1 under the sequential loop).
set -u
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
SUITE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SUITE/../.." && pwd)"
# Shared temp helper: guarded, explicit template, one EXIT trap (see CONVENTIONS "Isolation").
. "$SUITE/../lib/tmp.sh" || exit 2
RUNNER="$REPO_ROOT/bin/run-suites.sh"

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; shift; for l in "$@"; do echo "      $l"; done; fail=$((fail + 1)); }
assert_eq() { # name actual expected
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "expected: [$3]" "actual:   [$2]"; fi
}
assert_contains() { # name haystack needle
  if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1" "missing: [$3]" "in: [$2]"; fi
}
assert_absent() { # name haystack needle
  if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1" "unexpected: [$3]" "in: [$2]"; fi
}
assert_file_absent() { # name path
  if [[ ! -e "$2" ]]; then ok "$1"; else bad "$1" "exists: $2"; fi
}
assert_file_present() { # name path
  if [[ -e "$2" ]]; then ok "$1"; else bad "$1" "missing: $2"; fi
}

# write_groups <tree> <serial-json> [no_count-json] — the declaration file of a planted tree.
write_groups() {
  mkdir -p "$1/_test-fixtures"
  printf '{"serial":%s,"no_count":%s,"ci_jobs":{},"timings":{"measured":null,"seconds":{}}}\n' \
    "$2" "${3:-[]}" > "$1/_test-fixtures/suite-groups.json"
}
# mk_tree <VAR> [label] — a planted repository root with an empty declaration file.
mk_tree() {
  mk_workdir "$1" "${2:-tree}"
  local __d="${!1}"
  write_groups "$__d" '[]'
}
# plant_suite <tree> <identity> <body> — a runner script with the given body.
plant_suite() {
  local f="$1/_test-fixtures/$2"
  mkdir -p "$(dirname "$f")"
  printf '#!/usr/bin/env bash\n%s\n' "$3" > "$f"
}
# plant_ok <tree> <identity> — a green suite that prints an assert summary.
plant_ok() { plant_suite "$1" "$2" "echo \"$2: 1 passed, 0 failed\""; }

# rs_run <tree> [runner args...] — sets RS_OUT (stdout+stderr), RS_RC, RS_TMPD, RS_LOCKD, RS_RUN_DIR.
# RS_ENV_EXTRA="A=1 B=2" rs_run ... adds environment assignments (no spaces in values).
rs_run() {
  local tree="$1"; shift
  mk_workdir RS_RUN_DIR rsrun
  mkdir -p "$RS_RUN_DIR/tmp" || return 1
  RS_TMPD="$RS_RUN_DIR/tmp"
  RS_LOCKD="$RS_RUN_DIR/lock"
  # The runner runs in the background and is polled, so a hang (a mutated worker bound, say) turns
  # one case red instead of blocking the suite; only the PID from $! is ever signalled.
  # shellcheck disable=SC2086
  ( cd "$RS_RUN_DIR" && exec env -u A1_SUITE_RUN_MARKER -u A1_VAULT_ROOT ${RS_ENV_EXTRA:-} \
    A1_SUITE_LOCK_DIR="$RS_LOCKD" TMPDIR="$RS_TMPD" bash "$RUNNER" --root "$tree" "$@" ) \
    > "$RS_RUN_DIR/out.txt" 2>&1 < /dev/null &
  local rpid=$! ticks=0
  while kill -0 "$rpid" 2>/dev/null; do
    sleep 0.2
    ticks=$((ticks + 1))
    if [[ $ticks -ge $RS_RUN_LIMIT_TICKS ]]; then kill -TERM "$rpid" 2>/dev/null; break; fi
  done
  wait "$rpid"; RS_RC=$?
  RS_OUT="$(cat "$RS_RUN_DIR/out.txt")"
  [[ $ticks -lt $RS_RUN_LIMIT_TICKS ]] || RS_OUT="$RS_OUT"$'\n'"TIMED OUT after the suite limit"
}
RS_RUN_LIMIT_TICKS=300   # x 0.2 s = 60 s per runner start

for part in "$SUITE"/parts/[0-9][0-9]-*.sh; do
  [[ -f "$part" ]] || continue
  # shellcheck disable=SC1090
  . "$part"
done

echo "a1-suite-runner: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
