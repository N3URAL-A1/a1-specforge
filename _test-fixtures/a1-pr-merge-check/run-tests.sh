#!/usr/bin/env bash
# Fixture: `a1-tools pr merge-check` and `product validate --spec-status --require-vault`
# (spec 017-enforced-self-checks, Wave 10, FR-034, FR-036, FR-037; FR-016 and FR-025 merge side; SC-004).
#
# Inputs: temp git repos with a base commit on main and a head commit on feat; the tiny suite is a bash script
# whose exit code is flipped between base and head (the planted defect; flipping it back turns the case green, M1).
# `gh` is a bash stub injected through the A1_GH_BIN seam (no PATH trick); its `pr checks` answers are the
# documented `gh pr checks --json name,bucket,state` shape. The vault case uses the REAL spec file
# _test-fixtures/a1-vault-cockpit/spec-drift/005-vault-first-artifacts.md in a sentinel temp vault.
#
# Measured red (git-archive snapshot, one production line reverted, suite run; cases that fail):
#   Measured red 2026-10-21:
#   Round C (review fixes), measured against the code before the fix:
#   pr-merge-guards.cjs OWN_OUTPUT: `.a1-review/` entry removed                                         : I7
#   pr-merge-check.cjs mergeCheck(): runVerify without noCache (forged head cache trusted)             : N6 (needs verify run --no-cache)
#   pr-merge-check.cjs: --accept-config-change flag back in KNOWN_FLAGS                                : L2
#   pr-merge-check.cjs suiteReasons(): suite verdict ignored (`record.verdict !== 'pass'` -> false)   : B1, M1
#   pr-merge-check.cjs suiteReasons(): base_red_unreported branch off                                  : B2
#   pr-merge-check.cjs bugResolves(): every --bug id resolves                                          : B4, B6, B8
#   pr-merge-check.cjs bugResolves(): `.postmortem` exclusion removed                                  : B5
#   pr-merge-check.cjs isReport(): frontmatter check removed                                           : B6
#   pr-merge-check.cjs bugResolves(): vault dir ignores --slug                                         : B8
#   pr-merge-check.cjs requiredChecks(): pending list emptied                                          : C2
#   pr-merge-check.cjs requiredChecks(): only bucket `fail` counts red (cancel / no-shape pass)        : C3
#   pr-merge-check.cjs requiredChecks(): `--required` dropped from the gh args                         : A1
#   pr-merge-check.cjs requiredChecks(): "no required checks reported" branch removed                  : C6
#   pr-merge-check.cjs resolveBaseRef(): always `main` (gh pr view not asked)                          : C9
#   pr-merge-check.cjs mergeCheck(): flakyBaseReasons not added                                        : D1, D3
#   pr-merge-check.cjs mergeCheck(): pendingOrOverturned not added                                     : E1, E3
#   product-validate.cjs: requireVaultOrExit() call removed                                            : H2, H3, H3b, H3c, H5
#   product-validate.cjs requireVaultOrExit(): vault directory check -> true                           : H2, H3, H3b, H3c
#   product-validate.cjs requireVaultOrExit(): --ci exclusion removed                                  : H5
#   product-validate.cjs: --require-vault no longer implies --spec-status                              : H6, H7
#   Not covered by an in-suite mutation: the nested-call gate-log rule (F2) holds because merge-check
#   calls runVerify in process; it would turn red if cmdPrMergeCheck spawned `a1-tools verify run`.
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID A1_GH_BIN
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
REAL_SPEC="$REPO_ROOT/_test-fixtures/a1-vault-cockpit/spec-drift/005-vault-first-artifacts.md"

. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2
mk_workdir WORK fx-merge-check
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 HOME="$WORK/home"
mkdir -p "$HOME" "$WORK/bin"

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }

g() { local d="$1"; shift; git -C "$d" -c commit.gpgsign=false -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null "$@"; }

# gh stub: records argv, answers `pr view` with the base branch (or the head sha, A1_FX_HEAD else the cwd HEAD) and `pr checks` from A1_FX_CHECKS (+ rc, stderr).
cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${A1_FX_GH_LOG:?}"
case "$1 $2" in
  "pr view")
    case "$*" in
      *headRefOid*) printf '{"headRefOid":"%s"}\n' "${A1_FX_HEAD:-$(git rev-parse HEAD)}"; exit 0 ;;
      *) printf '{"baseRefName":"main"}\n'; exit 0 ;;
    esac ;;
  "pr checks")
    [ -n "${A1_FX_CHECKS_ERR:-}" ] && printf '%s\n' "$A1_FX_CHECKS_ERR" >&2
    [ -n "${A1_FX_CHECKS:-}" ] && cat "$A1_FX_CHECKS"
    exit "${A1_FX_CHECKS_RC:-0}" ;;
  *) echo "unexpected gh args: $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$WORK/bin/gh"
export A1_FX_GH_LOG="$WORK/gh.log"; : > "$A1_FX_GH_LOG"
printf '[{"name":"test","bucket":"pass","state":"SUCCESS"},{"name":"lint","bucket":"pass","state":"SUCCESS"}]\n' > "$WORK/checks-green.json"
printf '[{"name":"test","bucket":"pass","state":"SUCCESS"},{"name":"lint","bucket":"fail","state":"FAILURE"}]\n' > "$WORK/checks-red.json"
printf '[{"name":"test","bucket":"pending","state":"IN_PROGRESS"}]\n' > "$WORK/checks-pending.json"
printf '[{"name":"test","bucket":"cancel","state":"CANCELLED"}]\n' > "$WORK/checks-cancel.json"
printf '[{"name":"weird"}]\n' > "$WORK/checks-noshape.json"

js() { printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
reasons() { js "j.reasons.map(r=>r.reason).sort().join(',')"; }

# new_pr <label> <base-exit> <head-exit>: main has the tiny suite with <base-exit>; feat changes source and the suite to <head-exit>.
new_pr() {
  P="$WORK/$1"; rm -rf "${P:?}"; mkdir -p "$P/src" "$P/.a1"
  git -C "$P" init -q -b main
  printf 'module.exports = 1;\n' > "$P/src/app.js"
  printf '#!/usr/bin/env bash\nexit %s\n' "$2" > "$P/suite.sh"
  printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}]}\n' > "$P/.a1/verify.json"
  ${BASE_HOOK:-:} "$P"
  g "$P" add -A; g "$P" commit -q -m base; g "$P" checkout -q -b feat
  printf 'module.exports = 2;\n' > "$P/src/app.js"
  printf '#!/usr/bin/env bash\nexit %s\n' "$3" > "$P/suite.sh"
  g "$P" add -A; g "$P" commit -q -m head
}
# mc [args...]: merge-check in $P with the gh stub; sets OUT, RC, ERR.
mc() {
  OUT="$(cd "$P" && A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="${CHK:-$WORK/checks-green.json}" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 "$@" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}
CHK="$WORK/checks-green.json"

# ---------- A: green ----------
new_pr a1 0 0; mc
expect "A1 all green: exit 0" 0 "$RC"
expect "A1 ok true, no reasons (count)" "true|0" "$(js 'j.ok+"|"+j.reasons.length')"
expect "A1 suites verdict pass, 2 required checks seen (count)" "pass|2|0|0" "$(js 'j.suites.verdict+"|"+j.required_checks.total+"|"+j.required_checks.red+"|"+j.required_checks.pending')"
expect "A1 PR number and base echoed" "7|main" "$(js 'j.pr+"|"+j.base')"
expect "A1 gh seam called with --required (not a PATH trick)" "1" "$(grep -c '^pr checks 7 --required --json name,bucket,state$' "$A1_FX_GH_LOG" | tr -d ' ')"
expect "A1 stdout holds one JSON line (count)" "1" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"

# ---------- B: SC-004 three cases ----------
new_pr b1 0 1; mc
expect "B1 red on head, green on base: exit 1" 1 "$RC"
expect "B1 exactly one reason: suite_red_on_head" "suite_red_on_head" "$(reasons)"
expect "B1 the failing command is named (unit) with a cause" "unit|1" "$(js 'j.reasons[0].failed[0].command+"|"+j.reasons[0].failed.length')"
# fix reports as a1-fix writes them (skills/a1-fix/templates/bug-report-template.md): type bug-report, bug_slug, status
fixrep() { printf -- '---\ntype: bug-report\nproject: demo\nbug_slug: %s\ntitle: t\nstatus: %s\nseverity: major\n---\n\n# t\n' "$2" "${3:-diagnosed}" > "$1"; }
seed_fixes() { # committed on main, i.e. present at the base
  mkdir -p "$1/.a1/fixes"
  fixrep "$1/.a1/fixes/2026-10-21-unit-red-on-main.md" unit-red-on-main
  printf -- '---\nid: x\n---\n' > "$1/.a1/fixes/2026-10-21-unit-red-on-main.postmortem.md"
  printf 'no frontmatter here\n' > "$1/.a1/fixes/plain.md"
  printf -- '---\nid: old-shape\nproject: demo\nstatus: diagnosed\n---\n' > "$1/.a1/fixes/old-shape.md"
  printf -- '---\ntype: bug-report\nbug_slug: no-status\n---\n' > "$1/.a1/fixes/no-status.md"
  printf -- '---\ntype: note\nbug_slug: wrong-type\nstatus: diagnosed\n---\n' > "$1/.a1/fixes/wrong-type.md"
}
BASE_HOOK=seed_fixes new_pr b2 1 1; mc
expect "B2 red on head AND base, no --bug: exit 1" 1 "$RC"
expect "B2 exactly one reason: base_red_unreported (suite is not 'new red')" "base_red_unreported" "$(reasons)"
expect "B2 the shared red test is named (count 1)" "unit|1" "$(js 'j.reasons[0].red_on_base_and_head[0].command+"|"+j.reasons[0].red_on_base_and_head.length')"
mc --bug 2026-10-21-unit-red-on-main
expect "B3 red on both + --bug resolving to a repo fix report present at the base: exit 0" 0 "$RC"
expect "B3 ok true, no reasons (count)" "true|0" "$(js 'j.ok+"|"+j.reasons.length')"
expect "B3 the shared red is still listed under suites (count 1)" "1" "$(js 'j.suites.pre_existing_red.length')"
mc --bug 2026-10-21-does-not-exist
expect "B4 --bug that resolves to nothing: exit 1" 1 "$RC"
expect "B4 reason bug_unresolved" "bug_unresolved" "$(reasons)"
mc --bug 2026-10-21-unit-red-on-main.postmortem
expect "B5 a postmortem file is not the fix report: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
mc --bug plain
expect "B6 a file without frontmatter is not an a1-fix report: exit 1" "1|bug_unresolved" "$RC|$(reasons)"
# SEC-6: frontmatter must be the a1-fix shape; the report must exist at the base
mc --bug old-shape
expect "N1 frontmatter without type bug-report / bug_slug does not resolve: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
mc --bug no-status
expect "N2 type bug-report + bug_slug but no status does not resolve: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
mc --bug wrong-type
expect "N5 bug_slug and status but type is not bug-report does not resolve: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
fixrep "$P/.a1/fixes/branch-only.md" branch-only; g "$P" add -A; g "$P" commit -q -m "branch invents its report"; mc --bug branch-only
expect "N3 a well-formed report that only the branch adds (absent at base) does not resolve: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
# vault resolution (sentinel temp vault, slug flag)
V="$WORK/vault"; mkdir -p "$V/project/demo/fixes"
fixrep "$V/project/demo/fixes/2026-10-21-vault-bug.md" vault-bug fixed
printf -- '---\nid: 2026-10-21-old\nproject: demo\nstatus: fixed\n---\n' > "$V/project/demo/fixes/2026-10-21-old.md"
vmc() { OUT="$(cd "$P" && A1_VAULT_ROOT="$V" A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 "$@" 2>"$WORK/err")"; RC=$?; }
vmc --bug 2026-10-21-vault-bug --slug demo
expect "B7 --bug in the vault (project/<slug>/fixes): exit 0" 0 "$RC"
vmc --bug 2026-10-21-vault-bug --slug other
expect "B8 same id under another project slug does not resolve: exit 1" "1|bug_unresolved" "$RC|$(reasons)"
vmc --bug 2026-10-21-old --slug demo
expect "N4 a vault file with the old frontmatter shape does not resolve: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
# M1 mutation proof: flip the head suite back to green and the same call goes green
new_pr m1 0 1; mc; r1=$RC
printf '#!/usr/bin/env bash\nexit 0\n' > "$P/suite.sh"; g "$P" commit -q -am revert; mc; r2=$RC
expect "M1 planted red on head turns exit 1, reverting it turns exit 0" "1|0" "$r1|$r2"

# ---------- C: required checks via the gh seam ----------
new_pr c1 0 0; CHK="$WORK/checks-red.json"; mc
expect "C1 a required check is red on head: exit 1" 1 "$RC"
expect "C1 reason required_check_red names the check (count 1)" "required_check_red|lint|1" "$(js 'j.reasons[0].reason+"|"+j.reasons[0].check+"|"+j.reasons.length')"
expect "C1 suites themselves are green (the check alone blocks)" "pass" "$(js 'j.suites.verdict')"
CHK="$WORK/checks-pending.json"; mc
expect "C2 a pending required check blocks (fail closed): exit 1 required_check_pending" "1|required_check_pending" "$RC|$(reasons)"
CHK="$WORK/checks-cancel.json"; mc
expect "C3 a cancelled required check is red: exit 1" "1|required_check_red" "$RC|$(reasons)"
CHK="$WORK/checks-noshape.json"; mc
expect "C4 a check without bucket fails closed: exit 1 required_check_red" "1|required_check_red" "$RC|$(reasons)"
CHK="$WORK/checks-red.json"
OUT="$(cd "$P" && A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C5 gh exit 1 WITH the JSON list (real gh behaviour for a red check) is read, not an error: exit 1 required_check_red" "1|required_check_red" "$RC|$(reasons)"
OUT="$(cd "$P" && A1_FX_CHECKS_ERR="no required checks reported on the 'feat' branch" A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C6 'no required checks reported': exit 0 (nothing required)" "0|0" "$RC|$(js 'j.required_checks.total')"
OUT="$(cd "$P" && A1_FX_CHECKS_ERR="no checks reported on the 'feat' branch" A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
# Real gh 2.86 text for a branch that never ran any check, even with --required (measured on PRs 1, 2, 3, 5 of this repo).
expect "C6b 'no checks reported' (branch without any CI run): exit 0 (nothing required)" "0|0" "$RC|$(js 'j.required_checks.total')"
OUT="$(cd "$P" && A1_FX_CHECKS_ERR="HTTP 502: no checks reported (bad gateway)" A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C6c stderr that only contains the phrase is a gh failure, not zero checks: exit 2 gh_failed" "2|gh_failed" "$RC|$(js 'j.error')"
OUT="$(cd "$P" && A1_FX_CHECKS_ERR="$(printf "A new release of gh is available: 2.86.0 -> 2.90.0\nno checks reported on the 'feat' branch")" A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C6d gh update notice before the message: still exit 0 (nothing required)" "0|0" "$RC|$(js 'j.required_checks.total')"
OUT="$(cd "$P" && A1_FX_CHECKS_ERR="HTTP 502" A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C7 gh failure without a list: exit 2, error gh_failed" "2|gh_failed" "$RC|$(js 'j.error')"
OUT="$(cd "$P" && A1_GH_BIN="$WORK/no-such-gh" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C8 gh binary missing: exit 2, error gh_failed" "2|gh_failed" "$RC|$(js 'j.error')"
CHK="$WORK/checks-green.json"
: > "$A1_FX_GH_LOG"; OUT="$(cd "$P" && A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C9 no --base: the base branch comes from gh pr view (exit 0, base main)" "0|main" "$RC|$(js 'j.base')"
expect "C9 gh pr view was asked for the base (count 1)" "1" "$(grep -c '^pr view 7 --json baseRefName$' "$A1_FX_GH_LOG" | tr -d ' ')"

dis() { (cd "$P" && node "$TOOLS" disposition "$@" >"$WORK/dis.out" 2>"$WORK/dis.err"); }
# ---------- D: flaky_base frozen (FR-016) ----------
new_pr d1 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"; g "$P" commit -q -am "grow flaky_base"; mc
expect "D1 head adds an id to flaky_base: exit 1" 1 "$RC"
# Since the review (SEC-2) verify run --base takes the command set from the base, so a changed .a1/verify.json is itself a reason
# (suite_red_on_head, cause verify_config_changed) next to the frozen-list reason.
expect "D1 reasons: flaky_base_grown plus the verify config change (suite_red_on_head)" "flaky_base_grown,suite_red_on_head" "$(reasons)"
expect "D1 reason flaky_base_grown names the id" "unit" "$(js "j.reasons.find(r=>r.reason==='flaky_base_grown').id")"
expect "D1 the suite reason names verify_config_changed" "true" "$(js "j.reasons.find(r=>r.reason==='suite_red_on_head').causes.includes('verify_config_changed')")"
FPD="$(js 'j.suites.config_changed.fingerprint')"
expect "D1 the report carries the verify-config fingerprint for the disposition" "verify-config:.a1/verify.json:" "$(printf '%s' "$FPD" | cut -c1-30)"
dis add --kind config_change --fingerprint "$FPD" --reason "fixture: config reviewed" --by fx; g "$P" add -A; g "$P" commit -q -m cfg-disp
dis review "$FPD" --verdict upheld --reason "fixture: ok" --by reviewer; g "$P" commit -q -m cfg-review -- .a1/dispositions.json; mc
expect "D4 a reviewed config_change disposition clears the config part only: flaky_base_grown (the frozen list) stays" "1|flaky_base_grown" "$RC|$(reasons)"
new_pr d2 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"; g "$P" commit -q -am "list on main"
g "$P" checkout -q main; g "$P" merge -q --ff-only feat; g "$P" checkout -q -b feat2; printf '// x\n' >> "$P/src/app.js"; g "$P" commit -q -am work; mc
expect "D2 flaky_base unchanged since base: exit 0, no reason" "0|0" "$RC|$(js 'j.reasons.length')"
new_pr d3 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"
g "$P" commit -q -am "list"; g "$P" checkout -q main; g "$P" merge -q --ff-only feat; g "$P" checkout -q -b feat3
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit","other"]}\n' > "$P/.a1/verify.json"; g "$P" commit -q -am "one more"; mc
expect "D3 list grew by one on top of the base list: exit 1, only the new id named by flaky_base_grown" "1|other|flaky_base_grown,suite_red_on_head" "$RC|$(js "j.reasons.find(r=>r.reason==='flaky_base_grown').id")|$(reasons)"

# ---------- E: dispositions (FR-025 merge side) ----------
dis() { (cd "$P" && node "$TOOLS" disposition "$@" >"$WORK/dis.out" 2>"$WORK/dis.err"); }
FIDELITY_ARGS=(--kind fidelity --rule mock-of-subject --file tests/x.test.ts --text 'vi.mock("./x")' --reason "fixture: reviewed" --by fx)
new_pr e1 0 0; dis add "${FIDELITY_ARGS[@]}"; g "$P" add -A; g "$P" commit -q -m disp; mc
FP="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j[0].fingerprint)' "$P/.a1/dispositions.json")"
expect "E1 a pending disposition added on the branch: exit 1" 1 "$RC"
expect "E1 reason disposition_unreviewed names the fingerprint (count 1)" "disposition_unreviewed|$FP|1" "$(js 'j.reasons[0].reason+"|"+j.reasons[0].fingerprint+"|"+j.reasons.length')"
dis review "$FP" --verdict upheld --reason "fixture: upheld" --by reviewer; g "$P" commit -q -m review -- .a1/dispositions.json; mc
expect "E2 after review upheld (committed): exit 0, no reasons" "0|0" "$RC|$(js 'j.reasons.length')"
dis review "$FP" --verdict overturned --reason "fixture: overturned" --by reviewer; g "$P" commit -q -m overturn -- .a1/dispositions.json; mc
expect "E3 an overturned disposition blocks: exit 1 disposition_overturned (count 1)" "1|disposition_overturned|1" "$RC|$(reasons)|$(js 'j.reasons.length')"
new_pr e4 0 0; dis add "${FIDELITY_ARGS[@]}"; g "$P" add -A; g "$P" commit -q -m disp
printf 'not json' > "$P/.a1/dispositions.json"; g "$P" commit -q -am broken; mc
expect "E4 an unreadable dispositions store is exit 2 (not a silent pass)" 2 "$RC"

# ---------- F: no result cache in merge-check, no nested gate-log line ----------
new_pr f1 0 0; mc; first="$OUT"; mc
expect "F1 second run does not read the cache (merge-check runs with no-cache, SEC review round C)" "off|off" "$(js 'j.suites.cache.head+"|"+j.suites.cache.base')"
expect "F1 first run did not use the cache either" "off|off" "$(printf '%s' "$first" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.suites.cache.head+"|"+j.suites.cache.base)})')"
LOG="$P/.a1/phases/fx-w10/gate-log.jsonl"
expect "F2 two merge-check calls wrote exactly two gate-log lines (count: none for the nested verify run)" 2 "$(wc -l < "$LOG" | tr -d ' ')"
expect "F2 every line is the pr-merge-check gate" "2" "$(grep -c '"gate":"pr-merge-check"' "$LOG" | tr -d ' ')"
expect "F2 no verify-run gate line (count 0)" "0" "$(grep -c 'gate-1-build' "$LOG" | tr -d ' ')"
expect "F3 the merge-check call leaves git status clean (cache and log are git-excluded)" "" "$(g "$P" status --porcelain)"

# ---------- I: head pinning (review SEC-1 / M1) ----------
new_pr i1 0 0; : > "$A1_FX_GH_LOG"; mc
LOCAL_HEAD="$(g "$P" rev-parse HEAD)"
expect "I1 head_sha in the report is the local HEAD the merge must pin (--match-head-commit)" "$LOCAL_HEAD" "$(js 'j.head_sha')"
expect "I1 gh was asked for headRefOid (count 1)" "1" "$(grep -c '^pr view 7 --json headRefOid$' "$A1_FX_GH_LOG" | tr -d ' ')"
OTHER_SHA="$(printf 'a%.0s' $(seq 1 40))"
export A1_FX_HEAD="$OTHER_SHA"; mc; unset A1_FX_HEAD
expect "I2 the PR head differs from local HEAD: exit 1, exactly head_mismatch (local_head_differs)" "1|head_mismatch|local_head_differs|1" "$RC|$(reasons)|$(js 'j.reasons[0].cause')|$(js 'j.reasons.length')"
expect "I2 both shas named so the cause is readable" "$LOCAL_HEAD|$OTHER_SHA" "$(js 'j.reasons[0].local_head+"|"+j.reasons[0].pr_head')"
printf 'module.exports = 3;\n' > "$P/src/app.js"; mc
expect "I3 uncommitted change to a tracked file: exit 1 head_mismatch (dirty_tree)" "1|head_mismatch|dirty_tree" "$RC|$(reasons)|$(js 'j.reasons[0].cause')"
g "$P" checkout -q -- src/app.js; printf 'stray\n' > "$P/stray.txt"; mc
expect "I4 an untracked file counts as dirty: exit 1 head_mismatch, path named" "1|head_mismatch|stray.txt" "$RC|$(reasons)|$(js 'j.reasons[0].paths.join(",")')"
rm -f "$P/stray.txt"; mkdir -p "$P/.a1/verify-cache" "$P/.a1/phases/zz"; printf 'x\n' > "$P/.a1/verify-cache/x.json"; printf '{}\n' > "$P/.a1/phases/zz/gate-log.jsonl"
: > "$P/.git/info/exclude" # a checkout that lost its excludes: the two paths show up as untracked and must still be ignored
expect "I5 premise: without the excludes git status lists both paths (count 2)" "2" "$(g "$P" status --porcelain --untracked-files=all | grep -c -e '\.a1/verify-cache/x\.json' -e 'phases/zz/gate-log\.jsonl')"
mc
expect "I5 the run's own cache and gate-log files do not make the tree dirty: exit 0" "0|0" "$RC|$(js 'j.reasons.length')"
# I7 (review MAJOR): a1-pr-review writes .a1-review/ into the checkout before merge-check; a repo with no exclude line must not call that dirty
new_pr i7 0 0; : > "$P/.git/info/exclude"; mkdir -p "$P/.a1-review"; printf 'findings\n' > "$P/.a1-review/reinhard.md"
expect "I7 premise: without an exclude line git status lists .a1-review/reinhard.md" "1" "$(g "$P" status --porcelain --untracked-files=all | grep -c -e '\.a1-review/reinhard\.md')"
mc
expect "I7 the review output .a1-review/ does not make the tree dirty: exit 0, no reasons" "0|0" "$RC|$(js 'j.reasons.length')"
mkdir -p "$P/.a1-reviewer"; printf 'x\n' > "$P/.a1-reviewer/x.md"
mc
expect "I7b a look-alike dir (.a1-reviewer/) is still dirty: exit 1 head_mismatch" "1|head_mismatch" "$RC|$(reasons)"
export A1_FX_HEAD="not-a-sha"; mc; unset A1_FX_HEAD
expect "I6 gh gives no usable headRefOid: exit 2 gh_failed (never a silent pass)" "2|gh_failed" "$RC|$(js 'j.error')"

# ---------- J: dispositions must be committed (review M2) ----------
new_pr j1 0 0; dis add "${FIDELITY_ARGS[@]}"; g "$P" add -A; g "$P" commit -q -m disp
FPJ="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].fingerprint)' "$P/.a1/dispositions.json")"
dis review "$FPJ" --verdict upheld --reason "fixture: upheld" --by reviewer; mc
expect "J1 verdict recorded but not committed: exit 1, dispositions_uncommitted (the committed entry is still pending)" "1|disposition_unreviewed,dispositions_uncommitted" "$RC|$(reasons)"
g "$P" commit -q -m review -- .a1/dispositions.json; mc
expect "J2 the same verdict committed: exit 0, no reasons" "0|0" "$RC|$(js 'j.reasons.length')"
dis review "$FPJ" --verdict overturned --reason "fixture: overturned" --by reviewer; g "$P" commit -q -m overturn -- .a1/dispositions.json
dis review "$FPJ" --verdict upheld --reason "fixture: flipped back, not committed" --by reviewer; mc
expect "J3 a working-tree flip from overturned to upheld does not hide the committed overturn: exit 1" "1|disposition_overturned,dispositions_uncommitted" "$RC|$(reasons)"
new_pr j4 0 0; dis add "${FIDELITY_ARGS[@]}"; mc
expect "J4 a dispositions file that was never committed: exit 1 dispositions_uncommitted" "1|dispositions_uncommitted" "$RC|$(reasons)"

# ---------- K: no self-approval (review SEC-3 / m6) ----------
new_pr k1 0 0; dis add "${FIDELITY_ARGS[@]}"; g "$P" add -A; g "$P" commit -q -m disp
FPK="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].fingerprint)' "$P/.a1/dispositions.json")"
dis review "$FPK" --verdict upheld --reason "fixture: self" --by fx; g "$P" commit -q -m review -- .a1/dispositions.json; mc
expect "K1 reviewed_by equals the entry's by: exit 1, disposition_self_reviewed names the fingerprint" "1|disposition_self_reviewed|$FPK" "$RC|$(reasons)|$(js 'j.reasons[0].fingerprint')"
dis review "$FPK" --verdict upheld --reason "fixture: case differs" --by FX; g "$P" commit -q -m review2 -- .a1/dispositions.json; mc
expect "K2 the same name in another case is still the author: exit 1 disposition_self_reviewed" "1|disposition_self_reviewed" "$RC|$(reasons)"
dis review "$FPK" --verdict upheld --reason "fixture: nobody named"; g "$P" commit -q -m review3 -- .a1/dispositions.json; mc
expect "K3 a verdict without reviewed_by: exit 1 disposition_self_reviewed" "1|disposition_self_reviewed" "$RC|$(reasons)"
node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));j[0].reviewed_by="reviewer";delete j[0].reviewed_at;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$P/.a1/dispositions.json"; g "$P" commit -q -m review4 -- .a1/dispositions.json; mc
expect "K4 a verdict without reviewed_at (hand-edited): exit 1 disposition_self_reviewed" "1|disposition_self_reviewed" "$RC|$(reasons)"
dis review "$FPK" --verdict upheld --reason "fixture: independent" --by reviewer; g "$P" commit -q -m review5 -- .a1/dispositions.json; mc
expect "K5 an independent reviewer: exit 0, no reasons" "0|0" "$RC|$(js 'j.reasons.length')"
expect "K5 the newly upheld entry is listed in the report (count 1, reviewer named)" "1|$FPK|reviewer" "$(js 'j.upheld_dispositions.length+"|"+j.upheld_dispositions[0].fingerprint+"|"+j.upheld_dispositions[0].reviewed_by')"
new_pr k6 0 0; mc
expect "K6 no disposition on the branch: upheld_dispositions is an empty list (count 0)" "0" "$(js 'j.upheld_dispositions.length')"

