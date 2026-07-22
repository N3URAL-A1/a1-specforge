#!/usr/bin/env bash
# Scenario suite for `a1-tools quick eligibility` (Wave 1, FR-001/FR-002/
# FR-003/FR-016 — spec 004-xs-quick-lane).
#
# Contract under test:
#   node a1-tools.cjs quick eligibility --intent <text> --files <n>
#     --diff-lines <n> --scope <path>[,<path>...] --no-migration
#     --no-new-route --no-new-dep [--by <spec-id>] [--repo-root <abs>]
#     [--file <reservations-path>]
#   Exit 0 + {"status":"ELIGIBLE","reasons":[]} when ALL criteria hold.
#   Exit 1 + {"status":"NOT_ELIGIBLE","reasons":[...]} listing EVERY failing
#   criterion (not just the first) otherwise. Fail-closed on any missing/
#   unparseable required flag or an intent the sentence heuristic cannot
#   confidently classify.
#
# Scenarios:
#   eligible-baseline            -> 0 (1 file, 10-line diff, clean tree)
#   files-over-budget            -> 1 (3 files > 2 cap)
#   diff-over-budget             -> 1 (60 lines > 50 cap)
#   forbidden-surface-scope      -> 1 (scope matches auth/** forbidden glob)
#   dirty-tree                   -> 1 (uncommitted change in repo-root)
#   conflicting-reservation      -> 1 (pre-seeded code_scope overlap)
#   missing-intent                -> 1 (fail closed, no --intent)
#   intent-sentence-cap-exceeded -> 1 (3 sentences > 2 cap)
#   missing-required-flag        -> 1 (fail closed, no --files)
#   multi-reason-lists-all       -> 1, reasons[] has >= 2 entries
#   hostile-path-traversal-scope -> 1 (../../etc/passwd in --scope, inert)
#   hostile-injection-intent     -> 1 or 0 per real criteria, but treated as
#                                    inert text (no shell side effect)
#   hostile-oversized-intent     -> fails fast (<5s), does not hang
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0

WORK="$(mktemp -d)"

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

# --- fixture repo: a clean git repo used as --repo-root for the working-tree check ---
CLEAN_REPO="$WORK/clean-repo"
mkdir -p "$CLEAN_REPO"
git -C "$CLEAN_REPO" init -q
git -C "$CLEAN_REPO" config user.email "test@example.com"
git -C "$CLEAN_REPO" config user.name "Test"
echo "seed" > "$CLEAN_REPO/seed.txt"
git -C "$CLEAN_REPO" add seed.txt
git -C "$CLEAN_REPO" commit -q -m "seed"

DIRTY_REPO="$WORK/dirty-repo"
mkdir -p "$DIRTY_REPO"
git -C "$DIRTY_REPO" init -q
git -C "$DIRTY_REPO" config user.email "test@example.com"
git -C "$DIRTY_REPO" config user.name "Test"
echo "seed" > "$DIRTY_REPO/seed.txt"
git -C "$DIRTY_REPO" add seed.txt
git -C "$DIRTY_REPO" commit -q -m "seed"
echo "uncommitted change" >> "$DIRTY_REPO/seed.txt"

RESV="$WORK/reservations.json"

# =============================================================================
# eligible-baseline: 1 file, 10-line diff, no forbidden surface, clean tree,
# no conflicting reservation -> exit 0
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-baseline 2>&1)"
RC=$?
assert_rc "eligible-baseline" 0 "$RC" "$OUT"
if ! grep -q '"status": "ELIGIBLE"' <<<"$OUT"; then
  echo "FAIL  eligible-baseline: expected status ELIGIBLE in JSON"; fail=$((fail + 1))
fi

# =============================================================================
# files-over-budget: 3 files > 2 cap -> exit 1
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --files 3 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-files 2>&1)"
RC=$?
assert_rc "files-over-budget" 1 "$RC" "$OUT"

