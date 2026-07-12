#!/usr/bin/env bash
# Scenario suite for `a1-tools schema-check run` (M6 Task 2.1b).
# 5 scenarios with asserted exit codes (0/1/1/1/2) + the 2.1a parser fixture.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

check_scenario() {
  local scenario="$1" expected_rc="$2" expected_grep="${3:-}"
  local out rc
  out="$(node "$TOOLS" schema-check run --migrations "$DIR/$scenario/migrations" 2>&1)"
  rc=$?
  if [[ $rc -ne $expected_rc ]]; then
    echo "FAIL  $scenario: expected exit $expected_rc, got $rc — $out"
    fail=$((fail + 1))
    return
  fi
  if [[ -n "$expected_grep" ]] && ! grep -q "$expected_grep" <<<"$out"; then
    echo "FAIL  $scenario: exit ok but output missing '$expected_grep' — $out"
    fail=$((fail + 1))
    return
  fi
  echo "PASS  $scenario (exit $rc)"
  pass=$((pass + 1))
}

check_scenario "pass" 0 "schema-check: PASS"
check_scenario "fail-no-audit-trigger" 1 "audit_trigger"
check_scenario "fail-no-rls" 1 "ENABLE ROW LEVEL SECURITY"
check_scenario "fail-fk-type-mismatch" 1 "FK type mismatch"
check_scenario "error-no-migrations" 2 "migrations dir not found"

# Parser unit fixture from Task 2.1a
if bash "$DIR/parser/run-parser.sh"; then
  pass=$((pass + 1))
else
  echo "FAIL  parser fixture"
  fail=$((fail + 1))
fi

echo "schema-check fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
