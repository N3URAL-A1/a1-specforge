# Part 06 — gate workflow handoff block (spec 024-ux-studio, FR-013, FR-014).
#
# Drives the real skills/a1-ux-studio/scripts/gate/ux-gate.cjs `handoff-check`. Gate records come from
# the real `run` against a PATH-first npx stub replaying the CAPTURED detector output (fixtures/gate/);
# handoff-check always runs with a PATH that has no playwright-cli. `accept` is TTY-only, so the cases
# that need an accepted state edit one record field with node (the exact field accept writes); the real
# accept flow runs on a pty where Claude Code is not an ancestor (else SKIP; CI=true: SKIP is a FAIL).
# Each header names the single production line whose change turns the case red (contract item 4).
# handoff-check.cjs lines are named by function; the RED runs are quoted in the wave report.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

HC_GATE="$REPO_ROOT/skills/a1-ux-studio/scripts/gate/ux-gate.cjs"
HC_FIX="$HERE/fixtures/handoff"
HC_GFIX="$HERE/fixtures/gate"
HC_BFIX="$HERE/fixtures/boards"
HC_NODE="$(command -v node)"
mk_workdir HC_ROOT ux-handoff
HC_STUBDIR="$HC_ROOT/stub"; mkdir -p "$HC_STUBDIR"
HC_NODEONLY="$HC_ROOT/nodeonly"; mkdir -p "$HC_NODEONLY"; ln -s "$HC_NODE" "$HC_NODEONLY/node"
HC_N=0

cat > "$HC_STUBDIR/npx" <<'STUB'
#!/usr/bin/env bash
# Test stub for npx (never touches the network). STUB_MODE picks the replay of captured output.
case "${STUB_MODE:-}" in
  low)      cat "$STUB_FIX/impeccable-4.8.1-low.json"; exit "$(cat "$STUB_FIX/impeccable-4.8.1-low.exit")" ;;
  high)     cat "$STUB_FIX/impeccable-4.8.1-high.json"; exit "$(cat "$STUB_FIX/impeccable-4.8.1-high.exit")" ;;
  advisory) cat "$STUB_FIX/impeccable-4.8.1-advisory.json"; exit "$(cat "$STUB_FIX/impeccable-4.8.1-advisory.exit")" ;;
  exit1)    echo "boom" >&2; exit 1 ;;
  *)        echo "stub: STUB_MODE unset" >&2; exit 99 ;;
esac
STUB
chmod +x "$HC_STUBDIR/npx"

# Real pty driver for accept (same shape as parts/03-gate.sh; python3 pty.fork).
cat > "$HC_ROOT/pty-run.py" <<'PYE'
import os, pty, select, signal, sys, time
out = sys.argv[1]
argv = sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
chunks = []
deadline = time.time() + 60
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 1)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)
open(out, 'wb').write(b''.join(chunks))
status = None
grace = time.time() + 20
while time.time() < grace:
    done, st = os.waitpid(pid, os.WNOHANG)
    if done:
        status = st
        break
    time.sleep(0.05)
if status is None:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    sys.exit(124)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 126)
PYE

HC_NOCLAUDE=(env)
for v in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do HC_NOCLAUDE+=(-u "$v"); done
if "${HC_NOCLAUDE[@]}" "$HC_NODE" -e 'process.exit(require(process.argv[1]).claudeContextRefusal({}) === null ? 0 : 1)' "$REPO_ROOT/_shared/lib/xprov-approve.cjs"; then HC_UNDER_CLAUDE=0; else HC_UNDER_CLAUDE=1; fi
HC_SKIP=0

