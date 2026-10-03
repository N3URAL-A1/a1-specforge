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
#
# Plan-review resume (team-lead decision (b), 2026-10-02): the runner refuses a
# resume whose record.repo/plan differ from the new run (runner.py:257-264; the
# fake now ports that check). Round 2 rebuilds round 1's snapshot at the path
# the runner recorded, after strict validation.
#   RR3 a round-2 resume runs at the same snapshot path (and its plan copy).
#       Red if round 2 builds a fresh mktemp snapshot (the live defect).
#   RR1 a record path outside the snapshots dir → refused before dispatch.
#       Red if the parent-directory check is dropped.
#   RR2 a record path that is a symlink → refused.   Red if stat (following) replaces lstat.
#   RR4 a record path that exists and is not empty → refused.
#       Red if a non-empty dir is reused.
#   RR5 a record plan that is not <record.repo>.inputs/PLAN.md → refused.
#       Red if resumeTarget drops the plan-path check.
#
# `xprov run` takes only the snapshot's scanned copies (Codex R1, live inspect
# 2026-10-03: the input scan sat in the gate alone, `run` passed any file):
#   RI1 a foreign --plan (the working-tree PLAN.md) → refused, runner never invoked.
#       Red if inputProblem drops the path-equality check.
#   RI2 the PLAN.md copy changed after the snapshot → refused.
#       Red if inputProblem drops the hash comparison.
#   RI3 --feedback outside <snapshot>.inputs → refused.
#       Red if only --plan is checked.
#
# Path NAMES leave too (Codex R1, live inspect 2026-10-03): the runner's change
# manifest and diff headers carry every outbound path. A path hit is never
# allowlisted and the name is never echoed (it may be the secret itself).
#   P1 a tracked, empty file with a secret-shaped name in a PLAN review (no diff:
#      Codex lists the snapshot itself) → secret_in_snapshot (side path).
#      Red if the snapshot's tracked paths are not name-scanned.
#   P1b the same name added in an inspected wave → same (either list catches it).
#   P2 a deleted, empty file with a secret-shaped name → same.
#      Red if base-side paths are not name-scanned.
#   P3 a secret-shaped name renamed to a benign one → same.
#      Red if the base-side path list uses rename detection.
#   P0 control: a benign added name passes.
#   P4 `xprov snapshot` itself (stdout JSON, stderr) never echoes the name.
#      Red if the path text is put into the snapshot result.
#   Every failing P arm also asserts the name appears in none of stdout, stderr,
#   PLAN-REVIEW-LOG.md, XREVIEW.md. Red if the path text is put in a detail.
#   (The second, late re-hash right before the spawn closes the window between
#   that check and the spawn; no CLI arm can reach it — it shares inputProblem.)

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
  local out; out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --base "$base" --plan "$PHASE_PLAN" 2>/dev/null)"
  local snap; snap="$(json_get "$out" "j.snapshot || ''")"
  [[ -n "$snap" && -d "$snap" ]] || { bad "O8 setup: snapshot failed: $(json_get "$out" "j.reason")"; return; }
  printf '// changed after the scan\n' >> "$snap/src/add.js"
  local argv="$TMP10/o8-argv.json"
  FAKE_RUNNER_ARGV_FILE="$argv" FAKE_RUNNER_CASE=approved fake_runner_env
  local u; u="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode inspect --snapshot "$snap" --plan "$snap.inputs/PLAN.md" --phase p10 --gate "$GATE_WAVE" --wave 1 --base "$base" --timeout 7 2>/dev/null)"
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

