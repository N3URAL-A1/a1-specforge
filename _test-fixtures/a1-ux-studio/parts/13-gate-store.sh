# Part 13 — gate store, plugin hook, evidence and result guards (spec 024-ux-studio, PR review fix round; FR-009, FR-013, FR-014, FR-024).
#
# gate-record.json alone is not trusted: `run` writes a digest into a hash-chained store under the passwd home, handoff-check
# compares the record with it and wants a stored acceptance for every accepted item. The helpers hc_* come from part 06 (same
# shell); the gate runs from the tree copy with the fake owner home (run-tests.sh), so the store is $HOME/.a1-ux-studio of the suite.
# Each case header names the production change that turns it red. The pty cases SKIP under a Claude Code ancestor (CI=true: a FAIL).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

HOOK_SH="$REPO_ROOT/hooks/xprov-consent-hook.sh"
HC_STORE_CJS_FILE="$("$HC_NODE" -e 'console.log(require(process.argv[1]).storeFile())' "$HC_STORE_CJS")"   # the file the tree copy writes (fake home = suite HOME)

# ---------------------------------------------------------------- S1 forged pass record
# RED: delete the verifyRecord() call from checkHandoff() (handoff-check.cjs): the record is trusted again.
hc_make R low low-contrast.html
hc_edit "$R" '{...r,status:"pass",findings:[]}'
hc_hand --run-dir "$R"
hc_check "S1 pass record with the findings removed (hand-edited): exit 1 naming the recorded gate run (count 1) [FR-013]" "$HC_RC/$(hc_say 'does not match the recorded gate run')" "1/1"
hc_make R low low-contrast.html
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,severity:"advisory"}))}'
hc_hand --run-dir "$R"
hc_check "S1b finding demoted to advisory by hand: exit 1 [FR-013]" "$HC_RC/$(hc_say 'does not match the recorded gate run')" "1/1"
# S1c a record written by hand for a run folder the gate never ran in
hc_make R high high-contrast.html
HC_N=$((HC_N + 1)); F="$HC_ROOT/forged-$HC_N"; mkdir -p "$F/result" "$F/boards"
cp "$R/run.md" "$F/run.md"; cp "$R/boards/"*.html "$F/boards/"; cp "$R/result/result.html" "$F/result/"; hc_shots "$F"
"$HC_NODE" -e 'const fs=require("fs"),c=require("crypto");const d=fs.realpathSync(process.argv[1]);const t=d+"/result/result.html";fs.writeFileSync(d+"/gate-record.json",JSON.stringify({gate_id:"ux-studio-gate",impeccable_version:"4.8.1",scan_mode:"file",target:t,target_sha256:c.createHash("sha256").update(fs.readFileSync(t)).digest("hex"),exit_code:0,status:"pass",cause:null,findings:[],font_check:{status:"pass",failures:[]},created:new Date().toISOString()}))' "$F"
hc_hand --run-dir "$F"
hc_check "S1c hand-written pass record, no gate run in the store: exit 1 'no gate run is recorded' (count 1) [FR-013]" "$HC_RC/$(hc_say 'no gate run is recorded')" "1/1"