# =============================================================================
# diff-over-budget: 60 lines > 50 cap -> exit 1
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --files 1 --diff-lines 60 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-diff 2>&1)"
RC=$?
assert_rc "diff-over-budget" 1 "$RC" "$OUT"

# =============================================================================
# forbidden-surface-scope: scope matches auth/** forbidden glob -> exit 1
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Adjust the login form label." \
  --files 1 --diff-lines 5 --scope src/auth/login.ts \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-forbidden 2>&1)"
RC=$?
assert_rc "forbidden-surface-scope" 1 "$RC" "$OUT"
if ! grep -qi "forbidden" <<<"$OUT"; then
  echo "FAIL  forbidden-surface-scope: expected a forbidden-surface reason in output"; fail=$((fail + 1))
fi

# =============================================================================
# dirty-tree: working tree has uncommitted changes -> exit 1
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$DIRTY_REPO" --file "$RESV" --by quick-dirty 2>&1)"
RC=$?
assert_rc "dirty-tree" 1 "$RC" "$OUT"
if ! grep -qi "working tree" <<<"$OUT"; then
  echo "FAIL  dirty-tree: expected a working-tree reason in output"; fail=$((fail + 1))
fi

# =============================================================================
# conflicting-reservation: another feature already holds an overlapping
# code_scope reservation -> exit 1
# =============================================================================
RESV_CONFLICT="$WORK/reservations-conflict.json"
cat > "$RESV_CONFLICT" <<'JSON'
{
  "reservations": [
    { "type": "code_scope", "by": "spec-999", "paths": ["src/components/Footer.tsx"], "at": "2026-07-01T00:00:00.000Z", "stage": "started" }
  ]
}
JSON
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV_CONFLICT" --by quick-conflict 2>&1)"
RC=$?
assert_rc "conflicting-reservation" 1 "$RC" "$OUT"
if ! grep -qi "reservation" <<<"$OUT"; then
  echo "FAIL  conflicting-reservation: expected a reservation-conflict reason in output"; fail=$((fail + 1))
fi

# =============================================================================
# missing-intent: no --intent -> exit 1, fail closed
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-missing-intent 2>&1)"
RC=$?
assert_rc "missing-intent" 1 "$RC" "$OUT"

# =============================================================================
# intent-sentence-cap-exceeded: 3 sentences > 2 cap -> exit 1
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the footer typo. Also update the logo. Also bump the version." \
  --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-sentences 2>&1)"
RC=$?
assert_rc "intent-sentence-cap-exceeded" 1 "$RC" "$OUT"

# =============================================================================
# missing-required-flag: no --files -> exit 1, fail closed
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-missing-files 2>&1)"
RC=$?
assert_rc "missing-required-flag" 1 "$RC" "$OUT"

# =============================================================================
# multi-reason-lists-all: two independent failures at once (files AND diff
# over budget) -> reasons[] must contain >= 2 entries, not just the first
# =============================================================================
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the typo in the footer copyright year." \
  --files 5 --diff-lines 200 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-multi 2>&1)"
RC=$?
assert_rc "multi-reason-part1" 1 "$RC" "$OUT"
REASON_COUNT="$(node -e '
  const data = JSON.parse(process.argv[1]);
  process.stdout.write(String((data.reasons || []).length));
' "$OUT" 2>/dev/null || echo 0)"
if [[ "$REASON_COUNT" -lt 2 ]]; then
  echo "FAIL  multi-reason-lists-all: expected >= 2 reasons, got $REASON_COUNT"
  fail=$((fail + 1))
else
  echo "PASS  multi-reason-lists-all ($REASON_COUNT reasons)"
  pass=$((pass + 1))
fi

# =============================================================================
# Hostile inputs (mandatory per CONVENTIONS.md)
# =============================================================================

# (a) path traversal in --scope -> must not resolve outside repo, exit 1
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Touch a file outside the repo." \
  --files 1 --diff-lines 10 --scope "../../../../etc/passwd" \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-traversal 2>&1)"
