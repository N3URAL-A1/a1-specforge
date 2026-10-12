#!/usr/bin/env bash
# Smoke tests for the `worktree` subcommand of _shared/a1-tools.cjs.
#
# Tests build ephemeral git repos in a temp dir, exercise the full lifecycle
# (prepare, enter, status, exit), and assert exit codes + key JSON fields.
#
# Registry is redirected to a temp file via A1_WORKTREE_REGISTRY so tests do
# not touch the user's real registry.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

WORK=$(mktemp -d)
export A1_WORKTREE_REGISTRY="$WORK/registry.json"

pass=0
fail=0
results=()

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    results+=("PASS  $label  ($actual)")
    pass=$((pass + 1))
  else
    results+=("FAIL  $label  expected=$expected got=$actual")
    fail=$((fail + 1))
  fi
}

extract_field() {
  # extract first occurrence of a JSON string or number field
  local field="$1"
  local blob="$2"
  printf '%s' "$blob" \
    | grep -m1 "\"$field\"" \
    | sed -E "s/.*\"$field\": ?\"?([^,\"}]+)\"?.*/\1/"
}

make_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  echo "hello" > "$dir/README.md"
  git -C "$dir" add README.md
  git -C "$dir" -c commit.gpgsign=false commit -q -m "initial"
}

# ----------------------------------------------------------------------------
# CASE 1: happy path — prepare, enter, status, exit keep
# ----------------------------------------------------------------------------
REPO="$WORK/repo1"
make_repo "$REPO"

OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-one 2>&1)
EX=$?
assert_eq "happy-prepare-exit" "0" "$EX"
ID=$(extract_field id "$OUT")
STATUS=$(extract_field status "$OUT")
assert_eq "happy-prepare-status" "prepared" "$STATUS"

OUT=$(node "$TOOLS" worktree enter "$ID" 2>&1)
EX=$?
assert_eq "happy-enter-exit" "0" "$EX"
STATUS=$(extract_field status "$OUT")
assert_eq "happy-enter-status" "active" "$STATUS"

# worktree exists on disk
if [[ -d "$WORK/a1-worktrees/feat-one" ]]; then
  results+=("PASS  happy-enter-disk  (worktree dir present)")
  pass=$((pass + 1))
else
  results+=("FAIL  happy-enter-disk  worktree dir missing")
  fail=$((fail + 1))
fi

OUT=$(node "$TOOLS" worktree status "$ID" 2>&1)
EX=$?
assert_eq "happy-status-exit" "0" "$EX"

OUT=$(node "$TOOLS" worktree exit "$ID" --mode keep 2>&1)
EX=$?
assert_eq "happy-exit-keep" "0" "$EX"
EXIT_MODE=$(extract_field exit_mode "$OUT")
assert_eq "happy-exit-mode" "keep" "$EXIT_MODE"

# branch still exists, worktree gone
if git -C "$REPO" rev-parse --verify --quiet refs/heads/feature/feat-one >/dev/null; then
  results+=("PASS  happy-branch-kept")
  pass=$((pass + 1))
else
  results+=("FAIL  happy-branch-kept  branch was removed")
  fail=$((fail + 1))
fi
if [[ ! -d "$WORK/a1-worktrees/feat-one" ]]; then
  results+=("PASS  happy-worktree-removed")
  pass=$((pass + 1))
else
  results+=("FAIL  happy-worktree-removed  dir still present")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 2: BLOCKER — dirty working tree
# ----------------------------------------------------------------------------
REPO="$WORK/repo2"
make_repo "$REPO"
echo "dirt" > "$REPO/dirty.txt"

OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-dirty 2>&1)
EX=$?
assert_eq "dirty-prepare-exit" "1" "$EX"
S=$(extract_field status "$OUT")
assert_eq "dirty-prepare-status" "BLOCKER" "$S"

