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

WORK=$(cd "$(mktemp -d)" && pwd -P)   # real path: repo roots are stored as real paths (macOS /var -> /private/var)
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
# Collision cases (bug 2026-10-12 worktree-slug-collision + review hardening).
# The clock is pinned with A1_NOW_OVERRIDE, so no case depends on the minute
# boundary. Red-making changes are named per case below.
# ----------------------------------------------------------------------------
T0="2026-10-12T10:00:00Z"
T1="2026-10-12T10:05:00Z"
STAMP0="20261012-1000"

repo_hash() {
  # independent of the code under test: sha1 of the real repo path, 6 hex
  node -e 'const c=require("crypto"),fs=require("fs");
    console.log(c.createHash("sha1").update(fs.realpathSync(process.argv[1])).digest("hex").slice(0,6));' "$1"
}

# reg_stat <mode> <slug> <marker>: mode counts -> entries/uniq-ids/uniq-paths,
# mode states -> sorted "<repo-folder>=<status>" list. Filters on slug + repo_root marker.
reg_stat() {
  node -e '
const [mode, slug, marker] = process.argv.slice(1);
const r = JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY, "utf8"));
const e = r.worktrees.filter((w) => w.slug === slug && w.repo_root.includes(marker));
if (mode === "counts") console.log([e.length, new Set(e.map((w) => w.id)).size, new Set(e.map((w) => w.worktree_path)).size].join("/"));
else console.log(e.map((w) => w.repo_root.split("/").pop() + "=" + w.status).sort().join(","));
' "$@"
}

prep_at() {
  # prep_at <clock> <repo> <slug> -> JSON on stdout
  A1_NOW_OVERRIDE="$1" node "$TOOLS" worktree prepare "$2" "$3" 2>&1
}

# ---- CASE 22: same parent, same slug, same minute -> both collide (id + path)
# RED-making change: dropping disambiguation in cmdWorktreePrepare.
PAR="$WORK/collide-par"
make_repo "$PAR/repoA"
make_repo "$PAR/repoB"
SLUG="same-slug"
OUT_A=$(prep_at "$T0" "$PAR/repoA" "$SLUG"); assert_eq "collide-prepare-a-exit" "0" "$?"
OUT_B=$(prep_at "$T0" "$PAR/repoB" "$SLUG"); assert_eq "collide-prepare-b-exit" "0" "$?"
ID_A=$(extract_field id "$OUT_A"); ID_B=$(extract_field id "$OUT_B")
PATH_A=$(extract_field worktree_path "$OUT_A"); PATH_B=$(extract_field worktree_path "$OUT_B")
HB=$(repo_hash "$PAR/repoB")
assert_eq "collide-first-id-unchanged" "$STAMP0-$SLUG" "$ID_A"
assert_eq "collide-first-path-unchanged" "$PAR/a1-worktrees/$SLUG" "$PATH_A"
assert_eq "collide-second-id-suffixed" "$STAMP0-$SLUG-repob-$HB" "$ID_B"
assert_eq "collide-second-path-prefixed" "$PAR/a1-worktrees/repob-$HB-$SLUG" "$PATH_B"
assert_eq "collide-registry-counts-entries-ids-paths" "2/2/2" "$(reg_stat counts "$SLUG" collide-par)"
node "$TOOLS" worktree enter "$ID_B" >/dev/null 2>&1
assert_eq "collide-enter-b-exit" "0" "$?"
assert_eq "collide-enter-b-only-b-active" "repoA=prepared,repoB=active" "$(reg_stat states "$SLUG" collide-par)"
BR_B=$(git -C "$PAR/repoB" branch --list "feature/$SLUG" | wc -l | tr -d ' ')
BR_A=$(git -C "$PAR/repoA" branch --list "feature/$SLUG" | wc -l | tr -d ' ')
assert_eq "collide-branch-only-in-b" "1/0" "$BR_B/$BR_A"
node "$TOOLS" worktree enter "$SLUG" >/dev/null 2>&1
assert_eq "collide-enter-by-slug-rejected" "1" "$?"
node "$TOOLS" worktree prepare "$PAR/repoA" "$SLUG" >/dev/null 2>&1
assert_eq "collide-same-repo-same-slug-blocker" "1" "$?"

