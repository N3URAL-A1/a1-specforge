#!/usr/bin/env bash
# Part 10 — Wave 7: everything that LEAVES for the provider is scanned
# (a1-samuel-security, 2 MAJOR, 2026-10-02, after the hardened live inspect).
# Sourced by run-tests.sh AFTER part 08, whose helpers it reuses (new8, c8,
# push8, plant8, al_*, store8, gate8, expect8, pass8, never_ran8, fp8 and the
# runtime-assembled fakes FAKE_AK*): this part adds no match to the repo's
# own scan (SC-009 clause), exactly like part 08.
#
# Measured outbound content (runner.py 2.1.0, pinned): inspect sends
# `git diff --no-ext-diff --no-textconv <base> --` of the snapshot working tree
# (runner.py:345) — every removed line, every deleted file and the base content
# of stripped repo-local files; the plan from the --plan path (runner.py:323);
# the --feedback file verbatim (runner.py:349). The runner records
# snapshot.diff_sha256 over the same diff with --binary (runner.py:106-107).
#
# Arm → the single production change that turns it red (fail arms also assert
# that the runner was never invoked):
#   O1  deleted file with a fake key → secret_in_snapshot.
#       Red if the base side is not scanned.
#   O2  removed line with a fake key in a surviving file → secret_in_snapshot.
#       Red if only deleted files (not every changed path) are scanned on the base side.
#   O3  renamed file whose key line was removed → secret_in_snapshot.
#       Red if the base-side path list uses rename detection (no --no-renames).
#   O4  a stripped repo-local file (AGENTS.md) holding a fake key → secret_in_snapshot.
#       Red if the base-side list is taken from the commit instead of the stripped working tree.
#   O5  a removed, allowlisted fake line → pass.
#       Red if the base side gets no allowlist.
#   O6  uncommitted PLAN.md with a fake key → secret_in_snapshot before dispatch.
#       Red if HEAD:PLAN.md is scanned instead of the copy that is sent.
#   O7  dispositions (--feedback) with a fake key → secret_in_snapshot before dispatch.
#       Red if the feedback is passed without the copy scan.
#   O8  the snapshot diff changed after the scan → fail/tripwire (detective: the
#       runner did run; its result is discarded). Red if the diff_sha256 comparison is dropped.
#   O9  a key added and removed within the wave never reaches the snapshot.
#       Red if inspect fetches base..head history instead of base and head only.
#   O10 the runner env carries GIT_CONFIG_NOSYSTEM=1. Red if it is dropped.
#   O11 --plan is the scanned copy under <snapshot>.inputs, byte-identical to PLAN.md.
#       Red if the working-tree PLAN.md path is passed.
#   O12 gitleaks runs over the base-side blobs (a marker only in a deleted
#       file's base blob → secret_in_snapshot/gitleaks). Red if that run is dropped.
#   O12b gitleaks runs over the input copies (a marker only in an uncommitted
#       PLAN.md). Red if that run is dropped.

if ! declare -F new8 >/dev/null; then
  bad "part 10: part 08 helpers (new8 …) are not loaded"
else

TMP10="$(mktemp -d)"
[[ -n "$TMP10" && -d "$TMP10" ]] || { echo "FAIL  part 10: mktemp -d failed" >&2; exit 1; }
SAVED_HOME_10="$HOME"

# feat10 — R8 on a feature branch off the pushed main tip; sets BASE10.
feat10() { push8; BASE10="$(head8)"; git -C "$R8" checkout -q -b feat; }
inspect10() { gate8 --gate "$GATE_WAVE" --wave 1 --base "$BASE10" "$@"; }

caseO1() {
  new8; plant8 k.txt "id: $FAKE_AK1"; c8 "key at base"; feat10
  git -C "$R8" rm -q k.txt; c8 "delete key file"
  inspect10; expect8 "O1 deleted file with a fake key" secret_in_snapshot
}

caseO2() {
  new8; plant8 f.txt "keep" "id: $FAKE_AK1"; c8 "key at base"; feat10
  plant8 f.txt "keep"; c8 "remove key line"
  inspect10; expect8 "O2 removed key line in a surviving file" secret_in_snapshot
}

