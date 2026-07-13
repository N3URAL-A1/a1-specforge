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
#
# Wave 2 additions (spec 003, index.json vision/audits blocks + schema.json +
# feature cross-check — FR-014, FR-015, FR-016, FR-018):
#   SC-005: a consumer reading only the regenerated index.json can read
#     vision !== null plus each audit's verdict/counts/open+fixed split
#   FR-016 / SC-004: a v1-only index.json (no VISION.md, no audits/) still
#     validates against index.schema.json's required[]/additionalProperties
#     contract, matching the documented v1 null/[] defaults; a document WITH
#     vision/audits also validates against the same contract
#   FR-018: an audit referencing a nonexistent ROADMAP.md feature id fails
#     `product validate`; an audit referencing an existing feature id passes
#
# Wave 3 additions (spec 003, vision-init/vision-touch CLI writers —
# FR-003, FR-004, FR-019):
#   FR-003: `product vision-init --title ... --pillar ...` in a project with
#     no VISION.md creates it, index.json's vision block becomes non-null,
#     and `product validate` passes; running vision-init again refuses
#     (non-zero exit) and leaves the existing VISION.md byte-unchanged.
#   FR-004: `product vision-touch` on a hand-edited VISION.md bumps
#     `updated` to today and regenerates index.json's vision.updated,
#     while the prose body AND pillars[] stay byte-for-byte unchanged.
#   FR-019: a mid-write fault injected between tmp-write and rename (via the
#     A1_TEST_FAIL_RENAME_AT_INDEX seam in lib/locks.cjs, the same mechanism
#     product-docs/run-tests.sh uses for `product stage`) leaves every
#     affected file in its PRIOR consistent state for both vision-init (no
#     VISION.md created) and vision-touch (VISION.md/index.json/NEXT.md all
#     reverted to their pre-call content).
#
# Wave 4 additions (spec 003, audit-publish/audit-set CLI writers —
# FR-007, FR-008, FR-009, FR-010, FR-011):
#   FR-007: `product audit-publish --analysis <path>` parses a synthetic
#     a1-analyze result's frontmatter findings[] into a new
#     audits/<date>-<focus>.md, every finding at status: open, and
#     index.json's audits[] gains a matching entry.
#   FR-008: re-publishing the SAME date+focus refuses (non-zero exit, no
#     write); publishing a DIFFERENT date+focus succeeds and produces a
#     SECOND file (append-only history, first file untouched).
#   FR-007 edge case: a zero-findings analysis still produces a valid audit
#     file with an empty findings: [] array (not an error).
#   FR-009: `audit-set` mutates EXACTLY the named finding's status/
#     fixed_commit/feature, leaves every other finding byte-unchanged,
#     appends a one-line changelog entry, and index.json's derived
#     open/fixed counts update.
#   FR-010: `audit-set --finding` naming an id absent from the target file
#     fails (non-zero exit, no write).
#   FR-011: `audit-set --feature` naming an id absent from ROADMAP.md fails
#     (non-zero exit, clear error, no write) — reuses the FR-018 cross-check
#     helper (roadmapFeatureIdSet()).
#   edge case: a transition FROM 'fixed' back TO 'open' (regression re-open)
#     is a LEGAL transition, not blocked.
#   FR-019 (Wave 4 twin): the same mid-write fault-injection seam proves
#     audit-publish/audit-set share the identical lock + tmp/rename
#     transaction guarantee as vision-init/vision-touch.
#
# Wave 6c addition (spec 003, a1-fix/a1-execute skill wiring — FR-022):
#   FR-022: the explicit-closing-convention regex documented in
#     skills/a1-fix/workflows/03-fix.md Step 4.5 and
#     skills/a1-execute/workflows/02-execute.md "Audit Auto-Close"
#     (`/\b(closes?|fix(?:es|ed)?)\s+F-(\d{3})\b/i`) matches `Closes F-007` /
#     `Fixes F-007` (case-insensitive keyword) and does NOT match a bare
#     `F-007` mention with no closing keyword immediately before it.
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

# ===========================================================================
# Scenario 9 (SC-005): a consumer reading only the regenerated index.json can
# read vision !== null plus the published audit's verdict/counts/open+fixed
# split — no markdown parsing required. Uses `product changelog` (any
# state-changing product command regenerates index.json via the shared
# regenerateDerived() path Wave 2 extended) to force a fresh regeneration.
# ===========================================================================
WORK9="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-index-vision-audits.XXXXXX")"
PDIR9="$WORK9/docs/product"
write_base_roadmap "$PDIR9" "schema-v11-index-va"
write_valid_vision "$PDIR9" "schema-v11-index-va"
mkdir -p "$PDIR9/audits"
cat > "$PDIR9/audits/2026-07-13-general.md" <<EOF
---
schema_version: 1
type: audit
project: schema-v11-index-va
focus: general
date: 2026-07-13
source: "test analysis fixture"
verdict: "beta-ready, 1 open, 1 fixed"
counts: { blocker: 0, major: 2, minor: 0 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: open
    fixed_commit: null
    feature: null
  - id: F-002
    severity: MAJOR
    category: "stale config"
    status: fixed
    fixed_commit: abc123def
    feature: 001-first-feature
last_validated: 2026-07-13
---

# Audit — general (2026-07-13)
EOF

OUT="$(node "$TOOLS" product changelog --entry "wave2 fixture regen" --why "force index.json regeneration for SC-005 assertions" --dir "$PDIR9" 2>&1)"
RC=$?
assert_rc "index-vision-audits-changelog-regen-exit-0" 0 "$RC" "$OUT"

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (data.vision === null) process.exit(1);
  if (data.vision.path !== "docs/product/VISION.md") process.exit(1);
  if (!Array.isArray(data.vision.pillars) || data.vision.pillars.length === 0) process.exit(1);
  if (!Array.isArray(data.audits) || data.audits.length !== 1) process.exit(1);
  const a = data.audits[0];
  if (a.verdict !== "beta-ready, 1 open, 1 fixed") process.exit(1);
  if (a.counts.blocker !== 0 || a.counts.major !== 2 || a.counts.minor !== 0) process.exit(1);
  if (a.open !== 1 || a.fixed !== 1) process.exit(1);
  if (a.last_validated !== "2026-07-13") process.exit(1);
' "$PDIR9/index.json"; then
  assert_true "sc005-index-json-exposes-vision-and-audit-derived-counts" "true"
else
  assert_true "sc005-index-json-exposes-vision-and-audit-derived-counts" "false"
fi

# ===========================================================================
# Scenario 10 (FR-016 / SC-004): a v1-only index.json (no VISION.md, no
# audits/) still validates against index.schema.json's own required[]/
# additionalProperties contract, matching the documented v1 null/[] defaults;
# a document WITH vision/audits (from Scenario 9 above) also validates
# against the same contract. Uses a small hand-rolled checker (this repo has
# no npm/ajv dependency) that reads index.schema.json's own `required` list
# + $defs, mirroring the checked-in-source-of-truth approach already used by
# _test-fixtures/product-adopt/run-tests.sh (grep for "index.schema.json"
# there).
# ===========================================================================
WORK10="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-v1only-index.XXXXXX")"
PDIR10="$WORK10/docs/product"
write_base_roadmap "$PDIR10" "schema-v11-v1only"

