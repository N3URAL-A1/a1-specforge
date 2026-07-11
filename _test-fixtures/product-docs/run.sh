#!/usr/bin/env bash
# Scenario suite for `a1-tools product` (docs/product/ROADMAP.md status/stage
# transactional subcommand group, schema v1). Mirrors the a1-code-scope /
# a1-reservations harness style (mktemp workdir, assert_rc, node invocations).
# Scenarios:
#   status is read-only (hash unchanged)                    -> 0
#   status prints project/milestones/features/next
#   stage forward transition updates ROADMAP + feature.md    -> 0
#   index.json regenerated with required top-level keys      -> 0
#   NEXT.md regenerated, mentions the feature id
#   forward-only guard: backward transition rejected          -> 1, unchanged
#   mirroring: reservations.json code_scope .stage matches ROADMAP
#   crash-safety: read-only target -> exit non-zero, originals byte-identical
#   idempotent same-stage re-set                              -> 0, dates stable
#   crash-safety RENAME PHASE: injected failure mid rename-loop (2nd+ file)
#     -> exit non-zero, ALL staged files (incl. already-renamed ones) rolled
#     back byte-identical to pre-call content (covers the original
#     writeAllOrNothing atomicity bug fixed in 7d42159)
#   SC-003: 10 consecutive CLI state changes, drift-checked after EVERY step
#     (not just at the end) -> index.json + NEXT.md agree with ROADMAP.md /
#     feature.md frontmatter at each of the 10 steps, 0 detected drift
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

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# check_no_drift <step-label> <pdir> <feature-md-file-or-empty>
# SC-003 helper: cross-checks index.json + NEXT.md against ROADMAP.md's own
# frontmatter (read back via the read-only `product status` subcommand, which
# the earlier scenario already proves is hash-unchanged / non-mutating) and,
# when a feature.md mirror exists, against that file's frontmatter too. Fails
# loudly (non-zero return) on ANY mismatch so the caller can assert per-step,
# not just once at the end.
check_no_drift() {
  local label="$1" pdir="$2" feature_md="${3:-}"
  local status_out
  status_out="$(node "$TOOLS" product status --dir "$pdir" 2>&1)"
  if [[ $? -ne 0 ]]; then
    echo "  drift-check[$label]: product status failed: $status_out"
    return 1
  fi
  node -e '
    const fs = require("fs");
    const [statusJson, indexPath, nextMdPath, featureMdPath] = process.argv.slice(1);
    const status = JSON.parse(statusJson);
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const nextMd = fs.readFileSync(nextMdPath, "utf8");

    // project + next cursor must match ROADMAP frontmatter exactly
    if (status.project.status !== index.project.status) {
      console.error(`project.status drift: ROADMAP=${status.project.status} index.json=${index.project.status}`);
      process.exit(1);
    }
    if (status.next !== index.next) {
      console.error(`next cursor drift: ROADMAP=${status.next} index.json=${index.next}`);
      process.exit(1);
    }

    // every feature: stage/status/started/finished must match ROADMAP frontmatter
    for (const rf of status.features) {
      const idxF = index.features.find((f) => f.id === rf.id);
      if (!idxF) {
        console.error(`feature ${rf.id} missing from index.json`);
        process.exit(1);
      }
      const rfStage = rf.stage !== undefined ? rf.stage : null;
      const rfStatus = rf.status !== undefined ? rf.status : null;
      const rfStarted = rf.started !== undefined ? rf.started : null;
      const rfFinished = rf.finished !== undefined ? rf.finished : null;
      if (idxF.stage !== rfStage || idxF.status !== rfStatus || idxF.started !== rfStarted || idxF.finished !== rfFinished) {
        console.error(
          `feature ${rf.id} drift: ROADMAP={stage:${rfStage},status:${rfStatus},started:${rfStarted},finished:${rfFinished}} ` +
          `index.json={stage:${idxF.stage},status:${idxF.status},started:${idxF.started},finished:${idxF.finished}}`
        );
        process.exit(1);
      }
      // in-flight features must be named in the NEXT.md In-flight section
      if (rfStatus === "in-flight" && !nextMd.includes(rf.id)) {
        console.error(`feature ${rf.id} is in-flight but not mentioned in NEXT.md`);
        process.exit(1);
      }
    }

    // NEXT.md next-cursor section must mention the current cursor id (if any)
    if (index.cursor !== null && !nextMd.includes(index.cursor)) {
      console.error(`cursor ${index.cursor} not mentioned in NEXT.md`);
      process.exit(1);
    }

    // milestone statuses must match ROADMAP frontmatter
    for (const rm of status.milestones) {
      const idxM = index.milestones.find((m) => m.id === rm.id);
      if (!idxM || idxM.status !== rm.status) {
        console.error(`milestone ${rm.id} drift: ROADMAP=${rm.status} index.json=${idxM ? idxM.status : "MISSING"}`);
        process.exit(1);
      }
    }

    // feature.md mirror (when present): stage/status must match ROADMAP frontmatter
    if (featureMdPath) {
      const fmContent = fs.readFileSync(featureMdPath, "utf8");
      const targetId = status.features.find((f) => featureMdPath.includes(f.id));
      if (targetId) {
        const stageLine = new RegExp(`stage:\\s*${targetId.stage === null ? "null" : targetId.stage}\\b`);
        const statusLine = new RegExp(`status:\\s*${targetId.status}\\b`);
        if (!stageLine.test(fmContent)) {
          console.error(`feature.md stage drift for ${targetId.id}: expected stage ${targetId.stage}`);
          process.exit(1);
        }
        if (!statusLine.test(fmContent)) {
          console.error(`feature.md status drift for ${targetId.id}: expected status ${targetId.status}`);
          process.exit(1);
        }
      }
    }
  ' "$status_out" "$pdir/index.json" "$pdir/NEXT.md" "$feature_md"
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "  drift-check[$label]: MISMATCH (see above)"
    return 1
  fi
  return 0
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-docs-test.XXXXXX")"
PDIR="$WORK/docs/product"
mkdir -p "$PDIR/features/002-second-feature"

cat > "$PDIR/ROADMAP.md" <<'EOF'
---
schema_version: 1
type: roadmap
project: test-project
title: Test Project — Roadmap
status: active
updated: 2026-01-01
source: "test fixture"
milestones:
  - id: m1-first
    title: First Milestone
    status: in-progress
    target: 2026-02
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
  - id: 002-second-feature
    milestone: m1-first
    title: Second Feature
    status: planned
    stage: null
    depends_on: [001-first-feature]
    started: null
    finished: null
    spec_path: null
    plan_path: null
next: 001-first-feature
---

# Test Project — Roadmap

> Fixture roadmap for a1-tools product tests.

## Milestones

### First Milestone <!-- entry: m1-first -->
Status: in-progress · Target: 2026-02
Goal: fixture milestone.

**Features:**
- [ ] **001-first-feature** — First Feature: fixture feature.
- [ ] **002-second-feature** — Second Feature: fixture feature (depends on: 001-first-feature)

## In-flight features

None.

## Changelog

- **2026-01-01** — Created fixture.
EOF

cat > "$PDIR/features/002-second-feature/feature.md" <<'EOF'
---
id: 002-second-feature
project: test-project
milestone: m1-first
title: Second Feature
status: planned
stage: null
depends_on:
  - 001-first-feature
started: null
finished: null
spec_path: null
plan_path: null
schema_version: 1
---

Fixture feature.md body.
EOF

# --- status is read-only: hash before/after must match ---
BEFORE_HASH="$(hash_file "$PDIR/ROADMAP.md")"
OUT="$(node "$TOOLS" product status --dir "$PDIR" 2>&1)"
RC=$?
assert_rc "status-exit-0" 0 "$RC" "$OUT"
AFTER_HASH="$(hash_file "$PDIR/ROADMAP.md")"
if [[ "$BEFORE_HASH" == "$AFTER_HASH" ]]; then
  assert_true "status-read-only-hash-unchanged" "true"
else
  assert_true "status-read-only-hash-unchanged" "false"
fi

# status output shape
if echo "$OUT" | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (!data.project || !Array.isArray(data.milestones) || !Array.isArray(data.features)) process.exit(1);
  if (data.next !== "001-first-feature") process.exit(1);
  const f2 = data.features.find((f) => f.id === "002-second-feature");
  if (!f2 || !f2.feature_md_path) process.exit(1);
'; then
  assert_true "status-output-shape" "true"
else
  assert_true "status-output-shape" "false"
fi

# --- stage forward transition: null -> started ---
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set started --dir "$PDIR" 2>&1)"
RC=$?
assert_rc "stage-started" 0 "$RC" "$OUT"