# ---------- L: fidelity config change (review SEC-2) ----------
CFG='{"rules":{"skipped-test":"off"}}'
fid_base() { printf '{"rules":{}}\n' > "$1/.a1/fidelity.json"; }
new_pr l1 0 0; printf '%s\n' "$CFG" > "$P/.a1/fidelity.json"; g "$P" add -A; g "$P" commit -q -m "add fidelity config"; mc
expect "L1 .a1/fidelity.json added on the branch: exit 1 fidelity_config_changed" "1|fidelity_config_changed|added" "$RC|$(reasons)|$(js 'j.reasons[0].change')"
FPL="$(js 'j.reasons[0].fingerprint')"
mc --accept-config-change "owner reviewed the rule switch in chat"
expect "L2 --accept-config-change no longer exists (no self-authorizing flag, spec 017 review MINOR-B): exit 2, the flag is refused" "2" "$RC"
mc
expect "L2b without the flag the config change still blocks: exit 1 fidelity_config_changed" "1|fidelity_config_changed" "$RC|$(reasons)"
dis add --kind config_change --fingerprint "$FPL" --reason "fixture: config reviewed" --by fx; g "$P" add -A; g "$P" commit -q -m cfg-disp
dis review "$FPL" --verdict upheld --reason "fixture: ok" --by reviewer; g "$P" commit -q -m cfg-review -- .a1/dispositions.json; mc
expect "L3 an upheld config_change disposition from another reviewer on that exact content: exit 0" "0|0" "$RC|$(js 'j.reasons.length')"
printf '{"rules":{"skipped-test":"off","mock-of-subject":"off"}}\n' > "$P/.a1/fidelity.json"; g "$P" commit -q -am "config changed again"; mc
expect "L4 the config changes again after the review: the old disposition no longer matches, exit 1 fidelity_config_changed with a new fingerprint" "1|fidelity_config_changed|new" "$RC|$(reasons)|$([[ "$(js 'j.reasons[0].fingerprint')" != "$FPL" ]] && echo new || echo same)"
new_pr l5 0 0; printf '%s\n' "$CFG" > "$P/.a1/fidelity.json"; g "$P" add -A; g "$P" commit -q -m cfg; mc; FPL5="$(js 'j.reasons[0].fingerprint')"
dis add --kind config_change --fingerprint "$FPL5" --reason "fixture: self" --by fx; dis review "$FPL5" --verdict upheld --reason "fixture: self" --by fx; g "$P" add -A; g "$P" commit -q -m cfg-self; mc
expect "L5 a config disposition the author reviewed himself clears nothing: exit 1 (fidelity_config_changed + disposition_self_reviewed)" "1|disposition_self_reviewed,fidelity_config_changed" "$RC|$(reasons)"
new_pr l6 0 0; fid_base "$P"; g "$P" add -A; g "$P" commit -q -m cfg; g "$P" checkout -q main; g "$P" merge -q --ff-only feat; g "$P" checkout -q -b feat6; printf '// y\n' >> "$P/src/app.js"; g "$P" commit -q -am work; mc
expect "L6 the config is the same on the base and on head: exit 0, no reason" "0|0" "$RC|$(js 'j.reasons.length')"
new_pr l8 0 0; printf '%s\n' "$CFG" > "$P/.a1/fidelity.json"; g "$P" add -A; g "$P" commit -q -m cfg; mc; FPL8="$(js 'j.reasons[0].fingerprint')"
dis add --kind config_change --fingerprint "$FPL8" --reason "fixture: pending only" --by fx; g "$P" add -A; g "$P" commit -q -m cfg-pending; mc
expect "L8 a pending (unreviewed) config disposition clears nothing: exit 1 (fidelity_config_changed + disposition_unreviewed)" "1|disposition_unreviewed,fidelity_config_changed" "$RC|$(reasons)"
BASE_HOOK=fid_base new_pr l7 0 0; g "$P" rm -q .a1/fidelity.json; g "$P" commit -q -m "drop config"; mc
expect "L7 the config is deleted on the branch: exit 1 fidelity_config_changed (removed)" "1|fidelity_config_changed|removed" "$RC|$(reasons)|$(js 'j.reasons[0].change')"

