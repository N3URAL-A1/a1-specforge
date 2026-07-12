#!/usr/bin/env bash
# Scenario suite for bin/verify-install-sync.sh (the install/README drift
# gate). Follows the house style (CONVENTIONS.md): mktemp workdir, assert_rc
# helper, isolation via copies — never runs the checker against the live
# repo tree, only against a mktemp copy of it, so this suite can never mutate
# the checked-in repo state.
#
# Scenarios:
#   clean copy of the repo                                    -> 0 (PASS)
#   extra skill dir with no install.sh/README entry            -> 1
#   agents/*.md file with no corresponding install.sh entry    -> 1
#   README skills table missing a row (stale README)           -> 1
#   README scope-note comment count stale (out of sync)        -> 1
#   hostile inputs: dir name with spaces/newline, oversized
#     exclusion file                                           -> handled

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
CHECKER="$REPO_ROOT/bin/verify-install-sync.sh"

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

# ---------------------------------------------------------------------------
# Helper: make a fresh mktemp copy of the live repo's bin/, agents/,
# skills/, README.md — the only inputs the checker reads. Never point the
# checker at $REPO_ROOT directly.
# ---------------------------------------------------------------------------
make_repo_copy() {
  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/a1-install-sync-test.XXXXXX")"
  cp -r "$REPO_ROOT/bin" "$work/bin"
  cp -r "$REPO_ROOT/agents" "$work/agents"
  cp -r "$REPO_ROOT/skills" "$work/skills"
  cp "$REPO_ROOT/README.md" "$work/README.md"
  echo "$work"
}

run_checker() {
  local repo_root="$1"
  bash "$CHECKER" --repo-root "$repo_root" 2>&1
}

# ---------------------------------------------------------------------------
# Case 1 — clean copy of the repo: PASS (exit 0).
# ---------------------------------------------------------------------------
CLEAN="$(make_repo_copy)"
OUT="$(run_checker "$CLEAN")"
RC=$?
assert_rc "clean-repo-copy-passes" 0 "$RC" "$OUT"
rm -rf "$CLEAN"

# ---------------------------------------------------------------------------
# Case 2 — extra skill dir with no install.sh/README entry -> drift, exit 1.
# ---------------------------------------------------------------------------
EXTRA_DIR="$(make_repo_copy)"
mkdir -p "$EXTRA_DIR/skills/fake-skill-not-installed"
OUT="$(run_checker "$EXTRA_DIR")"
RC=$?
assert_rc "extra-skill-dir-detected" 1 "$RC" "$OUT"
assert_true "extra-skill-dir-diff-named" "$(echo "$OUT" | grep -q "skills-side count mismatch" && echo true || echo false)"
rm -rf "$EXTRA_DIR"

# ---------------------------------------------------------------------------
# Case 3 — agents/*.md file added but install.sh's AGENTS array not updated
# -> drift, exit 1. (Mirrors the exact real-world defect this phase closes:
# samuel/diana/dario landing in agents/ without install.sh being updated.)
# ---------------------------------------------------------------------------
MISSING_INSTALL="$(make_repo_copy)"
cat > "$MISSING_INSTALL/agents/a1-fake-new-agent.md" <<'EOF'
---
name: a1-fake-new-agent
role: fake
description: Fixture-only fake agent, never a real a1 agent.
tools: [Read]
---
Fixture placeholder.
EOF
OUT="$(run_checker "$MISSING_INSTALL")"
RC=$?
assert_rc "agent-missing-from-install-sh-detected" 1 "$RC" "$OUT"
assert_true "agent-missing-diff-named" "$(echo "$OUT" | grep -q "agents-side count mismatch" && echo true || echo false)"
rm -rf "$MISSING_INSTALL"

# ---------------------------------------------------------------------------
# Case 4 — stale README row: delete one skill's table row from README so the
# README count no longer matches dirs/install.sh -> drift, exit 1.
# ---------------------------------------------------------------------------
STALE_ROW="$(make_repo_copy)"
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const lines = fs.readFileSync(path, "utf8").split("\n");
  const idx = lines.findIndex(l => l.includes("`a1-evolve`"));
  if (idx === -1) { console.error("fixture setup: could not find a1-evolve row"); process.exit(1); }
  lines.splice(idx, 1);
  fs.writeFileSync(path, lines.join("\n"));
