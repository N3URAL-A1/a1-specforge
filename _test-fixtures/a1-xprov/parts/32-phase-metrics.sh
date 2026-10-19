#!/usr/bin/env bash
# Part 32 — spec 016 Wave 12: one fixture phase end to end, measured (SC-001, SC-004, SC-005) and the real-store snapshot (FR-036).
# Sourced by run-tests.sh. Part-local helpers only (suffix 32). Mutants run on tree copies only (rule 4b).
#
# PH  one phase in a permitted repo: plan gate, wave gate and PR diff gate all pass; one chat allowlist approval (a secret in a changed line)
#     and one chat waiver (a PR review that ends at the round cap) are answered in the chat (consent-sim plays the plugin hook).
#     SC-001  the observation sum owner_handoffs counts chat questions only; no output of any step names a terminal command
#             (`xprov permit`, `xprov waive`, `allowlist approve`); every Codex run is counted once                                  [mutants H1, H2]
#     PR waiver end to end: the chat waiver for the PR target (--work-path) covers exactly its head; the merge check accepts it       [mutant W1]
# SW  the sweep over the three gates and the states no permit, owner No, no answer, headless (no chat), denied:
#     SC-004  zero bytes: no runner call, no snapshot, nothing written under the phase or the review worktree
#     SC-005  every run ends not_applicable (never a blocking fail)                                                                  [mutant N1]
# RS  real-store snapshot: the owner's real ~/.a1-xprov (sha256 + mtime) is the same before and after this part

TMP32="$(mktemp -d "${TMPDIR:-/tmp}/a1x32.XXXXXX")"
[[ -n "$TMP32" && -d "$TMP32" ]] || { echo "FAIL  part 32: mktemp failed" >&2; fail=$((fail + 1)); return 0 2>/dev/null || exit 1; }
REAL_HOME_32="$HOME"
REAL_STORE_32="$REAL_HOME_32/.a1-xprov"
# RS: sha256 + mtime of every file of the real owner store, taken before this part touches anything
snap32() { [[ -d "$REAL_STORE_32" ]] && find "$REAL_STORE_32" -type f -exec sh -c 'for f; do printf "%s %s %s\n" "$(shasum -a 256 "$f" | cut -d" " -f1)" "$(node -p "require(\"fs\").statSync(process.argv[1]).mtimeMs" "$f")" "$f"; done' sh {} + 2>/dev/null | sort || true; }
REAL_BEFORE_32="$(snap32)"
export HOME="$TMP32/home"; mkdir -p "$HOME/.codex"; printf '{"fixture":true}\n' > "$HOME/.codex/auth.json"; chmod 600 "$HOME/.codex/auth.json"
STORE32="$HOME/.a1-xprov"
EXK32="AKIA""QQQQQQQQQQQQQQQQ"
SIM32="$FAKE/consent-sim.cjs"
TPL32="$CASES/consent"
NOW32="Nein, keinen Waiver"; YESW32="Ja, diese Ziele per Waiver freigeben"; NOA32="Nein, nichts freigeben"; YESA32="Ja, diese Blobs freigeben"
N32=0

fresh32() { make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; T32="$TREE"; T32_TOOLS="$TREE_TOOLS"; }
unmtree32() { TREE="$T32"; TREE_TOOLS="$T32_TOOLS"; TREE_VENDOR="$T32/_shared/vendor/claudex-loop"; }
mutate32() {
  node -e '
    const fs = require("fs"); const [tree, name, from, to] = process.argv.slice(1);
    const f = tree + "/_shared/lib/" + name; const s = fs.readFileSync(f, "utf8"); const n = s.split(from).length - 1;
    if (n !== 1) { console.error("mutation needle count " + n + " in " + name + ": " + from.slice(0, 60)); process.exit(3); }
    fs.writeFileSync(f, s.replace(from, () => to));
  ' "$TREE" "$1" "$2" "$3" || bad "part 32 harness: mutation failed in $1"
}
redproof32() { # <name> <scenario fn> <expected> <lib-file> <from> <to>
  local name="$1" fn="$2" want="$3" got mut
  got="$($fn)"
  [[ "$got" == "$want" ]] || { bad "$name: real tree gave '$got', wanted '$want'"; return 0; }
  make_tree; cp -R "$REPO_ROOT/hooks" "$TREE/hooks"; mutate32 "$4" "$5" "$6"
  mut="$($fn)"; unmtree32
  [[ "$mut" != "$want" ]] && ok "$name RED [mutant]: with the production change the outcome flips ('$want' -> '$mut')" || bad "$name RED [mutant]: the guard is dead, the mutant still gives '$mut'"
}

