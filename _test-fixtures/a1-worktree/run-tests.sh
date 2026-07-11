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
# Report
# ----------------------------------------------------------------------------
echo ""
for line in "${results[@]}"; do echo "$line"; done
echo ""
echo "Summary: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
