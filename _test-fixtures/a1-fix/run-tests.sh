#!/usr/bin/env bash
# Smoke tests for the `fix` subcommand group in _shared/a1-tools.cjs.
# F-007 fixture — this group had ZERO fixture coverage before M10 Wave 15.
# Written against the CURRENT (pre-Wave-16) facade-resident code; this suite
# is the regression net for Wave 16's extraction of `fix` into lib/fix.cjs.
#
# Covers: next-suffix, update-status (valid + invalid), find-duplicates
# (no dupes / has dupes), integrity-check (bootstrap/clean/mismatch),
# init-postmortem, count-postmortems-since, update-promote-state,
# write-suggestion, plus mandatory hostile-input cases (path traversal,
# injection-shaped strings, oversized values) per CONVENTIONS.md.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0
results=()

assert() {
  local name="$1"
  local cond="$2"
  if [[ "$cond" == "1" ]]; then
    results+=("PASS  $name")
    pass=$((pass + 1))
  else
    results+=("FAIL  $name")
    fail=$((fail + 1))
  fi
}

assert_rc() {
  local name="$1" expected="$2" actual="$3" out="$4"
  if [[ "$actual" -ne "$expected" ]]; then
    results+=("FAIL  $name: expected exit $expected, got $actual")
    results+=("      output: $out")
    fail=$((fail + 1))
  else
    results+=("PASS  $name (exit $actual)")
    pass=$((pass + 1))
  fi
}

WORK="$(mktemp -d)"
VAULT="$WORK/vault"
mkdir -p "$VAULT"

# ---------------------------------------------------------------------------
# next-suffix — happy-path numbering
# ---------------------------------------------------------------------------
run_next_suffix() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix next-suffix demo 2026-05-13 2>&1)
  exit_code=$?
  assert_rc "next-suffix first-of-day exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"suffix": ""'; then
    assert "next-suffix returns empty suffix for first bug of day" "1"
  else
    assert "next-suffix returns empty suffix for first bug of day" "0"
  fi

  # Create a bug file for that date, then next-suffix should return "-2"
  local fixes_dir="$VAULT/projects/demo/fixes"
  mkdir -p "$fixes_dir"
  cat > "$fixes_dir/2026-05-13-login-crash.md" <<'EOF'
---
type: bug
status: reported
severity: major
---
# Login crash
EOF
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix next-suffix demo 2026-05-13 2>&1)
  exit_code=$?
  assert_rc "next-suffix second-of-day exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"suffix": "-2"'; then
    assert "next-suffix returns -2 when unsuffixed slot taken" "1"
  else
    assert "next-suffix returns -2 when unsuffixed slot taken" "0"
  fi

  # Invalid date format rejected
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix next-suffix demo not-a-date 2>&1)
  exit_code=$?
  assert_rc "next-suffix rejects invalid date" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# update-status — valid transition + invalid-status rejection
# ---------------------------------------------------------------------------
run_update_status() {
  local fixes_dir="$VAULT/projects/demo/fixes"
  mkdir -p "$fixes_dir"
  cat > "$fixes_dir/2026-05-14-auth-bug.md" <<'EOF'
---
type: bug
status: reported
severity: major
---
# Auth bug
EOF
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-status \
    "projects/demo/fixes/2026-05-14-auth-bug.md" diagnosed 2>&1)
  exit_code=$?
  assert_rc "update-status valid transition exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"status": "diagnosed"'; then
    assert "update-status transitions to diagnosed" "1"
  else
    assert "update-status transitions to diagnosed" "0"
  fi
  if grep -q '^status: diagnosed$' "$fixes_dir/2026-05-14-auth-bug.md"; then
    assert "update-status persists new status to file" "1"
  else
    assert "update-status persists new status to file" "0"
  fi
  if grep -Eq '^\s*-\s*"?phase=diagnose' "$fixes_dir/2026-05-14-auth-bug.md"; then
    assert "update-status appends phase_history entry" "1"
  else
    assert "update-status appends phase_history entry" "0"
  fi

  # Invalid status rejected
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-status \
    "projects/demo/fixes/2026-05-14-auth-bug.md" bogus-status 2>&1)
  exit_code=$?
  assert_rc "update-status rejects invalid status" 1 "$exit_code" "$out"

  # Missing bug file
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-status \
    "projects/demo/fixes/does-not-exist.md" diagnosed 2>&1)
  exit_code=$?
  assert_rc "update-status rejects missing bug file" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# find-duplicates — no dupes / has dupes