if grep -A6 'id: 001-first-feature' "$PDIR/ROADMAP.md" | grep -q 'stage: started'; then
  assert_true "roadmap-updated-stage-started" "true"
else
  assert_true "roadmap-updated-stage-started" "false"
fi

# --- stage transition on a feature that HAS a feature.md: 002 null -> started ---
OUT="$(node "$TOOLS" product stage --by 002-second-feature --set started --dir "$PDIR" 2>&1)"
RC=$?
assert_rc "stage-started-with-feature-md" 0 "$RC" "$OUT"

if grep -q 'stage: started' "$PDIR/features/002-second-feature/feature.md"; then
  assert_true "feature-md-mirrored" "true"
else
  assert_true "feature-md-mirrored" "false"
fi

# --- index.json regenerated with required top-level keys ---
if [[ -f "$PDIR/index.json" ]]; then
  assert_true "index-json-exists" "true"
else
  assert_true "index-json-exists" "false"
fi

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const required = ["schema_version", "generated", "project", "milestones", "features", "next", "cursor"];
  for (const k of required) if (!(k in data)) process.exit(1);
' "$PDIR/index.json"; then
  assert_true "index-json-required-keys" "true"
else
  assert_true "index-json-required-keys" "false"
fi

# --- NEXT.md regenerated, non-empty, mentions feature id ---
if [[ -s "$PDIR/NEXT.md" ]] && grep -q '001-first-feature' "$PDIR/NEXT.md"; then
  assert_true "next-md-regenerated" "true"