hc_skip() {
  if [[ "${CI:-}" == "true" ]]; then bad "$1: SKIP (claude-code ancestor) is not allowed when CI=true"
  else results+=("SKIP (claude-code ancestor)  $1"); fi
}
# hc_check <name> <got> <want>  (name carries its [FR-nnn] tag)
hc_check() { if [[ "$HC_SKIP" == "1" ]]; then hc_skip "$1"; elif [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }
hc_j() { "$HC_NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String('"$2"'))' "$1" 2>/dev/null || true; }
# hc_edit <rundir> <js body over r, returning the new record>
hc_edit() { "$HC_NODE" -e 'const fs=require("fs");const f=process.argv[1]+"/gate-record.json";const r=JSON.parse(fs.readFileSync(f,"utf8"));const n=new Function("r","return ("+process.argv[2]+")")(r);fs.writeFileSync(f,JSON.stringify(n,null,2))' "$1" "$2"; }

# hc_gate <rundir> <stub-mode> — real `run` on result/result.html.
hc_gate() {
  HC_N=$((HC_N + 1))
  run_bounded 60 "$HC_ROOT/g-out-$HC_N" "$HC_ROOT/g-err-$HC_N" -- env STUB_MODE="$2" STUB_FIX="$HC_GFIX" PATH="$HC_STUBDIR:$PATH" "$HC_NODE" "$HC_GATE" run --run-dir "$1" --target "$1/result/result.html"
  HC_GRC=$?
}
# hc_shots <rundir> — stand-in screenshots for every board and the result at both widths.
hc_shots() {
  mkdir -p "$1/screenshots"
  local s w
  for s in diverge converge result; do for w in 1280 390; do cp "$HC_FIX/screenshot.png" "$1/screenshots/$s-$w.png"; done; done
}
# hc_make <var> <stub-mode> <html-fixture> — run folder, two boards, gated result, full evidence.
hc_make() {
  HC_N=$((HC_N + 1))
  local d="$HC_ROOT/run-$HC_N"
  mkdir -p "$d/result" "$d/boards"
  printf '# run\n\n## Brief\nx\n\n<!-- gate-record:start -->\n<!-- gate-record:end -->\n\n## Picks\n' > "$d/run.md"
  cp "$HC_BFIX/diverge.html" "$HC_BFIX/converge.html" "$d/boards/"
  cp "$HC_GFIX/$3" "$d/result/result.html"
  hc_gate "$d" "$2"
  hc_shots "$d"
  eval "$1=\$d"
}
# hc_check_run <rundir|args...> — handoff-check with a PATH that has NO playwright-cli; sets HC_RC HC_OUT HC_ERR HC_BLOCKS.
hc_hand() {
  HC_N=$((HC_N + 1)); HC_OUT="$HC_ROOT/h-out-$HC_N"; HC_ERR="$HC_ROOT/h-err-$HC_N"
  run_bounded 60 "$HC_OUT" "$HC_ERR" -- env PATH="$HC_NODEONLY" "$HC_NODE" "$HC_GATE" handoff-check "$@"
  HC_RC=$?
  HC_BLOCKS="$(grep -c '^blocked: ' "$HC_OUT" || true)"
}
# hc_say <pattern> — count of output lines matching a fixed string.
hc_say() { grep -cF -- "$1" "$HC_OUT" || true; }

# ---------------------------------------------------------------- H0 control
# RED: make checkHandoff always push a blocker (handoff-check.cjs, checkHandoff return).
hc_make R high high-contrast.html
hc_hand --run-dir "$R"
hc_check "H0 clean pass record + full evidence: exit 0 and 0 blocker lines [FR-013]" "$HC_RC/$HC_BLOCKS" "0/0"
hc_check "H0 clean run prints 'handoff allowed' (count 1) [FR-013]" "$(hc_say 'handoff allowed')" "1"

# ---------------------------------------------------------------- H1 open primary finding
# RED: checkFindings returns [] (handoff-check.cjs) — an open primary finding stops blocking.
hc_make R low low-contrast.html
hc_hand --run-dir "$R"
hc_check "H1 open primary finding: exit 1, exactly 1 blocker line [FR-013]" "$HC_RC/$HC_BLOCKS" "1/1"
hc_check "H1 blocker names finding low-contrast-1 and its rule (count 1) [FR-013]" "$(hc_say 'open: finding low-contrast-1 (low-contrast @ low-contrast.html:0)')" "1"

# H1b accepted finding unblocks. RED: checkItem treats every state as open (handoff-check.cjs, the `state === 'accepted'` line).
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"Robert: brand colour, contrast reviewed"}))}'
hc_hand --run-dir "$R"
hc_check "H1b every open finding accepted with a reason: exit 0, 0 blocker lines [FR-013]" "$HC_RC/$HC_BLOCKS" "0/0"
# accepted without a reason, and an unknown state, still block (fail closed)
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"  "}))}'
hc_hand --run-dir "$R"
hc_check "H1c accepted finding with a blank reason: exit 1, 1 blocker line [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'accepted without a reason')" "1/1/1"
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"fixed",reason:null}))}'
hc_hand --run-dir "$R"
hc_check "H1d state 'fixed' (nothing legitimate writes it): exit 1 [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'unknown state')" "1/1/1"

