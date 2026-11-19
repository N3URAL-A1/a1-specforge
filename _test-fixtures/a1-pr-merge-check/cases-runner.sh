# Sourced by run-tests.sh (spec 027 slice 3 wave 8, FR-013/FR-015: merge-check takes the runner path). Uses the suite helpers: mc, js, reasons, expect, ok, bad, g, WORK, REPO_ROOT.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# The planted repo has real runner files on main (bin/run-suites*.sh), two suites under _test-fixtures/, and a verify.json with `each`, so the plan is eligible.
# fake-runner.sh (a1-verify fixture dir) stands in for a base runner that misbehaves. Every run has its own verify lock dir, runner lock dir and a bounded wait.
#
# RED-proof (scratch copy, see STATUS.md wave 8):
#   (d) `runner: true` removed from mergeCheck() : MR1 red
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start
MRW="$WORK/mr"; mkdir -p "$MRW"
cp "$REPO_ROOT/_test-fixtures/a1-verify/fake-runner.sh" "$MRW/fake-runner.sh"

mr_suite() { mkdir -p "$P/_test-fixtures/$1"; printf '#!/usr/bin/env bash\necho "s: 1 passed, 0 failed"\n%s\n' "$2" > "$P/_test-fixtures/$1/run-tests.sh"; }
# mr_repo <label> [base-hook] [head-hook]: hooks are shell snippets run in $P before the base / head commit (cd'd there)
mr_repo() {
  P="$WORK/$1"; rm -rf "${P:?}"; mkdir -p "$P/src" "$P/.a1" "$P/bin" "$P/_test-fixtures"
  git -C "$P" init -q -b main
  printf 'module.exports = 1;\n' > "$P/src/app.js"
  mr_suite s1 'exit 0'; mr_suite s2 'exit 0'
  cp "$REPO_ROOT"/bin/run-suites.sh "$REPO_ROOT"/bin/run-suites-proc.sh "$REPO_ROOT"/bin/run-suites-report.sh "$P/bin/"
  printf '%s\n' '{"serial":[],"no_count":[],"ci_jobs":{},"timings":{}}' > "$P/_test-fixtures/suite-groups.json"
  printf '%s\n' '{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"timeout_ms":60000}' > "$P/.a1/verify.json"
  (cd "$P" && eval "${2:-:}"); g "$P" add -A; g "$P" commit -q -m base; g "$P" checkout -q -b feat
  (cd "$P" && eval "${3:-:}"); printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" add -A; g "$P" commit -q -m head
}
mr_mc() { # mr_mc <label> [mc args]: sets OUT, RC, ERR
  local label="$1"; shift; mkdir -p "$MRW/$label"
  export A1_VERIFY_LOCK_DIR="$MRW/$label/vlock" A1_SUITE_LOCK_DIR="$MRW/$label/rlock" A1_VERIFY_LOCK_WAIT_MS=5000
  lk_token_reset
  mc "$@"
  vlock_restore; unset A1_SUITE_LOCK_DIR
}
MR_FAKE='cp "$MRW/fake-runner.sh" bin/run-suites.sh'
unset A1_FX_RUNNER_MODE A1_FX_RUNNER_SIDES A1_FX_RUNNER_RC A1_FX_RUNNER_ERR

mr_repo mr1; mr_mc mr1
expect "MR1 green through the base runner: exit 0, runner_source base, lock_wait_ms an integer, base_run.ran []" "0|base|true|[]" \
  "$RC|$(js 'j.suites.runner_source')|$(js 'Number.isInteger(j.suites.lock_wait_ms)')|$(js 'JSON.stringify(j.suites.base_run.ran)')"

mr_repo mr2 "$MR_FAKE"; export A1_FX_RUNNER_MODE=drop-one A1_FX_RUNNER_RC=0
mr_mc mr2
expect "MR2 runner drops an id: exit 2, error runner_result_mismatch" "2|runner_result_mismatch" "$RC|$(js 'j.error')"

mr_repo mr3 "$MR_FAKE"; export A1_FX_RUNNER_MODE=exit2 A1_FX_RUNNER_RC=2 A1_FX_RUNNER_ERR='run-suites: unknown argument: --x'
mr_mc mr3
expect "MR3 runner exit 2: exit 2, suite_runner_failed, message holds the stub's text" "2|suite_runner_failed|true" "$RC|$(js 'j.error')|$(js 'j.message.includes("unknown argument: --x")')"

mr_repo mr3b "$MR_FAKE"; export A1_FX_RUNNER_ERR='run-suites: lock wait of 5 ms exceeded; another run holds the lock'
mr_mc mr3b
expect "MR3b runner lock timeout: exit 2, lock_timeout (not red), message holds 'lock wait of 5 ms'" "2|lock_timeout|true" "$RC|$(js 'j.error')|$(js 'j.message.includes("lock wait of 5 ms")')"
unset A1_FX_RUNNER_MODE A1_FX_RUNNER_RC A1_FX_RUNNER_ERR

mr_repo mr4 'printf "%s\n" "{\"each\":\"_test-fixtures/*/run*.sh\",\"argv_prefix\":[\"bash\"],\"timeout_ms\":3000}" > .a1/verify.json; printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nexit 1\n" > _test-fixtures/s1/run-tests.sh' \
  'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nsleep 600\n" > _test-fixtures/s1/run-tests.sh'
mr_mc mr4
expect "MR4 hanging head suite, red base: exit 1, suite_red_on_head with cause timeout, no base_red_unreported" "1|true|false" \
  "$RC|$(js 'JSON.stringify(j.reasons.filter(r=>r.reason==="suite_red_on_head")).includes("timeout")')|$(js 'j.reasons.some(r=>r.reason==="base_red_unreported")')"

lk_leak_end MR