# rr10 — phase with the revise plan, round 1 REVISE, dispositions written.
# Sets RR_PREV (round-1 result.json) and RR_REPO (its recorded snapshot path).
rr10() {
  new8; cp "$CASES/revise.PLAN.md" "$P8DIR/PLAN.md"; c8 "revise plan"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN"
  RR_PREV="$(json_get "$G_OUT" "j.result_path")"
  RR_REPO="$(json_get "$(cat "$RR_PREV" 2>/dev/null || echo '{}')" "j.repo || ''")"
  printf -- '- F1: accepted — fixed in the plan\n' > "$P8DIR/xreview/plan-review-xprov-plan-r1.dispositions.md"
}
# rr_set_repo <path> — rewrites record.repo AND record.plan (= <path>.inputs/PLAN.md)
# in the round-1 result.json: a self-consistent hostile record, so the path
# checks alone have to refuse it (RR5 covers an inconsistent plan).
rr_set_repo() { node -e 'const fs=require("fs");const [f,v]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(f,"utf8"));j.repo=v;j.plan=v+".inputs/PLAN.md";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$RR_PREV" "$1"; }
refused10() { # <name> — round 2 refused at step snapshot (snapshot_failed), runner never invoked
  local got; got="$(json_get "$G_OUT" "j.step + ':' + j.reason + ':' + /resume snapshot path refused/.test(String(j.reason_detail))")"
  [[ "$got" == "snapshot:snapshot_failed:true" ]] && ok "$1 → refused before dispatch" || bad "$1: want snapshot:snapshot_failed:true, got $got — $(printf '%s' "$G_ERR" | tail -n 1)"
  never_ran8 "$1"
}

caseRR() {
  rr10
  [[ "$RR_REPO" == "$HOME/.a1-xprov/snapshots/snap-"* || "$RR_REPO" == *"/.a1-xprov/snapshots/snap-"* ]] && ok "RR setup: round 1 recorded its snapshot path" || bad "RR setup: record.repo = $RR_REPO"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2
  assert_json "RR3 round 2 resumed and ran (REVISE again → round_cap, not runner_failed)" "$G_OUT" "j.step + ':' + j.reason" "normalize:round_cap"
  assert_json "RR3 round 2 ran on the round-1 snapshot path" "$(cat "$ARGV8_FILE" 2>/dev/null || echo '[]')" \
    "require('fs').realpathSync(require('path').dirname(j[j.indexOf('--repo') + 1])) + '/' + require('path').basename(j[j.indexOf('--repo') + 1]) === require('fs').realpathSync(require('path').dirname('$RR_REPO')) + '/' + require('path').basename('$RR_REPO')" "true"
  [[ ! -e "$RR_REPO" && ! -e "$RR_REPO.inputs" ]] && ok "RR3 the rebuilt snapshot and its inputs are removed after round 2" || bad "RR3 leftovers at $RR_REPO"

  rr10; rr_set_repo "$TMP10/snap-OutSid"   # a valid snap-XXXXXX name, outside the snapshots dir
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; refused10 "RR1 a record path outside the snapshots dir"

  rr10; local other="$TMP10/elsewhere"; mkdir -p "$other"
  local link; link="$(dirname "$RR_REPO")/snap-LnkAbc"; ln -s "$other" "$link"; rr_set_repo "$link"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; refused10 "RR2 a record path that is a symlink"
  rm -f "$link"

  rr10; mkdir -p "$RR_REPO"; printf 'planted\n' > "$RR_REPO/x.txt"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; refused10 "RR4 a record path that exists and is not empty"
  [[ -f "$RR_REPO/x.txt" ]] && ok "RR4 the existing dir is left untouched" || bad "RR4 the existing dir was modified"

  rr10; node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.plan="/tmp/other/PLAN.md";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$RR_PREV"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; refused10 "RR5 a record plan that is not the snapshot's input copy"
}

# ri10 — direct-run setup: phase repo with permit and home, snapshot with the
# PLAN.md and feedback copies. Sets PHASE_*, RI_SNAP, RI_DISP.
ri10() {
  make_tree; make_phase pri "$CASES/approved.PLAN.md"
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --by fixture --record record/2026-09-24-fixture.md >/dev/null 2>&1 )
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json" 2>/dev/null; export A1_XPROV_CODEX_HOME="$XHOME"
  RI_DISP="$TMP10/ri-dispositions.md"; printf -- '- F1: accepted\n' > "$RI_DISP"
  local out; out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --plan "$PHASE_PLAN" --feedback "$RI_DISP" 2>/dev/null)"
  RI_SNAP="$(json_get "$out" "j.snapshot || ''")"
}
# ri_run <plan> [feedback] — `xprov run --mode review` on RI_SNAP. Sets RI_OUT, RI_ARGV.
ri_run() {
  RI_ARGV="$TMP10/ri-argv-$RANDOM.json"
  FAKE_RUNNER_ARGV_FILE="$RI_ARGV" FAKE_RUNNER_CASE=approved fake_runner_env
  # --feedback needs --resume (usage rule); the input check refuses before the resume is ever read
  local fb=(); [[ -n "${2:-}" ]] && fb=(--resume "$RI_DISP" --feedback "$2")
  RI_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode review --snapshot "$RI_SNAP" --plan "$1" ${fb[@]+"${fb[@]}"} --phase pri --gate "$GATE_PLAN" --timeout 7 2>/dev/null)"
}
ri_refused() { # <name> <detail-regex>
  local got; got="$(json_get "$RI_OUT" "j.reason + ':' + new RegExp('$2').test(String(j.reason_detail))")"
  [[ "$got" == "snapshot_failed:true" ]] && ok "$1 → refused" || bad "$1: want snapshot_failed:true, got $got"
  [[ ! -f "$RI_ARGV" ]] && ok "$1: runner never invoked" || bad "$1: runner WAS invoked"
}