# H1e each finding judged individually. RED: checkFindings stops after the first finding (e.g. .slice(0,1)).
hc_edit "$R" '{...r,findings:[{...r.findings[0],state:"accepted",reason:"ok"},{...r.findings[0],id:"low-contrast-2",location:"low-contrast.html:9",state:"open",reason:null}]}'
hc_hand --run-dir "$R"
hc_check "H1e two findings, one accepted: exit 1, only low-contrast-2 named (blockers 1, hits 1) [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'low-contrast-2')" "1/1/1"

# ---------------------------------------------------------------- H2 open font failure
# RED: checkFonts ignores rec.font_check.failures (handoff-check.cjs, the flatMap in checkFonts).
hc_make R high high-contrast.html
hc_edit "$R" '{...r,font_check:{status:"fail",failures:[{font:"Lora",reason:"remote_url",state:"open"},{font:"Comic Neue",reason:"not_allowlisted",state:"open"}]}}'
hc_hand --run-dir "$R"
hc_check "H2 two open font failures: exit 1, 2 blocker lines [FR-013]" "$HC_RC/$HC_BLOCKS" "1/2"
hc_check "H2 each font named (Lora 1, Comic Neue 1) [FR-013]" "$(hc_say 'font failure Lora')/$(hc_say 'font failure Comic Neue')" "1/1"
# H2b one accepted, the other still blocks. RED: same line; an `every`-style shortcut turns it red.
hc_edit "$R" '{...r,font_check:{...r.font_check,failures:r.font_check.failures.map(x=>x.font==="Lora"?{...x,state:"accepted",reason_text:"Robert: self-hosted copy follows"}:x)}}'
hc_hand --run-dir "$R"
hc_check "H2b Lora accepted, Comic Neue open: exit 1, only Comic Neue named (blockers 1, Comic 1, Lora 0) [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'font failure Comic Neue')/$(hc_say 'font failure Lora')" "1/1/1/0"
hc_edit "$R" '{...r,font_check:{...r.font_check,failures:r.font_check.failures.map(x=>({...x,state:"accepted",reason_text:"Robert: ok"}))}}'
hc_hand --run-dir "$R"
hc_check "H2c all font failures accepted with a reason: exit 0 [FR-013]" "$HC_RC/$HC_BLOCKS" "0/0"
hc_edit "$R" '{...r,font_check:{status:"fail",failures:[]}}'
hc_hand --run-dir "$R"
hc_check "H2d font_check fail with no listed failure: exit 1 (fail closed) [FR-013]" "$HC_RC/$(hc_say 'font check failed without a listed failure')" "1/1"

