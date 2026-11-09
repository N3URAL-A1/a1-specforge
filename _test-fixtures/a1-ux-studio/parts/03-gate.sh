# Part 03 — gate engine (spec 024-ux-studio, FR-009..FR-012, FR-030).
#
# Drives the real skills/a1-ux-studio/scripts/gate/ux-gate.cjs. `npx` is a PATH-first bash stub that
# replays detector output CAPTURED from the real `npx impeccable@4.8.1 detect --json` (fixtures/gate/,
# see SOURCES.txt) and logs its argv + cwd. No case touches the network, the real vault or ~/.claude.
# Each case header names the production change that turns it red (contract item 4).

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

GT_GATE="$REPO_ROOT/skills/a1-ux-studio/scripts/gate/ux-gate.cjs"
GT_FIX="$HERE/fixtures/gate"
GT_NODE="$(command -v node)"
mk_workdir GT_ROOT ux-gate
GT_STUBDIR="$GT_ROOT/stub"; mkdir -p "$GT_STUBDIR"
GT_NODEONLY="$GT_ROOT/nodeonly"; mkdir -p "$GT_NODEONLY"; ln -s "$GT_NODE" "$GT_NODEONLY/node"
GT_N=0

cat > "$GT_STUBDIR/npx" <<'STUB'
#!/usr/bin/env bash
# Test stub for npx. Never touches the network. STUB_MODE picks the replay.
{ printf 'CWD=%s\n' "$(pwd -P)"; for a in "$@"; do printf 'ARG=%s\n' "$a"; done; echo '---'; } >> "$STUB_LOG"
echo "stub cache" > .stub-cache
printf 'ENV_IMP=%s DNT=%s\n' "$(env | grep -c '^IMPECCABLE_')" "${DO_NOT_TRACK:-unset}" >> "$STUB_LOG"
case "${STUB_MODE:-}" in
  low)      cat "$STUB_FIX/impeccable-4.8.1-low.json"; exit "$(cat "$STUB_FIX/impeccable-4.8.1-low.exit")" ;;
  high)     cat "$STUB_FIX/impeccable-4.8.1-high.json"; exit "$(cat "$STUB_FIX/impeccable-4.8.1-high.exit")" ;;
  advisory) cat "$STUB_FIX/impeccable-4.8.1-advisory.json"; exit "$(cat "$STUB_FIX/impeccable-4.8.1-advisory.exit")" ;;
  mutate)   for last in "$@"; do :; done; echo '<!-- changed -->' >> "$last"; cat "$STUB_FIX/impeccable-4.8.1-high.json"; exit 0 ;;
  exit1)    echo "boom" >&2; exit 1 ;;
  blocked)  echo "npm error code ENOTFOUND: getaddrinfo ENOTFOUND registry.npmjs.org" >&2; exit 1 ;;
  nosev)    grep -v '"severity"' "$STUB_FIX/impeccable-4.8.1-low.json"; exit 2 ;;
  inconsistent) cat "$STUB_FIX/impeccable-4.8.1-low.json"; exit 0 ;;
  empty2)   echo '[]'; exit 2 ;;
  garbage)  echo 'not json at all'; exit 0 ;;
  *)        echo "stub: STUB_MODE unset" >&2; exit 99 ;;
esac
STUB
chmod +x "$GT_STUBDIR/npx"

# Real pseudo-terminal driver for `accept` (SEC-1): python3 pty.fork gives the child a tty on
# stdin, stdout and stderr (portable across GNU and BSD, unlike script(1) flag variants).
cat > "$GT_ROOT/pty-run.py" <<'PYE'
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

# gt_run_dir <var> — fresh run folder with run.md (one marker pair) and result/.
gt_run_dir() {
  GT_N=$((GT_N + 1))
  local d="$GT_ROOT/run-$GT_N"
  mkdir -p "$d/result"
  printf '# run\n\n## Brief\nx\n\n<!-- gate-record:start -->\n<!-- gate-record:end -->\n\n## Picks\n' > "$d/run.md"
  eval "$1=\$d"
}

# gt_gate <stub-mode> <args...> — runs ux-gate.cjs with the stub first on PATH; sets GT_RC GT_OUT GT_ERR.
gt_gate() {
  local mode="$1"; shift
  GT_SKIP=0
  GT_N=$((GT_N + 1))
  GT_OUT="$GT_ROOT/out-$GT_N"; GT_ERR="$GT_ROOT/err-$GT_N"
  run_bounded 60 "$GT_OUT" "$GT_ERR" -- env STUB_MODE="$mode" STUB_LOG="$GT_ROOT/stub.log" STUB_FIX="$GT_FIX" \
    PATH="$GT_STUBDIR:$PATH" "$GT_NODE" "$GT_GATE" "$@"
  GT_RC=$?
}

