#!/usr/bin/env bash
# Smoke tests for the `constitution` subcommand group in _shared/a1-tools.cjs.
# F-007 fixture — this group had ZERO fixture coverage before M10 Wave 15.
# Written against the CURRENT (pre-Wave-16) facade-resident code; this suite
# is the regression net for Wave 16's extraction of `constitution` into
# lib/constitution.cjs.
#
# Covers: init (scaffold), discover, update-status (valid + invalid),
# set-body, next-version (several input variants), archive-current
# (verifying it correctly calls next-version internally), write-mirror,
# link-claudemd, list, plus mandatory hostile-input cases (path traversal,
# injection-shaped body text, oversized body) per CONVENTIONS.md.

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
# init — scaffold
# ---------------------------------------------------------------------------
run_init() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution init demo \
    --title "Demo Constitution" 2>&1)
  exit_code=$?
  assert_rc "init exit=0" 0 "$exit_code" "$out"
  local const_file="$VAULT/projects/demo/constitution/constitution.md"
  assert "init creates constitution.md" "$([[ -f "$const_file" ]] && echo 1 || echo 0)"
  if grep -q '^status: discovering$' "$const_file" 2>/dev/null && \
     grep -q '^version: 1$' "$const_file" 2>/dev/null; then
    assert "init frontmatter has status=discovering, version=1" "1"
  else
    assert "init frontmatter has status=discovering, version=1" "0"
  fi
  if grep -q '^title: "Demo Constitution"$' "$const_file" 2>/dev/null; then
    assert "init frontmatter has given title" "1"
  else
    assert "init frontmatter has given title" "0"
  fi

  # Re-init on top of existing constitution must fail (no silent overwrite).
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution init demo 2>&1)
  exit_code=$?
  assert_rc "init rejects re-init over existing constitution" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# discover
# ---------------------------------------------------------------------------
run_discover() {
  local project_dir="$WORK/project-demo"
  mkdir -p "$project_dir"
  cat > "$project_dir/CLAUDE.md" <<'EOF'
# Demo Project

See constitution.md for behavioral rules.
EOF

  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution discover demo \
    --project-path "$project_dir" 2>&1)
  exit_code=$?
  assert_rc "discover exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"claudemd_present": true'; then
    assert "discover finds CLAUDE.md" "1"
  else
    assert "discover finds CLAUDE.md" "0"
  fi
  if printf '%s' "$out" | grep -q '"has_link_to_constitution": true'; then
    assert "discover detects existing constitution.md cross-link" "1"
  else
    assert "discover detects existing constitution.md cross-link" "0"
  fi

  # Missing project-slug rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution discover 2>&1)
  exit_code=$?
  assert_rc "discover rejects missing project-slug" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# update-status — valid transition + invalid-status rejection
# ---------------------------------------------------------------------------
run_update_status() {
  local const_file="$VAULT/projects/demo/constitution/constitution.md"
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution update-status \
    "projects/demo/constitution/constitution.md" drafted 2>&1)
  exit_code=$?
  assert_rc "update-status valid transition exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"status": "drafted"'; then
    assert "update-status transitions to drafted" "1"
  else
    assert "update-status transitions to drafted" "0"
  fi
  if grep -Eq '^\s*-\s*"?phase=draft' "$const_file" 2>/dev/null; then
    assert "update-status appends phase_history entry (phase=draft)" "1"
  else
    assert "update-status appends phase_history entry (phase=draft)" "0"
  fi

  # written status also stamps last_written_at.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution update-status \
    "projects/demo/constitution/constitution.md" written 2>&1)
  if printf '%s' "$out" | grep -q '"last_written_at": null'; then
    assert "update-status stamps last_written_at on 'written' transition" "0"
  else
    assert "update-status stamps last_written_at on 'written' transition" "1"
  fi

  # Invalid status rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution update-status \
    "projects/demo/constitution/constitution.md" bogus-status 2>&1)
  exit_code=$?
  assert_rc "update-status rejects invalid status" 1 "$exit_code" "$out"

  # Missing constitution file.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution update-status \
    "projects/demo/constitution/does-not-exist.md" drafted 2>&1)
  exit_code=$?
  assert_rc "update-status rejects missing constitution file" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# set-body