# ---------------------------------------------------------------- H3 accept (real pty)
# RED: drop the empty-reason check in ux-gate.cjs cmdAccept (`if (!reason) throw …`).
hc_make R low low-contrast.html
HC_N=$((HC_N + 1)); HC_AOUT="$HC_ROOT/a-out-$HC_N"; : > "$HC_AOUT"
if [[ "$HC_UNDER_CLAUDE" == "1" ]]; then HC_SKIP=1; HC_ARC=-1
else HC_SKIP=0; run_bounded 90 "$HC_ROOT/a-st-$HC_N" "$HC_ROOT/a-er-$HC_N" -- "${HC_NOCLAUDE[@]}" python3 -I "$HC_ROOT/pty-run.py" "$HC_AOUT" "$HC_NODE" "$HC_GATE" accept --run-dir "$R" --finding low-contrast-1 --reason ""; HC_ARC=$?; fi
hc_check "H3 accept with an empty reason: exit 2, finding still open [FR-013]" "$HC_ARC/$(hc_j "$R/gate-record.json" 'r.findings[0].state')" "2/open"
hc_hand --run-dir "$R"
HC_SKIP=0
hc_check "H3 handoff still blocked after the refused accept (blockers 1) [FR-013]" "$HC_RC/$HC_BLOCKS" "1/1"
# H3b the real accept flow end to end.
HC_N=$((HC_N + 1)); HC_AOUT="$HC_ROOT/a-out-$HC_N"; : > "$HC_AOUT"
if [[ "$HC_UNDER_CLAUDE" == "1" ]]; then HC_SKIP=1; HC_ARC=-1; HC_RC=-1; HC_BLOCKS=-1
else HC_SKIP=0; run_bounded 90 "$HC_ROOT/a-st-$HC_N" "$HC_ROOT/a-er-$HC_N" -- "${HC_NOCLAUDE[@]}" python3 -I "$HC_ROOT/pty-run.py" "$HC_AOUT" "$HC_NODE" "$HC_GATE" accept --run-dir "$R" --finding low-contrast-1 --reason "Robert: reviewed"; HC_ARC=$?; hc_hand --run-dir "$R"; fi
hc_check "H3b real accept then handoff-check: accept exit 0, handoff exit 0, 0 blockers [FR-013]" "$HC_ARC/$HC_RC/$HC_BLOCKS" "0/0/0"
HC_SKIP=0
# H3c accept refuses without a terminal and hands over the command (Robert runs it himself).
HC_N=$((HC_N + 1))
run_bounded 60 "$HC_ROOT/n-out-$HC_N" "$HC_ROOT/n-err-$HC_N" -- "$HC_NODE" "$HC_GATE" accept --run-dir "$R" --finding low-contrast-1 --reason "agent tries"
hc_check "H3c accept without a TTY: exit 2 and prints the hand-over command (count 1) [FR-013]" "$?/$(grep -c 'hand Robert this exact command' "$HC_ROOT/n-err-$HC_N" || true)" "2/1"

# ---------------------------------------------------------------- H4 status error
# RED: checkStatus ignores `error` (handoff-check.cjs, the first line of checkStatus).
hc_make R exit1 high-contrast.html
hc_hand --run-dir "$R"
hc_check "H4 detector exit 1 -> status error: gate exit 3, handoff exit 1 naming 'gate status is error' (count 1) [FR-013]" "$HC_GRC/$HC_RC/$(hc_say 'gate status is error')" "3/1/1"
# H4b nothing to accept in an error record: still blocked even when no finding is open.
hc_edit "$R" '{...r,findings:[],font_check:{status:"pass",failures:[]}}'
hc_hand --run-dir "$R"
hc_check "H4b error record with zero findings and fonts pass: still exit 1 (blockers 1) [FR-013]" "$HC_RC/$HC_BLOCKS" "1/1"
# H4c status comes from gate-record.json only. RED: read status from run.md instead.
hc_make R high high-contrast.html
printf '\nstatus: error\n' >> "$R/run.md"
hc_hand --run-dir "$R"
hc_check "H4c run.md says 'status: error' but the record passes: exit 0 (record is the only source) [FR-013]" "$HC_RC/$HC_BLOCKS" "0/0"
hc_make R exit1 high-contrast.html
printf '\nstatus: pass\n' >> "$R/run.md"
hc_hand --run-dir "$R"
hc_check "H4d run.md says 'status: pass' but the record is error: exit 1 [FR-013]" "$HC_RC/$(hc_say 'gate status is error')" "1/1"
# H4e an invented status blocks.
hc_edit "$R" '{...r,status:"passed-ish"}'
hc_hand --run-dir "$R"
hc_check "H4e unknown status value: exit 1 naming it (count 1) [FR-013]" "$HC_RC/$(hc_say 'is not valid')" "1/1"

