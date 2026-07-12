#!/usr/bin/env bash
# Smoke tests for the `checklist` subcommand of _shared/a1-tools.cjs.
# Runs every fixture, asserts exit code and JSON .status field.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-checklist"

pass=0
fail=0
results=()

run_case() {
  local name="$1"
  local expected_exit="$2"
  local expected_status="$3"
  local vault="$FIX/$name"

  local out
  out=$(node "$TOOLS" checklist run demo/001-login --vault "$vault" --format json 2>&1)
  local actual_exit=$?

  local actual_status
  actual_status=$(printf '%s' "$out" | grep -m1 '"status"' | sed -E 's/.*"status": "([^"]+)".*/\1/')

  if [[ "$actual_exit" == "$expected_exit" && "$actual_status" == "$expected_status" ]]; then
    results+=("PASS  $name (exit=$actual_exit status=$actual_status)")
    pass=$((pass + 1))
  else
    results+=("FAIL  $name expected exit=$expected_exit status=$expected_status, got exit=$actual_exit status=$actual_status")
    results+=("      output:")
    while IFS= read -r line; do results+=("        $line"); done <<< "$out"
    fail=$((fail + 1))
  fi
}

# Auto-resolve test (slug only, no feature)
run_resolve_case() {
  local name="$1"
  local expected_exit="$2"
  local expected_status="$3"
  local vault="$FIX/$name"

  local out
  out=$(node "$TOOLS" checklist run demo --vault "$vault" --format json 2>&1)
  local actual_exit=$?

  local actual_status
  actual_status=$(printf '%s' "$out" | grep -m1 '"status"' | sed -E 's/.*"status": "([^"]+)".*/\1/')

  if [[ "$actual_exit" == "$expected_exit" && "$actual_status" == "$expected_status" ]]; then
    results+=("PASS  $name (slug-only resolve) (exit=$actual_exit status=$actual_status)")
    pass=$((pass + 1))
  else
    results+=("FAIL  $name (slug-only resolve) expected exit=$expected_exit status=$expected_status, got exit=$actual_exit status=$actual_status")
    while IFS= read -r line; do results+=("        $line"); done <<< "$out"
    fail=$((fail + 1))
  fi
}

# Gate mode (--only 9,10): the consistency-gate subset used by a1-new-feature
# Phase 4.5 — spec↔plan FR coverage + frontmatter link only, exit 0/1/2.
# Scenario vaults ported verbatim from the retired a1-check fixture (M13).
run_gate_case() {
  local name="$1"
  local expected_exit="$2"
  local expected_status="$3"
  local vault="$FIX/$name"

  local out
  out=$(node "$TOOLS" checklist run demo/001-login --vault "$vault" --only 9,10 --format json 2>&1)
  local actual_exit=$?

  local actual_status
  actual_status=$(printf '%s' "$out" | grep -m1 '"status"' | sed -E 's/.*"status": "([^"]+)".*/\1/')

  if [[ "$actual_exit" == "$expected_exit" && "$actual_status" == "$expected_status" ]]; then
    results+=("PASS  $name (--only 9,10) (exit=$actual_exit status=$actual_status)")
    pass=$((pass + 1))
  else
    results+=("FAIL  $name (--only 9,10) expected exit=$expected_exit status=$expected_status, got exit=$actual_exit status=$actual_status")
    while IFS= read -r line; do results+=("        $line"); done <<< "$out"
    fail=$((fail + 1))
  fi
}

run_case "pass"                          0 "PASS"
run_case "blocker-spec-not-clarified"    1 "FAIL"
run_case "blocker-no-plan"               1 "FAIL"
run_case "blocker-dep-cycle"             1 "FAIL"
run_case "blocker-fr-coverage"           1 "FAIL"
run_case "major-missing-agents"          0 "PASS_WITH_WARNINGS"
run_case "major-missing-stories"         0 "PASS_WITH_WARNINGS"
run_case "major-missing-frontmatter"     0 "PASS_WITH_WARNINGS"
run_case "minor-no-claudemd"             0 "PASS_WITH_WARNINGS"

# Slug-only auto-resolution must hit the same spec
run_resolve_case "pass"                  0 "PASS"

# Gate-mode subset (former a1-check invariants: coverage, phantoms, link)
run_gate_case "gate-pass"                0 "PASS"
run_gate_case "gate-fail-missing-fr"     1 "FAIL"
run_gate_case "gate-fail-duplicate-fr"   1 "FAIL"
run_gate_case "gate-fail-phantom-fr"     1 "FAIL"
run_gate_case "gate-fail-wrong-link"     1 "FAIL"
run_gate_case "gate-error-no-spec"       2 "ERROR"

printf '\n--- a1-checklist fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
