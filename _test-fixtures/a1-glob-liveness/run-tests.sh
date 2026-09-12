#!/usr/bin/env bash
# Fixture: glob-liveness.cjs — Wave 4 of spec 007-retro-gate-id-validator.
#
# `_shared/lib/glob-liveness.cjs` is a LIBRARY for fixtures, not a facade
# subcommand: it plants a matching directory/file for a glob pattern and
# counts matches with the SAME expansion mechanism the real consumer uses
# (`ls -d`, as documented in skills/a1-evolve/workflows/01-collect.md §1a) —
# not a re-implementation that could diverge from what a1-evolve's collect
# phase actually sees. This is what turns "the glob is correctly shaped" from
# a reading into a measurement: the `.a1/learnings/projects/*/quick` glob
# (plural) shipped 2026-09-11, was correctly shaped and derived from the
# resolved root, and still matched ZERO files — 9 real quick records (1.8
# weighted entries) silently missing from every synthesis. Shape review never
# catches this class; only a live match count does.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO_ROOT/_shared/lib/glob-liveness.cjs"

pass=0
fail=0
results=()

ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# ---------- G1: plant + match, all 4 keys from `learnings roots --json` ----------
# Red-making change: reverting `quick` to `.a1/learnings/projects/*/quick`
# (plural) — plants a `projects` dir, the consumer's expansion finds none.
caseG1() {
  local base out rc declared
  base="$(mktemp -d)"
  declared="$(mktemp -d)"
  # Same JSON shape `learnings roots --json` emits: 4 glob keys, each an
  # array of one pattern derived from a single root.
  out="$(node -e '
    const { liveness } = require(process.argv[1]);
    const root = process.argv[2];
    const path = require("path");
    const globs = {
      stores: [path.join(root, "*", ".a1", "learnings", "pattern", "a1-learnings")],
      observations: [path.join(root, "*", ".a1", "phases", "*", "observations.jsonl")],
      packs: [path.join(root, "*", ".a1", "packs", "*", "pack.yaml")],
      quick: [path.join(root, "*", ".a1", "learnings", "project", "*", "quick")],
    };
    const all = Object.values(globs).flat();
    const results = liveness(all, root);
    process.stdout.write(JSON.stringify(results));
  ' "$LIB" "$declared" 2>"$base/err")"; rc=$?
  local all_live
  all_live="$(node -e '
    const r = JSON.parse(process.argv[1]);
    process.stdout.write(String(r.length === 4 && r.every(x => x.matches >= 1)));
  ' "$out" 2>&1)"
  if [[ $rc -eq 0 ]] && [[ "$all_live" == "true" ]]; then
    ok "G1 all 4 glob keys plant + match >= 1 (rc=$rc)"
  else
    bad "G1 all 4 glob keys (rc=$rc all_live=$all_live out=$out err=$(cat "$base/err"))"
  fi
}

# ---------- G2: dead glob is flagged (RED proof, SC-005) ----------
# Red-making change: making `liveness` return 1 on empty, or swallowing zero.
# This case is the RED-proof instance FR-007 cites for Wave 4: it is committed
# alongside the guard and names, right here, the single production change
# that turns it red.
caseG2() {
  local base out rc reported
  base="$(mktemp -d)"
  # A glob segment that CANNOT exist under the planted layout: plantFor will
  # create `.../projects/<tok>/quick` (matching the literal pattern given),
  # but the pattern below asks for a DIFFERENT plural segment than what a
  # sibling `quick`-shaped consumer glob would read — i.e. this is the
  # historical plural-vs-singular mismatch, planted and measured directly.
  out="$(node -e '
    const { liveness } = require(process.argv[1]);
    const path = require("path");
    const root = process.argv[2];
    // Plant nothing under this exact pattern on purpose: liveness() plants
    // FOR the given pattern (so plantFor always succeeds structurally), but
    // then we ask it to count against a DIFFERENT, mismatched pattern that
    // the plant does not satisfy.
    const wrongGlob = path.join(root, "*", ".a1", "learnings", "projects", "*", "quick");
    const results = liveness([wrongGlob], root, { skipPlant: true });
    process.stdout.write(JSON.stringify(results));
  ' "$LIB" "$base" 2>&1)"; rc=$?
  reported="$(node -e '
    const r = JSON.parse(process.argv[1]);
    process.stdout.write(String(r.length === 1 && r[0].matches === 0));
  ' "$out" 2>&1)"
  if [[ $rc -eq 0 ]] && [[ "$reported" == "true" ]]; then
    ok "G2 unplanted/mismatched glob reports matches:0, helper does not throw"
  else
    bad "G2 dead glob flagged (rc=$rc reported=$reported out=$out)"
  fi
}