# ---- CASE 23: adopt, same slug, same minute -> id suffixed with name+hash
# RED-making change: `const id = nowCompactId(slug);` back in cmdWorktreeAdopt.
PAR2="$WORK/adopt-par"
make_repo "$PAR2/repoA"
make_repo "$PAR2/repoB"
ASLUG="adopt-same"
for R in repoA repoB; do
  mkdir -p "$PAR2/wt-$R"
  git -C "$PAR2/$R" worktree add -q -b "manual/$ASLUG" "$PAR2/wt-$R/$ASLUG" main >/dev/null 2>&1
done
OUT_A=$(A1_NOW_OVERRIDE="$T0" node "$TOOLS" worktree adopt "$PAR2/repoA" "$ASLUG" --worktree-path "$PAR2/wt-repoA/$ASLUG" 2>&1)
assert_eq "adopt-collide-a-exit" "0" "$?"
OUT_B=$(A1_NOW_OVERRIDE="$T0" node "$TOOLS" worktree adopt "$PAR2/repoB" "$ASLUG" --worktree-path "$PAR2/wt-repoB/$ASLUG" 2>&1)
assert_eq "adopt-collide-b-exit" "0" "$?"
AID_A=$(extract_field id "$OUT_A"); AID_B=$(extract_field id "$OUT_B")
HB2=$(repo_hash "$PAR2/repoB")
assert_eq "adopt-collide-first-id-unchanged" "$STAMP0-$ASLUG" "$AID_A"
assert_eq "adopt-collide-second-id-suffixed" "$STAMP0-$ASLUG-repob-$HB2" "$AID_B"
assert_eq "adopt-collide-registry-counts-entries-ids" "2/2" "$(reg_stat counts "$ASLUG" adopt-par | cut -d/ -f1,2)"
node "$TOOLS" worktree exit "$AID_B" --mode handoff >/dev/null 2>&1
assert_eq "adopt-collide-exit-by-id-hits-b-only" "repoA=active,repoB=handoff" "$(reg_stat states "$ASLUG" adopt-par)"

# ---- CASE 24: id and path decided separately
# RED-making change: one shared "collides" flag that renames both (as before review).
# 24a path only: same parent, different minute -> id unchanged, path prefixed.
P3="$WORK/sep-par"; make_repo "$P3/repoA"; make_repo "$P3/repoB"
OUT_A=$(prep_at "$T0" "$P3/repoA" sep-path); OUT_B=$(prep_at "$T1" "$P3/repoB" sep-path)
assert_eq "sep-path-only-id-unchanged" "20261012-1005-sep-path" "$(extract_field id "$OUT_B")"
assert_eq "sep-path-only-path-prefixed" "$P3/a1-worktrees/repob-$(repo_hash "$P3/repoB")-sep-path" "$(extract_field worktree_path "$OUT_B")"
assert_eq "sep-path-only-counts" "2/2/2" "$(reg_stat counts sep-path sep-par)"
# 24b id only: different parents, same minute -> id suffixed, path unchanged.
P4="$WORK/sep-par-1"; P5="$WORK/sep-par-2"; make_repo "$P4/repo"; make_repo "$P5/repo"
OUT_A=$(prep_at "$T0" "$P4/repo" sep-id); OUT_B=$(prep_at "$T0" "$P5/repo" sep-id)
assert_eq "sep-id-only-id-suffixed" "$STAMP0-sep-id-repo-$(repo_hash "$P5/repo")" "$(extract_field id "$OUT_B")"
assert_eq "sep-id-only-path-unchanged" "$P5/a1-worktrees/sep-id" "$(extract_field worktree_path "$OUT_B")"
assert_eq "sep-id-only-counts" "2/2/2" "$(reg_stat counts sep-id sep-par-)"

