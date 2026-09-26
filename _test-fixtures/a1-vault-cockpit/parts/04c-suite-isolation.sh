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
# FR-007 hooked command) and a1-checklist (runs no product writer). Their arms
# guard the day either starts to.

I_SUITES=(
  product-docs/run-tests.sh
  product-schema-v11/run.sh
  product-adopt/run-tests.sh
  product-import/run-tests.sh
  product-audit-mirror/run.sh
  a1-checklist/run-tests.sh
  a1-vault-fallback/run-tests.sh
  roadmap-gate/run-tests.sh
  a1-quick/run-tests.sh
)

caseI1() {
  local s sentinel home leaked
  for s in "${I_SUITES[@]}"; do
    sentinel="$(mktemp -d)"; home="$(mktemp -d)"
    A1_VAULT_ROOT="$sentinel" HOME="$home" bash "$REPO_ROOT/_test-fixtures/$s" >/dev/null 2>&1
    leaked="$(cd "$sentinel" && find . -mindepth 1 | sed 's#^\./##' | LC_ALL=C sort | head -3 | tr '\n' ' ' | sed 's/ $//')"
    if [[ -e "$sentinel/project" ]]; then bad "I1 $s created project/ in the sentinel vault ($leaked)"
    else ok "I1 $s: no project/ in the sentinel vault"; fi
    assert_eq "I1 $s leaves the sentinel vault empty" "$leaked" ""
    rm -rf "$sentinel" "$home"
  done
}
caseI1