# ---------------------------------------------------------------- H5 screenshots (playwright-cli not on PATH)
# RED: checkScreenshots returns [] (handoff-check.cjs).
hc_make R high high-contrast.html
if PATH="$HC_NODEONLY" command -v playwright-cli >/dev/null 2>&1; then bad "H5 precondition: playwright-cli must be absent from the test PATH"; else ok "H5 precondition: playwright-cli is not on the handoff-check PATH [FR-014]"; fi
for victim in diverge-1280 diverge-390 converge-1280 converge-390 result-1280 result-390; do
  hc_make R high high-contrast.html
  rm "$R/screenshots/$victim.png"
  hc_hand --run-dir "$R"
  hc_check "H5 missing screenshots/$victim.png: exit 1, 1 blocker line naming it (count 1) [FR-014]" "$HC_RC/$HC_BLOCKS/$(hc_say "screenshots/$victim.png")" "1/1/1"
done
hc_make R high high-contrast.html
rm -r "$R/screenshots"
hc_hand --run-dir "$R"
hc_check "H5 no screenshots folder at all: exit 1, 6 blocker lines (2 boards + result, 2 widths) [FR-014]" "$HC_RC/$HC_BLOCKS" "1/6"
# H5b a board that exists needs its own evidence: result-only screenshots are not enough.
hc_make R high high-contrast.html
rm "$R/screenshots/diverge-390.png" "$R/screenshots/diverge-1280.png" "$R/screenshots/converge-390.png" "$R/screenshots/converge-1280.png"
hc_hand --run-dir "$R"
hc_check "H5b result shot present, both boards unevidenced: exit 1, 4 blocker lines [FR-014]" "$HC_RC/$HC_BLOCKS" "1/4"
# H5c no boards folder: only the result is required
hc_make R high high-contrast.html
rm -r "$R/boards" "$R/screenshots/diverge-1280.png" "$R/screenshots/diverge-390.png" "$R/screenshots/converge-1280.png" "$R/screenshots/converge-390.png"
hc_hand --run-dir "$R"
hc_check "H5c run without boards, result evidenced at both widths: exit 0 [FR-014]" "$HC_RC/$HC_BLOCKS" "0/0"

# ---------------------------------------------------------------- H6 empty page needs a RENDERED screenshot
# RED: isPng accepts any existing path (handoff-check.cjs, the magic-bytes `buf.equals` line).
hc_make R high high-contrast.html
: > "$R/screenshots/result-1280.png"
printf 'not a png, just a text file' > "$R/screenshots/result-390.png"
hc_hand --run-dir "$R"
hc_check "H6 zero findings but empty / non-PNG result screenshots: exit 1, 2 blocker lines [FR-014]" "$HC_RC/$HC_BLOCKS" "1/2"
hc_make R high high-contrast.html
rm "$R/screenshots/result-1280.png"; ln -s "$HC_FIX/screenshot.png" "$R/screenshots/result-1280.png"
hc_hand --run-dir "$R"
hc_check "H6b screenshot that is a symlink: exit 1 naming it (count 1) [FR-014]" "$HC_RC/$(hc_say 'screenshots/result-1280.png')" "1/1"