# ---------------------------------------------------------------- S2 forged acceptance
# RED: delete the acceptedItems() check in verifyRecord() (gate-store.cjs): an accepted state is believed without a stored line.
hc_make R low low-contrast.html
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"I accept this myself"}))}'
hc_hand --run-dir "$R"
hc_check "S2 accepted by hand, no store line: exit 1, 1 blocker naming finding low-contrast-1 [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'acceptance of finding low-contrast-1 has no entry in the gate store')" "1/1/1"
# S2b the stored reason must be the recorded one
hc_seed "$R" low-contrast-1 "Robert: another reason"
hc_hand --run-dir "$R"
hc_check "S2b stored reason differs from the recorded reason: exit 1 [FR-013]" "$HC_RC/$(hc_say 'has no entry in the gate store')" "1/1"
hc_seed "$R" low-contrast-1 "I accept this myself"
hc_hand --run-dir "$R"
hc_check "S2c control: a stored line with the same reason: exit 0 [FR-013]" "$HC_RC/$HC_BLOCKS" "0/0"
# S2d font failure accepted by hand
hc_make R high "$HC_ROOT/variants/two-fonts.html"
hc_edit "$R" '{...r,font_check:{...r.font_check,failures:r.font_check.failures.map(x=>({...x,state:"accepted",reason_text:"mine"}))}}'
hc_hand --run-dir "$R"
hc_check "S2d font failures accepted by hand: exit 1, 2 blocker lines naming Lora and Comic Neue [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'acceptance of font failure Lora')/$(hc_say 'acceptance of font failure Comic Neue')" "1/2/1/1"
# S2e a stored acceptance of an OLDER run does not carry over to a new run
hc_make R low low-contrast.html
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"Robert: ok"}))}'
hc_seed "$R" low-contrast-1 "Robert: ok"
hc_hand --run-dir "$R"
hc_check "S2e precondition: stored acceptance allows handoff [FR-013]" "$HC_RC" "0"
hc_gate "$R" low
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"Robert: ok"}))}'
hc_hand --run-dir "$R"
hc_check "S2e after a new gate run the old stored line does not count: exit 1 [FR-013]" "$HC_RC/$(hc_say 'has no entry in the gate store')" "1/1"

# ---------------------------------------------------------------- S3 store integrity (own HOME per case group)
# RED: drop the `o.prev !== prev` chain test in readChain() (gate-store.cjs), or the mode / symlink checks in checkDir().
S3_HOME_OLD="$HOME"
s3_home() { mk_workdir S3H ux-s3home; HOME="$S3H"; export HOME; }
s3_store() { echo "$HOME/.a1-ux-studio/gate-store.jsonl"; }
# s3_tamper <js over lines[] returning the new text>
s3_tamper() { "$HC_NODE" -e 'const fs=require("fs");const f=process.argv[1];const lines=fs.readFileSync(f,"utf8").split("\n").filter(Boolean);fs.writeFileSync(f,new Function("lines","return ("+process.argv[2]+")")(lines))' "$(s3_store)" "$1"; }
s3_accepted_run() { # leaves a run + accept line in the store of the current HOME
  hc_make R low low-contrast.html
  hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"Robert: ok"}))}'
  hc_seed "$R" low-contrast-1 "Robert: ok"
}
s3_home; s3_accepted_run
hc_hand --run-dir "$R"
hc_check "S3 precondition: run line + accept line, chain intact: exit 0, store has 2 lines (count 2) [FR-013]" "$HC_RC/$(wc -l < "$(s3_store)" | tr -d ' ')" "0/2"
hc_check "S3 store file mode 600 and directory mode 700 [FR-013]" "$("$HC_NODE" -e 'const fs=require("fs");const m=(p)=>(fs.statSync(p).mode&0o777).toString(8);console.log(m(process.argv[1]+"/.a1-ux-studio")+"/"+m(process.argv[1]+"/.a1-ux-studio/gate-store.jsonl"))' "$HOME")" "700/600"
s3_tamper 'lines.map((l,i)=>i===0?l.replace(/"digest":"(.)/,(m,c)=>"\"digest\":\""+(c==="0"?"1":"0")):l).join("\n")+"\n"'
hc_hand --run-dir "$R"
hc_check "S3b first store line edited: the next line no longer chains, exit 1 naming the chain (count 1) [FR-013]" "$HC_RC/$(hc_say 'does not chain')" "1/1"
# RED (S3b recovery text): drop the RECOVERY sentence from StoreError (gate-store.cjs): the blocker no longer tells the agent to ask the owner.
hc_check "S3b2 the damaged-chain blocker says 'ask the owner, do not delete the store' (count 1) [FR-013]" "$(hc_say 'Ask the owner; do not delete the store')" "1"
s3_home; s3_accepted_run
s3_tamper 'lines.join("\n")+"\n"+lines[1].replace(/"prev":"[0-9a-f]+"/,"\"prev\":\""+"0".repeat(64)+"\"")+"\n"'
hc_hand --run-dir "$R"
hc_check "S3c appended line with a wrong prev: exit 1 [FR-013]" "$HC_RC/$(hc_say 'does not chain')" "1/1"
s3_home; s3_accepted_run
s3_tamper 'lines.join("\n")'
hc_hand --run-dir "$R"
hc_check "S3d truncated (no final newline): exit 1 'incomplete' [FR-013]" "$HC_RC/$(hc_say 'incomplete')" "1/1"
s3_home; s3_accepted_run
s3_tamper 'lines.slice(0,1).join("\n")+"\n"'
hc_hand --run-dir "$R"
hc_check "S3e accept line dropped from the store: exit 1 (record says accepted, no stored line) [FR-013]" "$HC_RC/$(hc_say 'has no entry in the gate store')" "1/1"
s3_home; s3_accepted_run
chmod 775 "$HOME/.a1-ux-studio"
hc_hand --run-dir "$R"; rc_dir=$HC_RC; say_dir="$(hc_say 'group- or world-writable')"
hc_gate "$R" low
hc_check "S3f store directory group-writable: handoff exit 1 naming it; a new gate run refuses (exit 3) [FR-013]" "$rc_dir/$say_dir/$HC_GRC" "1/1/3"
chmod 700 "$HOME/.a1-ux-studio"; chmod 664 "$(s3_store)"
hc_hand --run-dir "$R"
hc_check "S3g store file group-writable: exit 1 [FR-013]" "$HC_RC/$(hc_say 'group- or world-writable')" "1/1"
s3_home; s3_accepted_run
mv "$HOME/.a1-ux-studio" "$HOME/real-store"; ln -s "$HOME/real-store" "$HOME/.a1-ux-studio"
hc_hand --run-dir "$R"; rc_link=$HC_RC; say_link="$(hc_say 'symlink')"
hc_gate "$R" low
hc_check "S3h store directory is a symlink: handoff exit 1, a new gate run refuses (exit 3) [FR-013]" "$rc_link/$say_link/$HC_GRC" "1/1/3"
s3_home; s3_accepted_run
mv "$(s3_store)" "$HOME/elsewhere.jsonl"; ln -s "$HOME/elsewhere.jsonl" "$(s3_store)"
hc_hand --run-dir "$R"
hc_check "S3i store file is a symlink: exit 1 [FR-013]" "$HC_RC/$(hc_say 'symlink')" "1/1"
HOME="$S3_HOME_OLD"; export HOME