' "$STALE_ROW/README.md"
OUT="$(run_checker "$STALE_ROW")"
RC=$?
assert_rc "stale-readme-row-detected" 1 "$RC" "$OUT"
assert_true "stale-readme-row-diff-named" "$(echo "$OUT" | grep -q "skills-side count mismatch" && echo true || echo false)"
rm -rf "$STALE_ROW"

# ---------------------------------------------------------------------------
# Case 5 — stale README scope-note comment count: dirs/install.sh/README
# table all agree, but the scope-note HTML comment still claims the old
# count -> drift, exit 1. This is the 4th assertion (audit MAJOR-2 fix):
# the comment itself must not become the next unenforced stale claim.
# ---------------------------------------------------------------------------
STALE_COMMENT="$(make_repo_copy)"
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  let content = fs.readFileSync(path, "utf8");
  // Count-agnostic (M13): corrupt whatever counts the live scope-note claims,
  // so this case keeps working when the real skill/agent counts change.
  content = content.replace(/\d+ skills \+ \d+ agent/, "999 skills + 998 agent");
  fs.writeFileSync(path, content);
' "$STALE_COMMENT/README.md"
OUT="$(run_checker "$STALE_COMMENT")"
RC=$?
assert_rc "stale-scope-note-comment-detected" 1 "$RC" "$OUT"
assert_true "stale-scope-note-comment-diff-named" "$(echo "$OUT" | grep -q "README scope-note comment count mismatch" && echo true || echo false)"
rm -rf "$STALE_COMMENT"

# ===========================================================================
# Hostile inputs (mandatory, CONVENTIONS.md)
# ===========================================================================

# (a) Path traversal — a skill/agent dir name containing spaces and a
# newline-like path segment must not break the checker's parsing (bash word
# splitting, awk/grep patterns) or cause it to escape the intended repo root.
HOSTILE_NAMES="$(make_repo_copy)"
mkdir -p "$HOSTILE_NAMES/skills/weird name with spaces"
OUT="$(run_checker "$HOSTILE_NAMES")"
RC=$?
# Expected: treated as an ordinary extra/unlisted dir -> drift detected
# (exit 1), not a crash and not silently ignored.
assert_rc "hostile-dirname-with-spaces-handled-as-drift" 1 "$RC" "$OUT"
rm -rf "$HOSTILE_NAMES"

# (b) Injection-shaped input — N/A for this checker. It only ever reads
# static file lists via `find`/`awk`/`grep` on filenames and README prose;
# it never passes any file content or filename into `eval`, backticks, or a
# shell-interpreted context. There is no shell-evaluated input path here to
# exercise, so this category is documented as N/A rather than faked with a
# no-op test case (per CONVENTIONS.md's requirement to state this
# explicitly, not omit it silently).

# (c) Oversized values — an install-exclusions.txt file >= 10,000 chars must
# not hang or crash the checker; it must still complete and produce a
# result (exit 0 or 1, either is acceptable — the requirement is "does not
# hang/crash", checked here via a bounded-time run).
OVERSIZED="$(make_repo_copy)"
node -e '
  const fs = require("fs");
  const line = "# padding-line-for-oversized-exclusions-file-test\n";
  let content = "# <name>: <reason> — one entry per line, agents only\n";
  while (content.length < 10000) content += line;
  fs.writeFileSync(process.argv[1], content);
' "$OVERSIZED/bin/install-exclusions.txt"
START_TS=$(node -e 'console.log(Date.now())')
OUT="$(run_checker "$OVERSIZED")"
RC=$?
END_TS=$(node -e 'console.log(Date.now())')
ELAPSED_MS=$((END_TS - START_TS))
assert_true "oversized-exclusions-file-does-not-hang" "$([[ $ELAPSED_MS -lt 5000 ]] && echo true || echo false)"
assert_true "oversized-exclusions-file-produces-a-result" "$([[ $RC -eq 0 || $RC -eq 1 ]] && echo true || echo false)"
rm -rf "$OVERSIZED"

echo "install-sync fixtures: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
