#!/usr/bin/env bash
# Scenario suite for `product audit-mirror` (Wave 5 of spec
# 003-product-schema-v1.1-vision-audits, FR-012/FR-013, SC-001/SC-003/SC-006).
# Mirrors the mktemp/assert_rc/assert_true harness style established by
# `_test-fixtures/product-schema-v11/run.sh` (Waves 1-4) and
# `_test-fixtures/product-adopt/run-tests.sh` (read-only external-fixture
# discipline).
#
# Fixture strategy for the niimo reproduction (documented per task
# instructions): the real niimo repo and its Vault analysis file
# (`~/N3URAL-Vault/projects/niimo/analyses/2026-07-05-general.md`) are NEVER
# read or written by this script. A trimmed, self-contained VENDORED copy of
# the 31 findings' `id`/`severity`/`category` fields (the only three fields
# `readAnalysisForPublish` consumes) lives at
# `fixtures/niimo-2026-07-05-general.md`, checked into this repo — chosen
# over reading the external Vault path directly because (a) a clean CI
# checkout has no `~/N3URAL-Vault` at all, making a direct read a guaranteed
# CI failure, and (b) the Vault file's `location`/`description`/
# `recommendation` fields are irrelevant to audit-mirror's mechanics (id,
# severity, category, fixed_commit are all that matter), so vendoring the
# three consumed fields verbatim is sufficient for a faithful reproduction
# without carrying an entire unrelated document into version control.
#
# IMPORTANT — a genuine mismatch between the mechanical FR-012 rule and the
# real niimo commit 0e2d3a6 migration (documented here, not silently papered
# over per the task's explicit instruction):
#   - FR-012's title rule is `F-0NN: <category>` and its id-slug rule derives
#     the slug from `<category>` (e.g. F-001/"ADR drift" -> `f001-adr-drift`).
#     niimo's HAND-WRITTEN migration used bespoke, more specific titles/slugs
#     (e.g. `023-f001-adr-backfill`, title "F-001: Backfill phantom ADRs
#     (allergen engine, CF proxy, ...)") that a human wrote after reading each
#     finding's full recommendation — not mechanically derivable from
#     `category` alone (a1-analyze's frontmatter has no "short slug" field).
#   - niimo's migration also split the 31 mirrored features across FOUR
#     different milestones (quality-audit / tech-debt / compliance-legal /
#     store-launch) by hand-judgment per finding; `audit-mirror` takes exactly
#     ONE `--milestone` per invocation (FR-012 has no per-finding milestone
#     routing — that would be scope invented beyond the spec).
#   Given this, "zero diff" is verified for what the CLI's mechanical rule
#   CAN reproduce byte-for-byte: the finding-number embedded in each mirrored
#   id, the total mirrored count (31), the fixed/open split (18/13) and its
#   derived status (done/planned) + started/finished dates, and idempotency
#   on re-run. It is NOT verified for the free-text slug/title wording or the
#   multi-milestone split, since the spec's own mechanical rule (one
#   `--milestone` flag, title = `F-0NN: <category>`) cannot produce those
#   hand-authored strings — reproducing them exactly would require inventing
#   an unspec'd per-finding milestone/title override flag, out of scope for
#   this wave. See the final wave report for the full analysis.
#
# Scenarios:
#   SC-001/SC-003 (niimo reproduction): publish the vendored 31-finding
#     analysis, audit-set the 18 historically-fixed findings with their real
#     commit shas (from niimo commits 4730838..a7b065c), audit-mirror --all
#     (niimo's pre-clarification precedent mirrored ALL findings, not just
#     open ones) into a single milestone, and assert: 31 features mirrored,
#     18 status=done with started=finished=the audit's last_validated date,
#     13 status=planned with started=finished=null, every mirrored id
#     contains the right finding number, `product validate` passes.
#   SC-006/FR-013 (idempotency): re-running the identical audit-mirror
#     command a second time mirrors ZERO new features and reports all 31 as
#     skipped; the ROADMAP.md feature count is unchanged.
#   FR-012 (unknown milestone): `--milestone does-not-exist` hard-fails
#     (non-zero exit) with ZERO features written.
#   FR-012 (default scope = open-only): on a small synthetic 4-finding audit
#     (2 open, 2 fixed) with NEITHER `--only`/`--all`, only the 2 open
#     findings are mirrored.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
IO_CJS="$REPO_ROOT/_shared/lib/io.cjs"
VENDORED_ANALYSIS="$DIR/fixtures/niimo-2026-07-05-general.md"

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