# ---------------------------------------------------------------- S4 digest evidence written by `run`
# RED: skip recordRun() in cmdRun() (ux-gate.cjs).
hc_make R low low-contrast.html
S4_OUT="$("$HC_NODE" -e 'const s=require(process.argv[1]);const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[2]+"/gate-record.json","utf8"));const c=s.readChain(false);const run=c.entries.filter(e=>e.kind==="run"&&e.run_dir===fs.realpathSync(process.argv[2])).pop();console.log((run&&run.digest===s.runDigest(r)&&run.target_sha256===r.target_sha256)?"match":"none")' "$HC_STORE_CJS" "$R")"
hc_check "S4 gate run wrote a store line whose digest and target sha equal the record's [FR-013]" "$S4_OUT" "match"
hc_check "S4 the digest is not a field of the record (record keys unchanged, count 0) [FR-013]" "$(hc_j "$R/gate-record.json" 'Object.keys(r).filter(k=>/digest|store/.test(k)).length')" "0"
hc_check "S4 the real store module resolves under the passwd home (count 1) [FR-013]" "$("$HC_NODE" -e 'const os=require("os");const s=require(process.argv[1]);console.log(s.storeDir()===os.userInfo().homedir+"/.a1-ux-studio"?1:0)' "$REPO_ROOT/skills/a1-ux-studio/scripts/gate/gate-store.cjs")" "1"

