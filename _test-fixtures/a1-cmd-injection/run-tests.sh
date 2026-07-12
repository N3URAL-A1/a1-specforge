#!/usr/bin/env bash
# Regression fixture for the command-injection fix in _shared/a1-tools.cjs
# (see .a1/learnings/projects/a1-specforge/fixes/2026-07-12-cmd-injection-git-helper.md).
#
# All git exec sites now use execFileSync with an argv array (no shell), so
# shell metacharacters in a hostile value are inert literal bytes. These
# tests assert NO side effect occurs for a `$(touch <marker>)`-style payload
# across all three injection vectors named in the diagnosis:
#   (a) hostile inline-code file anchor via `reconcile parse-spec`
#   (b) hostile `--repo-path` value reaching phantom commands
#   (c) hostile `--since` value reaching phantom commands
#
# Isolation: everything mutable lives under a fresh `mktemp -d`.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0
results=()

assert_no_marker() {
  local name="$1" marker="$2"
  if [[ -e "$marker" ]]; then
    results+=("FAIL  $name: injected side effect occurred — $marker was created")
    fail=$((fail + 1))
  else
    results+=("PASS  $name (no side effect, marker absent)")
    pass=$((pass + 1))
  fi
}

assert_rc_nonzero() {
  local name="$1" actual="$2" out="$3"
  if [[ "$actual" -ne 0 ]]; then
    results+=("PASS  $name (exit $actual, rejected as expected)")
    pass=$((pass + 1))
  else
    results+=("FAIL  $name: expected non-zero exit, got 0")
    results+=("        output: $out")
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Vector (a): hostile inline-code file anchor via `reconcile parse-spec`
# ---------------------------------------------------------------------------
test_hostile_anchor() {
  local work marker vault repo
  work="$(mktemp -d)"
  marker="$work/pwned-anchor"
  vault="$work/vault"
  repo="$work/repo"
  mkdir -p "$vault/projects/demo/spec" "$repo/src/auth"

  git -C "$repo" init -q
  printf 'export {};\n' > "$repo/src/auth/LoginForm.tsx"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=ci@test -c user.name=ci commit -qm init >/dev/null

  # Inline-code anchor with a command-substitution payload. It ends in a
  # known extension and contains a '/', so classifyAnchor() treats it as a
  # `kind: file` ref — this is exactly the shape from the bug report.
  cat > "$vault/projects/demo/spec/001-login.md" <<EOF
---
id: 001-login
project: demo
feature_slug: login
title: Login Feature
status: shipped
created: 2026-05-01
updated: 2026-05-01
---

# Login Feature — Spec

- FR-001: Handled by \`a/\$(touch $marker).md\`.
EOF

  A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile init demo \
    --scope single --spec 001-login \
    --project-path "$repo" --date 2026-05-13 >/dev/null 2>&1

  local out
  out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" reconcile parse-spec \
    "projects/demo/drift-2026-05-13.md" 2>&1)
  local rc=$?

  # The command must not create the marker file (no RCE), regardless of
  # whether parse-spec itself reports the anchor as file-not-found.
  assert_no_marker "[hostile-anchor] no side effect from \$(...) payload" "$marker"
  if [[ $rc -eq 0 ]]; then
    results+=("PASS  [hostile-anchor] parse-spec completed without crashing (exit $rc)")
    pass=$((pass + 1))
  else
    results+=("FAIL  [hostile-anchor] parse-spec crashed (exit $rc): $out")
    fail=$((fail + 1))
  fi

  rm -rf "$work"
}

# ---------------------------------------------------------------------------
# Vector (b): hostile --repo-path value reaching phantom commands
# ---------------------------------------------------------------------------
test_hostile_repo_path() {
  local work marker
  work="$(mktemp -d)"
  marker="$work/pwned-repopath"
  mkdir -p "$work/plan-dir"
  cat > "$work/plan-dir/PLAN.md" <<'EOF'
# Plan
- [x] implement the thing
EOF

  local hostile_repo_path='/tmp/$(touch '"$marker"')'

  local out
  out=$(node "$TOOLS" phantom check "$work/plan-dir/PLAN.md" \
    --repo-path "$hostile_repo_path" --format json 2>&1)
  local rc=$?

  assert_no_marker "[hostile-repo-path] no side effect from \$(...) payload" "$marker"
  assert_rc_nonzero "[hostile-repo-path] rejected at CLI boundary" "$rc" "$out"

  rm -rf "$work"
}

# ---------------------------------------------------------------------------
# Vector (c): hostile --since value reaching phantom commands
# ---------------------------------------------------------------------------
test_hostile_since() {
  local work marker repo
  work="$(mktemp -d)"
  marker="$work/pwned-since"
  repo="$work/repo"
  mkdir -p "$repo"

  git -C "$repo" init -q
  printf '# plan\n- [x] task\n' > "$repo/PLAN.md"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=ci@test -c user.name=ci commit -qm init >/dev/null

  local hostile_since='$(touch '"$marker"')'

  local out
  out=$(node "$TOOLS" phantom check "$repo/PLAN.md" \
    --repo-path "$repo" --since "$hostile_since" --format json 2>&1)
  local rc=$?

  assert_no_marker "[hostile-since] no side effect from \$(...) payload" "$marker"
  assert_rc_nonzero "[hostile-since] rejected at CLI boundary" "$rc" "$out"

  rm -rf "$work"
}

# ---------------------------------------------------------------------------
# Control: legit refs/paths still work (no behavior regression)
# ---------------------------------------------------------------------------
test_legit_since_still_works() {
  local work repo
  work="$(mktemp -d)"
  repo="$work/repo"
  mkdir -p "$repo/src"

  git -C "$repo" init -q
  printf 'module.exports = {};\n' > "$repo/src/mod.js"
  printf '# plan\n- [x] implement mod\n' > "$repo/PLAN.md"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=ci@test -c user.name=ci commit -qm baseline >/dev/null

  printf 'module.exports = { done: true };\n' > "$repo/src/mod.js"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=ci@test -c user.name=ci commit -qm impl >/dev/null

  local out
  out=$(node "$TOOLS" phantom check "$repo/PLAN.md" \
    --repo-path "$repo" --since "HEAD~1" --format json 2>&1)
  local rc=$?

  if [[ $rc -eq 0 ]]; then
    results+=("PASS  [legit-since] normal --since ref still works (exit $rc)")
    pass=$((pass + 1))
  else
    results+=("FAIL  [legit-since] normal --since ref broke (exit $rc): $out")
    fail=$((fail + 1))
  fi

  rm -rf "$work"
}

# spec set-size (M12): hostile size value must be rejected as a usage error
# (exit 1 per CLI convention: 0 success, 1 user/usage, 2 internal) without
# touching the file; a valid value round-trips into the frontmatter.
test_set_size() {
  local work
  work="$(mktemp -d)"
  local vault="$work/vault"
  mkdir -p "$vault/projects/demo/spec"
  printf -- '---\nid: 001-demo\nstatus: draft\nsize: null\n---\n\n# Demo\n' \
    > "$vault/projects/demo/spec/001-demo.md"

  local out rc
  out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" spec set-size \
    "projects/demo/spec/001-demo.md" 'S; touch '"$work"'/pwned' 2>&1)
  rc=$?
  if [[ $rc -eq 1 && ! -e "$work/pwned" ]] && ! grep -q '^size: S;' "$vault/projects/demo/spec/001-demo.md"; then
    results+=("PASS  [set-size-hostile] injection-shaped size rejected (exit 1, file untouched)")
    pass=$((pass + 1))
  else
    results+=("FAIL  [set-size-hostile] expected exit 1 + untouched file, got exit $rc: $out")
    fail=$((fail + 1))
  fi

  out=$(A1_VAULT_ROOT="$vault" node "$TOOLS" spec set-size \
    "projects/demo/spec/001-demo.md" S 2>&1)
  rc=$?
  if [[ $rc -eq 0 ]] && grep -q '^size: S$' "$vault/projects/demo/spec/001-demo.md"; then
    results+=("PASS  [set-size-valid] size S written to frontmatter (exit 0)")
    pass=$((pass + 1))
  else
    results+=("FAIL  [set-size-valid] expected exit 0 + size: S in frontmatter, got exit $rc: $out")
    fail=$((fail + 1))
  fi

  rm -rf "$work"
}

test_hostile_anchor
test_hostile_repo_path
test_hostile_since
test_legit_since_still_works
test_set_size

printf '\n--- a1-cmd-injection fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\nTotal: %d passed, %d failed\n' "$pass" "$fail"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