# write_niimo_roadmap <productDir> — a v1 ROADMAP.md with the same milestone
# set niimo commit 0e2d3a6 used (id/title/status/target only — the full
# feature-023-053 list is what THIS test is proving audit-mirror can
# reproduce, so it deliberately starts empty of mirrored features).
write_niimo_roadmap() {
  local pdir="$1"
  mkdir -p "$pdir"
  cat > "$pdir/ROADMAP.md" <<'EOF'
---
schema_version: 1
type: roadmap
project: niimo
title: "niimo — Roadmap"
status: active
updated: 2026-07-13
source: "test fixture (Wave 5 niimo reproduction)"
milestones:
  - id: quality-audit
    title: "Full Audit + Fixes"
    status: done
    target: 2026-07
  - id: tech-debt
    title: "Tech Debt & Hygiene"
    status: planned
    target: 2026-09
  - id: compliance-legal
    title: "Compliance & Legal"
    status: in-progress
    target: 2026-08
  - id: store-launch
    title: "Store Launch Preparation"
    status: planned
    target: 2026-09
features: []
next: null
---

# niimo — Roadmap

> Fixture roadmap for the Wave 5 audit-mirror niimo reproduction test.

## Changelog

- **2026-07-13** — Created fixture.
EOF
}

# ===========================================================================
# Scenario 1 (SC-001/SC-003): audit-publish + audit-set (18 fixed) +
# audit-mirror --all against the vendored niimo analysis.
# ===========================================================================
WORK1="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-audit-mirror-niimo.XXXXXX")"
PDIR1="$WORK1/docs/product"
write_niimo_roadmap "$PDIR1"

OUT="$(node "$TOOLS" product audit-publish --analysis "$VENDORED_ANALYSIS" --dir "$PDIR1" 2>&1)"
RC=$?
assert_rc "sc001-audit-publish-exit-0" 0 "$RC" "$OUT"

AUDIT1="$PDIR1/audits/2026-07-05-general.md"
if [[ -f "$AUDIT1" ]]; then
  assert_true "sc001-audit-file-created" "true"
else
  assert_true "sc001-audit-file-created" "false"
fi

# 18 findings historically fixed on 2026-07-05, with their real commit shas
# (niimo commits 4730838..a7b065c) — see niimo ROADMAP.md@0e2d3a6's own
# per-feature commit annotations for this mapping.
FIXED_FINDINGS=(
  "F-005:0046dd2" "F-006:0046dd2" "F-007:0046dd2" "F-008:0046dd2"
  "F-009:0046dd2" "F-010:0046dd2"
  "F-012:4a69aa4" "F-013:4a69aa4"
  "F-014:d870b5a"
  "F-015:a7b065c"
  "F-018:524160c"
  "F-019:8b036a0"
  "F-020:938d60d"
  "F-021:737dd35" "F-022:737dd35" "F-024:737dd35" "F-025:737dd35"
  "F-031:4730838"
)
assert_true "sc001-fixed-findings-count-is-18" "$([[ ${#FIXED_FINDINGS[@]} -eq 18 ]] && echo true || echo false)"

set_failures=0
for entry in "${FIXED_FINDINGS[@]}"; do
  finding="${entry%%:*}"
  commit="${entry##*:}"
  OUT="$(node "$TOOLS" product audit-set --audit "$AUDIT1" --finding "$finding" --status fixed --commit "$commit" --dir "$PDIR1" 2>&1)"
  RC=$?
  if [[ "$RC" -ne 0 ]]; then
    set_failures=$((set_failures + 1))
    echo "audit-set failed for $finding: $OUT"
  fi
done
assert_true "sc001-all-18-audit-set-calls-succeeded" "$([[ $set_failures -eq 0 ]] && echo true || echo false)"

# --all: niimo's pre-clarification precedent mirrored ALL 31 findings, not
# just the open ones — this reproduction explicitly opts into --all to match
# that historical state (this feature's NEW default is open-only, exercised
# separately in Scenario 4 below).
OUT="$(node "$TOOLS" product audit-mirror --audit "$AUDIT1" --milestone tech-debt --all --dir "$PDIR1" 2>&1)"
RC=$?
assert_rc "sc001-audit-mirror-all-exit-0" 0 "$RC" "$OUT"

MIRROR_JSON="$OUT"

if node -e '
  const out = JSON.parse(process.argv[1]);
  process.exit(Array.isArray(out.mirrored) && out.mirrored.length === 31 ? 0 : 1);
' "$MIRROR_JSON"; then
  assert_true "sc001-31-findings-mirrored" "true"
else
  assert_true "sc001-31-findings-mirrored" "false"
fi

OUT="$(node "$TOOLS" product validate --dir "$PDIR1" 2>&1)"
RC=$?
assert_rc "sc003-validate-passes-after-mirror" 0 "$RC" "$OUT"

