#!/usr/bin/env bash
# Fixture: SC-005 — roadmap-gate check on docs/product/ROADMAP.md preference
# with .a1/roadmap.md backward-compat fallback.
#
# The gate logic under test lives ONLY as prose + embedded bash — no standalone
# script exists. Its single owner since M13 is:
#   - _shared/roadmap-gate-check.md   (§1 existence, §2 parseability, §3 membership)
# Both callers delegate to it: skills/a1-new-feature/workflows/00-roadmap-gate.md
# and skills/a1-execute/workflows/01-load.md.
#
# The snippets below are COPIES of the owner's, not reads of it — bash embedded
# in Markdown cannot be sourced. That copy relationship is a real drift risk and
# is NOT self-enforcing: this header previously claimed the copies made "drift
# impossible", and on 2026-09-20 the owner's §2 and §3 both changed while every
# case here stayed green. Treat the NOTE above each copied function as the
# reminder to re-copy, and keep each case's mutation proof current: a case that
# cannot turn red when the contract it names is reverted is documentation, not
# a test (see ~/.claude/rules/common/testing.md).
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
# VERBATIM from _shared/roadmap-gate-check.md §2 (the canonical owner; the
# two callers, a1-new-feature/workflows/00-roadmap-gate.md and
# a1-execute/workflows/01-load.md Step 0, delegate to it):
#
#   if [ "$ROADMAP_FILE" = "docs/product/ROADMAP.md" ]; then
#     grep -q '^schema_version:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
#   else
#     grep -q '^---' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
#   fi
#
# Updated 2026-09-20 (7th a1-evolve run): the `<!-- entry:` conjunct was
# REMOVED from parseability. Those markers are emitted by exactly one code
# path (`_shared/lib/product.cjs`, adopt/migration branch); `product init`
# encodes entries in the frontmatter instead. Requiring the marker made the
# gate halt on 11 of 14 real project roadmaps that `product validate` called
# valid. Case (e) below is that measured false alarm, kept as a regression.
#
# NOTE this function is a COPY of the owner's snippet, not a read of it — if
# §2 changes again, case (e)'s comment is the reminder to re-copy it here.
# ---------------------------------------------------------------------
check_parseable() {
  if [ -f docs/product/ROADMAP.md ]; then
    grep -q '^schema_version:' docs/product/ROADMAP.md && echo "PARSEABLE" || echo "UNPARSEABLE"
  else
    grep -q '^---' .a1/roadmap.md && echo "PARSEABLE" || echo "UNPARSEABLE"
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

# --- (e) product-init roadmap: schema_version, NO entry marker -> PARSEABLE ---
# Regression for the 2026-09-20 false alarm. Body copied 2026-09-20 from
# ~/claude-projects/n3ural-socialmedia/docs/product/ROADMAP.md (frontmatter
# `updated: 2026-09-17`, written by `product init`: frontmatter-encoded
# entries, zero HTML comments) — NOT reconstructed from the check being
# tested. Under the old two-conjunct rule this returned
# UNPARSEABLE and halted the skill in 11 of 14 projects.
WORK_E="$(mktemp -d)"
mkdir -p "$WORK_E/docs/product"
cat > "$WORK_E/docs/product/ROADMAP.md" <<'ROADMAP_E'
---
schema_version: 1
type: roadmap
project: n3ural-socialmedia
title: n3ural-socialmedia
status: active
updated: 2026-09-17
source: "scaffolded by a1-tools product init"
milestones:
  - id: m1-strategie
    title: Strategie
    status: in-progress
    target: 2026-09
features:
  - id: 001-positionierung-story
    milestone: m1-strategie
    status: done
---

# Roadmap
ROADMAP_E

RESULT_E="$(run_gate "$WORK_E")"
PARSE_E="${RESULT_E##*|}"

if [[ "$PARSE_E" == "PARSEABLE" ]]; then
  ok "e-product-init-roadmap-without-entry-marker-is-parseable"
else
  bad "e-product-init-roadmap-without-entry-marker-is-parseable (got: $PARSE_E)"
fi
rm -rf "$WORK_E"

# --- (f) membership accepts BOTH encodings: comment and frontmatter id ---
# §3 regression, same root cause as (e) one level down. Measured 2026-09-20
# over the real corpus: 74 of 85 specs carrying a `roadmap_entry:` reported
# MISMATCH while their slug sat in the frontmatter of the very roadmap being
# checked. Body copied from a1-office-landing's real roadmap shape.
WORK_F="$(mktemp -d)"
cat > "$WORK_F/ROADMAP.md" <<'ROADMAP_F'
---
schema_version: 1
features:
  - id: 004-eu-badge-prominent
    milestone: m1
---

### Milestone One <!-- entry: m1-legacy-comment -->
ROADMAP_F

check_member() {  # $1 = slug, $2 = file  (copy of owner §3; re-copy on change)
  local slug_re
  slug_re=$(printf '%s' "$1" | sed 's/[^a-zA-Z0-9]/\\&/g')
  if grep -q "<!-- entry: $1 -->" "$2" \
     || grep -qE "^[[:space:]]*- id: ${slug_re}([[:space:]]|$)" "$2"; then
    echo "FOUND"
  else
    echo "MISMATCH"
  fi
}

M_FRONTMATTER="$(check_member '004-eu-badge-prominent' "$WORK_F/ROADMAP.md")"
M_COMMENT="$(check_member 'm1-legacy-comment' "$WORK_F/ROADMAP.md")"
M_ABSENT="$(check_member '999-not-there' "$WORK_F/ROADMAP.md")"
M_PREFIX="$(check_member '004-eu' "$WORK_F/ROADMAP.md")"

if [[ "$M_FRONTMATTER" == "FOUND" ]]; then
  ok "f-membership-accepts-frontmatter-id"
else
  bad "f-membership-accepts-frontmatter-id (got: $M_FRONTMATTER)"
fi

if [[ "$M_COMMENT" == "FOUND" ]]; then
  ok "f-membership-still-accepts-entry-comment"
else
  bad "f-membership-still-accepts-entry-comment (got: $M_COMMENT)"
fi

if [[ "$M_ABSENT" == "MISMATCH" ]]; then
  ok "f-membership-still-reports-absent-slug"
else
  bad "f-membership-still-reports-absent-slug (got: $M_ABSENT)"
fi

if [[ "$M_PREFIX" == "MISMATCH" ]]; then
  ok "f-membership-rejects-prefix-of-a-real-id"
else
  bad "f-membership-rejects-prefix-of-a-real-id (got: $M_PREFIX)"
fi
M_REGEX="$(check_member '004.eu.badge.prominent' "$WORK_F/ROADMAP.md")"

if [[ "$M_REGEX" == "MISMATCH" ]]; then
  ok "f-membership-treats-the-slug-literally-not-as-a-pattern"
else
  bad "f-membership-treats-the-slug-literally-not-as-a-pattern (got: $M_REGEX)"
fi
rm -rf "$WORK_F"

# --- (g) legacy .a1/roadmap.md WITHOUT an entry marker -> PARSEABLE ---
# Covers the else-branch of check_parseable, which no other case exercises:
# case (b) uses $VALID_ROADMAP_LEGACY, which happens to carry a marker, so
# re-adding the `<!-- entry:` conjunct to the legacy branch alone left all 12
# tests green (measured 2026-09-20, found in review). Class 1 of testing.md --
# the suite did not enter the path it claimed to cover.
WORK_G="$(mktemp -d)"
mkdir -p "$WORK_G/.a1"
cat > "$WORK_G/.a1/roadmap.md" <<'ROADMAP_G'
---
project: demo
status: active
---

# Roadmap

## M1 — First milestone
- [ ] 001-first-feature
ROADMAP_G

RESULT_G="$(run_gate "$WORK_G")"
PARSE_G="${RESULT_G##*|}"

if [[ "$PARSE_G" == "PARSEABLE" ]]; then
  ok "g-legacy-roadmap-without-entry-marker-is-parseable"
else
  bad "g-legacy-roadmap-without-entry-marker-is-parseable (got: $PARSE_G)"
fi
rm -rf "$WORK_G"

printf '\n--- roadmap-gate fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
