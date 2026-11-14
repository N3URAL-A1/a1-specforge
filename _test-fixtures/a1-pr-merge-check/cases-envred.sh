# Sourced by run-tests.sh (spec 028 FR-005, wave 4). Uses the suite helpers: new_pr, mc, ce, ci_pr, js, reasons, expect, g, MARK, CIEV.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (wave report, 2026-11-14): run once against `git archive fa73852`; ME1, ME1a, ME4 fail there; ME2, ME2a, ME3, ME5 are controls.

THIS_PLATFORM="$(node -p 'process.platform')"
ENVRED_HERE() { printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"env_red":[{"id":"unit","host":"%s","reason":"env"}]}\n' "$THIS_PLATFORM" > "$1/.a1/verify.json"; }
ENVRED_ELSEWHERE() { printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"env_red":[{"id":"unit","host":"plan9","reason":"env"}]}\n' > "$1/.a1/verify.json"; }

BASE_HOOK=ENVRED_HERE new_pr me1 1 1; BASE_HOOK=; mc
expect "ME1 listed id red on head AND base on this platform, no --bug: exit 0, ok true, no base_red_unreported" "0|true|0" "$RC|$(js 'j.ok')|$(js 'j.reasons.length')"
expect "ME1a suites.env_red names the id with reason and result reason" "unit|env" "$(js 'j.suites.env_red.map(e=>e.id+"|"+e.reason).join()')"

BASE_HOOK=ENVRED_HERE new_pr me2 0 1; BASE_HOOK=; mc
expect "ME2 control/edge: listed id red on head but green on base (Linux CI host case): suite_red_on_head, the merge is blocked" "1|suite_red_on_head" "$RC|$(reasons)"
expect "ME2a the regression is not named under env_red" "true" "$(js 'j.suites.env_red===undefined')"

BASE_HOOK=ENVRED_ELSEWHERE new_pr me3 1 1; BASE_HOOK=; mc
expect "ME3 control: the entry is for another platform: base_red_unreported as before" "1|base_red_unreported" "$RC|$(reasons)"

ENVRED_BAD() { printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"env_red":[{"id":"unit","host":"linux"}]}\n' > "$1/.a1/verify.json"; }
BASE_HOOK=ENVRED_BAD new_pr me4 0 0; BASE_HOOK=; mc
expect "ME4 an env_red entry without reason: exit 2 bad_config" "2|bad_config" "$RC|$(printf '%s' "$ERR" | grep -o 'bad_config' | head -1)"

# ci_evidence path ignores env_red: nothing ran locally, so no env_red in the report
CIENVRED() {
  mkdir -p "$1/.github/workflows"; echo wf > "$1/.github/workflows/ci.yml"; echo g > "$1/guard.txt"
  printf '{"commands":[{"id":"unit","argv":["bash","-c","echo ran >> %s; exit 1"]}],"env_red":[{"id":"unit","host":"%s","reason":"env"}],"ci_evidence":%s}\n' "$MARK" "$THIS_PLATFORM" "$CIEV" > "$1/.a1/verify.json"
}
BASE_HOOK=CIENVRED new_pr me5 0 0; BASE_HOOK=
ce "$WORK/ci-green.json"
expect "ME5 ci_evidence used: the env_red entry has no effect (no env_red key in suites)" "true|true" "$(js 'j.ci_evidence.used')|$(js 'j.suites.env_red===undefined')"
