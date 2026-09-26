#!/usr/bin/env bash
# Part 04c — Wave 4 agent A, section I: suite isolation from the real vault.
# Sourced by run-tests.sh.
#
# Since Wave 4 every product writer mirrors docs/product into A1_VAULT_ROOT.
# On a developer machine that variable points at the real vault (~/.zshenv),
# so every suite that runs product writers starts with `unset A1_VAULT_ROOT`.
# This arm proves it: each suite runs once with A1_VAULT_ROOT set to an empty
# mktemp -d SENTINEL vault, and the sentinel must still be empty afterwards.
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

# Review 010 m7 (2026-09-26): the arm ignored each suite's exit code, which
# hid B1 (the fallback suite failed on GNU mktemp and then ran its scenarios
# in the checkout). Now a non-zero exit is a FAIL next to the leak check
# (I1 "... exits 0"). And a1-reconcile rewrites timestamps in its own tracked
# fixtures on every run, so the arm restores exactly that path afterwards —
# only when it was clean before (a developer's own edits there are never
# discarded) — and then checks that the path is clean again (I2). Scoped to
# that path on purpose: a whole-tree before/after compare turns red whenever
# someone edits the checkout while the suite runs (measured 2026-09-26).
# Red-making changes: I1-exit — dropping the rc assertion (a child suite that
# exits 1, e.g. B1 on ubuntu, turns nothing red); I2 — dropping the
# a1-reconcile restore (its 2 fixture files stay modified after the arm).

I_OWN_SUITE="a1-vault-cockpit"
I_RESTORE_REL="_test-fixtures/a1-reconcile/"

i_suites() {
  local r
  for r in "$REPO_ROOT"/_test-fixtures/*/run-tests.sh "$REPO_ROOT"/_test-fixtures/*/run.sh; do
    [[ -f "$r" ]] || continue
    [[ "$(basename "$(dirname "$r")")" == "$I_OWN_SUITE" ]] && continue
    printf '%s\n' "${r#"$REPO_ROOT/_test-fixtures/"}"
  done
}

caseI1() {
  local s sentinel home leaked rc n=0 t0=$SECONDS restore=""
  if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
     && git -C "$REPO_ROOT" diff --quiet -- "$I_RESTORE_REL" 2>/dev/null; then restore=yes; fi
  while IFS= read -r s; do
    n=$((n + 1))
    sentinel="$(mktemp -d)"; home="$(mktemp -d)"
    if [[ -z "$sentinel" || ! -d "$sentinel" || -z "$home" || ! -d "$home" ]]; then
      bad "I1 $s: mktemp gave no directory — suite not run"; continue
    fi
    env -u A1_VAULT_WRITER_HOST A1_VAULT_ROOT="$sentinel" HOME="$home" bash "$REPO_ROOT/_test-fixtures/$s" >/dev/null 2>&1
    rc=$?
    assert_rc "I1 $s exits 0 under the sentinel vault" 0 "$rc" "run it on its own to see the failures"
    leaked="$(cd "$sentinel" && find . -mindepth 1 | sed 's#^\./##' | LC_ALL=C sort | head -3 | tr '\n' ' ' | sed 's/ $//')"
    if [[ -e "$sentinel/project" ]]; then bad "I1 $s created project/ in the sentinel vault ($leaked)"
    else ok "I1 $s: no project/ in the sentinel vault"; fi
    assert_eq "I1 $s leaves the sentinel vault empty" "$leaked" ""
    rm -rf "$sentinel" "$home"
  done < <(i_suites)
  # the glob must see at least the nine suites the fixed list named before Wave 5
  if [[ $n -ge 9 ]]; then ok "I1 glob found $n suites ($((SECONDS - t0)) s)"; else bad "I1 glob found only $n suites"; fi
  if [[ -n "$restore" ]]; then
    git -C "$REPO_ROOT" checkout -q -- "$I_RESTORE_REL"
    if git -C "$REPO_ROOT" diff --quiet -- "$I_RESTORE_REL"; then ok "I2 $I_RESTORE_REL is clean again after the arm"
    else bad "I2 $I_RESTORE_REL still modified after the arm: $(git -C "$REPO_ROOT" diff --name-only -- "$I_RESTORE_REL" | tr '\n' ' ')"; fi
  else
    ok "I2 skipped: $I_RESTORE_REL had local edits before the arm (or no git tree) — left untouched"
  fi
}
caseI1
