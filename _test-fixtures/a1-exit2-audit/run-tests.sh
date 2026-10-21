#!/usr/bin/env bash
# Fixture: spec 017-enforced-self-checks, Wave 14 audit (FR-040, FR-041). Per new subcommand: an internal error or
# unreadable input exits 2 (never 0), the help lists it, and no "not implemented" stub path remains.
#
# "Unreadable input" is a DIRECTORY in place of the file the command reads (.a1/verify.json, .a1/fidelity.json,
# .a1/dispositions.json, the log, the bug file). The mutation-proof pair is verify run and test-fidelity: the same
# project with a valid file in that place exits 0, so the 2 comes from the unreadable input, not from a usage slip.
# The rule-by-rule green/red/mutation/hostile cases of each command live in its own suite (a1-gates-lint,
# a1-verify, a1-test-fidelity, a1-disposition, a1-fix-class-sweep, a1-pr-merge-check).
#
# Measured red 2026-10-21 (git-archive snapshot, one production line reverted, suite run):
#   a stub path restored in a1-tools.cjs (a "not implemented" string)  : A1 (count 0 -> 1)
#   help-verify.cjs heading of verify check renamed                   : B4
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
SHARED="$(dirname "$TOOLS")"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-exit2.XXXXXX")" || exit 1
[[ -n "$WORK" && -d "$WORK" ]] || exit 1
trap 'rm -rf "${WORK:?}"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi; }

# rc <args...> -> exit code of a1-tools in $WORK/repo
rc() { (cd "$WORK/repo" && node "$TOOLS" "$@" >/dev/null 2>&1; echo $?); }

mkdir "$WORK/repo" && cd "$WORK/repo" || exit 1
git init -q . && git -c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --allow-empty -m init
mkdir -p .a1/phases/p
BUGDIR="$WORK/repo/bugdir"; mkdir "$BUGDIR"

# A1 no stub left (count assert beside the equality)
stubs="$(grep -rEc 'not implemented, spec 017|not implemented yet \(spec 017' "$SHARED/a1-tools.cjs" "$SHARED"/lib/*.cjs | awk -F: '{n+=$NF} END{print n+0}')"
files="$(ls "$SHARED"/lib/*.cjs | wc -l | tr -d ' ')"
expect "A1 no spec 017 'not implemented' stub path remains in the facade or lib (0 hits over $files lib files + facade)" "0" "$stubs"
[[ "$files" -ge 50 ]] && ok "A1b count assert: more than 50 lib files scanned ($files)" || bad "A1b scanned too few lib files ($files)"

# B help lists each new subcommand
help="$(node "$TOOLS" --help 2>&1)"
n=0
for cmd in 'gates lint' 'gates fired' 'verify run' 'verify check' 'test-fidelity' 'disposition add' 'disposition review' 'fix class-sweep' 'pr merge-check'; do
  n=$((n + 1))
  if grep -q "a1-tools $cmd" <<<"$help"; then ok "B$n help lists '$cmd'"; else bad "B$n help lists '$cmd'"; fi
done

# C control pair: valid file -> 0; directory in its place -> 2
printf '{"commands":[{"id":"t","argv":["true"],"timeout_s":10}],"no_tests_reason":"audit control"}' > .a1/verify.json
expect "C1 control: verify run with a readable .a1/verify.json exits 0" "0" "$(rc verify run --project "$WORK/repo" --phase p)"
rm .a1/verify.json; mkdir .a1/verify.json
expect "C2 verify run with a directory as .a1/verify.json exits 2" "2" "$(rc verify run --project "$WORK/repo" --phase p)"
rmdir .a1/verify.json
printf '{"db_wrappers":["db"],"test_globs":["*.test.*"],"ci_globs":[]}' > .a1/fidelity.json
expect "C3 control: test-fidelity with a readable .a1/fidelity.json exits 0" "0" "$(rc test-fidelity --diff-base HEAD --project "$WORK/repo" --phase p)"
rm .a1/fidelity.json; mkdir .a1/fidelity.json
expect "C4 test-fidelity with a directory as .a1/fidelity.json exits 2" "2" "$(rc test-fidelity --diff-base HEAD --project "$WORK/repo" --phase p)"
rmdir .a1/fidelity.json

# D one internal-error case per remaining subcommand
mkdir "$WORK/log-dir.jsonl"
expect "D1 gates lint --log on a directory exits 2" "2" "$(rc gates lint --log "$WORK/log-dir.jsonl")"
expect "D2 gates fired --log on a directory exits 2" "2" "$(rc gates fired --log "$WORK/log-dir.jsonl")"
expect "D3 verify check on a directory exits 2" "2" "$(rc verify check "$BUGDIR")"
printf 'x\n' > a.test.ts
mkdir .a1/dispositions.json
expect "D4 disposition add with a directory as .a1/dispositions.json exits 2" "2" \
  "$(rc disposition add --kind fidelity --rule skipped-test --file a.test.ts --line 1 --reason r --by fx --project "$WORK/repo")"
expect "D5 disposition review with a directory as .a1/dispositions.json exits 2" "2" \
  "$(rc disposition review skipped-test:a.test.ts:0123456789abcdef --verdict upheld --reason r --project "$WORK/repo")"
expect "D6 fix class-sweep --record with a directory as the bug file exits 2" "2" "$(rc fix class-sweep --record "$BUGDIR" --project "$WORK/repo")"
expect "D7 fix class-sweep --verify with a directory as the bug file exits 2" "2" "$(rc fix class-sweep --verify "$BUGDIR" --project "$WORK/repo")"
expect "D8 pr merge-check with a failing gh binary exits 2" "2" \
  "$(cd "$WORK/repo" && A1_GH_BIN=/usr/bin/false node "$TOOLS" pr merge-check --pr 1 --base HEAD --project "$WORK/repo" >/dev/null 2>&1; echo $?)"

# E hostile input never exits 0
expect "E1 verify run with --project pointing at a missing dir exits 2" "2" "$(rc verify run --project "$WORK/nope")"
expect "E2 test-fidelity with an option-shaped revision exits 2" "2" "$(rc test-fidelity --diff-base --output=x --project "$WORK/repo")"
expect "E3 an unknown flag on verify run exits 2" "2" "$(rc verify run --project "$WORK/repo" --frobnicate)"
expect "E4 a traversal scope in --phase exits 2 before the command runs" "2" "$(rc verify run --project "$WORK/repo" --phase ../x)"

echo
echo "RESULT: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