# Structural zero-diff checks (see the mismatch note at the top of this file
# for what is NOT mechanically reproducible — free-text title/slug wording
# and the multi-milestone split):
#   - exactly 31 mirrored features, one per finding
#   - every mirrored id embeds the correct zero-padded finding number
#     (f001..f031)
#   - exactly 18 have status 'done' with started===finished===the audit's
#     last_validated date (2026-07-05) — matching niimo's real
#     started/finished=2026-07-05 for all 18 fixed features
#   - exactly 13 have status 'planned' with started===finished===null
if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  const mirrored = fm.features.filter((f) => /^\d{3}-f\d{3}-/.test(f.id));
  if (mirrored.length !== 31) { console.error("expected 31 mirrored features, got", mirrored.length); process.exit(1); }

  const fixedIds = new Set(["F-005","F-006","F-007","F-008","F-009","F-010","F-012","F-013","F-014","F-015","F-018","F-019","F-020","F-021","F-022","F-024","F-025","F-031"]);
  let doneCount = 0, plannedCount = 0;
  for (const f of mirrored) {
    const m = /^\d{3}-f(\d{3})-/.exec(f.id);
    const findingId = "F-" + m[1];
    const shouldBeFixed = fixedIds.has(findingId);
    if (shouldBeFixed) {
      if (f.status !== "done") { console.error(findingId, "expected done, got", f.status); process.exit(1); }
      if (f.started !== "2026-07-05" || f.finished !== "2026-07-05") { console.error(findingId, "expected started/finished 2026-07-05, got", f.started, f.finished); process.exit(1); }
      doneCount++;
    } else {
      if (f.status !== "planned") { console.error(findingId, "expected planned, got", f.status); process.exit(1); }
      if (f.started !== null || f.finished !== null) { console.error(findingId, "expected null started/finished, got", f.started, f.finished); process.exit(1); }
      plannedCount++;
    }
  }
  if (doneCount !== 18) { console.error("expected 18 done, got", doneCount); process.exit(1); }
  if (plannedCount !== 13) { console.error("expected 13 planned, got", plannedCount); process.exit(1); }
  process.exit(0);
' "$PDIR1/ROADMAP.md" "$IO_CJS"; then
  assert_true "sc001-zero-diff-status-dates-18-done-13-planned" "true"
else
  assert_true "sc001-zero-diff-status-dates-18-done-13-planned" "false"
fi

FEATURE_COUNT_AFTER_RUN1=31

# ===========================================================================
# Scenario 2 (SC-006/FR-013): re-running audit-mirror with the SAME args a
# second time is a no-op — zero new features, all 31 reported skipped.
# ===========================================================================
OUT="$(node "$TOOLS" product audit-mirror --audit "$AUDIT1" --milestone tech-debt --all --dir "$PDIR1" 2>&1)"
RC=$?
assert_rc "sc006-audit-mirror-rerun-exit-0" 0 "$RC" "$OUT"

if node -e '
  const out = JSON.parse(process.argv[1]);
  process.exit(Array.isArray(out.mirrored) && out.mirrored.length === 0 && Array.isArray(out.skipped) && out.skipped.length === 31 ? 0 : 1);
' "$OUT"; then
  assert_true "sc006-rerun-zero-new-31-skipped" "true"
else
  assert_true "sc006-rerun-zero-new-31-skipped" "false"
fi

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  const mirrored = fm.features.filter((f) => /^\d{3}-f\d{3}-/.test(f.id));
  process.exit(mirrored.length === 31 ? 0 : 1);
' "$PDIR1/ROADMAP.md" "$IO_CJS"; then
  assert_true "sc006-feature-count-unchanged-after-rerun" "true"
else
  assert_true "sc006-feature-count-unchanged-after-rerun" "false"
fi

# No duplicate ids anywhere in features[].
if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  const ids = fm.features.map((f) => f.id);
  process.exit(new Set(ids).size === ids.length ? 0 : 1);
' "$PDIR1/ROADMAP.md" "$IO_CJS"; then
  assert_true "sc006-no-duplicate-feature-ids" "true"
else
  assert_true "sc006-no-duplicate-feature-ids" "false"
fi

# ===========================================================================
# Scenario 3 (FR-012 edge case): unknown --milestone hard-fails BEFORE any
# feature is written.
# ===========================================================================
WORK3="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-audit-mirror-badmilestone.XXXXXX")"
PDIR3="$WORK3/docs/product"
write_niimo_roadmap "$PDIR3"
node "$TOOLS" product audit-publish --analysis "$VENDORED_ANALYSIS" --dir "$PDIR3" >/dev/null 2>&1
AUDIT3="$PDIR3/audits/2026-07-05-general.md"