# ---------------------------------------------------------------------------
run_find_duplicates() {
  local fixes_dir="$VAULT/projects/demo/fixes"
  mkdir -p "$fixes_dir"
  cat > "$fixes_dir/2026-05-15-timeout-issue.md" <<'EOF'
---
type: bug
status: reported
severity: minor
title: "Timeout on checkout"
---
# Timeout on checkout page during payment processing
EOF
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix find-duplicates demo nonexistentword 2>&1)
  exit_code=$?
  assert_rc "find-duplicates no-match exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"matches": \[\]'; then
    assert "find-duplicates returns empty when no keyword hits" "1"
  else
    assert "find-duplicates returns empty when no keyword hits" "0"
  fi

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix find-duplicates demo timeout checkout 2>&1)
  exit_code=$?
  assert_rc "find-duplicates match exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"hit_count": 2'; then
    assert "find-duplicates finds matching bug with 2 keyword hits" "1"
  else
    assert "find-duplicates finds matching bug with 2 keyword hits" "0"
  fi
}

# ---------------------------------------------------------------------------
# integrity-check — bootstrap (no lock) / clean state / corrupted (mismatch)
# ---------------------------------------------------------------------------
run_integrity_check() {
  local agents_dir="$WORK/agents"
  local skills_dir="$WORK/skills"
  mkdir -p "$agents_dir" "$skills_dir"
  cat > "$agents_dir/walter.md" <<'EOF'
# Walter agent
Original content.
EOF

  local out exit_code
  # First call: no lock file exists yet -> bootstrap.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix integrity-check \
    --agents-dir "$agents_dir" --skills-dir "$skills_dir" 2>&1)
  exit_code=$?
  assert_rc "integrity-check bootstraps when no lock exists" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"status": "bootstrapped"'; then
    assert "integrity-check reports bootstrapped status" "1"
  else
    assert "integrity-check reports bootstrapped status" "0"
  fi

  # Second call: lock now exists, file unchanged -> clean/ok.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix integrity-check \
    --agents-dir "$agents_dir" --skills-dir "$skills_dir" 2>&1)
  exit_code=$?
  assert_rc "integrity-check clean-state exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"status": "ok"'; then
    assert "integrity-check reports ok when unchanged" "1"
  else
    assert "integrity-check reports ok when unchanged" "0"
  fi

  # Mutate the file -> corrupted / mismatch detected.
  cat > "$agents_dir/walter.md" <<'EOF'
# Walter agent
Modified content — hash should now differ.
EOF
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix integrity-check \
    --agents-dir "$agents_dir" --skills-dir "$skills_dir" 2>&1)
  exit_code=$?
  assert_rc "integrity-check mismatch-detection exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"status": "mismatch"'; then
    assert "integrity-check detects corrupted/mismatched file" "1"
  else
    assert "integrity-check detects corrupted/mismatched file" "0"
  fi
  if printf '%s' "$out" | grep -q '"file": "walter.md"'; then
    assert "integrity-check names the mismatched file" "1"
  else
    assert "integrity-check names the mismatched file" "0"
  fi
}

# ---------------------------------------------------------------------------
# init-postmortem — creates the expected file under postmortemsDir
# ---------------------------------------------------------------------------
run_init_postmortem() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem \
    login-crash demo --date 2026-05-13 --severity major \
    --one-line-learning "Always validate session tokens" 2>&1)
  exit_code=$?
  assert_rc "init-postmortem exit=0" 0 "$exit_code" "$out"
  local expected_file="$VAULT/wiki/postmortems/demo/2026-05-13-login-crash.md"
  assert "init-postmortem creates expected file" "$([[ -f "$expected_file" ]] && echo 1 || echo 0)"
  if grep -q '^one_line_learning: "Always validate session tokens"$' "$expected_file" 2>/dev/null; then
    assert "init-postmortem writes one_line_learning to frontmatter" "1"
  else
    assert "init-postmortem writes one_line_learning to frontmatter" "0"
  fi
}

