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
  # EXACT equality on the parsed JSON, not grep: $parent is a PREFIX of $repo,
  # so a substring match also passes when the code returns the repo itself —
  # the one thing this case is named for. (Found in review 2026-09-11: the
  # grep version survived mutating path.dirname(top) → top.)
  # Compare REALPATHS: on macOS /var is a symlink to /private/var, so mktemp's
  # path and git's resolved toplevel differ textually while naming one directory.
  # (Comparing the raw strings fails here for a reason that has nothing to do
  # with the behaviour under test — a false red is as useless as a false green.)
  local eq parent_real
  parent_real="$(cd "$parent" && pwd -P)"
  eq="$(printf '%s' "$out" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const j=JSON.parse(s);
        const want=process.argv[1];
        const got=require("fs").realpathSync(j.roots[0]);
        process.stdout.write(j.roots.length===1 && got===want ? "yes":"no:"+got);
      } catch(e){ process.stdout.write("parse-error"); }
    });' "$parent_real")"
  if [[ $rc -eq 0 ]] && [[ "$eq" == "yes" ]] \
     && printf '%s' "$err" | grep -q 'source: repo-parent'; then
    ok "D repo-parent fallback returns the PARENT exactly (exit=$rc)"
  else
    bad "D repo-parent fallback (exit=$rc, exact-match=$eq)"; results+=("      out: $out"); results+=("      err: $err")
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
  # ALL FOUR glob keys, checked structurally. Grepping only two let the dead
  # `quick` glob ship (review 2026-09-11): packs and quick could be deleted
  # outright and this case stayed green.
  local verdict
  verdict="$(printf '%s' "$out" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const root=process.argv[1];
      try {
        const g=JSON.parse(s).globs;
        const need=["stores","observations","packs","quick"];
        const missing=need.filter(k=>!Array.isArray(g[k])||g[k].length===0);
        if (missing.length) return process.stdout.write("missing:"+missing.join(","));
        const bad=need.filter(k=>!g[k].every(x=>x.startsWith(root+"/")));
        process.stdout.write(bad.length?"not-derived:"+bad.join(","):"yes");
      } catch(e){ process.stdout.write("parse-error"); }
    });' "$declared")"
  if [[ $rc -eq 0 ]] && [[ "$verdict" == "yes" ]]; then
    ok "F all 4 globs present and derived from resolved root (exit=$rc)"
  else
    bad "F all 4 globs derived (exit=$rc, verdict=$verdict)"; results+=("      out: $out")
  fi
}

# ---------- Case G: the DOCUMENTED consumer snippet aborts ----------
# Regression guard for the 2026-09-11 BLOCKER: 01-collect.md piped node into
# python and tested the PIPELINE status, which is python's — so exit 3 came
# back as success with an empty root list and the run continued. This case
# runs the shape the workflow documents and asserts it aborts with node's code.
caseG() {
  local home nowhere rc roots
  home="$(mktemp -d)"; nowhere="$(mktemp -d)"
  # Mirror of the snippet in skills/a1-evolve/workflows/01-collect.md §1a.
  rc=0
  roots="$(cd "$nowhere" && env -u A1_CODE_ROOTS HOME="$home" bash -c '
    ROOTS_JSON=$(node "$0" learnings roots 2>/dev/null); RC=$?
    if [ $RC -ne 0 ]; then exit $RC; fi
    printf "%s" "$ROOTS_JSON" | python3 -c "import json,sys; print(\" \".join(json.load(sys.stdin)[\"roots\"]))"
  ' "$TOOLS")" || rc=$?
  if [[ $rc -eq 3 ]] && [[ -z "$roots" ]]; then
    ok "G documented snippet ABORTS on exit 3 (rc=$rc)"
  else
    bad "G documented snippet aborts on exit 3 (rc=$rc, roots='$roots')"
  fi
}

# ---------- Case H: exit 2 stays distinguishable from exit 3 ----------
# The first fix attempt collapsed both into 3, mislabelling a typo'd env var as
# "no roots". The two states need different remedies, so they must not merge.
caseH() {
  local home rc
  home="$(mktemp -d)"; mkdir -p "$home/claude-projects"
  rc=0
  (cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="/nope/xyz" \
    node "$TOOLS" learnings roots >/dev/null 2>&1) || rc=$?
  if [[ $rc -eq 2 ]]; then
    ok "H bad env var exits 2, not 3 (rc=$rc)"
  else
    bad "H bad env var exits 2, not 3 (rc=$rc)"
  fi
}

# ---------- Case J: an EXISTING relative root is rejected ----------
# Case I's traversal string does not exist relative to cwd, so statSync filters
# it and the run exits 2 either way — I cannot tell the absolute-path guard from
# its absence (the "test never enters the branch it names" class, per
# _shared/agent-lessons.md#theo-mutation-question). This case passes a relative
# path that DOES exist, which only the isAbsolute check can reject.
caseJ() {
  local home rc out
  home="$(mktemp -d)"
  mkdir -p "$home/real-but-relative"
  rc=0
  # cwd = $home, so "real-but-relative" resolves to an existing directory.
  out="$(cd "$home" && env HOME="$home" A1_CODE_ROOTS="real-but-relative" \
    node "$TOOLS" learnings roots 2>&1)" || rc=$?
  if [[ $rc -eq 2 ]] && printf '%s' "$out" | grep -q 'must be absolute'; then
    ok "J existing-but-relative root rejected (rc=$rc)"
  else
    bad "J existing-but-relative root rejected (rc=$rc)"; results+=("      out: $out")
  fi
}

# ---------- Case I: hostile input (CONVENTIONS.md, mandatory) ----------
# Traversal, injection-shaped and oversized values must fail closed, never
# execute anything and never hang.
caseI() {
  local home rc1 rc2 rc3 canary big sub
  home="$(mktemp -d)"; canary="$home/pwned"
  rc1=0; (cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="../../etc" \
    node "$TOOLS" learnings roots >/dev/null 2>&1) || rc1=$?
  rc2=0; (cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="; touch $canary" \
    node "$TOOLS" learnings roots >/dev/null 2>&1) || rc2=$?
  big="$(head -c 20000 /dev/zero | tr '\0' 'a')"
  rc3=0; (cd "$REPO_ROOT" && env HOME="$home" A1_CODE_ROOTS="/$big" \
    node "$TOOLS" learnings roots >/dev/null 2>&1) || rc3=$?
  # Relative traversal and the injection string are both non-absolute → exit 2.
  if [[ $rc1 -eq 2 && $rc2 -eq 2 && $rc3 -eq 2 ]] && [[ ! -e "$canary" ]]; then
    ok "I hostile input fails closed, nothing executed (rc=$rc1/$rc2/$rc3)"
  else
    sub="rc=$rc1/$rc2/$rc3 canary=$([[ -e $canary ]] && echo CREATED || echo absent)"
    bad "I hostile input fails closed ($sub)"
  fi
}

caseA; caseB; caseC; caseD; caseE; caseF; caseG; caseH; caseI; caseJ

printf '%s\n' "${results[@]}"
echo "----"
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