else
  assert_true "next-md-regenerated" "false"
fi

# --- forward-only guard: complete then try to go back to started -> reject ---
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set complete --dir "$PDIR" 2>&1)"
RC=$?
assert_rc "stage-complete" 0 "$RC" "$OUT"

ROADMAP_HASH_BEFORE_BACKWARD="$(hash_file "$PDIR/ROADMAP.md")"
INDEX_HASH_BEFORE_BACKWARD="$(hash_file "$PDIR/index.json")"
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set started --dir "$PDIR" 2>&1)"
RC=$?
assert_rc "stage-backward-rejected" 1 "$RC" "$OUT"
ROADMAP_HASH_AFTER_BACKWARD="$(hash_file "$PDIR/ROADMAP.md")"
INDEX_HASH_AFTER_BACKWARD="$(hash_file "$PDIR/index.json")"
if [[ "$ROADMAP_HASH_BEFORE_BACKWARD" == "$ROADMAP_HASH_AFTER_BACKWARD" && "$INDEX_HASH_BEFORE_BACKWARD" == "$INDEX_HASH_AFTER_BACKWARD" ]]; then
  assert_true "backward-transition-leaves-files-unchanged" "true"
else
  assert_true "backward-transition-leaves-files-unchanged" "false"
fi

# --- mirroring: create a matching code_scope reservation, then stage forward ---
mkdir -p "$WORK/.a1"
cat > "$WORK/.a1/reservations.json" <<'EOF'
{
  "reservations": [
    {"type": "code_scope", "by": "001-first-feature", "paths": ["src/foo/"], "stage": "complete", "at": "2026-01-01T00:00:00.000Z"}
  ]
}
EOF

pushd "$WORK" >/dev/null
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set review --dir "$PDIR" 2>&1)"
RC=$?
popd >/dev/null
assert_rc "stage-review-with-reservation-mirror" 0 "$RC" "$OUT"

if node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const r = data.reservations.find((x) => x.type === "code_scope" && x.by === "001-first-feature");
  if (!r || r.stage !== "review") process.exit(1);
' "$WORK/.a1/reservations.json"; then
  assert_true "reservation-stage-mirrored" "true"
else
  assert_true "reservation-stage-mirrored" "false"
fi

# --- idempotent same-stage re-set: review -> review again ---
GEN_BEFORE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.find(f=>f.id==="001-first-feature").finished)' "$PDIR/index.json")"
STARTED_BEFORE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.find(f=>f.id==="001-first-feature").started)' "$PDIR/index.json")"

pushd "$WORK" >/dev/null
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set review --dir "$PDIR" 2>&1)"
RC=$?
popd >/dev/null
assert_rc "stage-idempotent-same-stage" 0 "$RC" "$OUT"

STARTED_AFTER="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.find(f=>f.id==="001-first-feature").started)' "$PDIR/index.json")"
FINISHED_AFTER="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).features.find(f=>f.id==="001-first-feature").finished)' "$PDIR/index.json")"
if [[ "$STARTED_BEFORE" == "$STARTED_AFTER" && "$GEN_BEFORE" == "$FINISHED_AFTER" ]]; then
  assert_true "idempotent-dates-unchanged" "true"
else
  echo "  started before=$STARTED_BEFORE after=$STARTED_AFTER; finished before=$GEN_BEFORE after=$FINISHED_AFTER"
  assert_true "idempotent-dates-unchanged" "false"
fi