# ---------------------------------------------------------------- H7 stale record (mtime)
# RED: delete the mtime comparison in checkTarget (handoff-check.cjs, the 'older than the result file' line).
hc_make R high high-contrast.html
"$HC_NODE" -e 'const fs=require("fs");const t=new Date(Date.now()+60000);fs.utimesSync(process.argv[1],t,t)' "$R/result/result.html"
hc_hand --run-dir "$R"
hc_check "H7 result touched after the gate record (same bytes): exit 1 naming 'older than the result file' (count 1) [FR-013]" "$HC_RC/$(hc_say 'older than the result file')" "1/1"
# H7b record file untouched but its own created time predates the target mtime.
hc_make R high high-contrast.html
hc_edit "$R" '{...r,created:"2020-01-01T00:00:00.000Z"}'
hc_hand --run-dir "$R"
hc_check "H7b record created in 2020 (older than the target): exit 1 [FR-013]" "$HC_RC/$(hc_say 'older than the result file')" "1/1"

# ---------------------------------------------------------------- H8 target_sha256
# RED: delete the target_sha256 comparison in checkTarget (handoff-check.cjs).
hc_make R high high-contrast.html
printf '<!-- tampered -->\n' >> "$R/result/result.html"
"$HC_NODE" -e 'const fs=require("fs");const t=new Date(Date.now()-3600000);fs.utimesSync(process.argv[1],t,t)' "$R/result/result.html"
hc_hand --run-dir "$R"
hc_check "H8 result edited after the gate, mtime set into the past: exit 1 naming the sha mismatch (count 1) [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_say 'target_sha256 mismatch')" "1/1/1"
hc_make R high high-contrast.html
hc_edit "$R" '(({target_sha256,...x})=>x)(r)'
hc_hand --run-dir "$R"
hc_check "H8b record without target_sha256: exit 1 (fail closed) [FR-013]" "$HC_RC/$(hc_say 'target_sha256 mismatch')" "1/1"

# ---------------------------------------------------------------- H9 target outside the run folder
# RED: delete the `!inside(runDir, real)` line in checkTarget (handoff-check.cjs); the message text turns red.
hc_make R high high-contrast.html
mkdir -p "$HC_ROOT/elsewhere"; cp "$HC_GFIX/high-contrast.html" "$HC_ROOT/elsewhere/other.html"
hc_edit "$R" "{...r,target:\"$HC_ROOT/elsewhere/other.html\"}"
hc_hand --run-dir "$R"
hc_check "H9 record target outside the run folder: exit 1 naming 'outside the run folder' (count 1) [FR-013]" "$HC_RC/$(hc_say 'outside the run folder')" "1/1"
hc_make R high high-contrast.html
rm "$R/result/result.html"; ln -s "$HC_ROOT/elsewhere/other.html" "$R/result/result.html"
hc_hand --run-dir "$R"
hc_check "H9b result.html is a symlink to a file outside (realpath, not the lexical path): exit 1 'outside the run folder' [FR-013]" "$HC_RC/$(hc_say 'outside the run folder')" "1/1"
hc_make R high high-contrast.html
hc_edit "$R" '{...r,target:r.target.replace("result/result.html","boards/diverge.html")}'
hc_hand --run-dir "$R"
hc_check "H9c record target is a board, not the result: exit 1 [FR-013]" "$HC_RC/$(hc_say 'is not result/result.html')" "1/1"

# ---------------------------------------------------------------- H10 advisories never block
# RED: checkFindings drops the `severity === 'advisory'` guard (handoff-check.cjs).
hc_make R advisory advisory.html
hc_hand --run-dir "$R"
hc_check "H10 detector advisory (open state, exit 0 pass): handoff exit 0, 0 blockers [FR-013]" "$HC_RC/$HC_BLOCKS" "0/0"
hc_check "H10 advisory listed as informational (count 1) [FR-013]" "$(hc_say 'advisory (informational): bounce-easing')" "1"
hc_check "H10 record really holds an open advisory (count 1) [FR-013]" "$(hc_j "$R/gate-record.json" 'r.findings.filter(f=>f.severity==="advisory"&&f.state==="open").length')" "1"

