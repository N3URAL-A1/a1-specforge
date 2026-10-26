#!/usr/bin/env bash
# Spec 023 Wave 2: pure module derivation (product-modules.cjs) and the new
# project NEXT.md sections (product-derived.cjs). Expected values are
# hand-calculated literals from the spec rule (FR-008/009/010), never produced
# by the code under test. Cursor rule: first feature in roadmap order that is
# not done/cancelled with all depends_on done (in-flight stays eligible, same
# as the project cursor).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
Q="node $HERE/derive-query.cjs"
R="node $HERE/derive-run.cjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL - $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected: $3 | got: $2)"; fi; }
has()  { if printf '%s\n' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (missing: $3)"; fi; }
hasnt(){ if printf '%s\n' "$2" | grep -qF -- "$3"; then bad "$1 (unexpected: $3)"; else ok "$1"; fi; }
line() { printf '%s\n' "$1" | grep -nF -- "$2" | head -1 | cut -d: -f1; }

# --- self-guard: no-module output byte-identical to output of the unchanged generator
for c in plain plainDone; do
  $R $c "$TMP/g-$c" || bad "derive-run $c failed"
  if diff -r "$HERE/golden-derive/$c" "$TMP/g-$c" >/dev/null; then ok "golden-derive $c byte-identical"; else bad "golden-derive $c differs"; fi
done
P="$($Q plain project-next)"
hasnt "no module: no 'Next per module' section" "$P" "## Next per module"
hasnt "no module: no 'Unassigned milestones' section" "$P" "## Unassigned milestones"

# --- SC-002: 3 modules; hand-calculated cursors
# immobilien: 010 done, 011 cancelled, 012 in-flight eligible -> 012 (013 blocked by 020, 014 later)
# crm-core: 020 in-flight, no deps -> 020; platform: 030 done, 031 -> 031
eq "SC-002 cursors (skip done+cancelled; cross-module dep)" "$($Q three cursors | tr '\n' ' ')" "immobilien=012 crm-core=020 platform=031 "
N="$($Q three module-next immobilien)"
has "module NEXT title" "$N" "# NEXT.md — module immobilien"
has "module NEXT cursor line" "$N" "**012** — recommended next feature (all dependencies (010) are done)."
has "module NEXT in-flight only own module" "$N" "- **012** — F-012 (milestone: M2, stage: execute)"
hasnt "module NEXT excludes other modules' in-flight" "$N" "F-020"
has "module NEXT how to continue" "$N" "## How to continue"
has "module NEXT header" "$N" "<!-- generated file — do not hand-edit."
has "module NEXT updated" "$N" "updated: 2026-01-01"
eq "crm-core cursor line has no-deps rationale" "$($Q three module-next crm-core | grep -E '^\*\*020\*\*')" "**020** — recommended next feature (no unmet dependencies, first eligible feature in roadmap order)."

# --- cross-module dep blocks the roadmap-order first eligible feature of alpha: cursor skips to 102
eq "cross-module: blocked first feature skipped" "$($Q cross cursors | tr '\n' ' ')" "alpha=102 beta=201 gamma=null "
eq "cross-module: gamma blocked by unassigned dep" "$($Q cross module-next gamma | grep -E '^None —')" "None — blocked: 301 waits for 401 (module unassigned, status planned)."

# --- SC-003: 4 modules, 4 distinct cursors
eq "SC-003 four distinct cursors" "$($Q four cursors | tr '\n' ' ')" "a=001 b=101 c=201 d=301 "

# --- AC-1b: blocked; first open feature 062, first unmet dep 070 (not 071), crm-core in-flight
eq "AC-1b blocked text" "$($Q blocked module-next immobilien | grep -E '^None —')" "None — blocked: 062 waits for 070 (module crm-core, status in-flight)."
eq "blocked: crm-core own cursor is 070" "$($Q blocked cursors | tr '\n' ' ')" "immobilien=null crm-core=070 "

# --- zero-feature + all-done module
NOF="None — no open feature in this module (all done/cancelled, or none planned)."
eq "zero-feature module -> no-open-feature text" "$($Q empty module-next nofeat | grep -E '^None —')" "$NOF"
eq "all-done module -> no-open-feature text" "$($Q empty module-next alldone | grep -E '^None —')" "$NOF"

# --- AC-5a + section order
A="$($Q ac5a project-next)"
has "AC-5a cursor id for module with eligible feature" "$A" "- **zeta** — **001**"
has "AC-5a None for module without feature" "$A" "- **alpha** — None"
has "AC-5a unassigned milestone listed" "$A" "- **U1** — T-U1"
a="$(line "$A" "## Next cursor")"; b="$(line "$A" "## Next per module")"; c="$(line "$A" "## Unassigned milestones")"; d="$(line "$A" "## How to continue")"
if [ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ] && [ -n "$d" ] && [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ] && [ "$c" -lt "$d" ]; then ok "section order cursor<per-module<unassigned<continue ($a<$b<$c<$d)"; else bad "section order ($a,$b,$c,$d)"; fi
if [ -n "$a" ] && [ -n "$b" ] && [ "$b" -eq $((a+4)) ]; then ok "'Next per module' directly after 'Next cursor' section"; else bad "per-module not directly after cursor (a=$a b=$b)"; fi
zl="$(line "$A" "- **zeta**")"; al="$(line "$A" "- **alpha**")"
if [ -n "$zl" ] && [ -n "$al" ] && [ "$zl" -lt "$al" ]; then ok "module order follows modules: list (zeta before alpha)"; else bad "module order"; fi
# no untagged milestone -> no Unassigned section
T="$($Q three project-next)"
hasnt "no untagged milestone: no Unassigned section" "$T" "## Unassigned milestones"
has "three: per-module lines" "$T" "- **platform** — **031**"
has "project cursor line unchanged in meaning (first eligible overall = 012)" "$T" "**012** — recommended next feature (all dependencies (010) are done)."

echo "---- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
