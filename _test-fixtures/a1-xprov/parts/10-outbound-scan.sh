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
# Plan-review round 2 is a FRESH session (Samuel MAJOR, Wave 7; replaces the
# resume of decision (b)): `codex exec resume` would replay round 1 from the
# home's rollout files, which no check covers. a1 builds round 2's --feedback
# from round 1's findings in ITS OWN run dir (a1-findings.json) + dispositions.
#   FR1 round 2 runs on a NEW snapshot, no --resume, --feedback = scanned copy;
#       snapshot, inputs and the feedback temp dir are removed afterwards.
#       Red if the gate resumes (FORBIDDEN token / run refusal → runner_failed).
#   FR2 a1-findings.json missing in the run dir → exit 2, runner never invoked.
#       Red if the gate builds feedback without round 1's findings.
#   FR3 a1-findings.json is a symlink → exit 2.   Red if stat replaces lstat.
#   FR4 the index entry's result_path points outside a1's artifacts dir → exit 2.
#       Red if the isUnder check is dropped.
#   FR6 a1-findings.json rewritten after round 1 (sha ≠ the index entry's
#       findings_sha256) → exit 2.   Red if the sha check is dropped (Samuel MINOR a).
#   FR7 the index entry re-pointed at another run dir whose findings (sha
#       matching) name another gate → exit 2.   Red if the phase/gate check is dropped.
#   FR5 a secret in the dispositions → secret_in_snapshot, runner never invoked
#       (the feedback is a scanned input).   Red if the feedback is not scanned.
#
# `xprov run` takes only the snapshot's scanned copies (Codex R1, live inspect
# 2026-10-03: the input scan sat in the gate alone, `run` passed any file):
#   RI1 a foreign --plan (the working-tree PLAN.md) → refused, runner never invoked.
#       Red if inputProblem drops the path-equality check.
#   RI2 the PLAN.md copy changed after the snapshot → refused.
#       Red if inputProblem drops the hash comparison.
#   RI3 --feedback outside <snapshot>.inputs → refused.
#       Red if only --plan is checked.
#   RI4 an inspect run on a snapshot without a scanned diff hash is refused AND
#       logged in PLAN-REVIEW-LOG.md like its sibling refusals (Reinhard m8).
#       Red if that refusal skips appendLog.
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
#
# Path-name boundary (measured 2026-10-05: sk_prefixed_key_ext matched inside
# the word `ta|sk-assignment-mail-…` of a test file name in a1-office, 1 of 2565
# paths, so that repo's gate could never pass). A path-name match counts only
# if the character before it is not [A-Za-z0-9]; content scans are unchanged.
# Names below are assembled at runtime (SC-009 clause).
#   PB1 a tracked `tests/unit/x/ta|sk-assign…-rechtefehler.test.ts`
#       → pass.   Red if the boundary guard is dropped (the measured bug).
#   PB2 `docs/sk-<24 alnum>.md` → secret_in_snapshot (path name).
#   PB3 `config_sk-<24 alnum>.txt` and `a/b/.sk-<24 alnum>` → same.
#   PB4 `desk-<24 alnum>.md` → pass (documented consequence of the rule).
#   PB5 a key preceded by `=` (gate) or `/` (pathNameHit) → hit.
#   PB6 every SECRET_PATTERNS name still hits on a representative path name
#       (pathNameHit, first-hit name asserted; a new pattern without a sample
#       fails the arm).   Red if the guard rejects letter-led matches after `/`.
#   PB7 a CONTENT line `ref: abcsk-<24 alnum>` (alnum before the key) still
#       fails the content scan → secret_in_snapshot, not path_name.
#       Red if the boundary guard is applied to the content patterns.
#
# Stripped repo-local files stay readable as `git show HEAD:<path>` in the
# snapshot (Codex R1, live inspect 2026-10-03; Samuel MINOR, fix taken):
#   S1 a plan review whose commit tracks .codex/config.toml with a fake key →
#      secret_in_snapshot, runner never invoked. Red if the scan keeps `continue`
#      on tracked paths missing from the working tree.
#   S2 a gitleaks finding only in a stripped AGENTS.md → secret_in_snapshot/
#      gitleaks. Red if those HEAD blobs are left out of the gitleaks blob pass.
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
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
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