# --- crash-safety (FR-009): make index.json's directory read-only so a
# rename into it fails partway through the staged write set; assert
# non-zero exit AND originals byte-identical afterward. We chmod the
# *feature.md* target file itself read-only (simpler + portable than dir
# perms) to force a write failure on one of the staged files.
ROADMAP_HASH_BEFORE_CRASH="$(hash_file "$PDIR/ROADMAP.md")"
INDEX_HASH_BEFORE_CRASH="$(hash_file "$PDIR/index.json")"
NEXT_HASH_BEFORE_CRASH="$(hash_file "$PDIR/NEXT.md")"

chmod 555 "$PDIR/features/002-second-feature"
OUT="$(node "$TOOLS" product stage --by 002-second-feature --set complete --dir "$PDIR" 2>&1)"
RC=$?
chmod 755 "$PDIR/features/002-second-feature"

assert_rc "crash-safety-nonzero-exit" 1 "$RC" "$OUT"

ROADMAP_HASH_AFTER_CRASH="$(hash_file "$PDIR/ROADMAP.md")"
INDEX_HASH_AFTER_CRASH="$(hash_file "$PDIR/index.json")"
NEXT_HASH_AFTER_CRASH="$(hash_file "$PDIR/NEXT.md")"
if [[ "$ROADMAP_HASH_BEFORE_CRASH" == "$ROADMAP_HASH_AFTER_CRASH" && \
      "$INDEX_HASH_BEFORE_CRASH" == "$INDEX_HASH_AFTER_CRASH" && \
      "$NEXT_HASH_BEFORE_CRASH" == "$NEXT_HASH_AFTER_CRASH" ]]; then
  assert_true "crash-safety-originals-unchanged" "true"
else
  assert_true "crash-safety-originals-unchanged" "false"
fi

# --- SC-007: full 7-stage lifecycle parity -----------------------------
# "A feature's stage value read from reservations.json, feature.md, and
# ROADMAP.md is identical after every CLI stage-transition call, checked
# across all lifecycle stages (started->...->done) in an integration test."
#
# 002-second-feature already sits at stage=started (set above, line ~175)
# and has a feature.md (mirrored above). Give it a matching code_scope
# reservation at the SAME stage so all three sources start in sync, then
# walk it through every remaining CODE_SCOPE_STAGES entry in order,
# asserting 3-way parity after EACH transition (not just at the end).
ALL_STAGES=(started complete review verify merge origin-cleanup done)

# Seed the reservation at the feature's current stage (started) so the
# very first transition in the loop below already has a reservation to
# mirror into (the CLI silently skips mirroring when no reservation
# exists yet for this feature id).
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  data.reservations.push({
    type: "code_scope",
    by: "002-second-feature",
    paths: ["src/bar/"],
    stage: "started",
    at: "2026-01-01T00:00:00.000Z",
  });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
' "$WORK/.a1/reservations.json"

assert_three_way_parity() {
  local stage="$1"
  node -e '
    const fs = require("fs");
    const [resPath, featurePath, roadmapPath, stage] = process.argv.slice(1);

    const res = JSON.parse(fs.readFileSync(resPath, "utf8"));
    const resEntry = res.reservations.find((r) => r.type === "code_scope" && r.by === "002-second-feature");
    if (!resEntry) { console.error("no reservations.json entry for 002-second-feature"); process.exit(1); }
    if (resEntry.stage !== stage) { console.error(`reservations.json stage=${resEntry.stage}, expected ${stage}`); process.exit(1); }

    const featureRaw = fs.readFileSync(featurePath, "utf8");
    const featureStageMatch = featureRaw.match(/^stage:\s*(.+)$/m);
    const featureStage = featureStageMatch ? featureStageMatch[1].trim() : null;
    if (featureStage !== stage) { console.error(`feature.md stage=${featureStage}, expected ${stage}`); process.exit(1); }

    const roadmapRaw = fs.readFileSync(roadmapPath, "utf8");
    const idIdx = roadmapRaw.indexOf("id: 002-second-feature");
    if (idIdx === -1) { console.error("002-second-feature not found in ROADMAP.md"); process.exit(1); }
    const afterId = roadmapRaw.slice(idIdx, idIdx + 400);
    const roadmapStageMatch = afterId.match(/stage:\s*(.+)/);
    const roadmapStage = roadmapStageMatch ? roadmapStageMatch[1].trim() : null;
    if (roadmapStage !== stage) { console.error(`ROADMAP.md stage=${roadmapStage}, expected ${stage}`); process.exit(1); }
  ' "$WORK/.a1/reservations.json" "$PDIR/features/002-second-feature/feature.md" "$PDIR/ROADMAP.md" "$stage"
}

# Confirm the seeded starting point (stage=started) is already 3-way in sync
# before we transition anywhere, then walk forward through every remaining
# stage, asserting parity after EACH call.
if assert_three_way_parity "started"; then
  assert_true "sc007-parity-started" "true"