OUT="$(node "$TOOLS" product changelog --entry "wave2 v1-only regen" --why "force index.json regeneration for FR-016/SC-004 assertion" --dir "$PDIR10" 2>&1)"
RC=$?
assert_rc "v1only-changelog-regen-exit-0" 0 "$RC" "$OUT"

check_index_against_schema() {
  local index_file="$1" schema_file="$2"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const schema = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

    for (const k of schema.required) {
      if (!(k in data)) { console.error("missing required key: " + k); process.exit(1); }
    }
    const allowedTop = new Set(Object.keys(schema.properties));
    for (const k of Object.keys(data)) {
      if (!allowedTop.has(k)) { console.error("unexpected top-level key: " + k); process.exit(1); }
    }
    // vision/audits are OPTIONAL — only type-check when present.
    if ("vision" in data && data.vision !== null) {
      const visionDef = schema.$defs.vision;
      for (const k of visionDef.required) {
        if (!(k in data.vision)) { console.error("vision missing required key: " + k); process.exit(1); }
      }
    }
    if ("audits" in data) {
      if (!Array.isArray(data.audits)) { console.error("audits must be an array"); process.exit(1); }
      const auditDef = schema.$defs.audit;
      for (const entry of data.audits) {
        for (const k of auditDef.required) {
          if (!(k in entry)) { console.error("audits[] entry missing required key: " + k); process.exit(1); }
        }
      }
    }
    process.exit(0);
  ' "$index_file" "$schema_file"
}

if check_index_against_schema "$PDIR10/index.json" "$REPO_ROOT/docs/product/index.schema.json"; then
  assert_true "fr016-v1-only-index-json-validates-against-schema" "true"
else
  assert_true "fr016-v1-only-index-json-validates-against-schema" "false"
fi

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(data.vision === null && Array.isArray(data.audits) && data.audits.length === 0 ? 0 : 1);
' "$PDIR10/index.json"; then
  assert_true "sc004-v1-only-index-json-vision-null-audits-empty" "true"
else
  assert_true "sc004-v1-only-index-json-vision-null-audits-empty" "false"
fi

if check_index_against_schema "$PDIR9/index.json" "$REPO_ROOT/docs/product/index.schema.json"; then
  assert_true "fr016-populated-vision-and-audits-index-json-validates-against-schema" "true"
else
  assert_true "fr016-populated-vision-and-audits-index-json-validates-against-schema" "false"
fi