# ---------------------------------------------------------------------------
run_set_body() {
  local body_file="$WORK/new-body.md"
  cat > "$body_file" <<'EOF'
# Demo Constitution

## Override Precedence (4 Layers)

1. Security > 2. Product spec > 3. Style > 4. Preference

## Project Behavioral Rules

Always validate input at system boundaries.
EOF
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution set-body \
    "projects/demo/constitution/constitution.md" --body-file "$body_file" 2>&1)
  exit_code=$?
  assert_rc "set-body exit=0" 0 "$exit_code" "$out"
  local const_file="$VAULT/projects/demo/constitution/constitution.md"
  if grep -q "Always validate input at system boundaries." "$const_file" 2>/dev/null; then
    assert "set-body writes new body content" "1"
  else
    assert "set-body writes new body content" "0"
  fi
  # Frontmatter must be preserved (status/version still present after set-body).
  if grep -q '^status: written$' "$const_file" 2>/dev/null; then
    assert "set-body preserves existing frontmatter" "1"
  else
    assert "set-body preserves existing frontmatter" "0"
  fi

  # Missing body-file rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution set-body \
    "projects/demo/constitution/constitution.md" --body-file "$WORK/no-such-file.md" 2>&1)
  exit_code=$?
  assert_rc "set-body rejects missing body-file" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# next-version — version-bump arithmetic, several input variants
# ---------------------------------------------------------------------------
run_next_version() {
  local out exit_code
  # No history yet -> next is 1.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version fresh-project 2>&1)
  exit_code=$?
  assert_rc "next-version no-history exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"next": 1'; then
    assert "next-version returns 1 when no history exists" "1"
  else
    assert "next-version returns 1 when no history exists" "0"
  fi

  # Create history entries v1..v3 (out of numeric order on disk) -> next is 4.
  local hist_dir="$VAULT/projects/versioned-project/constitution/history"
  mkdir -p "$hist_dir"
  touch "$hist_dir/2026-01-01-v1.md"
  touch "$hist_dir/2026-02-01-v3.md"
  touch "$hist_dir/2026-01-15-v2.md"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version versioned-project 2>&1)
  exit_code=$?
  assert_rc "next-version with-history exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"next": 4'; then
    assert "next-version returns max+1 (4) regardless of file listing order" "1"
  else
    assert "next-version returns max+1 (4) regardless of file listing order" "0"
  fi

  # Double-digit version numbers parse correctly (v9 -> next 10, not lexical-max).
  local hist2_dir="$VAULT/projects/double-digit-project/constitution/history"
  mkdir -p "$hist2_dir"
  touch "$hist2_dir/2026-01-01-v2.md"
  touch "$hist2_dir/2026-01-02-v9.md"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version double-digit-project 2>&1)
  if printf '%s' "$out" | grep -q '"next": 10'; then
    assert "next-version handles double-digit version numbers (v9 -> 10)" "1"
  else
    assert "next-version handles double-digit version numbers (v9 -> 10)" "0"
  fi

  # Missing project-slug rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version 2>&1)
  exit_code=$?
  assert_rc "next-version rejects missing project-slug" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# archive-current — verify it correctly calls next-version internally
# ---------------------------------------------------------------------------
run_archive_current() {
  # Use a fresh project so the version counter is deterministic.
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution init archive-demo \
    --title "Archive Demo" 2>&1)
  exit_code=$?
  assert_rc "archive-current setup: init archive-demo exit=0" 0 "$exit_code" "$out"

  # Direct next-version call BEFORE archiving — expect 1 (no history yet).
  local direct_next
  direct_next=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version archive-demo 2>&1 \
    | grep -o '"next": [0-9]*' | grep -o '[0-9]*')
  assert "archive-current setup: direct next-version call returns 1" "$([[ "$direct_next" == "1" ]] && echo 1 || echo 0)"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution archive-current archive-demo \
    --date 2026-05-20 2>&1)
  exit_code=$?
  assert_rc "archive-current exit=0" 0 "$exit_code" "$out"
  local snapshot_file="$VAULT/projects/archive-demo/constitution/history/2026-05-20-v${direct_next}.md"
  assert "archive-current writes snapshot named v${direct_next} (matches direct next-version call)" \
    "$([[ -f "$snapshot_file" ]] && echo 1 || echo 0)"
  if printf '%s' "$out" | grep -q "\"new_version\": $((direct_next + 1))"; then
    assert "archive-current bumps live version to next_version+1 ($((direct_next + 1)))" "1"
  else
    assert "archive-current bumps live version to next_version+1 ($((direct_next + 1)))" "0"
  fi

  # A second direct next-version call AFTER archiving must now return next_version+1
  # (the archived snapshot is visible in history/), proving archive-current's
  # internal next-version usage and a fresh external call agree.
  local second_next
  second_next=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version archive-demo 2>&1 \
    | grep -o '"next": [0-9]*' | grep -o '[0-9]*')
  assert "archive-current's internal next-version call matches a subsequent direct call" \
    "$([[ "$second_next" == "$((direct_next + 1))" ]] && echo 1 || echo 0)"

  # No current constitution to archive -> rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution archive-current no-such-project 2>&1)
  exit_code=$?
  assert_rc "archive-current rejects when no current constitution exists" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# write-mirror
