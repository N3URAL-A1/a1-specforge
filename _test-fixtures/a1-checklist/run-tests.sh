#!/usr/bin/env bash
# Smoke tests for the `checklist` subcommand of _shared/a1-tools.cjs.
# Runs every fixture, asserts exit code and JSON .status field.

set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

# Spec 010 Wave 4: every product writer mirrors docs/product into A1_VAULT_ROOT.
# A fixture must never reach the developer's real vault, and its expectations
# are the vault-free ones (SC-002) — so the suite runs without a vault root.
# Cases that need a vault set A1_VAULT_ROOT per call to a mktemp -d directory.
unset A1_VAULT_ROOT
unset A1_VAULT_WRITER_HOST A1_HOST_ID  # spec 010 Waves 5+10: writer gate and host id must not depend on the machine

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-checklist"

# Check #11 (spec 010 W7) looks for a roadmap in the cwd, the code-root
# checkouts and the vault mirror. Pin the code roots to an empty temp dir so
# no case ever reads a real ~/claude-projects checkout.
mk_workdir CL_WORK cl_work
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
run_case "blocker-dep-cycle-suffixed"    1 "FAIL"   # F-018: Wave 1 <-> Wave 1b
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
run_gate_case "gate-fail-suffixed-wave"  1 "FAIL"   # F-018: FR-002 in Wave 1 and Wave 1b
run_gate_case "gate-fail-unrecognised-wave" 1 "FAIL"  # F-018: "## Wave 2B" is no wave id
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