# ---------- G3: historical replay x3 (SC-005) ----------
# The three named dead globs from the wave brief:
#   (a) ~/code on a machine without it
#   (b) .a1/learnings/projects/*/quick (plural) vs project/ (singular, real store)
#   (c) 2026-07-17 single-repo read (only the primary repo, not every sibling)
# Each must report 0 for the DEAD form, >= 1 for the CORRECTED form, using the
# same planted root for a same-shape comparison.
caseG3() {
  local base out rc verdict
  base="$(mktemp -d)"
  out="$(node -e '
    const { liveness, plantFor } = require(process.argv[1]);
    const path = require("path");
    const root = process.argv[2];

    // (a) ~/code missing entirely on this "machine" — nothing planted at all.
    const missingHomeCode = path.join(root, "does-not-exist-home", "code", "*");

    // (b) plural vs singular store segment. Plant the REAL (singular) layout,
    // then measure both the dead plural glob and the corrected singular one
    // against that same planted layout.
    const quickRoot = path.join(root, "quickcase");
    plantFor(path.join(quickRoot, "*", ".a1", "learnings", "project", "*", "quick"), quickRoot);
    const deadPlural = path.join(quickRoot, "*", ".a1", "learnings", "projects", "*", "quick");
    const correctedSingular = path.join(quickRoot, "*", ".a1", "learnings", "project", "*", "quick");

    // (c) single-repo read: glob pinned to one literal repo name instead of
    // `*` — planting a DIFFERENT repo name means the pinned glob sees none.
    const singleRoot = path.join(root, "singlecase");
    plantFor(path.join(singleRoot, "*", ".a1", "learnings", "pattern", "a1-learnings"), singleRoot);
    const pinnedToWrongRepo = path.join(singleRoot, "only-repo-a", ".a1", "learnings", "pattern", "a1-learnings");
    const correctedWildcard = path.join(singleRoot, "*", ".a1", "learnings", "pattern", "a1-learnings");

    const dead = liveness([missingHomeCode, deadPlural, pinnedToWrongRepo], root, { skipPlant: true });
    const corrected = liveness([correctedSingular, correctedWildcard], root, { skipPlant: true });

    process.stdout.write(JSON.stringify({ dead, corrected }));
  ' "$LIB" "$base" 2>&1)"; rc=$?
  verdict="$(node -e '
    const { dead, corrected } = JSON.parse(process.argv[1]);
    const deadOk = dead.length === 3 && dead.every(x => x.matches === 0);
    const correctedOk = corrected.length === 2 && corrected.every(x => x.matches >= 1);
    process.stdout.write(String(deadOk && correctedOk));
  ' "$out" 2>&1)"
  if [[ $rc -eq 0 ]] && [[ "$verdict" == "true" ]]; then
    ok "G3 all 3 historical dead globs report 0, corrected forms report >= 1"
  else
    bad "G3 historical replay (rc=$rc verdict=$verdict out=$out)"
  fi
}

# ---------- G4: existing target not flagged ----------
# Red-making change: inverting the `>= 1` assertion.
caseG4() {
  local base out rc ok_count
  base="$(mktemp -d)"
  out="$(node -e '
    const { liveness } = require(process.argv[1]);
    const path = require("path");
    const root = process.argv[2];
    const glob = path.join(root, "*", ".a1", "learnings", "pattern", "a1-learnings");
    const results = liveness([glob], root);
    process.stdout.write(JSON.stringify(results));
  ' "$LIB" "$base" 2>&1)"; rc=$?
  ok_count="$(node -e '
    const r = JSON.parse(process.argv[1]);
    process.stdout.write(String(r.length === 1 && r[0].matches >= 1 && typeof r[0].planted === "string"));
  ' "$out" 2>&1)"
  if [[ $rc -eq 0 ]] && [[ "$ok_count" == "true" ]]; then
    ok "G4 planted target is not flagged (matches >= 1, planted path reported)"
  else
    bad "G4 existing target (rc=$rc ok_count=$ok_count out=$out)"
  fi
}

