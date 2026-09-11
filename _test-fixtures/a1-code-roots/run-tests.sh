#!/usr/bin/env bash
# Fixture: codeRoots() resolution chain + `learnings roots` CLI contract.
#
# Tiers:  env (A1_CODE_ROOTS) > autodetect (~/claude-projects, ~/code, ...) 
#         > repo-parent (git) → exit 3 when nothing resolves.
#
# Every case runs with a fresh fake HOME so the test never depends on the real
# machine's layout. Why this suite exists: a1-evolve's collect globs were
# hardcoded to ~/code, which does not exist on every machine, and a glob that
# matches nothing reports "no learnings" instead of failing (2026-09-11).

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0
fail=0
results=()

ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# ---------- Case A: env wins over autodetect ----------
# A1_CODE_ROOTS set to an existing dir → that dir is returned, source: env,
# even though the fake HOME also has a ~/code that autodetect would find.
caseA() {
  local home declared out err rc
  home="$(mktemp -d)"; declared="$(mktemp -d)"
  mkdir -p "$home/code"            # decoy autodetect would pick
  out="$(cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="$declared" \
        node "$TOOLS" learnings roots 2>"$home/err")"; rc=$?
  err="$(cat "$home/err")"
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$out" | grep -q "$declared" \
     && ! printf '%s' "$out" | grep -q "$home/code" \
     && printf '%s' "$err" | grep -q 'source: env'; then
    ok "A env wins over autodetect (exit=$rc)"
  else
    bad "A env wins over autodetect (exit=$rc)"; results+=("      out: $out")
  fi
}

# ---------- Case B: env with only non-existent paths hard-fails ----------
# Declared-but-missing must NOT silently fall through to autodetect — a typo in
# A1_CODE_ROOTS would otherwise look like a working setup.
caseB() {
  local home out rc
  home="$(mktemp -d)"
  mkdir -p "$home/code"            # autodetect COULD rescue it — must not
  out="$(cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="/nope/xyz:/also/missing" \
        node "$TOOLS" learnings roots 2>&1)"; rc=$?
  if [[ $rc -eq 2 ]] && printf '%s' "$out" | grep -q 'none of its paths exist'; then
    ok "B missing env paths hard-fail, no fallback (exit=$rc)"
  else
    bad "B missing env paths hard-fail (exit=$rc, expected 2)"; results+=("      out: $out")
  fi
}

# ---------- Case C: autodetect finds claude-projects AND code ----------
# Both layouts present → both returned (a split setup must not lose one).
caseC() {
  local home out err rc
  home="$(mktemp -d)"
  mkdir -p "$home/claude-projects" "$home/code"
  out="$(cd "$REPO_ROOT" && env -u A1_CODE_ROOTS HOME="$home" \
        node "$TOOLS" learnings roots 2>"$home/err")"; rc=$?
  err="$(cat "$home/err")"
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$out" | grep -q "$home/claude-projects" \
     && printf '%s' "$out" | grep -q "$home/code" \
     && printf '%s' "$err" | grep -q 'source: autodetect'; then
    ok "C autodetect returns BOTH known layouts (exit=$rc)"
  else
    bad "C autodetect returns both layouts (exit=$rc)"; results+=("      out: $out")
  fi
}

# ---------- Case D: repo-parent fallback ----------
# No env, no known home layout, but cwd is inside a git repo → the repo's
# PARENT is used (sibling-checkout layout).
caseD() {
  local home parent repo out err rc
  home="$(mktemp -d)"; parent="$(mktemp -d)"
  repo="$parent/myproj"; mkdir -p "$repo"; git -C "$repo" init -q
  out="$(cd "$repo" && env -u A1_CODE_ROOTS HOME="$home" \
        node "$TOOLS" learnings roots 2>"$home/err")"; rc=$?
  err="$(cat "$home/err")"
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$out" | grep -q "$parent" \
     && printf '%s' "$err" | grep -q 'source: repo-parent'; then
    ok "D repo-parent fallback (exit=$rc)"
  else
    bad "D repo-parent fallback (exit=$rc)"; results+=("      out: $out"); results+=("      err: $err")
  fi
}

# ---------- Case E: nothing resolves → exit 3, loud ----------
# No env, empty home, not in a repo. The contract is a LOUD failure: a collect
# phase must never synthesize from an empty corpus and call it success.
caseE() {
  local home nowhere out rc
  home="$(mktemp -d)"; nowhere="$(mktemp -d)"
  out="$(cd "$nowhere" && env -u A1_CODE_ROOTS HOME="$home" \
        node "$TOOLS" learnings roots 2>&1)"; rc=$?
  if [[ $rc -eq 3 ]] && printf '%s' "$out" | grep -q 'no project roots resolved'; then
    ok "E nothing resolves → exit 3 and says so (exit=$rc)"
  else
    bad "E nothing resolves → exit 3 (exit=$rc, expected 3)"; results+=("      out: $out")
  fi
}

# ---------- Case F: glob shape is derived, not hardcoded ----------
# The emitted globs must be built FROM the resolved root. A glob still pointing
# at a literal /code path would be the original defect.
caseF() {
  local home declared out rc
  home="$(mktemp -d)"; declared="$(mktemp -d)"
  out="$(cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="$declared" \
        node "$TOOLS" learnings roots 2>/dev/null)"; rc=$?
  if [[ $rc -eq 0 ]] \
     && printf '%s' "$out" | grep -q "$declared/\*/.a1/learnings/pattern/a1-learnings" \
     && printf '%s' "$out" | grep -q "$declared/\*/.a1/phases/\*/observations.jsonl"; then
    ok "F globs derived from resolved root (exit=$rc)"
  else
    bad "F globs derived from resolved root (exit=$rc)"; results+=("      out: $out")
  fi
}

caseA; caseB; caseC; caseD; caseE; caseF

printf '%s\n' "${results[@]}"
echo "----"
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
