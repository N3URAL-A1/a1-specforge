#!/usr/bin/env bash
# Smoke tests for the `checklist` subcommand of _shared/a1-tools.cjs.
# Runs every fixture, asserts exit code and JSON .status field.

set -u

# Spec 010 Wave 4: every product writer mirrors docs/product into A1_VAULT_ROOT.
# A fixture must never reach the developer's real vault, and its expectations
# are the vault-free ones (SC-002) — so the suite runs without a vault root.
# Cases that need a vault set A1_VAULT_ROOT per call to a mktemp -d directory.
unset A1_VAULT_ROOT
unset A1_VAULT_WRITER_HOST  # spec 010 Wave 5: writer-host gate must not depend on the machine

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-checklist"

# Check #11 (spec 010 W7) looks for a roadmap in the cwd, the code-root
# checkouts and the vault mirror. Pin the code roots to an empty temp dir so
# no case ever reads a real ~/claude-projects checkout.
CL_WORK="$(mktemp -d)"
mkdir -p "$CL_WORK/noroots"
export A1_CODE_ROOTS="$CL_WORK/noroots"

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

# ---------- CL1/CL2: check #11 spec_roadmap_status_coherent (spec 010 W7) ----------
# Temp repo + temp vault (mktemp -d), never the real vault. Expectations are
# literals from FR-029. Each names its red-making change.

# cl_roadmap <file> <status> — schema-v1 roadmap, project demo, feature 001-login.
cl_roadmap() {
  mkdir -p "$(dirname "$1")"
  printf -- '---\nschema_version: 1\ntype: roadmap\nproject: demo\ntitle: "demo"\nstatus: active\nupdated: 2026-09-25\nsource: "w7"\nmilestones:\n  - id: m1\n    title: "M1"\n    status: in-progress\n    target: null\nfeatures:\n  - id: 001-login\n    milestone: m1\n    title: "Login"\n    status: %s\n    stage: null\n    depends_on: []\n    started: null\n    finished: null\n    spec_path: project/demo/spec/001-login.md\n    plan_path: null\nnext: null\n---\n\n# demo\n' "$2" > "$1"
}

# cl_case <name> <spec-status> <roadmap-status> <where: cwd|mirror>
cl_case() {
  local base="$CL_WORK/$1"
  mkdir -p "$base/repo" "$base/vault/project/demo/spec"
  sed "s/^status: clarified$/status: $2/" "$FIX/pass/project/demo/spec/001-login.md" > "$base/vault/project/demo/spec/001-login.md"
  if [[ "$4" == "cwd" ]]; then cl_roadmap "$base/repo/docs/product/ROADMAP.md" "$3"
  else cl_roadmap "$base/vault/project/demo/product/ROADMAP.md" "$3"; fi
  CL_OUT=$(cd "$base/repo" && node "$TOOLS" checklist run demo/001-login --vault "$base/vault" --only 11 --format json 2>/dev/null)
  CL_RC=$?
}

# cl_expect <label> <want-exit> <want "id|severity|result">
cl_expect() {
  local got
  got=$(printf '%s' "$CL_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const c=j.checks.find(x=>x.id===11)||{};process.stdout.write([j.checks.length,c.id,c.severity,c.result].join("|"))}catch(e){process.stdout.write("UNPARSEABLE")}})')
  if [[ "$CL_RC" == "$2" && "$got" == "1|$3" ]]; then
    results+=("PASS  $1 (exit=$CL_RC check=$got)"); pass=$((pass + 1))
  else
    results+=("FAIL  $1 expected exit=$2 check=1|$3, got exit=$CL_RC check=$got"); fail=$((fail + 1))
  fi
}

# CL1a — red-making: registering check #11 as MAJOR (exit 0, severity MAJOR),
# or --only 11 matching no check (usage exit, UNPARSEABLE).
cl_case cl1a done planned cwd
cl_expect "CL1a --only 11: spec done + cwd roadmap planned → BLOCKER FAIL" 1 "11|BLOCKER|FAIL"
# CL1b — red-making: mapping clarified to in-flight AND failing on warnings,
# or FAILing whenever spec and roadmap spell their status differently.
cl_case cl1b clarified planned cwd
cl_expect "CL1b --only 11: spec clarified + roadmap planned → PASS" 0 "11|BLOCKER|PASS"
# CL1c — red-making: dropping the vault-mirror tier of the roadmap lookup.
cl_case cl1c done planned mirror
cl_expect "CL1c --only 11: roadmap found only in the vault mirror → FAIL" 1 "11|BLOCKER|FAIL"
# CL1d — red-making: FAILing when no roadmap exists for the project.
mkdir -p "$CL_WORK/cl1d/repo" "$CL_WORK/cl1d/vault/project/demo/spec"
cp "$FIX/pass/project/demo/spec/001-login.md" "$CL_WORK/cl1d/vault/project/demo/spec/"
CL_OUT=$(cd "$CL_WORK/cl1d/repo" && node "$TOOLS" checklist run demo/001-login --vault "$CL_WORK/cl1d/vault" --only 11 --format json 2>/dev/null); CL_RC=$?
cl_expect "CL1d --only 11: no roadmap for the project → PASS" 0 "11|BLOCKER|PASS"

# CL2 — red-making: Gate 4.5 workflow still reads --only 9,10.
cl2=$(grep -c -- '--only 9,10,11' "$REPO_ROOT/skills/a1-new-feature/workflows/04.5-consistency-gate.md")
if [[ "$cl2" -ge 1 ]]; then results+=("PASS  CL2 04.5-consistency-gate.md reads --only 9,10,11 (${cl2}x)"); pass=$((pass + 1))
else results+=("FAIL  CL2 04.5-consistency-gate.md does not contain --only 9,10,11"); fail=$((fail + 1)); fi
rm -rf "$CL_WORK"

printf '\n--- a1-checklist fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
