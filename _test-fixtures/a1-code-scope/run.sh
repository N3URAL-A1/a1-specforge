#!/usr/bin/env bash
# Scenario suite for `a1-tools code-scope` (path-list reservation claims,
# deterministic prefix/glob overlap gate). Mirrors the a1-reservations
# harness style (mktemp workdir, assert_rc, node invocations).
# Scenarios:
#   non-overlap claim                -> 0
#   prefix overlap (dir vs file)     -> 1, names holder feature
#   glob overlap                     -> 1, names holder feature
#   idempotent re-claim              -> 0
#   check (dry-run) does not write   -> 0/1, file untouched
#   works in a non-git tmp dir       -> 0 (no git assumptions anywhere)
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

# Use a tmp dir explicitly OUTSIDE any git repo to prove determinism (no git
# reads anywhere in the code-scope path).
WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-code-scope-test.XXXXXX")"
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

# --- confirm non-git tmp dir (determinism precondition) ---
if [[ -d "$WORK/.git" ]]; then
  echo "FAIL  precondition: tmp workdir unexpectedly has .git"; fail=$((fail + 1))
else
  echo "PASS  precondition (non-git tmp dir)"; pass=$((pass + 1))
fi

# --- claim feature-a: src/billing/,docs/billing.md -> 0 (non-overlapping) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-a --scope "src/billing/,docs/billing.md" --file "$FILE" 2>&1)"
assert_rc "claim-non-overlap" 0 $? "$OUT"

# --- claim feature-b: src/auth/ -> 0 (distinct from feature-a's scope) ---
OUT="$(node "$TOOLS" code-scope claim --by feature-b --scope "src/auth/" --file "$FILE" 2>&1)"
assert_rc "claim-second-feature" 0 $? "$OUT"

# --- prefix overlap: feature-c claims src/auth/login.ts, held by feature-b's src/auth/ -> 1 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-c --scope "src/auth/login.ts" --file "$FILE" 2>&1)"
RC=$?
assert_rc "prefix-overlap" 1 "$RC" "$OUT"
if ! grep -q "feature-b" <<<"$OUT"; then
  echo "FAIL  prefix-overlap: holder feature-b not named"; fail=$((fail + 1))
else
  echo "PASS  prefix-overlap names holder feature-b"; pass=$((pass + 1))
fi

# --- glob overlap: feature-d claims src/billing/** overlapping feature-a's src/billing/ -> 1 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-d --scope "src/billing/**" --file "$FILE" 2>&1)"
RC=$?
assert_rc "glob-overlap" 1 "$RC" "$OUT"
if ! grep -q "feature-a" <<<"$OUT"; then
  echo "FAIL  glob-overlap: holder feature-a not named"; fail=$((fail + 1))
else
  echo "PASS  glob-overlap names holder feature-a"; pass=$((pass + 1))
fi

# --- glob overlap (reverse direction): a fresh feature-e declares a glob that
#     a plain concrete path (feature-b's src/auth/) falls under -> 1 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-e --scope "src/**" --file "$FILE" 2>&1)"
RC=$?
assert_rc "glob-overlap-reverse" 1 "$RC" "$OUT"

# --- idempotent re-claim: feature-a re-claims identical scope -> 0 ---
OUT="$(node "$TOOLS" code-scope claim --by feature-a --scope "src/billing/,docs/billing.md" --file "$FILE" 2>&1)"
assert_rc "idempotent-reclaim" 0 $? "$OUT"
if ! grep -q '"idempotent": true' <<<"$OUT"; then
  echo "FAIL  idempotent-reclaim: expected idempotent:true in output"; fail=$((fail + 1))
else
  echo "PASS  idempotent-reclaim flagged idempotent:true"; pass=$((pass + 1))
fi

# --- dry-run check: does not write, still reports conflict for overlapping scope ---
BEFORE_HASH="$(shasum "$FILE" | awk '{print $1}')"
OUT="$(node "$TOOLS" code-scope check --by feature-z --scope "src/auth/login.ts" --file "$FILE" 2>&1)"
RC=$?
assert_rc "check-dry-run-conflict" 1 "$RC" "$OUT"
AFTER_HASH="$(shasum "$FILE" | awk '{print $1}')"
if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]; then
  echo "FAIL  check-dry-run: file was modified by a dry-run check"; fail=$((fail + 1))
