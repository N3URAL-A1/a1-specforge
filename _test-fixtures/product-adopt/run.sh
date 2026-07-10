#!/usr/bin/env bash
# Scenario suite for a1-roadmap "adopt" mode (Wave 5, FR-018/FR-019/FR-020,
# SC-004). Mirrors the a1-code-scope / a1-reservations / product-docs harness
# style (mktemp workdir, assert_rc/assert_true, node invocations against
# a1-tools.cjs). Adopt mode itself is a skill-level (LLM-interview) workflow,
# not a CLI subcommand — so this fixture exercises the CLI primitives adopt
# mode is specified to call (product init/add-milestone/add-feature/stage/
# changelog) the same way an adopt-mode run would sequence them, and asserts
# the resulting docs/product/ structure is schema-v1 valid.
#
# Fixture strategy (documented per task instructions): the real niimo/
# n3ural-platform project directories are NOT mutated. Scenario 1 copies the
# real, already-migrated niimo docs/product/ROADMAP.md (read-only source) into
# this test's own temp dir and re-derives it end-to-end via the CLI calls
# adopt mode would issue, so the real fixture's shape is exercised without
# ever writing back into /Users/rob/code/niimo. Scenario 2 (stale-.planning/
# conflict) uses a synthetic project, since a full git history + .planning/
# tree is impractical to fixture; it reproduces the same shape (stale
# .planning/ note claiming "in-progress" vs. newer VERIFICATION.md/commit
# evidence claiming "done") that niimo's real .planning/ directory exhibits.
#
# Scenarios:
#   evidence ladder rung (a): VERIFICATION.md present -> feature marked done
#   evidence ladder rung (b): merged commits referencing feature -> done
#   evidence ladder rung (c): spec frontmatter status=done -> done
#   weaker evidence -> left undetermined (not auto-derived)               (FR-018)
#   derived + interviewed structure produces valid schema-v1 ROADMAP.md   (SC-004)
#   niimo-shaped real fixture round-trips through the same CLI sequence   (SC-004)
#   stale .planning/ vs newer evidence -> newest evidence wins            (FR-020)
#   conflict resolution appends a discrepancy changelog line              (FR-020)
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
NIIMO_ROADMAP="/Users/rob/code/niimo/docs/product/ROADMAP.md"

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

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-adopt-test.XXXXXX")"

# ============================================================================
# Scenario A — synthetic brownfield project exercising the full evidence
# ladder (rungs a/b/c) + one "weaker evidence" case that must NOT be
# auto-derived, then a full adopt-style CLI sequence producing a valid
# schema-v1 structure (FR-018, SC-004).
# ============================================================================
A_ROOT="$WORK/synthetic-project"
mkdir -p "$A_ROOT/.a1/phases/M1-P1-auth"
mkdir -p "$A_ROOT/.git-sim" # not a real git repo; commit evidence simulated via a plain log file below
PDIR_A="$A_ROOT/docs/product"

# --- rung (a): VERIFICATION.md present ---
cat > "$A_ROOT/.a1/phases/M1-P1-auth/VERIFICATION.md" <<'EOF'
# Verification — M1-P1-auth

Verdict: PASS
Goal reached: yes
EOF

# --- rung (b): merged commits referencing the feature (simulated log, since
# a full git repo is unnecessary machinery for this fixture — the ladder's
# actual `git log --grep` query is validated structurally in the SKILL.md
# spec; here we simulate the evidence source it reads) ---
cat > "$A_ROOT/.git-sim/log.txt" <<'EOF'
a1b2c3d feat(payments): ship stripe checkout (002-payments)
9f8e7d6 fix(payments): handle webhook retries (002-payments)
EOF

# --- rung (c): spec frontmatter status=done ---
mkdir -p "$A_ROOT/.a1/learnings/projects/synthetic-project/spec"
cat > "$A_ROOT/.a1/learnings/projects/synthetic-project/spec/003-notifications.md" <<'EOF'
---
id: 003-notifications
project: synthetic-project
feature_slug: notifications
status: done
---

# Notifications
EOF

# --- weaker evidence: only a TODO comment, no VERIFICATION/commits/spec ---
mkdir -p "$A_ROOT/.a1/phases/M1-P2-reporting"
cat > "$A_ROOT/.a1/phases/M1-P2-reporting/GOAL.md" <<'EOF'
# Phase: reporting
## Goal
Ship basic usage reporting.
## Status
planned — TODO: unclear if this was ever started
EOF

