#!/usr/bin/env bash
# Part 13 — spec 012 Wave B (B.2): waves start at 0 (FR-008..FR-012).
# Sourced by run-tests.sh. Every arm names its red-making change.
#
#   V1  `gate --wave 0` runs end to end (fake runner): exit 0, index entry,
#       observation and findings carry wave 0.   Red while --wave is 1..9999.
#   V2  a store waiver for wave 0 is a valid record; wave-status counts it
#       (STATUS.md `## Wave 0`) → exit 0.         Red while validRecord needs wave > 0.
#   V3  wave 0 uncovered → still wave_inspect_missing (lacking [0]).
#   V4  invalid waves (-1, 01, 10000, 1.5, empty) → exit 2, text says 0 to 9999;
#       `--round 0` and `--timeout 0` stay refused; `--waves 0,1` accepted.
#   V5  the Number(null) === 0 trap: an index row with wave null is not wave 0
#       (sameWave unit + wave-status end to end).   Red if sameWave/the candidate
#       filter use Number(entry.wave) without a null guard.
#   V6  `grep -n parsePositive _shared/lib/xprov*.cjs` lists round/timeout sites only.
#   V7  observe / run / normalize accept wave 0.
#   V8  a wave-0 owner waiver through the CLI (owner path; SKIP under Claude Code).

