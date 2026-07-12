#!/usr/bin/env bash
# Scenario suite for `a1-tools check reservations` (P7 cross-run registry).
# Scenarios:
#   claim                    -> 0 (registers migration:090 for spec-016)
#   conflicting claim        -> 1 (spec-020 tries to claim migration:090)
#   idempotent re-claim      -> 0 (spec-016 re-claims migration:090)
#   list                     -> 0 (both entries visible)
#   release-own              -> 0 (spec-016 releases its own migration:090 claim)
#   release-foreign          -> 1 (spec-020 tries to release spec-016's claim)
#   release-missing-idempotent -> 0 (releasing a non-existent claim is a no-op)
#   release-bulk-by           -> 0 (release ALL claims held by a given spec)
#   hostile-release-injection -> 0 idempotent, injection-shaped value treated inertly
#   hostile-release-overlong  -> 0 or 1, oversized value does not hang
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

# --- release-own: spec-016 releases its own migration:090 claim -> 0 ---
OUT="$(node "$TOOLS" check reservations --release --claim migration:090 --by spec-016 --file "$FILE" 2>&1)"
assert_rc "release-own" 0 $? "$OUT"
LIST_AFTER_RELEASE="$(node "$TOOLS" check reservations --list --file "$FILE" 2>&1)"
if grep -q '"090"' <<<"$LIST_AFTER_RELEASE"; then
  echo "FAIL  release-own: migration:090 still listed after release"; fail=$((fail + 1))
else
  echo "PASS  release-own-not-listed"; pass=$((pass + 1))
fi

# --- release-foreign: re-claim migration:091 as spec-016, then spec-020 tries to release it -> 1 ---
OUT="$(node "$TOOLS" check reservations --claim migration:091 --by spec-016 --file "$FILE" 2>&1)"
assert_rc "release-foreign-setup-claim" 0 $? "$OUT"
OUT="$(node "$TOOLS" check reservations --release --claim migration:091 --by spec-020 --file "$FILE" 2>&1)"
RC=$?
assert_rc "release-foreign" 1 "$RC" "$OUT"
if ! grep -q "FORBIDDEN" <<<"$OUT"; then
  echo "FAIL  release-foreign: expected FORBIDDEN in output"; fail=$((fail + 1))
else
  echo "PASS  release-foreign-forbidden"; pass=$((pass + 1))
fi
LIST_AFTER_FOREIGN="$(node "$TOOLS" check reservations --list --file "$FILE" 2>&1)"
if ! grep -q "091" <<<"$LIST_AFTER_FOREIGN"; then
  echo "FAIL  release-foreign: migration:091 claim should still be listed"; fail=$((fail + 1))
else
  echo "PASS  release-foreign-still-listed"; pass=$((pass + 1))
fi

# --- release-missing-idempotent: releasing a non-existent claim -> 0, idempotent ---
OUT="$(node "$TOOLS" check reservations --release --claim migration:999 --by spec-016 --file "$FILE" 2>&1)"
RC=$?
assert_rc "release-missing-idempotent" 0 "$RC" "$OUT"
if ! grep -q '"idempotent": true' <<<"$OUT"; then
  echo "FAIL  release-missing-idempotent: expected idempotent:true in output"; fail=$((fail + 1))
else
  echo "PASS  release-missing-idempotent-flag"; pass=$((pass + 1))
fi

# --- release-bulk-by: claim two entries for spec-030, then bulk-release by spec -> 0 ---
OUT="$(node "$TOOLS" check reservations --claim migration:200 --by spec-030 --file "$FILE" 2>&1)"
assert_rc "release-bulk-by-setup-1" 0 $? "$OUT"
OUT="$(node "$TOOLS" check reservations --claim route:/api/bulk --by spec-030 --file "$FILE" 2>&1)"
assert_rc "release-bulk-by-setup-2" 0 $? "$OUT"
OUT="$(node "$TOOLS" check reservations --release --by spec-030 --file "$FILE" 2>&1)"
assert_rc "release-bulk-by" 0 $? "$OUT"
LIST_AFTER_BULK="$(node "$TOOLS" check reservations --list --file "$FILE" 2>&1)"
if grep -q "spec-030" <<<"$LIST_AFTER_BULK"; then
  echo "FAIL  release-bulk-by: spec-030 claims should all be gone"; fail=$((fail + 1))
else
  echo "PASS  release-bulk-by-not-listed"; pass=$((pass + 1))
fi

# --- Hostile inputs (per _test-fixtures/CONVENTIONS.md) ---

# hostile-release-injection: shell-injection-shaped claim value must be treated
# as an inert string (no command execution), releasing idempotently (nothing
# to release since it was never claimed).
rm -f /tmp/pwned
OUT="$(node "$TOOLS" check reservations --release --claim 'x:$(touch /tmp/pwned)' --by spec-016 --file "$FILE" 2>&1)"
RC=$?
assert_rc "hostile-release-injection" 0 "$RC" "$OUT"
if [[ -e /tmp/pwned ]]; then
  echo "FAIL  hostile-release-injection: injection was executed, /tmp/pwned exists"; fail=$((fail + 1))
  rm -f /tmp/pwned
else
  echo "PASS  hostile-release-injection-inert"; pass=$((pass + 1))
fi
if ! grep -q '"idempotent": true' <<<"$OUT"; then
  echo "FAIL  hostile-release-injection: expected idempotent:true"; fail=$((fail + 1))
else
  echo "PASS  hostile-release-injection-idempotent"; pass=$((pass + 1))
fi

# hostile-release-overlong: oversized claim value must not hang and must exit
# with either 0 or 1 (never left running). No portable `timeout`/`gtimeout` on
# every dev machine (notably stock macOS) — bound it manually via a background
# job + wait/kill instead, same intent as CONVENTIONS.md "must fail fast or
# handle gracefully, never hang/crash".
OVERLONG_VALUE="$(head -c 12000 /dev/zero | tr '\0' 'a')"
OVERLONG_OUT_FILE="$WORK/overlong.out"
node "$TOOLS" check reservations --release --claim "type:$OVERLONG_VALUE" --by spec-016 --file "$FILE" >"$OVERLONG_OUT_FILE" 2>&1 &
OVERLONG_PID=$!
OVERLONG_WAITED=0
while kill -0 "$OVERLONG_PID" 2>/dev/null && [[ $OVERLONG_WAITED -lt 10 ]]; do
  sleep 1
  OVERLONG_WAITED=$((OVERLONG_WAITED + 1))
done
if kill -0 "$OVERLONG_PID" 2>/dev/null; then
  kill -9 "$OVERLONG_PID" 2>/dev/null
  RC=124
else
  wait "$OVERLONG_PID"
  RC=$?
fi
OUT="$(cat "$OVERLONG_OUT_FILE")"
if [[ $RC -eq 0 || $RC -eq 1 ]]; then
  echo "PASS  hostile-release-overlong (exit $RC)"; pass=$((pass + 1))
else
  echo "FAIL  hostile-release-overlong: expected exit 0 or 1, got $RC (possible hang/crash)"; fail=$((fail + 1))
fi

echo "reservations fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
