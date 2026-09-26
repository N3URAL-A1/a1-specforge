#!/usr/bin/env bash
# Part 01 — Wave 1, section S: vocabulary owner + versioned contract export.
# Sourced by run-tests.sh (never run on its own): uses its helpers and
# counters. Cases S1–S10 from the wave plan's Wave 1 fixture table; every
# case names the single production change that turns it red.
#
# Literals below are the contract at version 1, typed here by hand from the
# spec (FR-016, FR-020, FR-027, SCHEMA.md §1) — NOT read from
# status-constants.cjs or vault-contract.cjs.

S_OUT="$(node "$TOOLS" schema export --json 2>/dev/null)"
S_RC=$?

# ---------- S1 golden: bytes equal the committed golden ----------
# Red-making change: changing any value in SPEC_STATUSES (or any exported
# set) without regenerating the golden — SC-010 first half.
caseS1() {
  local tmp; tmp="$(mktemp)"
  node "$TOOLS" schema export --json > "$tmp" 2>/dev/null
  assert_rc "S1a schema export --json exits 0" 0 "$S_RC"
  if [[ -f "$GOLDEN" ]] && cmp -s "$tmp" "$GOLDEN"; then ok "S1b export bytes equal golden/schema-export.v1.json"
  else bad "S1b export differs from golden/schema-export.v1.json (or golden missing) — bump VAULT_CONTRACT_VERSION and regenerate together"; fi
  rm -f "$tmp"
}

# ---------- S2 version literal ----------
# Red-making change: bumping VAULT_CONTRACT_VERSION without touching this
# fixture (proves S1 and S2 guard independently).
caseS2() { assert_json "S2 contract_version is the literal 1" "$S_OUT" "j.contract_version" "1"; }

# ---------- S3 deterministic: two runs are byte-identical ----------
# Red-making change: adding a `generated: nowIso()` key to the export.
caseS3() {
  local a b; a="$(mktemp)"; b="$(mktemp)"
  node "$TOOLS" schema export --json > "$a" 2>/dev/null
  node "$TOOLS" schema export --json > "$b" 2>/dev/null
  if cmp -s "$a" "$b"; then ok "S3 two runs produce identical bytes"; else bad "S3 two runs differ"; fi
  rm -f "$a" "$b"
}

# ---------- S4 sorted keys, exact key list ----------
# Red-making change: removing the key sort before stringify (S4a), or adding /
# dropping / renaming any top-level key (S4b — the literal list from FR-020).
caseS4() {
  assert_json "S4a top-level keys are sorted" "$S_OUT" \
    "JSON.stringify(Object.keys(j)) === JSON.stringify([...Object.keys(j)].sort())" "true"
  assert_json "S4b top-level keys are exactly the FR-020 list" "$S_OUT" "Object.keys(j).join(',')" \
    "analysis_statuses,artifact_types,bug_statuses,contract_version,hub_relation_line,milestone_statuses,mirror,project_statuses,quick_results,roadmap_feature_statuses,roadmap_stages,schema_version,size_values,spec_statuses,spec_to_roadmap_status"
}

# ---------- S5 artifact types literal ----------
# Red-making change: renaming `bug-report` to `fix` (the rename the Clarify
# session rejected), or adding a seventh folder.
caseS5() {
  assert_json "S5 artifact_types is the six-pair map from FR-016" "$S_OUT" "JSON.stringify(j.artifact_types)" \
    '{"spec":"spec","plans":"wave-plan","fixes":"bug-report","postmortems":"postmortem","analyses":"project-analysis","quick":"quick-run"}'
}

# ---------- S6 mapping literal ----------
# Red-making change: mapping `clarified` to `in-flight` (S6a) or
# `implementing` to `planned` (S6b).
caseS6() {
  assert_json "S6a spec_to_roadmap_status.clarified is planned" "$S_OUT" "j.spec_to_roadmap_status.clarified" "planned"
  assert_json "S6b spec_to_roadmap_status.implementing is in-flight" "$S_OUT" "j.spec_to_roadmap_status.implementing" "in-flight"
}

# ---------- S7 hostile / usage ----------
# Red-making change: ignoring extra argv (S7a passes a traversal-shaped token
# after --json and must be refused), or accepting a missing --json (S7b).
caseS7() {
  local err rc
  err="$(node "$TOOLS" schema export --json ../../etc 2>&1 >/dev/null)"; rc=$?
  assert_rc "S7a schema export --json ../../etc is refused" 1 "$rc"
  if grep -q "schema export requires --json" <<<"$err"; then ok "S7a usage text names the requirement on stderr"
  else bad "S7a stderr lacks the usage text: $(head -c 200 <<<"$err")"; fi
  err="$(node "$TOOLS" schema export 2>&1 >/dev/null)"; rc=$?
  assert_rc "S7b schema export without --json is refused" 1 "$rc"
  if grep -q "schema export requires --json" <<<"$err"; then ok "S7b usage text names the requirement on stderr"
  else bad "S7b stderr lacks the usage text: $(head -c 200 <<<"$err")"; fi
}

# ---------- S8 alias: schema_version written from the one constant ----------
# Red-making change: writing schema_version as a second hardcoded literal —
# then "bump VAULT_CONTRACT_VERSION to 2" leaves the alias at 1 and S8 goes
# red (S2 goes red too, as designed).
caseS8() {
  assert_json "S8 schema_version === contract_version === 1" "$S_OUT" \
    "j.schema_version === j.contract_version && j.contract_version === 1" "true"
}