# ---------- M: gh binary provenance (review SEC-4) ----------
new_pr m4 0 0; mc
expect "M1b A1_GH_BIN override: stderr names the binary" "1" "$(printf '%s\n' "$ERR" | grep -c "^pr merge-check: gh from A1_GH_BIN=$WORK/bin/gh$" | tr -d ' ')"
expect "M1b the report says gh_bin override" "override" "$(js 'j.gh_bin')"
OUT="$(cd "$P" && PATH="$WORK/bin:$PATH" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"
expect "M2 default gh from PATH: gh_bin default, no A1_GH_BIN line on stderr (count 0)" "0|default|0" "$RC|$(js 'j.gh_bin')|$(printf '%s\n' "$ERR" | grep -c 'A1_GH_BIN' | tr -d ' ')"

# ---------- N: forged verify cache (review MAJOR, Samuel): merge-check never trusts the head cache ----------
# Needs verify run --no-cache (C1); runVerify({noCache:true}) ignores the cache file and runs the suites.
new_pr n0 0 0; (cd "$P" && node "$TOOLS" verify run --project "$P" --phase fx-w10 >/dev/null 2>&1)
GREEN_CACHE="$(ls "$P"/.a1/verify-cache/*.json | head -1)"
new_pr n1 0 1; mc
expect "N6 premise: suite red on head: exit 1 suite_red_on_head" "1|suite_red_on_head" "$RC|$(reasons)"
RED_HEAD="$(g "$P" rev-parse HEAD)"; CHASH="$(basename "$GREEN_CACHE" .json)"; CHASH="${CHASH#*-}"; mkdir -p "$P/.a1/verify-cache"
node -e 'const fs=require("fs");const g=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));g.sha=process.argv[2];fs.writeFileSync(process.argv[3],JSON.stringify(g))' "$GREEN_CACHE" "$RED_HEAD" "$P/.a1/verify-cache/$RED_HEAD-$CHASH.json"
(cd "$P" && node "$TOOLS" verify run --project "$P" --phase fx-w10 >/dev/null 2>&1); VRC=$?
expect "N6 premise: a plain verify run (cache on) trusts the forged cache and passes the red head: exit 0" "0" "$VRC"
mc
expect "N6 forged head cache (green results planted for the red head sha): exit 1, the suite is run again" "1|suite_red_on_head" "$RC|$(reasons)"