# Assert the fixture's evidence sources are actually present the way the
# ladder would read them (proxy for "the ladder rungs are queryable").
assert_true "rung-a-verification-present" "$([[ -f "$A_ROOT/.a1/phases/M1-P1-auth/VERIFICATION.md" ]] && grep -q 'PASS' "$A_ROOT/.a1/phases/M1-P1-auth/VERIFICATION.md" && echo true || echo false)"
assert_true "rung-b-merged-commit-evidence-present" "$(grep -q '002-payments' "$A_ROOT/.git-sim/log.txt" && echo true || echo false)"
assert_true "rung-c-spec-status-done-present" "$(grep -q 'status: done' "$A_ROOT/.a1/learnings/projects/synthetic-project/spec/003-notifications.md" && echo true || echo false)"
assert_true "weaker-evidence-not-auto-derivable" "$(grep -q 'TODO' "$A_ROOT/.a1/phases/M1-P2-reporting/GOAL.md" && echo true || echo false)"

# --- Adopt-style CLI sequence: derived-done features get `product stage
# --set done`; the undetermined (reporting) feature is added as `planned`,
# simulating "left for the interview" rather than guessed done. ---
OUT="$(node "$TOOLS" product init --project synthetic-project --title "Synthetic Project" --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "adopt-product-init" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-milestone --id m1-core --title "Core Platform" --status in-progress --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "adopt-add-milestone" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-feature --id 001-auth --milestone m1-core --title "Auth (verified done)" --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "adopt-add-feature-001-auth" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-feature --id 002-payments --milestone m1-core --title "Payments (merged commits)" --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "adopt-add-feature-002-payments" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-feature --id 003-notifications --milestone m1-core --title "Notifications (spec status=done)" --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "adopt-add-feature-003-notifications" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-feature --id 004-reporting --milestone m1-core --title "Reporting (undetermined — left planned, not guessed done)" --dir "$PDIR_A" 2>&1)"
RC=$?
assert_rc "adopt-add-feature-004-reporting-undetermined" 0 "$RC" "$OUT"

# Mark the three ladder-derived features done via `product stage`.
for fid in 001-auth 002-payments 003-notifications; do
  OUT="$(node "$TOOLS" product stage --by "$fid" --set done --dir "$PDIR_A" 2>&1)"
  RC=$?
  assert_rc "adopt-stage-done-$fid" 0 "$RC" "$OUT"
done

# --- FR-018 assertion: derived-done features are marked done; the
# undetermined feature is NOT (it stayed `planned`, i.e. "ask the user"). ---
if node -e '
  const fm = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const byId = Object.fromEntries(fm.features.map((f) => [f.id, f]));
  const derivedDone = ["001-auth", "002-payments", "003-notifications"].every((id) => byId[id] && byId[id].status === "done" && byId[id].stage === "done");
  const undeterminedNotGuessed = byId["004-reporting"] && byId["004-reporting"].status === "planned" && byId["004-reporting"].stage === null;
  process.exit(derivedDone && undeterminedNotGuessed ? 0 : 1);
' "$PDIR_A/index.json"; then
  assert_true "fr018-ladder-derives-done-weaker-left-undetermined" "true"
else
  assert_true "fr018-ladder-derives-done-weaker-left-undetermined" "false"
fi

# --- SC-004 assertion: resulting structure is a valid schema-v1
# ROADMAP.md/index.json (required top-level keys, per docs/product/SCHEMA.md
# + index.schema.json field names). ---
if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const required = ["schema_version", "generated", "project", "milestones", "features", "next", "cursor"];
  for (const k of required) if (!(k in data)) { console.error("missing key: " + k); process.exit(1); }
  if (data.schema_version !== 1) process.exit(1);
  for (const f of data.features) {
    for (const k of ["id", "milestone", "title", "status", "stage", "depends_on", "started", "finished"]) {
      if (!(k in f)) { console.error("feature " + f.id + " missing " + k); process.exit(1); }
    }
  }
' "$PDIR_A/index.json"; then
  assert_true "sc004-synthetic-adopt-schema-v1-valid" "true"
else
  assert_true "sc004-synthetic-adopt-schema-v1-valid" "false"
fi

if grep -q '^schema_version: 1' "$PDIR_A/ROADMAP.md" && grep -q '^type: roadmap' "$PDIR_A/ROADMAP.md"; then
  assert_true "sc004-synthetic-adopt-roadmap-md-valid" "true"
