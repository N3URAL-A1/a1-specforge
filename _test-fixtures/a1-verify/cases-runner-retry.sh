# Sourced by run-tests.sh after cases-runner-path.sh (spec 027 slice 3 wave 8, FR-015: retry order, watchdog, env equality, lock wait).
# Reuses rp_repo, rp_suite, rp_count, RPW, FAKE_BASE from cases-runner-path.sh. Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# Every run has its own verify lock dir and runner lock dir and a bounded wait; the outer A1_VERIFY_LOCK_TOKEN is dropped for the child only (env -u).
# rr_run keeps rp_run's contract (OUT, RC, ERR, RP_LOG) and adds RR_MS (wall time); the call runs in the background under a 120 s kill bound
# (portable: no `timeout`), and RP_WAIT_MS sets the verify lock wait.
#
# RED-proof (scratch copy, see STATUS.md wave 8):
#   (a) the retry runner call moved before the base call           : RR2 order red
#   (b) --suite-timeout-ms dropped from the runner argv             : RR1 red
#   (c) the base side given a different env                         : RR4 red
#   (e) --lock-wait passed as 0                                     : RR5 red
#   (f) the runner side waits not added to the top-level lock_wait_ms : RR5 red
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start
RRW="$WORK/rr"; mkdir -p "$RRW"
rr_run() {
  RP_LOG="$RRW/$2.log"; : > "$RP_LOG"; mkdir -p "$RRW/$2"
  local t0 pid kpid; t0="$(node -p 'Date.now()')"
  ( cd "$1" && exec env -u A1_VERIFY_LOCK_TOKEN A1_VERIFY_LOCK_DIR="$RRW/$2/vlock" A1_VERIFY_LOCK_WAIT_MS="${RP_WAIT_MS:-5000}" A1_SUITE_LOCK_DIR="$RRW/$2/rlock" \
    A1_VERIFY_SPAWN_LOG="$RP_LOG" node -e '
      const r = require(process.argv[1]);
      try { process.stdout.write(JSON.stringify(r.runVerify({ project: process.argv[2], base: "main", noCache: true, lazyBase: true, runner: true }))); }
      catch (e) { if (!(e instanceof r.VerifyError)) throw e; process.stdout.write(JSON.stringify({ error: e.reason, message: e.message })); }' \
    "$REPO_ROOT/_shared/lib/verify-run.cjs" "$1" > "$RRW/$2.out" 2> "$RRW/$2.err" ) &
  pid=$!
  ( sleep 120; kill -KILL "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  kpid=$!
  wait "$pid"; RC=$?
  kill "$kpid" 2>/dev/null; wait "$kpid" 2>/dev/null
  RR_MS=$(( $(node -p 'Date.now()') - t0 ))
  OUT="$(cat "$RRW/$2.out")"; ERR="$(cat "$RRW/$2.err")"
}
# rr_holder <case> <seconds>: a live process that looks like a runner (its command line holds run-suites.sh) owns the case's runner lock dir.
rr_holder() {
  local d="$RRW/$1/rlock" i=0 cmd=""
  mkdir -p "$d"
  node -e 'setTimeout(()=>process.exit(0), Number(process.argv[1]) * 1000)' "$2" run-suites.sh-fx-holder &
  RR_PID=$!
  while [[ $i -lt 40 ]]; do cmd="$(ps -o command= -p "$RR_PID" 2>/dev/null)"; [[ "$cmd" == *run-suites.sh-fx-holder* ]] && break; sleep 0.05; i=$((i + 1)); done
  [[ "$cmd" == *run-suites.sh-fx-holder* ]] || { bad "RR holder never showed its marker on ps"; kill "$RR_PID" 2>/dev/null; return 1; }
  printf '%s\n' "$RR_PID" > "$d/pid.tmp"; mv "$d/pid.tmp" "$d/pid"
}
rr_stop() { kill "$RR_PID" 2>/dev/null; wait "$RR_PID" 2>/dev/null; return 0; }
unset A1_FX_RUNNER_MODE A1_FX_RUNNER_SIDES A1_FX_RUNNER_RC A1_FX_RUNNER_ERR
CFG_T='{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"timeout_ms":3000}'

# RR1: head hangs, base is red: the watchdog fires, reason timeout, the base red is not pre-existing for a hang
rp_repo rr1 'cfg "$CFG_T"; printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nexit 1\n" > _test-fixtures/s1/run-tests.sh' 'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nsleep 600\n" > _test-fixtures/s1/run-tests.sh'
rr_run "$P" rr1
check "RR1 hanging head suite: verdict fail, reason timeout, pre_existing_red empty, total < 60000 ms" 0 \
  'j.verdict+"|"+j.commands.find(c=>c.id.includes("s1")).reason+"|"+j.pre_existing_red.length+"|"+(j.duration_ms.total<60000)' "fail|timeout|0|true"

# RR2: flaky on head: the order of runner calls is head, then base, then retry
CFG_F='{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"timeout_ms":60000,"flaky_base":["_test-fixtures/s1/run-tests.sh"]}'
rp_repo rr2 'cfg "$CFG_F"; printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nn=\$(cat \"\$A1_FX_CTR\" 2>/dev/null || echo 0); echo \$((n+1)) > \"\$A1_FX_CTR\"\n[ \"\$n\" -ge 1 ] && exit 0\nexit 1\n" > _test-fixtures/s1/run-tests.sh'
export A1_FX_CTR="$RRW/rr2.ctr"; rm -f "$A1_FX_CTR"; rr_run "$P" rr2; unset A1_FX_CTR
check "RR2 flaky s1: verdict pass, retried, flaky names s1, retry side requested 1" 0 \
  'j.verdict+"|"+j.commands.find(c=>c.id.includes("s1")).retried+"|"+j.flaky.map(f=>JSON.stringify(f)).join("").includes("s1")+"|"+j.runner.sides.retry.requested' "pass|true|true|1"
ORDER="$(grep '^runner:' "$RP_LOG" | cut -f1 | uniq | tr '\n' ',')"
[[ "$ORDER" == "runner:head,runner:base,runner:retry," ]] && ok "RR2b spawn-log order: runner:head, runner:base, runner:retry" || bad "RR2b order: $ORDER ($(cat "$RP_LOG"))"

# RR3: red on head and base: pre-existing, verdict pass
rp_repo rr3 'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nexit 1\n" > _test-fixtures/s1/run-tests.sh'; rr_run "$P" rr3
check "RR3 red on head and base: pre_existing_red names s1, verdict pass" 0 'j.verdict+"|"+j.pre_existing_red.map(p=>JSON.stringify(p)).join("").includes("s1")' "pass|true"

# RR4: environment equality between the base and the head side
ENVBODY='printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nside=head; case \"\$PWD\" in *a1-fx-verify-base-*) side=base ;; esac\nenv | LC_ALL=C sort | grep -v -E \"^(HOME|A1_VAULT_ROOT|PWD|OLDPWD|_|SHLVL)=\" > \"\$A1_FX_ENVDIR/\$side.env\"\nexit 1\n" > _test-fixtures/s1/run-tests.sh'
rp_repo rr4 "$ENVBODY"; export A1_FX_ENVDIR="$RRW/rr4env"; rm -rf "$A1_FX_ENVDIR"; mkdir -p "$A1_FX_ENVDIR"; rr_run "$P" rr4; unset A1_FX_ENVDIR
check "RR4 setup: both sides ran (red on both, pass)" 0 'j.verdict' "pass"
if [[ -s "$RRW/rr4env/base.env" && -s "$RRW/rr4env/head.env" ]] && diff "$RRW/rr4env/base.env" "$RRW/rr4env/head.env" >/dev/null; then ok "RR4b base and head suite environments are equal (both non-empty)"
else bad "RR4b env: $(ls "$RRW/rr4env"); $(diff "$RRW/rr4env/base.env" "$RRW/rr4env/head.env" 2>&1 | head -5)"; fi

# RR5 (D18): a live runner holds the runner lock for 5 s: the wait shows in the head side and in the top-level lock_wait_ms
rp_repo rr5; mkdir -p "$RRW/rr5"
if rr_holder rr5 5; then RP_WAIT_MS=30000 rr_run "$P" rr5; rr_stop
  check "RR5 runner lock held 5 s: verdict pass, head side lock_wait_ms >= 1000, top-level >= head side" 0 \
    'j.verdict+"|"+(j.runner.sides.head.lock_wait_ms>=1000)+"|"+(j.lock_wait_ms>=j.runner.sides.head.lock_wait_ms)' "pass|true|true"
  check "RR5b the verify lock was free: top-level minus the side waits < 1000" 0 \
    'const s=j.runner.sides; const w=["head","base","retry"].reduce((a,k)=>a+(s[k]?s[k].lock_wait_ms:0),0); (j.lock_wait_ms-w)<1000' "true"
fi

# RR6 (D18): the holder outlasts the wait: lock_timeout with the runner text, bounded wall time
rp_repo rr6; mkdir -p "$RRW/rr6"
if rr_holder rr6 60; then RP_WAIT_MS=2000 rr_run "$P" rr6; rr_stop
  check "RR6 runner lock held past A1_VERIFY_LOCK_WAIT_MS: error lock_timeout, message holds 'lock wait of'" 0 'j.error+"|"+j.message.includes("lock wait of")' "lock_timeout|true"
  [[ "$RR_MS" -ge 1500 && "$RR_MS" -lt 30000 ]] && ok "RR6b wall time $RR_MS ms is in [1500, 30000)" || bad "RR6b wall time $RR_MS ms"
fi

lk_leak_end RR
