#!/usr/bin/env bash
# Fixture suite: a1-metrics — pipeline metrics (spec 018).
#
# HARNESS ONLY (Wave 1, frozen afterwards): isolation, helpers, counters, summary.
# Every case lives in parts/NN-<group>.sh, sourced below in NN order, so the
# parallel waves 2 and 3 never write the same test file.
#
# Fixtures: fixtures/{postmortems,spec,fixes}/ are byte copies of real vault files
# (project/a1-specforge/, 2026-10-22). Edit only the field under test, in a copy.
#
# Isolation: no case reaches the developer's vault. The suite unsets every vault
# variable; each case passes A1_VAULT_ROOT per call, pointing at a mk_workdir copy.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUITE="$REPO_ROOT/_test-fixtures/a1-metrics"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
SHARED="$(dirname "$TOOLS")"
FIXT="$SUITE/fixtures"
export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0

pass=0; fail=0; results=()
ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# assert_rc <name> <expected> <actual> [detail]
assert_rc() {
  local name="$1" expected="$2" actual="$3" detail="${4:-}"
  if [[ "$actual" -eq "$expected" ]]; then ok "$name (exit $actual)"
  else bad "$name: expected exit $expected, got $actual${detail:+ — $detail}"; fi
}

# assert_eq <name> <got> <want>
assert_eq() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$name"
  else bad "$name (want=$want got=$got)"; fi
}

# assert_has <name> <haystack> <fixed-string>
assert_has() {
  if grep -qF -- "$3" <<<"$2"; then ok "$1"; else bad "$1 (missing '$3' in: ${2:0:200})"; fi
}

# run_tools <vault> <args...> — sets OUT (stdout+stderr) and RC. Never inherits a vault.
run_tools() {
  local vault="$1"; shift
  OUT="$(A1_VAULT_ROOT="$vault" node "$TOOLS" "$@" 2>&1)"; RC=$?
}

# mk_vault <VAR> <label> — fresh vault copy of the real fixtures under project/a1-specforge/.
mk_vault() {
  local __v
  mk_workdir __v "$2"
  mkdir -p "$__v/project/a1-specforge"
  cp -R "$FIXT/postmortems" "$FIXT/spec" "$FIXT/fixes" "$__v/project/a1-specforge/"
  printf -v "$1" '%s' "$__v"
}

# ---------- parts, in NN order ----------
shopt -s nullglob
parts=("$SUITE"/parts/*.sh)
shopt -u nullglob
if [[ ${#parts[@]} -eq 0 ]]; then
  echo "FAIL  harness: no parts/*.sh found under $SUITE" >&2
  fail=1
fi
for p in "${parts[@]}"; do
  # shellcheck disable=SC1090
  source "$p"
done

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-metrics: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