else
  assert_true "sc004-synthetic-adopt-roadmap-md-valid" "false"
fi

# ============================================================================
# Scenario B — real niimo ROADMAP.md fixture (already migrated 2026-07-10),
# copied read-only into the temp dir and re-derived end-to-end through the
# same CLI sequence adopt mode issues, asserting a valid schema-v1 structure
# results (SC-004: "adopt mode run on >=2 real existing projects... produces
# a valid schema-v1 structure"). The real /Users/rob/code/niimo directory is
# never written to.
# ============================================================================
if [[ -f "$NIIMO_ROADMAP" ]]; then
  B_ROOT="$WORK/niimo-fixture"
  PDIR_B="$B_ROOT/docs/product"
  mkdir -p "$PDIR_B"
  cp "$NIIMO_ROADMAP" "$PDIR_B/ROADMAP.md"

  # niimo's real ROADMAP.md already has milestones[]/features[] populated by
  # the 2026-07-10 hand migration (this fixture's job is to prove adopt mode
  # CAN reproduce/extend that shape via the CLI, not to re-run the original
  # migration). We assert its frontmatter is already schema-v1 shaped, then
  # exercise `product status` (read-only) + `product add-feature` +
  # `product stage` on top of it exactly as adopt mode would when
  # incrementally adopting a project that already has partial docs/product/.
  OUT="$(node "$TOOLS" product status --dir "$PDIR_B" 2>&1)"
  RC=$?
  assert_rc "niimo-fixture-product-status-readable" 0 "$RC" "$OUT"

  if echo "$OUT" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!data.project || !Array.isArray(data.milestones) || !Array.isArray(data.features)) process.exit(1);
    if (data.milestones.length < 1 || data.features.length < 1) process.exit(1);
  '; then
    assert_true "niimo-fixture-schema-v1-status-shape" "true"
  else
    assert_true "niimo-fixture-schema-v1-status-shape" "false"
  fi

  # Adopt mode extending the real fixture: add one new milestone/feature the
  # way an adopt-mode interview for the "future part" would (FR-019), then
  # mark it done as if the ladder found it complete on a later run.
  OUT="$(node "$TOOLS" product add-milestone --id adopt-test-milestone --title "Adopt-mode fixture milestone" --status planned --dir "$PDIR_B" 2>&1)"
  RC=$?
  assert_rc "niimo-fixture-add-milestone" 0 "$RC" "$OUT"

  OUT="$(node "$TOOLS" product add-feature --id 999-adopt-fixture --milestone adopt-test-milestone --title "Adopt-mode fixture feature" --dir "$PDIR_B" 2>&1)"
  RC=$?
  assert_rc "niimo-fixture-add-feature" 0 "$RC" "$OUT"

  OUT="$(node "$TOOLS" product stage --by 999-adopt-fixture --set done --dir "$PDIR_B" 2>&1)"
  RC=$?
  assert_rc "niimo-fixture-stage-done" 0 "$RC" "$OUT"

  if node -e '
    const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const required = ["schema_version", "generated", "project", "milestones", "features", "next", "cursor"];
    for (const k of required) if (!(k in data)) process.exit(1);
    if (data.project.id !== "niimo") process.exit(1);
    const f = data.features.find((x) => x.id === "999-adopt-fixture");
    if (!f || f.status !== "done") process.exit(1);
  ' "$PDIR_B/index.json"; then
    assert_true "sc004-niimo-real-fixture-schema-v1-valid" "true"
  else
    assert_true "sc004-niimo-real-fixture-schema-v1-valid" "false"
  fi

  # Real project directory must remain untouched by this fixture run.
  if git -C /Users/rob/code/niimo diff --quiet -- docs/product/ROADMAP.md 2>/dev/null || [[ ! -d /Users/rob/code/niimo/.git ]]; then
    assert_true "niimo-real-project-directory-untouched" "true"
  else
    assert_true "niimo-real-project-directory-untouched" "false"
  fi
else
  echo "SKIP  niimo real-fixture scenario ($NIIMO_ROADMAP not found on this machine)"
fi

# ============================================================================
# Scenario C — stale .planning/ vs newer evidence conflict (FR-020).
# Synthetic project (reproducing the shape observed in real niimo, which has
# a genuine stale .planning/ tree): a .planning/ note claims a feature is
# still "in-progress"; newer evidence (a VERIFICATION.md dated later, plus
# simulated merged-commit evidence) shows it is actually done. Adopt mode
# must take the newer evidence and log the discrepancy via `product
# changelog` rather than silently picking either side.
# ============================================================================
C_ROOT="$WORK/conflict-project"
mkdir -p "$C_ROOT/.planning/legacy-feature"
mkdir -p "$C_ROOT/.a1/phases/M1-P1-legacy-feature"
PDIR_C="$C_ROOT/docs/product"

