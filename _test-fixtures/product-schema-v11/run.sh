#!/usr/bin/env bash
# Scenario suite for schema v1.1 (`docs/product/VISION.md` + `docs/product/
# audits/<date>-<focus>.md`) — Wave 1 of spec 003-product-schema-v1.1-vision-audits.
# Exercises `product validate`'s new VISION.md / audits/*.md coverage
# (FR-001, FR-002, FR-005, FR-006, FR-017) added to
# `_shared/lib/product.cjs` (`validateVisionFm`, `validateAuditFm`,
# extended `cmdProductValidate`). Mirrors the mktemp/assert_rc/assert_true
# harness style established by `_test-fixtures/product-docs/run-tests.sh`.
#
# Scenarios:
#   SC-002: valid hand-authored VISION.md + one valid audit file -> validate
#     exits 0, no vision/audit errors
#   FR-001: VISION.md with empty pillars: [] -> validate exits 1, error
#     mentions "pillars"
#   FR-001: VISION.md with pillars key omitted entirely -> validate exits 1,
#     error mentions "pillars"
#   FR-005: audit file missing required `verdict` field -> validate exits 1
#   FR-006: finding with an out-of-enum `status` -> validate exits 1, error
#     mentions "status"
#   FR-006: all four valid statuses (open/fixed/obsolete/accepted) accepted
#   legacy edge case (spec 002 / niimo migration): malformed
#     `depends_on: "[a, b]"` (a YAML string, not a real array) on a
#     ROADMAP.md feature -> still caught as invalid by `product validate`
#     (regression coverage — this is a ROADMAP.md-level case, proving Wave 1
#     did not weaken the existing v1 checks while extending validate)
#   SC-004: docs/product/ with a v1 ROADMAP.md but NO VISION.md and NO
#     audits/ directory -> validate exits 0, no vision/audit errors
#     (backward-compat degrade-to-no-op)
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL  $name: expected exit $expected, got $actual"
    echo "----- output -----"; echo "$out"; echo "------------------"
    fail=$((fail + 1))
  else
    echo "PASS  $name (exit $actual)"
    pass=$((pass + 1))
  fi
}

assert_true() {
  local name="$1" cond="$2"
  if [[ "$cond" == "true" ]]; then
    echo "PASS  $name"; pass=$((pass + 1))
  else
    echo "FAIL  $name"; fail=$((fail + 1))
  fi
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qi -- "$needle"; then
    echo "PASS  $name (found: $needle)"; pass=$((pass + 1))
  else
    echo "FAIL  $name: expected output to mention '$needle'"
    echo "----- output -----"; echo "$haystack"; echo "------------------"
    fail=$((fail + 1))
  fi
}

# write_base_roadmap <productDir> <projectSlug> — a minimal, always-valid v1
# ROADMAP.md so every scenario below can focus purely on the VISION.md /
# audits/*.md dimension without also having to satisfy roadmap-level
# validation from scratch.
write_base_roadmap() {
  local pdir="$1" project="$2"
  mkdir -p "$pdir"
  cat > "$pdir/ROADMAP.md" <<EOF
---
schema_version: 1
type: roadmap
project: ${project}
title: ${project} — Roadmap
status: active
updated: 2026-07-13
source: "test fixture"
milestones:
  - id: m1-first
    title: First Milestone
    status: in-progress
    target: 2026-08
features:
  - id: 001-first-feature
    milestone: m1-first
    title: First Feature
    status: planned
    stage: null
    depends_on: []
    started: null
    finished: null
    spec_path: null
    plan_path: null
next: 001-first-feature
---

# ${project} — Roadmap

> Fixture roadmap for schema v1.1 tests.

## Milestones

### First Milestone <!-- entry: m1-first -->
Status: in-progress · Target: 2026-08
Goal: fixture milestone.

**Features:**
- [ ] **001-first-feature** — First Feature: fixture feature.

## In-flight features

None.

## Changelog

- **2026-07-13** — Created fixture.
EOF
}

write_valid_vision() {
  local pdir="$1" project="$2"
  cat > "$pdir/VISION.md" <<EOF
---
schema_version: 1
type: vision
project: ${project}
title: ${project} — Vision
updated: 2026-07-13
pillars:
  - id: reliability
    title: Reliability
    summary: The product never loses user data.
  - id: speed
    title: Speed
    summary: Common workflows complete in under a second.
---

# ${project} — Vision

> Fixture vision narrative for schema v1.1 tests.
EOF
}

