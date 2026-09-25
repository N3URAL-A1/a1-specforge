#!/usr/bin/env bash
# Part 06 — Wave 6: the gate driver (`xprov gate`), `load-check`, `wave-status`,
# `waive`. Sourced by run-tests.sh. Cases R2, R3, R4, R6, R7 from the wave
# plan's Wave 6 fixture table; every case names the single production change
# that turns it red. RED phase (2026-09-24, before xprov-gate.cjs existed):
# every arm failed with the facade's `xprov <sub>: not implemented yet
# (planned wave 6)` on exit 2.
#
# The runner is the fake from make_tree (records argv, copies a case). Real
# Codex is never reached: A1_XPROV_CODEX_HOME points at a throwaway compliant
# home, HOME at a throwaway dir holding .codex/auth.json for the auth symlink.
# The driver reads `enforcement` from the TREE copy's gates-registry.md — one
# arm flips a cell there to prove the value is read, not hardcoded.

TMP06="$(mktemp -d)"
SAVED_HOME_06="$HOME"
export HOME="$TMP06/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
ARGV6_DIR="$TMP06/argv"; mkdir -p "$ARGV6_DIR"; ARGV6_N=0
SNAPS6="$HOME/.a1-xprov/snapshots"

# prep6 [plan] — fresh tree, phase repo p6, permit record, compliant home with
# auth symlink. Sets TREE*, PHASE_*, XHOME, exports A1_XPROV_CODEX_HOME.
prep6() {
  make_tree; make_phase p6 "${1:-$CASES/approved.PLAN.md}"
  ( cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --by fixture --record record/2026-09-24-fixture.md >/dev/null 2>&1 ) || echo "WARN prep6: permit failed" >&2
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
}

# gate6 [flags…] — `xprov gate --phase p6 …` from inside $PHASE_REPO with a
# fresh argv file. Sets G_OUT, G_ERR, G_RC, ARGV6_FILE.
gate6() {
  ARGV6_N=$((ARGV6_N + 1)); ARGV6_FILE="$ARGV6_DIR/argv-$ARGV6_N.json"
  # `xprov run` hands the runner an allowlisted environment (Samuel W5 MAJOR 2),
  # so the fake's knobs travel via <TREE_VENDOR>/fake-runner.env.json: every
  # FAKE_RUNNER_* variable visible here (incl. a caller's `FAKE_RUNNER_CASE=…
  # gate6` / `FAKE_RUNNER_REFUSE=1 gate6` prefix) is written right before the call.
  FAKE_RUNNER_ARGV_FILE="$ARGV6_FILE" FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p6 --timeout 7 "$@" 2>"$TMP06/gate-err.txt")"; G_RC=$?
  G_ERR="$(cat "$TMP06/gate-err.txt")"
}

# sub6 <sub> [flags…] — any other xprov subcommand from inside $PHASE_REPO. Sets G_OUT, G_ERR, G_RC.
sub6() {
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP06/sub-err.txt")"; G_RC=$?
  G_ERR="$(cat "$TMP06/sub-err.txt")"
}

snapshots_left() { ls -d "$SNAPS6"/snap-* 2>/dev/null | wc -l | tr -d ' '; }

