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
  local fixes_dir="$VAULT/project/demo/fixes"
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
  local fixes_dir="$VAULT/project/demo/fixes"
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
    "project/demo/fixes/2026-05-14-auth-bug.md" diagnosed 2>&1)
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
    "project/demo/fixes/2026-05-14-auth-bug.md" bogus-status 2>&1)
  exit_code=$?
  assert_rc "update-status rejects invalid status" 1 "$exit_code" "$out"

  # Missing bug file
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-status \
    "project/demo/fixes/does-not-exist.md" diagnosed 2>&1)
  exit_code=$?
  assert_rc "update-status rejects missing bug file" 1 "$exit_code" "$out"
}

# ---------------------------------------------------------------------------
# find-duplicates — no dupes / has dupes
# ---------------------------------------------------------------------------
run_find_duplicates() {
  local fixes_dir="$VAULT/project/demo/fixes"
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
  local expected_file="$VAULT/project/demo/postmortems/2026-05-13-login-crash.md"
  assert "init-postmortem creates expected file" "$([[ -f "$expected_file" ]] && echo 1 || echo 0)"
  if grep -q '^one_line_learning: "Always validate session tokens"$' "$expected_file" 2>/dev/null; then
    assert "init-postmortem writes one_line_learning to frontmatter" "1"
  else
    assert "init-postmortem writes one_line_learning to frontmatter" "0"
  fi
}

# ---------------------------------------------------------------------------
# init-postmortem — hostile slugs, date and flag values (Samuel MINOR-6,
# 2026-09-28). Red-making changes: (a) postmortemsDir joining the raw project
# slug again (traversal cases write under $WORK/escaped*); (b) dropping the
# date check (the --date case writes outside); (c) dropping the line-break
# check (the --severity case injects a second frontmatter key); (d) writing
# one_line_learning without escaping (the quote case breaks the frontmatter).
# ---------------------------------------------------------------------------
run_init_postmortem_hostile() {
  local out exit_code
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem bug-a "../../escaped" --date 2026-05-14 2>&1)
  exit_code=$?
  assert_rc "init-postmortem traversal project slug rejected (exit=2)" 2 "$exit_code" "$out"
  assert "init-postmortem traversal project slug writes nothing outside the vault" \
    "$([[ -e "$WORK/escaped" || -e "$(dirname "$WORK")/escaped" ]] && echo 0 || echo 1)"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem "../escaped-bug" demo --date 2026-05-14 2>&1)
  exit_code=$?
  assert_rc "init-postmortem traversal bug slug rejected (exit=2)" 2 "$exit_code" "$out"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem bug-b demo --date "../../../escaped-date/d" 2>&1)
  exit_code=$?
  assert_rc "init-postmortem non-date --date rejected (exit=1)" 1 "$exit_code" "$out"
  assert "init-postmortem bad --date writes nothing outside the vault" \
    "$([[ -e "$(dirname "$WORK")/escaped-date" || -e "$WORK/escaped-date" ]] && echo 0 || echo 1)"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem bug-c demo --date 2026-05-14 \
    --severity "$(printf 'major\ntype: injected')" 2>&1)
  exit_code=$?
  assert_rc "init-postmortem line break in a flag value rejected (exit=1)" 1 "$exit_code" "$out"
  assert "init-postmortem line-break case writes no file" \
    "$([[ -e "$VAULT/project/demo/postmortems/2026-05-14-bug-c.md" ]] && echo 0 || echo 1)"

  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix init-postmortem bug-d demo --date 2026-05-14 \
    --one-line-learning 'say "hi" and \ back' 2>&1)
  exit_code=$?
  assert_rc "init-postmortem quoted learning accepted (exit=0)" 0 "$exit_code" "$out"
  local f="$VAULT/project/demo/postmortems/2026-05-14-bug-d.md"
  # Checked with an independent YAML parser (PyYAML), as Obsidian reads it —
  # the repo's own parser is lenient and would accept the unescaped form too.
  if ! python3 -c 'import yaml' 2>/dev/null; then
    assert "init-postmortem quoted learning is valid YAML (PyYAML missing — skipped)" "1"
  elif python3 -c 'import sys,yaml; t=open(sys.argv[1]).read().split("---")[1]; sys.exit(0 if yaml.safe_load(t)["one_line_learning"]==sys.argv[2] else 1)' \
       "$f" 'say "hi" and \ back' 2>/dev/null; then
    assert "init-postmortem quoted learning round-trips through a YAML parser" "1"
  else
    assert "init-postmortem quoted learning round-trips through a YAML parser" "0"
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
  local state_file="$VAULT/pattern/a1-learnings/_state/last_promote.json"
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
    --source-postmortem "project/demo/postmortems/2026-05-13-login-crash.md" \
    --skill "a1-fix" 2>&1)
  exit_code=$?
  assert_rc "write-suggestion exit=0" 0 "$exit_code" "$out"
  local suggestions_dir="$VAULT/pattern/a1-learnings/lessons/walter/_suggestions"
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
  # Expected since M12: deterministic loud rejection (exit 2, clear message)
  # from the central projectsPath() traversal guard — NOT a crash, NOT a
  # silent empty result, and NOT actual traversal into /etc.
  if printf '%s' "$out" | grep -q 'passwd:x:'; then
    assert "fix list path-traversal does not leak /etc/passwd contents" "0"
  else
    assert "fix list path-traversal does not leak /etc/passwd contents" "1"
  fi
  assert_rc "fix list path-traversal rejected loudly (exit=2, guard message)" 2 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q 'plain identifier without path separators'; then
    assert "fix list path-traversal rejection names the guard rule" "1"
  else
    assert "fix list path-traversal rejection names the guard rule" "0"
  fi

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
  suggestion_file=$(find "$VAULT/pattern/a1-learnings/lessons/injection-test/_suggestions" -name '*.md' 2>/dev/null | head -1)
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