# ----------------------------------------------------------------------------
# CASE 3: ERROR — not a git repo
# ----------------------------------------------------------------------------
mkdir -p "$WORK/notrepo"
OUT=$(node "$TOOLS" worktree prepare "$WORK/notrepo" feat-x 2>&1)
EX=$?
assert_eq "notrepo-prepare-exit" "2" "$EX"

# ----------------------------------------------------------------------------
# CASE 4: ERROR — invalid slug
# ----------------------------------------------------------------------------
REPO="$WORK/repo3"
make_repo "$REPO"
OUT=$(node "$TOOLS" worktree prepare "$REPO" "Bad_Slug" 2>&1)
EX=$?
assert_eq "badslug-prepare-exit" "2" "$EX"

# ----------------------------------------------------------------------------
# CASE 5: discard refuses with unmerged commits
# ----------------------------------------------------------------------------
REPO="$WORK/repo4"
make_repo "$REPO"
OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-commits 2>&1)
ID=$(extract_field id "$OUT")
node "$TOOLS" worktree enter "$ID" >/dev/null 2>&1

WT="$WORK/a1-worktrees/feat-commits"
echo "change" > "$WT/CHANGE.md"
git -C "$WT" add CHANGE.md
git -C "$WT" -c commit.gpgsign=false commit -q -m "feat: add change"

OUT=$(node "$TOOLS" worktree exit "$ID" --mode discard 2>&1)
EX=$?
assert_eq "discard-refused-exit" "1" "$EX"

# handoff should work even with commits
OUT=$(node "$TOOLS" worktree exit "$ID" --mode handoff 2>&1)
EX=$?
assert_eq "handoff-exit" "0" "$EX"
S=$(extract_field status "$OUT")
assert_eq "handoff-status" "handoff" "$S"

# Worktree dir should still be there
if [[ -d "$WT" ]]; then
  results+=("PASS  handoff-worktree-kept")
  pass=$((pass + 1))
else
  results+=("FAIL  handoff-worktree-kept  dir removed")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 6: list + filter
# ----------------------------------------------------------------------------
OUT=$(node "$TOOLS" worktree list --status=handoff 2>&1)
EX=$?
assert_eq "list-exit" "0" "$EX"
C=$(extract_field count "$OUT")
assert_eq "list-count-handoff" "1" "$C"

# ----------------------------------------------------------------------------
# CASE 7: duplicate prepare on same repo+slug refused
# ----------------------------------------------------------------------------
REPO="$WORK/repo5"
make_repo "$REPO"
node "$TOOLS" worktree prepare "$REPO" feat-dup >/dev/null 2>&1
OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-dup 2>&1)
EX=$?
assert_eq "duplicate-prepare-exit" "1" "$EX"
S=$(extract_field status "$OUT")
assert_eq "duplicate-prepare-status" "BLOCKER" "$S"

# ----------------------------------------------------------------------------
# CASE 8: gc finds nothing on a clean slate (re-using cleaned entries)
# ----------------------------------------------------------------------------
OUT=$(node "$TOOLS" worktree gc --dry-run 2>&1)
EX=$?
assert_eq "gc-exit" "0" "$EX"

# ----------------------------------------------------------------------------
# CASE 9: adopt — happy path (manually created worktree, out-of-band)
# ----------------------------------------------------------------------------
REPO="$WORK/repo6"
make_repo "$REPO"
WT_DIR="$WORK/manual-worktrees"
mkdir -p "$WT_DIR"
git -C "$REPO" worktree add -q "$WT_DIR/manual-feat" -b feature/manual-feat

OUT=$(node "$TOOLS" worktree adopt "$REPO" manual-feat --worktree-path "$WT_DIR/manual-feat" 2>&1)
EX=$?
assert_eq "adopt-happy-exit" "0" "$EX"
if printf '%s' "$OUT" | grep -q '"status": "active"'; then
  results+=("PASS  adopt-happy-status-active")
  pass=$((pass + 1))
else
  results+=("FAIL  adopt-happy-status-active  got: $OUT")
  fail=$((fail + 1))
