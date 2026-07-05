#!/usr/bin/env bash
# Scenario suite for `a1-tools realpath-check run` (Gate 0.7).
# Builds throwaway git repos in mktemp dirs. 5 scenarios:
#   (a) diff without surfaces          -> 0
#   (b) SQL in diff + valid evidence   -> 0
#   (c) SQL in diff + mock-only evid.  -> 1
#   (d) SQL in diff + missing evidence -> 1
#   (e) no git repo                    -> 2
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

# Build a git repo whose HEAD adds one file; base is the previous commit.
# Usage: make_repo <added-file-relpath> <added-file-content>
make_repo() {
  local relpath="$1" content="$2"
  local repo
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t.dev
  git -C "$repo" config user.name test
  echo "seed" > "$repo/seed.txt"
  git -C "$repo" add -A && git -C "$repo" commit -qm base
  mkdir -p "$repo/$(dirname "$relpath")"
  printf '%s\n' "$content" > "$repo/$relpath"
  git -C "$repo" add -A && git -C "$repo" commit -qm feat
  echo "$repo"
}

# --- (a) diff without surfaces -> 0 ---
REPO_A="$(make_repo "src/util.js" "export const add = (a, b) => a + b;")"
OUT="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$REPO_A" 2>&1)"
assert_rc "a-no-surfaces" 0 $? "$OUT"

# --- (b) SQL in diff + valid evidence -> 0 ---
REPO_B="$(make_repo "src/db.js" "export const q = () => db.query('SELECT * FROM users');")"
mkdir -p "$REPO_B/.a1"
cat > "$REPO_B/.a1/realpath-evidence.md" <<'EVID'
# Real-path evidence

## sql
Ran the query against the real Postgres test DB:

```
$ psql $TEST_DATABASE_URL -c "SELECT * FROM users LIMIT 1"
Connected to postgresql://localhost/app_test
 id | name
----+------
(0 rows)
```
EVID
OUT="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$REPO_B" 2>&1)"
assert_rc "b-sql-valid-evidence" 0 $? "$OUT"

# --- (c) SQL in diff + evidence with ONLY mock markers -> 1 ---
REPO_C="$(make_repo "src/db.js" "export const q = () => db.query('INSERT INTO users VALUES (1)');")"
mkdir -p "$REPO_C/.a1"
cat > "$REPO_C/.a1/realpath-evidence.md" <<'EVID'
# Evidence

## sql
```
$ npm test
vi.mock('../db')
createMock() returned rows
```
EVID
OUT="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$REPO_C" 2>&1)"
assert_rc "c-sql-mock-only" 1 $? "$OUT"

# --- (d) SQL in diff + missing evidence file -> 1 ---
REPO_D="$(make_repo "src/db.js" "export const q = () => db.query('UPDATE users SET x=1');")"
OUT="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$REPO_D" 2>&1)"
assert_rc "d-missing-evidence" 1 $? "$OUT"

# --- (e) no git repo -> 2 ---
NOGIT="$(mktemp -d)"
OUT="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$NOGIT" 2>&1)"
assert_rc "e-no-git" 2 $? "$OUT"

echo "realpath-check fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