else
  assert_true "sc007-parity-started" "false"
fi

pushd "$WORK" >/dev/null
for i in "${!ALL_STAGES[@]}"; do
  [[ "$i" -eq 0 ]] && continue  # 'started' already reached above
  STAGE="${ALL_STAGES[$i]}"
  OUT="$(node "$TOOLS" product stage --by 002-second-feature --set "$STAGE" --dir "$PDIR" 2>&1)"
  RC=$?
  assert_rc "sc007-stage-transition-$STAGE" 0 "$RC" "$OUT"
  if assert_three_way_parity "$STAGE"; then
    assert_true "sc007-parity-$STAGE" "true"
  else
    assert_true "sc007-parity-$STAGE" "false"
  fi
done
popd >/dev/null

# --- crash-safety, RENAME PHASE (FR-009): reproduces the exact shape of the
# original writeAllOrNothing atomicity bug. The bug was that if
# fs.renameSync() failed partway through the rename loop (AFTER one or more
# earlier renames in the same staged write set had already succeeded), those
# already-succeeded renames were never rolled back, leaving mixed old/new
# content across files. The existing crash-safety case above only injects a
# failure during the tmp-WRITE/staging phase (chmod 555 on a directory blocks
# fs.writeFileSync(tmp,...) before any rename starts) — that fault path never
# reaches the rename loop at all (renamed[] stays empty), so it never
# exercised the rollback-of-completed-renames code.
#
# This case forces the failure INSIDE the rename loop itself, after the
# first rename has already landed on disk, using the test-only
# A1_TEST_FAIL_RENAME_AT_INDEX seam in writeAllOrNothing (a1-tools.cjs):
# it throws right after the real fs.renameSync() at the given 0-based index
# has completed, so index 0 succeeding + index 1 throwing is byte-for-byte
# the same failure shape the bug produced (partial rename completion, then a
# throw). 002-second-feature is currently at stage=done (end of the SC-007
# walk above) with a feature.md AND a matching reservations.json entry, so an
# idempotent done->done re-set here still builds the full 5-file write set in
# this fixed order: [0]=ROADMAP.md [1]=index.json [2]=NEXT.md
# [3]=feature.md [4]=reservations.json (writes[] are built unconditionally
# regardless of the idempotent/actual-change branch — see cmdProductStage).
# Failing at index 1 means ROADMAP.md (index 0) has ALREADY been renamed
# into place when the injected throw fires — pre-fix code would leave
# ROADMAP.md holding the NEW content while index.json/NEXT.md/feature.md/
# reservations.json still hold OLD content: a mixed old/new state across
# files. Post-fix code must roll ROADMAP.md back too, so ALL FIVE files —
# not just the one that failed — end up byte-identical to their pre-call
# content.
RENAME_PHASE_ROADMAP_BEFORE="$(hash_file "$PDIR/ROADMAP.md")"
RENAME_PHASE_INDEX_BEFORE="$(hash_file "$PDIR/index.json")"
RENAME_PHASE_NEXT_BEFORE="$(hash_file "$PDIR/NEXT.md")"
RENAME_PHASE_FEATURE_MD_BEFORE="$(hash_file "$PDIR/features/002-second-feature/feature.md")"
RENAME_PHASE_RESERVATIONS_BEFORE="$(hash_file "$WORK/.a1/reservations.json")"

pushd "$WORK" >/dev/null
OUT="$(A1_TEST_FAIL_RENAME_AT_INDEX=1 node "$TOOLS" product stage --by 002-second-feature --set done --dir "$PDIR" 2>&1)"
RC=$?
popd >/dev/null

assert_rc "rename-phase-crash-nonzero-exit" 1 "$RC" "$OUT"

# The injected failure must actually be the one that fired (guards against
# this test silently degrading into a no-op if the seam or write order ever
# changes) and the error message must confirm the all-or-nothing rollback
# path ran, not some unrelated failure.
if echo "$OUT" | grep -q "A1_TEST_FAIL_RENAME_AT_INDEX injected failure at index 1" && \
   echo "$OUT" | grep -q "all changes rolled back"; then
  assert_true "rename-phase-crash-injected-fault-confirmed" "true"
else
  assert_true "rename-phase-crash-injected-fault-confirmed" "false"
fi

RENAME_PHASE_ROADMAP_AFTER="$(hash_file "$PDIR/ROADMAP.md")"
RENAME_PHASE_INDEX_AFTER="$(hash_file "$PDIR/index.json")"
RENAME_PHASE_NEXT_AFTER="$(hash_file "$PDIR/NEXT.md")"
RENAME_PHASE_FEATURE_MD_AFTER="$(hash_file "$PDIR/features/002-second-feature/feature.md")"
RENAME_PHASE_RESERVATIONS_AFTER="$(hash_file "$WORK/.a1/reservations.json")"