# ---------------------------------------------------------------- H11 missing / hostile record
# RED: readRecord returns { rec: {} } on a read error instead of a blocker (handoff-check.cjs).
hc_make R high high-contrast.html
rm "$R/gate-record.json"
printf '\nstatus: pass\n' >> "$R/run.md"
hc_hand --run-dir "$R"
hc_check "H11 no gate-record.json (run.md claims pass): exit 1, 'run the gate first' (count 1) [FR-013]" "$HC_RC/$(hc_say 'run the gate first')" "1/1"
printf '{ not json' > "$R/gate-record.json"
hc_hand --run-dir "$R"
hc_check "H11b gate-record.json is not JSON: exit 1 [FR-013]" "$HC_RC/$(hc_say 'run the gate first')" "1/1"
printf '{"gate_id":"other"}' > "$R/gate-record.json"
hc_hand --run-dir "$R"
hc_check "H11c gate-record.json is not a ux-studio-gate record: exit 1 [FR-013]" "$HC_RC/$(hc_say 'is not a ux-studio-gate record')" "1/1"
# one reason per line: a hostile finding id with a newline cannot forge a second line
hc_make R low low-contrast.html
hc_edit "$R" '{...r,findings:[{...r.findings[0],id:"x\nblocked: forged line"}]}'
hc_hand --run-dir "$R"
hc_check "H11d newline in a finding id: exactly 1 blocker line, no forged line starts a line (count 0) [FR-013]" "$HC_BLOCKS/$(grep -c '^blocked: forged' "$HC_OUT" || true)" "1/0"

# ---------------------------------------------------------------- H12 a new run resets acceptances
# RED: ux-gate.cjs cmdRun carries the previous record's accepted states into the new record.
hc_make R low low-contrast.html
hc_edit "$R" '{...r,findings:r.findings.map(f=>({...f,state:"accepted",reason:"Robert: ok"}))}'
hc_hand --run-dir "$R"
hc_check "H12 precondition: accepted record allows handoff (exit 0) [FR-013]" "$HC_RC" "0"
hc_gate "$R" low
hc_hand --run-dir "$R"
hc_check "H12 a new gate run resets the acceptance: state open again, handoff exit 1 (blockers 1) [FR-013]" "$HC_RC/$HC_BLOCKS/$(hc_j "$R/gate-record.json" 'r.findings[0].state')" "1/1/open"

# ---------------------------------------------------------------- H13 hostile inputs (handoff-check CLI)
# RED: drop the ".." / length / NUL / run.md checks in ux-gate.cjs cleanPathArg, resolveRunDir, requireRunMd.
HC_LONG="$(head -c 10001 /dev/zero | tr '\0' 'a')"
hc_hostile() { # <name> <args...>
  local name="$1"; shift
  hc_hand "$@"
  if [[ "$HC_RC" == "2" && -s "$HC_ERR" && "$HC_BLOCKS" == "0" ]]; then ok "H13 $name: exit 2, stderr set, no blocker output [FR-013]"; else bad "H13 $name (rc=$HC_RC blocks=$HC_BLOCKS err=$(head -c 120 "$HC_ERR"))"; fi
}
hc_make R high high-contrast.html
hc_hostile "--run-dir path traversal" --run-dir "../../etc"
hc_hostile "--run-dir traversal into a REAL run folder (has run.md)" --run-dir "$R/result/.."
hc_hostile "--run-dir injection-shaped" --run-dir '; rm -rf /'
hc_hostile "--run-dir command substitution" --run-dir '$(touch PWNED6)'
hc_hostile "--run-dir backticks" --run-dir '`touch PWNED6`'
hc_hostile "--run-dir 10001 chars" --run-dir "$HC_LONG"
hc_hostile "--run-dir is a file" --run-dir "$R/run.md"
hc_hostile "--run-dir without run.md" --run-dir "$HC_STUBDIR"
hc_hostile "--run-dir missing" --run-dir "$HC_ROOT/does-not-exist"
hc_hostile "missing option value" --run-dir
hc_hostile "no arguments at all"
hc_check "H13 no injection ran (PWNED6 files, count 0) [FR-013]" "$(find "$HC_ROOT" "$PWD" -maxdepth 2 -name 'PWNED6' 2>/dev/null | grep -c . || true)" "0"
HC_SKIP=0