OUT="$(node "$TOOLS" product audit-mirror --audit "$AUDIT3" --milestone does-not-exist --all --dir "$PDIR3" 2>&1)"
RC=$?
assert_rc "fr012-unknown-milestone-exit-1" 1 "$RC" "$OUT"

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  process.exit(fm.features.length === 0 ? 0 : 1);
' "$PDIR3/ROADMAP.md" "$IO_CJS"; then
  assert_true "fr012-unknown-milestone-zero-features-written" "true"
else
  assert_true "fr012-unknown-milestone-zero-features-written" "false"
fi

# ===========================================================================
# Scenario 4 (FR-012 default scope): with NEITHER --only nor --all, only
# OPEN findings are mirrored, on a small synthetic 4-finding audit (2 open,
# 2 fixed).
# ===========================================================================
WORK4="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-audit-mirror-defaultscope.XXXXXX")"
PDIR4="$WORK4/docs/product"
mkdir -p "$PDIR4/audits"
cat > "$PDIR4/ROADMAP.md" <<'EOF'
---
schema_version: 1
type: roadmap
project: default-scope-fixture
title: default-scope-fixture — Roadmap
status: active
updated: 2026-07-13
source: "test fixture"
milestones:
  - id: tech-debt
    title: Tech Debt
    status: planned
    target: 2026-09
features: []
next: null
---

# default-scope-fixture — Roadmap

## Changelog

- **2026-07-13** — Created fixture.
EOF

cat > "$PDIR4/audits/2026-07-13-mixed.md" <<'EOF'
---
schema_version: 1
type: audit
project: default-scope-fixture
focus: mixed
date: 2026-07-13
source: "test analysis fixture"
verdict: "2 open, 2 fixed"
counts: { blocker: 0, major: 4, minor: 0 }
findings:
  - id: F-101
    severity: MAJOR
    category: "open one"
    status: open
    fixed_commit: null
    feature: null
  - id: F-102
    severity: MAJOR
    category: "fixed one"
    status: fixed
    fixed_commit: "aaa111"
    feature: null
  - id: F-103
    severity: MAJOR
    category: "open two"
    status: open
    fixed_commit: null
    feature: null
  - id: F-104
    severity: MAJOR
    category: "fixed two"
    status: fixed
    fixed_commit: "bbb222"
    feature: null
last_validated: 2026-07-13
---

# Audit — mixed (2026-07-13)
EOF

OUT="$(node "$TOOLS" product audit-mirror --audit "$PDIR4/audits/2026-07-13-mixed.md" --milestone tech-debt --dir "$PDIR4" 2>&1)"
RC=$?
assert_rc "fr012-default-scope-exit-0" 0 "$RC" "$OUT"

if node -e '
  const out = JSON.parse(process.argv[1]);
  process.exit(Array.isArray(out.mirrored) && out.mirrored.length === 2 ? 0 : 1);
' "$OUT"; then
  assert_true "fr012-default-scope-mirrors-2-open-only" "true"
else
  assert_true "fr012-default-scope-mirrors-2-open-only" "false"
fi

if node -e '
  const out = JSON.parse(process.argv[1]);
  const findings = out.mirrored.map((m) => m.finding).sort();
  const expected = ["F-101", "F-103"];
  process.exit(JSON.stringify(findings) === JSON.stringify(expected) ? 0 : 1);
' "$OUT"; then
  assert_true "fr012-default-scope-mirrors-exactly-the-open-findings" "true"
else
  assert_true "fr012-default-scope-mirrors-exactly-the-open-findings" "false"
fi

if node -e '
  const fs = require("fs");
  const io = require(process.argv[2]);
  const { fm } = io.parseNestedFrontmatter(fs.readFileSync(process.argv[1], "utf8"));
  process.exit(fm.features.length === 2 ? 0 : 1);
' "$PDIR4/ROADMAP.md" "$IO_CJS"; then
  assert_true "fr012-default-scope-roadmap-has-exactly-2-features" "true"
else
  assert_true "fr012-default-scope-roadmap-has-exactly-2-features" "false"
fi

# --only open explicitly is equivalent to the default (same 2 open findings,
# already-mirrored ones skipped this time).
OUT="$(node "$TOOLS" product audit-mirror --audit "$PDIR4/audits/2026-07-13-mixed.md" --milestone tech-debt --only open --dir "$PDIR4" 2>&1)"
RC=$?
assert_rc "fr012-only-open-explicit-exit-0" 0 "$RC" "$OUT"
if node -e '
  const out = JSON.parse(process.argv[1]);
  process.exit(Array.isArray(out.mirrored) && out.mirrored.length === 0 && Array.isArray(out.skipped) && out.skipped.length === 2 ? 0 : 1);
' "$OUT"; then
  assert_true "fr012-only-open-explicit-already-mirrored-skipped" "true"
else
  assert_true "fr012-only-open-explicit-already-mirrored-skipped" "false"
fi

echo "product-audit-mirror fixtures: $pass passed, $fail failed"