# ROADMAP.md is the critical assertion: its rename (index 0) had ALREADY
# SUCCEEDED before the injected failure at index 1. This is the exact file
# the original bug would have left holding new content while its siblings
# held old content. Everything else must also be unchanged (defense in
# depth), but ROADMAP.md is the one that proves the rollback-of-already-
# completed-renames code path (not just the leftover-tmp-cleanup path) ran.
if [[ "$RENAME_PHASE_ROADMAP_BEFORE" == "$RENAME_PHASE_ROADMAP_AFTER" && \
      "$RENAME_PHASE_INDEX_BEFORE" == "$RENAME_PHASE_INDEX_AFTER" && \
      "$RENAME_PHASE_NEXT_BEFORE" == "$RENAME_PHASE_NEXT_AFTER" && \
      "$RENAME_PHASE_FEATURE_MD_BEFORE" == "$RENAME_PHASE_FEATURE_MD_AFTER" && \
      "$RENAME_PHASE_RESERVATIONS_BEFORE" == "$RENAME_PHASE_RESERVATIONS_AFTER" ]]; then
  assert_true "rename-phase-crash-all-files-rolled-back" "true"
else
  echo "  ROADMAP   before=$RENAME_PHASE_ROADMAP_BEFORE after=$RENAME_PHASE_ROADMAP_AFTER"
  echo "  index.json before=$RENAME_PHASE_INDEX_BEFORE after=$RENAME_PHASE_INDEX_AFTER"
  echo "  NEXT.md   before=$RENAME_PHASE_NEXT_BEFORE after=$RENAME_PHASE_NEXT_AFTER"
  echo "  feature.md before=$RENAME_PHASE_FEATURE_MD_BEFORE after=$RENAME_PHASE_FEATURE_MD_AFTER"
  echo "  reservations.json before=$RENAME_PHASE_RESERVATIONS_BEFORE after=$RENAME_PHASE_RESERVATIONS_AFTER"
  assert_true "rename-phase-crash-all-files-rolled-back" "false"
fi

# No leftover .tmp files from either the aborted rename or the never-renamed
# staged entries (best-effort cleanup must still have run).
if find "$PDIR" "$WORK/.a1" -name '*.tmp.*' 2>/dev/null | grep -q .; then
  assert_true "rename-phase-crash-no-leftover-tmp-files" "false"
else
  assert_true "rename-phase-crash-no-leftover-tmp-files" "true"
fi

# --- SC-003: 10 consecutive CLI-driven state changes on a real project,
# drift-checked after EVERY step (not just once at the end). Fresh fixture
# dir so this scenario isn't entangled with the mutation history above. ---
SC003_WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-docs-sc003.XXXXXX")"
SC003_PDIR="$SC003_WORK/docs/product"
mkdir -p "$SC003_PDIR/features/002-second-feature"

cat > "$SC003_PDIR/ROADMAP.md" <<'EOF'
---
schema_version: 1
type: roadmap
project: sc003-project
title: SC-003 Project — Roadmap
status: active
updated: 2026-01-01
source: "test fixture"
milestones:
  - id: m1-first
    title: First Milestone
    status: planned
    target: 2026-02
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
  - id: 002-second-feature
    milestone: m1-first
    title: Second Feature
    status: planned
    stage: null
    depends_on: [001-first-feature]
    started: null
    finished: null
    spec_path: null
    plan_path: null
next: 001-first-feature
---

# SC-003 Project — Roadmap

> Fixture roadmap for the SC-003 10-step drift-freedom scenario.

## Milestones

### First Milestone <!-- entry: m1-first -->
Status: planned · Target: 2026-02
Goal: fixture milestone.

**Features:**
- [ ] **001-first-feature** — First Feature: fixture feature.
- [ ] **002-second-feature** — Second Feature: fixture feature (depends on: 001-first-feature)

## In-flight features

None.

## Changelog

- **2026-01-01** — Created fixture.
EOF

cat > "$SC003_PDIR/features/002-second-feature/feature.md" <<'EOF'
---
id: 002-second-feature
project: sc003-project
milestone: m1-first
title: Second Feature
status: planned
stage: null
depends_on:
  - 001-first-feature
started: null
finished: null
spec_path: null
plan_path: null
schema_version: 1
---

Fixture feature.md body.
EOF

SC003_FEATURE_MD="$SC003_PDIR/features/002-second-feature/feature.md"
sc003_steps=0