caseO3() {
  new8
  local i lines=(); for i in $(seq 1 20); do lines+=("line $i of a long, stable file"); done
  plant8 a.txt "${lines[@]}" "id: $FAKE_AK1"; c8 "key at base"; feat10
  git -C "$R8" mv a.txt b.txt; plant8 b.txt "${lines[@]}"; c8 "rename and drop key"
  inspect10; expect8 "O3 renamed file whose key line was removed" secret_in_snapshot
}

caseO4() {
  new8; plant8 AGENTS.md "# agents" "id: $FAKE_AK1"; c8 "AGENTS.md with a key"; feat10
  printf '// feature\n' >> "$R8/src/add.js"; c8 "feature"
  inspect10; expect8 "O4 stripped AGENTS.md with a fake key at the base" secret_in_snapshot
}

caseO5() {
  new8
  local line="id: $FAKE_AK1"
  plant8 f.sh "keep" "$line"; c8 "fake"
  al_commit8 "$(al_doc "$(al_ent f.sh aws_access_key_id 1 fixture_fake "$(fp8 "$line")")")"
  push8; store8 "$(blobsha8)"; BASE10="$(head8)"
  git -C "$R8" checkout -q -b feat; plant8 f.sh "keep"; c8 "remove the allowlisted line"
  inspect10; pass8 "O5 a removed, allowlisted fake line"
  assert_json "O5 the base-side hit is reported as allowlisted" "$G_OUT" \
    "(j.allowlisted || []).filter(a => a.side === 'base').map(a => a.path + ':' + a.pattern).join(',')" "f.sh:aws_access_key_id"
}

caseO6() {
  new8; printf 'id: %s\n' "$FAKE_AK2" >> "$P8DIR/PLAN.md"
  gate8 --gate "$GATE_PLAN"; expect8 "O6 uncommitted PLAN.md with a fake key" secret_in_snapshot
}

caseO7() {
  new8; cp "$CASES/revise.PLAN.md" "$P8DIR/PLAN.md"; c8 "revise plan"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN"
  assert_json "O7 setup: round 1 is fail-with-findings" "$G_OUT" "j.verdict" "fail-with-findings"
  printf -- '- R1: rejected — see id: %s\n' "$FAKE_AK3" > "$P8DIR/xreview/plan-review-xprov-plan-r1.dispositions.md"
  gate8 --gate "$GATE_PLAN" --round 2
  expect8 "O7 dispositions with a fake key" secret_in_snapshot
}

# O8 drives `xprov snapshot` + `xprov run` directly, like parts 05/09: the
# snapshot is changed AFTER the scan, so the run's own baseline already holds
# the change and only the diff_sha256 comparison can see it.
caseO8() {
  make_tree; make_phase p10 "$CASES/approved.PLAN.md"
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --by fixture --record record/2026-09-24-fixture.md >/dev/null 2>&1 )
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json" 2>/dev/null; export A1_XPROV_CODEX_HOME="$XHOME"
  local base; base="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  printf '// wave change\n' >> "$PHASE_REPO/src/add.js"; ( cd "$PHASE_REPO" && git add -A && git commit -qm wave )
  local out; out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --base "$base" 2>/dev/null)"
  local snap; snap="$(json_get "$out" "j.snapshot || ''")"
  [[ -n "$snap" && -d "$snap" ]] || { bad "O8 setup: snapshot failed: $(json_get "$out" "j.reason")"; return; }
  printf '// changed after the scan\n' >> "$snap/src/add.js"
  local argv="$TMP10/o8-argv.json"
  FAKE_RUNNER_ARGV_FILE="$argv" FAKE_RUNNER_CASE=approved fake_runner_env
  local u; u="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode inspect --snapshot "$snap" --plan "$PHASE_PLAN" --phase p10 --gate "$GATE_WAVE" --wave 1 --base "$base" --timeout 7 2>/dev/null)"
  assert_json "O8 a snapshot diff changed after the scan → tripwire, result discarded" "$u" "j.reason + '/' + String(j.result_path)" "tripwire/null"
  [[ -f "$argv" ]] && ok "O8 (detective) the runner ran; its result was discarded" || bad "O8 the runner never ran — the arm did not reach the comparison"
}