# ---- CASE 25: hostile and edge repo folder names (CONVENTIONS: hostile inputs)
# RED-making change: kebabSafe/tag reverting to the raw basename (no length cap,
# no hash) -> 25a-25c wrong; spawning a shell with the name -> 25c canary appears.
edge_case() {
  # edge_case <label> <folder-name> <slug>: plain repo "base" first (takes the
  # names), then the odd-named repo collides with it in the same parent.
  local label="$1" name="$2" slug="$3" par="$WORK/edge-$1"
  make_repo "$par/base"; make_repo "$par/$name"
  prep_at "$T0" "$par/base" "$slug" >/dev/null
  EDGE_OUT=$(cd "$WORK/canary-cwd" && A1_NOW_OVERRIDE="$T0" node "$TOOLS" worktree prepare "$par/$name" "$slug" 2>&1)
  EDGE_RC=$?
  EDGE_PAR="$par"; EDGE_NAME="$name"
}
mkdir -p "$WORK/canary-cwd"
# 25a non-ASCII only
edge_case ascii "日本語" edge-a
assert_eq "edge-nonascii-exit" "0" "$EDGE_RC"
assert_eq "edge-nonascii-path" "$EDGE_PAR/a1-worktrees/repo-$(repo_hash "$EDGE_PAR/$EDGE_NAME")-edge-a" "$(extract_field worktree_path "$EDGE_OUT")"
assert_eq "edge-nonascii-counts" "2/2/2" "$(reg_stat counts edge-a edge-ascii)"
# 25b >= 200 chars
LONG=$(printf 'n%.0s' $(seq 1 220))
edge_case long "$LONG" edge-b
assert_eq "edge-long-exit" "0" "$EDGE_RC"
LP=$(extract_field worktree_path "$EDGE_OUT")
assert_eq "edge-long-path-basename-under-255" "ok" "$([[ ${#LP} -gt 0 && $(basename "$LP" | tr -d "\n" | wc -c) -lt 255 ]] && echo ok || echo bad)"
assert_eq "edge-long-path-capped-name" "$EDGE_PAR/a1-worktrees/$(printf 'n%.0s' $(seq 1 40))-$(repo_hash "$EDGE_PAR/$LONG")-edge-b" "$LP"
assert_eq "edge-long-counts" "2/2/2" "$(reg_stat counts edge-b edge-long)"
# 25c shell metacharacters: inert, canary never created
META='x$(touch canary-file);`touch canary-file`'
edge_case meta "$META" edge-c
assert_eq "edge-meta-exit" "0" "$EDGE_RC"
assert_eq "edge-meta-path-is-inert-kebab" "$EDGE_PAR/a1-worktrees/x-touch-canary-file-touch-canary-file-$(repo_hash "$EDGE_PAR/$META")-edge-c" "$(extract_field worktree_path "$EDGE_OUT")"
assert_eq "edge-meta-canary-absent" "absent" "$([[ -e "$WORK/canary-cwd/canary-file" || -e "$EDGE_PAR/canary-file" ]] && echo present || echo absent)"
assert_eq "edge-meta-counts" "2/2/2" "$(reg_stat counts edge-c edge-meta)"
# 25d name+slug fit in 255 bytes even for a slug at the 200-byte cap (prefix is cut, slug never)
LSLUG=$(printf 's%.0s' $(seq 1 200))
edge_case lslug "$LONG" "$LSLUG"
LP=$(extract_field worktree_path "$EDGE_OUT")
assert_eq "edge-longslug-basename-under-255" "ok" "$([[ ${#LP} -gt 0 && $(basename "$LP" | tr -d "\n" | wc -c) -lt 255 ]] && echo ok || echo bad)"
assert_eq "edge-longslug-slug-intact" "ok" "$([[ "$LP" == *"-$LSLUG" ]] && echo ok || echo bad)"