write_valid_audit() {
  local pdir="$1" project="$2" status="${3:-open}"
  mkdir -p "$pdir/audits"
  cat > "$pdir/audits/2026-07-13-general.md" <<EOF
---
schema_version: 1
type: audit
project: ${project}
focus: general
date: 2026-07-13
source: "test analysis fixture"
verdict: "beta-ready, 1 open finding"
counts: { blocker: 0, major: 1, minor: 0 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: ${status}
    fixed_commit: null
    feature: null
last_validated: 2026-07-13
---

# Audit — general (2026-07-13)

> Fixture audit for schema v1.1 tests.
EOF
}

# ===========================================================================
# Scenario 1 (SC-002): valid VISION.md + valid audit file -> validate exits 0
# ===========================================================================
WORK1="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-valid.XXXXXX")"
PDIR1="$WORK1/docs/product"
write_base_roadmap "$PDIR1" "schema-v11-valid"
write_valid_vision "$PDIR1" "schema-v11-valid"
write_valid_audit "$PDIR1" "schema-v11-valid" "open"

OUT="$(node "$TOOLS" product validate --dir "$PDIR1" 2>&1)"
RC=$?
assert_rc "valid-vision-and-audit-exit-0" 0 "$RC" "$OUT"

if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (Array.isArray(data.errors) && data.errors.length > 0) process.exit(1);
'; then
  assert_true "valid-vision-and-audit-no-errors" "true"
else
  assert_true "valid-vision-and-audit-no-errors" "false"
fi

# ===========================================================================
# Scenario 2 (FR-001): VISION.md with empty pillars: [] -> validate exits 1
# ===========================================================================
WORK2="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-emptypillars.XXXXXX")"
PDIR2="$WORK2/docs/product"
write_base_roadmap "$PDIR2" "schema-v11-emptypillars"
cat > "$PDIR2/VISION.md" <<EOF
---
schema_version: 1
type: vision
project: schema-v11-emptypillars
title: Schema V11 Emptypillars — Vision
updated: 2026-07-13
pillars: []
---

# Vision with empty pillars

> Should be rejected — pillars[] must be non-empty (FR-001).
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR2" 2>&1)"
RC=$?
assert_rc "empty-pillars-exit-1" 1 "$RC" "$OUT"
assert_contains "empty-pillars-error-mentions-pillars" "$OUT" "pillars"

# ===========================================================================
# Scenario 3 (FR-001): VISION.md with pillars key omitted entirely -> exit 1
# ===========================================================================
WORK3="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-nopillars.XXXXXX")"
PDIR3="$WORK3/docs/product"
write_base_roadmap "$PDIR3" "schema-v11-nopillars"
cat > "$PDIR3/VISION.md" <<EOF
---
schema_version: 1
type: vision
project: schema-v11-nopillars
title: Schema V11 Nopillars — Vision
updated: 2026-07-13
---

# Vision with pillars omitted entirely

> Should be rejected — pillars[] must be present and non-empty (FR-001).
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR3" 2>&1)"
RC=$?
assert_rc "omitted-pillars-exit-1" 1 "$RC" "$OUT"
assert_contains "omitted-pillars-error-mentions-pillars" "$OUT" "pillars"