# ---------- R2: the driver stops at the first non-zero step; approved → pass; Phase 4b wired ----------
# Red-making change: removing the early return after `preflight` (the driver
# would snapshot and call the runner although the home is not compliant).
caseR2() {
  prep6
  printf '\n[mcp_servers.x]\nenabled = false\n' >> "$XHOME/config.toml"
  gate6 --gate "$GATE_PLAN"
  assert_rc "R2a gate exits 1 on a non-compliant home" 1 "$G_RC" "$G_ERR"
  assert_json "R2a stdout names step preflight, reason preflight_failed, verdict fail" "$G_OUT" "[j.step, j.reason, j.verdict].join('/')" "preflight/preflight_failed/fail"
  assert_eq "R2a no snapshot was created" "$(snapshots_left)" "0"
  [[ ! -f "$ARGV6_FILE" ]] && ok "R2a the runner was never called (no argv file)" || bad "R2a runner argv file exists — runner called after a failing preflight"
  local log="$PHASE_DIR/PLAN-REVIEW-LOG.md"
  [[ -f "$log" ]] && grep -q "step: preflight" "$log" && grep -q "reason: preflight_failed" "$log" \
    && ok "R2a PLAN-REVIEW-LOG.md names the failing step and reason" || bad "R2a log entry missing step/reason"

  # missing permit record → stops at permit-check, before preflight and snapshot;
  # a repository without permission gets NO a1 write (no log, no xreview/) —
  # Reinhard PR-review MAJOR 1. Red-making change: logging the permit-check fail.
  prep6; rm -f "$PHASE_REPO/.a1/xprov.json"
  gate6 --gate "$GATE_PLAN"
  assert_rc "R2b gate exits 1 without .a1/xprov.json" 1 "$G_RC"
  assert_json "R2b step permit-check, reason external_review_not_permitted" "$G_OUT" "[j.step, j.reason].join('/')" "permit-check/external_review_not_permitted"
  assert_eq "R2b still no snapshot" "$(snapshots_left)" "0"
  [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" ]] && ok "R2b no PLAN-REVIEW-LOG.md and no xreview/ in an unpermitted repo" || bad "R2b a1 wrote into an unpermitted repo: $(ls "$PHASE_DIR")"
  # usage error out of preflight (hostile A1_XPROV_CODEX_HOME) → exit 2, nothing written.
  # Red-making change: logging in the finally block whether or not a step produced a result.
  prep6
  A1_XPROV_CODEX_HOME=".codex-a1-review" gate6 --gate "$GATE_PLAN"
  assert_rc "R2g a relative A1_XPROV_CODEX_HOME is a usage error" 2 "$G_RC"
  [[ ! -e "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ! -e "$PHASE_DIR/xreview" && "$(snapshots_left)" == "0" ]] && ok "R2g exit 2 wrote nothing (no log, no xreview/, no snapshot)" || bad "R2g exit 2 left writes behind: $(ls "$PHASE_DIR")"

  # everything compliant, approved case → pass, all Diana keys present, log + index + observation written
  prep6
  gate6 --gate "$GATE_PLAN"
  assert_rc "R2c gate exits 0 on the approved case" 0 "$G_RC" "$G_ERR"
  assert_json "R2c verdict pass, reason null, step normalize, enforcement warning (registry row)" "$G_OUT" "[j.verdict, String(j.reason), j.step, j.enforcement].join('/')" "pass/null/normalize/warning"
  assert_json "R2c stdout carries every key the skills read" "$G_OUT" "['verdict','enforcement','reason','findings_path','xreview_path','result_path','next'].every((k) => k in j)" "true"
  assert_json "R2c next is null on pass" "$G_OUT" "String(j.next)" "null"
  local fp xp rp; fp="$(json_get "$G_OUT" "j.findings_path")"; xp="$(json_get "$G_OUT" "j.xreview_path")"; rp="$(json_get "$G_OUT" "j.result_path")"
  [[ -f "$fp" && -f "$xp" && -f "$rp" ]] && ok "R2c findings, XREVIEW.md and result.json exist" || bad "R2c paths missing: $fp / $xp / $rp"
  log="$PHASE_DIR/PLAN-REVIEW-LOG.md"
  grep -q "verdict: pass" "$log" && grep -q "xreview: " "$log" && grep -q "result: " "$log" \
    && ok "R2c PLAN-REVIEW-LOG.md carries verdict, XREVIEW path and result path" || bad "R2c log lacks verdict/xreview/result"
  assert_json "R2c index.json holds one plan-review-xprov pass entry, round 1" "$(cat "$PHASE_DIR/xreview/index.json")" "j.length + '/' + j[0].gate + '/' + j[0].verdict + '/' + j[0].round" "1/$GATE_PLAN/pass/1"
  assert_json "R2c one observation: agent xprov-codex, type gap, pattern xprov_finding, skill a1-plan" "$(tail -n 1 "$PHASE_DIR/observations.jsonl")" "[j.agent, j.type, j.pattern, j.skill, String(j.wave)].join('/')" "xprov-codex/gap/xprov_finding/a1-plan/null"
  assert_eq "R2c exactly one observation line" "$(wc -l < "$PHASE_DIR/observations.jsonl" | tr -d ' ')" "1"
  assert_eq "R2c the snapshot was removed after normalize" "$(snapshots_left)" "0"
  assert_json "R2c runner argv is a review call on the snapshot, no --resume" "$(cat "$ARGV6_FILE")" "j[1] + '/' + j.includes('--resume') + '/' + j.includes('--plan') + '/' + (j[j.indexOf('--repo') + 1] || '').startsWith('$SNAPS6/snap-')" "review/false/true/true"

  # enforcement is READ from the registry row, never hardcoded: flip the TREE copy's cell
  sed -i.bak "s/^| \`$GATE_WAVE\` \(.*\)| warning |/| \`$GATE_WAVE\` \1| blocking |/" "$TREE/_shared/gates-registry.md" && rm -f "$TREE/_shared/gates-registry.md.bak"
  grep -q "^| \`$GATE_WAVE\` .*| blocking |" "$TREE/_shared/gates-registry.md" || bad "R2d fixture could not flip the registry cell"
  gate6 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  assert_json "R2d enforcement echoes the flipped registry cell (blocking) for the wave gate" "$G_OUT" "j.enforcement" "blocking"

  # Phase 4b wiring (Diana): page exists, linked from 04-audit PASS branch and the SKILL.md table
  [[ -f "$REPO_ROOT/skills/a1-plan/workflows/04b-xprov-review.md" ]] && ok "R2e 04b-xprov-review.md exists" || bad "R2e 04b-xprov-review.md missing"
  grep -q "04b-xprov-review.md" "$REPO_ROOT/skills/a1-plan/workflows/04-audit.md" && ok "R2e 04-audit.md links 04b" || bad "R2e 04-audit.md does not link 04b"
  grep -q "^| 4b |" "$REPO_ROOT/skills/a1-plan/SKILL.md" && ok "R2e a1-plan SKILL.md phase table has row 4b" || bad "R2e SKILL.md lacks row 4b"
  grep -q "xprov gate --phase <phase_name> --gate plan-review-xprov" "$REPO_ROOT/skills/a1-plan/workflows/04b-xprov-review.md" && ok "R2e 04b calls xprov gate" || bad "R2e 04b lacks the gate call"

  # usage errors: unknown gate id, wave gate without --wave/--base, plan gate with --wave
  gate6 --gate xprov-review; assert_rc "R2f unregistered gate id is a usage error" 2 "$G_RC"
  gate6 --gate "$GATE_WAVE"; assert_rc "R2f wave gate without --wave/--base is a usage error" 2 "$G_RC"
  gate6 --gate "$GATE_PLAN" --wave 1; assert_rc "R2f plan gate with --wave is a usage error" 2 "$G_RC"
  assert_eq "R2f usage errors create no snapshot" "$(snapshots_left)" "0"
}

# ---------- R3: load-check compares the current PLAN.md sha with the newest pass entry ----------
# Red-making change: comparing on `gate` only and ignoring `plan_sha256`.
caseR3() {
  prep6
  sub6 load-check --phase p6
  assert_rc "R3a load-check exits 1 without any review" 1 "$G_RC"
  assert_json "R3a reason plan_review_missing, enforcement echoed" "$G_OUT" "[j.reason, j.enforcement].join('/')" "plan_review_missing/warning"
  gate6 --gate "$GATE_PLAN"
  assert_rc "R3b a passing review first" 0 "$G_RC" "$G_ERR"
  sub6 load-check --phase p6
  assert_rc "R3b load-check exits 0 with a matching pass entry" 0 "$G_RC" "$G_ERR"
  assert_json "R3b stdout names the matched sha and entry" "$G_OUT" "j.ok === true && typeof j.plan_sha256 === 'string' && j.matched_entry.gate" "$GATE_PLAN"
  printf '\n<!-- touched after the review -->\n' >> "$PHASE_PLAN"
  sub6 load-check --phase p6
  assert_rc "R3c PLAN.md edited after the pass → exit 1" 1 "$G_RC"
  assert_json "R3c reason plan_review_missing (stale plan_sha256 on the only pass entry)" "$G_OUT" "j.reason" "plan_review_missing"
  # a later FAIL entry must not shadow the newest PASS (newest pass wins, but only if its sha matches)
  git -C "$PHASE_REPO" checkout -q -- .a1/phases/p6/PLAN.md
  sub6 load-check --phase p6
  assert_rc "R3d restored PLAN.md → exit 0 again" 0 "$G_RC" "$G_ERR"
  grep -q "xprov load-check --phase <phase_name>" "$REPO_ROOT/skills/a1-execute/workflows/01-load.md" && ok "R3e 01-load.md calls load-check" || bad "R3e 01-load.md lacks the load-check call"
  sub6 load-check --phase ../p6; assert_rc "R3f hostile --phase is refused" 2 "$G_RC"
}

# ---------- R4: wave-status requires a pass or waiver for EVERY completed wave ----------
# Red-making change: checking only the last completed wave.
caseR4() {
  prep6
  mkdir -p "$PHASE_DIR/xreview"
  cat > "$PHASE_DIR/STATUS.md" <<'EOF'
# STATUS

## Wave 1 — scaffold
Completed: 2026-09-24

## Wave 2 — storage
Completed: 2026-09-24

## Wave 3 — api
Completed: 2026-09-24
EOF
  cat > "$PHASE_DIR/xreview/index.json" <<EOF
[
  {"gate":"$GATE_PLAN","wave":null,"lane":null,"round":1,"verdict":"pass","reason":null,"plan_sha256":"x","result_path":"/x","ts":"2026-09-24T10:00:00.000Z"},
  {"gate":"$GATE_WAVE","wave":1,"lane":null,"round":1,"verdict":"pass","reason":null,"plan_sha256":"x","result_path":"/x","ts":"2026-09-24T11:00:00.000Z"},
  {"gate":"$GATE_WAVE","wave":2,"lane":null,"round":1,"verdict":"fail-with-findings","reason":null,"plan_sha256":"x","result_path":"/x","ts":"2026-09-24T12:00:00.000Z"},
  {"gate":"$GATE_WAVE","wave":3,"lane":null,"round":1,"verdict":"pass","reason":null,"plan_sha256":"x","result_path":"/x","ts":"2026-09-24T13:00:00.000Z"}
]
EOF
  sub6 wave-status --phase p6
  assert_rc "R4a waves 1–3 completed, wave 2 without pass → exit 1" 1 "$G_RC"
  assert_json "R4a stdout lists wave 2 as lacking, completed waves from STATUS.md, enforcement echoed" "$G_OUT" "[j.lacking.join(','), j.completed_waves.join(','), j.enforcement, j.reason].join('/')" "2/1,2,3/warning/wave_inspect_missing"
  sub6 wave-status --phase p6 --waves 1,3
  assert_rc "R4b --waves 1,3 overrides STATUS.md → exit 0" 0 "$G_RC" "$G_ERR"
  sub6 wave-status --phase p6 --waves 2
  assert_rc "R4c --waves 2 alone → exit 1 (the lacking wave is not the last one only)" 1 "$G_RC"
  sub6 waive --phase p6 --gate "$GATE_WAVE" --wave 2 --reason "provider down"
  assert_rc "R4d human waiver for wave 2 exits 0" 0 "$G_RC" "$G_ERR"
  sub6 wave-status --phase p6
  assert_rc "R4d wave-status exits 0 once wave 2 is waived" 0 "$G_RC" "$G_ERR"
  assert_json "R4d nothing lacking" "$G_OUT" "j.lacking.length" "0"
  grep -q "xprov gate --phase <phase_name> --gate wave-inspect-xprov --wave <N> --base \$PRE_WAVE_HEAD --work-path \$WORK_PATH" "$REPO_ROOT/skills/a1-execute/workflows/02-execute.md" && ok "R4e 02-execute.md step 2b-x calls gate with --phase, --base and --work-path" || bad "R4e 02-execute.md lacks the 2b-x call"
  grep -q "xprov gate --phase <phase_name> --gate wave-inspect-xprov .*--lane <lane-id>" "$REPO_ROOT/skills/a1-execute/workflows/02-execute.md" && ok "R4e 02-execute.md has the multi-lane form with --lane" || bad "R4e 02-execute.md lacks the --lane form"
  grep -q "^### 2b-x" "$REPO_ROOT/skills/a1-execute/workflows/02-execute.md" && ok "R4e 02-execute.md has step 2b-x" || bad "R4e no 2b-x heading"
  grep -q "xprov wave-status --phase <phase_name>" "$REPO_ROOT/skills/a1-execute/workflows/03-verify.md" && ok "R4e 03-verify.md calls wave-status" || bad "R4e 03-verify.md lacks wave-status"
  rm "$PHASE_DIR/STATUS.md"
  sub6 wave-status --phase p6
  assert_rc "R4f no STATUS*.md and no --waves → usage error (nothing to check is not a pass)" 2 "$G_RC"
}

# ---------- R6: rounds are bounded — REVISE at round 2 is round_cap, round 1 shows the resume command ----------
# Red-making change: removing the cap comparison (round 3 would call the runner).
caseR6() {
  prep6 "$CASES/revise.PLAN.md"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_PLAN"
  assert_rc "R6a REVISE at round 1 exits 1" 1 "$G_RC" "$G_ERR"
  assert_json "R6a verdict fail-with-findings, round 1, findings_path set" "$G_OUT" "[j.verdict, j.round, typeof j.findings_path].join('/')" "fail-with-findings/1/string"
  assert_json "R6a next.resume_cmd carries --round 2, --resume <result.json> and --feedback <dispositions>" "$G_OUT" \
    "[j.next.resume_cmd.includes('--round 2'), j.next.resume_cmd.includes('--resume ' + j.result_path), j.next.resume_cmd.includes('--feedback ' + j.next.dispositions_path)].join('/')" "true/true/true"
  assert_json "R6a the argv of round 1 has no --resume" "$(cat "$ARGV6_FILE")" "j.includes('--resume')" "false"
  assert_json "R6a observation type blocker on fail" "$(tail -n 1 "$PHASE_DIR/observations.jsonl")" "j.type + '/' + j.severity" "blocker/major"
  local disp; disp="$(json_get "$G_OUT" "j.next.dispositions_path")"
  # round 2 without the host-authored dispositions file is a usage error, no runner call
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_PLAN" --round 2
  assert_rc "R6b round 2 without a dispositions file is a usage error" 2 "$G_RC"
  [[ ! -f "$ARGV6_FILE" ]] && ok "R6b runner not called without dispositions" || bad "R6b runner called"
  printf 'F1: accepted — will fix in wave 2\n' > "$disp"
  local prev; prev="$(json_get "$G_OUT" "j.result_path")"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_PLAN" --round 2
  assert_rc "R6c REVISE again at round 2 exits 1" 1 "$G_RC" "$G_ERR"
  assert_json "R6c reported as fail/round_cap (no round 3), next null" "$G_OUT" "[j.verdict, j.reason, j.round, String(j.next)].join('/')" "fail/round_cap/2/null"
  assert_json "R6c round 2 argv resumed the round-1 result with the dispositions file" "$(cat "$ARGV6_FILE")" \
    "j.includes('--resume') + '/' + j.includes('--feedback') + '/' + j[j.indexOf('--feedback') + 1]" "true/true/$disp"
  assert_json "R6c index.json holds two plan rounds" "$(cat "$PHASE_DIR/xreview/index.json")" "j.filter((e) => e.gate === '$GATE_PLAN').map((e) => e.round).join(',')" "1,2"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_PLAN" --round 3
  assert_rc "R6d --round 3 is round_cap before any runner call" 1 "$G_RC"
  assert_json "R6d reason round_cap, step round" "$G_OUT" "[j.reason, j.step].join('/')" "round_cap/round"
  [[ ! -f "$ARGV6_FILE" ]] && ok "R6d runner never called at round 3" || bad "R6d runner called at round 3"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_PLAN"
  assert_json "R6d the default round (1 + existing entries = 3) is round_cap too" "$G_OUT" "j.reason + '/' + j.round" "round_cap/3"
  assert_eq "R6d no snapshot left behind by the capped calls" "$(snapshots_left)" "0"

  # inspect: REVISE → next.fix_round 1, fresh session both times, second REVISE = round_cap
  prep6 "$CASES/revise.PLAN.md"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_WAVE" --wave 2 --base "$PHASE_HEAD"
  assert_rc "R6e inspect REVISE exits 1" 1 "$G_RC" "$G_ERR"
  assert_json "R6e verdict fail-with-findings, next.fix_round 1" "$G_OUT" "j.verdict + '/' + j.next.fix_round" "fail-with-findings/1"
  assert_json "R6e inspect argv: mode inspect, --base, no --resume" "$(cat "$ARGV6_FILE")" "j[1] + '/' + j.includes('--base') + '/' + j.includes('--resume')" "inspect/true/false"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_WAVE" --wave 2 --base "$PHASE_HEAD"
  assert_json "R6f second REVISE in the same wave → round_cap" "$G_OUT" "j.reason + '/' + j.round" "round_cap/2"
  assert_json "R6f re-inspection argv never carries --resume (fresh session)" "$(cat "$ARGV6_FILE")" "j.includes('--resume')" "false"
  assert_json "R6f wave 2 entries carry the wave and lane null" "$(cat "$PHASE_DIR/xreview/index.json")" "j.filter((e) => e.gate === '$GATE_WAVE').map((e) => e.wave + ':' + e.lane).join(',')" "2:null,2:null"
  FAKE_RUNNER_CASE=revise gate6 --gate "$GATE_WAVE" --wave 3 --base "$PHASE_HEAD" --lane storage
  assert_rc "R6g a lane inspection runs (exit 1 on REVISE)" 1 "$G_RC" "$G_ERR"
  assert_json "R6g stdout and observation carry the lane" "$G_OUT" "j.lane + '/' + j.wave" "storage/3"
  assert_json "R6g observation carries lane" "$(tail -n 1 "$PHASE_DIR/observations.jsonl")" "j.lane + '/' + j.wave" "storage/3"
  # normalize gained --lane on 2026-09-24 (Walter-1); the driver passes it through.
  # Red-making change: dropping `--lane` from the normalize argv.
  assert_json "R6g index entry carries the lane" "$(cat "$PHASE_DIR/xreview/index.json")" "j.filter((e) => e.wave === 3).map((e) => String(e.lane)).join(',')" "storage"
}

# ---------- R7: a waiver is a human record — never verdict: pass; skills only tell the human ----------
# Red-making change: writing `verdict: pass` in waive.
caseR7() {
  prep6
  mkdir -p "$PHASE_DIR/xreview"
  sub6 waive --phase p6 --gate "$GATE_PLAN" --reason "provider down"
  assert_rc "R7a waive (plan gate) exits 0" 0 "$G_RC" "$G_ERR"
  local idx; idx="$(cat "$PHASE_DIR/xreview/index.json")"
  assert_json "R7a entry has waived true, by human, reason, ts, gate and no verdict key" "$idx" \
    "[j[0].waived, j[0].by, j[0].reason, typeof j[0].ts, j[0].gate, 'verdict' in j[0]].join('/')" "true/human/provider down/string/$GATE_PLAN/false"
  grep -q "^## Waiver" "$PHASE_DIR/XREVIEW.md" && ok "R7a XREVIEW.md has a ## Waiver section" || bad "R7a no ## Waiver section"
  grep -q "provider down" "$PHASE_DIR/XREVIEW.md" && ok "R7a the section carries the reason" || bad "R7a reason not rendered"
  assert_json "R7a stdout reminds the retro tag xprov_waived" "$G_OUT" "j.ok === true && j.retro_issue" "xprov_waived"
  sub6 waive --phase p6 --gate "$GATE_WAVE" --wave 2 --reason "accepted risk"
  assert_rc "R7b waive (wave gate) exits 0" 0 "$G_RC" "$G_ERR"
  assert_json "R7b second entry carries wave 2 and no verdict" "$(cat "$PHASE_DIR/xreview/index.json")" "j.length + '/' + j[1].wave + '/' + ('verdict' in j[1])" "2/2/false"
  sub6 waive --phase p6 --gate "$GATE_WAVE" --reason "x"; assert_rc "R7c wave gate waiver without --wave is a usage error" 2 "$G_RC"
  sub6 waive --phase p6 --gate "$GATE_PLAN" --wave 1 --reason "x"; assert_rc "R7c plan gate waiver with --wave is a usage error" 2 "$G_RC"
  sub6 waive --phase p6 --gate "$GATE_PLAN" --reason ""; assert_rc "R7c empty reason is a usage error" 2 "$G_RC"
  sub6 waive --phase p6 --gate xprov-review --reason "x"; assert_rc "R7c unregistered gate id is a usage error" 2 "$G_RC"
  assert_json "R7c usage errors wrote nothing" "$(cat "$PHASE_DIR/xreview/index.json")" "j.length" "2"
  # a waiver never satisfies load-check (it is not a pass with a matching sha)
  sub6 load-check --phase p6
  assert_rc "R7d load-check still exits 1 with only a waiver for the plan gate" 1 "$G_RC"
  # `xprov waive` appears in skills only OUTSIDE fenced bash blocks
  local hits; hits="$(awk '
    /^ *```/ { if (infence) { infence = 0 } else { infence = 1; lang = $0; sub(/^ *```/, "", lang) } next }
    infence && lang ~ /^(bash|sh|zsh)/ && /xprov waive/ { print FILENAME ":" FNR ": " $0 }
  ' $(grep -rl "xprov waive" "$REPO_ROOT/skills") 2>/dev/null)"
  [[ -z "$hits" ]] && ok "R7e no skill bash block executes xprov waive" || bad "R7e xprov waive inside a bash block: $hits"
  [[ -n "$(grep -rl "xprov waive" "$REPO_ROOT/skills")" ]] && ok "R7e skills mention xprov waive in prose (the human instruction exists)" || bad "R7e no skill tells the human how to waive"
  sub6 waive --phase p6 --gate "$GATE_PLAN" --reason "$(printf 'line one\nline two')"; assert_rc "R7f a reason with a newline is a usage error" 2 "$G_RC"
  assert_json "R7f nothing written for the rejected reason" "$(cat "$PHASE_DIR/xreview/index.json")" "j.length" "2"
  # Reinhard PR review MINOR (b): every waiver is ALSO an observation with pattern
  # xprov_waived (the learning loop must see waivers). Two waivers above → two lines.
  # Red-making change: waive() not calling observe().
  local obs="$PHASE_DIR/observations.jsonl"
  [[ -f "$obs" ]] && assert_eq "R7g exactly one xprov_waived observation per waiver (2 waivers → 2 lines)" "$(grep -c '"pattern":"xprov_waived"' "$obs")" "2" || bad "R7g no observations.jsonl after waive"
  [[ -f "$obs" ]] && assert_json "R7g the waiver observation carries agent xprov-codex, type gap, severity major and the reason" "$(tail -1 "$obs")" \
    "[j.agent, j.type, j.severity, j.pattern, j.msg.includes('accepted risk'), j.wave].join('/')" "xprov-codex/gap/major/xprov_waived/true/2"
}

