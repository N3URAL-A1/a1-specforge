#!/usr/bin/env bash
# Part 07 — Wave 7, status coherence (spec 010 FR-027..FR-031, SC-007/SC-008).
# Sourced by run-tests.sh (never run on its own).
#   Section K — `product validate --spec-status` (_shared/lib/spec-coherence.cjs
#               through ONE call site in product.cjs), agent A.
#   Section B — `spec update-status` body header rewrite + roadmap hint
#               (_shared/lib/spec.cjs), agent B.
# (CL1/CL2 — checklist check #11 — live in _test-fixtures/a1-checklist/.)
#
# Every repo and vault here is a mktemp -d directory with A1_VAULT_ROOT, HOME
# and A1_CODE_ROOTS redirected — NEVER the real vault, NEVER the real
# ~/claude-projects. Every expected status, count and command string is a
# literal typed from the spec, never read from the module under test. Every
# case names the single production change that turns it red.
#
# Real shape: the spec file mirrors project/a1-specforge/spec/005-vault-first-
# artifacts.md as measured 2026-09-26 (frontmatter `status: done`, body header
# `> Spec ID: … · Project: … · Status: \`draft\``), the roadmap mirrors the
# schema-v1 feature block of docs/product/ROADMAP.md (005 `planned`,
# `stage: null`). K0 additionally runs against a COPY of this repo's own
# ROADMAP.md.

C_WORK="$(mktemp -d)"
mkdir -p "$C_WORK/home" "$C_WORK/noroots"

# c_roadmap <file> <feature-id> <status> <spec_path|null> — schema-v1 roadmap
# with one milestone and one feature (stage null unless status is done).
c_roadmap() {
  local file="$1" id="$2" st="$3" sp="$4" stage="null" fin="null" start="null"
  if [[ "$st" == "done" ]]; then stage="done"; fin="2026-09-13"; start="2026-09-13"; fi
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<EOF
---
schema_version: 1
type: roadmap
project: demo
title: "demo — Roadmap"
status: active
updated: 2026-09-25
source: "w7 fixture"
milestones:
  - id: continuous
    title: "Continuous"
    status: in-progress
    target: null
features:
  - id: $id
    milestone: continuous
    title: "Vault-first artifacts"
    status: $st
    stage: $stage
    depends_on: []
    started: $start
    finished: $fin
    spec_path: $sp
    plan_path: null
next: null
---

# demo — Roadmap

## Changelog

- **2026-09-13** — feature '$id' added — w7 fixture
EOF
}

