#!/usr/bin/env bash
# Scenario suite for `a1-tools realpath-check run` (Gate 0.7).
# Builds throwaway git repos in mktemp dirs. Scenarios a-f below, plus (g) sql shape regressions:
#   (a) diff without surfaces          -> 0
#   (b) SQL in diff + valid evidence   -> 0
#   (c) SQL in diff + mock-only evid.  -> 1
#   (d) SQL in diff + missing evidence -> 1
#   (e) no git repo                    -> 2
set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

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
  mk_workdir repo repo
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
mk_workdir NOGIT nogit
OUT="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$NOGIT" 2>&1)"
assert_rc "e-no-git" 2 $? "$OUT"

# --- (f) spec 017 FR-008: the gate call appends one hash-chained log line ---
# Measured red 2026-10-20 (git-archive snapshot): gate-log.cjs recordRun() not called -> (f) fails
# (no log file); verdictForExit() 1 -> pass -> (f2) fails.
mk_workdir LOGW realpath-log
cp -R "$REPO_D/." "$LOGW/" # a complete git repo (two commits) with the SQL diff and no evidence file
OUT="$(cd "$LOGW" && node "$TOOLS" realpath-check run --phase w1 --diff-base HEAD~1 --project . 2>&1)"
RC=$?
LINE="$(cat "$LOGW/.a1/phases/w1/gate-log.jsonl" 2>/dev/null)"
GOT="$(node -e 'const r=JSON.parse(process.argv[1]); process.stdout.write([r.gate,r.verdict,r.exit,r.scope].join("|"))' "$LINE" 2>&1)"
if [[ $RC -eq 1 && "$GOT" == "gate-0.7-realpath|fail|1|w1" && "$(printf '%s\n' "$LINE" | wc -l | tr -d ' ')" == "1" ]]; then
  echo "PASS  f-gate-log-line (one line: gate-0.7-realpath, fail, exit 1, scope w1)"; pass=$((pass + 1))
else
  echo "FAIL  f-gate-log-line (rc=$RC got=$GOT out=$OUT)"; fail=$((fail + 1))
fi

# --- (g) sql shape regressions (bug 2026-11-08-realpath-sql-prose-false-positive) ---
# Real exported scanner, real git diffs. Prose must not need evidence; real SQL must.
# base: committed first (may be empty); body: the HEAD version of <file>.
expect_scan() {
  local name="$1" want="$2" file="$3" base="$4" body="$5" repo
  mk_workdir repo scan
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t.dev
  git -C "$repo" config user.name test
  mkdir -p "$repo/$(dirname "$file")"
  printf '%s\n' "${base:-seed}" > "$repo/$file"
  git -C "$repo" add -A && git -C "$repo" commit -qm base
  printf '%s\n' "$body" > "$repo/$file"
  git -C "$repo" add -A && git -C "$repo" commit -qm feat
  local out
  out="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$repo" 2>&1)"
  assert_rc "g-$name" "$want" $? "$out"
}
export -n A1_VAULT_ROOT 2>/dev/null; unset A1_VAULT_ROOT

# prose: exit 0
expect_scan prose-hash-comment 0 t.sh "" '  # Re-insert the defect'
expect_scan prose-echo 0 t.sh "" 'echo "Re-insert the defect"'
expect_scan prose-map-delete 0 a.js "" 'map.delete(k);'
expect_scan prose-js-delete 0 a.js "" 'delete obj.x;'
expect_scan prose-update-status 0 a.js "" 'run update-status and delete-branch'
expect_scan prose-jsx-select 0 a.tsx "" '<select id="x"><option>a</option></select>'
expect_scan prose-line-comment 0 a.js "" '// update the cache, then delete stale entries'
expect_scan prose-string 0 a.js "" 'const m = "Select a project to continue";'
expect_scan prose-comment-with-shape 0 a.js "" '// INSERT INTO users is slow here'
expect_scan prose-trailing-comment-shape 0 a.js "" 'const n = 1; // SELECT id FROM users is mentioned'
expect_scan prose-hash-comment-shape 0 t.sh "" '# DELETE FROM sessions is the old way'
# real SQL: exit 1
expect_scan sql-window-only 1 a.py "" $'rows = run(\n  select id,\n    name\n  from users'
expect_scan sql-lower-template 1 a.ts "" 'const r = await db.query(`select * from users where id=$1`, [id]);'
expect_scan sql-lower-template-bare 1 a.ts "" 'const r = await sql`select * from users where id=$1`;'
expect_scan sql-multiline-literal 1 a.ts "" $'const q = `\n  SELECT id, name\n  FROM api.users\n  WHERE id = $1`;'
expect_scan sql-continuation-only 1 a.ts $'const q = `\n  SELECT id FROM t\n`;' $'const q = `\n  SELECT id FROM t\n  WHERE due_at < $1\n`;'
expect_scan sql-file-continuation 1 m.sql $'select id\nfrom t' $'select id\nfrom t\n   and due_at < now()'
expect_scan sql-postgrest-chain 1 a.ts "" "await supabase.from('todos').insert({ title });"
expect_scan sql-rpc 1 a.ts "" "const { data } = await supabase.rpc('get_stats', { p });"

echo "realpath-check fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
