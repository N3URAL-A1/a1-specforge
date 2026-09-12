#!/usr/bin/env bash
# Fixture: workflow-lint.cjs — pipeline exit-propagation linter (Wave 3 of
# spec 007-retro-gate-id-validator). `node a1-tools.cjs workflow lint` scans
# skills/*/workflows/*.md for lines inside ```bash fenced blocks where a
# command is piped into a parser and the PIPELINE's status (not the first
# command's) is then tested.
#
# Why this suite is fixture-based, not repo-based: measured 2026-09-11/12, the
# live repo has ZERO true positives — the 01-collect.md snippet was corrected
# the same morning the defect was found, and the only remaining pipe-with-||
# line (03-verify.md:140) is a legitimate value-default idiom, not a swallowed
# exit status. A naive "pipe on a line with ||" matcher produces exactly one
# finding against the real repo and it is a FALSE POSITIVE. So RED proof here
# comes from committed snippet fixtures under snippets/, one minimal markdown
# file per case — see CONVENTIONS.md's RED-proof section (FR-007).
#
# Every case names, in its own fixture file, the single production-code
# change that turns it red (wave plan's W1-W8 table).

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
SNIPPETS="$REPO_ROOT/_test-fixtures/a1-workflow-lint/snippets"

pass=0
fail=0
results=()

ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# ---------- W1: the 2026-09-11 snippet -> flagged ----------
# Red-making change: removing the `$?`-after-pipe predicate.
caseW1() {
  local work out rc file_ok line_ok
  work="$(mktemp -d)"
  mkdir -p "$work/skills/a1-fake/workflows"
  cp "$SNIPPETS/w1-piped-dollar-question.md" "$work/skills/a1-fake/workflows/01-collect.md"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  file_ok="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.some(f=>f.file.endsWith('01-collect.md'))));
  " "$out" 2>&1)"
  line_ok="$(node -e "
    const j=JSON.parse(process.argv[1]);
    const f=j.findings.find(x=>x.file.endsWith('01-collect.md'));
    process.stdout.write(String(!!(f && typeof f.line === 'number')));
  " "$out" 2>&1)"
  if [[ $rc -eq 1 && "$file_ok" == "true" && "$line_ok" == "true" ]]; then
    ok "W1 verbatim 2026-09-11 snippet is flagged, exit 1, finding names file+line"
  else
    bad "W1 verbatim 2026-09-11 snippet (rc=$rc file_ok=$file_ok line_ok=$line_ok out=$out)"
  fi
}

# ---------- W2: corrected capture-then-check form -> not flagged (SC-006) ----------
# Red-making change: widening the matcher to any pipe near a status test.
caseW2() {
  local work out rc flagged
  work="$(mktemp -d)"
  mkdir -p "$work/skills/a1-fake/workflows"
  cp "$SNIPPETS/w2-corrected-capture-then-check.md" "$work/skills/a1-fake/workflows/01-collect.md"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  flagged="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.length > 0));
  " "$out" 2>&1)"
  if [[ $rc -eq 0 && "$flagged" == "false" ]]; then
    ok "W2 corrected capture-then-check form is not flagged (SC-006)"
  else
    bad "W2 corrected form (rc=$rc flagged=$flagged out=$out)"
  fi
}

# ---------- W3: value-default `|| echo 0` not flagged ----------
# Red-making change: dropping the value-defaulting predicate. Must fail ALONE
# (W1 stays green) if this regresses.
caseW3() {
  local work out rc flagged
  work="$(mktemp -d)"
  mkdir -p "$work/skills/a1-fake/workflows"
  cp "$SNIPPETS/w3-value-default-not-flagged.md" "$work/skills/a1-fake/workflows/03-verify.md"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  flagged="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.length > 0));
  " "$out" 2>&1)"
  if [[ $rc -eq 0 && "$flagged" == "false" ]]; then
    ok "W3 value-default idiom is not flagged"
  else
    bad "W3 value-default idiom (rc=$rc flagged=$flagged out=$out)"
  fi
}

# ---------- W4: `|| exit` after a pipe -> flagged ----------
# Red-making change: implementing only the `$?` form.
caseW4() {
  local work out rc flagged
  work="$(mktemp -d)"
  mkdir -p "$work/skills/a1-fake/workflows"
  cp "$SNIPPETS/w4-pipe-then-exit.md" "$work/skills/a1-fake/workflows/02-cluster.md"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  flagged="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.some(f=>f.file.endsWith('02-cluster.md'))));
  " "$out" 2>&1)"
  if [[ $rc -eq 1 && "$flagged" == "true" ]]; then
    ok "W4 '|| exit' after a pipe is caught (non-\$? status-testing form)"
  else
    bad "W4 pipe-then-exit (rc=$rc flagged=$flagged out=$out)"
  fi
}

# ---------- W5: prose immunity ----------
# Red-making change: scanning the whole file instead of fenced blocks only.
caseW5() {
  local work out rc flagged
  work="$(mktemp -d)"
  mkdir -p "$work/skills/a1-fake/workflows"
  cp "$SNIPPETS/w5-prose-immunity.md" "$work/skills/a1-fake/workflows/01-collect.md"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  flagged="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.length > 0));
  " "$out" 2>&1)"
  if [[ $rc -eq 0 && "$flagged" == "false" ]]; then
    ok "W5 prose describing the bug (outside a fenced block) is not flagged"
  else
    bad "W5 prose immunity (rc=$rc flagged=$flagged out=$out)"
  fi
}