# ---------------------------------------------------------------- S5 real accept through the terminal path
# RED: drop recordAccept() from cmdAccept() (ux-gate.cjs): the accepted record has no stored line and handoff blocks.
s5_pty() { # <run-dir> <finding> <reason> ; sets S5_RC, S5_OUT
  HC_N=$((HC_N + 1)); S5_OUT="$HC_ROOT/s5-out-$HC_N"; : > "$S5_OUT"
  if [[ "$HC_UNDER_CLAUDE" == "1" ]]; then HC_SKIP=1; S5_RC=-1; return 0; fi
  HC_SKIP=0
  run_bounded 90 "$HC_ROOT/s5-st-$HC_N" "$HC_ROOT/s5-er-$HC_N" -- "${HC_NOCLAUDE[@]}" python3 -I "$HC_ROOT/pty-run.py" "$S5_OUT" "$HC_NODE" "$HC_GATE" accept --run-dir "$1" --finding "$2" --reason "$3"
  S5_RC=$?
}
hc_make R low low-contrast.html
s5_pty "$R" low-contrast-1 "Robert: reviewed at the terminal"
if [[ "$HC_SKIP" == "0" ]]; then hc_hand --run-dir "$R"; else HC_RC=-1; HC_BLOCKS=-1; fi
hc_check "S5 accept on a real pty writes the store line; handoff-check then exits 0 [FR-013]" "$S5_RC/$HC_RC/$HC_BLOCKS" "0/0/0"
hc_check "S5 the store holds exactly one accept line for low-contrast-1 of this run (count 1) [FR-013]" "$(grep -c "\"kind\":\"accept\".*\"run_dir\":\"$R\".*\"finding\":\"low-contrast-1\"" "$UX_STORE_DIR/gate-store.jsonl" || true)" "1"
HC_SKIP=0
# S5b accept refuses a record that does not match the recorded gate run, and writes nothing
hc_make R low low-contrast.html
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,rule:"forged-rule"}))}'
before="$(wc -l < "$UX_STORE_DIR/gate-store.jsonl" | tr -d ' ')"
s5_pty "$R" low-contrast-1 "Robert: reviewed"
hc_check "S5b accept on a forged record: exit 2, 'does not match' printed (count 1), store line count unchanged [FR-013]" "$S5_RC/$(grep -c 'does not match the recorded gate run' "$S5_OUT" || true)/$(( $(wc -l < "$UX_STORE_DIR/gate-store.jsonl" | tr -d ' ') - before ))" "2/1/0"
HC_SKIP=0

# ---------------------------------------------------------------- S6 plugin hook
# RED: drop the gate-record.json / .a1-ux-studio guard from guardedPath() (xprov-hook-paths.cjs).
hook_decision() { # <tool> <file> -> deny|allow
  local out
  out="$(printf '{"hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s","content":"x","old_string":"a","new_string":"b","edits":[{"old_string":"a","new_string":"b"}]},"cwd":"/tmp"}' "$1" "$2" | env -u A1_VAULT_ROOT bash "$HOOK_SH" 2>/dev/null)"
  case "$out" in *'"permissionDecision":"deny"'*) echo deny ;; '') echo allow ;; *) echo "other:$out" ;; esac
}
PASSWD_HOME="$("$HC_NODE" -e 'console.log(require("os").userInfo().homedir)')"
hc_check "S6 Write of a gate-record.json in a run folder: denied [FR-013]" "$(hook_decision Write "$R/gate-record.json")" "deny"
hc_check "S6 Edit of gate-record.json: denied [FR-013]" "$(hook_decision Edit "$R/gate-record.json")" "deny"
hc_check "S6 MultiEdit of gate-record.json in any other directory: denied [FR-013]" "$(hook_decision MultiEdit "/srv/x/a/gate-record.json")" "deny"
hc_check "S6 upper-case spelling of the file name: denied (APFS is case-insensitive) [FR-013]" "$(hook_decision Write "$R/Gate-Record.JSON")" "deny"
hc_check "S6 Write into the gate store of the passwd home: denied [FR-013]" "$(hook_decision Write "$PASSWD_HOME/.a1-ux-studio/gate-store.jsonl")" "deny"
hc_check "S6 Write into the gate store under \$HOME: denied [FR-013]" "$(hook_decision Write "$HOME/.a1-ux-studio/gate-store.jsonl")" "deny"
hc_check "S6 Write into a not yet existing store subfolder: denied [FR-013]" "$(hook_decision Write "$HOME/.a1-ux-studio/new/x.jsonl")" "deny"
hc_check "S6 the denied path is the one the store module uses (drift guard) [FR-013]" "$(hook_decision Write "$HC_STORE_CJS_FILE")" "deny"
hc_check "S6 control: Write of run.md in the same run folder: allowed [FR-013]" "$(hook_decision Write "$R/run.md")" "allow"
hc_check "S6 control: Write of a file whose name only contains gate-record: allowed [FR-013]" "$(hook_decision Write "$R/my-gate-record.json.txt")" "allow"
hc_check "S6 deny text for gate-record.json names the gate, not xprov consent (count 1) [FR-013]" "$(printf '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"%s","content":"x"},"cwd":"/tmp"}' "$R/gate-record.json" | bash "$HOOK_SH" 2>/dev/null | grep -c 'ux-gate.cjs')" "1"

