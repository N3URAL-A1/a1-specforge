#!/usr/bin/env bash
# Smoke tests for the `reconcile` subcommand group in _shared/a1-tools.cjs.
# Validates CLI mechanics end-to-end:
#   - init creates a drift report with correct frontmatter
#   - parse-spec extracts anchors and writes parsed_targets[]
#   - update-status transitions atomically + appends phase_history
#   - add-drift increments D-### IDs and recomputes drifts_count
#   - list finds the report
#
# Drift CLASSIFICATION (which class an anchor lands in) is NOT tested here —
# that's a sub-agent's job in Phase 3 of the skill, not a deterministic CLI op.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-reconcile"

pass=0
fail=0
results=()

assert() {
  local name="$1"
  local cond="$2"
  if [[ "$cond" == "1" ]]; then
    results+=("PASS  $name")
    pass=$((pass + 1))
  else
    results+=("FAIL  $name")
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Test 1: init creates report, parse-spec finds anchors, full lifecycle works
# ---------------------------------------------------------------------------
run_lifecycle() {
  local fixture="$1"
  local expected_anchor_min="$2"
  local vault="$FIX/$fixture/vault"
  local repo="$FIX/$fixture/repo"

  # Clean previous run
  rm -rf "$vault/project/demo/drift-"*.md 2>/dev/null

  # --- init ---
  local init_out
  init_out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile init demo \
    --scope single --spec 001-login \
    --project-path "$repo" --date 2026-05-13 2>&1)
  local init_exit=$?
  assert "[$fixture] init exit=0" "$([[ $init_exit -eq 0 ]] && echo 1 || echo 0)"
  local drift_file="$vault/project/demo/drift-2026-05-13.md"
  assert "[$fixture] init created drift file" "$([[ -f "$drift_file" ]] && echo 1 || echo 0)"

  # Check frontmatter has type=drift-report and status=scoped
  if grep -q '^type: drift-report$' "$drift_file" 2>/dev/null && \
     grep -q '^status: scoped$' "$drift_file" 2>/dev/null; then
    assert "[$fixture] init frontmatter correct" "1"
  else
    assert "[$fixture] init frontmatter correct" "0"
  fi

  # --- parse-spec ---
  local parse_out
  parse_out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile parse-spec \
    "project/demo/drift-2026-05-13.md" 2>&1)
  local parse_exit=$?
  assert "[$fixture] parse-spec exit=0" "$([[ $parse_exit -eq 0 ]] && echo 1 || echo 0)"
  local anchor_count
  anchor_count=$(printf '%s' "$parse_out" | grep -o '"target_count": [0-9]*' | grep -o '[0-9]*' || echo 0)
  if [[ "${anchor_count:-0}" -ge "$expected_anchor_min" ]]; then
    assert "[$fixture] parse-spec found >= $expected_anchor_min anchors (got $anchor_count)" "1"
  else
    assert "[$fixture] parse-spec found >= $expected_anchor_min anchors (got $anchor_count)" "0"
  fi

  # parsed_targets[] should appear in frontmatter
  if grep -q '^parsed_targets:$' "$drift_file" 2>/dev/null; then
    assert "[$fixture] parsed_targets[] written to frontmatter" "1"
  else
    assert "[$fixture] parsed_targets[] written to frontmatter" "0"
  fi

  # --- update-status: scoped -> parsed ---
  A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile update-status \
    "project/demo/drift-2026-05-13.md" parsed >/dev/null 2>&1
  local us_exit=$?
  assert "[$fixture] update-status parsed exit=0" "$([[ $us_exit -eq 0 ]] && echo 1 || echo 0)"
  if grep -q '^status: parsed$' "$drift_file" 2>/dev/null; then
    assert "[$fixture] status transitioned to parsed" "1"
  else
    assert "[$fixture] status transitioned to parsed" "0"
  fi

  # --- add-drift (simulate sub-agent output) ---
  A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile add-drift \
    "project/demo/drift-2026-05-13.md" \
    MISSING "src/auth/MissingFile.tsx" "File referenced by FR-001 not found" \
    --recommendation "Implement the login form component" \
    --spec-ref "FR-001" >/dev/null 2>&1
  local ad_exit=$?
  assert "[$fixture] add-drift MISSING exit=0" "$([[ $ad_exit -eq 0 ]] && echo 1 || echo 0)"

  A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile add-drift \
    "project/demo/drift-2026-05-13.md" \
    DIVERGED "src/auth/credentials.ts" "Function signature differs from spec" \
    --spec-ref "FR-002" --code-ref "src/auth/credentials.ts:1" >/dev/null 2>&1
  local ad2_exit=$?
  assert "[$fixture] add-drift DIVERGED exit=0" "$([[ $ad2_exit -eq 0 ]] && echo 1 || echo 0)"

  # ID auto-increment: should have D-001 and D-002
  if grep -q 'id=D-001' "$drift_file" && grep -q 'id=D-002' "$drift_file"; then
    assert "[$fixture] drift IDs auto-increment (D-001, D-002)" "1"
  else
    assert "[$fixture] drift IDs auto-increment (D-001, D-002)" "0"
  fi

  # drifts_count recomputed
  if grep -q 'missing=1' "$drift_file" && grep -q 'diverged=1' "$drift_file"; then
    assert "[$fixture] drifts_count recomputed (missing=1, diverged=1)" "1"
  else
    assert "[$fixture] drifts_count recomputed (missing=1, diverged=1)" "0"
  fi

  # --- final transition: probed -> reported ---
  A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile update-status \
    "project/demo/drift-2026-05-13.md" probed \
    --phase-data '{"agents_dispatched":[{"name":"gsd-a1-marco-mapper","completed_at":"2026-05-13T12:00:00Z","drift_count":2}],"in_sync_count":3}' \
    >/dev/null 2>&1
  local up_exit=$?
  assert "[$fixture] update-status probed with phase-data exit=0" "$([[ $up_exit -eq 0 ]] && echo 1 || echo 0)"
  if grep -q 'name=gsd-a1-marco-mapper' "$drift_file" && grep -q '^in_sync_count: 3$' "$drift_file"; then
    assert "[$fixture] phase-data agents_dispatched + in_sync_count persisted" "1"
  else
    assert "[$fixture] phase-data agents_dispatched + in_sync_count persisted" "0"
  fi

  A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile update-status \
    "project/demo/drift-2026-05-13.md" reported \
    --phase-data '{"suggested_next":[{"skill":"a1-fix","reason":"Fix MISSING","targets":["FR-001"]}]}' \
    >/dev/null 2>&1
  if grep -q 'skill=a1-fix' "$drift_file"; then
    assert "[$fixture] suggested_next persisted" "1"
  else
    assert "[$fixture] suggested_next persisted" "0"
  fi

  # phase_history should have all four phases (entries serialized as
  # "  - \"phase=...\"" by the frontmatter writer).
  local phases
  phases=$(grep -Ec '^[[:space:]]+-[[:space:]]+"?phase=' "$drift_file")
  phases=${phases//[^0-9]/}
  if [[ "${phases:-0}" -ge 4 ]]; then
    assert "[$fixture] phase_history has >= 4 entries (got $phases)" "1"
  else
    assert "[$fixture] phase_history has >= 4 entries (got $phases)" "0"
  fi

  # --- list ---
  local list_out
  list_out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile list demo 2>&1)
  if printf '%s' "$list_out" | grep -q '"count": 1'; then
    assert "[$fixture] list finds the report" "1"
  else
    assert "[$fixture] list finds the report" "0"
  fi
}

