# Sourced by run-tests.sh (spec 027 slice 3, FR-017/FR-018: CLI lock of `verify run`). Uses the suite helpers: newproj, stub, cfg, seal, vrun, check, check_rc, ok, bad, js.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# Every case points A1_VERIFY_LOCK_DIR into $WORK, so a fixture run never waits on a developer's real lock.
# RED-proof (scratch copy, see STATUS-verify.md):
#   (a) verify-run.cjs runEnv: token not put into the env       : LK8, LK11 red
#   (b) verify-lock.cjs: nested branch removed                  : LK4 red
#   (c) verify-lock.cjs: dead-PID takeover removed              : LK2 red
#   (d) verify-lock.cjs ownerLive(): cmd comparison removed     : LK6 red
#   (e) verify-lock.cjs: wait loop returns at once              : LK1 red
#   (g) verify-run.cjs: lock taken before resolveCommands       : LK12 red
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start

VL_PID=""; VL_TOKEN=""
# vl_env <case>: isolated lock dir under $WORK, no inherited token, no wait override
vl_env() { mkdir -p "$WORK/vl-$1"; VL_DIR="$WORK/vl-$1/lock"; export A1_VERIFY_LOCK_DIR="$VL_DIR"; unset A1_VERIFY_LOCK_TOKEN; export A1_VERIFY_LOCK_WAIT_MS=5000; }
vl_clear() { unset A1_VERIFY_LOCK_DIR A1_VERIFY_LOCK_TOKEN A1_VERIFY_LOCK_WAIT_MS; }
# vl_holder <seconds> [release] [owner-cmd]: live holder process owning $VL_DIR. Polls ps until its command line shows the marker
# (never reached: bad + return 1), then writes owner.json. With `release` the holder removes the lock dir after the seconds.
vl_holder() {
  local secs="$1" rel="${2:-}" ocmd="${3:-}" i=0 cmd=""
  mkdir -p "$VL_DIR"
  node -e 'const [d,s,r]=process.argv.slice(1);setTimeout(()=>{if(r==="release")require("fs").rmSync(d,{recursive:true,force:true});process.exit(0)},Number(s)*1000)' "$VL_DIR" "$secs" "$rel" a1-tools-fx-holder &
  VL_PID=$!
  while [[ $i -lt 40 ]]; do
    cmd="$(ps -o command= -p "$VL_PID" 2>/dev/null)"
    [[ "$cmd" == *a1-tools-fx-holder* ]] && break
    sleep 0.05; i=$((i + 1))
  done
  if [[ "$cmd" != *a1-tools-fx-holder* ]]; then bad "holder never showed its marker on ps"; kill "$VL_PID" 2>/dev/null; return 1; fi
  VL_TOKEN="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  node -e 'require("fs").writeFileSync(process.argv[1]+"/owner.json",JSON.stringify({pid:Number(process.argv[2]),token:process.argv[3],cmd:process.argv[4],started_at:"x"}))' "$VL_DIR" "$VL_PID" "$VL_TOKEN" "${ocmd:-$cmd}"
}
vl_stop() { [[ -n "$VL_PID" ]] && kill "$VL_PID" 2>/dev/null; wait "$VL_PID" 2>/dev/null; VL_PID=""; return 0; }
vl_green() { newproj "$1"; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; seal; }
now_ms() { node -p 'Date.now()'; }

vl_env lk1; vl_green lk1
if vl_holder 1.5 release; then vrun "$P"; vl_stop
  check "LK1 lock released after 1.5 s: waited, then ran (lock held, lock_wait_ms >= 1000)" 0 'j.verdict+"|"+j.lock+"|"+(j.lock_wait_ms>=1000)' "pass|held|true"
fi

vl_env lk2; vl_green lk2; export A1_VERIFY_LOCK_WAIT_MS=3000; mkdir -p "$VL_DIR"; sleep 0 & DEADP=$!; wait "$DEADP"
node -e 'require("fs").writeFileSync(process.argv[1]+"/owner.json",JSON.stringify({pid:Number(process.argv[2]),token:"0123456789abcdef0123456789abcdef",cmd:"sleep 0",started_at:"x"}))' "$VL_DIR" "$DEADP"
vrun "$P"
check "LK2 dead owner PID: taken over without a wait" 0 'j.verdict+"|"+j.lock+"|"+(j.lock_wait_ms<1000)' "pass|held|true"
[[ ! -e "$VL_DIR" ]] && ok "LK2b lock dir removed after the run" || bad "LK2b lock dir left behind"

vl_env lk3; vl_green lk3; export A1_VERIFY_LOCK_WAIT_MS=1500
if vl_holder 60; then t0="$(now_ms)"; vrun "$P"; t1="$(now_ms)"; vl_stop
  check "LK3 permanent holder: exit 2 lock_timeout" 2 'j.error' "lock_timeout"
  [[ $((t1 - t0)) -ge 1500 ]] && ok "LK3b waited at least the 1500 ms ceiling" || bad "LK3b returned after $((t1 - t0)) ms"