# ---------------------------------------------------------------- S7 screenshot width (PNG IHDR)
# RED: delete the width comparison in checkScreenshots() (handoff-check.cjs): any PNG counts at any width.
s7_swap() { # <run-dir> <shot-name> <png-width>
  cp "$HC_ROOT/png/w$3.png" "$1/screenshots/$2.png"
}
hc_make R high high-contrast.html
s7_swap "$R" result-1280 390
hc_hand --run-dir "$R"
hc_check "S7 result-1280.png is 390 px wide: exit 1, 1 blocker naming file and width (count 1) [FR-014]" "$HC_RC/$HC_BLOCKS/$(hc_say 'screenshots/result-1280.png is 390 px wide')" "1/1/1"
hc_make R high high-contrast.html
s7_swap "$R" diverge-390 1280
hc_hand --run-dir "$R"
hc_check "S7b diverge-390.png is 1280 px wide: exit 1 naming it [FR-014]" "$HC_RC/$HC_BLOCKS/$(hc_say 'screenshots/diverge-390.png is 1280 px wide')" "1/1/1"
hc_make R high high-contrast.html
s7_swap "$R" converge-1280 777
hc_hand --run-dir "$R"
hc_check "S7c converge-1280.png is 777 px wide: exit 1 [FR-014]" "$HC_RC/$(hc_say 'screenshots/converge-1280.png is 777 px wide')" "1/1"
hc_make R high high-contrast.html
for n in result diverge converge; do s7_swap "$R" "$n-1280" 2560; s7_swap "$R" "$n-390" 780; done
hc_hand --run-dir "$R"
hc_check "S7d deviceScaleFactor 2 (2560 / 780 px wide): exit 0, 0 blockers [FR-014]" "$HC_RC/$HC_BLOCKS" "0/0"
hc_make R high high-contrast.html
s7_swap "$R" result-390 780; s7_swap "$R" result-1280 1280
hc_hand --run-dir "$R"
hc_check "S7e mixed 1x and 2x shots: exit 0 [FR-014]" "$HC_RC/$HC_BLOCKS" "0/0"
hc_make R high high-contrast.html
printf '\x89PNG\r\n\x1a\nIHDR-truncated' > "$R/screenshots/result-1280.png"
hc_hand --run-dir "$R"
hc_check "S7f PNG with a truncated header: exit 1 (fail closed) [FR-014]" "$HC_RC/$HC_BLOCKS" "1/1"

