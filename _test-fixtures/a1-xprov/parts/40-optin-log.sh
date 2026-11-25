#!/usr/bin/env bash
# Part 40 — spec 027 slice 5 (FR-032, D9): PLAN-REVIEW-LOG.md is opt-in (A1_KEEP_REVIEW_LOGS=1), the reader check, and the
# always-on self-repair trail in the observation line. Sourced by run-tests.sh. The harness exports A1_KEEP_REVIEW_LOGS=1 (every
# log assert of the other parts keeps its meaning); the default-off cases here run with the variable removed from the child env.
#   OL1  default run: no PLAN-REVIEW-LOG.md, XREVIEW.md present      OL2  with =1: the log has one entry     OL3  =yes keeps it off
#   OL4  bin/check-optin-readers.cjs on the real tree: exit 0         OL5  a planted agent line naming the file: exit 1
#   OL6  .last-run.json has readers (04b, 01-load)                    OL7  self-repair with the log off: the observation holds `recovery`
#   OL8  line-exact allowlist (an extra line in help-xprov.cjs reads) OL9  buildObservation rejects an unknown recovery action
#   OL12-OL16 allowlist contract: duplicate line, widened scan, stale entry, optin-logs.cjs itself, contains < 20
#   OL10 compactRecovery is total, bounded and leaks nothing          OL11 compactRecovery keeps `fallback`
# Helpers are copied from parts 06 and 29 (a part must run alone in its shard).

mk_workdir TMP40 "a1x40"
[[ -n "$TMP40" && -d "$TMP40" ]] || { echo "FAIL  part 40: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
SAVED_HOME_40="$HOME"
export HOME="$TMP40/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
LIB40="$REPO_ROOT/_shared/lib"; CHECK40="$REPO_ROOT/bin/check-optin-readers.cjs"
ARGV40_DIR="$TMP40/argv"; mkdir -p "$ARGV40_DIR"; ARGV40_N=0
NET40='{"FAKE_RUNNER_CODEX_STDOUT":"net-disconnect"}'
OK40='{"FAKE_RUNNER_CASE":"approved"}'

pin40() {
  node -e '
    const fs = require("fs"); const file = process.argv[1]; const ids = ["plan-review-xprov"];
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").split("\n").map((l) => (ids.some((id) => l.startsWith("| `" + id + "` |")) ? l.replace(/\| (warning|blocking) \|/, "| warning |") : l)).join("\n"));
  ' "$TREE/_shared/gates-registry.md" || bad "pin40: could not pin the registry copy"
}
prep40() {
  make_tree; pin40; make_phase p40 "$CASES/approved.PLAN.md"
  rm -rf "$HOME/.a1-xprov"; write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  make_home; export A1_XPROV_CODEX_HOME="$XHOME"
  node "$TREE_TOOLS" xprov init-home >/dev/null 2>&1 </dev/null
  ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
}
# gate40 <keep: unset|<value>> <seq-json> [flags…] — one gate run; the child env has A1_KEEP_REVIEW_LOGS removed or set to <keep>
gate40() {
  local keep="$1" seq="$2"; shift 2
  local envargs=(-u A1_KEEP_REVIEW_LOGS); [[ "$keep" != unset ]] && envargs=("A1_KEEP_REVIEW_LOGS=$keep")
  ARGV40_N=$((ARGV40_N + 1)); rm -f "$TMP40/count"
  FAKE_RUNNER_ARGV_FILE="$ARGV40_DIR/argv-$ARGV40_N.json" FAKE_RUNNER_COUNT_FILE="$TMP40/count" FAKE_RUNNER_SEQUENCE="$seq" FAKE_RUNNER_CASE=approved fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && env "${envargs[@]}" node "$TREE_TOOLS" xprov gate --phase p40 --timeout 7 "$@" 2>"$TMP40/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP40/err.txt")"
}
logs40() { ls "$PHASE_DIR" | grep -c '^PLAN-REVIEW-LOG.md$'; }