caseRI() {
  ri10
  [[ -n "$RI_SNAP" && -f "$RI_SNAP.inputs/PLAN.md" ]] || { bad "RI setup: snapshot with copies failed"; return; }
  ri_run "$RI_SNAP.inputs/PLAN.md"
  assert_json "RI setup: the scanned copy runs" "$RI_OUT" "String(j.ok)" "true"
  ri_run "$PHASE_PLAN"; ri_refused "RI1 a foreign --plan (the working-tree PLAN.md)" "plan must be the snapshot"
  printf 'appended after the scan\n' >> "$RI_SNAP.inputs/PLAN.md"
  ri_run "$RI_SNAP.inputs/PLAN.md"; ri_refused "RI2 the PLAN.md copy changed after the snapshot" "changed after the snapshot"
  ri10
  ri_run "$RI_SNAP.inputs/PLAN.md" "$RI_DISP"; ri_refused "RI3 --feedback outside <snapshot>.inputs" "feedback must be the snapshot"
}

# pname10 — a secret-shaped file NAME, assembled at runtime (no source line matches).
pname10() { printf 'ghp_%s.txt' "$(head -c 36 /dev/zero | tr '\0' 'P')"; }
noecho10() { # <name> <secret-name>
  local where=""
  printf '%s%s' "$G_OUT" "$G_ERR" | grep -qF -- "$2" && where="$where stdout/stderr"
  grep -qrF -- "$2" "$P8DIR/PLAN-REVIEW-LOG.md" "$P8DIR/XREVIEW.md" 2>/dev/null && where="$where phase-files"
  [[ -z "$where" ]] && ok "$1: the name is echoed nowhere" || bad "$1: the secret-shaped name leaked into$where"
}
pathfail10() { # <name> <secret-name>
  local got; got="$(json_get "$G_OUT" "j.step + ':' + j.reason + ':' + j.reason_detail")"
  [[ "$G_RC" -eq 1 && "$got" == "snapshot:secret_in_snapshot:path_name" ]] && ok "$1 → secret_in_snapshot (path name)" || bad "$1: want snapshot:secret_in_snapshot:path_name, got $got (exit $G_RC)"
  never_ran8 "$1"; noecho10 "$1" "$2"
}

caseP() {
  local nm; nm="$(pname10)"
  new8; : > "$R8/$nm"; c8 "tracked empty secret-named file"
  gate8 --gate "$GATE_PLAN"; pathfail10 "P1 a tracked secret-shaped name in a plan review" "$nm"
  new8; feat10; : > "$R8/$nm"; c8 "add empty secret-named file"
  inspect10; pathfail10 "P1b an added, empty file with a secret-shaped name" "$nm"
  new8; : > "$R8/$nm"; c8 "secret-named file at base"; feat10
  git -C "$R8" rm -q -- "$nm"; c8 "delete it"
  inspect10; pathfail10 "P2 a deleted, empty file with a secret-shaped name" "$nm"
  new8; printf 'stable content\n' > "$R8/$nm"; c8 "secret-named file at base"; feat10
  git -C "$R8" mv -- "$nm" benign.txt; c8 "rename to a benign name"
  inspect10; pathfail10 "P3 a secret-shaped name renamed to a benign one" "$nm"
  new8; feat10; : > "$R8/benign-empty.txt"; c8 "add a benign empty file"
  inspect10; pass8 "P0 control: a benign added name passes"
  new8; : > "$R8/$nm"; c8 "tracked empty secret-named file"
  local so; so="$(cd "$R8" && node "$TREE_TOOLS" xprov snapshot --repo "$R8" --commit HEAD 2>"$TMP10/p4-err.txt")"
  assert_json "P4 snapshot CLI → secret_in_snapshot (path name)" "$so" "j.reason + ':' + j.reason_detail" "secret_in_snapshot:path_name"
  if printf '%s' "$so" | grep -qF -- "$nm" || grep -qF -- "$nm" "$TMP10/p4-err.txt"; then bad "P4 the snapshot CLI echoed the secret-shaped name"
  else ok "P4 the snapshot CLI echoes the name nowhere (stdout, stderr)"; fi
}

caseO1; caseO2; caseO3; caseO4; caseO5; caseO6; caseO7; caseO8; caseO9; caseO10O11; caseO12; caseRR; caseRI; caseP
unset A1_XPROV_CODEX_HOME
export HOME="$SAVED_HOME_10"
rm -rf "$TMP10"
fi