fi
if printf '%s' "$OUT" | grep -q '"adopted": true'; then
  results+=("PASS  adopt-happy-adopted-true")
  pass=$((pass + 1))
else
  results+=("FAIL  adopt-happy-adopted-true  got: $OUT")
  fail=$((fail + 1))
fi
ADOPT_ID=$(extract_field id "$OUT")

# ----------------------------------------------------------------------------
# CASE 10: adopt-then-exit-handoff (original incident scenario)
# ----------------------------------------------------------------------------
OUT=$(node "$TOOLS" worktree exit "$ADOPT_ID" --mode handoff 2>&1)
EX=$?
assert_eq "adopt-exit-handoff-exit" "0" "$EX"
S=$(extract_field status "$OUT")
assert_eq "adopt-exit-handoff-status" "handoff" "$S"

# ----------------------------------------------------------------------------
# CASE 11: adopt — duplicate refused (active entry already exists)
# ----------------------------------------------------------------------------
REPO="$WORK/repo7"
make_repo "$REPO"
WT_DIR2="$WORK/manual-worktrees2"
mkdir -p "$WT_DIR2"
git -C "$REPO" worktree add -q "$WT_DIR2/dup-feat" -b feature/dup-feat

node "$TOOLS" worktree adopt "$REPO" dup-feat --worktree-path "$WT_DIR2/dup-feat" >/dev/null 2>&1
OUT=$(node "$TOOLS" worktree adopt "$REPO" dup-feat --worktree-path "$WT_DIR2/dup-feat" 2>&1)
EX=$?
assert_eq "adopt-duplicate-refused-exit" "1" "$EX"
if printf '%s' "$OUT" | grep -q "active entry"; then
  results+=("PASS  adopt-duplicate-refused-msg")
  pass=$((pass + 1))
else
  results+=("FAIL  adopt-duplicate-refused-msg  got: $OUT")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 12: adopt — nonexistent worktree (no git worktree matches slug)
# ----------------------------------------------------------------------------
REPO="$WORK/repo8"
make_repo "$REPO"
OUT=$(node "$TOOLS" worktree adopt "$REPO" ghost-slug 2>&1)
EX=$?
assert_eq "adopt-nonexistent-exit" "1" "$EX"
if printf '%s' "$OUT" | grep -q "NOT_FOUND"; then
  results+=("PASS  adopt-nonexistent-not-found")
  pass=$((pass + 1))
else
  results+=("FAIL  adopt-nonexistent-not-found  got: $OUT")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 13: adopt — hostile inputs (invalid slug via traversal, oversized slug)
# ----------------------------------------------------------------------------
OUT=$(node "$TOOLS" worktree adopt "$REPO" '../evil' 2>&1)
EX=$?
assert_eq "adopt-hostile-traversal-slug-exit" "2" "$EX"

# Oversized slug: an all-lowercase 10000-char string still matches SLUG_RE
# (the regex has no length bound), so it correctly falls through to the
# normal "no git worktree matches" NOT_FOUND path (exit 1) rather than the
# invalid-slug path (exit 2). The hostile-input guarantee being tested here
# is "no hang, no crash" — assert exit in {1,2} and that it returns promptly.
LONG_SLUG=$(printf 'a%.0s' {1..10000})
OUT=$(node "$TOOLS" worktree adopt "$REPO" "$LONG_SLUG" 2>&1)
EX=$?
if [[ "$EX" == "1" || "$EX" == "2" ]]; then
  results+=("PASS  adopt-hostile-oversized-slug-exit  ($EX)")
  pass=$((pass + 1))
else
  results+=("FAIL  adopt-hostile-oversized-slug-exit  expected 1 or 2, got=$EX")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 14: reconcile — in-sync right after an adopt
