# Sourced by run-tests.sh (spec 028 FR-003, FR-004, FR-008, wave 1). Uses the suite helpers: new_pr, mc, mcp, ce, ci_pr, js, reasons, expect, g, MARK, CIEV.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (wave report, 2026-11-14): run once against `git archive fa73852`; MH1, MH1b, MH2, MH3 fail there, MH2b and MH4 are controls.

HOSTHOOK() { # base hook: unit green + a red command pinned to a platform no host has
  printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]},{"id":"mac","argv":["bash","-c","exit 1"],"requires_host":["plan9"]}]}\n' > "$1/.a1/verify.json"
}
BASE_HOOK=HOSTHOOK new_pr mh1 0 0; BASE_HOOK=; mc
expect "MH1 local run: a red id pinned to a foreign platform is skipped, not red: exit 0, ok true" "0|true" "$RC|$(js 'j.ok')"
expect "MH1a suites.host has exactly platform, arch, node" "arch,node,platform" "$(js 'Object.keys(j.suites.host).sort().join()')"
expect "MH1b suites.skipped_on_host names the id; suites.hints carries the target-OS hint" "mac|run these ids on the target OS before merge: mac" "$(js 'j.suites.skipped_on_host.map(s=>s.id).join()+"|"+j.suites.hints.join()')"

# the ids are the report's: pinned to THIS platform the same command runs, is red on head and base -> base_red_unreported (control for MH1)
THIS="$(node -p 'process.platform')"
HOSTHOOK_HERE() { printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]},{"id":"mac","argv":["bash","-c","exit 1"],"requires_host":["%s"]}]}\n' "$THIS" > "$1/.a1/verify.json"; }
BASE_HOOK=HOSTHOOK_HERE new_pr mh1c 0 0; BASE_HOOK=; mc
expect "MH1c control: the same red id pinned to this platform runs and blocks (base_red_unreported), nothing skipped" "1|base_red_unreported|0" "$RC|$(reasons)|$(js 'j.suites.skipped_on_host.length')"

# ci_evidence path: nothing ran locally, so host and skipped_on_host are null; a head plan with host-specific ids adds the hint
CIHOST() {
  mkdir -p "$1/.github/workflows"; echo wf > "$1/.github/workflows/ci.yml"; echo g > "$1/guard.txt"
  printf '{"commands":[{"id":"unit","argv":["bash","-c","echo ran >> %s; exit 0"]},{"id":"mac","argv":["bash","-c","exit 1"],"requires_host":["darwin"]},{"id":"old-bash32","argv":["bash","-c","exit 1"]},{"id":"fine","argv":["bash","-c","exit 0"],"requires_host":[]}],"ci_evidence":%s}\n' "$MARK" "$CIEV" > "$1/.a1/verify.json"
}
CIEV='{"workflow":"test","checks":["checks","fx"],"unchanged":[".github/","guard.txt"]}'
BASE_HOOK=CIHOST new_pr mh2 0 0; BASE_HOOK=
ce "$WORK/ci-green.json"
expect "MH2 ci_evidence used: suites.host and suites.skipped_on_host are null" "true|null|null" "$(js 'j.ci_evidence.used')|$(js 'JSON.stringify(j.suites.host)')|$(js 'JSON.stringify(j.suites.skipped_on_host)')"
expect "MH2a the hint names the requires_host id and the -bash32 id (an empty requires_host array does not count), exit 0" "0|ci_evidence used: host-specific ids were not run locally: mac, old-bash32" "$RC|$(js 'j.suites.hints.join()')"
ci_pr mh2b
ce "$WORK/ci-green.json"
expect "MH2b control: ci_evidence plan without host-specific ids: host/skipped null, no hints key" "true|null|true" "$(js 'j.ci_evidence.used')|$(js 'JSON.stringify(j.suites.host)')|$(js 'j.suites.hints===undefined')"

# FR-008
new_pr mh3 1 1; mc
expect "MH3 base_red_unreported carries the --bug hint" "base_red_unreported|re-run with --bug <fix-report-id> on the first run" "$(reasons)|$(js 'j.reasons[0].hint')"
new_pr mh4 0 1; mc
expect "MH4 control: suite_red_on_head carries no base-red hint" "suite_red_on_head|true" "$(reasons)|$(js 'j.reasons[0].hint===undefined')"
