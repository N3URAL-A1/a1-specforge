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
# Cases drive the CLI on real git repos. Prose must not need evidence; real SQL must.
# want=1 cases also assert surfaces == ["sql"] (--json), so rls/http cannot carry them.
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
  scan_repo "$name" "$want" "$repo"
}
# Run the gate on a prepared repo (HEAD~1 = base). want=1 additionally pins surfaces == ["sql"].
scan_repo() {
  local name="$1" want="$2" repo="$3" out rc surf
  out="$(node "$TOOLS" realpath-check run --diff-base HEAD~1 --project "$repo" --json 2>/dev/null)"
  rc=$?
  if [[ "$want" -eq 1 && $rc -eq 1 ]]; then
    surf="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).surfaces.join(","))' "$out" 2>&1)"
    [[ "$surf" == "sql" ]] || { rc=99; out="surfaces=$surf :: $out"; }
  fi
  assert_rc "g-$name" "$want" "$rc" "$out"
}
# Multi-file repo: scan_files <name> <want> then "path|base|body" triples (printf %b escapes).
scan_files() {
  local name="$1" want="$2"; shift 2
  local repo spec f b c
  mk_workdir repo scanf
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t.dev
  git -C "$repo" config user.name test
  for spec in "$@"; do
    f="${spec%%|*}"; b="${spec#*|}"; b="${b%%|*}"
    mkdir -p "$repo/$(dirname "$f")"; printf '%b\n' "$b" > "$repo/$f"
  done
  git -C "$repo" add -A && git -C "$repo" commit -qm base
  for spec in "$@"; do
    f="${spec%%|*}"; c="${spec##*|}"
    printf '%b\n' "$c" > "$repo/$f"
  done
  git -C "$repo" add -A && git -C "$repo" commit -qm feat
  scan_repo "$name" "$want" "$repo"
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

# hunk and file boundaries (a hunk ends at @@, a file ends at its diff header)
scan_files two-hunks 0 'q.py|a\nb\nc\nd\ne|a\nselect id,\nc\nfrom users\ne'
scan_files sql-then-prose-nonascii 0 'm.sql|-- a|-- a\n-- b' 'ä.ts|x|# Re-insert the defect'
scan_files sql-then-prose 0 'm.sql|-- a|-- a\n-- b' 'n.ts|x|echo "Re-insert the defect"'
scan_files space-in-path-sql 1 '001 init.sql|select id\nfrom t|select id\nfrom t\n   and due_at < now()'
scan_files plusplus-content-is-not-header 0 't.sh|x|++ b/m.sql\necho "insert it"'
expect_scan sql-quoted-slashes 1 a.ts "" 'const s = "a // b"; db.query("UPDATE t SET a = 1");'
expect_scan sql-python-division 1 a.py "" 'x = a // b; cur.execute("update t set a = 1")'

# scanner unit cases on synthetic diffs (a removed `--- c` ends a hunk; headers only before the first @@)
SCAN_UNITS="$(node -e '
const { scanDiffForSurfaces: scan } = require(process.argv[1]);
const hdr = (f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n`;
const cases = [
  ["removed-line-ends-hunk", hdr("a.py") + "@@ -1 +1 @@\n+select id,\n--- c\n+from users\n", false],
  ["plusplus-in-hunk-is-content", hdr("t.sh") + "@@ -0,0 +1,2 @@\n+++ b/m.sql\n+echo hi\n", false],
  ["tab-after-path", "diff --git a/d x/a b.sql b/d x/a b.sql\n--- a/d x/a b.sql\t\n+++ b/d x/a b.sql\t\n@@ -0,0 +1 @@\n+select 1\n", true],
  ["quoted-octal-path", "diff --git \"a/\\303\\244.sql\" \"b/\\303\\244.sql\"\n--- \"a/\\303\\244.sql\"\n+++ \"b/\\303\\244.sql\"\n@@ -0,0 +1 @@\n+select 1\n", true],
  ["new-diff-resets-file", hdr("m.sql") + "@@ -0,0 +1 @@\n+-- c\ndiff --git a/x b/x\nBinary files differ\n", false],
];
let bad = [];
for (const [n, d, want] of cases) if (scan(d).has("sql") !== want) bad.push(n);
process.stdout.write(bad.join(","));
' "$REPO_ROOT/_shared/lib/realpath-check.cjs" 2>&1)"
if [[ -z "$SCAN_UNITS" ]]; then echo "PASS  g-scanner-units (5 synthetic diffs)"; pass=$((pass + 1)); else echo "FAIL  g-scanner-units: $SCAN_UNITS"; fail=$((fail + 1)); fi

# ReDoS guard: pathological lines must not stall the CLI (old GRANT pattern: 15 s at 3000 spaces).
# Timing is measured in node so the bound is the same on macOS and GNU.
redos_case() {
  local name="$1" line="$2" repo ms
  mk_workdir repo redos
  git -C "$repo" init -q; git -C "$repo" config user.email t@t.dev; git -C "$repo" config user.name test
  echo seed > "$repo/seed.txt"; git -C "$repo" add -A && git -C "$repo" commit -qm base
  node -e 'const n=3000,R=(x)=>x.repeat(n);const L={grant:"GRANT "+" ".repeat(n)+"x",parens:R("("),where:R(".where("),sel:"SELECT "+R("a ")};
    const l=L[process.argv[2]];require("fs").writeFileSync(process.argv[1]+"/p.ts",Array(8).fill(l).join("\n")+"\n")' "$repo" "$line"
  git -C "$repo" add -A && git -C "$repo" commit -qm feat
  ms="$(node -e 'const t=Date.now();require("child_process").spawnSync("node",[process.argv[1],"realpath-check","run","--diff-base","HEAD~1","--project",process.argv[2]]);process.stdout.write(String(Date.now()-t))' "$TOOLS" "$repo")"
  if [[ "$ms" -lt 2000 ]]; then echo "PASS  g-redos-$name (${ms} ms < 2000)"; pass=$((pass + 1)); else echo "FAIL  g-redos-$name (${ms} ms >= 2000)"; fail=$((fail + 1)); fi
}
redos_case grant grant
redos_case parens parens
redos_case where where
redos_case select sel

echo "realpath-check fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