# ----------------------------------------------------------------------------
REPO="$WORK/repo9"
make_repo "$REPO"
WT_DIR9="$WORK/manual-worktrees9"
mkdir -p "$WT_DIR9"
git -C "$REPO" worktree add -q "$WT_DIR9/sync-feat" -b feature/sync-feat
node "$TOOLS" worktree adopt "$REPO" sync-feat --worktree-path "$WT_DIR9/sync-feat" >/dev/null 2>&1

OUT=$(node "$TOOLS" worktree reconcile "$REPO" 2>&1)
EX=$?
assert_eq "reconcile-in-sync-exit" "0" "$EX"
if printf '%s' "$OUT" | grep -q '"in_sync": true'; then
  results+=("PASS  reconcile-in-sync-true")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-in-sync-true  got: $OUT")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 15: reconcile — detects unregistered git worktree as adopt candidate
# ----------------------------------------------------------------------------
WT_DIR10="$WORK/manual-worktrees10"
mkdir -p "$WT_DIR10"
git -C "$REPO" worktree add -q "$WT_DIR10/unadopted-feat" -b feature/unadopted-feat

REG_BEFORE_SUM=$(cksum "$A1_WORKTREE_REGISTRY" 2>/dev/null)
OUT=$(node "$TOOLS" worktree reconcile "$REPO" 2>&1)
EX=$?
REG_AFTER_SUM=$(cksum "$A1_WORKTREE_REGISTRY" 2>/dev/null)
assert_eq "reconcile-detects-candidate-exit" "0" "$EX"
if printf '%s' "$OUT" | grep -q "unadopted-feat"; then
  results+=("PASS  reconcile-detects-candidate-path")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-detects-candidate-path  got: $OUT")
  fail=$((fail + 1))
fi
if [[ "$REG_BEFORE_SUM" == "$REG_AFTER_SUM" ]]; then
  results+=("PASS  reconcile-detects-candidate-registry-unchanged")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-detects-candidate-registry-unchanged  registry file was mutated by a read-only reconcile")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 16: reconcile — detects stale registry entry (dry run, no --prune)
# ----------------------------------------------------------------------------
REPO="$WORK/repo10"
make_repo "$REPO"
WT_DIR11="$WORK/manual-worktrees11"
mkdir -p "$WT_DIR11"
git -C "$REPO" worktree add -q "$WT_DIR11/stale-feat" -b feature/stale-feat
ADOPT_OUT=$(node "$TOOLS" worktree adopt "$REPO" stale-feat --worktree-path "$WT_DIR11/stale-feat" 2>&1)
STALE_ID=$(extract_field id "$ADOPT_OUT")
git -C "$REPO" worktree remove --force "$WT_DIR11/stale-feat"

OUT=$(node "$TOOLS" worktree reconcile "$REPO" 2>&1)
EX=$?
assert_eq "reconcile-detects-stale-dry-exit" "0" "$EX"
if printf '%s' "$OUT" | grep -q "\"id\": \"$STALE_ID\""; then
  results+=("PASS  reconcile-detects-stale-dry-in-stale")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-detects-stale-dry-in-stale  got: $OUT")
  fail=$((fail + 1))
fi
if printf '%s' "$OUT" | grep -q '"pruned": \[\]'; then
  results+=("PASS  reconcile-detects-stale-dry-pruned-empty")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-detects-stale-dry-pruned-empty  got: $OUT")
  fail=$((fail + 1))
fi
STATUS_AFTER_DRY=$(node "$TOOLS" worktree list --status=active 2>&1 | grep -c "\"id\": \"$STALE_ID\"")
if [[ "$STATUS_AFTER_DRY" -ge 1 ]]; then
  results+=("PASS  reconcile-detects-stale-dry-entry-still-active")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-detects-stale-dry-entry-still-active  entry was mutated without --prune")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 17: reconcile --prune — same state, actually cleans the stale entry