RC=$?
assert_rc "hostile-path-traversal-scope" 1 "$RC" "$OUT"

# (b) injection-shaped --intent -> must be treated as inert text, never
# executed. Assert no side-effect marker file is created and the command
# still returns a clean, parseable JSON verdict.
MARKER="$WORK/injection-marker"
OUT="$(node "$TOOLS" quick eligibility \
  --intent "Fix the footer; \$(touch $MARKER) \`touch $MARKER\`" \
  --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
  --no-migration --no-new-route --no-new-dep \
  --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-injection 2>&1)"
RC=$?
if [[ -e "$MARKER" ]]; then
  echo "FAIL  hostile-injection-intent: injected side effect occurred — $MARKER was created"
  fail=$((fail + 1))
else
  echo "PASS  hostile-injection-intent (no side effect, marker absent)"
  pass=$((pass + 1))
fi
if ! node -e 'JSON.parse(process.argv[1])' "$OUT" >/dev/null 2>&1; then
  echo "FAIL  hostile-injection-intent: output is not parseable JSON"
  echo "----- output -----"; echo "$OUT"; echo "------------------"
  fail=$((fail + 1))
else
  echo "PASS  hostile-injection-intent-json (parseable, exit $RC)"
  pass=$((pass + 1))
fi

# (c) oversized --intent (>= 10000 chars) -> must fail fast, not hang.
# No portable `timeout`/`gtimeout` on this platform — use a bash watchdog:
# run the command in the background, poll for completion, kill if it
# overruns the deadline.
BIG_INTENT="$(node -e 'process.stdout.write("a".repeat(10000))')"
OUT_FILE="$WORK/oversized-out.txt"
RC_FILE="$WORK/oversized-rc.txt"
START=$(date +%s)
(
  node "$TOOLS" quick eligibility \
    --intent "$BIG_INTENT" \
    --files 1 --diff-lines 10 --scope src/components/Footer.tsx \
    --no-migration --no-new-route --no-new-dep \
    --repo-root "$CLEAN_REPO" --file "$RESV" --by quick-oversized \
    >"$OUT_FILE" 2>&1
  echo $? > "$RC_FILE"
) &
CHILD_PID=$!
DEADLINE=5
TIMED_OUT=0
for _ in $(seq 1 "$((DEADLINE * 10))"); do
  if ! kill -0 "$CHILD_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if kill -0 "$CHILD_PID" 2>/dev/null; then
  TIMED_OUT=1
  kill -9 "$CHILD_PID" 2>/dev/null
fi
wait "$CHILD_PID" 2>/dev/null
END=$(date +%s)
ELAPSED=$((END - START))
RC="$(cat "$RC_FILE" 2>/dev/null || echo 124)"
OUT="$(cat "$OUT_FILE" 2>/dev/null || echo "")"
if [[ "$TIMED_OUT" -eq 1 ]]; then
  echo "FAIL  hostile-oversized-intent: timed out (hung) after ${DEADLINE}s"
  fail=$((fail + 1))
else
  echo "PASS  hostile-oversized-intent (${ELAPSED}s, exit $RC, no hang)"
  pass=$((pass + 1))
fi
assert_rc "hostile-oversized-intent-rc" 1 "$RC" "$OUT"

# =============================================================================
# Wave 2 — a1-quick skill core flow (FR-007..012, FR-015 — spec
# 004-xs-quick-lane). Two case classes:
#   (1) git-mechanics: a scripted simulation of the branch-create -> commit ->
#       merge sequence SKILL.md Step 3/6 documents. Not a full agent-flow
#       test (that isn't bash-scriptable) — it proves the git mechanics the
#       skill's steps describe are sound and leave no worktree behind
#       (SC-003's "no worktree created" half).
#   (2) run-record-schema: a hand-written fixture instance is validated
#       against the frontmatter shape from SKILL.md's "Run-record schema"
#       section (FR-015) via node -e YAML/JSON-ish parsing.
# =============================================================================

# --- (1) git-mechanics: branch -> commit -> merge, no worktree ---
GIT_WORK="$WORK/quick-git-mechanics"
mkdir -p "$GIT_WORK"
git -C "$GIT_WORK" init -q -b main
git -C "$GIT_WORK" config user.email "test@example.com"
git -C "$GIT_WORK" config user.name "Test"
echo "seed" > "$GIT_WORK/seed.txt"
git -C "$GIT_WORK" add seed.txt
git -C "$GIT_WORK" commit -q -m "seed"

SLUG="fix-footer-typo"
# Step 3 — Implement: create quick/<slug> branch off main, no worktree add.
git -C "$GIT_WORK" checkout -q -b "quick/$SLUG" main
echo "2027" > "$GIT_WORK/seed.txt"
git -C "$GIT_WORK" add seed.txt
# Step 6 — Commit + merge: exactly one commit on quick/<slug> before merge.
git -C "$GIT_WORK" commit -q -m "fix(footer): correct copyright year"
git -C "$GIT_WORK" checkout -q main
git -C "$GIT_WORK" merge -q --no-ff "quick/$SLUG" -m "merge quick/$SLUG"

# Assert: exactly one commit landed on quick/<slug> ahead of the seed commit
# (i.e. exactly one commit made ON the quick branch before merge).
SEED_COMMIT="$(git -C "$GIT_WORK" rev-list --max-parents=0 HEAD | tail -1)"
COMMITS_ON_BRANCH="$(git -C "$GIT_WORK" rev-list --count "quick/$SLUG" "^$SEED_COMMIT" 2>/dev/null || echo -1)"
if [[ "$COMMITS_ON_BRANCH" -eq 1 ]]; then
  echo "PASS  quick-git-mechanics-one-commit (exactly 1 commit on quick/$SLUG)"
  pass=$((pass + 1))
else
  echo "FAIL  quick-git-mechanics-one-commit: expected exactly 1 commit on quick/$SLUG, got $COMMITS_ON_BRANCH"
  fail=$((fail + 1))
fi

# Assert: no git worktree entries exist beyond the primary checkout — proves
# no `git worktree add` occurred anywhere in the simulated flow.
WORKTREE_COUNT="$(git -C "$GIT_WORK" worktree list | wc -l | tr -d ' ')"
if [[ "$WORKTREE_COUNT" -eq 1 ]]; then
  echo "PASS  quick-git-mechanics-no-worktree (worktree list has only the primary checkout)"
  pass=$((pass + 1))
else
  echo "FAIL  quick-git-mechanics-no-worktree: expected 1 worktree list entry (primary only), got $WORKTREE_COUNT"
  fail=$((fail + 1))
fi

# Assert: main now contains the merged change (merge actually landed).
if grep -q "2027" "$GIT_WORK/seed.txt"; then
  echo "PASS  quick-git-mechanics-merge-landed (main has the merged change)"
  pass=$((pass + 1))
else
  echo "FAIL  quick-git-mechanics-merge-landed: main does not contain the merged change"
  fail=$((fail + 1))
fi

# --- (2) run-record-schema: hand-written fixture validated against the
# frontmatter shape from SKILL.md's "Run-record schema" section (FR-015) ---
FIXTURE_DIR="$DIR/fixtures"
mkdir -p "$FIXTURE_DIR"
RUN_RECORD_FIXTURE="$FIXTURE_DIR/sample-run-record.md"
cat > "$RUN_RECORD_FIXTURE" <<'MDEOF'
---
type: quick-run
kind: fix
slug: fix-footer-typo
project: demo
created: 2026-07-22
result: completed
escalated: false
branch: quick/fix-footer-typo
files:
  - src/components/Footer.tsx
diff_lines: 4
verify: "pass: 1/1 AC, tests green, 5-point self-review clean"
retro: "clean XS run, no friction"
---

# Quick Run — fix-footer-typo
MDEOF

SCHEMA_CHECK_RC=0
node -e '
const fs = require("fs");
const path = process.argv[1];
const content = fs.readFileSync(path, "utf8");
const match = content.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) { console.error("no frontmatter block found"); process.exit(1); }
const raw = match[1];
const lines = raw.split("\n");
const fm = {};
let currentKey = null;
for (const line of lines) {
  const listItem = line.match(/^\s+-\s+(.*)$/);
  if (listItem && currentKey) {
    if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
    fm[currentKey].push(listItem[1].trim());
    continue;
  }
  const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
  if (kv) {
    currentKey = kv[1];
    let val = kv[2].trim();
    if (val === "") { fm[currentKey] = undefined; continue; }
    if (val.startsWith("\"") && val.endsWith("\"")) val = val.slice(1, -1);
    fm[currentKey] = val;
  }
}
const required = ["type", "kind", "result", "escalated", "files", "diff_lines", "verify", "retro"];
const missing = required.filter((k) => fm[k] === undefined);
if (missing.length > 0) {
  console.error("missing required frontmatter fields: " + missing.join(", "));
  process.exit(1);
}
if (fm.type !== "quick-run") { console.error("type must be quick-run, got: " + fm.type); process.exit(1); }
if (!["feature", "fix"].includes(fm.kind)) { console.error("kind must be feature|fix, got: " + fm.kind); process.exit(1); }
if (!["in-progress", "completed", "escalated"].includes(fm.result)) { console.error("result must be in-progress|completed|escalated, got: " + fm.result); process.exit(1); }
if (!["true", "false"].includes(String(fm.escalated))) { console.error("escalated must be true|false, got: " + fm.escalated); process.exit(1); }
if (!Array.isArray(fm.files)) { console.error("files must be a list, got: " + JSON.stringify(fm.files)); process.exit(1); }
if (!/^[0-9]+$/.test(String(fm.diff_lines))) { console.error("diff_lines must be an integer, got: " + fm.diff_lines); process.exit(1); }
process.exit(0);
' "$RUN_RECORD_FIXTURE" || SCHEMA_CHECK_RC=$?
assert_rc "run-record-schema-valid" 0 "$SCHEMA_CHECK_RC" "(see node -e stderr above)"

# --- (2b) reject a malformed run-record fixture (missing required field) to
# prove the schema check is not a rubber stamp ---
RUN_RECORD_BAD="$WORK/bad-run-record.md"
cat > "$RUN_RECORD_BAD" <<'MDEOF'
---
type: quick-run
kind: fix
result: completed
escalated: false
files:
  - src/components/Footer.tsx
diff_lines: 4
retro: "missing verify field"
---

# Bad Quick Run
MDEOF
BAD_SCHEMA_CHECK_RC=0
node -e '
const fs = require("fs");
const path = process.argv[1];
const content = fs.readFileSync(path, "utf8");
const match = content.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) { process.exit(1); }
const raw = match[1];
const lines = raw.split("\n");
const fm = {};
let currentKey = null;
for (const line of lines) {
  const listItem = line.match(/^\s+-\s+(.*)$/);
  if (listItem && currentKey) {
    if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
    fm[currentKey].push(listItem[1].trim());
    continue;
  }
  const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
  if (kv) {
    currentKey = kv[1];
    let val = kv[2].trim();
    if (val === "") { fm[currentKey] = undefined; continue; }
    fm[currentKey] = val;
  }
}
const required = ["type", "kind", "result", "escalated", "files", "diff_lines", "verify", "retro"];
const missing = required.filter((k) => fm[k] === undefined);
process.exit(missing.length > 0 ? 1 : 0);
' "$RUN_RECORD_BAD" || BAD_SCHEMA_CHECK_RC=$?
assert_rc "run-record-schema-rejects-missing-field" 1 "$BAD_SCHEMA_CHECK_RC" "(expected rejection: missing 'verify' field)"

echo "a1-quick: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
