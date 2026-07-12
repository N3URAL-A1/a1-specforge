#!/usr/bin/env bash
# Fixture: SC-005 — roadmap-gate check on docs/product/ROADMAP.md preference
# with .a1/roadmap.md backward-compat fallback.
#
# The gate logic under test lives ONLY as prose + embedded bash in two
# workflow markdown files (no standalone script exists):
#   - skills/a1-new-feature/workflows/00-roadmap-gate.md  (Step 1 + Step 2)
#   - skills/a1-execute/workflows/01-load.md              (Step 0 + inline)
#
# Both files contain the IDENTICAL existence-check snippet (Step 1 /
# Step 0) and an equivalent parseability-check snippet (Step 2). To make
# fixture/doc drift impossible, the snippets below are copy-pasted
# VERBATIM from the current workflow files (see the line-range comment
# above each block). If a future edit changes the gate logic in the docs
# without updating this file, the verbatim comment below will visibly
# stop matching the doc on the next manual diff, and — more importantly —
# any behavioral drift (e.g. a changed grep pattern) will show up as a
# real fixture failure once someone re-pastes the new snippet in here.
#
# Scenarios (SC-005):
#   (a) only docs/product/ROADMAP.md present -> gate passes preferring it
#   (b) only .a1/roadmap.md present          -> gate passes via fallback
#   (c) neither present                      -> gate reports MISSING/HALT
set -u

pass=0
fail=0
results=()

ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# ---------------------------------------------------------------------
# VERBATIM from skills/a1-new-feature/workflows/00-roadmap-gate.md
# Step 1 — Roadmap existence check (lines 15-23):
#
#   if [ -f docs/product/ROADMAP.md ]; then
#     echo "EXISTS: docs/product/ROADMAP.md (preferred)"
#   elif [ -f .a1/roadmap.md ]; then
#     echo "EXISTS: .a1/roadmap.md (legacy — recommend on-touch migration)"
#   else
#     echo "MISSING"
#   fi
#
# Identical logic also appears (variable-capturing form) in
# skills/a1-execute/workflows/01-load.md Step 0 (lines 13-23):
#
#   if [ -f docs/product/ROADMAP.md ]; then
#     ROADMAP_FILE=docs/product/ROADMAP.md
#     echo "EXISTS: $ROADMAP_FILE (preferred)"
#   elif [ -f .a1/roadmap.md ]; then
#     ROADMAP_FILE=.a1/roadmap.md
#     echo "EXISTS: $ROADMAP_FILE (legacy — recommend on-touch migration)"
#   else
#     echo "MISSING"
#   fi
#
# check_existence() runs the a1-new-feature form (echo-only) so a test can
# capture stdout with `$(...)` and assert on it, exactly as the doc's own
# example invocation would print.
# ---------------------------------------------------------------------
check_existence() {
  if [ -f docs/product/ROADMAP.md ]; then
    echo "EXISTS: docs/product/ROADMAP.md (preferred)"
  elif [ -f .a1/roadmap.md ]; then
    echo "EXISTS: .a1/roadmap.md (legacy — recommend on-touch migration)"
  else
    echo "MISSING"
  fi
}

# ---------------------------------------------------------------------
# VERBATIM from skills/a1-new-feature/workflows/00-roadmap-gate.md
# Step 2 — Parseability check (lines 50-57):
#
#   if [ -f docs/product/ROADMAP.md ]; then
#     grep -q '^schema_version:' docs/product/ROADMAP.md && grep -q '<!-- entry:' docs/product/ROADMAP.md && echo "PARSEABLE" || echo "UNPARSEABLE"
#   else
#     grep -q '^---' .a1/roadmap.md && grep -q '<!-- entry:' .a1/roadmap.md && echo "PARSEABLE" || echo "UNPARSEABLE"
#   fi
#
# Equivalent $ROADMAP_FILE-parameterized form in
# skills/a1-execute/workflows/01-load.md Step 0 (lines 47-51):
#
#   if [ "$ROADMAP_FILE" = "docs/product/ROADMAP.md" ]; then
#     grep -q '^schema_version:' "$ROADMAP_FILE" && grep -q '<!-- entry:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
#   else
#     grep -q '^---' "$ROADMAP_FILE" && grep -q '<!-- entry:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
#   fi
# ---------------------------------------------------------------------
check_parseable() {
  if [ -f docs/product/ROADMAP.md ]; then
    grep -q '^schema_version:' docs/product/ROADMAP.md && grep -q '<!-- entry:' docs/product/ROADMAP.md && echo "PARSEABLE" || echo "UNPARSEABLE"
  else
    grep -q '^---' .a1/roadmap.md && grep -q '<!-- entry:' .a1/roadmap.md && echo "PARSEABLE" || echo "UNPARSEABLE"
  fi
}