# ---------------------------------------------------------------- S8 taste vault in the result (FR-024)
# RED: drop the vault rule from cmdRun() (ux-gate.cjs) or the sha256 / data: scan in board-guard.cjs.
S8_PNG="$HC_FIX/screenshot.png"
mk_workdir S8V ux-s8-vault; mkdir -p "$S8V/pattern/taste-vault/g"; cp "$S8_PNG" "$S8V/pattern/taste-vault/g/shot.png"
s8_run() { # <vault root or ''> <run-dir>   sets S8_RC S8_ERR
  HC_N=$((HC_N + 1)); S8_ERR="$HC_ROOT/s8-err-$HC_N"
  run_bounded 60 "$HC_ROOT/s8-out-$HC_N" "$S8_ERR" -- env ${1:+A1_VAULT_ROOT="$1"} STUB_MODE=high STUB_FIX="$HC_GFIX" PATH="$HC_STUBDIR:$PATH" "$HC_NODE" "$HC_GATE" run --run-dir "$2" --target "$2/result/result.html"
  S8_RC=$?
}
s8_dir() { HC_N=$((HC_N + 1)); S8_D="$HC_ROOT/s8-run-$HC_N"; mkdir -p "$S8_D/result"; printf '# run\n\n<!-- gate-record:start -->\n<!-- gate-record:end -->\n' > "$S8_D/run.md"; cp "$HC_GFIX/high-contrast.html" "$S8_D/result/result.html"; }
s8_dir
s8_run "" "$S8_D"
hc_check "S8 control: clean result, no vault: gate exit 0 [FR-024]" "$S8_RC" "0"
s8_dir; sed 's#<body>#<body><img src="../../../pattern/taste-vault/g/shot.png">#' "$HC_GFIX/high-contrast.html" > "$S8_D/result/result.html"
s8_run "" "$S8_D"
hc_check "S8b result names a pattern/taste-vault path: exit 2, 'taste-vault' on stderr (count 1), no record [FR-024]" "$S8_RC/$(grep -c 'taste-vault' "$S8_ERR")/$(ls "$S8_D" | grep -c '^gate-record.json$' || true)" "2/1/0"
s8_dir; sed 's|<body>|<body><img src="pattern\&#x2F;taste-vault/g/shot.png">|' "$HC_GFIX/high-contrast.html" > "$S8_D/result/result.html"
s8_run "" "$S8_D"
hc_check "S8c the same path hidden behind a character reference: exit 2 [FR-024]" "$S8_RC" "2"
s8_dir; cp "$S8_PNG" "$S8_D/result/hero.png"
s8_run "$S8V" "$S8_D"
hc_check "S8d result/ holds a byte copy of a vault PNG (vault present): exit 2, file named (count 1), no record [FR-024]" "$S8_RC/$(grep -c 'hero.png' "$S8_ERR")/$(ls "$S8_D" | grep -c '^gate-record.json$' || true)" "2/1/0"
s8_dir; mkdir -p "$S8_D/result/img/deep"; cp "$S8_PNG" "$S8_D/result/img/deep/renamed.bin.png"
s8_run "$S8V" "$S8_D"
hc_check "S8e the copy in a subfolder under another name: exit 2 [FR-024]" "$S8_RC" "2"
s8_dir; B64="$(base64 < "$S8_PNG" | tr -d '\n')"; sed "s#<body>#<body><img src=\"data:image/png;base64,$B64\">#" "$HC_GFIX/high-contrast.html" > "$S8_D/result/result.html"
s8_run "$S8V" "$S8_D"
hc_check "S8f the vault PNG inlined as a data: URI: exit 2 [FR-024]" "$S8_RC" "2"
s8_dir; cp "$HC_ROOT/png/w390.png" "$S8_D/result/own.png"
s8_run "$S8V" "$S8_D"
hc_check "S8g control: a different PNG in result/, vault present: gate exit 0 [FR-024]" "$S8_RC" "0"

# ---------------------------------------------------------------- S9 board-check shares the font rules (local(), file name vs family id)
# RED: as G6l / G6m, in font-check.cjs (boards.cjs fontProblems() calls the same checkFonts()).
new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
cp "$B_RUN/boards/fonts/inter/inter-latin-400-normal.woff2" "$B_RUN/boards/fonts/lora/inter-latin-700-normal.woff2"
sed 's#fonts/lora/lora-latin-700-normal.woff2#fonts/lora/inter-latin-700-normal.woff2#' "$B_FX/diverge.html" > "$B_RUN/boards/diverge.html"
bx board-check --run-dir "$B_RUN" --kind diverge
hc_check "S9 board: Lora face whose file is inter-*.woff2 (copy in fonts/lora/): exit 1, 'font check: Lora (font_file_mismatch)' (count 1) [FR-009]" "$RC/$(printf '%s\n' "$ERR" | grep -c 'font check: Lora (font_file_mismatch)')" "1/1"
new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
sed 's#<style>#<style>@font-face{font-family:"Inter";src:local("Inter")}#' "$B_FX/diverge.html" > "$B_RUN/boards/diverge.html"
bx board-check --run-dir "$B_RUN" --kind diverge
hc_check "S9b board: @font-face src local(): exit 1, 'font check: Inter (local_src)' (count 1) [FR-009]" "$RC/$(printf '%s\n' "$ERR" | grep -c 'font check: Inter (local_src)')" "1/1"
new_run; put_board diverge "$B_FX/diverge.html" "${DIV_FAMS[@]}"
bx board-check --run-dir "$B_RUN" --kind diverge
hc_check "S9c control: the real diverge board with shipped fonts still passes [FR-009]" "$RC" "0"

