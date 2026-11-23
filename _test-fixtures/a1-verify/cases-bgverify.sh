# Sourced by run-tests.sh (spec 027 slice 4, FR-024, plan D13, Task 8.1: background `verify run` in the Verify workflow).
# Uses the suite helpers: newproj, stub, cfg, seal, vrun, check, check_rc, ok, bad, js, g. The lock dir is the suite's private one
# (vlock_private in the harness head); every wait below is bounded. Not named run*.sh on purpose (.a1/verify.json expands run*.sh).
#
# The start and join fences are copied from skills/a1-execute/workflows/03-verify.md by awk (the first bash fence after the marker),
# with <phase_name> -> fx and <repo> -> this checkout; the join copy has `sleep 15` shortened to `sleep 0.2` and nothing else changed.
#
# RED-proof (scratch copy, 2026-11-23, see STATUS.md):
#   (d) BV1 with --no-cache on the foreground run                -> BV1 red (cache off)
#   (e) --path-format=absolute dropped from the start fence      -> BV5 red
#   (j) the pid liveness check dropped from the join fence       -> BV4 red (join runs into the bound)
BV_ROOT="${TOOLS%/_shared/a1-tools.cjs}"
BV_FILE="${A1_FX_BG_FILE:-$BV_ROOT/skills/a1-execute/workflows/03-verify.md}"

# bv_fence <marker regex> -> stdout: the first ```bash fence after the marker, placeholders replaced
bv_fence() {
  awk -v m="$1" '$0 ~ m { f = 1; next } f && /^```bash$/ { g = 1; next } g && /^```$/ { exit } g { print }' "$BV_FILE" \
    | sed -e "s#<phase_name>#fx#g" -e "s#<repo>#$BV_ROOT#g"
}
BV_START="$(bv_fence 'a1:background id=verify-bg')"
BV_JOIN="$(bv_fence 'a1:join id=verify-bg' | sed -e 's#sleep 15#sleep 0.2#')"
[[ -n "$BV_START" && -n "$BV_JOIN" ]] && ok "BV0 start and join fences found after their markers" || bad "BV0 fences missing (start=${#BV_START} join=${#BV_JOIN} bytes)"

# bv_start <project> [cwd]: runs the start fence; sets BV_OUT, BV_RC_FILE (path printed by the fence), BV_VBG
bv_start() {
  local cwd="${2:-$1}"
  BV_OUT="$(cd "$cwd" && WORK_PATH="$1" bash -c "$BV_START" 2>"$WORK/bv-err")"
  BV_RC_FILE="$(printf '%s' "$BV_OUT" | sed -n 's/.* verify_rc=//p')"
  BV_VBG="${BV_RC_FILE%/rc}"
}
# bv_join <project> [max-tenths]: runs the join fence under an own-PID bound (default 30 s); sets BV_JOUT, BV_JTENTHS
bv_join() {
  local jp i=0 max="${2:-300}"
  ( cd "$1" && WORK_PATH="$1" bash -c "$BV_JOIN" > "$WORK/bv-join" 2>&1 ) & jp=$!
  while kill -0 "$jp" 2>/dev/null && [[ $i -lt $max ]]; do sleep 0.1; i=$((i + 1)); done
  if kill -0 "$jp" 2>/dev/null; then kill "$jp" 2>/dev/null; fi
  wait "$jp" 2>/dev/null; BV_JOUT="$(cat "$WORK/bv-join")"; BV_JTENTHS=$i
}
# bv_wait_report <vbg>: waits (bounded 20 s) until the background node child has written its report
bv_wait_report() { local i=0; while [[ ! -s "$1/report.json" && $i -lt 200 ]]; do sleep 0.1; i=$((i + 1)); done; }

