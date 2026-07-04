#!/usr/bin/env bash
# Regression tests for `analyze add-findings --json` (and singular `add-finding`)
# in _shared/a1-tools.cjs. Shipped in commit 1499cd8; locked here (M6 SC-6).
# Cases: file input, stdin input, invalid severity (atomic — no partial write),
# singular add-finding regression. Self-cleaning: works in a temp dir.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-analyze-cli"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
results=()

record() {
  if [[ "$1" == "PASS" ]]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi
  results+=("$1  $2")
}

finding_count() { grep -c 'id=F-' "$1"; }

fresh_copy() { cp "$FIX/analysis.md" "$1"; }

# --- Case 1: file input ---
A="$TMP/case1.md"; fresh_copy "$A"
out=$(node "$TOOLS" analyze add-findings "$A" --json "$FIX/findings.json" 2>&1)
rc=$?
count=$(finding_count "$A")
if [[ "$rc" == 0 && "$count" == 3 ]]; then
  record PASS "file input (exit=0, 3 findings appended)"
else
  record FAIL "file input: expected exit=0 count=3, got exit=$rc count=$count — $out"
fi

# --- Case 2: stdin input ---
A="$TMP/case2.md"; fresh_copy "$A"
out=$(cat "$FIX/findings.json" | node "$TOOLS" analyze add-findings "$A" --json - 2>&1)
rc=$?
count=$(finding_count "$A")
if [[ "$rc" == 0 && "$count" == 3 ]]; then
  record PASS "stdin input (exit=0, 3 findings appended)"
else
  record FAIL "stdin input: expected exit=0 count=3, got exit=$rc count=$count — $out"
fi

# --- Case 3: invalid severity → non-zero exit, NO partial write ---
A="$TMP/case3.md"; fresh_copy "$A"
out=$(node "$TOOLS" analyze add-findings "$A" --json "$FIX/invalid-findings.json" 2>&1)
rc=$?
if [[ "$rc" != 0 ]] && cmp -s "$A" "$FIX/analysis.md"; then
  record PASS "invalid severity (exit=$rc, target unchanged)"
else
  record FAIL "invalid severity: expected non-zero exit + unchanged file, got exit=$rc changed=$(cmp -s "$A" "$FIX/analysis.md" || echo yes) — $out"
fi

# --- Case 4: singular add-finding regression ---
A="$TMP/case4.md"; fresh_copy "$A"
out=$(node "$TOOLS" analyze add-finding "$A" MAJOR schema "migrations/002.sql" "Missing audit trigger" --recommendation "Add AFTER trigger" 2>&1)
rc=$?
count=$(finding_count "$A")
if [[ "$rc" == 0 && "$count" == 1 ]]; then
  record PASS "singular add-finding (exit=0, 1 finding appended)"
else
  record FAIL "singular add-finding: expected exit=0 count=1, got exit=$rc count=$count — $out"
fi

printf '\n--- a1-analyze-cli fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

[[ "$fail" -gt 0 ]] && exit 1
exit 0
