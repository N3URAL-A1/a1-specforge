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
# Report
# ----------------------------------------------------------------------------
echo ""
for line in "${results[@]}"; do echo "$line"; done
echo ""
echo "Summary: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