# ---------- G: hostile and usage inputs ----------
new_pr h1 0 0
for bad_args in "--pr 0" "--pr 7;touch-pwned" "--pr -3" "--pr 99999999999" "" "--pr 7 extra" "--pr 7 --bug ../x" "--pr 7 --bug a/b" "--pr 7 --bug .hidden" "--pr 7 --slug ../x" "--pr 7 --base --upload-pack=x" "--pr 7 --base no-such-ref" "--pr 7 --bug"; do
  OUT="$(cd "$P" && A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check ${bad_args:+$bad_args} --phase fx-w10 2>"$WORK/err")"; RC=$?
  expect "G hostile/usage '${bad_args:-<none>}': exit 2 and a named error" "2|1" "$RC|$(js 'j.ok===false&&typeof j.error==="string"&&j.error.length>0?1:0' 2>/dev/null || echo 0)"
done
expect "G no stray file from the hostile --pr value" "" "$(ls "$P" | grep -c 'pwned' | sed 's/^0$//')"
OUT="$(cd "$WORK" && A1_GH_BIN="$WORK/bin/gh" node "$TOOLS" pr merge-check --pr 7 --base main --project "$WORK/bin" --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "G a --project that is not a git repository: exit 2" 2 "$RC"

# ---------- H: product validate --spec-status --require-vault (FR-034) ----------
roadmap() { # roadmap <file> <feature-status>
  local st="$2" stage="null" fin="null" start="null"
  if [[ "$st" == "done" ]]; then stage="done"; fin="2026-09-13"; start="2026-09-13"; fi
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<EOF
---
schema_version: 1
type: roadmap
project: a1-specforge
title: "demo - Roadmap"
status: active
updated: 2026-10-21
source: "w10 fixture"
milestones:
  - id: continuous
    title: "Continuous"
    status: in-progress
    target: null
features:
  - id: 005-vault-first-artifacts
    milestone: continuous
    title: "Vault-first artifacts"
    status: $st
    stage: $stage
    depends_on: []
    started: $start
    finished: $fin
    spec_path: project/a1-specforge/spec/005-vault-first-artifacts.md
    plan_path: null
next: null
---

# demo - Roadmap

## Changelog

- **2026-10-21** - feature '005-vault-first-artifacts' added - w10 fixture
EOF
}
SV="$WORK/spec-vault"; mkdir -p "$SV/project/a1-specforge/spec"; cp "$REAL_SPEC" "$SV/project/a1-specforge/spec/005-vault-first-artifacts.md"
SPEC_ST="$(sed -n 's/^status: //p' "$REAL_SPEC" | head -1)"
expect "H0 the real spec copy is status done (fixture premise)" "done" "$SPEC_ST"
pv() { OUT="$(cd "$P" && "$@" node "$TOOLS" product validate --spec-status --require-vault --phase fx-w10 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"; }
new_pr p1 0 0; roadmap "$P/docs/product/ROADMAP.md" planned
pv env A1_VAULT_ROOT="$SV"
expect "H1 vault set, spec done vs roadmap planned: exit 1 (drift)" 1 "$RC"
expect "H1 one violation (count) and the reconciling command is named" "1|product stage --by 005-vault-first-artifacts --set done" "$(js 'j.spec_status.violations.length+"|"+j.spec_status.violations[0].reconcile')"
pv env -u A1_VAULT_ROOT
expect "H2 A1_VAULT_ROOT unset: exit 2 (fail closed, no degrade to --ci)" 2 "$RC"
expect "H2 error vault_required on stdout, message on stderr" "vault_required|1" "$(js 'j.error')|$(printf '%s' "$ERR" | grep -c 'A1_VAULT_ROOT')"
expect "H2 no repo-local .a1/learnings created by the refused run" "0" "$(ls -d "$P/.a1/learnings" 2>/dev/null | wc -l | tr -d ' ')"
pv env A1_VAULT_ROOT="$WORK/no-such-vault"
expect "H3 A1_VAULT_ROOT points to a missing directory: exit 2" "2|vault_required" "$RC|$(js 'j.error')"
pv env A1_VAULT_ROOT="$WORK/bin/gh"
expect "H3b A1_VAULT_ROOT points to a file: exit 2" "2" "$RC"
pv env A1_VAULT_ROOT=""
expect "H3c A1_VAULT_ROOT empty string: exit 2" "2" "$RC"
roadmap "$P/docs/product/ROADMAP.md" done
pv env A1_VAULT_ROOT="$SV"
expect "H4 spec done and roadmap done agree: exit 0, no violation (count 0)" "0|0" "$RC|$(js 'j.spec_status.violations.length')"
OUT="$(cd "$P" && A1_VAULT_ROOT="$SV" node "$TOOLS" product validate --spec-status --require-vault --ci --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "H5 --require-vault with --ci excludes each other: exit 2" 2 "$RC"
OUT="$(cd "$P" && A1_VAULT_ROOT="$SV" node "$TOOLS" product validate --require-vault --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "H6 --require-vault alone implies --spec-status (section present, exit 0)" "0|object" "$RC|$(js 'typeof j.spec_status')"
roadmap "$P/docs/product/ROADMAP.md" planned
OUT="$(cd "$P" && A1_VAULT_ROOT="$SV" node "$TOOLS" product validate --require-vault --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "H7 --require-vault alone on drift: exit 1" 1 "$RC"
OUT="$(cd "$P" && env -u A1_VAULT_ROOT node "$TOOLS" product validate --spec-status --ci --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "H8 control: --ci without a vault is unchanged (exit 0 with spec_path set)" 0 "$RC"