# Step 1: stage 001 -> started
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set started --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step1-stage-001-started" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step1" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step1-no-drift" "true"
else
  assert_true "sc003-step1-no-drift" "false"
fi

# Step 2: stage 002 -> started (exercises the feature.md mirror path)
OUT="$(node "$TOOLS" product stage --by 002-second-feature --set started --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step2-stage-002-started" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step2" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step2-no-drift" "true"
else
  assert_true "sc003-step2-no-drift" "false"
fi

# Step 3: markers --level milestone --set in-progress
OUT="$(node "$TOOLS" product markers --level milestone --id m1-first --set in-progress --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step3-milestone-in-progress" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step3" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step3-no-drift" "true"
else
  assert_true "sc003-step3-no-drift" "false"
fi

# Step 4: stage 001 -> complete
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set complete --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step4-stage-001-complete" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step4" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step4-no-drift" "true"
else
  assert_true "sc003-step4-no-drift" "false"
fi

# Step 5: changelog append (no stage change, still regenerates index.json/NEXT.md)
OUT="$(node "$TOOLS" product changelog --entry "reviewed 001 progress" --why "SC-003 fixture step 5" --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step5-changelog" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step5" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step5-no-drift" "true"
else
  assert_true "sc003-step5-no-drift" "false"
fi

# Step 6: stage 002 -> complete
OUT="$(node "$TOOLS" product stage --by 002-second-feature --set complete --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step6-stage-002-complete" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step6" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step6-no-drift" "true"
else
  assert_true "sc003-step6-no-drift" "false"
fi

# Step 7: stage 001 -> review
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set review --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step7-stage-001-review" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step7" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step7-no-drift" "true"
else
  assert_true "sc003-step7-no-drift" "false"
fi

# Step 8: stage 002 -> review (via `product stage`, not `product markers
# --set`: the latter intentionally skips the feature.md mirror per its own
# code comment, which would inject real drift here — SC-003 requires 0)
OUT="$(node "$TOOLS" product stage --by 002-second-feature --set review --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step8-stage-002-review" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step8" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step8-no-drift" "true"
else
  assert_true "sc003-step8-no-drift" "false"
fi

# Step 9: stage 001 -> verify
OUT="$(node "$TOOLS" product stage --by 001-first-feature --set verify --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step9-stage-001-verify" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step9" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step9-no-drift" "true"
else
  assert_true "sc003-step9-no-drift" "false"
fi

# Step 10: markers --level project --set active (idempotent project status,
# still a real CLI-driven state change + regenerateDerived pass)
OUT="$(node "$TOOLS" product markers --level project --set active --dir "$SC003_PDIR" 2>&1)"
RC=$?
assert_rc "sc003-step10-project-active" 0 "$RC" "$OUT"
sc003_steps=$((sc003_steps + 1))
if check_no_drift "step10" "$SC003_PDIR" "$SC003_FEATURE_MD"; then
  assert_true "sc003-step10-no-drift" "true"
else
  assert_true "sc003-step10-no-drift" "false"
fi

# Meta-assertion: exactly 10 distinct steps were actually exercised, per
# SC-003's "across 10 consecutive CLI-driven state changes" wording.
assert_true "sc003-exactly-10-steps-exercised" "$([[ $sc003_steps -eq 10 ]] && echo true || echo false)"

# ===========================================================================
# Security regression — path traversal via unvalidated --id/--milestone
# (Reinhard review finding). A crafted feature id containing `../` segments
# must be rejected before any path is built or file written, for every
# write-path entry point that joins a user-supplied slug into a path.
# ===========================================================================
SEC_WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-docs-sec-test.XXXXXX")"
SEC_PDIR="$SEC_WORK/docs"
rm -rf /tmp/a1-tools-ESCAPED
node "$TOOLS" product init --project secdemo --title "Sec Demo" --dir "$SEC_PDIR" >/dev/null 2>&1
node "$TOOLS" product add-milestone --id m1 --title "M1" --dir "$SEC_PDIR" >/dev/null 2>&1

OUT="$(node "$TOOLS" product add-feature --id "../../../../../../tmp/a1-tools-ESCAPED" --milestone m1 --title "Evil" --dir "$SEC_PDIR" 2>&1)"
RC=$?
assert_rc "security-path-traversal-add-feature-rejected" 1 "$RC" "$OUT"
assert_true "security-path-traversal-no-escape-dir" "$([[ ! -e /tmp/a1-tools-ESCAPED ]] && echo true || echo false)"

OUT="$(node "$TOOLS" product add-milestone --id "../../../../../../tmp/a1-tools-ESCAPED" --title "Evil" --dir "$SEC_PDIR" 2>&1)"
RC=$?
assert_rc "security-path-traversal-add-milestone-rejected" 1 "$RC" "$OUT"