# ===========================================================================
# Scenario 11 (FR-018): an audit whose findings[].feature names a ROADMAP.md
# feature id that does not exist must fail `product validate`; the same
# audit with every findings[].feature id pointing at an existing feature
# must pass.
# ===========================================================================
WORK11="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-feature-crosscheck.XXXXXX")"
PDIR11="$WORK11/docs/product"
write_base_roadmap "$PDIR11" "schema-v11-crosscheck"
mkdir -p "$PDIR11/audits"
cat > "$PDIR11/audits/2026-07-13-general.md" <<EOF
---
schema_version: 1
type: audit
project: schema-v11-crosscheck
focus: general
date: 2026-07-13
source: "test analysis fixture"
verdict: "beta-ready, 1 open finding"
counts: { blocker: 0, major: 1, minor: 0 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: fixed
    fixed_commit: abc123
    feature: 999-does-not-exist
last_validated: 2026-07-13
---

# Audit referencing an unknown feature id — should be rejected (FR-018).
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR11" 2>&1)"
RC=$?
assert_rc "fr018-unknown-feature-id-exit-1" 1 "$RC" "$OUT"
assert_contains "fr018-unknown-feature-id-error-mentions-feature" "$OUT" "feature"
assert_contains "fr018-unknown-feature-id-error-mentions-the-id" "$OUT" "999-does-not-exist"

# Same audit, but pointing at the real feature id from write_base_roadmap
# ("001-first-feature") -> validate must pass.
cat > "$PDIR11/audits/2026-07-13-general.md" <<EOF
---
schema_version: 1
type: audit
project: schema-v11-crosscheck
focus: general
date: 2026-07-13
source: "test analysis fixture"
verdict: "beta-ready, 1 open finding"
counts: { blocker: 0, major: 1, minor: 0 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: fixed
    fixed_commit: abc123
    feature: 001-first-feature
last_validated: 2026-07-13
---

# Audit referencing an existing feature id — should pass (FR-018).
EOF

OUT="$(node "$TOOLS" product validate --dir "$PDIR11" 2>&1)"
RC=$?
assert_rc "fr018-known-feature-id-exit-0" 0 "$RC" "$OUT"

# write_base_roadmap_no_vision_no_audits helper already exists via
# write_base_roadmap (Scenario 8's PDIR8 pattern) — reused below for the
# Wave 3 scenarios by scaffolding a fresh work dir per scenario, same style.

hash_file() {
  if [[ -f "$1" ]]; then
    md5 -q "$1" 2>/dev/null || md5sum "$1" | awk '{print $1}'
  else
    echo "MISSING"
  fi
}

# ===========================================================================
# Scenario 12 (FR-003): `product vision-init` in a project with no VISION.md
# creates it, index.json's vision block becomes non-null, and `product
# validate` passes. Running vision-init again refuses (non-zero exit) and
# leaves the existing VISION.md byte-unchanged.
# ===========================================================================
WORK12="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-vision-init.XXXXXX")"
PDIR12="$WORK12/docs/product"
write_base_roadmap "$PDIR12" "schema-v11-vision-init"

test -f "$PDIR12/VISION.md" && echo "FAIL  vision-init-precondition: VISION.md should not exist yet" && fail=$((fail + 1))

OUT="$(node "$TOOLS" product vision-init --title "Schema V11 Vision Init" --pillar reliability:Reliability:"The product never loses user data." --dir "$PDIR12" 2>&1)"
RC=$?
assert_rc "vision-init-creates-file-exit-0" 0 "$RC" "$OUT"

if [[ -f "$PDIR12/VISION.md" ]]; then
  assert_true "vision-init-file-exists" "true"
else
  assert_true "vision-init-file-exists" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR12" 2>&1)"
RC=$?
assert_rc "vision-init-validate-exit-0" 0 "$RC" "$OUT"

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(data.vision !== null ? 0 : 1);
' "$PDIR12/index.json"; then
  assert_true "vision-init-index-json-vision-non-null" "true"
else
  assert_true "vision-init-index-json-vision-non-null" "false"
fi

# Re-init refuses: non-zero exit, existing file byte-untouched.
VISION_INIT_BEFORE_HASH="$(hash_file "$PDIR12/VISION.md")"
OUT="$(node "$TOOLS" product vision-init --title "Different Title" --pillar other:Other:"Different summary." --dir "$PDIR12" 2>&1)"
RC=$?
assert_rc "vision-init-reinit-refuses-nonzero-exit" 1 "$RC" "$OUT"
VISION_INIT_AFTER_HASH="$(hash_file "$PDIR12/VISION.md")"
if [[ "$VISION_INIT_BEFORE_HASH" == "$VISION_INIT_AFTER_HASH" ]]; then
  assert_true "vision-init-reinit-file-untouched" "true"
else
  assert_true "vision-init-reinit-file-untouched" "false"
fi

# vision-init with zero --pillar flags must also refuse (schema v1.1's
# non-empty pillars[] rule, FR-001) — reject at the CLI boundary rather than
# writing a VISION.md that immediately fails `product validate`.
WORK12B="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-vision-init-nopillar.XXXXXX")"
PDIR12B="$WORK12B/docs/product"
write_base_roadmap "$PDIR12B" "schema-v11-vision-init-nopillar"
OUT="$(node "$TOOLS" product vision-init --title "No Pillars" --dir "$PDIR12B" 2>&1)"
RC=$?
assert_rc "vision-init-zero-pillars-refuses-nonzero-exit" 1 "$RC" "$OUT"
if [[ -f "$PDIR12B/VISION.md" ]]; then
  assert_true "vision-init-zero-pillars-no-file-written" "false"
else
  assert_true "vision-init-zero-pillars-no-file-written" "true"
fi

# ===========================================================================
# Scenario 13 (FR-004): a user hand-edits VISION.md's prose body, then runs
# `product vision-touch` — `updated` is bumped to today, index.json is
# regenerated (vision.updated reflects the bump), and the prose body AND
# pillars[] stay byte-for-byte unchanged.
# ===========================================================================
WORK13="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-vision-touch.XXXXXX")"
PDIR13="$WORK13/docs/product"
write_base_roadmap "$PDIR13" "schema-v11-vision-touch"
mkdir -p "$PDIR13"
cat > "$PDIR13/VISION.md" <<'EOF'
---
schema_version: 1
type: vision
project: schema-v11-vision-touch
title: Schema V11 Vision Touch — Vision
updated: 2020-01-01
pillars:
  - id: reliability
    title: Reliability
    summary: The product never loses user data.
  - id: speed
    title: Speed
    summary: Common workflows complete in under a second.
---

# Schema V11 Vision Touch — Vision

> Hand-edited prose body — must survive `vision-touch` byte-unchanged.

Some additional hand-written narrative text goes here.
EOF

# Capture the prose body (everything after the closing "---" of frontmatter)
# and the pillars[] YAML block specifically, so the assertion is precise
# about WHAT must stay unchanged (FR-004's explicit contract), not just "the
# whole file changed only in one place by luck".
extract_prose_body() {
  # Second "---" onward, skipping the leading blank line the same way
  # parseNestedFrontmatter does.
  awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$1"
}
extract_pillars_block() {
  awk '/^pillars:/{p=1} p{print} /^---$/{if(p) exit}' "$1"
}

VISION_TOUCH_BODY_BEFORE="$(extract_prose_body "$PDIR13/VISION.md" | md5 -q 2>/dev/null || extract_prose_body "$PDIR13/VISION.md" | md5sum | awk '{print $1}')"
VISION_TOUCH_PILLARS_BEFORE="$(extract_pillars_block "$PDIR13/VISION.md" | md5 -q 2>/dev/null || extract_pillars_block "$PDIR13/VISION.md" | md5sum | awk '{print $1}')"