# ----------------------------------------------------------------------------
OUT=$(node "$TOOLS" worktree reconcile "$REPO" --prune 2>&1)
EX=$?
assert_eq "reconcile-prune-exit" "0" "$EX"
if printf '%s' "$OUT" | tr -d '\n' | grep -q "\"pruned\": \[[^]]*$STALE_ID"; then
  results+=("PASS  reconcile-prune-pruned-contains-id")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-prune-pruned-contains-id  got: $OUT")
  fail=$((fail + 1))
fi
CLEANED_OUT=$(node "$TOOLS" worktree list --status=cleaned 2>&1)
if printf '%s' "$CLEANED_OUT" | grep -q "\"id\": \"$STALE_ID\""; then
  results+=("PASS  reconcile-prune-list-cleaned-shows-id")
  pass=$((pass + 1))
else
  results+=("FAIL  reconcile-prune-list-cleaned-shows-id  got: $CLEANED_OUT")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 18: reconcile — hostile inputs (nonexistent repo-root, missing arg)
# ----------------------------------------------------------------------------
OUT=$(node "$TOOLS" worktree reconcile "$WORK/does-not-exist-$$" 2>&1)
EX=$?
assert_eq "reconcile-hostile-nonexistent-repo-exit" "2" "$EX"

OUT=$(node "$TOOLS" worktree reconcile 2>&1)
EX=$?
assert_eq "reconcile-hostile-missing-arg-exit" "1" "$EX"

# ----------------------------------------------------------------------------
# CASE 19: enter mirrors the gitignored .a1/learnings/ store into the worktree
# ----------------------------------------------------------------------------
REPO="$WORK/repo11"
make_repo "$REPO"
echo ".a1/learnings/" >> "$REPO/.gitignore"
git -C "$REPO" add .gitignore
git -C "$REPO" -c commit.gpgsign=false commit -q -m "add gitignore"
mkdir -p "$REPO/.a1/learnings/project/demo-slug/spec"
echo "spec content" > "$REPO/.a1/learnings/project/demo-slug/spec/x.md"

OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-learnings 2>&1)
ID=$(extract_field id "$OUT")
OUT=$(node "$TOOLS" worktree enter "$ID" 2>&1)
EX=$?
assert_eq "learnings-mirror-enter-exit" "0" "$EX"

WT="$WORK/a1-worktrees/feat-learnings"
MIRRORED="$WT/.a1/learnings/project/demo-slug/spec/x.md"
if [[ -f "$MIRRORED" ]]; then
  results+=("PASS  learnings-mirror-file-exists")
  pass=$((pass + 1))
else
  results+=("FAIL  learnings-mirror-file-exists  $MIRRORED missing")
  fail=$((fail + 1))
fi
if diff -q "$REPO/.a1/learnings/project/demo-slug/spec/x.md" "$MIRRORED" >/dev/null 2>&1; then
  results+=("PASS  learnings-mirror-content-identical")
  pass=$((pass + 1))
else
  results+=("FAIL  learnings-mirror-content-identical  content differs")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 20: enter is a no-op (not a crash) when the repo has no learning store
# ----------------------------------------------------------------------------
REPO="$WORK/repo12"
make_repo "$REPO"

OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-nolearnings 2>&1)
ID=$(extract_field id "$OUT")
OUT=$(node "$TOOLS" worktree enter "$ID" 2>&1)
EX=$?
assert_eq "learnings-noop-enter-exit" "0" "$EX"
if [[ ! -d "$WORK/a1-worktrees/feat-nolearnings/.a1/learnings" ]]; then
  results+=("PASS  learnings-noop-no-dir-created")
  pass=$((pass + 1))
else
  results+=("FAIL  learnings-noop-no-dir-created  .a1/learnings unexpectedly present")
  fail=$((fail + 1))
fi

# ----------------------------------------------------------------------------
# CASE 21: re-entering an already-active worktree overwrites the mirror
# cleanly (idempotency) rather than crashing
# ----------------------------------------------------------------------------
REPO="$WORK/repo13"
make_repo "$REPO"
mkdir -p "$REPO/.a1/learnings/project/demo-slug/spec"
echo "v1" > "$REPO/.a1/learnings/project/demo-slug/spec/x.md"

