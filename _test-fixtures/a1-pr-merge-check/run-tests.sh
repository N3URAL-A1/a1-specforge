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

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-merge-check.XXXXXX")" || exit 1
[[ -n "$WORK" && -d "$WORK" ]] || exit 1
trap 'rm -rf "${WORK:?}"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 HOME="$WORK/home"
mkdir -p "$HOME" "$WORK/bin"

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }

g() { local d="$1"; shift; git -C "$d" -c commit.gpgsign=false -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null "$@"; }

# gh stub: records argv, answers `pr view` with the base branch and `pr checks` from A1_FX_CHECKS (+ rc, stderr).
cat > "$WORK/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${A1_FX_GH_LOG:?}"
case "$1 $2" in
  "pr view") printf '{"baseRefName":"main"}\n'; exit 0 ;;
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
new_pr b2 1 1; mc
expect "B2 red on head AND base, no --bug: exit 1" 1 "$RC"
expect "B2 exactly one reason: base_red_unreported (suite is not 'new red')" "base_red_unreported" "$(reasons)"
expect "B2 the shared red test is named (count 1)" "unit|1" "$(js 'j.reasons[0].red_on_base_and_head[0].command+"|"+j.reasons[0].red_on_base_and_head.length')"
# the report: an a1-fix report in the repo path .a1/fixes/<id>.md
mkdir -p "$P/.a1/fixes"
printf -- '---\nid: 2026-10-21-unit-red-on-main\nproject: demo\ntitle: unit red on main\nstatus: diagnosed\ncreated: 2026-10-21\n---\n\n# unit red on main\n' > "$P/.a1/fixes/2026-10-21-unit-red-on-main.md"
mc --bug 2026-10-21-unit-red-on-main
expect "B3 red on both + --bug resolving to a repo fix report: exit 0" 0 "$RC"
expect "B3 ok true, no reasons (count)" "true|0" "$(js 'j.ok+"|"+j.reasons.length')"
expect "B3 the shared red is still listed under suites (count 1)" "1" "$(js 'j.suites.pre_existing_red.length')"
mc --bug 2026-10-21-does-not-exist
expect "B4 --bug that resolves to nothing: exit 1" 1 "$RC"
expect "B4 reason bug_unresolved" "bug_unresolved" "$(reasons)"
printf -- '---\nid: x\n---\n' > "$P/.a1/fixes/2026-10-21-unit-red-on-main.postmortem.md"
mc --bug 2026-10-21-unit-red-on-main.postmortem
expect "B5 a postmortem file is not the fix report: exit 1 bug_unresolved" "1|bug_unresolved" "$RC|$(reasons)"
printf 'no frontmatter here\n' > "$P/.a1/fixes/plain.md"
mc --bug plain
expect "B6 a file without frontmatter is not an a1-fix report: exit 1" "1|bug_unresolved" "$RC|$(reasons)"
# vault resolution (sentinel temp vault, slug flag)
V="$WORK/vault"; mkdir -p "$V/project/demo/fixes"
printf -- '---\nid: 2026-10-21-vault-bug\nproject: demo\nstatus: fixed\n---\n\n# vault bug\n' > "$V/project/demo/fixes/2026-10-21-vault-bug.md"
OUT="$(cd "$P" && A1_VAULT_ROOT="$V" A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 --bug 2026-10-21-vault-bug --slug demo 2>"$WORK/err")"; RC=$?
expect "B7 --bug in the vault (project/<slug>/fixes): exit 0" 0 "$RC"
OUT="$(cd "$P" && A1_VAULT_ROOT="$V" A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 --bug 2026-10-21-vault-bug --slug other 2>"$WORK/err")"; RC=$?
expect "B8 same id under another project slug does not resolve: exit 1" "1|bug_unresolved" "$RC|$(reasons)"
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
OUT="$(cd "$P" && A1_FX_CHECKS_ERR="HTTP 502" A1_FX_CHECKS_RC=1 A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C7 gh failure without a list: exit 2, error gh_failed" "2|gh_failed" "$RC|$(js 'j.error')"
OUT="$(cd "$P" && A1_GH_BIN="$WORK/no-such-gh" node "$TOOLS" pr merge-check --pr 7 --base main --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C8 gh binary missing: exit 2, error gh_failed" "2|gh_failed" "$RC|$(js 'j.error')"
CHK="$WORK/checks-green.json"
: > "$A1_FX_GH_LOG"; OUT="$(cd "$P" && A1_GH_BIN="$WORK/bin/gh" A1_FX_CHECKS="$CHK" node "$TOOLS" pr merge-check --pr 7 --phase fx-w10 2>"$WORK/err")"; RC=$?
expect "C9 no --base: the base branch comes from gh pr view (exit 0, base main)" "0|main" "$RC|$(js 'j.base')"
expect "C9 gh pr view was asked for the base (count 1)" "1" "$(grep -c '^pr view 7 --json baseRefName$' "$A1_FX_GH_LOG" | tr -d ' ')"

# ---------- D: flaky_base frozen (FR-016) ----------
new_pr d1 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"; g "$P" commit -q -am "grow flaky_base"; mc
expect "D1 head adds an id to flaky_base: exit 1" 1 "$RC"
expect "D1 reason flaky_base_grown names the id (count 1)" "flaky_base_grown|unit|1" "$(js 'j.reasons[0].reason+"|"+j.reasons[0].id+"|"+j.reasons.length')"
new_pr d2 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"; g "$P" commit -q -am "list on main"
g "$P" checkout -q main; g "$P" merge -q --ff-only feat; g "$P" checkout -q -b feat2; printf '// x\n' >> "$P/src/app.js"; g "$P" commit -q -am work; mc
expect "D2 flaky_base unchanged since base: exit 0, no reason" "0|0" "$RC|$(js 'j.reasons.length')"
new_pr d3 0 0
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit"]}\n' > "$P/.a1/verify.json"
g "$P" commit -q -am "list"; g "$P" checkout -q main; g "$P" merge -q --ff-only feat; g "$P" checkout -q -b feat3
printf '{"commands":[{"id":"unit","argv":["bash","suite.sh"]}],"flaky_base":["unit","other"]}\n' > "$P/.a1/verify.json"; g "$P" commit -q -am "one more"; mc
expect "D3 list grew by one on top of the base list: exit 1, only the new id named" "1|flaky_base_grown|other|1" "$RC|$(js 'j.reasons[0].reason+"|"+j.reasons[0].id+"|"+j.reasons.length')"

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

# ---------- F: result cache reuse, no nested gate-log line ----------
new_pr f1 0 0; mc; first="$OUT"; mc
expect "F1 second run reads the cache on head and base" "hit|hit" "$(js 'j.suites.cache.head+"|"+j.suites.cache.base')"
expect "F1 first run was a miss on both sides" "miss|miss" "$(printf '%s' "$first" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.suites.cache.head+"|"+j.suites.cache.base)})')"
LOG="$P/.a1/phases/fx-w10/gate-log.jsonl"
expect "F2 two merge-check calls wrote exactly two gate-log lines (count: none for the nested verify run)" 2 "$(wc -l < "$LOG" | tr -d ' ')"
expect "F2 every line is the pr-merge-check gate" "2" "$(grep -c '"gate":"pr-merge-check"' "$LOG" | tr -d ' ')"
expect "F2 no verify-run gate line (count 0)" "0" "$(grep -c 'gate-1-build' "$LOG" | tr -d ' ')"
expect "F3 the merge-check call leaves git status clean (cache and log are git-excluded)" "" "$(g "$P" status --porcelain)"

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

echo "a1-pr-merge-check: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