OUT="$(node "$TOOLS" product vision-touch --dir "$PDIR13" 2>&1)"
RC=$?
assert_rc "vision-touch-exit-0" 0 "$RC" "$OUT"

VISION_TOUCH_BODY_AFTER="$(extract_prose_body "$PDIR13/VISION.md" | md5 -q 2>/dev/null || extract_prose_body "$PDIR13/VISION.md" | md5sum | awk '{print $1}')"
VISION_TOUCH_PILLARS_AFTER="$(extract_pillars_block "$PDIR13/VISION.md" | md5 -q 2>/dev/null || extract_pillars_block "$PDIR13/VISION.md" | md5sum | awk '{print $1}')"

if [[ "$VISION_TOUCH_BODY_BEFORE" == "$VISION_TOUCH_BODY_AFTER" ]]; then
  assert_true "vision-touch-prose-body-byte-unchanged" "true"
else
  assert_true "vision-touch-prose-body-byte-unchanged" "false"
fi
if [[ "$VISION_TOUCH_PILLARS_BEFORE" == "$VISION_TOUCH_PILLARS_AFTER" ]]; then
  assert_true "vision-touch-pillars-byte-unchanged" "true"
else
  assert_true "vision-touch-pillars-byte-unchanged" "false"
fi

TODAY="$(date +%Y-%m-%d)"
if grep -q "^updated: ${TODAY}$" "$PDIR13/VISION.md"; then
  assert_true "vision-touch-updated-bumped-to-today" "true"
else
  assert_true "vision-touch-updated-bumped-to-today" "false"
fi

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(data.vision !== null && data.vision.updated === process.argv[2] ? 0 : 1);
' "$PDIR13/index.json" "$TODAY"; then
  assert_true "vision-touch-index-json-vision-updated-bumped" "true"
else
  assert_true "vision-touch-index-json-vision-updated-bumped" "false"
fi

# vision-touch against a project with no VISION.md must refuse, not create one.
WORK13B="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-vision-touch-missing.XXXXXX")"
PDIR13B="$WORK13B/docs/product"
write_base_roadmap "$PDIR13B" "schema-v11-vision-touch-missing"
OUT="$(node "$TOOLS" product vision-touch --dir "$PDIR13B" 2>&1)"
RC=$?
assert_rc "vision-touch-missing-vision-refuses-nonzero-exit" 1 "$RC" "$OUT"
if [[ -f "$PDIR13B/VISION.md" ]]; then
  assert_true "vision-touch-missing-vision-no-file-created" "false"
else
  assert_true "vision-touch-missing-vision-no-file-created" "true"
fi

# ===========================================================================
# Scenario 14 (FR-019): mid-write fault injection — a failure forced between
# tmp-write and rename must leave ALL affected files in their prior
# consistent state. Uses the same A1_TEST_FAIL_RENAME_AT_INDEX seam in
# lib/locks.cjs's writeAllOrNothing() that product-docs/run-tests.sh already
# exercises for `product stage` — this is the transaction guarantee shared
# by every new writer in this feature (vision-init/vision-touch here, the
# Wave 4 audit writers reuse the identical primitive).
# ===========================================================================

# --- 14a: vision-init, fault at index 1 (index.json) — VISION.md (index 0)
# has already been renamed into place on disk when the injected throw fires;
# the rollback must remove it again (it did not pre-exist), leaving
# docs/product/ exactly as it was before the call (no VISION.md at all).
WORK14A="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-vision-init-fault.XXXXXX")"
PDIR14A="$WORK14A/docs/product"
write_base_roadmap "$PDIR14A" "schema-v11-vision-init-fault"

ROADMAP_14A_BEFORE="$(hash_file "$PDIR14A/ROADMAP.md")"
NEXT_14A_BEFORE="$(hash_file "$PDIR14A/NEXT.md")"

OUT="$(A1_TEST_FAIL_RENAME_AT_INDEX=1 node "$TOOLS" product vision-init --title "Fault Vision" --pillar reliability:Reliability:"Never lose data." --dir "$PDIR14A" 2>&1)"
RC=$?
assert_rc "fr019-vision-init-fault-nonzero-exit" 1 "$RC" "$OUT"

if echo "$OUT" | grep -q "A1_TEST_FAIL_RENAME_AT_INDEX injected failure at index 1" && \
   echo "$OUT" | grep -q "all changes rolled back"; then
  assert_true "fr019-vision-init-fault-injected-fault-confirmed" "true"
else
  assert_true "fr019-vision-init-fault-injected-fault-confirmed" "false"
fi

if [[ -f "$PDIR14A/VISION.md" ]]; then
  assert_true "fr019-vision-init-fault-no-partial-vision-file" "false"
else
  assert_true "fr019-vision-init-fault-no-partial-vision-file" "true"
fi

ROADMAP_14A_AFTER="$(hash_file "$PDIR14A/ROADMAP.md")"
NEXT_14A_AFTER="$(hash_file "$PDIR14A/NEXT.md")"
if [[ "$ROADMAP_14A_BEFORE" == "$ROADMAP_14A_AFTER" && "$NEXT_14A_BEFORE" == "$NEXT_14A_AFTER" ]]; then
  assert_true "fr019-vision-init-fault-other-files-unchanged" "true"
else
  assert_true "fr019-vision-init-fault-other-files-unchanged" "false"
fi

# No leftover .tmp files from the aborted write.
if find "$PDIR14A" -name '*.tmp.*' | grep -q .; then
  assert_true "fr019-vision-init-fault-no-leftover-tmp-files" "false"
else
  assert_true "fr019-vision-init-fault-no-leftover-tmp-files" "true"
fi