# ---------- S9 sizes: export AND spec set-size read the same set ----------
# Red-making change: exporting sizes from a second hand-typed array instead of
# the moved SPEC_SIZES — the mutation "add XL to the moved set" must flip S9a
# and S9b together; with a copy only one flips.
caseS9() {
  assert_json "S9a size_values is the literal [S,M,L]" "$S_OUT" "JSON.stringify(j.size_values)" '["S","M","L"]'
  local work rc
  work="$(mktemp -d)"
  mkdir -p "$work/vault/project/demo/spec"
  printf -- '---\nid: 001-demo\nstatus: draft\nsize: null\n---\n\n# Demo\n' > "$work/vault/project/demo/spec/001-demo.md"
  A1_VAULT_ROOT="$work/vault" node "$TOOLS" spec set-size project/demo/spec/001-demo.md XL >/dev/null 2>&1; rc=$?
  assert_rc "S9b spec set-size XL is refused" 1 "$rc"
  rm -rf "$work"
}

# ---------- S10 roadmap enums: export AND product validate read the same sets ----------
# Red-making change: exporting from anywhere other than the constants
# `product validate` reads — the mutation "rename paused in the moved
# constant" must flip S10b and S10c together.
caseS10() {
  assert_json "S10a milestone_statuses is the literal [done,in-progress,planned]" "$S_OUT" \
    "JSON.stringify(j.milestone_statuses)" '["done","in-progress","planned"]'
  assert_json "S10b project_statuses is the literal [active,paused,done]" "$S_OUT" \
    "JSON.stringify(j.project_statuses)" '["active","paused","done"]'
  local work rc
  work="$(mktemp -d)"
  node "$TOOLS" product init --project s10demo --title "S10 Demo" --dir "$work/docs" >/dev/null 2>&1
  sed -i.bak 's/^status: active$/status: paused/' "$work/docs/ROADMAP.md" && rm -f "$work/docs/ROADMAP.md.bak"
  node "$TOOLS" product validate --dir "$work/docs" >/dev/null 2>&1; rc=$?
  assert_rc "S10c product validate accepts status: paused" 0 "$rc"
  sed -i.bak 's/^status: paused$/status: bogus/' "$work/docs/ROADMAP.md" && rm -f "$work/docs/ROADMAP.md.bak"
  node "$TOOLS" product validate --dir "$work/docs" >/dev/null 2>&1; rc=$?
  assert_rc "S10d product validate rejects status: bogus" 1 "$rc"
  rm -rf "$work"
}

# ---------- S11 declared order + null stage (FR-020 "arrays in declared order") ----------
# Red-making change: exporting roadmap_stages without the leading null, or
# sorting the arrays instead of keeping declared order.
caseS11() {
  assert_json "S11a roadmap_stages keeps null first, declared order" "$S_OUT" "JSON.stringify(j.roadmap_stages)" \
    '[null,"started","complete","review","verify","merge","origin-cleanup","done"]'
  assert_json "S11b spec_statuses in declared order" "$S_OUT" "JSON.stringify(j.spec_statuses)" \
    '["discovering","draft","clarified","planned","awaiting-consistency-fix","implementing","done","cancelled"]'
  assert_json "S11c mirror sets are the FR-002/003/004 lists" "$S_OUT" "JSON.stringify(j.mirror)" \
    '{"product":["ROADMAP.md","VISION.md","NEXT.md","index.json","features/**","audits/**"],"phases":["phases/*/GOAL.md","phases/*/PLAN.md","phases/*/STATUS.md","phases/*/VERIFICATION.md","RESEARCH.md"],"excluded":["reservations.json",".product-stage.lock.json","*.lock*","*.tmp*","observations.jsonl"]}'
  assert_json "S11d hub_relation_line is the FR-024 template" "$S_OUT" "j.hub_relation_line" \
    '- references [[project/<slug>/<subfolder>/<basename>]]'
}

# ---------- S12 released goldens are frozen (FR-021, review 010 m6) ----------
# S1 compares the export with golden/schema-export.v1.json, so changing e.g.
# BUG_STATUSES and regenerating v1 IN PLACE kept the suite green. A released
# version's golden never changes: every golden/schema-export.v<N>.json is
# pinned here by the sha256 of its bytes (typed literal, not computed from the
# file under test), and a golden without a pin is red too — a new contract
# version adds its file AND its line below in the same commit.
# Red-making change: regenerating schema-export.v1.json from a changed export
# without a contract_version bump (S1 green, S12a red), or adding
# schema-export.v2.json without a pin line (S12b red).
S_GOLDEN_PINS=(
  "schema-export.v1.json 41fcf4231e5c76251a93be14a8550879a6e43343c8b4820c711d88ce5755c4b2"
)
s_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}
caseS12() {
  local pin name want f pinned
  for pin in "${S_GOLDEN_PINS[@]}"; do
    name="${pin%% *}"; want="${pin#* }"
    assert_eq "S12a released golden $name is byte-frozen (sha256)" "$(s_sha256 "$SUITE/golden/$name" 2>/dev/null)" "$want"
  done
  for f in "$SUITE"/golden/schema-export.v*.json; do
    [[ -f "$f" ]] || continue
    pinned=""
    for pin in "${S_GOLDEN_PINS[@]}"; do [[ "${pin%% *}" == "$(basename "$f")" ]] && pinned=yes; done
    if [[ -n "$pinned" ]]; then ok "S12b $(basename "$f") has a sha256 pin"
    else bad "S12b $(basename "$f") has no sha256 pin in parts/01-schema-export.sh"; fi
  done
}

caseS1; caseS2; caseS3; caseS4; caseS5; caseS6; caseS7; caseS8; caseS9; caseS10; caseS11; caseS12