# ---------------------------------------------------------------------------
run_write_mirror() {
  local repo_root="$WORK/mirror-repo"
  mkdir -p "$repo_root"
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution write-mirror demo \
    --repo-root "$repo_root" 2>&1)
  exit_code=$?
  assert_rc "write-mirror exit=0" 0 "$exit_code" "$out"
  local mirror_file="$repo_root/constitution.md"
  assert "write-mirror creates constitution.md in repo root" "$([[ -f "$mirror_file" ]] && echo 1 || echo 0)"
  if grep -q "Generated mirror" "$mirror_file" 2>/dev/null; then
    assert "write-mirror includes the generated-mirror header" "1"
  else
    assert "write-mirror includes the generated-mirror header" "0"
  fi

  # Relative --repo-root rejected (must be absolute).
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution write-mirror demo \
    --repo-root "relative/path" 2>&1)
  exit_code=$?
  assert_rc "write-mirror rejects relative --repo-root" 1 "$exit_code" "$out"

  # Nonexistent repo-root rejected.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution write-mirror demo \
    --repo-root "/no/such/absolute/dir/xyz123" 2>&1)
  exit_code=$?
  assert_rc "write-mirror rejects nonexistent --repo-root" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# link-claudemd
# ---------------------------------------------------------------------------
run_link_claudemd() {
  local repo_root="$WORK/link-repo"
  mkdir -p "$repo_root"
  cat > "$repo_root/CLAUDE.md" <<'EOF'
# Some Project

Some existing content.
EOF
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution link-claudemd demo \
    --repo-root "$repo_root" 2>&1)
  exit_code=$?
  assert_rc "link-claudemd exit=0" 0 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"action": "appended"'; then
    assert "link-claudemd appends block on first run" "1"
  else
    assert "link-claudemd appends block on first run" "0"
  fi
  if grep -q '<!-- a1-constitution:link -->' "$repo_root/CLAUDE.md" 2>/dev/null; then
    assert "link-claudemd writes marker block to CLAUDE.md" "1"
  else
    assert "link-claudemd writes marker block to CLAUDE.md" "0"
  fi

  # Idempotent second run must UPDATE (not duplicate) the block.
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution link-claudemd demo \
    --repo-root "$repo_root" 2>&1)
  if printf '%s' "$out" | grep -q '"action": "updated"'; then
    assert "link-claudemd updates (not duplicates) on second run" "1"
  else
    assert "link-claudemd updates (not duplicates) on second run" "0"
  fi
  local marker_count
  marker_count=$(grep -c '<!-- a1-constitution:link -->' "$repo_root/CLAUDE.md")
  assert "link-claudemd leaves exactly one marker block after idempotent re-run" \
    "$([[ "$marker_count" == "1" ]] && echo 1 || echo 0)"

  # Missing CLAUDE.md rejected.
  local no_claudemd_repo="$WORK/no-claudemd-repo"
  mkdir -p "$no_claudemd_repo"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution link-claudemd demo \
    --repo-root "$no_claudemd_repo" 2>&1)
  exit_code=$?
  assert_rc "link-claudemd rejects missing CLAUDE.md" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------
run_list() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution list 2>&1)
  exit_code=$?
  assert_rc "list exit=0" 0 "$exit_code" "$out"
  local count
  count=$(printf '%s' "$out" | grep -o '"count": [0-9]*' | grep -o '[0-9]*')
  # By this point demo, archive-demo constitutions exist (init'd earlier).
  if [[ "${count:-0}" -ge 2 ]]; then
    assert "list finds >=2 constitutions (got $count)" "1"
  else
    assert "list finds >=2 constitutions (got $count)" "0"
  fi
  if printf '%s' "$out" | grep -q '"project": "demo"'; then
    assert "list includes the demo project" "1"
  else
    assert "list includes the demo project" "0"
  fi
}

