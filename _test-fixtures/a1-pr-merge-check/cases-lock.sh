# Sourced by run-tests.sh (spec 027 slice 3, FR-017: the CI-evidence path takes no lock). Uses the suite helpers: ci_pr, ce, mc, new_pr, js, expect, ok, bad.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
# RED-proof (scratch copy, see STATUS-verify.md): pr-merge-check.cjs mergeCheck(): lock acquired at the top : MLK1 red
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start

# mlk_holder: a live process owning $A1_VERIFY_LOCK_DIR (marker on its command line, polled before the owner file is written)
mlk_holder() {
  local i=0 cmd=""
  mkdir -p "$A1_VERIFY_LOCK_DIR"
  node -e 'setTimeout(()=>process.exit(0), 60000)' a1-tools-fx-holder &
  MLK_PID=$!
  while [[ $i -lt 40 ]]; do cmd="$(ps -o command= -p "$MLK_PID" 2>/dev/null)"; [[ "$cmd" == *a1-tools-fx-holder* ]] && break; sleep 0.05; i=$((i + 1)); done
  [[ "$cmd" == *a1-tools-fx-holder* ]] || { bad "holder never showed its marker on ps"; kill "$MLK_PID" 2>/dev/null; return 1; }
  node -e 'require("fs").writeFileSync(process.argv[1]+"/owner.json",JSON.stringify({pid:Number(process.argv[2]),token:"0123456789abcdef0123456789abcdef",cmd:process.argv[3],started_at:"x"}))' "$A1_VERIFY_LOCK_DIR" "$MLK_PID" "$cmd"
}
mlk_stop() { kill "$MLK_PID" 2>/dev/null; wait "$MLK_PID" 2>/dev/null; return 0; }
mlk_env() { mkdir -p "$WORK/vl-$1"; export A1_VERIFY_LOCK_DIR="$WORK/vl-$1/lock" A1_VERIFY_LOCK_WAIT_MS=1500; lk_token_reset; }
mlk_clear() { unset A1_VERIFY_LOCK_DIR A1_VERIFY_LOCK_WAIT_MS; lk_token_reset; }

mlk_env mlk1; ci_pr mlk1
if mlk_holder; then
  b4="$(cksum < "$A1_VERIFY_LOCK_DIR/owner.json")"; ce "$WORK/ci-green.json"; af="$(cksum < "$A1_VERIFY_LOCK_DIR/owner.json")"; mlk_stop
  expect "MLK1 green CI evidence while the verify lock is held: exit 0, evidence used, suites.lock_wait_ms null" "0|true|null" "$RC|$(js 'j.ci_evidence.used')|$(js 'j.suites.lock_wait_ms')"
  [[ "$b4" == "$af" ]] && ok "MLK1b holder owner.json unchanged" || bad "MLK1b owner.json changed"
fi

mlk_env mlk2; ci_pr mlk2
if mlk_holder; then ce "$WORK/ci-green.json" --no-ci-evidence; mlk_stop
  expect "MLK2 control, --no-ci-evidence while the lock is held: exit 2 lock_timeout" "2|lock_timeout" "$RC|$(js 'j.error')"
fi

mlk_env mlk3; new_pr mlk3 0 0; mc
expect "MLK3 serial run without a holder: suites.lock_wait_ms is an integer >= 0" "true" "$(js 'Number.isInteger(j.suites.lock_wait_ms) && j.suites.lock_wait_ms >= 0')"
mlk_clear

lk_leak_end MLK