# ---------------------------------------------------------------------------
# class_query gate of update-status (spec 017 Wave 9, FR-027). The bug file is the
# real report frontmatter (copied for a1-fix-class-sweep, origin in its real/ORIGIN.md).
# Deep cases (malformed variants, class sweep) live in _test-fixtures/a1-fix-class-sweep/.
# ---------------------------------------------------------------------------
run_class_query_gate() {
  local fixes_dir="$VAULT/project/demo/fixes" real="$REPO_ROOT/_test-fixtures/a1-fix-class-sweep/real/bug-frontmatter.txt"
  local f="$fixes_dir/2026-10-03-real-report.md" out exit_code
  mkdir -p "$fixes_dir"
  { grep -v '^status:' "$real"; printf 'status: reported\n---\n\n# Bug\n'; } > "$f"
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-status "$f" diagnosed --enforced-since 2026-01-01 2>&1)
  exit_code=$?
  assert_rc "update-status diagnosed without class_query exits 1" 1 "$exit_code" "$out"
  if printf '%s' "$out" | grep -q '"reason": "class_query_missing"'; then
    assert "update-status refusal names class_query_missing" "1"
  else
    assert "update-status refusal names class_query_missing" "0"
  fi
  if grep -q '^status: reported$' "$f"; then
    assert "refused update-status leaves the file at status: reported" "1"
  else
    assert "refused update-status leaves the file at status: reported" "0"
  fi
  out=$(A1_VAULT_ROOT="$VAULT" node "$TOOLS" fix update-status "$f" diagnosed 2>&1)
  exit_code=$?
  assert_rc "legacy bug file (dated before ENFORCED_SINCE) skips the class_query check" 0 "$exit_code" "$out"
  if grep -q '^status: diagnosed$' "$f"; then
    assert "legacy bug file reached status: diagnosed" "1"
  else
    assert "legacy bug file reached status: diagnosed" "0"
  fi
}