# Claude Code context (SEC-1): `accept` refuses inside it, so the cases that need accept to SUCCEED
# (or to refuse for their own reason) print `SKIP (claude-code ancestor)` when this suite itself runs
# under Claude Code, and run fully elsewhere (precedent: a1-xprov parts/08-allowlist.sh). CI=true: a SKIP is a FAIL.
GT_NOCLAUDE=(env)
for v in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do GT_NOCLAUDE+=(-u "$v"); done
# The probe runs the REAL guard with the env arm off, so only the process ancestry can answer.
if "${GT_NOCLAUDE[@]}" "$GT_NODE" -e 'process.exit(require(process.argv[1]).claudeContextRefusal({}) === null ? 0 : 1)' "$REPO_ROOT/_shared/lib/xprov-approve.cjs"; then GT_UNDER_CLAUDE=0; else GT_UNDER_CLAUDE=1; fi
GT_SKIP=0

# gt_accept <args...> — runs `ux-gate.cjs accept` on a real pty with the Claude env stripped; sets GT_RC GT_OUT GT_ERR.
# Under a Claude Code ancestor it does not run: GT_SKIP=1 makes the following gt_check/gt_hostile print SKIP.
gt_accept() {
  GT_N=$((GT_N + 1)); GT_OUT="$GT_ROOT/out-$GT_N"; GT_ERR="$GT_OUT"; : > "$GT_OUT"
  if [[ "$GT_UNDER_CLAUDE" == "1" ]]; then GT_SKIP=1; GT_RC=-1; return 0; fi
  GT_SKIP=0
  run_bounded 90 "$GT_ROOT/pty-status-$GT_N" "$GT_ROOT/pty-err-$GT_N" -- "${GT_NOCLAUDE[@]}" python3 -I "$GT_ROOT/pty-run.py" "$GT_OUT" "$GT_NODE" "$GT_GATE" accept "$@"
  GT_RC=$?
}
gt_skip() {
  if [[ "${CI:-}" == "true" ]]; then bad "$1: SKIP (claude-code ancestor) is not allowed when CI=true"
  else results+=("SKIP (claude-code ancestor)  $1"); fi
}