# prep32 [permit|none] — a repo with a phase p32, a local bare origin on main, a review home; the feature branch `feat` is checked out
prep32() {
  make_phase p32
  ORIGIN32="$(mktemp -d "$TMP32/origin.XXXXXX")"; git init -q --bare "$ORIGIN32"; git -C "$ORIGIN32" symbolic-ref HEAD refs/heads/main
  git -C "$PHASE_REPO" remote add origin "$ORIGIN32"; git -C "$PHASE_REPO" branch -M main
  printf '## Wave 1 — one\n' > "$PHASE_DIR/STATUS.md"
  rm -rf "$STORE32"
  [[ "${1:-permit}" == permit ]] && write_permit "$PHASE_REPO" fixture record/2026-09-24-fixture.md
  git -C "$PHASE_REPO" add -A && git -C "$PHASE_REPO" commit -qm "fixture: permit and status" && git -C "$PHASE_REPO" push -q origin main 2>/dev/null
  PHASE_HEAD="$(git -C "$PHASE_REPO" rev-parse HEAD)"
  make_home; export A1_XPROV_CODEX_HOME="$XHOME"
  node "$TREE_TOOLS" xprov init-home >/dev/null 2>&1 </dev/null
  ln -s "$HOME/.codex/auth.json" "$XHOME/auth.json"
  git -C "$PHASE_REPO" checkout -q -b feat
  COUNT32="$(mktemp "$TMP32/count.XXXXXX")"; rm -f "$COUNT32"
  OUT32="$TMP32/out.$((N32 += 1)).txt"; : > "$OUT32"
}
commit32() { mkdir -p "$(dirname "$PHASE_REPO/$1")"; printf '%s\n' "$2" > "$PHASE_REPO/$1"; git -C "$PHASE_REPO" add -A && git -C "$PHASE_REPO" commit -qm "fixture: $1"; }
runs32() { [[ -f "$COUNT32" ]] && wc -l < "$COUNT32" | tr -d ' ' || echo 0; }
# run32 <case> <args...> — one gate/CLI call from the repo; G_OUT G_RC; every output is appended to OUT32 (the terminal-command scan reads it)
run32() {
  local case="$1"; shift
  FAKE_RUNNER_BIND_PLAN=1 FAKE_RUNNER_CASE="$case" FAKE_RUNNER_SEQUENCE='[{}]' FAKE_RUNNER_COUNT_FILE="$COUNT32" FAKE_RUNNER_ARGV_FILE="$TMP32/argv.json" fake_runner_env
  G_OUT="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov "$@" 2>"$TMP32/err.txt" </dev/null)"; G_RC=$?; G_ERR="$(cat "$TMP32/err.txt")"
  printf '%s\n%s\n' "$G_OUT" "$G_ERR" >> "$OUT32"
  [[ -n "${DEBUG32:-}" ]] && { echo "== $* (rc=$G_RC)"; echo "$G_OUT" | head -c 1800; echo "$G_ERR" | head -c 800; } >> "$DEBUG32"
}
plan32() { run32 "${1:-approved}" gate --gate plan-review-xprov --phase p32 --timeout 7; }
wave32() { run32 "${1:-approved}" gate --gate wave-inspect-xprov --phase p32 --wave 1 --base "$PHASE_HEAD" --timeout 7; }
pr32() { run32 "${1:-approved}" gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --timeout 7; }
f32() { json_get "$G_OUT" "$1"; }
sim32() { node "$SIM32" "$1" 2>/dev/null; }
# obs32 — all observation lines of the phase: the phase file and the review worktree file
obs32() { cat "$PHASE_DIR/observations.jsonl" "$PHASE_REPO/.a1-review/xreview/observations.jsonl" 2>/dev/null; }
sum32() { obs32 | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const l=t.split("\n").filter(Boolean).map(JSON.parse);process.stdout.write(l.reduce((a,x)=>a+(x.owner_handoffs||0),0)+"/"+l.reduce((a,x)=>a+(x.codex_runs||0),0)+"/"+l.length);});'; }
terminal32() { grep -Eci 'xprov permit|xprov waive|allowlist approve' "$OUT32" || true; }