# ---------------------------------------------------------------------------
# Hostile inputs (mandatory per CONVENTIONS.md)
# ---------------------------------------------------------------------------

# (a) Path traversal on a project-slug-shaped flag.
run_hostile_path_traversal() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution next-version "../../etc/passwd" 2>&1)
  exit_code=$?
  if printf '%s' "$out" | grep -q 'root:x:0:0'; then
    assert "next-version path-traversal does not leak /etc/passwd contents" "0"
  else
    assert "next-version path-traversal does not leak /etc/passwd contents" "1"
  fi
  assert_rc "next-version path-traversal handled gracefully (no history dir found -> next=1)" \
    0 "$exit_code" "$out"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution discover "../../etc/passwd" 2>&1)
  exit_code=$?
  if printf '%s' "$out" | grep -q 'root:x:0:0'; then
    assert "discover path-traversal does not leak /etc/passwd contents" "0"
  else
    assert "discover path-traversal does not leak /etc/passwd contents" "1"
  fi
}

# (b) Injection-shaped body text via set-body — assert stored inertly.
run_hostile_injection() {
  local marker_file="$WORK/injection-marker-constitution"
  rm -f "$marker_file"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution init injection-test 2>&1)
  local exit_code=$?
  assert_rc "hostile-injection setup: init injection-test exit=0" 0 "$exit_code" "$out"

  local payload_file="$WORK/injection-body.md"
  printf '# Injection Test\n\n; touch %s ; $(touch %s) `touch %s`\n' \
    "$marker_file" "$marker_file" "$marker_file" > "$payload_file"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution set-body \
    "projects/injection-test/constitution/constitution.md" --body-file "$payload_file" 2>&1)
  exit_code=$?
  assert_rc "set-body accepts injection-shaped body (exit=0)" 0 "$exit_code" "$out"
  assert "injection payload never executed (no marker file created)" "$([[ ! -f "$marker_file" ]] && echo 1 || echo 0)"

  local const_file="$VAULT/projects/injection-test/constitution/constitution.md"
  if grep -qF '$(touch' "$const_file" 2>/dev/null; then
    assert "injection payload stored inertly as literal text in constitution body" "1"
  else
    assert "injection payload stored inertly as literal text in constitution body" "0"
  fi

  # Injection-shaped --title on init must also be inert.
  rm -f "$marker_file"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution init injection-test-2 \
    --title '$(touch '"$marker_file"')' 2>&1)
  assert "init injection-shaped title never executed (no marker file)" "$([[ ! -f "$marker_file" ]] && echo 1 || echo 0)"
}

# (c) Oversized body text (>=10000 chars) via set-body.
run_hostile_oversized() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution init oversize-test 2>&1)
  exit_code=$?
  assert_rc "hostile-oversized setup: init oversize-test exit=0" 0 "$exit_code" "$out"

  local big_body_file="$WORK/oversized-body.md"
  { printf '# Oversized\n\n'; printf 'A%.0s' $(seq 1 10000); printf '\n'; } > "$big_body_file"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" constitution set-body \
    "projects/oversize-test/constitution/constitution.md" --body-file "$big_body_file" 2>&1)
  exit_code=$?
  if [[ "$exit_code" -eq 0 || "$exit_code" -eq 1 ]]; then
    assert "set-body oversized body (10000+ chars) handled gracefully (exit=$exit_code)" "1"
  else
    assert "set-body oversized body (10000+ chars) handled gracefully (exit=$exit_code)" "0"
  fi
  if printf '%s' "$out" | grep -qi "TypeError\|ReferenceError\|at Object\.<anonymous>"; then
    assert "set-body oversized body does not produce an uncaught stack trace" "0"
  else
    assert "set-body oversized body does not produce an uncaught stack trace" "1"
  fi
}

# ---------- run all ----------
run_init
run_discover
run_update_status
run_set_body
run_next_version
run_archive_current
run_write_mirror
run_link_claudemd
run_list
run_hostile_path_traversal
run_hostile_injection
run_hostile_oversized

printf '\n--- a1-constitution fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\na1-constitution: %d passed, %d failed\n' "$pass" "$fail"

[[ $fail -eq 0 ]]
