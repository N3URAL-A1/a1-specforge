#!/usr/bin/env bash
# Scenario suite for `a1-tools check reservations` (P7 cross-run registry).
# Scenarios:
#   claim                -> 0 (registers migration:090 for spec-016)
#   conflicting claim    -> 1 (spec-020 tries to claim migration:090)
#   idempotent re-claim  -> 0 (spec-016 re-claims migration:090)
#   list                 -> 0 (both entries visible)
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

WORK="$(mktemp -d)"
FILE="$WORK/reservations.json"

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL  $name: expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  else
    echo "PASS  $name (exit $actual)"
    pass=$((pass + 1))
  fi
}

# --- claim migration:090 for spec-016 -> 0 ---
OUT="$(node "$TOOLS" check reservations --claim migration:090 --by spec-016 --file "$FILE" 2>&1)"
assert_rc "claim" 0 $? "$OUT"

# --- also claim a route for spec-018 (second distinct entry) -> 0 ---
OUT="$(node "$TOOLS" check reservations --claim route:/api/users --by spec-018 --file "$FILE" 2>&1)"
assert_rc "claim-2" 0 $? "$OUT"

# --- conflicting claim: spec-020 wants migration:090 -> 1 ---
OUT="$(node "$TOOLS" check reservations --claim migration:090 --by spec-020 --file "$FILE" 2>&1)"
RC=$?
assert_rc "conflict" 1 "$RC" "$OUT"
if ! grep -q "spec-016" <<<"$OUT"; then
  echo "FAIL  conflict: holder spec-016 not reported"; fail=$((fail + 1))
fi

# --- idempotent re-claim by same spec -> 0 ---
OUT="$(node "$TOOLS" check reservations --claim migration:090 --by spec-016 --file "$FILE" 2>&1)"
assert_rc "idempotent" 0 $? "$OUT"

# --- list -> 0, both entries visible ---
OUT="$(node "$TOOLS" check reservations --list --file "$FILE" 2>&1)"
assert_rc "list" 0 $? "$OUT"
if ! grep -q "spec-016" <<<"$OUT" || ! grep -q "spec-018" <<<"$OUT"; then
  echo "FAIL  list: expected both spec-016 and spec-018 visible"; fail=$((fail + 1))
else
  echo "PASS  list-content (both entries visible)"; pass=$((pass + 1))
fi

echo "reservations fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
