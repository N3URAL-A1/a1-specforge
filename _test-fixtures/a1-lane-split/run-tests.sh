#!/usr/bin/env bash
# Fixture: lane-split's cross-lane IMPORT check (check 6, opt-in --imports).
#
# Why it exists: owns-overlap compares DECLARED PATH SETS. Two lanes can own
# disjoint files and still depend on each other by import — no overlap, real
# dependency. Two independent retros named this gap; the auditors found such a
# dependency, the gate did not.
#
# And why it is opt-in at EXECUTE time: measured 2026-09-13 against the
# historical case (n3ural-contentbot M4-P2) — that phase was PLANNED and never
# executed, so its lane files do not exist. At plan time there is no code to
# read. That is also why lane-split had fired 15 times with zero catches: it was
# only ever asked the question it could not answer.

set -u
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"

pass=0; fail=0; results=()
ok()  { results+=("PASS  $1"); pass=$((pass+1)); }
bad() { results+=("FAIL  $1"); fail=$((fail+1)); }

# Build a repo whose two lanes own disjoint paths but import across them.
plant_crossing() {
  local t="$1"
  mkdir -p "$t/src/a" "$t/src/b"
  printf 'export const LIMIT = 5;\n' > "$t/src/a/helper.mjs"
  printf "import { LIMIT } from '../a/helper.mjs';\nexport const used = LIMIT;\n" > "$t/src/b/consumer.mjs"
  cat > "$t/PLAN.md" <<'MD'
---
phase: probe
lanes:
  - id: lane-a
    waves: [1]
    owns:
      - "src/a/helper.mjs"
  - id: lane-b
    waves: [2]
    owns:
      - "src/b/consumer.mjs"
---

## Wave 1 — a
## Wave 2 — b
MD
}

# ---------- L1: without --imports the blind spot is still there, and SAYS so ----------
# Not a bug: plan time cannot read code. What matters is that PASS does not
# claim imports were checked. Red-making change: defaulting imports_checked to
# true, or running the import scan without a repo root.
caseL1() {
  local t out; t="$(mktemp -d)"; plant_crossing "$t"
  out="$(node "$TOOLS" lane-split check --plan "$t/PLAN.md" 2>/dev/null)"
  local v; v="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(j.status+'/'+j.blockers+'/'+String(j.imports_checked));
  " "$out" 2>&1)"
  [[ "$v" == "PASS/0/false" ]] && ok "L1 no --imports: PASS but imports_checked=false" \
                              || bad "L1 no --imports ($v)"
}

# ---------- L2: with --imports the crossing import is a BLOCKER ----------
# This is the case the gate existed for and could not answer. Red-making
# change: remove the crossLaneImportFindings() call, or drop the `.`-prefix
# filter so nothing resolves.
caseL2() {
  local t out rc; t="$(mktemp -d)"; plant_crossing "$t"
  out="$(node "$TOOLS" lane-split check --plan "$t/PLAN.md" --imports "$t" 2>/dev/null)"; rc=$?
  local v; v="$(node -e "
    const j=JSON.parse(process.argv[1]);
    const f=j.findings.filter((x)=>x.check==='cross-lane-import');
    process.stdout.write(j.status+'/'+f.length+'/'+String(j.imports_checked));
  " "$out" 2>&1)"
  [[ "$v" == "FAIL/1/true" && $rc -eq 1 ]] && ok "L2 crossing import is a BLOCKER (exit 1)" \
                                          || bad "L2 crossing import ($v rc=$rc)"
}

# ---------- L3: a lane importing its OWN file is not flagged ----------
# The guard must not fire on intra-lane imports, which are normal. Red-making
# change: dropping the `owner !== lane.id` comparison.
caseL3() {
  local t out; t="$(mktemp -d)"
  mkdir -p "$t/src/a"
  printf 'export const LIMIT = 5;\n' > "$t/src/a/helper.mjs"
  printf "import { LIMIT } from './helper.mjs';\nexport const u = LIMIT;\n" > "$t/src/a/user.mjs"
  cat > "$t/PLAN.md" <<'MD'
---
phase: probe
lanes:
  - id: only-lane
    waves: [1]
    owns:
      - "src/a/helper.mjs"
      - "src/a/user.mjs"
---

## Wave 1 — a
MD
  out="$(node "$TOOLS" lane-split check --plan "$t/PLAN.md" --imports "$t" 2>/dev/null)"
  local v; v="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(j.status+'/'+j.findings.filter((x)=>x.check==='cross-lane-import').length);
  " "$out" 2>&1)"
  [[ "$v" == "PASS/0" ]] && ok "L3 intra-lane import is not flagged" || bad "L3 intra-lane ($v)"
}

# ---------- L4: a package import is not resolved against lane owns ----------
# Subtle: a bare specifier like 'vitest' would resolve to `src/b/vitest`, which
# no lane owns — so a naive fixture cannot tell the filter from its absence
# (found by mutation probe: removing the `.`-prefix filter left the first
# version of this case green). The specifier here is chosen to COLLIDE: the
# package is named `helper.mjs`, so without the filter it resolves to
# `src/b/helper.mjs`... which is still lane-b's own directory. So the collision
# has to point at the OTHER lane: lane-b sits in `src/`, and the package name
# `a/helper.mjs` resolves to exactly lane-a's file.
# Red-making change: removing the `spec.startsWith('.')` filter.
caseL4() {
  local t out; t="$(mktemp -d)"
  mkdir -p "$t/src/a" "$t/src"
  printf 'export const L = 1;\n' > "$t/src/a/helper.mjs"
  # Bare specifier (no leading dot) that WOULD resolve onto lane-a's file if
  # the package filter were gone, because consumer.mjs sits in src/.
  printf "import { L } from 'a/helper.mjs';\nexport const d = L;\n" > "$t/src/consumer.mjs"
  cat > "$t/PLAN.md" <<'MD'
---
phase: probe
lanes:
  - id: lane-a
    waves: [1]
    owns:
      - "src/a/helper.mjs"
  - id: lane-b
    waves: [2]
    owns:
      - "src/consumer.mjs"
---

## Wave 1 — a
## Wave 2 — b
MD
  out="$(node "$TOOLS" lane-split check --plan "$t/PLAN.md" --imports "$t" 2>/dev/null)"
  local v; v="$(node -e "
    const j=JSON.parse(process.argv[1]);
    process.stdout.write(String(j.findings.filter((x)=>x.check==='cross-lane-import').length));
  " "$out" 2>&1)"
  [[ "$v" == "0" ]] && ok "L4 bare package specifier is not resolved onto another lane" \
                    || bad "L4 package import ($v findings, expected 0)"
}

# ---------- L5: a bad --imports path is exit 2, not exit 1 ----------
# Exit 1 means "blockers found" and routes an orchestrator into a revision
# loop. A typo must not look like a finding.
# Red-making change: using usage() (exit 1) instead of exit 2.
caseL5() {
  local t rc; t="$(mktemp -d)"; plant_crossing "$t"
  rc=0
  node "$TOOLS" lane-split check --plan "$t/PLAN.md" --imports "$t/nonexistent" >/dev/null 2>&1 || rc=$?
  [[ $rc -eq 2 ]] && ok "L5 bad --imports path exits 2, not 1" || bad "L5 bad --imports (rc=$rc)"
}

caseL1; caseL2; caseL3; caseL4; caseL5
printf '%s\n' "${results[@]}"
echo "----"
echo "a1-lane-split: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