scen_ph1() { # plan, wave and PR gates pass in a permitted repo: zero owner hand-offs, zero terminal commands, 3 Codex runs
  prep32; plan32; local a; a="$(f32 j.verdict)"
  commit32 src/more.js 'export const m = 1;'; wave32; local b; b="$(f32 j.verdict)"
  commit32 src/auth/login.js 'export const login = 1;'; pr32; local c; c="$(f32 j.verdict)"
  echo "$a/$b/$c|$(sum32)|terminal=$(terminal32)"
}
# stop32 — a PR gate run that stops on a secret in a changed line; sets SCAN32 (the scan record) and prints rc/reason
stop32() { commit32 src/auth/login.js "k = \"$EXK32\""; pr32; SCAN32="$(f32 j.scan_record)"; echo "$G_RC/$(f32 j.reason)"; }
# chat32 — the owner's chat Yes for the allowlist question of SCAN32, then `consent allowlist` writes the hit approvals; prints the question/approve exit codes
chat32() {
  local sim="{\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"allowlist\",\"phase\":\"p32\",\"scan\":\"$SCAN32\",\"tool_use\":\"toolu_c32\",\"session\":\"sess_c32\""
  run32 approved consent question --kind allowlist --scan "$SCAN32"; CHAT_Q32="$G_RC"
  sim32 "$sim,\"cmd\":\"ask\"}" >/dev/null
  sim32 "$sim,\"cmd\":\"answer\",\"mode\":\"yes\",\"text\":\"x\",\"template\":\"$TPL32/post-tool-use.answers.template.json\"}" >/dev/null
  run32 approved consent allowlist --scan "$SCAN32"; CHAT_A32="$G_RC"
}
store32() { node -p 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).approvals.length}catch(e){"none"}' "$STORE32/hit-approvals.json" 2>/dev/null; }
scen_ph2() { # a secret in a changed line: one CHAT allowlist question (counted as 1); the chat yes writes the approval; the NEXT run proceeds (SC-001 end to end)
  prep32; stop32 >"$TMP32/first.txt"; local first; first="$(cat "$TMP32/first.txt")"; chat32
  local recs; recs="$(store32)"
  pr32; local then="$G_RC/$(f32 j.verdict)"
  echo "$first|question=$CHAT_Q32|approve=$CHAT_A32|records=$recs|then=$then|$(sum32)|terminal=$(terminal32)"
}
# scen_hc <variant> — approve in the chat, then change one thing, then run again (covered hits proceed; anything else stops)
tamper32() { # <node expression on the store document d> — rewrites the fixture hit store in place, mode kept
  node -e 'const fs=require("fs");const f=process.argv[1];const m=fs.statSync(f).mode&0o777;const d=JSON.parse(fs.readFileSync(f,"utf8"));(function(d){eval(process.argv[2]);})(d);fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n",{mode:m});' "$STORE32/hit-approvals.json" "$1"
}
scen_hc() {
  prep32; stop32 >/dev/null; chat32
  case "$1" in
    same) ;;
    newhead) commit32 docs/note.md '# unrelated' ;;                                            # a new head, a new scan, the same blob
    blob) commit32 src/auth/login.js "k = \"$EXK32\" // changed" ;;                           # the blob changed
    path) commit32 src/auth/other.js "k = \"$EXK32\"" ;;                                     # a new hit in another path
    rule) tamper32 'd.approvals[0].rule="aws_secret_access_key"' ;;                           # another rule id
    repo) tamper32 'd.approvals[0].repo="/elsewhere/.git"' ;;                                 # another repository key
    audit) tamper32 'd.approvals[0].audit="'"$(printf '0%.0s' $(seq 1 64))"'"' ;;             # a broken audit link
    shape) tamper32 'd.approvals[0].extra=1' ;;                                              # a wrong record shape
    *) echo "bad variant"; return ;;
  esac
  pr32
  local dir; dir="$(f32 j.result_path)"; local rec=none; [[ -n "$dir" && -e "$(dirname "$dir")/a1-hit-approved.json" ]] && rec=recorded
  local leak=clean; [[ "$G_OUT$G_ERR" == *"$EXK32"* ]] && leak=LEAK
  echo "$G_RC/$(f32 j.verdict)/$(f32 j.reason)|listed=$(f32 '(j.approved_hits||[]).map((x) => x.path + ":" + x.rule + ":" + (x.audit.length)).join(",")')|$rec|$leak|handoffs$(sum32 | cut -d/ -f1)"
}
scen_ph3() { # the round cap on the PR target ends in a chat waiver for exactly this head: the merge check accepts it, a new head is blocked again
  prep32; commit32 src/auth/login.js 'export const login = 1;'
  pr32 revise; local g="$(f32 j.verdict)/$(f32 j.reason)"
  local sim="{\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"waiver\",\"phase\":\"p32\",\"work_path\":\"$PHASE_REPO\",\"tool_use\":\"toolu_ph3\",\"session\":\"sess_ph3\""
  run32 approved consent question --kind waiver --work-path "$PHASE_REPO"; local q="$G_RC/$(f32 j.listed)"
  sim32 "$sim,\"cmd\":\"ask\"}" >/dev/null
  sim32 "$sim,\"cmd\":\"answer\",\"mode\":\"yes\",\"text\":\"x\",\"template\":\"$TPL32/post-tool-use.answers.template.json\"}" >/dev/null
  run32 approved consent waive --work-path "$PHASE_REPO"; local w="$G_RC"
  run32 approved gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --merge-check; local m="$G_RC/$(f32 "j.covered_by.join(',')")"
  commit32 src/auth/more.js 'export const more = 1;'
  run32 approved gate --gate pr-diff-xprov --work-path "$PHASE_REPO" --merge-check; local n="$G_RC"
  echo "$g|ask=$q|waive=$w|check=$m|newhead=$n|terminal=$(terminal32)"
}