# ---- CASE 26: sibling-slug re-collision and the final re-check
# RED-making change: tag without the hash (old basename-only prefix) -> 26a
# yields two equal paths; dropping the re-check -> 26b writes a duplicate.
P6="$WORK/sib-par"; make_repo "$P6/repoA"; make_repo "$P6/repoB"; make_repo "$P6/repoC"
prep_at "$T0" "$P6/repoA" repob-s >/dev/null
prep_at "$T0" "$P6/repoC" s >/dev/null
OUT_B=$(prep_at "$T0" "$P6/repoB" s); assert_eq "sibling-exit" "0" "$?"
SIB=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.env.A1_WORKTREE_REGISTRY, "utf8"));
const e = r.worktrees.filter((w) => w.repo_root.includes("sib-par"));
console.log([e.length, new Set(e.map((w) => w.id)).size, new Set(e.map((w) => w.worktree_path)).size].join("/"));')
assert_eq "sibling-counts-3-entries-3-ids-3-paths" "3/3/3" "$SIB"
# 26b: a foreign entry already sits on the prefixed path and id -> BLOCKER, no write
P7="$WORK/block-par"; make_repo "$P7/repoA"; make_repo "$P7/repoB"
prep_at "$T0" "$P7/repoA" blk >/dev/null
H7=$(repo_hash "$P7/repoB")
node -e '
const fs = require("fs"); const p = process.env.A1_WORKTREE_REGISTRY;
const r = JSON.parse(fs.readFileSync(p, "utf8"));
const [par, h] = process.argv.slice(1);
r.worktrees.push({ id: "20261012-1000-blk-repob-" + h, slug: "blk", repo_root: "/elsewhere/other", worktree_path: par + "/a1-worktrees/repob-" + h + "-blk", branch: "x", base_branch: "main", status: "prepared", phase_history: [] });
fs.writeFileSync(p, JSON.stringify(r));' "$P7" "$H7"
BEFORE=$(reg_stat counts blk "")
OUT_B=$(prep_at "$T0" "$P7/repoB" blk); RC=$?
assert_eq "recheck-blocker-exit" "1" "$RC"
assert_eq "recheck-blocker-reports-path-free" "yes" "$(printf '%s' "$OUT_B" | grep -q '"worktree_path_free"' && printf '%s' "$OUT_B" | grep -q '"BLOCKER"' && echo yes || echo no)"
assert_eq "recheck-blocker-reports-id-unique" "yes" "$(printf '%s' "$OUT_B" | grep -q '"id_unique"' && echo yes || echo no)"
assert_eq "recheck-blocker-wrote-nothing" "$BEFORE" "$(reg_stat counts blk "")"

# ---- CASE 27: A1_NOW_OVERRIDE is honoured and an invalid value is rejected
assert_eq "clock-override-used" "20261012-1005" "$(extract_field id "$(prep_at "$T1" "$P3/repoA" clock-x)" | cut -c1-13)"
A1_NOW_OVERRIDE="not-a-date" node "$TOOLS" worktree prepare "$P3/repoA" clock-bad >/dev/null 2>&1
assert_eq "clock-override-invalid-rejected" "1" "$([[ $? -ne 0 ]] && echo 1 || echo 0)"