# BV1: green project: start, join, foreground --out is a cache hit, rc file holds 0
newproj bv1; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; seal
bv_start "$P"
bv_join "$P"
vrun "$P" --out "$WORK/bv1-VERIFICATION.md"
check "BV1 green: --out run exits 0 and is served from the cache (hit)" 0 'j.verdict+"|"+j.cache.head' "pass|hit"
[[ "$(cat "$BV_VBG/rc" 2>/dev/null)" == "0" && "$BV_JOUT" == *"background verify rc=0"* ]] && ok "BV1b rc file holds 0, join reports it" || bad "BV1b rc='$(cat "$BV_VBG/rc" 2>/dev/null)' join='$BV_JOUT' start='$BV_OUT'"

# BV2: red project: rc file holds 1 and the --out run exits 1
newproj bv2; stub bad 'exit 1'; cfg '{"commands":[{"id":"unit","argv":["./bin/bad"]}]}'; seal
bv_start "$P"; bv_join "$P"
vrun "$P" --out "$WORK/bv2-VERIFICATION.md"
check_rc "BV2 red: --out run exits 1" 1
[[ "$(cat "$BV_VBG/rc" 2>/dev/null)" == "1" ]] && ok "BV2b rc file holds 1" || bad "BV2b rc='$(cat "$BV_VBG/rc" 2>/dev/null)'"

# BV3: Victor writes .a1/phases/x/VERIFICATION.md between the background run and --out: still a cache hit
newproj bv3; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; seal
bv_start "$P"; bv_join "$P"
mkdir -p "$P/.a1/phases/x"; printf -- '---\nverdict: PASS\n---\n# victor wrote this\n' > "$P/.a1/phases/x/VERIFICATION.md"
vrun "$P" --out "$P/.a1/phases/x/VERIFICATION.md"
check "BV3 VERIFICATION.md written after the background run: --out is still a cache hit" 0 'j.verdict+"|"+j.cache.head' "pass|hit"

# BV4: the background process is killed (own PID from the pid file) before it writes rc: join says died within 30 s
newproj bv4; stub slow 'sleep 4; exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/slow"]}]}'; seal
bv_start "$P"
BV4PID="$(cat "$BV_VBG/pid" 2>/dev/null)"
if [[ "$BV4PID" =~ ^[0-9]+$ ]]; then kill "$BV4PID" 2>/dev/null; wait "$BV4PID" 2>/dev/null; fi
bv_join "$P"
[[ "$BV_JOUT" == *"background verify died"* && $BV_JTENTHS -lt 300 && ! -e "$BV_VBG/rc" ]] \
  && ok "BV4 killed background process: join prints 'background verify died' in $((BV_JTENTHS / 10)) s, no rc file" \
  || bad "BV4 join='$BV_JOUT' tenths=$BV_JTENTHS rc-exists=$([[ -e "$BV_VBG/rc" ]] && echo yes || echo no)"
bv_wait_report "$BV_VBG"   # the orphaned node child ends by itself (sleep 4); do not leave it running into the next case

# BV5: start fence run from a cwd outside the project: absolute marker dir inside the project's git common dir, nothing under the cwd
newproj bv5; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; seal
mkdir -p "$WORK/bv5-elsewhere"
bv_start "$P" "$WORK/bv5-elsewhere"
BV5GC="$(git -C "$P" rev-parse --path-format=absolute --git-common-dir)"
bv_join "$P"
if [[ "$BV_VBG" == /* && "$BV_VBG" == "$BV5GC"/* && -f "$BV_VBG/report.json" && -f "$BV_VBG/rc" && -f "$BV_VBG/pid" && -z "$(ls -A "$WORK/bv5-elsewhere")" ]]; then
  ok "BV5 start from another cwd: marker dir is absolute and inside the project's git common dir, nothing under the cwd"
else
  bad "BV5 vbg='$BV_VBG' gc='$BV5GC' cwd-content='$(ls -A "$WORK/bv5-elsewhere" 2>&1 | tr '\n' ' ')' start='$BV_OUT'"
fi