# ---------- J: spec 017 review round D (suite_removed surfaces; flaky_base read from HEAD, not the working tree) ----------
# Measured red 2026-10-21 (HEAD code before the fix, this suite overlaid): J1, J1b (no each from trees / no suite_removed), J2 (flakyBaseReasons read the working tree)
BASE_HOOK=jhook
jhook() { mkdir -p "$1/t/a" "$1/t/b"; printf 'exit 0\n' > "$1/t/a/run.sh"; printf 'exit 1\n' > "$1/t/b/run.sh"; printf '{"each":"t/*/run.sh","argv_prefix":["bash"]}\n' > "$1/.a1/verify.json"; }
new_pr j1 0 0; g "$P" rm -q t/b/run.sh; g "$P" commit -q -m "drop the red suite"; mc
BASE_HOOK=
expect "J1 the branch deletes the red each-suite: exit 1, suite_red_on_head with cause suite_removed" "1|suite_red_on_head|true" "$RC|$(reasons)|$(js "j.reasons[0].causes.includes('suite_removed')")"
expect "J1b the report carries the removed ids and the fingerprint to disposition" "t/b/run.sh|verify-config:.a1/verify.json:" "$(js 'j.suites.suite_removed.ids.join()')|$(js 'j.suites.suite_removed.fingerprint' | cut -c1-30)"
new_pr j2 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"
mc
expect "J2 an uncommitted flaky_base edit in the working tree is not read as the head's list (no flaky_base_grown)" "false" "$(js "j.reasons.some(r=>r.reason==='flaky_base_grown')")"

echo "a1-pr-merge-check: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