fi

vl_env lk4; vl_green lk4; export A1_VERIFY_LOCK_WAIT_MS=1500
if vl_holder 60; then
  before="$(cksum < "$VL_DIR/owner.json")"; export A1_VERIFY_LOCK_TOKEN="$VL_TOKEN"; vrun "$P"; after="$(cksum < "$VL_DIR/owner.json")"; vl_stop
  check "LK4 matching token of a live owner: nested, no wait" 0 'j.verdict+"|"+j.lock+"|"+j.lock_wait_ms' "pass|nested|0"
  [[ "$before" == "$after" ]] && ok "LK4b holder owner.json byte-identical afterwards" || bad "LK4b owner.json changed"
fi

vl_env lk5; vl_green lk5; export A1_VERIFY_LOCK_WAIT_MS=1500
if vl_holder 60; then export A1_VERIFY_LOCK_TOKEN="ffffffffffffffffffffffffffffffff"; vrun "$P"; vl_stop
  check "LK5 wrong token waits like none: exit 2 lock_timeout" 2 'j.error' "lock_timeout"
fi

vl_env lk6; vl_green lk6; export A1_VERIFY_LOCK_WAIT_MS=3000
if vl_holder 60 "" other; then vrun "$P"; vl_stop
  check "LK6 live PID but its command line differs from the owner cmd: taken over" 0 'j.verdict+"|"+j.lock' "pass|held"
fi

vl_env lk7; vl_green lk7; mkdir -p "$WORK/vl-lk7/target"; ln -s "$WORK/vl-lk7/target" "$VL_DIR"
vrun "$P"
check "LK7 symlink at the lock path: exit 2 lock_unusable" 2 'j.error' "lock_unusable"

vl_env lk8; vl_green lk8
stub ok "printf '%s' \"\$A1_VERIFY_LOCK_TOKEN\" > \"$WORK/lk8-env\"; node -p 'require(process.argv[1]).token' \"\$A1_VERIFY_LOCK_DIR/owner.json\" > \"$WORK/lk8-owner\"; exit 0"
g "$P" add -A; g "$P" commit -q -m stub
vrun "$P"
LK8E="$(cat "$WORK/lk8-env" 2>/dev/null)"; LK8O="$(tr -d '\n' < "$WORK/lk8-owner" 2>/dev/null)"
[[ "$LK8E" =~ ^[0-9a-f]{32}$ && "$LK8E" == "$LK8O" ]] && ok "LK8 every command sees the owner's token (32 hex)" || bad "LK8 env='$LK8E' owner='$LK8O' err=$ERR"

LK9="$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const m=s.match(/SUITE_ENV_DROP = Object.freeze\(\[([^\]]*)\]/);process.stdout.write(m&&!m[1].includes("A1_VERIFY_LOCK_TOKEN")?"clean":"bad")' "$REPO_ROOT/_shared/lib/verify-run.cjs")"
[[ "$LK9" == clean ]] && ok "LK9 SUITE_ENV_DROP does not list A1_VERIFY_LOCK_TOKEN" || bad "LK9 token dropped from suite env"

vl_env lk10; vl_green lk10; export A1_VERIFY_LOCK_WAIT_MS=abc; vrun "$P"
check "LK10 A1_VERIFY_LOCK_WAIT_MS=abc: exit 2 lock_unusable" 2 'j.error' "lock_unusable"
vl_env lk10b; export A1_VERIFY_LOCK_DIR="relative/lock"; vrun "$P"
check "LK10b relative A1_VERIFY_LOCK_DIR: exit 2 lock_unusable" 2 'j.error' "lock_unusable"

vl_env lk11; vl_green lk11; INNER="$P"
newproj lk11o; stub ok "node \"$TOOLS\" verify run --project \"$INNER\" --phase fx > \"$WORK/lk11-inner.json\" 2>/dev/null; exit \$?"
cfg '{"commands":[{"id":"outer","argv":["./bin/ok"]}]}'; seal
export A1_VERIFY_LOCK_WAIT_MS=2000; vrun "$P"
check "LK11 outer run with a nested verify run: exit 0, no deadlock" 0 'j.verdict+"|"+j.lock' "pass|held"
LK11N="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lock' "$WORK/lk11-inner.json" 2>/dev/null)"
[[ "$LK11N" == nested ]] && ok "LK11b the inner report says lock nested" || bad "LK11b inner lock='$LK11N'"

vl_env lk12; newproj lk12; printf '{not json' > "$P/.a1/verify.json"; seal; export A1_VERIFY_LOCK_WAIT_MS=3000
if vl_holder 60; then t0="$(now_ms)"; vrun "$P"; t1="$(now_ms)"; vl_stop
  check "LK12 bad_config is exit 2 bad_config (the lock comes after config resolution)" 2 'j.error' "bad_config"
  [[ $((t1 - t0)) -lt 1500 ]] && ok "LK12b returned without waiting on the lock" || bad "LK12b took $((t1 - t0)) ms"
fi
vl_clear

lk_leak_end LK