# ---------- W6: real repo scans clean -> 0 ----------
# Red-making change: any matcher that flags 03-verify.md:140.
caseW6() {
  local out rc
  out="$(node "$TOOLS" workflow lint --root "$REPO_ROOT" 2>/dev/null)"; rc=$?
  if [[ $rc -eq 0 ]]; then
    ok "W6 real repo scans clean (exit 0, no false positive on 03-verify.md:140)"
  else
    bad "W6 real repo scan (rc=$rc out=$out)"
  fi
}

# ---------- W7: glob liveness of its own scan ----------
# Red-making change: a glob typo (e.g. singular "workflow") that returns 0
# files and exits 0 — the dead-glob class, self-applied. 64 files exist today;
# assert >= 60 so the case tolerates future file additions without pinning an
# exact count (see gate-ids R2's "never assert a live count" precedent).
caseW7() {
  local out rc scanned
  out="$(node "$TOOLS" workflow lint --root "$REPO_ROOT" 2>/dev/null)"; rc=$?
  scanned="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.scanned));
  " "$out" 2>&1)"
  if [[ $rc -eq 0 ]] && [[ "$scanned" =~ ^[0-9]+$ ]] && [[ "$scanned" -ge 60 ]]; then
    ok "W7 scan visited >= 60 files (scanned=$scanned)"
  else
    bad "W7 glob liveness (rc=$rc scanned=$scanned out=$out)"
  fi
}

# ---------- W8: hostile input (mandatory) ----------
# --root pointing at traversal / injection-shaped / oversized value must each
# exit 2, nothing executed, no hang.
caseW8() {
  local home canary rc1 rc2 rc3 work timed_out child_pid rc_file big
  home="$(mktemp -d)"; canary="$home/pwned"
  work="$(mktemp -d)"

  # (a) traversal-shaped --root that resolves to a real file, not a directory
  # (mirrors V9's "reach a distinct real branch" lesson: pick a target that
  # EXISTS so the guard under test, not a not-found check, produces the exit).
  mkdir -p "$work/sub/deeper"
  : > "$work/a-file"
  rc1=0
  node "$TOOLS" workflow lint --root "$work/sub/deeper/../../a-file" >/dev/null 2>&1 || rc1=$?

  # (b) injection-shaped value — must be treated as an inert string.
  rc2=0
  node "$TOOLS" workflow lint --root "; touch $canary" >/dev/null 2>&1 || rc2=$?

  # (c) oversized value (>= 10000 chars) — must fail fast, not hang.
  big="$(head -c 10005 /dev/zero | tr '\0' 'a')"
  rc_file="$work/oversized-rc.txt"
  (
    node "$TOOLS" workflow lint --root "/$big" >/dev/null 2>&1
    echo $? > "$rc_file"
  ) &
  child_pid=$!
  timed_out=0
  for _ in $(seq 1 50); do
    kill -0 "$child_pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$child_pid" 2>/dev/null; then
    timed_out=1
    kill -9 "$child_pid" 2>/dev/null
  fi
  wait "$child_pid" 2>/dev/null
  rc3="$(cat "$rc_file" 2>/dev/null || echo 124)"

  if [[ $rc1 -eq 2 && $rc2 -eq 2 && "$timed_out" -eq 0 && "$rc3" -eq 2 ]] && [[ ! -e "$canary" ]]; then
    ok "W8 hostile input: traversal/injection/oversized --root all rejected, nothing executed"
  else
    bad "W8 hostile input (rc1=$rc1 rc2=$rc2 rc3=$rc3 timed_out=$timed_out canary=$([[ -e $canary ]] && echo CREATED || echo absent))"
  fi
}

# ---------- W9: the REAL 2026-09-11 snippet, taken from git ----------
# SC-006 says the linter must flag "the exact snippet as committed on
# 2026-09-11". W1 used a RECONSTRUCTION built from the plan's prose
# ($?-after-pipe) and passed — while the linter did NOT flag the real thing,
# because the real pipeline spans three physical lines joined by backslash
# continuations: `| python3` on one line, `||` on the next. Line-local matching
# never saw both halves. Found by a1-victor-verifier on 2026-09-12, which
# fetched the file from git instead of trusting the fixture.
#
# This case uses the verbatim git extract. Red-making change: removing the
# joinContinuations() call in scanFileForFindings — the form the guard exists
# for goes unflagged again.
caseW9() {
  local work out rc found
  work="$(mktemp -d)"
  mkdir -p "$work/skills/a1-evolve/workflows"
  cp "$SNIPPETS/w9-real-2026-09-11-from-git.md" "$work/skills/a1-evolve/workflows/01-collect.md"
  out="$(node "$TOOLS" workflow lint --root "$work" 2>/dev/null)"; rc=$?
  found="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.length));
  " "$out" 2>&1)"
  if [[ $rc -eq 1 && "$found" == "1" ]]; then
    ok "W9 the real backslash-continued 2026-09-11 snippet is flagged"
  else
    bad "W9 real 2026-09-11 snippet flagged (rc=$rc found=$found out=$out)"
  fi
}

caseW1; caseW2; caseW3; caseW4; caseW5; caseW6; caseW7; caseW8; caseW9

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-workflow-lint: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