OUT=$(node "$TOOLS" worktree prepare "$REPO" feat-idempotent 2>&1)
ID=$(extract_field id "$OUT")
node "$TOOLS" worktree enter "$ID" >/dev/null 2>&1

# Simulate a changed source file, then re-run the same mirroring logic
# directly (worktree enter itself refuses a non-"prepared" entry by design —
# the idempotency guarantee under test is copyDirRecursive's overwrite
# behavior, exercised the same way cmdWorktreeEnter invokes it).
echo "v2" > "$REPO/.a1/learnings/project/demo-slug/spec/x.md"
node -e "
const { copyDirRecursive } = require('$REPO_ROOT/_shared/lib/io.cjs');
copyDirRecursive('$REPO/.a1/learnings', '$WORK/a1-worktrees/feat-idempotent/.a1/learnings');
"
EX=$?
assert_eq "learnings-idempotent-rerun-exit" "0" "$EX"
CONTENT=$(cat "$WORK/a1-worktrees/feat-idempotent/.a1/learnings/project/demo-slug/spec/x.md")
assert_eq "learnings-idempotent-overwritten" "v2" "$CONTENT"

# ----------------------------------------------------------------------------
# CASE 22: two repos in one parent folder, same slug, same minute (bug
# 2026-10-12 worktree-slug-collision). RED-making change: dropping the
# disambiguation in cmdWorktreePrepare (id and path back to <stamp>-<slug>
# and <parent>/a1-worktrees/<slug> for every repo).
# ----------------------------------------------------------------------------
PAR="$WORK/collide-par"
make_repo "$PAR/repoA"
make_repo "$PAR/repoB"
SLUG="same-slug"
OUT_A=$(node "$TOOLS" worktree prepare "$PAR/repoA" "$SLUG" 2>&1)
assert_eq "collide-prepare-a-exit" "0" "$?"
OUT_B=$(node "$TOOLS" worktree prepare "$PAR/repoB" "$SLUG" 2>&1)
assert_eq "collide-prepare-b-exit" "0" "$?"
ID_A=$(extract_field id "$OUT_A")
ID_B=$(extract_field id "$OUT_B")
PATH_A=$(extract_field worktree_path "$OUT_A")
PATH_B=$(extract_field worktree_path "$OUT_B")
if [[ -n "$ID_A" && "$ID_A" != "$ID_B" ]]; then D=distinct; else D="same:$ID_A|$ID_B"; fi
assert_eq "collide-ids-distinct" "distinct" "$D"
if [[ -n "$PATH_A" && "$PATH_A" != "$PATH_B" ]]; then D=distinct; else D="same:$PATH_A|$PATH_B"; fi
assert_eq "collide-paths-distinct" "distinct" "$D"
# count-assert next to the match-asserts: two entries, two unique ids, two unique paths
COUNTS=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY, "utf8"));
const e = r.worktrees.filter((w) => w.slug === process.argv[1] && w.repo_root.includes("collide-par"));
console.log([e.length, new Set(e.map((w) => w.id)).size, new Set(e.map((w) => w.worktree_path)).size].join("/"));
' "$SLUG")
assert_eq "collide-registry-counts-entries-ids-paths" "2/2/2" "$COUNTS"
# first repo is not the one that got renamed (first prepare keeps today's names)
assert_eq "collide-first-path-unchanged" "$PAR/a1-worktrees/$SLUG" "$PATH_A"
assert_eq "collide-second-path-has-repo-prefix" "$PAR/a1-worktrees/repob-$SLUG" "$PATH_B"
# enter by id resolves to the right repo
node "$TOOLS" worktree enter "$ID_B" >/dev/null 2>&1
assert_eq "collide-enter-b-exit" "0" "$?"
STATES=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY, "utf8"));
const e = r.worktrees.filter((w) => w.slug === process.argv[1] && w.repo_root.includes("collide-par"));
console.log(e.map((w) => w.repo_root.split("/").pop() + "=" + w.status).sort().join(","));
' "$SLUG")
assert_eq "collide-enter-b-only-b-active" "repoA=prepared,repoB=active" "$STATES"
BR_B=$(git -C "$PAR/repoB" branch --list "feature/$SLUG" | wc -l | tr -d ' ')
BR_A=$(git -C "$PAR/repoA" branch --list "feature/$SLUG" | wc -l | tr -d ' ')
assert_eq "collide-branch-only-in-b" "1/0" "$BR_B/$BR_A"
# slug lookup is ambiguous across repos -> "pass id instead"
node "$TOOLS" worktree enter "$SLUG" >/dev/null 2>&1
assert_eq "collide-enter-by-ambiguous-slug-rejected" "1" "$?"
# same repo + same slug stays the BLOCKER
node "$TOOLS" worktree prepare "$PAR/repoA" "$SLUG" >/dev/null 2>&1
assert_eq "collide-same-repo-same-slug-blocker" "1" "$?"