# OL1-OL3
prep40; gate40 unset "[$OK40]" --gate "$GATE_PLAN"
assert_rc "OL1 default run passes" 0 "$G_RC" "$G_ERR"
[[ "$(logs40)" == 0 && -f "$PHASE_DIR/XREVIEW.md" ]] && ok "OL1 no PLAN-REVIEW-LOG.md, XREVIEW.md present" || bad "OL1 log=$(logs40) XREVIEW=$([[ -f "$PHASE_DIR/XREVIEW.md" ]] && echo yes || echo no)"
prep40; gate40 1 "[$OK40]" --gate "$GATE_PLAN"
[[ "$(logs40)" == 1 && "$(grep -c '^## gate ' "$PHASE_DIR/PLAN-REVIEW-LOG.md")" == 1 ]] && ok "OL2 with A1_KEEP_REVIEW_LOGS=1 the log holds one entry" || bad "OL2 log=$(logs40)"
prep40; gate40 yes "[$OK40]" --gate "$GATE_PLAN"
[[ "$(logs40)" == 0 ]] && ok "OL3 A1_KEEP_REVIEW_LOGS=yes keeps the log off" || bad "OL3 the log was written for the value yes"

# OL4-OL6, OL8: the reader check
node "$CHECK40" --name PLAN-REVIEW-LOG.md > "$TMP40/rd.json" 2>"$TMP40/rd.err"; assert_rc "OL4 check-optin-readers: no reader of PLAN-REVIEW-LOG.md on the real tree" 0 "$?" "$(head -c 400 "$TMP40/rd.json")"
cp_tree40() { local d="$1"; mkdir -p "$d/skills" "$d/agents" "$d/_shared" "$d/bin" "$d/hooks"; cp -R "$REPO_ROOT/skills/." "$d/skills/"; cp -R "$REPO_ROOT/agents/." "$d/agents/"; cp -R "$REPO_ROOT/_shared/lib" "$d/_shared/lib"; cp "$REPO_ROOT/_shared/a1-tools.cjs" "$d/_shared/a1-tools.cjs"; cp -R "$REPO_ROOT/bin/." "$d/bin/"; cp -R "$REPO_ROOT/hooks/." "$d/hooks/"; }
cp_tree40 "$TMP40/plant1"; af40="$(ls "$TMP40/plant1/agents"/*.md | head -1)"; printf 'Read PLAN-REVIEW-LOG.md for the history.\n' >> "$af40"
node "$CHECK40" --name PLAN-REVIEW-LOG.md --root "$TMP40/plant1" > "$TMP40/rd5.json" 2>/dev/null; rc40=$?
assert_rc "OL5 a planted agent line naming the file" 1 "$rc40"
assert_json "OL5 readers[0].file is the planted agent" "$(cat "$TMP40/rd5.json")" "j.readers[0].file" "agents/$(basename "$af40")"
node "$CHECK40" --name .last-run.json > "$TMP40/rd6.json" 2>/dev/null; rc40=$?
assert_rc "OL6 .last-run.json has readers" 1 "$rc40"
assert_json "OL6 readers include 04b and 01-load" "$(cat "$TMP40/rd6.json")" "['skills/a1-plan/workflows/04b-xprov-review.md','skills/a1-execute/workflows/01-load.md'].every((f) => j.readers.some((r) => r.file === f))" "true"
cp_tree40 "$TMP40/plant2"; printf '// extra: PLAN-REVIEW-LOG.md is read here\n' >> "$TMP40/plant2/_shared/lib/help-xprov.cjs"
node "$CHECK40" --name PLAN-REVIEW-LOG.md --root "$TMP40/plant2" > "$TMP40/rd8.json" 2>/dev/null; rc40=$?
assert_rc "OL8 an extra mention line in help-xprov.cjs is a reader (line-exact allowlist)" 1 "$rc40"
assert_json "OL8 readers[0].file is _shared/lib/help-xprov.cjs" "$(cat "$TMP40/rd8.json")" "j.readers[0].file" "_shared/lib/help-xprov.cjs"
node "$CHECK40" >/dev/null 2>&1; assert_rc "OL4 usage: no --name is exit 2" 2 "$?"