gt_reset_log() { : > "$GT_ROOT/stub.log"; }
gt_calls() { grep -c '^---$' "$GT_ROOT/stub.log" || true; }
# gt_j <record> <js-expr over r> — evaluate against the parsed record.
gt_j() { "$GT_NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String('"$2"'))' "$1" 2>/dev/null || true; }
# gt_check <name> <got> <want>
gt_check() { if [[ "$GT_SKIP" == "1" ]]; then gt_skip "$1"; elif [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }

# gt_target <rundir> <html-fixture> — copies a real fixture into result/result.html, sets GT_T.
gt_target() { cp "$GT_FIX/$2" "$1/result/result.html"; GT_T="$1/result/result.html"; }

# ---------------------------------------------------------------- G1
# RED: map detector exit 2 to `pass` in interpret() (ux-gate.cjs).
gt_run_dir R; gt_target "$R" low-contrast.html; gt_reset_log
gt_gate low run --run-dir "$R" --target "$GT_T"
REC="$R/gate-record.json"
gt_check "G1 low-contrast: gate exit 1" "$GT_RC" "1"
gt_check "G1 low-contrast: status findings" "$(gt_j "$REC" r.status)" "findings"
gt_check "G1 low-contrast: one finding (count)" "$(gt_j "$REC" r.findings.length)" "1"
gt_check "G1 low-contrast: rule id from detector JSON" "$(gt_j "$REC" 'r.findings[0].rule')" "low-contrast"
gt_check "G1 low-contrast: location from detector JSON (file:line)" "$(gt_j "$REC" 'r.findings[0].location')" "low-contrast.html:0"
gt_check "G1 low-contrast: severity primary, state open" "$(gt_j "$REC" 'r.findings[0].severity+"/"+r.findings[0].state')" "primary/open"
gt_check "G1 low-contrast: detector exit code recorded" "$(gt_j "$REC" r.exit_code)" "2"
gt_check "G1 record field names" "$(gt_j "$REC" 'Object.keys(r).sort().join(",")')" "cause,created,exit_code,findings,font_check,gate_id,impeccable_version,scan_mode,status,target,target_sha256"
gt_check "G1 run.md block: one start and one end marker (count)" "$(grep -c 'gate-record:' "$R/run.md")" "2"
gt_check "G1 run.md block names the rule" "$(grep -c 'low-contrast' "$R/run.md")" "1"

# control: high contrast -> pass
gt_run_dir R; gt_target "$R" high-contrast.html
gt_gate high run --run-dir "$R" --target "$GT_T"
gt_check "G1b high-contrast control: exit 0 and status pass" "$GT_RC/$(gt_j "$R/gate-record.json" r.status)" "0/pass"
gt_check "G1b high-contrast control: no findings (count)" "$(gt_j "$R/gate-record.json" r.findings.length)" "0"

# ---------------------------------------------------------------- G2
# RED: treat detector exit 1 as pass (accept any non-spawn-error exit) in interpret().
gt_run_dir R; gt_target "$R" high-contrast.html
gt_gate exit1 run --run-dir "$R" --target "$GT_T"
gt_check "G2 stub exit 1: gate exit 3" "$GT_RC" "3"
gt_check "G2 stub exit 1: status error" "$(gt_j "$R/gate-record.json" r.status)" "error"
gt_check "G2 stub exit 1: cause names the exit" "$(gt_j "$R/gate-record.json" 'r.cause.indexOf("exited 1")>=0')" "true"
gt_run_dir R; gt_target "$R" high-contrast.html
gt_gate blocked run --run-dir "$R" --target "$GT_T"
gt_check "G2b blocked download: exit 3, error, cause carries stderr" "$GT_RC/$(gt_j "$R/gate-record.json" r.status)/$(gt_j "$R/gate-record.json" 'r.cause.indexOf("ENOTFOUND")>=0')" "3/error/true"

# ---------------------------------------------------------------- G3
# RED: in interpret(), return a pass result when `res.error` is set (catch the spawn error as pass).
gt_run_dir R; gt_target "$R" high-contrast.html
GT_N=$((GT_N + 1)); GT_OUT="$GT_ROOT/out-$GT_N"; GT_ERR="$GT_ROOT/err-$GT_N"
run_bounded 60 "$GT_OUT" "$GT_ERR" -- env PATH="$GT_NODEONLY" "$GT_NODE" "$GT_GATE" run --run-dir "$R" --target "$GT_T"; GT_RC=$?
gt_check "G3 no npx on PATH: gate exit 3" "$GT_RC" "3"
gt_check "G3 no npx on PATH: status error with cause" "$(gt_j "$R/gate-record.json" r.status)/$(gt_j "$R/gate-record.json" 'r.cause')" "error/npx not found on PATH"

# ---------------------------------------------------------------- G4
# RED: count every finding as primary (drop the advisory check) in mapFinding().
gt_run_dir R; gt_target "$R" advisory.html
gt_gate advisory run --run-dir "$R" --target "$GT_T"
REC="$R/gate-record.json"
gt_check "G4 advisory only: exit 0, status pass" "$GT_RC/$(gt_j "$REC" r.status)" "0/pass"
gt_check "G4 advisory listed informationally (count 1, severity advisory)" "$(gt_j "$REC" 'r.findings.length+"/"+r.findings[0].severity+"/"+r.findings[0].rule')" "1/advisory/bounce-easing"

# fail-closed severity handling (same mapper)
# RED: default a missing severity to advisory instead of primary.
gt_run_dir R; gt_target "$R" low-contrast.html
gt_gate nosev run --run-dir "$R" --target "$GT_T"
gt_check "G4b exit 2 without severity field: finding is primary, status findings" "$(gt_j "$R/gate-record.json" 'r.findings[0].severity+"/"+r.status')" "primary/findings"
gt_run_dir R; gt_target "$R" low-contrast.html
gt_gate empty2 run --run-dir "$R" --target "$GT_T"
gt_check "G4c exit 2 with empty JSON: still findings, synthetic primary (count 1)" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.status+"/"+r.findings.length')" "1/findings/1"
gt_run_dir R; gt_target "$R" low-contrast.html
gt_gate inconsistent run --run-dir "$R" --target "$GT_T"
gt_check "G4d exit 0 with primary finding in JSON: error, exit 3" "$GT_RC/$(gt_j "$R/gate-record.json" r.status)" "3/error"
gt_run_dir R; gt_target "$R" high-contrast.html
gt_gate garbage run --run-dir "$R" --target "$GT_T"
gt_check "G4e exit 0 with non-JSON stdout: error, exit 3" "$GT_RC/$(gt_j "$R/gate-record.json" r.status)" "3/error"

# ---------------------------------------------------------------- G5
# RED: drop the remote-URL scan (collectRemoteSources returns []) in font-check.cjs.
gt_run_dir R; gt_target "$R" high-contrast.html
sed 's#<style>#<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400\&display=swap"><style>#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
REC="$R/gate-record.json"
gt_check "G5 remote font link: font_check fail, exit 1" "$(gt_j "$REC" r.font_check.status)/$GT_RC" "fail/1"
gt_check "G5 failure names font and reason (count 1)" "$(gt_j "$REC" 'r.font_check.failures.length+"/"+r.font_check.failures[0].font+"/"+r.font_check.failures[0].reason')" "1/Inter/remote_url"
gt_check "G5 overall status findings although detector passed" "$(gt_j "$REC" r.status)" "findings"
gt_run_dir R
sed 's#<style>#<style>@font-face{font-family:"Inter";src:url(https://cdn.example.com/inter.woff2)}#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
gt_check "G5b remote @font-face src: remote_url failure for Inter (count 1)" "$(gt_j "$R/gate-record.json" 'r.font_check.failures.filter(f=>f.reason==="remote_url"&&f.font==="Inter").length')" "1"

# ---------------------------------------------------------------- G6
# RED: skip the allowlist lookup (treat every named family as allowed) in allowlistFailures().
gt_run_dir R
sed 's#font-family:sans-serif#font-family:"Comic Sans MS",sans-serif#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
REC="$R/gate-record.json"
gt_check "G6 non-allowlisted family: fail, names font + reason (count 1)" "$(gt_j "$REC" 'r.font_check.status+"/"+r.font_check.failures.length+"/"+r.font_check.failures[0].font+"/"+r.font_check.failures[0].reason')" "fail/1/Comic Sans MS/not_allowlisted"
gt_run_dir R
sed 's#<style>#<style>@font-face{font-family:"Inter";src:url(fonts/inter/inter-latin-400.woff2)}#; s#font-family:sans-serif#font-family:Inter,system-ui,sans-serif#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
gt_check "G6b allowlisted local family: font pass, gate exit 0" "$(gt_j "$R/gate-record.json" r.font_check.status)/$(gt_j "$R/gate-record.json" r.font_check.failures.length)/$GT_RC" "pass/0/0"
gt_run_dir R
sed 's#<style>#<style>:root{--font-body:"Papyrus"}#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
gt_check "G6c family hidden in a --font-* custom property is still checked" "$(gt_j "$R/gate-record.json" 'r.font_check.failures.map(f=>f.font).join(",")')" "Papyrus"
gt_run_dir R
sed 's#<style>#<style>.x{font:16px/1.4 "Brush Script MT",cursive}#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
gt_check "G6d font shorthand family is checked" "$(gt_j "$R/gate-record.json" 'r.font_check.failures.map(f=>f.font).join(",")')" "Brush Script MT"

# ---------------------------------------------------------------- G7
# RED: change the pin in impeccable.json / argv to unpinned `impeccable`, or drop `--no-config` from detect_flags (SEC-3).
gt_run_dir R; gt_target "$R" low-contrast.html; gt_reset_log
gt_gate low run --run-dir "$R" --target "$GT_T"
REAL_T="$(cd "$R/result" && pwd -P)/result.html"
gt_check "G7 stub called once (count)" "$(gt_calls)" "1"
gt_check "G7 argv is exactly impeccable@4.8.1 detect --no-config --json <target> (5 args)" "$(grep '^ARG=' "$GT_ROOT/stub.log" | tr '\n' ' ')" "ARG=impeccable@4.8.1 ARG=detect ARG=--no-config ARG=--json ARG=$REAL_T "
gt_check "G7 record stores the pinned version" "$(gt_j "$R/gate-record.json" r.impeccable_version)/$(gt_j "$R/gate-record.json" r.scan_mode)" "4.8.1/file"

# ---------------------------------------------------------------- G8
# RED: drop the `cwd` option from spawnSync in spawnDetector().
GT_N=$((GT_N + 1)); REPO="$GT_ROOT/fake-repo-$GT_N"; mkdir -p "$REPO/src" "$REPO/.git"
echo "console.log(1)" > "$REPO/src/app.js"; echo "ref: refs/heads/main" > "$REPO/.git/HEAD"; cp "$GT_FIX/low-contrast.html" "$REPO/page.html"
gt_tree() { (cd "$1" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s ' "$f"; cksum < "$f"; done | cksum); }
gt_run_dir R; gt_reset_log
H1="$(gt_tree "$REPO")"
( cd "$REPO" && STUB_MODE=low STUB_LOG="$GT_ROOT/stub.log" STUB_FIX="$GT_FIX" PATH="$GT_STUBDIR:$PATH" "$GT_NODE" "$GT_GATE" run --run-dir "$R" --target "$REPO/page.html" >/dev/null 2>&1 )
H2="$(gt_tree "$REPO")"
gt_check "G8 target repo tree hash unchanged after a run from inside the repo" "$H2" "$H1"
gt_check "G8 repo file count unchanged (count 3)" "$(cd "$REPO" && find . -type f | grep -c .)" "3"
RUND_REAL="$(cd "$R" && pwd -P)"
case "$(sed -n 's/^CWD=//p' "$GT_ROOT/stub.log" | head -n 1)" in
  "$RUND_REAL"/.gate-scratch-*) ok "G8 detector cwd is a scratch dir inside the run folder" ;;
  *) bad "G8 detector cwd is not inside the run folder: $(sed -n 's/^CWD=//p' "$GT_ROOT/stub.log" | head -n 1)" ;;
esac
gt_check "G8 scratch dir removed after the run (count 0)" "$(find "$R" -maxdepth 1 -name '.gate-scratch-*' | grep -c . || true)" "0"

# ---------------------------------------------------------------- G9
# RED: add `npx impeccable install --scope=project` or `/impeccable init` (outside a prohibition line)
# to any file under skills/a1-ux-studio/.
hits="$(grep -rnE '/impeccable init|--scope=project|scope[ =]project' "$REPO_ROOT/skills/a1-ux-studio" | grep -viE 'never|must not|do not|forbidden' || true)"
gt_check "G9 no init / project-scope install string outside prohibition lines (count 0)" "$(printf '%s' "$hits" | grep -c . || true)" "0"
chits="$(grep -rniE 'luminance|0\.2126|0\.7152|contrast-ratio|contrastratio|getcontrast' "$REPO_ROOT/skills/a1-ux-studio/scripts/gate" || true)"
gt_check "G9b no contrast computation under scripts/gate (count 0)" "$(printf '%s' "$chits" | grep -c . || true)" "0"
gt_check "G9c impeccable.json: user scope token and pin" "$("$GT_NODE" -e 'const c=require(process.argv[1]);console.log(c.pin+"|"+c.install_scope+"|"+c.install_command)' "$REPO_ROOT/skills/a1-ux-studio/scripts/gate/impeccable.json")" "impeccable@4.8.1|global|npx impeccable@4.8.1 install -y --providers=claude --scope=global"
gt_check "G9d font-allowlist: every entry has family, package, OFL spdx (count 23)" "$("$GT_NODE" -e 'const a=require(process.argv[1]).families;console.log(a.filter(f=>f.family&&/^@fontsource\//.test(f.package)&&/^OFL-1\.1$/.test(f.spdx)).length)' "$REPO_ROOT/skills/a1-ux-studio/scripts/gate/font-allowlist.json")" "23"

# ---------------------------------------------------------------- G10 (accept)
# RED: let accept skip the empty-reason check, or let it write outside the marker pair.
gt_run_dir R; gt_target "$R" low-contrast.html
gt_gate low run --run-dir "$R" --target "$GT_T"
gt_accept --run-dir "$R" --finding low-contrast-1 --reason ""
gt_check "G10 accept with empty reason: exit 2, finding still open" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.findings[0].state')" "2/open"
gt_accept --run-dir "$R" --finding no-such-1 --reason "because"
gt_check "G10 accept unknown finding id: exit 2" "$GT_RC" "2"
INJ='<!-- gate-record:end --> $(touch '"$GT_ROOT"'/PWNED) `touch '"$GT_ROOT"'/PWNED2`; rm -rf /'
gt_accept --run-dir "$R" --finding low-contrast-1 --reason "$INJ"
gt_check "G10 accept with injection-shaped reason: exit 0, state accepted" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.findings[0].state')" "0/accepted"
gt_check "G10 reason stored as an inert string" "$(gt_j "$R/gate-record.json" 'r.findings[0].reason===process.argv[2]')" "false"
gt_check "G10 stored reason still contains the typed text (count 1)" "$(gt_j "$R/gate-record.json" 'r.findings[0].reason.indexOf("rm -rf /")>=0?1:0')" "1"
gt_check "G10 no command substitution executed (count 0)" "$(ls "$GT_ROOT" | grep -c '^PWNED' || true)" "0"
gt_check "G10 run.md still has exactly one marker pair (count 2)" "$(grep -c '<!-- gate-record:' "$R/run.md")" "2"
gt_check "G10 run.md Picks section untouched (count 1)" "$(grep -c '^## Picks$' "$R/run.md")" "1"
gt_accept --run-dir "$R" --finding low-contrast-1 --reason "again"
gt_check "G10 accepting twice: exit 2" "$GT_RC" "2"
LONGR="$(head -c 1001 /dev/zero | tr '\0' 'a')"
gt_run_dir R; gt_target "$R" low-contrast.html; gt_gate low run --run-dir "$R" --target "$GT_T"
gt_accept --run-dir "$R" --finding low-contrast-1 --reason "$LONGR"
gt_check "G10 accept with oversized reason (1001 chars): exit 2, still open" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.findings[0].state')" "2/open"
gt_run_dir R; gt_target "$R" low-contrast.html
sed 's#<style>#<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">\n<style>#' "$GT_FIX/low-contrast.html" > "$R/result/result.html"
gt_gate low run --run-dir "$R" --target "$R/result/result.html"
# RED: re-add a refusal for `font:` ids in applyAccept() (ux-gate.cjs).
gt_accept --run-dir "$R" --finding "font:Lora" --reason ""
gt_check "G10b font accept with empty reason: exit 2, failure still open" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.font_check.failures[0].state')" "2/open"
gt_accept --run-dir "$R" --finding "font:Lora" --reason "$LONGR"
gt_check "G10b font accept with 1001-char reason: exit 2, still open" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.font_check.failures[0].state')" "2/open"
gt_accept --run-dir "$R" --finding "font:Nope" --reason "x"
gt_check "G10b font accept of unknown family: exit 2" "$GT_RC" "2"
gt_accept --run-dir "$R" --finding "font:Lora" --reason "Robert approved: self-hosted copy follows in W4"
gt_check "G10b font accept: exit 0, state accepted, reason_text stored (failures count 1)" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.font_check.failures.length+"/"+r.font_check.failures[0].state+"/"+r.font_check.failures[0].reason_text')" "0/1/accepted/Robert approved: self-hosted copy follows in W4"
gt_check "G10b accepted font shown in run.md block (count 1)" "$(grep -c 'font Lora remote_url' "$R/run.md")" "1"
gt_accept --run-dir "$R" --finding "font:Lora" --reason "again"
gt_check "G10b font accepted twice: exit 2" "$GT_RC" "2"

# ---------------------------------------------------------------- G11 (hostile inputs, run)
# RED: drop the ".." check, the extension check, the length cap or the waiver scan in ux-gate.cjs.
gt_run_dir R; gt_target "$R" high-contrast.html; gt_reset_log
LONG10K="$(head -c 10001 /dev/zero | tr '\0' 'a')"
gt_hostile() { # <name> <args...> — exit 2, stderr text, stub never called
  local name="$1"; shift
  if [[ "$1" == "accept" ]]; then shift; gt_accept "$@"; else GT_SKIP=0; gt_gate high "$@"; fi
  if [[ "$GT_SKIP" == "1" ]]; then gt_skip "G11 $name"
  elif [[ "$GT_RC" == "2" && -s "$GT_ERR" && "$(gt_calls)" == "0" ]]; then ok "G11 $name: exit 2, stderr set, detector not spawned"; else bad "G11 $name (rc=$GT_RC calls=$(gt_calls) err=$(head -c 120 "$GT_ERR"))"; fi
}
gt_hostile "--run-dir path traversal" run --run-dir "../../etc" --target "$GT_T"
gt_hostile "--run-dir injection-shaped" run --run-dir '; rm -rf /' --target "$GT_T"
gt_hostile "--run-dir 10001 chars" run --run-dir "$LONG10K" --target "$GT_T"
gt_hostile "--run-dir is a file" run --run-dir "$GT_T" --target "$GT_T"
gt_hostile "--target path traversal" run --run-dir "$R" --target "../../etc/passwd"
gt_hostile "--target not html" run --run-dir "$R" --target "/etc/passwd"
gt_hostile "--target injection-shaped, missing" run --run-dir "$R" --target '$(touch PWNED).html'
gt_hostile "--target 10001 chars" run --run-dir "$R" --target "$LONG10K.html"
gt_hostile "--target missing" run --run-dir "$R" --target "$R/result/nope.html"
gt_hostile "no run.md" run --run-dir "$GT_ROOT/stub" --target "$GT_T"
gt_hostile "unknown command" frobnicate --run-dir "$R"
gt_hostile "missing option value" run --run-dir "$R" --target
cp "$GT_FIX/low-contrast.html" "$R/result/waived.html"
sed -i.bak 's#<head>#<head><!-- impeccable-disable low-contrast -- fine -->#' "$R/result/waived.html" && rm -f "$R/result/waived.html.bak"
gt_hostile "file carries an impeccable waiver comment" run --run-dir "$R" --target "$R/result/waived.html"
ln -s /etc/hosts "$R/result/link.html"
gt_hostile "--target symlink to a non-html file" run --run-dir "$R" --target "$R/result/link.html"
gt_hostile "accept --run-dir traversal" accept --run-dir "../../etc" --finding x-1 --reason r
gt_hostile "accept --finding injection-shaped" accept --run-dir "$R" --finding '$(touch PWNED)' --reason r
gt_hostile "accept --finding 10001 chars" accept --run-dir "$R" --finding "$LONG10K" --reason r
gt_hostile "accept --reason 10001 chars" accept --run-dir "$R" --finding x-1 --reason "$LONG10K"
GT_SKIP=0
gt_check "G11 no gate-record written by any rejected call (count 0)" "$(ls "$R" | grep -c '^gate-record.json$' || true)" "0"

GT_SKIP=0
# inert file name: shell metacharacters in a REAL target name are passed as one argv element
gt_run_dir R; gt_reset_log
mkdir -p "$GT_ROOT/inert"; INERT="$GT_ROOT/inert/a b\$(touch PWNED3);x.html"
cp "$GT_FIX/high-contrast.html" "$INERT"
( cd "$GT_ROOT/inert" && STUB_MODE=high STUB_LOG="$GT_ROOT/stub.log" STUB_FIX="$GT_FIX" PATH="$GT_STUBDIR:$PATH" "$GT_NODE" "$GT_GATE" run --run-dir "$R" --target "$INERT" >/dev/null 2>&1 ); rc=$?
gt_check "G11b shell-metacharacter file name: gate exit 0, no command executed (count 0)" "$rc/$(find "$GT_ROOT" -name 'PWNED3' | grep -c . || true)" "0/0"
gt_check "G11b argv carries the name as one element (count 5 ARG lines)" "$(grep -c '^ARG=' "$GT_ROOT/stub.log")" "5"

# ---------------------------------------------------------------- G12 (SEC-1: accept needs a real terminal)
# RED: remove the requireTerminal(opts) call from cmdAccept() in ux-gate.cjs.
if command -v python3 >/dev/null 2>&1; then ok "G12 python3 available for the pty driver"; else bad "G12 python3 missing: pty cases cannot run"; fi
gt_run_dir R; gt_target "$R" low-contrast.html
gt_gate low run --run-dir "$R" --target "$GT_T"
SUM_BEFORE="$(cksum < "$R/gate-record.json") $(cksum < "$R/run.md")"
gt_gate x accept --run-dir "$R" --finding low-contrast-1 --reason "agent tries to self-approve" < /dev/null
gt_check "G12 accept with stdin/stdout not a tty: exit 2" "$GT_RC" "2"
gt_check "G12 refusal tells the agent to hand Robert the command (count 1)" "$(grep -c 'hand Robert this exact command' "$GT_ERR")" "1"
gt_check "G12 record and run.md unchanged after the refused accept" "$(cksum < "$R/gate-record.json") $(cksum < "$R/run.md")" "$SUM_BEFORE"
gt_check "G12 finding still open (count 1)" "$(gt_j "$R/gate-record.json" 'r.findings.filter(f=>f.state==="open").length')" "1"
gt_accept --run-dir "$R" --finding low-contrast-1 --reason "Robert approved at the terminal"
gt_check "G12 accept on a real pty: exit 0, accepted, accepted_by tty" "$GT_RC/$(gt_j "$R/gate-record.json" 'r.findings[0].state+"/"+r.findings[0].accepted_by')" "0/accepted/tty"

# ---------------------------------------------------------------- G13 (SEC-2: target_sha256 and change-during-scan)
# RED: store a constant instead of the hash, or drop the post-scan re-hash in cmdRun().
gt_run_dir R; gt_target "$R" high-contrast.html
gt_gate high run --run-dir "$R" --target "$GT_T"
WANT_SHA="$("$GT_NODE" -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$GT_T")"
gt_check "G13 target_sha256 is the sha256 of the target bytes" "$(gt_j "$R/gate-record.json" r.target_sha256)" "$WANT_SHA"
gt_check "G13 sha256 is 64 hex chars (count 64)" "$(gt_j "$R/gate-record.json" r.target_sha256.length)" "64"
gt_run_dir R; gt_target "$R" high-contrast.html
gt_gate mutate run --run-dir "$R" --target "$GT_T"
gt_check "G13b target changed while the detector ran: exit 3, error" "$GT_RC/$(gt_j "$R/gate-record.json" r.status)" "3/error"

# ---------------------------------------------------------------- G14 (SEC-4: font check bypasses)
# RED: drop the SVG attribute regex / normalize() / scriptFailures() in font-check.cjs.
gt_font_case() { # <name> <html-snippet-after-style> <want fonts joined by ,>
  gt_run_dir R
  sed "s#<style>#$2<style>#" "$GT_FIX/high-contrast.html" > "$R/result/result.html"
  gt_gate high run --run-dir "$R" --target "$R/result/result.html"
  gt_check "G14 $1: font_check fail (count of failures 1)" "$(gt_j "$R/gate-record.json" 'r.font_check.status+"/"+r.font_check.failures.length+"/"+r.font_check.failures[0].font')" "fail/1/$3"
}
gt_font_case "SVG font-family attribute" '<svg width="10" height="10"><text font-family="Papyrus">x</text></svg>' "Papyrus"
gt_font_case "CSS escape in family name" '<style>.e{font-family:\\50 apyrus}</style>' "Papyrus"
gt_font_case "FontFace in script" '<script>new FontFace("x","url(a.woff2)")</script>' "FontFace (script)"
gt_font_case "escaped remote URL in @font-face" '<style>@font-face{font-family:Inter;src:url("https:\\2f\\2f cdn.example.com/a.woff2")}</style>' "Inter"
gt_run_dir R
sed 's#<style>#<script>document.fonts.add(f)</script><style>#' "$GT_FIX/high-contrast.html" > "$R/result/result.html"
gt_gate high run --run-dir "$R" --target "$R/result/result.html"
gt_check "G14b document.fonts in script: fail (count 1)" "$(gt_j "$R/gate-record.json" 'r.font_check.failures.length+"/"+r.font_check.failures[0].reason')" "1/not_allowlisted"

# ---------------------------------------------------------------- G15 (SEC-6: detector env)
# RED: pass process.env unfiltered to spawnSync in spawnDetector().
gt_run_dir R; gt_target "$R" high-contrast.html; gt_reset_log
IMPECCABLE_CONFIG=/evil IMPECCABLE_X=1 DO_NOT_TRACK=1 gt_gate high run --run-dir "$R" --target "$GT_T"
gt_check "G15 detector sees no IMPECCABLE_* variable and keeps DO_NOT_TRACK" "$(grep '^ENV_IMP=' "$GT_ROOT/stub.log")" "ENV_IMP=0 DNT=1"

# ---------------------------------------------------------------- G16 (SEC-1b: a pty inside a Claude Code context is refused)
# RED: remove the claudeContext() check from requireTerminal() in ux-gate.cjs.
# Runs everywhere (the env arm of the guard answers); a faked terminal plus CLAUDECODE=1 must be refused.
gt_run_dir R; gt_target "$R" low-contrast.html
gt_gate low run --run-dir "$R" --target "$GT_T"
SUM_BEFORE="$(cksum < "$R/gate-record.json") $(cksum < "$R/run.md")"
GT_N=$((GT_N + 1)); GT_OUT="$GT_ROOT/out-$GT_N"
run_bounded 90 "$GT_ROOT/pty-status-$GT_N" "$GT_ROOT/pty-err-$GT_N" -- env CLAUDECODE=1 python3 -I "$GT_ROOT/pty-run.py" "$GT_OUT" "$GT_NODE" "$GT_GATE" accept --run-dir "$R" --finding low-contrast-1 --reason "agent on a faked pty"
GT_RC=$?; GT_SKIP=0
gt_check "G16 accept on a pty with CLAUDECODE=1: exit 2" "$GT_RC" "2"
gt_check "G16 refusal names the Claude Code context and hands Robert the command (count 1)" "$(grep -c 'Claude Code context was detected.*CLAUDECODE' "$GT_OUT")/$(grep -c 'hand Robert this exact command' "$GT_OUT")" "1/1"
gt_check "G16 record and run.md unchanged" "$(cksum < "$R/gate-record.json") $(cksum < "$R/run.md")" "$SUM_BEFORE"
gt_check "G16 finding still open (count 1)" "$(gt_j "$R/gate-record.json" 'r.findings.filter(f=>f.state==="open").length')" "1"