# ----------------------------------------------------------------------------
# CASE 23: two repos adopt the same slug in the same minute. RED-making change:
# `const id = nowCompactId(slug);` back in cmdWorktreeAdopt (no disambiguation).
# ----------------------------------------------------------------------------
PAR2="$WORK/adopt-par"
make_repo "$PAR2/repoA"
make_repo "$PAR2/repoB"
ASLUG="adopt-same"
for R in repoA repoB; do
  mkdir -p "$PAR2/wt-$R"
  git -C "$PAR2/$R" worktree add -q -b "manual/$ASLUG" "$PAR2/wt-$R/$ASLUG" main >/dev/null 2>&1
done
OUT_A=$(node "$TOOLS" worktree adopt "$PAR2/repoA" "$ASLUG" --worktree-path "$PAR2/wt-repoA/$ASLUG" 2>&1)
assert_eq "adopt-collide-a-exit" "0" "$?"
OUT_B=$(node "$TOOLS" worktree adopt "$PAR2/repoB" "$ASLUG" --worktree-path "$PAR2/wt-repoB/$ASLUG" 2>&1)
assert_eq "adopt-collide-b-exit" "0" "$?"
AID_A=$(extract_field id "$OUT_A")
AID_B=$(extract_field id "$OUT_B")
if [[ -n "$AID_A" && "$AID_A" != "$AID_B" ]]; then D=distinct; else D="same:$AID_A|$AID_B"; fi
assert_eq "adopt-collide-ids-distinct" "distinct" "$D"
case "$AID_B" in *-repob) D=suffixed ;; *) D="no-suffix:$AID_B" ;; esac
assert_eq "adopt-collide-second-id-has-repo-suffix" "suffixed" "$D"
ACOUNTS=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY, "utf8"));
const e = r.worktrees.filter((w) => w.slug === process.argv[1] && w.repo_root.includes("adopt-par"));
console.log([e.length, new Set(e.map((w) => w.id)).size].join("/"));
' "$ASLUG")
assert_eq "adopt-collide-registry-counts-entries-ids" "2/2" "$ACOUNTS"
node "$TOOLS" worktree exit "$AID_B" --mode handoff >/dev/null 2>&1
ASTATES=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY, "utf8"));
const e = r.worktrees.filter((w) => w.slug === process.argv[1] && w.repo_root.includes("adopt-par"));
console.log(e.map((w) => w.repo_root.split("/").pop() + "=" + w.status).sort().join(","));
' "$ASLUG")
assert_eq "adopt-collide-exit-by-id-hits-b-only" "repoA=active,repoB=handoff" "$ASTATES"

# ----------------------------------------------------------------------------
# Report
# ----------------------------------------------------------------------------
echo ""
for line in "${results[@]}"; do echo "$line"; done
echo ""
echo "Summary: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