# ---------- spec 017 wave 12 (FR-006, FR-032): skills/a1-fix/workflows wiring ----------
# Measured red 2026-10-21 (git-archive snapshot, one line reverted, suite run):
#   04-verify.md: class-sweep flag renamed (--verify -> --check)  : call-site flags case
#   04-verify.md: --phase dropped from the realpath-check call      : --phase x3 case
#   04-verify.md: test-fidelity --diff-base -> --base               : --diff-base + flags cases (2 red)
#   02-diagnose.md: class-sweep --record block removed              : order + record-call cases (2 red)
#   00-preflight.md: --phase dropped from integrity-check           : preflight --phase case
# Blocks are read from the real workflow files; flags are checked against the real help text of each command.
run_wave12_wiring() {
  local wf="$REPO_ROOT/skills/a1-fix/workflows" out
  out=$(node -e '
    const fs=require("fs"), path=require("path");
    const wf=process.argv[1], lib=path.join(process.argv[2],"_shared","lib");
    const blocks=f=>{const t=fs.readFileSync(path.join(wf,f),"utf8");const o=[];const re=/^```bash\n([\s\S]*?)^```/gm;let m;
      while((m=re.exec(t))) o.push({text:m[1],pos:m.index,src:t});return o;};
    const v=blocks("04-verify.md"), d=blocks("02-diagnose.md"), p=blocks("00-preflight.md");
    const step1=v[0].src.indexOf("## Step 1");
    const pre=v.filter(b=>b.pos<step1);
    const kind=b=>/realpath-check run/.test(b.text)?"R":/test-fidelity/.test(b.text)?"T":/fix class-sweep --verify/.test(b.text)?"C":"?";
    const res=[];
    res.push(["verify step0 block count",pre.length===3]);
    res.push(["verify step0 order R,T,C",pre.map(kind).join("")==="RTC"]);
    res.push(["verify step0 before symptom question",step1>0&&v[0].src.indexOf("Does the symptom still occur")>step1]);
    res.push(["verify step0 explicit exit test x3",pre.filter(b=>/RC=\$\?/.test(b.text)&&/-ne 0/.test(b.text)&&/exit "\$RC"/.test(b.text)).length===3]);
    res.push(["verify step0 --phase fix-<bug-slug> x3",pre.filter(b=>/--phase fix-<bug-slug>/.test(b.text)).length===3]);
    res.push(["verify test-fidelity has --diff-base",pre.filter(b=>/test-fidelity --diff-base /.test(b.text)).length===1]);
    const fixed=v.findIndex(b=>/fix update-status[\s\S]*fixed/.test(b.text));
    res.push(["verify mark-fixed block stays, after step0",fixed>=3&&v[fixed].pos>pre[2].pos]);
    const dk=d.map(b=>/class-sweep --record/.test(b.text)?"S":/fix update-status/.test(b.text)?"U":"?").join("");
    res.push(["diagnose order: class-sweep --record before update-status",dk==="SU"]);
    const rec=d.filter(b=>/class-sweep --record/.test(b.text));
    res.push(["diagnose record call: exit test + --phase",rec.length===1&&/exit "\$RC"/.test(rec[0].text)&&/--phase fix-<bug-slug>/.test(rec[0].text)]);
    res.push(["diagnose update-status has no --phase (takes none)",d.filter(b=>/fix update-status/.test(b.text)&&/--phase/.test(b.text)).length===0]);
    res.push(["preflight gate calls pass --phase fix-<bug-slug> x2",p.filter(b=>/(integrity-check|code-scope check)/.test(b.text)&&/--phase fix-<bug-slug>/.test(b.text)).length===2]);
    // real flags: every --flag at a call site must exist in that command real help text (+ --phase, stripped by the facade)
    const flagsOf=h=>new Set((h.match(/--[a-z][a-z-]*/g)||[]));
    const sweep=flagsOf(require(path.join(lib,"help-fix-sweep.cjs")).FIX_SWEEP_HELP);
    const fid=flagsOf(require(path.join(lib,"help-fidelity.cjs")).FIDELITY_HELP);
    const real=flagsOf(fs.readFileSync(path.join(lib,"help.cjs"),"utf8").split("a1-tools realpath-check run")[1].split("\n")[0]);
    const bad=[];
    const chk=(b,set)=>{for(const f of (b.text.match(/--[a-z][a-z-]*/g)||[])) if(f!=="--phase"&&!set.has(f)) bad.push(f);};
    for(const b of pre){chk(b,kind(b)==="R"?real:kind(b)==="T"?fid:sweep);}
    for(const b of rec) chk(b,sweep);
    res.push(["call-site flags exist in real help (bad="+bad.join(",")+")",bad.length===0&&real.size>=2&&sweep.size>=3&&fid.size>=1]);
    for(const [n,ok] of res) console.log((ok?"1 ":"0 ")+n);
  ' "$wf" "$REPO_ROOT" 2>&1)
  local line n=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    n=$((n + 1))
    assert "wave12 wiring: ${line:2}" "$([[ "${line:0:1}" == "1" ]] && echo 1 || echo 0)"
  done <<< "$out"
  assert "wave12 wiring: all 12 checks ran (count)" "$([[ "$n" -eq 12 ]] && echo 1 || echo 0)"
  local lint_rc
  node "$TOOLS" workflow lint --root "$REPO_ROOT" >/dev/null 2>&1; lint_rc=$?
  assert_rc "wave12 wiring: workflow lint on the real skills is clean" 0 "$lint_rc" ""
}

# ---------- run all ----------
run_next_suffix
run_update_status
run_class_query_gate
run_find_duplicates
run_integrity_check
run_init_postmortem
run_init_postmortem_hostile
run_count_postmortems_since
run_update_promote_state
run_write_suggestion
run_hostile_path_traversal
run_hostile_injection
run_hostile_oversized
run_wave12_wiring

printf '\n--- a1-fix fixture results ---\n'
for r in "${results[@]}"; do printf '%s\n' "$r"; done
printf '\na1-fix: %d passed, %d failed\n' "$pass" "$fail"

[[ $fail -eq 0 ]]