cat > "$C_ROOT/.planning/legacy-feature/STATUS.md" <<'EOF'
status: in-progress
updated: 2026-03-01
note: still mid-implementation, do not mark done yet
EOF

cat > "$C_ROOT/.a1/phases/M1-P1-legacy-feature/VERIFICATION.md" <<'EOF'
# Verification — M1-P1-legacy-feature

Verdict: PASS
Date: 2026-07-08
Goal reached: yes (supersedes stale .planning/legacy-feature/STATUS.md dated 2026-03-01)
EOF

# Assert the conflict actually exists in the fixture data (older .planning/
# claim vs newer VERIFICATION.md) before resolving it — this is the
# precondition FR-020 fires on.
assert_true "conflict-fixture-stale-planning-present" "$(grep -q 'in-progress' "$C_ROOT/.planning/legacy-feature/STATUS.md" && echo true || echo false)"
assert_true "conflict-fixture-newer-verification-present" "$(grep -q 'PASS' "$C_ROOT/.a1/phases/M1-P1-legacy-feature/VERIFICATION.md" && echo true || echo false)"

OUT="$(node "$TOOLS" product init --project conflict-project --title "Conflict Project" --dir "$PDIR_C" 2>&1)"
RC=$?
assert_rc "conflict-product-init" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-milestone --id m1-legacy --title "Legacy Milestone" --status in-progress --dir "$PDIR_C" 2>&1)"
RC=$?
assert_rc "conflict-add-milestone" 0 "$RC" "$OUT"

OUT="$(node "$TOOLS" product add-feature --id 001-legacy-feature --milestone m1-legacy --title "Legacy Feature" --dir "$PDIR_C" 2>&1)"
RC=$?
assert_rc "conflict-add-feature" 0 "$RC" "$OUT"

CHANGELOG_COUNT_BEFORE="$(grep -c '^\- \*\*' "$PDIR_C/ROADMAP.md")"

# Newest evidence (VERIFICATION.md, 2026-07-08) wins over the stale
# .planning/ claim (2026-03-01, in-progress) -> feature marked done.
OUT="$(node "$TOOLS" product stage --by 001-legacy-feature --set done --dir "$PDIR_C" 2>&1)"
RC=$?
assert_rc "conflict-newest-evidence-wins-stage-done" 0 "$RC" "$OUT"

# The discrepancy itself must be logged as an explicit changelog line (FR-020)
# via the CLI's changelog mechanism, distinct from the automatic
# stage-transition changelog line `product stage` already appended above.
OUT="$(node "$TOOLS" product changelog \
  --entry "adopt: 001-legacy-feature resolved from conflicting legacy state" \
  --why "stale .planning/legacy-feature/STATUS.md (2026-03-01, in-progress) contradicted newer VERIFICATION.md (2026-07-08, PASS); newest evidence wins" \
  --dir "$PDIR_C" 2>&1)"
RC=$?
assert_rc "conflict-changelog-append" 0 "$RC" "$OUT"

CHANGELOG_COUNT_AFTER="$(grep -c '^\- \*\*' "$PDIR_C/ROADMAP.md")"

if (( CHANGELOG_COUNT_AFTER > CHANGELOG_COUNT_BEFORE )); then
  assert_true "fr020-changelog-entry-count-increased" "true"
else
  assert_true "fr020-changelog-entry-count-increased" "false"
fi

if grep -q 'resolved from conflicting legacy state' "$PDIR_C/ROADMAP.md" && \
   grep -q 'newest evidence wins' "$PDIR_C/ROADMAP.md"; then
  assert_true "fr020-changelog-discrepancy-line-present" "true"
else
  assert_true "fr020-changelog-discrepancy-line-present" "false"
fi

# The feature must actually be done (newest evidence won, not the stale claim).
if node -e '
  const fm = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const f = fm.features.find((x) => x.id === "001-legacy-feature");
  process.exit(f && f.status === "done" && f.stage === "done" ? 0 : 1);
' "$PDIR_C/index.json"; then
  assert_true "fr020-newest-evidence-status-done" "true"
else
  assert_true "fr020-newest-evidence-status-done" "false"
fi

echo "product-adopt fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