# ===========================================================================
# Scenario 4 (FR-005): audit file missing required `verdict` field -> exit 1
# ===========================================================================
WORK4="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-noverdict.XXXXXX")"
PDIR4="$WORK4/docs/product"
write_base_roadmap "$PDIR4" "schema-v11-noverdict"
mkdir -p "$PDIR4/audits"
cat > "$PDIR4/audits/2026-07-13-general.md" <<EOF
---
schema_version: 1
type: audit
project: schema-v11-noverdict
focus: general
date: 2026-07-13
source: "test analysis fixture"
counts: { blocker: 0, major: 1, minor: 0 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: open
    fixed_commit: null
    feature: null
last_validated: 2026-07-13
---

# Audit missing verdict — should be rejected (FR-005).
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR4" 2>&1)"
RC=$?
assert_rc "audit-missing-verdict-exit-1" 1 "$RC" "$OUT"
assert_contains "audit-missing-verdict-error-mentions-verdict" "$OUT" "verdict"

# ===========================================================================
# Scenario 5 (FR-006): finding status out of enum -> validate exits 1
# ===========================================================================
WORK5="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-badstatus.XXXXXX")"
PDIR5="$WORK5/docs/product"
write_base_roadmap "$PDIR5" "schema-v11-badstatus"
mkdir -p "$PDIR5/audits"
cat > "$PDIR5/audits/2026-07-13-general.md" <<EOF
---
schema_version: 1
type: audit
project: schema-v11-badstatus
focus: general
date: 2026-07-13
source: "test analysis fixture"
verdict: "beta-ready, 1 open finding"
counts: { blocker: 0, major: 1, minor: 0 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: wontfix
    fixed_commit: null
    feature: null
last_validated: 2026-07-13
---

# Audit with an invalid finding status — should be rejected (FR-006).
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR5" 2>&1)"
RC=$?
assert_rc "finding-invalid-status-exit-1" 1 "$RC" "$OUT"
assert_contains "finding-invalid-status-error-mentions-status" "$OUT" "status"

# ===========================================================================
# Scenario 6 (FR-006): all four valid statuses accepted, one audit file each
# ===========================================================================
for st in open fixed obsolete accepted; do
  WORKST="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-status-${st}.XXXXXX")"
  PDIRST="$WORKST/docs/product"
  write_base_roadmap "$PDIRST" "schema-v11-status-${st}"
  write_valid_audit "$PDIRST" "schema-v11-status-${st}" "$st"
  OUT="$(node "$TOOLS" product validate --dir "$PDIRST" 2>&1)"
  RC=$?
  assert_rc "finding-status-${st}-accepted-exit-0" 0 "$RC" "$OUT"
done

# ===========================================================================
# Scenario 7 (legacy edge case, spec 002 / niimo migration parity): a
# ROADMAP.md feature with malformed depends_on: "[a, b]" (a YAML string, NOT
# a real array) must still be caught as invalid by `product validate` — this
# proves Wave 1's validate extension did not weaken the pre-existing v1
# depends_on-must-be-an-array check while adding VISION.md/audits coverage.
# ===========================================================================
WORK7="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-legacy-depends.XXXXXX")"
PDIR7="$WORK7/docs/product"
mkdir -p "$PDIR7"
cat > "$PDIR7/ROADMAP.md" <<'EOF'
---
schema_version: 1
type: roadmap
project: schema-v11-legacy-depends
title: Schema V11 Legacy Depends — Roadmap
status: active
updated: 2026-07-13
source: "test fixture (malformed legacy depends_on)"
milestones:
  - id: m1-first
    title: First Milestone
    status: in-progress
    target: 2026-08
features:
  - id: 001-first-feature
    milestone: m1-first
    title: First Feature
    status: planned
    stage: null
    depends_on: "[a, b]"
    started: null
    finished: null
    spec_path: null
    plan_path: null
next: 001-first-feature
---

# Schema V11 Legacy Depends — Roadmap

> Fixture reproducing niimo's original malformed `depends_on: "[a, b]"` string
> (not a real YAML array) — must still be rejected by `product validate`.

## Milestones

### First Milestone <!-- entry: m1-first -->
Status: in-progress · Target: 2026-08
Goal: fixture milestone.

**Features:**
- [ ] **001-first-feature** — First Feature: fixture feature.

## In-flight features

None.

## Changelog

- **2026-07-13** — Created fixture.
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR7" 2>&1)"
RC=$?
assert_rc "legacy-malformed-depends-on-exit-1" 1 "$RC" "$OUT"
assert_contains "legacy-malformed-depends-on-error-mentions-depends" "$OUT" "depends_on"

# ===========================================================================
# Scenario 8 (SC-004 / FR-002 / audits parity): docs/product/ with a valid
# v1 ROADMAP.md but NO VISION.md and NO audits/ directory -> validate must
# still exit 0 with no vision/audit-related errors (backward-compat
# degrade-to-no-op for v1-only projects).
# ===========================================================================
WORK8="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-novision-noaudits.XXXXXX")"
PDIR8="$WORK8/docs/product"
write_base_roadmap "$PDIR8" "schema-v11-novision-noaudits"

OUT="$(node "$TOOLS" product validate --dir "$PDIR8" 2>&1)"
RC=$?
assert_rc "no-vision-no-audits-exit-0" 0 "$RC" "$OUT"

if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (Array.isArray(data.errors) && data.errors.length > 0) process.exit(1);
'; then
  assert_true "no-vision-no-audits-no-errors" "true"
else
  assert_true "no-vision-no-audits-no-errors" "false"
fi

echo "product-schema-v11 fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