TMP13="$(mktemp -d "${TMPDIR:-/tmp}/a1x13.XXXXXX")"
[[ -n "$TMP13" && -d "$TMP13" ]] || { echo "FAIL  part 13: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_13="$HOME"
export HOME="$TMP13/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
ARGV13="$TMP13/argv.json"

claude_ancestor13() {
  [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PID:-}" ]] && return 0
  local p=$$ c
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    c="$(ps -o comm= -p "$p" 2>/dev/null)"
    [[ "$(basename -- "${c:-x}")" == claude ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
NOCLAUDE13=(env)
for v13 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE13+=(-u "$v13"); done

plansha13() { (shasum -a 256 "$PHASE_PLAN" 2>/dev/null || sha256sum "$PHASE_PLAN") | cut -d' ' -f1; }
repokey13() { (cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P); }
prep13() {
  make_tree; make_phase p13
  write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"; export A1_XPROV_CODEX_HOME="$XHOME"
  rm -rf "$HOME/.a1-xprov"
}
gate13() {
  FAKE_RUNNER_ARGV_FILE="$ARGV13" FAKE_RUNNER_CASE="${FAKE_RUNNER_CASE:-approved}" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov gate --phase p13 --timeout 7 "$@" 2>"$TMP13/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP13/err.txt")"
}
sub13() { G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP13/err.txt")"; G_RC=$?; G_ERR="$(cat "$TMP13/err.txt")"; }
c13() { ( cd "$PHASE_REPO" && printf '%s\n' "$2" >> "$1" && git add -A && git commit -qm "$2" ); git -C "$PHASE_REPO" rev-parse HEAD; }
# waiver13 <wave> <head> <base> — one wave-inspect record, documented format (spec FR-007 of 009)
waiver13() {
  mkdir -p "$HOME/.a1-xprov"; chmod 700 "$HOME/.a1-xprov"
  node -e '
    const fs = require("fs"); const [file, repo, sha, wave, head, base] = process.argv.slice(1);
    fs.writeFileSync(file, JSON.stringify({ version: 1, waivers: [{ repo, phase: "p13", gate: "wave-inspect-xprov", plan_sha256: sha, wave: Number(wave), lane: null, head, base, reason: "fixture", by: "fixture", ts: "2026-10-05T00:00:00.000Z" }] }, null, 2) + "\n");
  ' "$HOME/.a1-xprov/waivers.json" "$(repokey13)" "$(plansha13)" "$1" "$2" "$3"
  chmod 600 "$HOME/.a1-xprov/waivers.json"
}

caseV1() {
  prep13
  gate13 --gate "$GATE_WAVE" --wave 0 --base "$PHASE_HEAD"
  assert_rc "V1 gate --wave 0 runs (approved case) → exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "V1 verdict pass, wave 0 (not null)" "$G_OUT" "j.verdict + '/' + j.wave + '/' + (j.wave === 0)" "pass/0/true"
  assert_json "V1 the index entry carries wave 0 (a number)" "$(cat "$PHASE_DIR/xreview/index.json" 2>/dev/null || echo '[{}]')" "j[0].wave === 0 && j[0].verdict === 'pass'" "true"
  assert_json "V1 the observation carries wave 0 and skill a1-execute" "$(tail -n 1 "$PHASE_DIR/observations.jsonl" 2>/dev/null || echo '{}')" "j.wave + '/' + j.skill" "0/a1-execute"
  assert_json "V1 the runner was called with --wave 0 semantics (inspect mode on the snapshot)" "$(cat "$ARGV13" 2>/dev/null || echo '[]')" "j[1]" "inspect"
  [[ "$(basename "$(json_get "$G_OUT" "j.findings_path")")" == *wave-0* ]] && ok "V1 the findings file is named wave-0" || bad "V1 findings name: $(json_get "$G_OUT" "j.findings_path")"
  # round numbering is per (gate, wave 0)
  gate13 --gate "$GATE_WAVE" --wave 0 --base "$PHASE_HEAD" --round 1
  assert_rc "V1 an explicit round the index already holds for wave 0 is a usage error" 2 "$G_RC"
  # plan review keeps wave null
  gate13 --gate "$GATE_PLAN"
  assert_json "V1 plan review keeps wave null" "$G_OUT" "String(j.wave)" "null"
  printf '## Wave 0 — zero\n' > "$PHASE_DIR/STATUS.md"
  sub13 wave-status --phase p13
  assert_rc "V1 wave-status counts the wave-0 pass (head = HEAD) → exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "V1 completed_waves [0], lacking []" "$G_OUT" "JSON.stringify(j.completed_waves) + '/' + j.lacking.length" "[0]/0"
}

caseV2() {
  prep13; printf '## Wave 0 — zero\n' > "$PHASE_DIR/STATUS.md"
  sub13 wave-status --phase p13
  assert_rc "V3 wave 0 uncovered → exit 1" 1 "$G_RC"
  assert_json "V3 lacking [0], reason wave_inspect_missing" "$G_OUT" "JSON.stringify(j.lacking) + '/' + j.reason" "[0]/wave_inspect_missing"
  local head; head="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  waiver13 0 "$head" "$PHASE_HEAD"
  sub13 wave-status --phase p13
  assert_rc "V2 a store waiver for wave 0 covers it → exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "V2 completed_waves [0]" "$G_OUT" "JSON.stringify(j.completed_waves)" "[0]"
  sub13 wave-status --phase p13 --waves 0
  assert_rc "V2 --waves 0 is accepted" 0 "$G_RC" "$G_ERR"
  # a wave-0 waiver for another head does not cover it
  c13 src/add.js '// moved on' >/dev/null
  sub13 wave-status --phase p13
  assert_rc "V2 a commit after the wave-0 waiver → exit 1 (the chain rule applies to wave 0)" 1 "$G_RC"
  # wave 0 then wave 1: 0 chains before 1
  prep13; printf '## Wave 0 — zero\n## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  local h0 h1
  h0="$(c13 src/add.js '// wave 0')"
  gate13 --gate "$GATE_WAVE" --wave 0 --base "$PHASE_HEAD"
  h1="$(c13 src/add.js '// wave 1')"
  gate13 --gate "$GATE_WAVE" --wave 1 --base "$h0"
  sub13 wave-status --phase p13
  assert_rc "V2 a clean chain wave 0 → wave 1 → exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "V2 completed_waves [0,1]" "$G_OUT" "JSON.stringify(j.completed_waves)" "[0,1]"
}

caseV4() {
  prep13
  local w
  for w in -1 01 10000 1.5 ""; do
    gate13 --gate "$GATE_WAVE" --wave "$w" --base "$PHASE_HEAD"
    assert_rc "V4 gate --wave '$w' → exit 2" 2 "$G_RC"
  done
  [[ "$G_ERR" == *"0 to 9999"* ]] && ok "V4 the error text says 0 to 9999" || bad "V4 error text: $G_ERR"
  gate13 --gate "$GATE_WAVE" --wave 9999 --base "$PHASE_HEAD"
  [[ "$G_RC" -ne 2 ]] && ok "V4 --wave 9999 is accepted (upper bound)" || bad "V4 --wave 9999 refused: $G_ERR"
  gate13 --gate "$GATE_WAVE" --wave 0 --base "$PHASE_HEAD" --round 0
  assert_rc "V4 --round 0 stays refused" 2 "$G_RC"
  [[ "$G_ERR" == *"between 1 and 9999"* ]] && ok "V4 round keeps the 1..9999 text" || bad "V4 round text: $G_ERR"
  gate13 --gate "$GATE_WAVE" --wave 0 --base "$PHASE_HEAD" --timeout 0
  assert_rc "V4 --timeout 0 stays refused" 2 "$G_RC"
  printf '## Wave 0 — zero\n' > "$PHASE_DIR/STATUS.md"
  sub13 wave-status --phase p13 --waves 0,-1; assert_rc "V4 wave-status --waves 0,-1 → exit 2" 2 "$G_RC"
  sub13 wave-status --phase p13 --waves 0,; [[ "$G_RC" -ne 2 ]] && ok "V4 wave-status --waves '0,' accepts 0" || bad "V4 --waves '0,' refused: $G_ERR"
  sub13 wave-status --phase p13 --waves "0,x"; assert_rc "V4 wave-status --waves 0,x → exit 2" 2 "$G_RC"
  sub13 waive --phase p13 --gate "$GATE_WAVE" --wave -1 --base "$PHASE_HEAD" --reason x --by y
  assert_rc "V4 waive --wave -1 → exit 2 (before any guard text)" 2 "$G_RC"
  [[ "$G_ERR" == *"0 to 9999"* ]] && ok "V4 waive says 0 to 9999" || bad "V4 waive text: $G_ERR"
}

caseV5() {
  # unit: sameWave
  local j; j="$(node -e '
    const C = require(process.argv[1] + "/_shared/lib/xprov-common.cjs");
    const cases = { nullRow0: C.sameWave({ wave: null }, 0), undefRow0: C.sameWave({}, 0), emptyRow0: C.sameWave({ wave: "" }, 0), zeroRow0: C.sameWave({ wave: 0 }, 0), zeroStrRow0: C.sameWave({ wave: "0" }, 0), oneRow0: C.sameWave({ wave: 1 }, 0), nullRowPlan: C.sameWave({ wave: null }, null), zeroRowPlan: C.sameWave({ wave: 0 }, null), oneRow1: C.sameWave({ wave: 1 }, 1) };
    process.stdout.write(JSON.stringify(cases));
  ' "$REPO_ROOT")"
  assert_json "V5 sameWave: a row with wave null is NOT wave 0 (Number(null) === 0 trap)" "$j" "[j.nullRow0, j.undefRow0, j.emptyRow0].join('/')" "false/false/false"
  assert_json "V5 sameWave: wave 0 matches only the number 0 (or its string)" "$j" "[j.zeroRow0, j.zeroStrRow0, j.oneRow0].join('/')" "true/true/false"
  assert_json "V5 sameWave: plan rows (null) unchanged, wave 0 is not a plan row, 1 matches 1" "$j" "[j.nullRowPlan, j.zeroRowPlan, j.oneRow1].join('/')" "true/false/true"
  # end to end: a real wave-1 pass whose index row is rewritten to wave null must not cover wave 0
  prep13; printf '## Wave 0 — zero\n' > "$PHASE_DIR/STATUS.md"
  gate13 --gate "$GATE_WAVE" --wave 1 --base "$PHASE_HEAD"
  [[ "$G_RC" -eq 0 ]] && ok "V5 setup: a real inspect pass exists" || bad "V5 setup: gate exit $G_RC — $G_ERR"
  node -e '
    const fs = require("fs"); const f = process.argv[1];
    const rows = JSON.parse(fs.readFileSync(f, "utf8")); fs.writeFileSync(f, JSON.stringify(rows.map((r) => ({ ...r, wave: null })), null, 2) + "\n");
  ' "$PHASE_DIR/xreview/index.json"
  sub13 wave-status --phase p13
  assert_rc "V5 a pass row with wave null does not cover wave 0 → exit 1" 1 "$G_RC"
  assert_json "V5 wave 0 is lacking" "$G_OUT" "JSON.stringify(j.lacking)" "[0]"
}

caseV6() {
  local bad_lines
  bad_lines="$(grep -n "parsePositive(" "$REPO_ROOT"/_shared/lib/xprov*.cjs | grep -v "function parsePositive(" | grep -v "'round'\|'timeout'" || true)"
  [[ -z "$bad_lines" ]] && ok "V6 every parsePositive call site is a round or timeout site" || bad "V6 parsePositive still used for waves: $(printf '%s' "$bad_lines" | head -n 3 | tr '\n' ' ')"
  local n; n="$(grep -c "parseWave" "$REPO_ROOT/_shared/lib/xprov-common.cjs")"
  [[ "$n" -ge 2 ]] && ok "V6 xprov-common.cjs defines and exports parseWave" || bad "V6 parseWave missing in xprov-common.cjs ($n)"
}

caseV7() {
  prep13
  sub13 observe --agent xprov-codex --skill a1-execute --phase p13 --wave 0 --type gap --severity minor --msg "wave zero"
  assert_rc "V7 observe --wave 0 → exit 0" 0 "$G_RC" "$G_ERR"
  assert_json "V7 the observation line carries wave 0" "$(tail -n 1 "$PHASE_DIR/observations.jsonl" 2>/dev/null || echo '{}')" "j.wave === 0" "true"
  sub13 observe --agent xprov-codex --skill a1-execute --phase p13 --wave "" --type gap --severity minor --msg "no wave"
  assert_rc "V7 observe keeps mapping an empty wave to null" 0 "$G_RC" "$G_ERR"
  assert_json "V7 …to null" "$(tail -n 1 "$PHASE_DIR/observations.jsonl")" "String(j.wave)" "null"
  sub13 observe --agent xprov-codex --skill a1-execute --phase p13 --wave -1 --type gap --severity minor --msg "neg"
  [[ "$G_RC" -ne 0 ]] && ok "V7 observe --wave -1 is refused" || bad "V7 observe accepted --wave -1"
  # waiver validity unit
  local r; r="$(node -e '
    const WV = require(process.argv[1] + "/_shared/lib/xprov-waivers.cjs");
    const sha = "a".repeat(40); const h = "b".repeat(64);
    const rec = (w) => ({ repo: "/r", phase: "p", gate: "wave-inspect-xprov", plan_sha256: h, wave: w, lane: null, head: sha, base: sha, reason: "x", by: "y", ts: "2026-10-05T00:00:00.000Z" });
    process.stdout.write(JSON.stringify([WV.validRecord(rec(0)) !== null, WV.validRecord(rec(-1)) !== null, WV.validRecord(rec(1)) !== null, WV.validRecord(rec(null)) !== null]));
  ' "$REPO_ROOT")"
  assert_json "V7 validRecord: wave 0 and 1 valid, -1 and null refused" "$r" "j.join('/')" "true/false/true/false"
}

caseV8() {
  if claude_ancestor13; then
    if [[ "${CI:-}" == "true" ]]; then bad "V8 owner waiver for wave 0: SKIP (claude-code ancestor) is not allowed when CI=true"
    else results+=("SKIP (claude-code ancestor)  V8 owner waiver for wave 0"); fi
    return 0
  fi
  prep13; printf '## Wave 0 — zero\n' > "$PHASE_DIR/STATUS.md"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "status" )
  local head rc; head="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  local cmd; cmd="$(printf '%q ' "${NOCLAUDE13[@]}" sh -c 'cd "$1" && node "$2" xprov waive --phase p13 --gate wave-inspect-xprov --wave 0 --base "$3" --reason "codex quota" --by owner-fixture' sh "$PHASE_REPO" "$TREE_TOOLS" "$PHASE_HEAD")"
  if [[ "$(uname)" == Darwin ]]; then ( sleep 1; printf '%s\n' "wave-inspect-xprov"; sleep 2 ) | script -q /dev/null "${NOCLAUDE13[@]}" sh -c 'cd "$1" && node "$2" xprov waive --phase p13 --gate wave-inspect-xprov --wave 0 --base "$3" --reason "codex quota" --by owner-fixture' sh "$PHASE_REPO" "$TREE_TOOLS" "$PHASE_HEAD" > "$TMP13/pty.txt" 2>&1; rc=$?
  else ( sleep 1; printf '%s\n' "wave-inspect-xprov"; sleep 2 ) | script -qec "$cmd" /dev/null > "$TMP13/pty.txt" 2>&1; rc=$?; fi
  assert_rc "V8 owner waiver for wave 0 → exit 0" 0 "$rc" "$(tr -d '\r' < "$TMP13/pty.txt" | tail -n 2)"
  assert_json "V8 the store record has wave 0" "$(cat "$HOME/.a1-xprov/waivers.json" 2>/dev/null || echo '{"waivers":[]}')" "j.waivers.map((w) => w.wave).join(',')" "0"
  sub13 wave-status --phase p13
  assert_rc "V8 wave-status accepts the owner's wave-0 waiver → exit 0" 0 "$G_RC" "$G_ERR"
}

caseV1; caseV2; caseV4; caseV5; caseV6; caseV7; caseV8
export HOME="$SAVED_HOME_13"
rm -rf "$TMP13"