# --- 14b: vision-touch, fault at index 2 (NEXT.md) — VISION.md (index 0) and
# index.json (index 1) have already been renamed into place when the
# injected throw fires; the rollback must restore BOTH to their exact prior
# content (not just the file that "failed"), proving the all-or-nothing
# guarantee covers every file in the write set, not only the last one.
WORK14B="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-vision-touch-fault.XXXXXX")"
PDIR14B="$WORK14B/docs/product"
write_base_roadmap "$PDIR14B" "schema-v11-vision-touch-fault"
node "$TOOLS" product vision-init --title "Pre-fault Vision" --pillar reliability:Reliability:"Never lose data." --dir "$PDIR14B" >/dev/null 2>&1

VISION_14B_BEFORE="$(hash_file "$PDIR14B/VISION.md")"
INDEX_14B_BEFORE="$(hash_file "$PDIR14B/index.json")"
NEXT_14B_BEFORE="$(hash_file "$PDIR14B/NEXT.md")"

OUT="$(A1_TEST_FAIL_RENAME_AT_INDEX=2 node "$TOOLS" product vision-touch --dir "$PDIR14B" 2>&1)"
RC=$?
assert_rc "fr019-vision-touch-fault-nonzero-exit" 1 "$RC" "$OUT"

if echo "$OUT" | grep -q "A1_TEST_FAIL_RENAME_AT_INDEX injected failure at index 2" && \
   echo "$OUT" | grep -q "all changes rolled back"; then
  assert_true "fr019-vision-touch-fault-injected-fault-confirmed" "true"
else
  assert_true "fr019-vision-touch-fault-injected-fault-confirmed" "false"
fi

VISION_14B_AFTER="$(hash_file "$PDIR14B/VISION.md")"
INDEX_14B_AFTER="$(hash_file "$PDIR14B/index.json")"
NEXT_14B_AFTER="$(hash_file "$PDIR14B/NEXT.md")"

if [[ "$VISION_14B_BEFORE" == "$VISION_14B_AFTER" ]]; then
  assert_true "fr019-vision-touch-fault-vision-md-reverted" "true"
else
  assert_true "fr019-vision-touch-fault-vision-md-reverted" "false"
fi
if [[ "$INDEX_14B_BEFORE" == "$INDEX_14B_AFTER" ]]; then
  assert_true "fr019-vision-touch-fault-index-json-reverted" "true"
else
  assert_true "fr019-vision-touch-fault-index-json-reverted" "false"
fi
if [[ "$NEXT_14B_BEFORE" == "$NEXT_14B_AFTER" ]]; then
  assert_true "fr019-vision-touch-fault-next-md-unchanged" "true"
else
  assert_true "fr019-vision-touch-fault-next-md-unchanged" "false"
fi

if find "$PDIR14B" -name '*.tmp.*' | grep -q .; then
  assert_true "fr019-vision-touch-fault-no-leftover-tmp-files" "false"
else
  assert_true "fr019-vision-touch-fault-no-leftover-tmp-files" "true"
fi

# ===========================================================================
# Wave 4 additions (spec 003, audit-publish/audit-set CLI writers — FR-007,
# FR-008, FR-009, FR-010, FR-011).
#
# write_analysis_fixture <path> <focus> <createdAt> <findingsHeredoc> — a
# minimal, self-contained a1-analyze result file (the SIMPLE frontmatter
# shape lib/io.cjs's parseFrontmatter()/ANALYSIS_KEY_ORDER produces: findings
# is a flat list of quoted "key=value; key=value; ..." strings, NOT the
# nested-object-list shape ROADMAP.md/VISION.md/audits use).
# ===========================================================================
write_analysis_fixture() {
  local path="$1" focus="$2" created_at="$3"
  shift 3
  {
    echo "---"
    echo "type: project-analysis"
    echo "project: schema-v11-audit-publish"
    echo "focus: ${focus}"
    echo "title: \"${focus} analysis of schema-v11-audit-publish\""
    echo "status: reported"
    echo "created_at: ${created_at}"
    echo "findings:"
    for f in "$@"; do
      echo "  - \"${f}\""
    done
    echo "findings_count:"
    echo "  - \"blocker=0\""
    echo "tags:"
    echo "  - analysis"
    echo "---"
    echo ""
    echo "# Analysis"
  } > "$path"
}

# ===========================================================================
# Scenario 15 (FR-007): `product audit-publish --analysis <path>` creates
# exactly one new audits/<date>-<focus>.md with every finding at status:
# open, and index.json's audits[] gains a matching entry.
# ===========================================================================
WORK15="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-audit-publish.XXXXXX")"
PDIR15="$WORK15/docs/product"
write_base_roadmap "$PDIR15" "schema-v11-audit-publish"
write_analysis_fixture "$WORK15/analysis-general.md" "general" "2026-07-13T09:00:00.000Z" \
  "id=F-001; severity=MAJOR; category=ADR drift; location=foo.js:10; description=some description; with a semicolon; recommendation=fix it" \
  "id=F-002; severity=MINOR; category=stale help; location=bar.js:5; description=another one; recommendation=fix it too"

test -f "$PDIR15/audits/2026-07-13-general.md" && echo "FAIL  audit-publish-precondition: audit file should not exist yet" && fail=$((fail + 1))

OUT="$(node "$TOOLS" product audit-publish --analysis "$WORK15/analysis-general.md" --dir "$PDIR15" 2>&1)"
RC=$?
assert_rc "fr007-audit-publish-exit-0" 0 "$RC" "$OUT"

if [[ -f "$PDIR15/audits/2026-07-13-general.md" ]]; then
  assert_true "fr007-audit-publish-file-created" "true"
else
  assert_true "fr007-audit-publish-file-created" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR15" 2>&1)"
RC=$?
assert_rc "fr007-audit-publish-validate-exit-0" 0 "$RC" "$OUT"

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(fm.findings) || fm.findings.length !== 2) process.exit(1);
  if (!fm.findings.every((f) => f.status === "open" && f.fixed_commit === null && f.feature === null)) process.exit(1);
  if (fm.findings[0].id !== "F-001" || fm.findings[1].id !== "F-002") process.exit(1);
  process.exit(0);