# OL12-OL16: the allowlist contract (bug 2026-11-25-optin-allowlist-contract, audit F-002)
OLNAME40=PLAN-REVIEW-LOG.md
# run40 <root> <tag> — one check run on a planted copy; sets rc40 and $TMP40/<tag>.json
run40() { node "$CHECK40" --name "$OLNAME40" --root "$1" > "$TMP40/$2.json" 2>/dev/null; rc40=$?; }
# OL12: a second line holding an allowed `contains` is a reader (1:1 count)
cp_tree40 "$TMP40/plant12"; printf "const x = readFileSync(dir + 'PLAN-REVIEW-LOG.md'); // a1 writes PLAN-REVIEW-LOG.md itself\n" >> "$TMP40/plant12/_shared/lib/xprov-run.cjs"
run40 "$TMP40/plant12" rd12; assert_rc "OL12 a duplicate line holding an allowed contains is a reader" 1 "$rc40"
assert_json "OL12 exactly one reader, in xprov-run.cjs" "$(cat "$TMP40/rd12.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/xprov-run.cjs"
# OL13: readers in _shared/a1-tools.cjs and in a bin/*.sh are found (widened scan)
cp_tree40 "$TMP40/plant13"; printf "// reads PLAN-REVIEW-LOG.md\n" >> "$TMP40/plant13/_shared/a1-tools.cjs"; printf "cat PLAN-REVIEW-LOG.md\n" >> "$TMP40/plant13/bin/run-suites.sh"
run40 "$TMP40/plant13" rd13; assert_rc "OL13 readers in a1-tools.cjs and a bin script" 1 "$rc40"
assert_json "OL13 both files are reported" "$(cat "$TMP40/rd13.json")" "['_shared/a1-tools.cjs','bin/run-suites.sh'].every((f) => j.readers.some((r) => r.file === f))" "true"
# OL14: an entry that matches no line is stale
cp_tree40 "$TMP40/plant14"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.includes("a1 writes PLAN-REVIEW-LOG.md itself") || l.includes("entry(")).join("\n"));
' "$TMP40/plant14/_shared/lib/xprov-run.cjs"
run40 "$TMP40/plant14" rd14; assert_rc "OL14 a stale allowlist entry fails the check" 1 "$rc40"
assert_json "OL14 stale lists the entry and readers is empty" "$(cat "$TMP40/rd14.json")" "j.stale.length + '|' + j.stale[0].file + '|' + j.readers.length" "1|_shared/lib/xprov-run.cjs|0"
# OL15: a reader line inside optin-logs.cjs is found (no whole-file skip); the definition lines stay allowed
cp_tree40 "$TMP40/plant15"; printf "// read PLAN-REVIEW-LOG.md here\n" >> "$TMP40/plant15/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant15" rd15; assert_rc "OL15 a reader line in optin-logs.cjs" 1 "$rc40"
assert_json "OL15 exactly one reader, in optin-logs.cjs" "$(cat "$TMP40/rd15.json")" "j.readers.length + '|' + j.readers[0].file" "1|_shared/lib/optin-logs.cjs"
# OL16: a contains shorter than 20 characters is a contract violation
cp_tree40 "$TMP40/plant16"; node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("a1 writes PLAN-REVIEW-LOG.md itself", "PLAN-REVIEW-LOG.md"));
' "$TMP40/plant16/_shared/lib/optin-logs.cjs"
run40 "$TMP40/plant16" rd16; assert_rc "OL16 a contains under 20 characters fails the check" 1 "$rc40"
assert_json "OL16 one contract violation" "$(cat "$TMP40/rd16.json")" "j.contract_violations.length" "1"
# OL4b: the real tree reports no stale entry and no violation
assert_json "OL4 real tree: stale and contract_violations are empty" "$(cat "$TMP40/rd.json")" "j.stale.length + '|' + j.contract_violations.length" "0|0"