OUT="$(node "$TOOLS" product feature-init --id "../../../../../../tmp/a1-tools-ESCAPED" --dir "$SEC_PDIR" 2>&1)"
RC=$?
assert_rc "security-path-traversal-feature-init-rejected" 1 "$RC" "$OUT"

OUT="$(node "$TOOLS" product init --project "../../../../../../tmp/a1-tools-ESCAPED" --title "Evil" --dir "$SEC_WORK/docs-init-evil" 2>&1)"
RC=$?
assert_rc "security-path-traversal-init-project-rejected" 1 "$RC" "$OUT"

rm -rf /tmp/a1-tools-ESCAPED

# ===========================================================================
# Stale-lock recovery (Reinhard review MAJOR finding). A `.lock` file left
# behind by a crashed process (SIGKILL/OOM between openSync and release)
# must NOT wedge every future product command until a human runs `rm`.
# acquireReservationsLock() now writes {pid, createdAt} into the lock file
# and, on EEXIST, reclaims it automatically when the owning pid is dead or
# the lock is older than RESERVATIONS_LOCK_STALE_MS (5 min) — see
# isLockStale() in _shared/a1-tools.cjs.
# ===========================================================================
STALE_WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-product-docs-stale-lock-test.XXXXXX")"
STALE_PDIR="$STALE_WORK/docs"
node "$TOOLS" product init --project staledemo --title "Stale Demo" --dir "$STALE_PDIR" >/dev/null 2>&1

# Case A: lock owned by a dead PID, timestamp irrelevant -> must be reclaimed
# immediately and the command must still succeed (exit 0), not fail/timeout.
LOCK_FILE="$STALE_PDIR/.product-stage.lock.json.lock"
mkdir -p "$STALE_PDIR"
# 999999 is not guaranteed-dead on every OS, but PIDs are 32-bit-capped and
# this value is far above any realistic live pid on a dev/CI box; isPidDead()
# treats the ESRCH from process.kill as authoritative either way.
DEAD_PID=999999
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({ pid: Number(process.argv[2]), createdAt: new Date().toISOString() }));
' "$LOCK_FILE" "$DEAD_PID"

START_TS=$(node -e 'console.log(Date.now())')
OUT="$(node "$TOOLS" product add-milestone --id stale-m1 --title "Stale M1" --dir "$STALE_PDIR" 2>&1)"
RC=$?
END_TS=$(node -e 'console.log(Date.now())')
ELAPSED_MS=$((END_TS - START_TS))
assert_rc "stale-lock-dead-pid-reclaimed-succeeds" 0 "$RC" "$OUT"
# Reclaim happens on the first EEXIST hit (no backoff spent) — this must be
# fast (well under the 20*50ms=1s full-retry-budget ceiling), proving it took
# the reclaim path rather than exhausting retries against a live holder.
assert_true "stale-lock-dead-pid-reclaimed-fast" "$([[ $ELAPSED_MS -lt 1000 ]] && echo true || echo false)"
assert_true "stale-lock-dead-pid-not-left-behind" "$([[ ! -e "$LOCK_FILE" ]] && echo true || echo false)"

# Case B: lock owned by a LIVE pid (this test script's own $$, guaranteed
# alive for the duration of the call) with a fresh timestamp -> must NOT be
# reclaimed; acquireReservationsLock must fall back to its normal bounded
# retry loop and eventually fail (exit 1) with the existing "held by another
# process" message, proving real contention is still respected.
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.ppid || process.pid, createdAt: new Date().toISOString() }));
' "$LOCK_FILE"
OUT="$(node "$TOOLS" product add-milestone --id stale-m2 --title "Stale M2" --dir "$STALE_PDIR" 2>&1)"
RC=$?
assert_rc "stale-lock-live-pid-still-blocks" 1 "$RC" "$OUT"
assert_true "stale-lock-live-pid-error-mentions-lock" "$(echo "$OUT" | grep -q "could not acquire lock" && echo true || echo false)"
rm -f "$LOCK_FILE"

# Case C: lock with an unparseable/legacy payload (pre-fix format, or
# corrupted) -> treated as stale (can't prove it's live) and reclaimed, same
# as case A.
echo "not valid json" > "$LOCK_FILE"
OUT="$(node "$TOOLS" product add-milestone --id stale-m3 --title "Stale M3" --dir "$STALE_PDIR" 2>&1)"
RC=$?
assert_rc "stale-lock-corrupt-payload-reclaimed-succeeds" 0 "$RC" "$OUT"

echo "product-docs fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