' "$PDIR15/audits/2026-07-13-general.md" "$REPO_ROOT/_shared/lib/io.cjs"; then
  assert_true "fr007-audit-publish-all-findings-open" "true"
else
  assert_true "fr007-audit-publish-all-findings-open" "false"
fi

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(data.audits) || data.audits.length !== 1) process.exit(1);
  const a = data.audits[0];
  if (a.path !== "docs/product/audits/2026-07-13-general.md") process.exit(1);
  if (a.open !== 2 || a.fixed !== 0) process.exit(1);
  process.exit(0);
' "$PDIR15/index.json"; then
  assert_true "fr007-audit-publish-index-json-audits-entry" "true"
else
  assert_true "fr007-audit-publish-index-json-audits-entry" "false"
fi

# ===========================================================================
# Scenario 16 (FR-008): re-publishing the SAME date+focus refuses (non-zero
# exit) and leaves the original file untouched; publishing a DIFFERENT
# date+focus succeeds and produces a SECOND file (append-only history).
# ===========================================================================
AUDIT15_BEFORE_HASH="$(hash_file "$PDIR15/audits/2026-07-13-general.md")"
OUT="$(node "$TOOLS" product audit-publish --analysis "$WORK15/analysis-general.md" --dir "$PDIR15" 2>&1)"
RC=$?
assert_rc "fr008-audit-publish-duplicate-refuses-nonzero-exit" 1 "$RC" "$OUT"
AUDIT15_AFTER_HASH="$(hash_file "$PDIR15/audits/2026-07-13-general.md")"
if [[ "$AUDIT15_BEFORE_HASH" == "$AUDIT15_AFTER_HASH" ]]; then
  assert_true "fr008-audit-publish-duplicate-original-untouched" "true"
else
  assert_true "fr008-audit-publish-duplicate-original-untouched" "false"
fi

write_analysis_fixture "$WORK15/analysis-security.md" "security" "2026-07-14T09:00:00.000Z" \
  "id=F-003; severity=BLOCKER; category=secrets in repo; location=config.js:1; description=hardcoded key; recommendation=use env var"
OUT="$(node "$TOOLS" product audit-publish --analysis "$WORK15/analysis-security.md" --dir "$PDIR15" 2>&1)"
RC=$?
assert_rc "fr007-audit-publish-second-different-focus-exit-0" 0 "$RC" "$OUT"

if [[ -f "$PDIR15/audits/2026-07-14-security.md" ]]; then
  assert_true "fr007-audit-publish-second-file-created" "true"
else
  assert_true "fr007-audit-publish-second-file-created" "false"
fi
AUDIT15_STILL_HASH="$(hash_file "$PDIR15/audits/2026-07-13-general.md")"
if [[ "$AUDIT15_BEFORE_HASH" == "$AUDIT15_STILL_HASH" ]]; then
  assert_true "fr007-audit-publish-append-only-first-file-untouched" "true"
else
  assert_true "fr007-audit-publish-append-only-first-file-untouched" "false"
fi

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(Array.isArray(data.audits) && data.audits.length === 2 ? 0 : 1);
' "$PDIR15/index.json"; then
  assert_true "fr007-audit-publish-index-json-two-entries" "true"
else
  assert_true "fr007-audit-publish-index-json-two-entries" "false"
fi

# ===========================================================================
# Scenario 17 (FR-007 edge case): a zero-findings analysis still produces a
# valid audit file with an empty findings: [] array (not an error).
# ===========================================================================
WORK17="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-audit-publish-zero.XXXXXX")"
PDIR17="$WORK17/docs/product"
write_base_roadmap "$PDIR17" "schema-v11-audit-publish-zero"
cat > "$WORK17/analysis-zero.md" <<'EOF'
---
type: project-analysis
project: schema-v11-audit-publish-zero
focus: quality
title: "quality analysis of schema-v11-audit-publish-zero"
status: reported
created_at: 2026-07-13T09:00:00.000Z
findings: []
findings_count:
  - "blocker=0"
tags:
  - analysis
---

# Analysis
EOF

OUT="$(node "$TOOLS" product audit-publish --analysis "$WORK17/analysis-zero.md" --dir "$PDIR17" 2>&1)"
RC=$?
assert_rc "fr007-audit-publish-zero-findings-exit-0" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product validate --dir "$PDIR17" 2>&1)"
RC=$?
assert_rc "fr007-audit-publish-zero-findings-validate-exit-0" 0 "$RC" "$OUT"

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  process.exit(Array.isArray(fm.findings) && fm.findings.length === 0 ? 0 : 1);
' "$PDIR17/audits/2026-07-13-quality.md" "$REPO_ROOT/_shared/lib/io.cjs"; then
  assert_true "fr007-audit-publish-zero-findings-empty-array" "true"
else
  assert_true "fr007-audit-publish-zero-findings-empty-array" "false"
fi

# ===========================================================================
# Scenario 18 (FR-009): `audit-set` mutates EXACTLY the named finding's
# status/fixed_commit/feature, appends a changelog line, leaves other
# findings byte-unchanged, and index.json's derived open/fixed counts update.
# ===========================================================================
WORK18="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-audit-set.XXXXXX")"
PDIR18="$WORK18/docs/product"
write_base_roadmap "$PDIR18" "schema-v11-audit-set"
write_analysis_fixture "$WORK18/analysis.md" "general" "2026-07-13T09:00:00.000Z" \
  "id=F-001; severity=MAJOR; category=first finding; location=a.js:1; description=d1; recommendation=r1" \
  "id=F-002; severity=MINOR; category=second finding; location=b.js:2; description=d2; recommendation=r2"
node "$TOOLS" product audit-publish --analysis "$WORK18/analysis.md" --dir "$PDIR18" >/dev/null 2>&1