# ---------------------------------------------------------------------------
# count-postmortems-since — date-boundary correctness
# ---------------------------------------------------------------------------
run_count_postmortems_since() {
  local out exit_code
  # Baseline: count since far future -> 0 (the postmortem file's mtime is now,
  # well before any future cutoff).
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix count-postmortems-since \
    --since "2099-01-01T00:00:00Z" 2>&1)
  exit_code=$?
  assert_rc "count-postmortems-since future-cutoff exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"count": 0'; then
    assert "count-postmortems-since returns 0 for a cutoff in the future" "1"
  else
    assert "count-postmortems-since returns 0 for a cutoff in the future" "0"
  fi

  # Since far past -> should include the postmortem written by run_init_postmortem.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix count-postmortems-since \
    --since "2000-01-01T00:00:00Z" 2>&1)
  exit_code=$?
  assert_rc "count-postmortems-since past-cutoff exit=0" 0 "$exit_code" "$out"
  local count
  count=$(printf '%s' "$out" | grep -o '"count": [0-9]*' | grep -o '[0-9]*')
  if [[ "${count:-0}" -ge 1 ]]; then
    assert "count-postmortems-since finds >=1 postmortem since a past cutoff (got $count)" "1"
  else
    assert "count-postmortems-since finds >=1 postmortem since a past cutoff (got $count)" "0"
  fi

  # Invalid timestamp rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix count-postmortems-since \
    --since "not-a-timestamp" 2>&1)
  exit_code=$?
  assert_rc "count-postmortems-since rejects invalid timestamp" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# update-promote-state — state transition
# ---------------------------------------------------------------------------
run_update_promote_state() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-promote-state \
    --at "2026-05-16T10:00:00Z" 2>&1)
  exit_code=$?
  assert_rc "update-promote-state exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"last_promote_at": "2026-05-16T10:00:00Z"'; then
    assert "update-promote-state records the given timestamp" "1"
  else
    assert "update-promote-state records the given timestamp" "0"
  fi
  local state_file="$VAULT/wiki/_state/last_promote.json"
  assert "update-promote-state writes expected state file" "$([[ -f "$state_file" ]] && echo 1 || echo 0)"

  # Second call with a later timestamp -> state overwritten (transition).
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-promote-state \
    --at "2026-05-17T10:00:00Z" 2>&1)
  if grep -q '"last_promote_at": "2026-05-17T10:00:00Z"' "$state_file" 2>/dev/null; then
    assert "update-promote-state overwrites state on second transition" "1"
  else
    assert "update-promote-state overwrites state on second transition" "0"
  fi
}

# ---------------------------------------------------------------------------
# write-suggestion — creates suggestion file
# ---------------------------------------------------------------------------
run_write_suggestion() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix write-suggestion walter \
    --title "Always check null" --body "Add a null check before dereferencing." \
    --source-postmortem "wiki/postmortems/demo/2026-05-13-login-crash.md" \
    --skill "a1-fix" 2>&1)
  exit_code=$?
  assert_rc "write-suggestion exit=0" 0 "$exit_code" "$out"
  local suggestions_dir="$VAULT/wiki/lessons/walter/_suggestions"
  assert "write-suggestion creates suggestions dir" "$([[ -d "$suggestions_dir" ]] && echo 1 || echo 0)"
  local file_count
  file_count=$(find "$suggestions_dir" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  assert "write-suggestion creates exactly one file" "$([[ "$file_count" == "1" ]] && echo 1 || echo 0)"
}

# ---------------------------------------------------------------------------
# Hostile inputs (mandatory per CONVENTIONS.md)
# ---------------------------------------------------------------------------