# ---------------------------------------------------------------------------
# Test 2: next-slot collision handling
# ---------------------------------------------------------------------------
run_slot_collision() {
  local vault="$FIX/single-pass/vault"
  # Slot 1 already exists from run_lifecycle. Call next-slot again, expect "-2".
  local out
  out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile next-slot demo \
    --date 2026-05-13 2>&1)
  if printf '%s' "$out" | grep -q '"suffix": "-2"'; then
    assert "[slot-collision] next-slot returns -2 when -1 is taken" "1"
  else
    assert "[slot-collision] next-slot returns -2 when -1 is taken" "0"
  fi
}

# ---------------------------------------------------------------------------
# Test 3: anchor extraction extracts files + endpoints
# ---------------------------------------------------------------------------
run_anchor_extraction() {
  local vault="$FIX/single-pass/vault"
  local drift_file="$vault/project/demo/drift-2026-05-13.md"
  # Spec has: LoginForm.tsx, credentials.ts, POST /api/login
  # Expect parsed_targets to mention all three.
  if grep -q 'kind=file' "$drift_file" 2>/dev/null && \
     grep -q 'kind=endpoint' "$drift_file" 2>/dev/null; then
    assert "[anchors] both file and endpoint kinds extracted" "1"
  else
    assert "[anchors] both file and endpoint kinds extracted" "0"
  fi
}

# ---------------------------------------------------------------------------
# Test 4: validation — bad scope mode rejected
# ---------------------------------------------------------------------------
run_validation() {
  A1_VAULT_ROOT="$FIX/single-pass/vault" node "$TOOLS" reconcile init demo \
    --scope bogus --spec 001-login --date 2026-05-13 >/dev/null 2>&1
  local exit_code=$?
  assert "[validation] init rejects bogus scope (exit=1)" "$([[ $exit_code -eq 1 ]] && echo 1 || echo 0)"

  A1_VAULT_ROOT="$FIX/single-pass/vault" node "$TOOLS" reconcile add-drift \
    "project/demo/drift-2026-05-13.md" \
    INVALIDCLASS "x" "y" >/dev/null 2>&1
  local exit2=$?
  assert "[validation] add-drift rejects bad class (exit=1)" "$([[ $exit2 -eq 1 ]] && echo 1 || echo 0)"
}

# ---------- run all ----------
run_lifecycle "single-pass"    3   # LoginForm.tsx, credentials.ts, POST /api/login
run_lifecycle "single-missing" 2   # MissingFile.tsx, credentials.ts
run_slot_collision
run_anchor_extraction
run_validation

printf '\n--- a1-reconcile fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