# ---------- SW: the sweep ----------
# state <name> — puts the repo into one of the no-permit states
state32() {
  case "$1" in
    absent) ;;                                                                  # never asked / headless (no chat): nothing recorded
    unanswered) run32 approved consent question --kind consent --phase p32 >/dev/null; sim32 "{\"cmd\":\"ask\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"consent\",\"phase\":\"p32\",\"tool_use\":\"toolu_sw\",\"session\":\"sess_sw\"}" >/dev/null ;;
    no) run32 approved consent question --kind consent --phase p32 >/dev/null
        sim32 "{\"cmd\":\"ask\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"consent\",\"phase\":\"p32\",\"tool_use\":\"toolu_sw\",\"session\":\"sess_sw\"}" >/dev/null
        sim32 "{\"cmd\":\"answer\",\"tree\":\"$TREE\",\"root\":\"$PHASE_REPO\",\"kind\":\"consent\",\"phase\":\"p32\",\"mode\":\"no\",\"text\":\"x\",\"tool_use\":\"toolu_sw\",\"session\":\"sess_sw\",\"template\":\"$TPL32/post-tool-use.answers.template.json\"}" >/dev/null
        run32 approved consent record --kind consent >/dev/null ;;
    offline) git -C "$PHASE_REPO" remote set-url origin "$TMP32/unreachable.git" ;;   # no permit and the remote cannot be reached
    changed) git -C "$PHASE_REPO" remote set-url origin "$TMP32/elsewhere.git" ;;  # a permit voided by an origin change
  esac
}
scen_sw() { # <state> — all three gates: verdicts, runner calls, snapshots, bytes written
  local st="$1" permit=none; [[ "$st" == changed ]] && permit=permit
  prep32 "$permit"; commit32 src/auth/login.js 'export const login = 1;'; state32 "$st"
  plan32; local a="$(f32 j.verdict)/$(f32 j.reason)"; wave32; local b="$(f32 j.verdict)/$(f32 j.reason)"; pr32; local c="$(f32 j.verdict)/$(f32 j.reason)"
  local snaps; snaps="$(ls "$STORE32/snapshots" 2>/dev/null | wc -l | tr -d ' ')"
  local wrote=none; [[ -e "$PHASE_REPO/.a1-review" || -e "$PHASE_DIR/xreview" || -e "$PHASE_DIR/observations.jsonl" ]] && wrote=wrote
  echo "$a|$b|$c|runs$(runs32)|snaps$snaps|$wrote"
}

