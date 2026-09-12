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

# ---------- G6: caseF retrofit is live (mutation probe, on a COPY) ----------
# This is the case that makes Wave 4 worth its cost: mutating the `quick` glob
# back to the historical plural spelling must turn `a1-code-roots`'s caseF red.
#
# SAFETY (rewritten 2026-09-12 after a1-reinhard-reviewer): the first version
# mutated `_shared/lib/learnings.cjs` IN PLACE with no `trap`. Reinhard killed a
# run mid-G6 and measured the result — the production file was left carrying the
# plural dead-glob defect this spec exists to eliminate, plus an untracked
# `.g6-bak`. A developer who interrupts the sweep and then commits would have
# silently reintroduced the 2026-09-11 bug. It also violated CONVENTIONS.md
# ("never write into the repo tree").
#
# Now the probe runs against a COPY of the repo in `mktemp -d`. Nothing under
# $REPO_ROOT is ever written, so an interrupted run leaves no trace — a `trap`
# would have been the smaller fix, but a probe that cannot touch the source tree
# needs no unwinding at all.
caseG6() {
  local work target suite rc_before rc_after
  work="$(mktemp -d)"

  # Copy only what the a1-code-roots suite needs: the shared libs, the facade,
  # and the suite itself. `cp -R` of the whole repo would drag .git along.
  mkdir -p "$work/_shared/lib" "$work/_test-fixtures/a1-code-roots" \
           "$work/skills/a1-evolve/workflows"
  cp "$REPO_ROOT/_shared/a1-tools.cjs" "$work/_shared/"
  cp "$REPO_ROOT"/_shared/lib/*.cjs "$work/_shared/lib/"
  cp "$REPO_ROOT/_test-fixtures/a1-code-roots/run-tests.sh" "$work/_test-fixtures/a1-code-roots/"
  # a1-code-roots' case K greps this workflow doc for drift, so the copy needs
  # it too — without it K fails for a missing file and G6's "before" run is
  # already red, which would make G6 report a retrofit failure that is really a
  # copy-completeness failure. Found while rewriting G6: the first copy omitted
  # it and G6 reported before=1.
  cp "$REPO_ROOT/skills/a1-evolve/workflows/01-collect.md" \
     "$work/skills/a1-evolve/workflows/"

  suite="$work/_test-fixtures/a1-code-roots/run-tests.sh"
  target="$work/_shared/lib/learnings.cjs"

  bash "$suite" >/dev/null 2>&1; rc_before=$?

  # Mutate the COPY. No backup needed; the temp dir is discarded either way.
  sed -i.tmp "s#'.a1', 'learnings', 'project', '\*', 'quick'#'.a1', 'learnings', 'projects', '*', 'quick'#" "$target"
  rm -f "$target.tmp"

  bash "$suite" >/dev/null 2>&1; rc_after=$?

  if [[ $rc_before -eq 0 ]] && [[ $rc_after -ne 0 ]]; then
    ok "G6 caseF retrofit is live: plural mutation turns a1-code-roots red (before=$rc_before after=$rc_after)"
  else
    bad "G6 caseF retrofit (before=$rc_before, expected 0; after=$rc_after, expected nonzero)"
  fi
}

# ---------- G7: hostile input — injection shapes are inert ----------
# MANDATORY per CONVENTIONS.md: this module executes a shell, and it had NO
# hostile-input case at all (a1-samuel-security SEC-4, 2026-09-12). The sink was
# `execSync(`ls -d ${pattern}`)` and every shape below ran real commands.
# Red-making change: revert countLiveMatches to execSync with the pattern
# interpolated into the command string — a canary appears.
caseG7() {
  local base canary fired r
  base="$(mktemp -d)"; canary="$base/CANARY_G7"
  fired=no
  for pat in "$base/*; touch $canary" \
             "$base/*\$(touch $canary)" \
             "$base/*\`touch $canary\`" \
             "$base/* | touch $canary" \
             "$base/* && touch $canary"; do
    r="$(node -e "
      const gl=require('$LIB');
      const out=gl.liveness([process.argv[1]], process.argv[2], {skipPlant:true});
      process.stdout.write(String(out[0].matches));
    " "$pat" "$base" 2>/dev/null)"
    [[ "$r" != "0" ]] && fired="matches=$r"
  done
  if [[ -e "$canary" ]]; then fired="canary-created"; fi
  if [[ "$fired" == "no" ]]; then
    ok "G7 injection-shaped globs are inert: matches:0, nothing executed"
  else
    bad "G7 injection shapes inert ($fired)"
  fi
}

# ---------- G8: the env-var chain is closed end to end ----------
# G7 pins the unit; this pins the REAL finding. A directory whose NAME contains
# a substitution passes codeRoots() (absolute, exists), so `learnings roots`
# emitted globs carrying it and fixtures fed them straight into liveness().
# Red-making change: revert either the execFileSync argv passing OR the
# A1_CODE_ROOTS denylist — the canary appears again.
caseG8() {
  local host canary globs rc
  host="$(mktemp -d)"; canary="$host/CANARY_G8"
  mkdir -p "$host/a1probe\$(touch $canary)"
  rc=0
  globs="$(A1_CODE_ROOTS="$host/a1probe\$(touch $canary)" \
           node "$REPO_ROOT/_shared/a1-tools.cjs" learnings roots 2>/dev/null)" || rc=$?
  # Either the env guard rejects it (rc=2, no globs) or the globs are inert.
  if [[ $rc -ne 0 ]]; then
    [[ ! -e "$canary" ]] && ok "G8 env-var chain closed at the boundary (rc=$rc, no canary)" \
                         || bad "G8 env chain: canary fired despite rc=$rc"
    return
  fi
  node -e "
    const gl=require('$LIB');
    const j=JSON.parse(process.argv[1]);
    for (const g of j.globs.stores) gl.liveness([g], process.argv[2], {skipPlant:true});
  " "$globs" "$host" 2>/dev/null
  [[ ! -e "$canary" ]] && ok "G8 env-var chain closed at the sink (globs inert)" \
                       || bad "G8 env chain: canary fired via emitted globs"
}

# ---------- G9: expansion parity for a path containing a space ----------
# Pins SEC-2, and guards against anyone "fixing" injection with a
# space-rejecting allowlist: word splitting made a LIVE glob report matches:0,
# which is the false negative this module exists to prevent.
# Red-making change: drop `IFS=` from the bash snippet — the count becomes 0.
caseG9() {
  local base dir got
  base="$(mktemp -d)"; dir="$base/My Projects"
  mkdir -p "$dir/r1/.a1/learnings/project/x/quick" "$dir/r2/.a1/learnings/project/x/quick"
  got="$(node -e "
    const gl=require('$LIB');
    const path=require('path');
    const pat=path.join(process.argv[1],'*','.a1','learnings','project','*','quick');
    process.stdout.write(String(gl.liveness([pat], process.argv[2], {skipPlant:true})[0].matches));
  " "$dir" "$base" 2>/dev/null)"
  if [[ "$got" == "2" ]]; then
    ok "G9 expansion parity holds for a path with a space (matches=2)"
  else
    bad "G9 space-path parity (matches=$got, expected 2)"
  fi
}

# ---------- G10: oversized pattern fails closed, no hang ----------
# Red-making change: remove the catch returning 0 — E2BIG/ENAMETOOLONG escapes.
caseG10() {
  local base got
  base="$(mktemp -d)"
  got="$(node -e "
    const gl=require('$LIB');
    const pat='/'+'a'.repeat(10000)+'/*';
    try { process.stdout.write(String(gl.liveness([pat], process.argv[1], {skipPlant:true})[0].matches)); }
    catch (e) { process.stdout.write('THREW'); }
  " "$base" 2>/dev/null)"
  if [[ "$got" == "0" ]]; then
    ok "G10 oversized pattern reports matches:0 without throwing"
  else
    bad "G10 oversized pattern ($got)"
  fi
}

# ---------- G11: plantFor refuses to escape baseDir ----------
# Measured before the fix: plantFor('<base>/../ESCAPED/x', base) created a
# directory TWO levels outside base, against its own JSDoc promise.
# Red-making change: remove the containment check — the directory appears.
caseG11() {
  local base got target
  base="$(mktemp -d)"
  # A UNIQUE escape target per run, cleaned up unconditionally. The first
  # version used a fixed name and asserted its absence — so once a mutation
  # probe had legitimately created it, the case failed on the leftover artefact
  # instead of on a defect (observed while mutation-probing this very case).
  # A fixture that is not self-cleaning reports the wrong thing on the second
  # run, which is its own small false signal.
  target="ESCAPED_G11_$$_${RANDOM}"
  got="$(node -e "
    const gl=require('$LIB');
    const path=require('path');
    try { gl.plantFor(path.join(process.argv[1],'..',process.argv[2],'x'), process.argv[1]);
          process.stdout.write('no-throw'); }
    catch (e) { process.stdout.write(e.code || 'throw-no-code'); }
  " "$base" "$target" 2>/dev/null)"
  local escaped=no
  [[ -d "$base/../$target" ]] && escaped=yes
  rm -rf "$base/../$target" 2>/dev/null
  if [[ "$got" == "A1_INPUT" ]] && [[ "$escaped" == "no" ]]; then
    ok "G11 plantFor refuses to write outside baseDir (A1_INPUT)"
  else
    bad "G11 plantFor containment (code=$got escaped=$escaped)"
  fi
}

caseG1; caseG2; caseG3; caseG4; caseG5; caseG6; caseG7; caseG8; caseG9; caseG10; caseG11

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-glob-liveness: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