else
  echo "PASS  check-dry-run (file untouched)"; pass=$((pass + 1))
fi

# --- dry-run check: non-overlapping scope -> 0, still no write ---
OUT="$(node "$TOOLS" code-scope check --by feature-z --scope "packages/unrelated/" --file "$FILE" 2>&1)"
assert_rc "check-dry-run-ok" 0 $? "$OUT"
AFTER2_HASH="$(shasum "$FILE" | awk '{print $1}')"
if [[ "$BEFORE_HASH" != "$AFTER2_HASH" ]]; then
  echo "FAIL  check-dry-run-ok: file was modified by a dry-run check"; fail=$((fail + 1))
else
  echo "PASS  check-dry-run-ok (file untouched)"; pass=$((pass + 1))
fi

# --- Wave 2: stage lifecycle ---

# --- stage advance persists + visible in list ---
OUT="$(node "$TOOLS" code-scope stage --by feature-a --set review --file "$FILE" 2>&1)"
assert_rc "stage-advance" 0 $? "$OUT"
if ! grep -q '"stage": "review"' <<<"$OUT"; then
  echo "FAIL  stage-advance: expected stage:review in output"; fail=$((fail + 1))
else
  echo "PASS  stage-advance reflects new stage in output"; pass=$((pass + 1))
fi

LIST_OUT="$(node "$TOOLS" code-scope list --file "$FILE" 2>&1)"
if ! grep -q '"stage": "review"' <<<"$LIST_OUT"; then
  echo "FAIL  stage-advance: stage:review not visible in --list output"; fail=$((fail + 1))
else
  echo "PASS  stage-advance visible in list output"; pass=$((pass + 1))
fi

# --- invalid stage -> 1 ---
OUT="$(node "$TOOLS" code-scope stage --by feature-a --set bogus-stage --file "$FILE" 2>&1)"
assert_rc "stage-invalid" 1 $? "$OUT"

# --- unknown feature id -> 1 ---
OUT="$(node "$TOOLS" code-scope stage --by feature-does-not-exist --set review --file "$FILE" 2>&1)"
assert_rc "stage-unknown-feature" 1 $? "$OUT"

# --- end-to-end auto-unblock: claim A -> claim B blocked -> release A -> claim B succeeds ---
E2E_FILE="$WORK/e2e-reservations.json"
OUT="$(node "$TOOLS" code-scope claim --by feature-x --scope "src/payments/" --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-claim-a" 0 $? "$OUT"

OUT="$(node "$TOOLS" code-scope claim --by feature-y --scope "src/payments/checkout.ts" --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-claim-b-blocked" 1 $? "$OUT"

OUT="$(node "$TOOLS" code-scope release --by feature-x --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-release-a" 0 $? "$OUT"
if ! grep -q '"released": true' <<<"$OUT"; then
  echo "FAIL  e2e-release-a: expected released:true in output"; fail=$((fail + 1))
else
  echo "PASS  e2e-release-a flagged released:true"; pass=$((pass + 1))
fi

OUT="$(node "$TOOLS" code-scope claim --by feature-y --scope "src/payments/checkout.ts" --file "$E2E_FILE" 2>&1)"
assert_rc "e2e-claim-b-succeeds-after-release" 0 $? "$OUT"

# --- release idempotent: releasing a non-existent entry -> 0, released:false ---
OUT="$(node "$TOOLS" code-scope release --by feature-never-claimed --file "$E2E_FILE" 2>&1)"
assert_rc "release-idempotent" 0 $? "$OUT"
if ! grep -q '"released": false' <<<"$OUT"; then
  echo "FAIL  release-idempotent: expected released:false in output"; fail=$((fail + 1))
else
  echo "PASS  release-idempotent flagged released:false"; pass=$((pass + 1))
fi

echo "code-scope fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