casePH() {
  fresh32
  assert_eq "PH1 SC-001: plan, wave and PR gates pass; owner_handoffs 0, 3 Codex runs counted once, no terminal command named" "$(scen_ph1)" "pass/pass/pass|0/3/3|terminal=0"
  assert_eq "PH2 SC-001: a secret in a changed line is one CHAT hand-off; the chat approval is written and the NEXT run proceeds; no terminal command named" "$(scen_ph2)" "1/secret_in_snapshot|question=0|approve=0|records=1|then=0/pass|1/1/2|terminal=0"
  assert_eq "PH3 a failed PR review ends in a chat waiver for exactly this head; a new head is blocked again" "$(scen_ph3)" "fail-with-findings/null|ask=0/1|waive=0|check=0/waiver|newhead=1|terminal=0"
  redproof32 "PH1a" scen_ph1 "pass/pass/pass|0/3/3|terminal=0" xprov-gate.cjs "codexRuns: first ? 1 : 0" "codexRuns: 0"
  redproof32 "PH2a" scen_ph2 "1/secret_in_snapshot|question=0|approve=0|records=1|then=0/pass|1/1/2|terminal=0" xprov-gate.cjs "(Array.isArray(out.uncovered) && out.uncovered.length ? 1 : 0)" "0"
}
casePH
# ---------- HC: the reader of the chat hit approvals (FR-014 / FR-029, wave 12) ----------
caseHC() {
  local stop="1/fail/secret_in_snapshot|listed=|none|clean"
  local ok_="0/pass/null|listed=src/auth/login.js:aws_access_key_id:64|recorded|clean"
  assert_eq "HC1 an approved hit proceeds; the run lists path, rule id and the audit link (never the value) and writes the record" "$(scen_hc same | sed 's/|handoffs.*$//')" "$ok_"
  assert_eq "HC2 a new head with the same blob (a new scan) is covered" "$(scen_hc newhead | sed 's/|handoffs.*$//')" "$ok_"
  local v
  for v in blob path rule repo audit shape; do
    assert_eq "HC3 $v: not covered, the stop stands" "$(scen_hc $v | sed 's/|handoffs.*$//')" "$stop"
  done
  local HCN=xprov-hit-cover.cjs want="$ok_"
  redproof32 "HC1a" "scen_hc_same" "$ok_" $HCN "if (rec === null) return none;" "return none;"
  redproof32 "HC3a" "scen_hc_blob" "$stop" $HCN " && a.blob === blob" ""
  redproof32 "HC3b" "scen_hc_rule" "$stop" $HCN " && a.rule === hit.rule" ""
  redproof32 "HC3c" "scen_hc_path" "$stop" $HCN " && a.path === hit.path" ""
  redproof32 "HC3d" "scen_hc_repo" "$stop" $HCN "a.repo === repoKey && " ""
  redproof32 "HC3e" "scen_hc_audit" "$stop" $HCN ".state !== AU.STATE.OK) return none;" ".state === 'never') return none;"
}
scen_hc_same() { scen_hc same | sed 's/|handoffs.*$//'; }
scen_hc_blob() { scen_hc blob | sed 's/|handoffs.*$//'; }
scen_hc_rule() { scen_hc rule | sed 's/|handoffs.*$//'; }
scen_hc_path() { scen_hc path | sed 's/|handoffs.*$//'; }
scen_hc_repo() { scen_hc repo | sed 's/|handoffs.*$//'; }
scen_hc_audit() { scen_hc audit | sed 's/|handoffs.*$//'; }
caseHC

caseSW() {
  local s want="not_applicable/external_review_not_permitted"
  for s in absent unanswered offline changed; do
    assert_eq "SW $s: plan, wave and PR gate end not_applicable / external_review_not_permitted (SC-005); zero bytes: no runner call, no snapshot, nothing written (SC-004)" "$(scen_sw $s)" "$want|$want|$want|runs0|snaps0|none"
  done
  want="not_applicable/external_review_denied"
  assert_eq "SW no: after the owner's No every gate ends not_applicable / external_review_denied; zero bytes to Codex (the denial itself is logged)" "$(scen_sw no)" "$want|$want|$want|runs0|snaps0|wrote"
  want="not_applicable/external_review_not_permitted"
  redproof32 "SW1" scen_sw_absent "$want|$want|$want|runs0|snaps0|none" xprov-gate-nopermit.cjs "const NO_PERMIT_STATES = Object.freeze([STATES.ABSENT, STATES.ORIGIN_CHANGED, STATES.UNBOUND_LEGACY]);" "const NO_PERMIT_STATES = Object.freeze([]);"
  redproof32 "SW2" scen_sw_offline "$want|$want|$want|runs0|snaps0|none" xprov-gate.cjs "if (early.notApplicable) return" "if (false) return"
}
scen_sw_offline() { scen_sw offline; }
scen_sw_absent() { scen_sw absent; }
caseSW

# ---------- RS: the real owner store is untouched ----------
caseRS() {
  export HOME="$REAL_HOME_32"
  local after; after="$(snap32)"
  [[ "$after" == "$REAL_BEFORE_32" ]] && ok "RS the real ~/.a1-xprov has the same sha256 and mtime for every file before and after this part" || bad "RS the real owner store changed during part 32"
  export HOME="$TMP32/home"
}
caseRS
export HOME="$REAL_HOME_32"
