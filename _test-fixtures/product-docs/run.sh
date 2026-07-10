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

echo "product-docs fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