AUDIT18="$PDIR18/audits/2026-07-13-general.md"

extract_finding_block() {
  # Print only the F-002 finding's 6-line block, so we can assert it is
  # byte-unchanged after audit-set touches F-001 only.
  awk '/^  - id: F-002/{p=1} p{print; if(/^    feature:/) exit}' "$1"
}
FINDING_F002_BEFORE="$(extract_finding_block "$AUDIT18" | md5 -q 2>/dev/null || extract_finding_block "$AUDIT18" | md5sum | awk '{print $1}')"

OUT="$(node "$TOOLS" product audit-set --audit "$AUDIT18" --finding F-001 --status fixed --commit deadbeef1 --feature 001-first-feature --dir "$PDIR18" 2>&1)"
RC=$?
assert_rc "fr009-audit-set-exit-0" 0 "$RC" "$OUT"

FINDING_F002_AFTER="$(extract_finding_block "$AUDIT18" | md5 -q 2>/dev/null || extract_finding_block "$AUDIT18" | md5sum | awk '{print $1}')"
if [[ "$FINDING_F002_BEFORE" == "$FINDING_F002_AFTER" ]]; then
  assert_true "fr009-audit-set-other-finding-byte-unchanged" "true"
else
  assert_true "fr009-audit-set-other-finding-byte-unchanged" "false"
fi

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  const f1 = fm.findings.find((f) => f.id === "F-001");
  if (!f1 || f1.status !== "fixed" || f1.fixed_commit !== "deadbeef1" || f1.feature !== "001-first-feature") process.exit(1);
  const f2 = fm.findings.find((f) => f.id === "F-002");
  if (!f2 || f2.status !== "open" || f2.fixed_commit !== null || f2.feature !== null) process.exit(1);
  process.exit(0);
' "$AUDIT18" "$REPO_ROOT/_shared/lib/io.cjs"; then
  assert_true "fr009-audit-set-only-target-finding-mutated" "true"
else
  assert_true "fr009-audit-set-only-target-finding-mutated" "false"
fi

if grep -q "F-001 fixed" "$AUDIT18" && grep -q "deadbeef1" "$AUDIT18"; then
  assert_true "fr009-audit-set-changelog-line-appended" "true"
else
  assert_true "fr009-audit-set-changelog-line-appended" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR18" 2>&1)"
RC=$?
assert_rc "fr009-audit-set-validate-exit-0" 0 "$RC" "$OUT"

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const a = data.audits.find((x) => x.path === "docs/product/audits/2026-07-13-general.md");
  process.exit(a && a.open === 1 && a.fixed === 1 ? 0 : 1);
' "$PDIR18/index.json"; then
  assert_true "fr009-audit-set-index-json-counts-updated" "true"
else
  assert_true "fr009-audit-set-index-json-counts-updated" "false"
fi

# ===========================================================================
# Scenario 19 (FR-010): `audit-set --finding` naming an id absent from the
# target file fails (non-zero exit) and modifies nothing.
# ===========================================================================
AUDIT18_BEFORE_UNKNOWN_FINDING_HASH="$(hash_file "$AUDIT18")"
OUT="$(node "$TOOLS" product audit-set --audit "$AUDIT18" --finding F-999 --status fixed --dir "$PDIR18" 2>&1)"
RC=$?
assert_rc "fr010-audit-set-unknown-finding-nonzero-exit" 1 "$RC" "$OUT"
assert_contains "fr010-audit-set-unknown-finding-error-mentions-finding" "$OUT" "F-999"
AUDIT18_AFTER_UNKNOWN_FINDING_HASH="$(hash_file "$AUDIT18")"
if [[ "$AUDIT18_BEFORE_UNKNOWN_FINDING_HASH" == "$AUDIT18_AFTER_UNKNOWN_FINDING_HASH" ]]; then
  assert_true "fr010-audit-set-unknown-finding-no-write" "true"
else
  assert_true "fr010-audit-set-unknown-finding-no-write" "false"
fi

# ===========================================================================
# Scenario 20 (FR-011): `audit-set --feature` naming an id absent from
# ROADMAP.md fails (non-zero exit, clear error) and modifies nothing.
# ===========================================================================
AUDIT18_BEFORE_UNKNOWN_FEATURE_HASH="$(hash_file "$AUDIT18")"
OUT="$(node "$TOOLS" product audit-set --audit "$AUDIT18" --finding F-002 --status fixed --feature 999-does-not-exist --dir "$PDIR18" 2>&1)"
RC=$?
assert_rc "fr011-audit-set-unknown-feature-nonzero-exit" 1 "$RC" "$OUT"
assert_contains "fr011-audit-set-unknown-feature-error-mentions-feature-id" "$OUT" "999-does-not-exist"
AUDIT18_AFTER_UNKNOWN_FEATURE_HASH="$(hash_file "$AUDIT18")"
if [[ "$AUDIT18_BEFORE_UNKNOWN_FEATURE_HASH" == "$AUDIT18_AFTER_UNKNOWN_FEATURE_HASH" ]]; then
  assert_true "fr011-audit-set-unknown-feature-no-write" "true"
else
  assert_true "fr011-audit-set-unknown-feature-no-write" "false"
fi

# ===========================================================================
# Scenario 21 (edge case): a transition FROM 'fixed' back TO 'open'
# (regression re-open) must be a LEGAL transition, not blocked.
# ===========================================================================
OUT="$(node "$TOOLS" product audit-set --audit "$AUDIT18" --finding F-001 --status open --dir "$PDIR18" 2>&1)"
RC=$?
assert_rc "edge-audit-set-fixed-to-open-regression-allowed-exit-0" 0 "$RC" "$OUT"

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  const f1 = fm.findings.find((f) => f.id === "F-001");
  process.exit(f1 && f1.status === "open" ? 0 : 1);