# ---------- CL3: a roadmap that exists but does not parse (review 010 m8) ----------
# Before the fix a broken roadmap read as "no roadmap" and BLOCKER #11 PASSed.
# cl_broken <file> <project-line or ""> — frontmatter without its closing ---.
cl_broken() {
  mkdir -p "$(dirname "$1")"
  printf -- '---\nschema_version: 1\ntype: roadmap\n%bfeatures:\n  - id: 001-login\n    status: planned\n\n# never closed\n' "$2" > "$1"
}
# cl_run11 <base> <code-roots> — spec done in the vault, --only 11, cwd = <base>/repo.
cl_run11() {
  mkdir -p "$1/repo" "$1/vault/project/demo/spec"
  sed "s/^status: clarified$/status: done/" "$FIX/pass/project/demo/spec/001-login.md" > "$1/vault/project/demo/spec/001-login.md"
  CL_OUT=$(cd "$1/repo" && A1_CODE_ROOTS="$2" node "$TOOLS" checklist run demo/001-login --vault "$1/vault" --only 11 --format json 2>/dev/null)
  CL_RC=$?
}
cl_detail() { printf '%s' "$CL_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write((JSON.parse(s).checks.find(x=>x.id===11)||{}).detail||"")}catch(e){process.stdout.write("UNPARSEABLE")}})'; }
cl_detail_has() {
  if [[ "$(cl_detail)" == *"$2"* ]]; then results+=("PASS  $1"); pass=$((pass + 1))
  else results+=("FAIL  $1: detail [$(cl_detail)] lacks [$2]"); fail=$((fail + 1)); fi
}
# CL3a — red-making: readRoadmapAt returning null on a parse error again
# (spec-coherence.cjs), or checklist #11 ignoring `fm: null`.
cl_broken "$CL_WORK/cl3a/repo/docs/product/ROADMAP.md" 'project: demo\n'
cl_run11 "$CL_WORK/cl3a" "$CL_WORK/noroots"
cl_expect "CL3a --only 11: cwd roadmap of this project does not parse → BLOCKER FAIL" 1 "11|BLOCKER|FAIL"
cl_detail_has "CL3a detail names the broken file" "$CL_WORK/cl3a/repo/docs/product/ROADMAP.md cannot be parsed"
# CL3b — red-making: brokenBelongsTo attributing a broken cwd roadmap that
# names ANOTHER project (a foreign repo's broken file must not block).
cl_broken "$CL_WORK/cl3b/repo/docs/product/ROADMAP.md" 'project: other\n'
cl_run11 "$CL_WORK/cl3b" "$CL_WORK/noroots"
cl_expect "CL3b --only 11: broken cwd roadmap names another project → PASS" 0 "11|BLOCKER|PASS"
# CL3c — red-making: brokenBelongsTo never attributing a code-root checkout.
cl_broken "$CL_WORK/cl3c/roots/sib/docs/product/ROADMAP.md" 'project: demo\n'
cl_run11 "$CL_WORK/cl3c" "$CL_WORK/cl3c/roots"
cl_expect "CL3c --only 11: broken sibling roadmap names this project → BLOCKER FAIL" 1 "11|BLOCKER|FAIL"
# CL3d — red-making: treating a code-root checkout like the cwd (a sibling
# whose broken roadmap names no project would block every gate on the machine).
cl_broken "$CL_WORK/cl3d/roots/sib/docs/product/ROADMAP.md" ''
cl_run11 "$CL_WORK/cl3d" "$CL_WORK/cl3d/roots"
cl_expect "CL3d --only 11: broken sibling roadmap without project line → PASS" 0 "11|BLOCKER|PASS"

# ---------- CL4: --only 9,10 performs no roadmap scan (review 010 M2) ----------
# A preloaded shim logs every readFileSync of a ROADMAP.md. The planted code
# root holds a sibling whose roadmap disagrees with the spec (done vs planned),
# so a scan would also be visible as a FAIL under --only 11 (CL4b, control:
# proves the shim sees the lookup at all).
# CL4a red-making: dropping the `wants(11)` guard in runChecklistChecks — #11
# then runs, is filtered from the output, and the trace shows the read.
CL4="$CL_WORK/cl4"
mkdir -p "$CL4/repo" "$CL4/vault/project/demo/spec"
sed "s/^status: clarified$/status: done/" "$FIX/pass/project/demo/spec/001-login.md" > "$CL4/vault/project/demo/spec/001-login.md"
cp "$FIX/pass/project/demo/CLAUDE.md" "$CL4/vault/project/demo/" 2>/dev/null
cp -R "$FIX/pass/project/demo/plans" "$CL4/vault/project/demo/"
cl_roadmap "$CL4/roots/sib/docs/product/ROADMAP.md" planned
cat > "$CL4/trace.cjs" <<'SHIM'
const fs = require('fs');
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  if (String(p).endsWith('ROADMAP.md')) fs.appendFileSync(process.env.CL_TRACE, `${p}\n`);
  return orig.call(this, p, ...rest);
};
SHIM
cl4_run() {
  : > "$CL4/trace.$1"
  CL4_OUT=$(cd "$CL4/repo" && CL_TRACE="$CL4/trace.$1" A1_CODE_ROOTS="$CL4/roots" \
    node -r "$CL4/trace.cjs" "$TOOLS" checklist run demo/001-login --vault "$CL4/vault" --only "$2" --format json 2>"$CL4/err.$1")
  CL4_RC=$?
}
cl4_run a 9,10
cl4_ids=$(printf '%s' "$CL4_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).checks.map(c=>c.id).join(","))}catch(e){process.stdout.write("UNPARSEABLE")}})')
cl4_trace="$(cat "$CL4/trace.a")"; cl4_err="$(cat "$CL4/err.a")"
if [[ "$CL4_RC" == 0 && "$cl4_ids" == "9,10" && -z "$cl4_trace" && "$cl4_err" != *"code roots:"* ]]; then
  results+=("PASS  CL4a --only 9,10 reads no ROADMAP.md, prints no code-roots line (exit=0 checks=9,10)"); pass=$((pass + 1))
else
  results+=("FAIL  CL4a --only 9,10 exit=$CL4_RC checks=$cl4_ids trace=[$cl4_trace] err=[$cl4_err]"); fail=$((fail + 1))
fi
cl4_run b 11
if [[ "$CL4_RC" == 1 && "$(cat "$CL4/trace.b")" == *"$CL4/roots/sib/docs/product/ROADMAP.md"* ]]; then
  results+=("PASS  CL4b control: --only 11 reads the planted sibling roadmap and FAILs (exit=1)"); pass=$((pass + 1))
else
  results+=("FAIL  CL4b control exit=$CL4_RC trace=[$(cat "$CL4/trace.b")]"); fail=$((fail + 1))
fi

# ---------- CL5: spec 028 FR-013/FR-014 — clause carry and edge-case warnings on check 9 ----------
# cl5_vault <name> <spec-fr-block> <plan-waves> [<spec-extra>] — a temp vault with a clarified spec and a plan.
cl5_vault() {
  local base="$CL_WORK/cl5-$1"
  mkdir -p "$base/project/demo/spec" "$base/project/demo/plans"
  printf -- '---\nid: 001-login\nproject: demo\nfeature_slug: login\ntitle: Login\nstatus: clarified\ncreated: 2026-05-13\n---\n\n# Login — Spec\n\n## Functional Requirements\n\n%b\n%b' "$2" "${4:-}" > "$base/project/demo/spec/001-login.md"
  printf -- '---\nspec_path: project/demo/spec/001-login.md\nspec_id: 001-login\nproject: demo\ncreated: 2026-05-13\nwaves: 2\n---\n\n# Login — Wave Plan\n\n%b' "$3" > "$base/project/demo/plans/001-login-wave-plan.md"
  CL5_OUT=$(node "$TOOLS" checklist run demo/001-login --vault "$base" --only 9,10 --format json 2>/dev/null); CL5_RC=$?
}
# cl5_c9 <js-expression over c (the check-9 object)> — prints the value as JSON, UNPARSEABLE on failure.
cl5_c9() { printf '%s' "$CL5_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const c=j.checks.find(x=>x.id===9);const v=eval(process.argv[1]);process.stdout.write(JSON.stringify(v===undefined?null:v))}catch(e){process.stdout.write("UNPARSEABLE")}})' "$1"; }
cl5_assert() { # <label> <want> <got>
  if [[ "$2" == "$3" ]]; then results+=("PASS  $1 ($3)"); pass=$((pass + 1))
  else results+=("FAIL  $1 want=[$2] got=[$3]"); fail=$((fail + 1)); fi
}
FRB='- **FR-001** — Users can export the list and notify the owner.\n'
WAVE_EXPORT='## Wave 1 — Export\n\n**FRs covered:** FR-001\n\nBuild the export of the list.\n\n## Wave 2 — Other\n\n**FRs covered:** none\n\nowner notification lives here.\n'

# CL5a — the US-028-7 scenario. Red-making: no `warnings` key, or the clause compared with the whole plan.
cl5_vault a "$FRB" "$WAVE_EXPORT"
cl5_assert "CL5a clause_not_carried: reason" '"clause_not_carried"' "$(cl5_c9 'c.warnings[0].reason')"
cl5_assert "CL5a clause_not_carried: id" '"FR-001"' "$(cl5_c9 'c.warnings[0].id')"
cl5_assert "CL5a clause_not_carried: clause text" '"notify the owner"' "$(cl5_c9 'c.warnings[0].clause')"
cl5_assert "CL5a clause_not_carried: one warning only (the export clause is carried)" 1 "$(cl5_c9 'c.warnings.length')"
cl5_assert "CL5a clause_not_carried: hint text" '"name the clause in the wave acceptance text or move it out of scope"' "$(cl5_c9 'c.warnings[0].hint')"
cl5_assert "CL5a result stays PASS, exit 0" "PASS|0" "$(cl5_c9 'c.result' | tr -d '"')|$CL5_RC"
# CL5b — control: the wave names both clauses, so no warnings key (Default D-2: key only when non-empty).
cl5_vault b "$FRB" '## Wave 1 — Export\n\n**FRs covered:** FR-001\n\nExport the list and notify the owner.\n'
cl5_assert "CL5b both clauses carried: no warnings key" null "$(cl5_c9 'c.warnings')"
# CL5c — a clause under 3 words is skipped (red-making: no word-count floor).
cl5_vault c '- **FR-001** — Users export lists; notify owner.\n' '## Wave 1 — Export\n\n**FRs covered:** FR-001\n\nBuild lists.\n'
cl5_assert "CL5c two-word clause skipped" null "$(cl5_c9 'c.warnings')"
# CL5d — a clause without a 5-letter token is skipped (red-making: warn on empty token set).
cl5_vault d '- **FR-001** — We can go on and do it now.\n' '## Wave 1 — Export\n\n**FRs covered:** FR-001\n\nBuild lists.\n'
cl5_assert "CL5d clause without a content token skipped" null "$(cl5_c9 'c.warnings')"
# CL5e — FR clause is compared with the carrying wave only: the token sits in Wave 2, not Wave 1.
cl5_vault e '- **FR-001** — Users must archive stale records.\n' '## Wave 1 — A\n\n**FRs covered:** FR-001\n\nBuild lists.\n\n## Wave 2 — B\n\n**FRs covered:** none\n\narchive stale records here.\n'
cl5_assert "CL5e token only in another wave: warning" '"clause_not_carried"' "$(cl5_c9 'c.warnings[0].reason')"
# CL5f — an SC line is compared with the whole plan: the same token in any wave carries it.
SCB='- **FR-001** — Users can export lists.\n- **SC-001** — Reviewers see archived warnings quickly.\n'
cl5_vault f "$SCB" '## Wave 1 — A\n\n**FRs covered:** FR-001\n\nExport lists.\n\n## Wave 2 — B\n\n**FRs covered:** none\n\nReviewers can see archived warnings quickly.\n'
cl5_assert "CL5f SC clause carried anywhere in the plan: no warnings" null "$(cl5_c9 'c.warnings')"
cl5_vault f2 "$SCB" '## Wave 1 — A\n\n**FRs covered:** FR-001\n\nExport lists.\n'
cl5_assert "CL5f2 SC clause absent from the plan: warning id SC-001" '"SC-001"' "$(cl5_c9 'c.warnings[0].id')"
cl5_assert "CL5f2 SC warning leaves result PASS" "PASS|0" "$(cl5_c9 'c.result' | tr -d '"')|$CL5_RC"

# CL5m9 — review round m9: FR-001 is not carried by a wave that only covers FR-001-2 (red-making: the id lookup ended at \b, so "-2" still matched).
cl5_vault h "$FRB" '## Wave 1 — Export\n\n**FRs covered:** FR-001-2\n\nBuild the export of the list.\n'
cl5_assert "CL5m9 a wave naming only FR-001-2 does not carry FR-001: no clause warning for FR-001" null "$(cl5_c9 'c.warnings')"

# CL5g — FR-014 edge cases: count, warning when the plan never says "edge" (red-making: no edge_cases key).
EDGEB='\n## Edge Cases\n\n- Empty export list returns an empty file.\n- Owner address missing.\n\n## Other\n\n- not an edge bullet\n'
cl5_vault g '- **FR-001** — Users can export lists.\n' '## Wave 1 — A\n\n**FRs covered:** FR-001\n\nExport lists.\n' "$EDGEB"
cl5_assert "CL5g edge_cases counts bullets under ## Edge Cases only" 2 "$(cl5_c9 'c.edge_cases')"
cl5_assert "CL5g edge_cases_unplanned reason" '"edge_cases_unplanned"' "$(cl5_c9 'c.warnings.find(w=>w.reason==="edge_cases_unplanned").reason')"
cl5_assert "CL5g edge_cases_unplanned hint text" '"add an edge-case task or acceptance line to the plan"' "$(cl5_c9 'c.warnings.find(w=>w.reason==="edge_cases_unplanned").hint')"
cl5_assert "CL5g result stays PASS, exit 0" "PASS|0" "$(cl5_c9 'c.result' | tr -d '"')|$CL5_RC"
# CL5h — control: the plan mentions "Edge" in any case: count stays, no warning.
cl5_vault h '- **FR-001** — Users can export lists.\n' '## Wave 1 — A\n\n**FRs covered:** FR-001\n\nExport lists. Edge cases: empty list.\n' "$EDGEB"
cl5_assert "CL5h edge mentioned: edge_cases still 2" 2 "$(cl5_c9 'c.edge_cases')"
cl5_assert "CL5h edge mentioned: no warnings key" null "$(cl5_c9 'c.warnings')"
# CL5i — control: spec without an Edge Cases section: neither key (Default D-2).
cl5_vault i '- **FR-001** — Users can export lists.\n' '## Wave 1 — A\n\n**FRs covered:** FR-001\n\nExport lists.\n'
cl5_assert "CL5i no edge section: no edge_cases key" null "$(cl5_c9 'c.edge_cases')"
cl5_assert "CL5i no edge section: no warnings key" null "$(cl5_c9 'c.warnings')"

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