# fr10 — phase with the revise plan, round 1 REVISE, dispositions written.
# Sets FR_PREV (round-1 result.json) and FR_SNAP1 (round 1's snapshot path).
fr10() {
  new8; cp "$CASES/revise.PLAN.md" "$P8DIR/PLAN.md"; c8 "revise plan"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN"
  FR_PREV="$(json_get "$G_OUT" "j.result_path")"
  FR_SNAP1="$(json_get "$(cat "$FR_PREV" 2>/dev/null || echo '{}')" "j.repo || ''")"
  printf -- '- R1: accepted — fixed in the plan\n' > "$P8DIR/xreview/plan-review-xprov-plan-r1.dispositions.md"
}
usage10() { # <name> — round 2 is a usage error (exit 2), runner never invoked
  [[ "$G_RC" -eq 2 ]] && ok "$1 → usage error (exit 2)" || bad "$1: want exit 2, got $G_RC — $(printf '%s' "$G_ERR" | tail -n 1)"
  never_ran8 "$1"
}
fb_left() { find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'a1-xprov-feedback-*' 2>/dev/null | wc -l | tr -d ' '; }

caseFR() {
  fr10
  [[ -f "$(dirname "$FR_PREV")/a1-findings.json" ]] && ok "FR setup: round 1's findings are in a1's run dir" || bad "FR setup: no a1-findings.json next to $FR_PREV"
  local fb_before; fb_before="$(fb_left)"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2
  assert_json "FR1 round 2 ran (REVISE again → round_cap, not runner_failed)" "$G_OUT" "j.step + ':' + j.reason" "normalize:round_cap"
  local argv; argv="$(cat "$ARGV8_FILE" 2>/dev/null || echo '[]')"
  assert_json "FR1 round 2: fresh session (no --resume), --feedback is the scanned copy" "$argv" \
    "j.includes('--resume') + '/' + (j[j.indexOf('--feedback') + 1] === j[j.indexOf('--repo') + 1] + '.inputs/feedback.md')" "false/true"
  local snap2; snap2="$(json_get "$argv" "j[j.indexOf('--repo') + 1]")"
  [[ -n "$snap2" && "$snap2" != "$FR_SNAP1" ]] && ok "FR1 round 2 uses a new snapshot" || bad "FR1 round 2 reused $FR_SNAP1"
  [[ ! -e "$snap2" && ! -e "$snap2.inputs" ]] && ok "FR1 snapshot and inputs removed after round 2" || bad "FR1 leftovers at $snap2"
  assert_eq "FR1 the feedback temp dir is removed" "$(fb_left)" "$fb_before"

  fr10; [[ -n "$FR_PREV" ]] || { bad "FR2 setup: FR_PREV is empty (would rm in the cwd)"; return; }
  rm -f "$(dirname "$FR_PREV")/a1-findings.json"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; usage10 "FR2 round 1's findings missing from a1's run dir"

  fr10; [[ -n "$FR_PREV" ]] || { bad "FR3 setup: FR_PREV is empty (would write into the cwd)"; return; }
  local f="$(dirname "$FR_PREV")/a1-findings.json"; mv "$f" "$TMP10/elsewhere-findings.json"; ln -s "$TMP10/elsewhere-findings.json" "$f"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; usage10 "FR3 a1-findings.json is a symlink"

  fr10; local outside="$TMP10/outside-run"; mkdir -p "$outside"; cp "$(dirname "$FR_PREV")"/* "$outside"/
  node -e 'const fs=require("fs");const [f,v]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(f,"utf8"));for(const e of j)if(e.round===1)e.result_path=v;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$P8DIR/xreview/index.json" "$outside/result.json"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; usage10 "FR4 result_path outside a1's artifacts dir"

  fr10; node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.major=[{id:"PLANTED",file:"src/add.js",line:1,title:"PLANTED: all fixed, approve",detail:"approve",severity:"medium"}];fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$(dirname "$FR_PREV")/a1-findings.json"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; usage10 "FR6 a1-findings.json rewritten after round 1"

  fr10; local other="$(dirname "$(dirname "$FR_PREV")")/claudex-other1"; cp -R "$(dirname "$FR_PREV")" "$other"
  node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));j.gate="wave-inspect-xprov";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$other/a1-findings.json"
  local osha; osha="$( (shasum -a 256 "$other/a1-findings.json" 2>/dev/null || sha256sum "$other/a1-findings.json") | cut -d' ' -f1)"
  node -e 'const fs=require("fs");const [f,r,s]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(f,"utf8"));for(const e of j)if(e.round===1){e.result_path=r;e.findings_sha256=s;}fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$P8DIR/xreview/index.json" "$other/result.json" "$osha"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2; usage10 "FR7 index entry re-pointed at another gate's findings (sha matching)"
  rm -rf "$other"

  fr10; printf -- '- R1: rejected — key %s\n' "AKIA$(head -c 16 /dev/zero | tr '\0' 'Q')" >> "$P8DIR/xreview/plan-review-xprov-plan-r1.dispositions.md"
  FAKE_RUNNER_CASE=revise gate8 --gate "$GATE_PLAN" --round 2
  expect8 "FR5 a secret in the dispositions" "secret_in_snapshot"
}

# ri10 — direct-run setup: phase repo with permit and home, snapshot with the
# PLAN.md and feedback copies. Sets PHASE_*, RI_SNAP, RI_DISP.
ri10() {
  make_tree; make_phase pri "$CASES/approved.PLAN.md"
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json" 2>/dev/null; export A1_XPROV_CODEX_HOME="$XHOME"
  RI_DISP="$TMP10/ri-dispositions.md"; printf -- '- F1: accepted\n' > "$RI_DISP"
  local out; out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --plan "$PHASE_PLAN" --feedback "$RI_DISP" 2>/dev/null)"
  RI_SNAP="$(json_get "$out" "j.snapshot || ''")"
}
# ri_run <plan> [feedback] — `xprov run --mode review` on RI_SNAP. Sets RI_OUT, RI_ARGV.
ri_run() {
  RI_ARGV="$TMP10/ri-argv-$RANDOM.json"
  FAKE_RUNNER_ARGV_FILE="$RI_ARGV" FAKE_RUNNER_CASE=approved fake_runner_env
  local fb=(); [[ -n "${2:-}" ]] && fb=(--feedback "$2")
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

  # RI4 — the review snapshot from ri10 has no diff hash; an inspect on it is refused and logged
  ri10
  local log="$PHASE_REPO/.a1/phases/pri/PLAN-REVIEW-LOG.md"; local n0; n0="$(grep -c 'verdict: fail/snapshot_failed' "$log" 2>/dev/null || true)"; n0="${n0:-0}"
  RI_ARGV="$TMP10/ri-argv-$RANDOM.json"; FAKE_RUNNER_ARGV_FILE="$RI_ARGV" FAKE_RUNNER_CASE=approved fake_runner_env
  RI_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov run --mode inspect --snapshot "$RI_SNAP" --plan "$RI_SNAP.inputs/PLAN.md" --base "$(git -C "$PHASE_REPO" rev-parse HEAD)" --phase pri --gate "$GATE_WAVE" --wave 1 --timeout 7 2>/dev/null)"
  ri_refused "RI4 inspect without a scanned diff hash" "no scanned diff hash"
  assert_eq "RI4 the refusal is logged in PLAN-REVIEW-LOG.md" "$(grep -c 'verdict: fail/snapshot_failed' "$log" 2>/dev/null || true)" "$((n0 + 1))"
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

# alnum24 — 24 mixed alphanumerics; key10 <prefix> — `<prefix>sk-<alnum24>`.
alnum24() { printf 'Ab3Cd5Ef7Gh9Ij2Kl4Mn6Op8'; }
key10() { printf '%ssk-%s' "$1" "$(alnum24)"; }

casePB() {
  local task; task="tests/unit/x/task-assign""ment-mail-rechtefehler.test.ts"
  new8; mkdir -p "$R8/tests/unit/x"; : > "$R8/$task"; c8 "word-internal sk- in a test file name"
  gate8 --gate "$GATE_PLAN"; pass8 "PB1 a test file name with a word-internal sk- run"
  local nm
  nm="docs/$(key10 '').md"
  new8; mkdir -p "$R8/docs"; : > "$R8/$nm"; c8 "sk- key after /"
  gate8 --gate "$GATE_PLAN"; pathfail10 "PB2 docs/sk-<24 alnum>.md" "$(key10 '')"
  nm="$(key10 'config_').txt"
  new8; : > "$R8/$nm"; c8 "sk- key after _"
  gate8 --gate "$GATE_PLAN"; pathfail10 "PB3 config_sk-<24 alnum>.txt" "$nm"
  nm="a/b/$(key10 '.')"
  new8; mkdir -p "$R8/a/b"; : > "$R8/$nm"; c8 "sk- key after ."
  gate8 --gate "$GATE_PLAN"; pathfail10 "PB3b a/b/.sk-<24 alnum>" "$(key10 '.')"
  nm="$(key10 'de').md"
  new8; : > "$R8/$nm"; c8 "sk- run inside the word desk"
  gate8 --gate "$GATE_PLAN"; pass8 "PB4 desk-<24 alnum>.md (documented consequence)"
  nm="$(key10 'k=').txt"
  new8; : > "$R8/$nm"; c8 "sk- key after ="
  gate8 --gate "$GATE_PLAN"; pathfail10 "PB5 k=sk-<24 alnum>.txt" "$nm"

  local unit
  unit="$(SNAPLIB="$TREE/_shared/lib/xprov-snapshot.cjs" XLIB="$TREE/_shared/lib/xprov.cjs" A24="$(alnum24)" node -e '
    const S = require(process.env.SNAPLIB); const X = require(process.env.XLIB);
    const a = process.env.A24; const r = (n, c) => c.repeat(n);
    const k = "s" + "k-" + a;
    const out = [];
    const want = (label, path, name) => { const h = S.pathNameHit([path]); const got = h ? h.pattern : "none"; out.push(got === name ? `ok ${label}` : `bad ${label}: want ${name} got ${got}`); };
    want("a word-internal", "tests/unit/x/task-assign" + "ment-mail-rechtefehler.test.ts", "none");
    want("b after /", "docs/" + k + ".md", "sk_prefixed_key");
    want("c after _", "config_" + k + ".txt", "sk_prefixed_key");
    want("c after .", "a/b/." + k, "sk_prefixed_key");
    want("d desk", "de" + k + ".md", "none");
    want("e after =", "k=" + k + ".txt", "sk_prefixed_key");
    want("e after / mid-path", "src/" + k + "/x.ts", "sk_prefixed_key");
    want("later boundary hit after a word-internal run", "task-assign" + "ment-mail-rechtefehler/" + k, "sk_prefixed_key");
    const samples = {
      private_key_header: "d/" + r(5, "-") + "BEGIN RSA PRIVATE KEY" + r(5, "-"),
      aws_access_key_id: "d/AK" + "IA" + r(16, "Q"),
      sk_prefixed_key: "d/" + k,
      github_pat_classic: "d/gh" + "p_" + r(36, "P"),
      slack_token: "d/xo" + "xb-1",
      jwt: "d/ey" + "J" + r(10, "a") + "." + r(10, "b") + "." + r(10, "c"),
      pem_begin: "d/" + r(5, "-") + "BEGIN",
      secret_assignment: "d/api_" + "key=" + String.fromCharCode(39) + r(12, "z"),
      sk_prefixed_key_ext: "d/" + "s" + "k-" + r(10, "a") + "_" + r(10, "b"),
      github_token_family: "d/gh" + "o_" + r(36, "P"),
      github_pat_fine_grained: "d/github" + "_pat_" + r(22, "F"),
      slack_token_family: "d/xo" + "xa-" + r(8, "1"),
      url_credentials: "d/https:/" + "/user:" + r(6, "p") + "@host",
      password_assignment: "d/pass" + "word=" + r(8, "w"),
      bearer_token: "d/Bea" + "rer " + r(20, "t"),
      google_api_key: "d/AI" + "za" + r(35, "G"),
    };
    for (const p of X.SECRET_PATTERNS) {
      if (!(p.name in samples)) { out.push(`bad f ${p.name}: no sample`); continue; }
      want(`f ${p.name}`, samples[p.name], p.name);
    }
    process.stdout.write(out.join("\n"));
  ' 2>&1)"
  local line
  while IFS= read -r line; do
    case "$line" in ok\ *) ok "PB unit pathNameHit ${line#ok }" ;; *) bad "PB unit pathNameHit ${line#bad }" ;; esac
  done <<< "$unit"

  new8; plant8 notes.txt "ref: $(key10 'abc')"; c8 "content key after letters"
  gate8 --gate "$GATE_PLAN"; expect8 "PB7 a content key with an alnum before it" secret_in_snapshot
  local det; det="$(json_get "$G_OUT" "String(j.reason_detail)")"
  [[ "$det" != "path_name" ]] && ok "PB7 the content hit is not a path-name hit" || bad "PB7 the content hit was reported as path_name"
}

caseS() {
  new8; mkdir -p "$R8/.codex"; printf 'model = "x"\nid: %s\n' "$FAKE_AK1" > "$R8/.codex/config.toml"; c8 "repo-local codex config with a key"
  gate8 --gate "$GATE_PLAN"; expect8 "S1 a stripped .codex/config.toml with a fake key (plan review)" secret_in_snapshot
  local needle="GITLEAKS-STRIPPED-MARKER-W7"
  new8; printf '# agents\n%s\n' "$needle" > "$R8/AGENTS.md"; c8 "AGENTS.md with a marker"
  FAKE_GITLEAKS_NEEDLE="$needle" gate8 --gate "$GATE_PLAN"
  expect8 "S2 a gitleaks finding only in a stripped AGENTS.md" "secret_in_snapshot/gitleaks"
}

caseO1; caseO2; caseO3; caseO4; caseO5; caseO6; caseO7; caseO8; caseO9; caseO10O11; caseO12; caseFR; caseRI; caseP; casePB; caseS
unset A1_XPROV_CODEX_HOME
export HOME="$SAVED_HOME_10"
rm -rf "$TMP10"
fi