' "$AUDIT18" "$REPO_ROOT/_shared/lib/io.cjs"; then
  assert_true "edge-audit-set-fixed-to-open-status-updated" "true"
else
  assert_true "edge-audit-set-fixed-to-open-status-updated" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR18" 2>&1)"
RC=$?
assert_rc "edge-audit-set-fixed-to-open-validate-exit-0" 0 "$RC" "$OUT"

# ===========================================================================
# Scenario 22 (FR-019, Wave 4 twin of Wave 3's mid-write fault injection):
# audit-publish/audit-set reuse the SAME lock + tmp/rename transaction — a
# fault forced between tmp-write and rename must leave all affected files in
# their prior consistent state for both writers.
# ===========================================================================
WORK22="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-schema-v11-audit-fault.XXXXXX")"
PDIR22="$WORK22/docs/product"
write_base_roadmap "$PDIR22" "schema-v11-audit-fault"
write_analysis_fixture "$WORK22/analysis.md" "general" "2026-07-13T09:00:00.000Z" \
  "id=F-001; severity=MAJOR; category=x; location=x; description=d; recommendation=r"

OUT="$(A1_TEST_FAIL_RENAME_AT_INDEX=0 node "$TOOLS" product audit-publish --analysis "$WORK22/analysis.md" --dir "$PDIR22" 2>&1)"
RC=$?
assert_rc "fr019-audit-publish-fault-nonzero-exit" 1 "$RC" "$OUT"
if [[ -f "$PDIR22/audits/2026-07-13-general.md" ]]; then
  assert_true "fr019-audit-publish-fault-no-partial-file" "false"
else
  assert_true "fr019-audit-publish-fault-no-partial-file" "true"
fi
if find "$PDIR22" -name '*.tmp.*' | grep -q .; then
  assert_true "fr019-audit-publish-fault-no-leftover-tmp-files" "false"
else
  assert_true "fr019-audit-publish-fault-no-leftover-tmp-files" "true"
fi

node "$TOOLS" product audit-publish --analysis "$WORK22/analysis.md" --dir "$PDIR22" >/dev/null 2>&1
AUDIT22="$PDIR22/audits/2026-07-13-general.md"
AUDIT22_BEFORE_HASH="$(hash_file "$AUDIT22")"
INDEX22_BEFORE_HASH="$(hash_file "$PDIR22/index.json")"

OUT="$(A1_TEST_FAIL_RENAME_AT_INDEX=1 node "$TOOLS" product audit-set --audit "$AUDIT22" --finding F-001 --status fixed --commit deadbeef2 --dir "$PDIR22" 2>&1)"
RC=$?
assert_rc "fr019-audit-set-fault-nonzero-exit" 1 "$RC" "$OUT"

AUDIT22_AFTER_HASH="$(hash_file "$AUDIT22")"
INDEX22_AFTER_HASH="$(hash_file "$PDIR22/index.json")"
if [[ "$AUDIT22_BEFORE_HASH" == "$AUDIT22_AFTER_HASH" ]]; then
  assert_true "fr019-audit-set-fault-audit-file-reverted" "true"
else
  assert_true "fr019-audit-set-fault-audit-file-reverted" "false"
fi
if [[ "$INDEX22_BEFORE_HASH" == "$INDEX22_AFTER_HASH" ]]; then
  assert_true "fr019-audit-set-fault-index-json-reverted" "true"
else
  assert_true "fr019-audit-set-fault-index-json-reverted" "false"
fi
if find "$PDIR22" -name '*.tmp.*' | grep -q .; then
  assert_true "fr019-audit-set-fault-no-leftover-tmp-files" "false"
else
  assert_true "fr019-audit-set-fault-no-leftover-tmp-files" "true"
fi

# ===========================================================================
# Scenario 23 (FR-022, Wave 6c): the explicit-closing-convention regex used by
# a1-fix (skills/a1-fix/workflows/03-fix.md Step 4.5) and a1-execute
# (skills/a1-execute/workflows/02-execute.md "Audit Auto-Close") to decide
# whether to auto-call `product audit-set` matches "Closes F-0NN"/"Fixes
# F-0NN" (case-insensitive keyword) but NOT a bare "F-0NN" mention with no
# closing keyword immediately before it. This is a pure regex assertion —
# no CLI invocation involved, since FR-022 is skill-prose wiring, not a new
# CLI subcommand.
# ===========================================================================
FR022_REGEX_CHECK="$(node -e '
  const RE = /\b(closes?|fix(?:es|ed)?)\s+F-(\d{3})\b/i;
  const cases = [
    { msg: "Closes F-007", expectMatch: true, expectId: "007" },
    { msg: "fix(auth): resolve token bug\n\nFixes F-012", expectMatch: true, expectId: "012" },
    { msg: "close F-042 - session leak", expectMatch: true, expectId: "042" },
    { msg: "FIXED F-099", expectMatch: true, expectId: "099" },
    { msg: "mentions F-007 in passing, no keyword", expectMatch: false },
    { msg: "See F-007 for context; unrelated commit", expectMatch: false },
    { msg: "prefixes F-007 (not a whole-word keyword match)", expectMatch: false },
  ];
  let ok = true;
  for (const c of cases) {
    const m = c.msg.match(RE);
    const matched = m !== null;
    if (matched !== c.expectMatch) {
      console.error(`MISMATCH for "${c.msg}": expected match=${c.expectMatch}, got ${matched}`);
      ok = false;
      continue;
    }
    if (c.expectMatch && m[2] !== c.expectId) {
      console.error(`MISMATCH for "${c.msg}": expected id=${c.expectId}, got ${m[2]}`);
      ok = false;
    }
  }
  process.exit(ok ? 0 : 1);
' 2>&1)"
FR022_REGEX_RC=$?
assert_rc "fr022-closing-convention-regex-cases" 0 "$FR022_REGEX_RC" "$FR022_REGEX_CHECK"

echo "product-schema-v11 fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