# (a) Path traversal on a slug/id-shaped flag — fix list <project-slug>
run_hostile_path_traversal() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix list "../../etc/passwd" 2>&1)
  exit_code=$?
  # Expected: either a clean non-crash result (count 0 / not-found) because
  # the resulting path lands outside the vault and has no fixes/ dir, or a
  # non-zero rejection — NOT a crash, and NOT actual traversal into /etc.
  if printf '%s' "$out" | grep -q 'passwd:x:'; then
    assert "fix list path-traversal does not leak /etc/passwd contents" "0"
  else
    assert "fix list path-traversal does not leak /etc/passwd contents" "1"
  fi
  assert_rc "fix list path-traversal handled gracefully (exit=0, empty result)" 0 "$exit_code" "$out"

  # find-duplicates on a traversal-shaped project slug should behave the same
  # way (no crash, no traversal read of arbitrary system files).
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix find-duplicates "../../etc/passwd" root 2>&1)
  exit_code=$?
  if printf '%s' "$out" | grep -q 'passwd:x:'; then
    assert "fix find-duplicates path-traversal does not leak /etc/passwd" "0"
  else
    assert "fix find-duplicates path-traversal does not leak /etc/passwd" "1"
  fi
}

# (b) Injection-shaped input stored inertly (never executed)
run_hostile_injection() {
  local marker_file="$WORK/injection-marker-fix"
  rm -f "$marker_file"
  local payload='; touch '"$marker_file"' ; $(touch '"$marker_file"') `touch '"$marker_file"'`'
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix write-suggestion injection-test \
    --title "Injection test" --body "$payload" 2>&1)
  exit_code=$?
  assert_rc "write-suggestion accepts injection-shaped body (exit=0)" 0 "$exit_code" "$out"
  assert "injection payload never executed (no marker file created)" "$([[ ! -f "$marker_file" ]] && echo 1 || echo 0)"

  local suggestion_file
  suggestion_file=$(find "$VAULT/wiki/lessons/injection-test/_suggestions" -name '*.md' 2>/dev/null | head -1)
  if [[ -n "${suggestion_file:-}" ]] && grep -qF '$(touch' "$suggestion_file" 2>/dev/null; then
    assert "injection payload stored inertly as literal text in suggestion file" "1"
  else
    assert "injection payload stored inertly as literal text in suggestion file" "0"
  fi

  # Injection-shaped bug-slug passed to init-postmortem must also be inert.
  rm -f "$marker_file"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem \
    '$(touch '"$marker_file"')' demo2 --date 2026-05-18 2>&1)
  exit_code=$?
  assert "init-postmortem injection-shaped slug never executed (no marker file)" "$([[ ! -f "$marker_file" ]] && echo 1 || echo 0)"
}

# (c) Oversized value on a free-text flag (>=10000 chars) — write-suggestion --body
run_hostile_oversized() {
  local big_body
  big_body=$(printf 'A%.0s' $(seq 1 10000))
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix write-suggestion oversize-test \
    --title "Oversized body" --body "$big_body" 2>&1)
  exit_code=$?
  # Expected: handled gracefully — either exit 0 (accepted/written) or a clean
  # non-zero rejection. Must not hang and must not crash with a stack trace.
  if [[ "$exit_code" -eq 0 || "$exit_code" -eq 1 ]]; then
    assert "write-suggestion oversized body (10000 chars) handled gracefully (exit=$exit_code)" "1"
  else
    assert "write-suggestion oversized body (10000 chars) handled gracefully (exit=$exit_code)" "0"
  fi
  if printf '%s' "$out" | grep -qi "TypeError\|ReferenceError\|at Object\.<anonymous>"; then
    assert "write-suggestion oversized body does not produce an uncaught stack trace" "0"
  else
    assert "write-suggestion oversized body does not produce an uncaught stack trace" "1"
  fi
}

# ---------- run all ----------
run_next_suffix
run_update_status
run_find_duplicates
run_integrity_check
run_init_postmortem
run_count_postmortems_since
run_update_promote_state
run_write_suggestion
run_hostile_path_traversal
run_hostile_injection
run_hostile_oversized

printf '\n--- a1-fix fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\na1-fix: %d passed, %d failed\n' "$pass" "$fail"

[[ $fail -eq 0 ]]