# Run both checks inside a given directory (isolated mktemp workdir) and
# print "EXISTENCE_LINE|PARSEABLE_LINE" so the caller can assert on both
# in one subshell invocation without leaking cwd state into the parent.
run_gate() {
  local workdir="$1"
  (
    cd "$workdir" || exit 3
    exist_out="$(check_existence)"
    if [[ "$exist_out" == MISSING* ]]; then
      echo "${exist_out}|N/A"
    else
      parse_out="$(check_parseable)"
      echo "${exist_out}|${parse_out}"
    fi
  )
}

VALID_ROADMAP_DOCS='---
schema_version: 1
type: roadmap
project: fixture
status: active
---

# Fixture Roadmap

<!-- entry: m1-first -->
'

VALID_ROADMAP_LEGACY='---
project: fixture
---

# Fixture Roadmap (legacy)

<!-- entry: m1-first -->
'

# --- (a) only docs/product/ROADMAP.md present -> gate passes preferring it ---
WORK_A="$(mktemp -d)"
mkdir -p "$WORK_A/docs/product"
printf '%s' "$VALID_ROADMAP_DOCS" > "$WORK_A/docs/product/ROADMAP.md"

RESULT_A="$(run_gate "$WORK_A")"
EXIST_A="${RESULT_A%%|*}"
PARSE_A="${RESULT_A##*|}"

if [[ "$EXIST_A" == "EXISTS: docs/product/ROADMAP.md (preferred)" ]]; then
  ok "a-existence-prefers-docs-product ($EXIST_A)"
else
  bad "a-existence-prefers-docs-product (got: $EXIST_A)"
fi

if [[ "$PARSE_A" == "PARSEABLE" ]]; then
  ok "a-parseable-and-gate-passes"
else
  bad "a-parseable-and-gate-passes (got: $PARSE_A)"
fi
rm -rf "$WORK_A"

# --- (b) only .a1/roadmap.md present -> gate passes via fallback ---
WORK_B="$(mktemp -d)"
mkdir -p "$WORK_B/.a1"
printf '%s' "$VALID_ROADMAP_LEGACY" > "$WORK_B/.a1/roadmap.md"

RESULT_B="$(run_gate "$WORK_B")"
EXIST_B="${RESULT_B%%|*}"
PARSE_B="${RESULT_B##*|}"

if [[ "$EXIST_B" == "EXISTS: .a1/roadmap.md (legacy — recommend on-touch migration)" ]]; then
  ok "b-existence-falls-back-to-legacy ($EXIST_B)"
else
  bad "b-existence-falls-back-to-legacy (got: $EXIST_B)"
fi

if [[ "$PARSE_B" == "PARSEABLE" ]]; then
  ok "b-parseable-and-gate-passes-via-fallback"
else
  bad "b-parseable-and-gate-passes-via-fallback (got: $PARSE_B)"
fi
rm -rf "$WORK_B"

# --- (b2) both present -> docs/product/ still wins (preference, not just fallback) ---
WORK_B2="$(mktemp -d)"
mkdir -p "$WORK_B2/docs/product" "$WORK_B2/.a1"
printf '%s' "$VALID_ROADMAP_DOCS" > "$WORK_B2/docs/product/ROADMAP.md"
printf '%s' "$VALID_ROADMAP_LEGACY" > "$WORK_B2/.a1/roadmap.md"

RESULT_B2="$(run_gate "$WORK_B2")"
EXIST_B2="${RESULT_B2%%|*}"

if [[ "$EXIST_B2" == "EXISTS: docs/product/ROADMAP.md (preferred)" ]]; then
  ok "b2-both-present-docs-product-still-preferred"
else
  bad "b2-both-present-docs-product-still-preferred (got: $EXIST_B2)"
fi
rm -rf "$WORK_B2"

# --- (c) neither present -> gate reports MISSING/HALT ---
WORK_C="$(mktemp -d)"
# deliberately empty: no docs/product/ROADMAP.md, no .a1/roadmap.md

RESULT_C="$(run_gate "$WORK_C")"
EXIST_C="${RESULT_C%%|*}"

if [[ "$EXIST_C" == "MISSING" ]]; then
  ok "c-neither-present-reports-missing"
else
  bad "c-neither-present-reports-missing (got: $EXIST_C)"
fi
rm -rf "$WORK_C"

# --- (d) unparseable docs/product/ROADMAP.md -> treated as missing (HALT), never silently overwritten ---
WORK_D="$(mktemp -d)"
mkdir -p "$WORK_D/docs/product"
printf 'not a real roadmap, no frontmatter, no entry marker\n' > "$WORK_D/docs/product/ROADMAP.md"

RESULT_D="$(run_gate "$WORK_D")"
EXIST_D="${RESULT_D%%|*}"
PARSE_D="${RESULT_D##*|}"

if [[ "$EXIST_D" == "EXISTS: docs/product/ROADMAP.md (preferred)" && "$PARSE_D" == "UNPARSEABLE" ]]; then
  ok "d-unparseable-docs-product-treated-as-missing"
else
  bad "d-unparseable-docs-product-treated-as-missing (got: $EXIST_D | $PARSE_D)"
fi
rm -rf "$WORK_D"

printf '\n--- roadmap-gate fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