# ---------- R9 (Reinhard PR review MINOR c): --allow-plugins reaches preflight ----------
# Red-making change: gate calling preflight({}) without the allowlist.
caseR9g() {
  prep6
  mkdir -p "$XHOME/plugins/cache/openai-curated-remote/x/1.0"
  gate6 --gate "$GATE_PLAN"
  assert_json "R9g1 a plugin dir in the home's cache fails the gate at preflight (plugins_cache_empty)" "$G_OUT" \
    "[j.step, j.reason, /plugins_cache_empty/.test(j.reason_detail)].join('/')" "preflight/preflight_failed/true"
  # allowlist entries are paths under plugins/cache/ — <marketplace>/<plugin>/<version> (preflight's scan depth 3)
  gate6 --gate "$GATE_PLAN" --allow-plugins openai-curated-remote/x/1.0
  assert_rc "R9g2 the same gate with --allow-plugins <marketplace>/x/1.0 passes preflight and completes (exit 0)" 0 "$G_RC" "$G_ERR"
  assert_json "R9g2 verdict pass at step normalize" "$G_OUT" "[j.verdict, j.step].join('/')" "pass/normalize"
}

# ---------- R8 (Reinhard, Wave 6 review): the steps the first fixture pass never reached ----------
# Red-making changes, per arm: (a) snapshot failure not returned; (b) run failure
# not returned; (c) waiver counted as a round; (d) fail() keeping `out.verdict`
# (a broken observe step would leave `pass` in stdout); (e) forwarding hostile
# model strings to observe; (f)/(g) attempts counted as rounds; (h) round
# collision checked only after the runner ran; (i) --base accepted as a ref;
# (j) wave-status keyed on wave only; (l) resume forced after a pass.
# case_with_sha <case> <sha> <out> [observed-model] — copies a captured case
# with its plan_sha256 replaced (and observed_models[0] set when given).
case_with_sha() {
  node -e '
    const fs = require("fs"); const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    r.plan_sha256 = process.argv[2]; if (process.argv[4]) r.observed_models = [process.argv[4]];
    fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 2) + "\n");
  ' "$CASES/$1.result.json" "$2" "$3" "${4:-}"
}
caseR8() {
  local approved_sha; approved_sha="$(sha256_of "$CASES/approved.PLAN.md")"
  # (a) step snapshot: a committed fake secret stops the chain before the runner
  prep6
  printf 'aws_key = "AKIAABCDEFGHIJKLMNOP"\n' > "$PHASE_REPO/src/leak.js"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "leak" )
  gate6 --gate "$GATE_PLAN"
  assert_rc "R8a gate exits 1 on a secret in the snapshot" 1 "$G_RC"
  assert_json "R8a step snapshot, reason secret_in_snapshot" "$G_OUT" "[j.step, j.reason, j.verdict].join('/')" "snapshot/secret_in_snapshot/fail"
  [[ ! -f "$ARGV6_FILE" ]] && ok "R8a runner never called" || bad "R8a runner called after a snapshot failure"
  assert_eq "R8a no snapshot left" "$(snapshots_left)" "0"
  [[ ! -e "$PHASE_DIR/xreview/index.json" ]] && ok "R8a no index entry" || bad "R8a index.json written"
  grep -q "step: snapshot" "$PHASE_DIR/PLAN-REVIEW-LOG.md" && ok "R8a log names step snapshot" || bad "R8a log lacks step snapshot"
  # (b) step run: a pre-run_dir refusal is runner_failed, no index entry, snapshot removed
  prep6
  FAKE_RUNNER_REFUSE=1 gate6 --gate "$GATE_PLAN"
  assert_rc "R8b gate exits 1 when the runner refuses" 1 "$G_RC"
  assert_json "R8b step run, reason runner_failed" "$G_OUT" "[j.step, j.reason].join('/')" "run/runner_failed"
  [[ ! -e "$PHASE_DIR/xreview/index.json" ]] && ok "R8b no index entry after a runner failure" || bad "R8b index.json written"
  assert_eq "R8b snapshot removed" "$(snapshots_left)" "0"
  # (c) a waiver is not a round
  prep6
  sub6 waive --phase p6 --gate "$GATE_WAVE" --wave 2 --reason "provider down"
  gate6 --gate "$GATE_WAVE" --wave 2 --base "$PHASE_HEAD"
  assert_rc "R8c inspect after a waiver runs as round 1" 0 "$G_RC" "$G_ERR"
  assert_json "R8c round 1, verdict pass" "$G_OUT" "j.round + '/' + j.verdict" "1/pass"
  # (d) observe cannot write → the gate is a FAIL even though normalize passed
  prep6
  mkdir -p "$PHASE_DIR/observations.jsonl" # a directory where the file must go
  gate6 --gate "$GATE_PLAN"
  assert_rc "R8d gate exits 1 when the observation cannot be written" 1 "$G_RC"
  assert_json "R8d verdict fail, step observe, reason malformed, next null" "$G_OUT" "[j.verdict, j.step, j.reason, String(j.next)].join('/')" "fail/observe/malformed/null"
  assert_json "R8d normalize's pass entry stays in index.json (reviewed, but unattributed → fail)" "$(cat "$PHASE_DIR/xreview/index.json")" "j[0].verdict" "pass"
  # (e) hostile observed_models[0] never costs the observation
  prep6
  case_with_sha approved "$approved_sha" "$TMP06/hostile-model.result.json" 'evil<model>|;rm -rf'
  FAKE_RUNNER_CASE="$TMP06/hostile-model.result.json" gate6 --gate "$GATE_PLAN"
  assert_rc "R8e gate exits 0 with a hostile observed model string" 0 "$G_RC" "$G_ERR"
  assert_json "R8e observation written with model_observed unknown (hostile string dropped)" "$(tail -n 1 "$PHASE_DIR/observations.jsonl")" "j.agent + '/' + j.model_observed" "xprov-codex/unknown"
  # (f) blocked at round 1 is an attempt: the next run is round 1 again and resumes nothing
  prep6
  case_with_sha blocked "$approved_sha" "$TMP06/blocked-approved-sha.result.json"
  FAKE_RUNNER_CASE="$TMP06/blocked-approved-sha.result.json" gate6 --gate "$GATE_PLAN"
  assert_json "R8f BLOCKED → fail/blocked at step normalize, round 1" "$G_OUT" "[j.verdict, j.reason, j.step, j.round].join('/')" "fail/blocked/normalize/1"
  gate6 --gate "$GATE_PLAN"
  assert_rc "R8f the run after a blocked attempt passes" 0 "$G_RC" "$G_ERR"
  assert_json "R8f …as round 1 again (attempts do not consume the cap)" "$G_OUT" "j.round + '/' + j.verdict" "1/pass"
  assert_json "R8f …and resumed nothing" "$(cat "$ARGV6_FILE")" "j.includes('--resume')" "false"
  # (g) two runner failures in one wave do not reach the cap
  prep6
  FAKE_RUNNER_REFUSE=1 gate6 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  FAKE_RUNNER_REFUSE=1 gate6 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  gate6 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  assert_rc "R8g third inspect after two runner failures is not round_cap" 0 "$G_RC" "$G_ERR"
  assert_json "R8g round 1, verdict pass" "$G_OUT" "j.round + '/' + j.verdict" "1/pass"
  # (h) an explicit --round the index already holds is a usage error before any side effect
  gate6 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD" --round 1
  assert_rc "R8h --round 1 on a held round is a usage error" 2 "$G_RC"
  [[ ! -f "$ARGV6_FILE" ]] && ok "R8h runner not called on the collision" || bad "R8h runner called before the collision was detected"
  # (i) --base must be a resolved sha
  gate6 --gate "$GATE_WAVE" --wave 1 --base HEAD; assert_rc "R8i --base HEAD (a ref, not a sha) is a usage error" 2 "$G_RC"
  # (l) round 2 after a PASS at round 1 is a fresh session (no dispositions needed, no --resume)
  gate6 --gate "$GATE_PLAN"
  assert_rc "R8l plan round 1 passes" 0 "$G_RC" "$G_ERR"
  gate6 --gate "$GATE_PLAN" --round 2 --resume "$PHASE_PLAN" --feedback "$PHASE_PLAN"
  assert_rc "R8l --resume without a REVISE predecessor is a usage error" 2 "$G_RC"
  [[ ! -f "$ARGV6_FILE" ]] && ok "R8l runner not called on the forced resume" || bad "R8l runner called on the forced resume"
  gate6 --gate "$GATE_PLAN" --round 2
  assert_rc "R8l explicit round 2 after a pass runs fresh (exit 0)" 0 "$G_RC" "$G_ERR"
  assert_json "R8l no --resume in the fresh round-2 argv" "$(cat "$ARGV6_FILE")" "j.includes('--resume')" "false"
  # (j) wave-status is lane-aware: a lane wave needs its own pass or waiver
  prep6
  mkdir -p "$PHASE_DIR/xreview"
  printf '## Wave 1 — runtime\n' > "$PHASE_DIR/STATUS-runtime.md"
  printf '## Wave 1 — storage\n' > "$PHASE_DIR/STATUS-storage.md"
  printf '[{"gate":"%s","wave":1,"lane":"runtime","round":1,"verdict":"pass","reason":null,"plan_sha256":"x","result_path":"/x","ts":"2026-09-24T11:00:00.000Z"}]\n' "$GATE_WAVE" > "$PHASE_DIR/xreview/index.json"
  sub6 wave-status --phase p6
  assert_rc "R8j lane storage lacks its inspection → exit 1" 1 "$G_RC"
  assert_json "R8j lacking_detail names wave 1 lane storage, completed_detail both lanes" "$G_OUT" "j.lacking_detail.map((p) => p.wave + ':' + p.lane).join(',') + '|' + j.completed_detail.map((p) => p.wave + ':' + p.lane).join(',')" "1:storage|1:runtime,1:storage"
  sub6 waive --phase p6 --gate "$GATE_WAVE" --wave 1 --lane storage --reason "storage lane accepted"
  assert_rc "R8j lane waiver exits 0" 0 "$G_RC" "$G_ERR"
  assert_json "R8j waiver entry carries the lane" "$(cat "$PHASE_DIR/xreview/index.json")" "j[1].lane + '/' + j[1].waived" "storage/true"
  sub6 wave-status --phase p6
  assert_rc "R8j both lane waves covered → exit 0" 0 "$G_RC" "$G_ERR"
}

caseR2; caseR3; caseR4; caseR6; caseR7; caseR8; caseR9g
export HOME="$SAVED_HOME_06"; unset A1_XPROV_CODEX_HOME