caseO9() {
  new8; feat10
  plant8 tmp.txt "id: $FAKE_AK4"; c8 "add key"; local mid; mid="$(head8)"
  git -C "$R8" rm -q tmp.txt; c8 "remove key"
  local out; out="$(cd "$R8" && node "$TREE_TOOLS" xprov snapshot --repo "$R8" --commit HEAD --base "$BASE10" 2>/dev/null)"
  local snap; snap="$(json_get "$out" "j.snapshot || ''")"
  if [[ -n "$snap" && -d "$snap/.git" ]]; then
    git -C "$snap" cat-file -e "$mid^{commit}" 2>/dev/null && bad "O9 the intermediate commit holding the key is in the snapshot" || ok "O9 the intermediate commit is not in the snapshot"
    git -C "$snap" cat-file -e "$BASE10^{commit}" 2>/dev/null && ok "O9 base is in the snapshot" || bad "O9 base missing from the snapshot"
  else
    assert_json "O9 or the snapshot fails" "$out" "j.ok" "false"
  fi
}

caseO10O11() {
  new8; local envf="$TMP10/o10-env.json"
  ARGV8_N=$((ARGV8_N + 1)); ARGV8_FILE="$ARGV8_DIR/argv-$ARGV8_N.json"
  FAKE_RUNNER_ARGV_FILE="$ARGV8_FILE" FAKE_RUNNER_ENV_FILE="$envf" FAKE_RUNNER_CASE=approved fake_runner_env
  G_OUT="$(cd "$R8" && node "$TREE_TOOLS" xprov gate --phase p8 --gate "$GATE_PLAN" --timeout 7 2>/dev/null)"; G_RC=$?
  pass8 "O10 setup: plan review passes"
  assert_json "O10 GIT_CONFIG_NOSYSTEM=1 reaches the runner" "$(cat "$envf" 2>/dev/null || echo '{}')" "String(j.GIT_CONFIG_NOSYSTEM)" "1"
  local plan; plan="$(json_get "$(cat "$ARGV8_FILE" 2>/dev/null || echo '[]')" "j[j.indexOf('--plan') + 1] || ''")"
  [[ "$plan" == *"/snap-"*".inputs/PLAN.md" ]] && ok "O11 --plan is the copy under <snapshot>.inputs" || bad "O11 --plan is $plan"
  # the copy is removed with the snapshot; its content was what the scan saw
  assert_json "O11 index plan_sha256 is the sha256 of PLAN.md (the copy was byte-identical)" "$(cat "$P8DIR/xreview/index.json" 2>/dev/null || echo '[]')" \
    "String((j[0] || {}).plan_sha256)" "$(sha256_of "$P8DIR/PLAN.md")"
}

caseO12() {
  local needle="GITLEAKS-ONLY-MARKER-W7"
  new8; plant8 m.txt "$needle"; c8 "marker at base"; feat10
  git -C "$R8" rm -q m.txt; c8 "delete marker file"
  FAKE_GITLEAKS_NEEDLE="$needle" inspect10
  expect8 "O12 a gitleaks finding only in a base-side blob" "secret_in_snapshot/gitleaks"
  new8; printf '%s\n' "$needle" >> "$P8DIR/PLAN.md"
  FAKE_GITLEAKS_NEEDLE="$needle" gate8 --gate "$GATE_PLAN"
  expect8 "O12b a gitleaks finding only in the PLAN.md copy" "secret_in_snapshot/gitleaks"
}

caseO1; caseO2; caseO3; caseO4; caseO5; caseO6; caseO7; caseO8; caseO9; caseO10O11; caseO12
unset A1_XPROV_CODEX_HOME
export HOME="$SAVED_HOME_10"
rm -rf "$TMP10"
fi