# ---------------------------------------------------------------- S10 store function refuses a script; vault rule at handoff; hook text
HC_SKIP=0
# RED: delete the acceptGuard.terminalProblem() check at the top of recordAccept() (gate-store.cjs): the call below writes a line.
# The module runs from a second tree copy (fake owner home, REAL guard) so that even the red run writes into the suite home, never the real one.
mk_workdir S10T ux-s10-tree; mkdir -p "$S10T/skills" "$S10T/_shared"
cp -R "$REPO_ROOT/skills/a1-ux-studio" "$S10T/skills/a1-ux-studio"; cp -R "$REPO_ROOT/_shared/lib" "$S10T/_shared/lib"
cp "$HERE/fake/xprov-owner-home.cjs" "$S10T/_shared/lib/xprov-owner-home.cjs"
S10_STORE_MOD="$S10T/skills/a1-ux-studio/scripts/gate/gate-store.cjs"
S10_REC="$HC_ROOT/s10-rec"; mkdir -p "$S10_REC"; printf '{"target_sha256":"%064d"}' 0 > "$S10_REC/gate-record.json"
S10_STORE_FILE="$("$HC_NODE" -e 'console.log(require(process.argv[1]).storeFile())' "$S10_STORE_MOD")"
s10_state() { stat -c '%s/%Y' "$S10_STORE_FILE" 2>/dev/null || echo none; }
S10_BEFORE="$(s10_state)"; S10_OUT="$HC_ROOT/s10-out"; S10_RC=0
"${HC_NOCLAUDE[@]}" "$HC_NODE" -e 'const s=require(process.argv[1]);const r=JSON.parse(require("fs").readFileSync(process.argv[2]+"/gate-record.json","utf8"));s.recordAccept(process.argv[2],r,"low-contrast-1","I accept this myself")' "$S10_STORE_MOD" "$S10_REC" < /dev/null > "$S10_OUT" 2>&1 || S10_RC=$?
hc_check "S10 recordAccept called from a script (store module with the real guard, no terminal): exits non-zero, names the real terminal, writes nothing [FR-013]" "$([[ $S10_RC -ne 0 ]] && echo threw || echo wrote)/$([[ "$(grep -c 'real terminal' "$S10_OUT" || true)" -ge 1 ]] && echo named || echo silent)/$([[ "$(s10_state)" == "$S10_BEFORE" ]] && echo same || echo changed)" "threw/named/same"

# RED (S10b): delete the checkVaultRule() call from checkHandoff() (handoff-check.cjs): a vault PNG copied in after the passing run is not noticed.
hc_make R high high-contrast.html
hc_hand --run-dir "$R"
hc_check "S10b control: clean passing run, handoff allowed [FR-024]" "$HC_RC/$HC_BLOCKS" "0/0"
cp "$S8_PNG" "$R/result/copied.png"
A1_VAULT_ROOT="$S8V" hc_hand --run-dir "$R"
hc_check "S10b vault PNG copied into result/ after the run: handoff exit 1, 1 blocker naming the taste vault (count 1) [FR-024]" "$HC_RC/$HC_BLOCKS/$(hc_say 'is a byte copy of a taste-vault image')" "1/1/1"
hc_hand --run-dir "$R"
hc_check "S10b control: same folder, no vault in the environment: handoff allowed [FR-024]" "$HC_RC" "0"

# RED (S10c): drop the global-deny sentence from hooks/hooks.json description.
hc_check "S10c hook description states that the gate-record.json deny is global (count 1) [FR-013]" "$(grep -c 'the gate-record.json deny is global' "$REPO_ROOT/hooks/hooks.json" || true)" "1"