# OL7: self-repair with the log off — the observation line carries `recovery`, no log file is written
prep40; gate40 unset "[$NET40,$OK40]" --gate "$GATE_PLAN"
[[ "$(logs40)" == 0 ]] && ok "OL7 no PLAN-REVIEW-LOG.md after a self-repair with the log off" || bad "OL7 the log exists after a repair"
last40="$(tail -n 1 "$PHASE_DIR/observations.jsonl" 2>/dev/null)"
assert_json "OL7 the last observation line: recovered true, recovery[0] = runner_retry ok attempts 2" "${last40:-null}" "[j.recovered, JSON.stringify(j.recovery && j.recovery[0])].join('|')" 'true|{"action":"runner_retry","ok":true,"attempts":2}'
assert_json "OL7 the line holds no cause and no error text" "${last40:-null}" "/cause|net-disconnect|error sending/i.test(JSON.stringify(j.recovery)) ? 'leak' : 'clean'" "clean"

# OL9-OL11: the observe side (static, real tree)
OBS40='const O = require(process.argv[1] + "/xprov-observe.cjs"); const base = { agent: "xprov-codex", skill: "a1-plan", phase: "p", wave: null, type: "gap", severity: "minor", msg: "m", provider: "codex" };'
out="$(node -e "$OBS40"' try { O.buildObservation({ ...base, recovered: true, recovery: [{ action: "x", ok: true }] }); console.log("no throw"); } catch (e) { console.log(e.code); }' "$LIB40" 2>&1)"
assert_eq "OL9 an unknown recovery action throws A1_INPUT" "$out" "A1_INPUT"
out="$(node -e "$OBS40"'
  const hostile = [{ action: "x" }, { action: "runner_retry", ok: "yes", attempts: new Array(50), cause: "secret" }, { action: "preflight_repair", ok: false, refused: "/etc", actions: [] }];
  for (let i = 0; i < 9; i++) hostile.push({ action: "base_recomputed", ok: true, from: "secret", to: "/etc" });
  const r = []; r.push(JSON.stringify(O.compactRecovery("nope"))); const c = O.compactRecovery(hostile); const j = JSON.stringify(c);
  r.push(c.length <= 8, c.every((i) => Object.keys(i).every((k) => ["action", "ok", "attempts", "fallback"].includes(k))), c.every((i) => i.attempts === undefined || i.attempts <= 9), !j.includes("secret") && !j.includes("/etc"));
  try { O.buildObservation({ ...base, recovered: true, recovery: c }); r.push("built"); } catch (e) { r.push("threw " + e.message); }
  console.log(r.join("|"));' "$LIB40" 2>&1)"
assert_eq "OL10 compactRecovery on hostile input: total, at most 8 items, only the four keys, attempts <= 9, no leak, accepted by buildObservation" "$out" "[]|true|true|true|true|built"
out="$(node -e "$OBS40"' const c = O.compactRecovery([{ action: "blocked_retry", ok: true, fallback: true }]); const o = O.buildObservation({ ...base, recovered: true, recovery: c }); console.log(JSON.stringify(c) + "|" + JSON.stringify(o.recovery));' "$LIB40" 2>&1)"
assert_eq "OL11 compactRecovery keeps fallback and buildObservation stores it unchanged" "$out" '[{"action":"blocked_retry","ok":true,"fallback":true}]|[{"action":"blocked_retry","ok":true,"fallback":true}]'

export HOME="$SAVED_HOME_40"
rm -rf "$TMP40"