# ---- CASE 28: slug length cap (follow-up: 249+ byte slug overflowed 255 bytes when prefixed)
# RED-making change: drop the SLUG_MAX_BYTES check -> 28a no longer exits 2.
P8="$WORK/long-par"; make_repo "$P8/repoA"; make_repo "$P8/repoB"
LONG249=$(printf 'a%.0s' $(seq 1 249))
prep_at "$T0" "$P8/repoA" "$LONG249" >/dev/null; RC=$?
assert_eq "long-slug-249-rejected-exit" "2" "$RC"
LONG200=$(printf 'a%.0s' $(seq 1 200))
prep_at "$T0" "$P8/repoA" "$LONG200" >/dev/null
OUT_B=$(prep_at "$T0" "$P8/repoB" "$LONG200"); assert_eq "long-slug-200-collision-exit" "0" "$?"
FOLDER=$(extract_field worktree_path "$OUT_B"); FOLDER=${FOLDER##*/}
assert_eq "long-slug-200-folder-under-255-bytes" "yes" "$([[ ${#FOLDER} -le 254 ]] && echo yes || echo no)"
assert_eq "long-slug-200-folder-has-repo-tag" "yes" "$([[ "$FOLDER" == repob-* ]] && echo yes || echo no)"
node "$TOOLS" worktree adopt "$P8/repoA" "$LONG249" >/dev/null 2>&1; assert_eq "long-slug-adopt-rejected-exit" "2" "$?"

# ---- CASE 29: symlinked repo root is the same repo (follow-up, pre-existing gap)
# RED-making change: path.resolve instead of resolveRealOrAbs in prepare -> repo_root keeps the link.
P9="$WORK/sym-par"; make_repo "$P9/real"; ln -s "$P9/real" "$P9/link"
OUT_L=$(prep_at "$T0" "$P9/link" symslug); assert_eq "symlink-prepare-exit" "0" "$?"
REAL9=$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$P9/real")
assert_eq "symlink-repo-root-is-real" "$REAL9" "$(extract_field repo_root "$OUT_L")"
assert_eq "symlink-worktree-dir-next-to-real-repo" "$(dirname "$REAL9")/a1-worktrees/symslug" "$(extract_field worktree_path "$OUT_L")"
prep_at "$T0" "$P9/real" symslug >/dev/null; assert_eq "symlink-then-real-duplicate-refused-exit" "1" "$?"

# ---- CASE 30: id unique across cleaned and same-repo entries; adopt re-checks (follow-up)
# RED-making change: holdsId back to "other repo, not cleaned" -> registry holds two equal ids.
P10="$WORK/id-par"; make_repo "$P10/repoA"
OUT_1=$(prep_at "$T0" "$P10/repoA" again); ID1=$(extract_field id "$OUT_1")
node "$TOOLS" worktree exit "$ID1" --mode discard >/dev/null 2>&1
OUT_2=$(prep_at "$T0" "$P10/repoA" again); assert_eq "reprepare-same-minute-exit" "0" "$?"
ID2=$(extract_field id "$OUT_2")
assert_eq "reprepare-id-differs-from-cleaned" "yes" "$([[ -n "$ID2" && "$ID1" != "$ID2" ]] && echo yes || echo no)"
node "$TOOLS" worktree enter "$ID2" >/dev/null 2>&1; assert_eq "reprepare-enter-new-id-exit" "0" "$?"
node "$TOOLS" worktree exit "$ID2" --mode discard >/dev/null 2>&1
BEFORE=$(reg_stat counts again "")
OUT_3=$(prep_at "$T0" "$P10/repoA" again); RC=$?
assert_eq "reprepare-third-same-minute-blocker-exit" "1" "$RC"
assert_eq "reprepare-third-reports-id-unique" "yes" "$(printf '%s' "$OUT_3" | grep -q '"id_unique"' && echo yes || echo no)"
assert_eq "reprepare-third-wrote-nothing" "$BEFORE" "$(reg_stat counts again "")"
# adopt: the id it would use is held by a cleaned entry -> suffixed, not duplicated
P11="$WORK/adopt-id-par"; make_repo "$P11/repoA"
OUT_1=$(prep_at "$T0" "$P11/repoA" adp); ID1=$(extract_field id "$OUT_1")
node "$TOOLS" worktree exit "$ID1" --mode discard >/dev/null 2>&1
git -C "$P11/repoA" worktree add -q "$P11/wt-adp" -b feature/adp-manual
OUT_A=$(A1_NOW_OVERRIDE="$T0" node "$TOOLS" worktree adopt "$P11/repoA" adp --worktree-path "$P11/wt-adp" 2>&1); assert_eq "adopt-over-cleaned-id-exit" "0" "$?"
assert_eq "adopt-over-cleaned-id-differs" "yes" "$([[ "$(extract_field id "$OUT_A")" != "$ID1" ]] && echo yes || echo no)"
assert_eq "adopt-over-cleaned-id-unique-ids" "2/2" "$(reg_stat counts adp "" | cut -d/ -f1-2)"

# ---- CASE 31: invalid A1_NOW_OVERRIDE is a usage error, not an internal error (follow-up)
# RED-making change: drop e.code = 'A1_INPUT' -> output starts with "internal error:".
OUT=$(A1_NOW_OVERRIDE="garbage" node "$TOOLS" worktree prepare "$P3/repoA" clock-bad2 2>&1)
assert_eq "clock-override-invalid-prefix" "error: invalid A1_NOW_OVERRIDE: garbage" "$OUT"

# ----------------------------------------------------------------------------
# Report
# ----------------------------------------------------------------------------
echo ""
for line in "${results[@]}"; do echo "$line"; done
echo ""
echo "Summary: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
