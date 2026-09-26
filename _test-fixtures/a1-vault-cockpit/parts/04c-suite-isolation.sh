#!/usr/bin/env bash
# Part 04c — Wave 4 agent A, section I: suite isolation from the real vault.
# Sourced by run-tests.sh.
#
# Since Wave 4 every product writer mirrors docs/product into A1_VAULT_ROOT.
# On a developer machine that variable points at the real vault (~/.zshenv),
# so every suite that runs product writers starts with `unset A1_VAULT_ROOT`.
# This arm proves it: each suite runs once with A1_VAULT_ROOT set to an empty
# mktemp -d SENTINEL vault, and the sentinel must still be empty afterwards.
# The suite's own pass/fail is not judged here (its own CI step does that).
#
# Red-making change: deleting the `unset A1_VAULT_ROOT` line from one of the
# product suites — the sentinel then holds project/<fixture-slug>/product/.
# Measured 2026-09-26 on throwaway copies: red for product-docs,
# product-schema-v11, product-adopt and product-audit-mirror. Green without the
# line, and therefore precautionary: product-import (`product import` is not a
# FR-007 hooked command), a1-checklist, a1-vault-fallback, roadmap-gate and
# a1-quick (no product writer reaches a docs/product dir there today, or every
# call already sets its own vault). Their arms guard the day that changes.

# Wave 5 (security review MINOR 2): generic — every suite runner
# _test-fixtures/*/run-tests.sh and */run.sh except this suite, found by glob,
# so a new suite is covered the day it lands (no list to forget). Each runs
# with A1_VAULT_WRITER_HOST unset (a declared other host would hide a leak).
# Runtime measured 2026-09-26: 121 s for 33 suites, a1-xprov 78 s of it.
# Red-making changes: deleting `unset A1_VAULT_ROOT` from product-docs (red,
# as before), or adding a suite that runs `product init` without it (red —
# the fixed list could not see it).

I_OWN_SUITE="a1-vault-cockpit"

i_suites() {
  local r
  for r in "$REPO_ROOT"/_test-fixtures/*/run-tests.sh "$REPO_ROOT"/_test-fixtures/*/run.sh; do
    [[ -f "$r" ]] || continue
    [[ "$(basename "$(dirname "$r")")" == "$I_OWN_SUITE" ]] && continue
    printf '%s\n' "${r#"$REPO_ROOT/_test-fixtures/"}"
  done
}

caseI1() {
  local s sentinel home leaked n=0 t0=$SECONDS
  while IFS= read -r s; do
    n=$((n + 1))
    sentinel="$(mktemp -d)"; home="$(mktemp -d)"
    env -u A1_VAULT_WRITER_HOST A1_VAULT_ROOT="$sentinel" HOME="$home" bash "$REPO_ROOT/_test-fixtures/$s" >/dev/null 2>&1
    leaked="$(cd "$sentinel" && find . -mindepth 1 | sed 's#^\./##' | LC_ALL=C sort | head -3 | tr '\n' ' ' | sed 's/ $//')"
    if [[ -e "$sentinel/project" ]]; then bad "I1 $s created project/ in the sentinel vault ($leaked)"
    else ok "I1 $s: no project/ in the sentinel vault"; fi
    assert_eq "I1 $s leaves the sentinel vault empty" "$leaked" ""
    rm -rf "$sentinel" "$home"
  done < <(i_suites)
  # the glob must see at least the nine suites the fixed list named before Wave 5
  if [[ $n -ge 9 ]]; then ok "I1 glob found $n suites ($((SECONDS - t0)) s)"; else bad "I1 glob found only $n suites"; fi
}
caseI1
