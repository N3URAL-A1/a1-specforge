#!/usr/bin/env bash
# Fixture suite: a1-lib-units — direct unit cases for _shared/lib modules that
# had no direct test (analysis 2026-10-08: no suite named the module file).
#
# One case file per module under cases/<module>.cjs. Each runs in node against
# the REAL module (path in argv[2]), prints PASS/FAIL lines and a final
# `UNITS <pass> <fail>` line. A case file that crashes or omits that line
# counts as one FAIL, so a broken require can never read as green.
#
# Isolation: HOME, TMPDIR and the working directory live in one mktemp root
# removed on EXIT; A1_VAULT_ROOT and the vault host keys are unset, so no case
# can reach a real vault or ~/.a1-xprov.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUITE="$REPO_ROOT/_test-fixtures/a1-lib-units"
LIB="$REPO_ROOT/_shared/lib"

pass=0
fail=0

SUITE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/a1-lib-units.XXXXXX")"
[[ -n "$SUITE_ROOT" && -d "$SUITE_ROOT" ]] || { echo "FAIL  harness: mktemp for the suite root failed" >&2; exit 1; }
trap 'rm -rf "$SUITE_ROOT"' EXIT
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

run_cases() {
  local module="$1" work out rc summary lib="$LIB"
  work="$SUITE_ROOT/$module"
  mkdir -p "$work/home" "$work/tmp" "$work/cwd"
  # Spec 016 plan D-2: xprov modules resolve ~/.a1-xprov from the OS user record, not $HOME. The cases run on a tree
  # COPY whose owner-home module is the fixture resolver (HOME-based), so they never touch the real store.
  case "$module" in
    xprov-*)
      mkdir -p "$work/tree" && cp -R "$REPO_ROOT/_shared" "$work/tree/_shared" && cp "$REPO_ROOT/_test-fixtures/a1-xprov/fake/xprov-owner-home.cjs" "$work/tree/_shared/lib/xprov-owner-home.cjs" && lib="$work/tree/_shared/lib" ;;
  esac
  out="$(cd "$work/cwd" && HOME="$work/home" TMPDIR="$work/tmp" node "$SUITE/cases/$module.cjs" "$lib" "$work" 2>&1)"
  rc=$?
  echo "$out" | grep -E '^(PASS|FAIL)  '
  summary="$(echo "$out" | grep -E '^UNITS [0-9]+ [0-9]+$' | tail -1)"
  if [[ -z "$summary" || $rc -ne 0 && "$summary" == "UNITS "*" 0" ]]; then
    echo "FAIL  $module: case file crashed or printed no summary (exit $rc)"
    echo "----- output -----"; echo "$out" | tail -20; echo "------------------"
    fail=$((fail + 1))
    return
  fi
  set -- $summary
  pass=$((pass + $2))
  fail=$((fail + $3))
}

for f in "$SUITE"/cases/*.cjs; do
  run_cases "$(basename "$f" .cjs)"
done

echo "a1-lib-units: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