# ---------- G5: expansion parity (the critical design constraint) ----------
# Red-making change: re-implementing expansion with fs.readdir filtering that
# diverges on `*` semantics from `ls -d`. This is the case that pins the
# plan's core constraint: liveness()'s match count must equal what the SAME
# glob expands to under `ls -d` — the shell mechanism 01-collect.md documents
# — not a hand-rolled re-implementation that could disagree with it.
#
# TWO planted roots under the wildcard segment, only ONE of which satisfies
# the FULL remainder of the pattern (a `pattern/a1-learnings` sibling that is
# a plain FILE, not a directory, so it does not match the pattern's implied
# directory shape). A single-root layout let a naive `readdir(parent).length`
# reimplementation agree with `ls -d` by coincidence (both report 1) — this
# was caught by mutation testing during Wave 4 and is why the second,
# non-matching sibling exists: `readdir` overcounts it, `ls -d` does not.
caseG5() {
  local base out rc helper_count shell_count glob
  base="$(mktemp -d)"
  glob="$base/*/.a1/learnings/pattern/a1-learnings"
  mkdir -p "$base/planted/.a1/learnings/pattern/a1-learnings"
  mkdir -p "$base/sibling-no-match/.a1/learnings/pattern"
  # sibling-no-match has the PARENT dir but not the leaf — readdir(parent-of-*)
  # counts it as a child of the wildcard segment; ls -d's full-pattern match
  # correctly excludes it.
  helper_count="$(node -e '
    const { liveness } = require(process.argv[1]);
    const results = liveness([process.argv[2]], process.argv[3], { skipPlant: true });
    process.stdout.write(String(results[0].matches));
  ' "$LIB" "$glob" "$base" 2>&1)"; rc=$?
  # Same expansion the consumer uses (01-collect.md's `ls -d "$R"/*/...`).
  shell_count="$(ls -d $glob 2>/dev/null | wc -l | tr -d ' ')"
  if [[ $rc -eq 0 ]] && [[ "$helper_count" == "$shell_count" ]]; then
    ok "G5 expansion parity: helper matches ($helper_count) == ls -d count ($shell_count)"
  else
    bad "G5 expansion parity (rc=$rc helper=$helper_count shell=$shell_count)"
  fi
}

# ---------- G6: caseF retrofit is live (mutation probe, committed) ----------
# This is the case that makes Wave 4 worth its cost: mutating the `quick`
# glob back to the historical plural spelling must turn `a1-code-roots`'s
# caseF red. Applying and reverting the mutation IN PLACE proves the retrofit
# is actually wired, not an unused import (the wave brief's stated risk).
caseG6() {
  local suite target rc_before rc_after
  suite="$REPO_ROOT/_test-fixtures/a1-code-roots/run-tests.sh"
  target="$REPO_ROOT/_shared/lib/learnings.cjs"

  bash "$suite" >/dev/null 2>&1; rc_before=$?

  cp "$target" "$target.g6-bak"
  sed -i.tmp "s#'.a1', 'learnings', 'project', '\*', 'quick'#'.a1', 'learnings', 'projects', '*', 'quick'#" "$target"
  rm -f "$target.tmp"

  bash "$suite" >/dev/null 2>&1; rc_after=$?

  mv "$target.g6-bak" "$target"

  if [[ $rc_before -eq 0 ]] && [[ $rc_after -ne 0 ]]; then
    ok "G6 caseF retrofit is live: plural mutation turns a1-code-roots red (before=$rc_before after=$rc_after)"
  else
    bad "G6 caseF retrofit (before=$rc_before, expected 0; after=$rc_after, expected nonzero)"
  fi
}

caseG1; caseG2; caseG3; caseG4; caseG5; caseG6

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-glob-liveness: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