# c_spec <file> <feature-id> <status> — real-shape spec (005 layout).
c_spec() {
  local file="$1" id="$2" st="$3"
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<EOF
---
id: $id
project: demo
feature_slug: vault-first-artifacts
title: "Vault-first artifacts — a1 writes its product docs, specs, and phase state"
status: $st
created: 2026-09-03
size: M
---

# Vault-first artifacts

> Spec ID: \`$id\` · Project: \`demo\` · Status: \`$st\`
>
> **Kurzfassung (DE):** a1 schreibt heute alles nur ins Code-Repo.

## Status history

Earlier drafts said Status: \`$st\` here as well — a second occurrence that
must never be rewritten.
EOF
}

# c_case <name> <spec-status|none> <roadmap-status> <spec_path-mode: path|null>
# Builds $C_WORK/<name>/{repo,vault}; spec file only when status != none.
c_case() {
  local name="$1" sst="$2" rst="$3" mode="$4" sp="null"
  local base="$C_WORK/$name"
  mkdir -p "$base/repo" "$base/vault/project/demo/spec"
  [[ "$mode" == "path" ]] && sp="project/demo/spec/005-demo.md"
  c_roadmap "$base/repo/docs/product/ROADMAP.md" 005-demo "$rst" "$sp"
  [[ "$sst" != "none" ]] && c_spec "$base/vault/project/demo/spec/005-demo.md" 005-demo "$sst"
  return 0
}

# c_validate <name> [extra args…] — runs `product validate --spec-status`
# from the case repo; sets C_OUT, C_RC; stderr in $C_WORK/stderr.
c_validate() {
  local name="$1"; shift
  local base="$C_WORK/$name"
  C_OUT="$(cd "$base/repo" && A1_VAULT_ROOT="$base/vault" HOME="$C_WORK/home" A1_CODE_ROOTS="$C_WORK/noroots" \
    node "$TOOLS" product validate "$@" 2>"$C_WORK/stderr")"
  C_RC=$?
}

# ---------- K1 terminal mismatch (SC-007 first half, US-010-3) ----------
# Red-making change: treating every disagreement as a warning (violation
# branch removed) → exit 0 and violations empty.
caseK1() {
  c_case k1 done planned path
  c_validate k1 --spec-status
  assert_rc "K1 spec done + roadmap planned → exit 1" 1 "$C_RC" "$(head -c 300 "$C_WORK/stderr")"
  assert_json "K1 exactly one violation" "$C_OUT" "j.spec_status.violations.length" "1"
  assert_json "K1 violation names roadmap status planned" "$C_OUT" \
    "/\`planned\`/.test(j.spec_status.violations[0].message)" "true"
  assert_json "K1 violation names spec status done" "$C_OUT" \
    "/spec status \`done\`/.test(j.spec_status.violations[0].message)" "true"
  assert_json "K1 reconcile = product stage --by 005-demo --set done" "$C_OUT" \
    "j.spec_status.violations[0].reconcile" "product stage --by 005-demo --set done"
  assert_json "K1 message carries the reconcile command" "$C_OUT" \
    "j.spec_status.violations[0].message.includes('product stage --by 005-demo --set done')" "true"
}

# ---------- K2 clarified / planned: no warning ----------
# Red-making change: mapping `clarified` to `in-flight` in
# SPEC_TO_ROADMAP_STATUS (→ 1 warning). Also resolves by GLOB (spec_path
# null): dropping the glob fallback turns "unlinked = 0" red.
caseK2() {
  c_case k2 clarified planned null
  c_validate k2 --spec-status
  assert_rc "K2 spec clarified + roadmap planned → exit 0" 0 "$C_RC" "$(head -c 300 "$C_WORK/stderr")"
  assert_json "K2 violations 0, warnings 0, unlinked 0 (glob resolved)" "$C_OUT" \
    "[j.spec_status.violations.length, j.spec_status.warnings.length, j.spec_status.unlinked.length].join(',')" "0,0,0"
}

# ---------- K3 implementing / planned: one warning ----------
# Red-making change: dropping non-terminal warnings (warnings.push removed).
caseK3() {
  c_case k3 implementing planned path
  c_validate k3 --spec-status
  assert_rc "K3 spec implementing + roadmap planned → exit 0" 0 "$C_RC"
  assert_json "K3 exactly one warning, no violation" "$C_OUT" \
    "[j.spec_status.warnings.length, j.spec_status.violations.length].join(',')" "1,0"
  assert_json "K3 warning names in-flight vs planned" "$C_OUT" \
    "/in-flight/.test(j.spec_status.warnings[0].message) && /planned/.test(j.spec_status.warnings[0].message)" "true"
}

# ---------- K4 unlinked ----------
# Red-making change: turning an unresolvable spec into a violation.
caseK4() {
  c_case k4 none planned null
  c_validate k4 --spec-status
  assert_rc "K4 feature without spec → exit 0" 0 "$C_RC"
  assert_json "K4 unlinked = 1 naming 005-demo, violations 0" "$C_OUT" \
    "[j.spec_status.unlinked.length, j.spec_status.unlinked[0].feature, j.spec_status.violations.length].join(',')" "1,005-demo,0"
}

# ---------- K5 both terminal, different ----------
# Red-making change: only checking "exactly one side terminal" (XOR instead
# of OR) → cancelled vs done passes.
caseK5() {
  c_case k5 cancelled done path
  c_validate k5 --spec-status
  assert_rc "K5 spec cancelled + roadmap done → exit 1" 1 "$C_RC"
  assert_json "K5 reconcile moves the spec to the roadmap's terminal status" "$C_OUT" \
    "j.spec_status.violations[0].reconcile" "spec update-status project/demo/spec/005-demo.md done"
}

# ---------- K6 reconciled (closes the SC-007 loop) ----------
# Runs EXACTLY the command K1 printed (a1-tools prefix added). Red if K1's
# command text is wrong (product stage then fails or sets another stage).
caseK6() {
  local cmd
  cmd="$(json_get "$C_K1_OUT" "j.spec_status.violations[0].reconcile")"
  # shellcheck disable=SC2086
  (cd "$C_WORK/k1/repo" && A1_VAULT_ROOT="$C_WORK/k1/vault" HOME="$C_WORK/home" A1_CODE_ROOTS="$C_WORK/noroots" \
    node "$TOOLS" $cmd >/dev/null 2>"$C_WORK/stderr.k6")
  assert_rc "K6 the printed reconcile command runs" 0 $? "$(head -c 300 "$C_WORK/stderr.k6")"
  c_validate k1 --spec-status
  assert_rc "K6 after reconcile → exit 0" 0 "$C_RC" "$(head -c 300 "$C_WORK/stderr")"
  assert_json "K6 after reconcile: no violation, no warning" "$C_OUT" \
    "[j.spec_status.violations.length, j.spec_status.warnings.length].join(',')" "0,0"
}

# ---------- K7 spec_path escaping the vault ----------
# Red-making change: resolving spec_path without the containment check (the
# outside `done` spec is then read and K7 exits 1).
caseK7() {
  c_case k7 none planned null
  c_spec "$C_WORK/k7/outside/005-demo.md" 005-demo done
  local rm="$C_WORK/k7/repo/docs/product/ROADMAP.md"
  sed 's#^    spec_path: null#    spec_path: ../outside/005-demo.md#' "$rm" > "$rm.new" && mv "$rm.new" "$rm"
  c_validate k7 --spec-status
  assert_rc "K7 spec_path outside the vault → exit 0 (never read)" 0 "$C_RC"
  assert_json "K7 reported unlinked with reason outside" "$C_OUT" \
    "[j.spec_status.unlinked.length, /outside/.test(j.spec_status.unlinked[0].reason)].join(',')" "1,true"
}

# ---------- K8 unknown spec status (Wave 6 lint outliers) ----------
# Red-making change: indexing SPEC_TO_ROADMAP_STATUS without the unknown
# guard (undefined !== planned → treated as drift or crash).
caseK8() {
  c_case k8 ux-draft planned path
  c_validate k8 --spec-status
  assert_rc "K8 spec status ux-draft → exit 0, never a crash" 0 "$C_RC" "$(head -c 300 "$C_WORK/stderr")"
  assert_json "K8 one warning of kind unknown_spec_status" "$C_OUT" \
    "[j.spec_status.warnings.length, j.spec_status.warnings[0].kind].join(',')" "1,unknown_spec_status"
}

# ---------- K9 without the flag: unchanged behaviour ----------
# Red-making change: running the coherence check unconditionally (the K1
# mismatch would then exit 1 and add a spec_status key).
caseK9() {
  c_case k9 done planned path
  c_validate k9
  assert_rc "K9 validate WITHOUT --spec-status on a mismatch → exit 0" 0 "$C_RC"
  assert_json "K9 output keys unchanged (valid,errors,warnings,file)" "$C_OUT" "Object.keys(j).join(',')" "valid,errors,warnings,file"
}

# ---------- K0 real shape: a copy of this repo's own ROADMAP.md ----------
# The live 005 mismatch (spec `done`, roadmap `planned`) must be detected
# before it is reconciled (SC-007, "recorded"). Only the 005 spec is placed
# in the temp vault; every other feature is unlinked. Red-making change: as
# K1. Once the real roadmap is reconciled (Wave 9), the copy no longer says
# `planned` and the case says so instead of asserting on a moved target.
caseK0() {
  local base="$C_WORK/k0"
  mkdir -p "$base/repo/docs/product" "$base/vault/project/a1-specforge/spec"
  cp "$REPO_ROOT/docs/product/ROADMAP.md" "$base/repo/docs/product/ROADMAP.md"
  c_spec "$base/vault/project/a1-specforge/spec/005-vault-first-artifacts.md" 005-vault-first-artifacts done
  if ! awk '/^  - id: 005-vault-first-artifacts$/{f=1;next} f&&/^  - id: /{f=0} f&&/^    status: planned$/{hit=1} END{exit !hit}' \
       "$base/repo/docs/product/ROADMAP.md"; then
    ok "K0 real roadmap no longer lists 005 as planned (reconciled) — real-shape detection not applicable"
    return
  fi
  C_OUT="$(cd "$base/repo" && A1_VAULT_ROOT="$base/vault" HOME="$C_WORK/home" A1_CODE_ROOTS="$C_WORK/noroots" \
    node "$TOOLS" product validate --spec-status 2>"$C_WORK/stderr")"
  C_RC=$?
  assert_rc "K0 real roadmap copy + 005 spec done → exit 1" 1 "$C_RC"
  assert_json "K0 the 005 violation names product stage --by 005-vault-first-artifacts --set done" "$C_OUT" \
    "j.spec_status.violations.map(v => v.feature + '|' + v.reconcile).join(' ')" \
    "005-vault-first-artifacts|product stage --by 005-vault-first-artifacts --set done"
}

caseK1
C_K1_OUT="$C_OUT"
caseK2; caseK3; caseK4; caseK5; caseK6; caseK7; caseK8; caseK9; caseK0

# ====================== Section B — spec update-status ======================

# b_body <file> — everything after the closing frontmatter fence.
b_body() { awk 'n>=2{print} /^---$/{n++}' "$1"; }

# b_update <vault> <spec-rel> <status> [code-roots] — runs from a neutral cwd
# (no roadmap there); sets B_OUT, B_RC, stderr in $C_WORK/b.stderr.
b_update() {
  local vault="$1" rel="$2" st="$3" roots="${4:-$C_WORK/noroots}"
  B_OUT="$(cd "$C_WORK/home" && A1_VAULT_ROOT="$vault" HOME="$C_WORK/home" A1_CODE_ROOTS="$roots" \
    node "$TOOLS" spec update-status "$rel" "$st" 2>"$C_WORK/b.stderr")"
  B_RC=$?
}

# ---------- B1 header rewrite (FR-030, SC-008) ----------
# Expected body built by awk (first occurrence only), never by the module.
# Red-making change: replacing every occurrence (the second `Status: \`draft\``
# in "Status history" changes too) — or none.
caseB1() {
  local v="$C_WORK/b1" f="$C_WORK/b1/project/demo/spec/005-demo.md"
  c_spec "$f" 005-demo draft
  b_body "$f" | awk '!d && sub(/Status: `draft`/, "Status: `clarified`") {d=1} 1' > "$C_WORK/b1.expected"
  b_update "$v" project/demo/spec/005-demo.md clarified
  assert_rc "B1 update-status clarified exits 0" 0 "$B_RC" "$(head -c 300 "$C_WORK/b.stderr")"
  b_body "$f" > "$C_WORK/b1.got"
  if cmp -s "$C_WORK/b1.got" "$C_WORK/b1.expected"; then ok "B1 body = original with the FIRST Status: \`draft\` → \`clarified\`"
  else bad "B1 body differs from the awk-built expectation: $(diff "$C_WORK/b1.expected" "$C_WORK/b1.got" | head -5 | tr '\n' ' ')"; fi
  assert_eq "B1 header line reads Status: \`clarified\`" \
    "$(grep -c '^> Spec ID: `005-demo` · Project: `demo` · Status: `clarified`$' "$f")" "1"
  assert_eq "B1 second occurrence untouched" "$(grep -c '^Earlier drafts said Status: `draft` here' "$f")" "1"
}

# ---------- B2 no header line / stale header ----------
# Red-making change: inserting a header when missing, or matching any status
# instead of the OLD one (B2b: header says `draft`, frontmatter says `done`
# — the real 005 shape — so no line matches `done` and the body stays).
caseB2() {
  local v="$C_WORK/b2" f="$C_WORK/b2/project/demo/spec/005-demo.md"
  mkdir -p "$(dirname "$f")"
  printf -- '---\nid: 005-demo\nproject: demo\nstatus: draft\n---\n\n# Title\n\nNo blockquote here.\n\n> Quote later: Status: `draft`\n' > "$f"
  b_body "$f" > "$C_WORK/b2.before"
  b_update "$v" project/demo/spec/005-demo.md clarified
  b_body "$f" > "$C_WORK/b2.after"
  assert_rc "B2 exits 0" 0 "$B_RC"
  if cmp -s "$C_WORK/b2.before" "$C_WORK/b2.after"; then ok "B2 no blockquote under the H1 → body byte-identical"
  else bad "B2 body changed although the H1 has no blockquote directly under it"; fi

  local g="$C_WORK/b2/project/demo/spec/006-stale.md"
  c_spec "$g" 006-stale draft
  sed 's/^status: draft$/status: done/' "$g" > "$g.new" && mv "$g.new" "$g"
  b_body "$g" > "$C_WORK/b2b.before"
  b_update "$v" project/demo/spec/006-stale.md cancelled
  b_body "$g" > "$C_WORK/b2b.after"
  if cmp -s "$C_WORK/b2b.before" "$C_WORK/b2b.after"; then ok "B2b stale header (draft ≠ old done) → body byte-identical"
  else bad "B2b stale header was rewritten although it does not match the old status"; fi

  # B2c — blockquote under the H1 without any Status line, no Status anywhere.
  # Red-making change: appending/inserting a header line when none matched.
  local h="$C_WORK/b2/project/demo/spec/007-noheader.md"
  printf -- '---\nid: 007-noheader\nproject: demo\nstatus: draft\n---\n\n# Title\n\n> Spec ID: `007-noheader` · Project: `demo`\n\nBody.\n' > "$h"
  b_body "$h" > "$C_WORK/b2c.before"
  b_update "$v" project/demo/spec/007-noheader.md clarified
  b_body "$h" > "$C_WORK/b2c.after"
  if cmp -s "$C_WORK/b2c.before" "$C_WORK/b2c.after"; then ok "B2c blockquote without a Status line → body byte-identical"
  else bad "B2c a Status line was inserted into a body that had none"; fi
}

# b_hint_case <name> <roadmap-status> <new-spec-status> — code root with one
# checkout whose roadmap has project demo; spec starts at implementing.
b_hint_case() {
  local name="$1" rst="$2" nst="$3"
  local base="$C_WORK/$name"
  c_roadmap "$base/code/demo-repo/docs/product/ROADMAP.md" 005-demo "$rst" project/demo/spec/005-demo.md
  c_spec "$base/vault/project/demo/spec/005-demo.md" 005-demo implementing
  cp "$base/code/demo-repo/docs/product/ROADMAP.md" "$base/roadmap.before"
  b_update "$base/vault" project/demo/spec/005-demo.md "$nst" "$base/code"
}

# ---------- B3 hint present, roadmap untouched (FR-031) ----------
# Red-making change: running `product stage` from update-status (the roadmap
# then changes and index.json/NEXT.md appear) — or dropping the hint.
caseB3() {
  b_hint_case b3 planned done
  assert_rc "B3 update-status done exits 0" 0 "$B_RC" "$(head -c 300 "$C_WORK/b.stderr")"
  assert_eq "B3 stderr names product stage --by 005-demo --set done" \
    "$(grep -c 'product stage --by 005-demo --set done' "$C_WORK/b.stderr")" "1"
  if cmp -s "$C_WORK/b3/code/demo-repo/docs/product/ROADMAP.md" "$C_WORK/b3/roadmap.before" \
     && [[ ! -e "$C_WORK/b3/code/demo-repo/docs/product/index.json" ]]; then ok "B3 roadmap byte-identical, nothing derived written"
  else bad "B3 update-status touched the roadmap"; fi
}

# ---------- B4 hint absent when the roadmap already agrees ----------
# Red-making change: printing the hint unconditionally.
caseB4() {
  b_hint_case b4 done done
  assert_rc "B4 exits 0" 0 "$B_RC"
  assert_eq "B4 roadmap already done → no product stage hint" "$(grep -c 'product stage' "$C_WORK/b.stderr")" "0"
}

# ---------- B5 no hint for a non-terminal status ----------
# Red-making change: hinting for every status (FR-031 names done|cancelled).
caseB5() {
  b_hint_case b5 planned awaiting-consistency-fix
  assert_rc "B5 exits 0" 0 "$B_RC"
  assert_eq "B5 non-terminal update → no hint" "$(grep -c 'product stage' "$C_WORK/b.stderr")" "0"
}

caseB1; caseB2; caseB3; caseB4; caseB5
rm -rf "$C_WORK"
