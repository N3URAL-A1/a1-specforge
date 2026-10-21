#!/usr/bin/env bash
# Fixture: gate-ids.cjs — registry id parsing + alias resolution (Wave 1 of
# spec 007-retro-gate-id-validator). The CLI-level `retro validate` cases
# (V1-V9) land in this same suite file in Wave 2; this file for now covers
# only the pure parser module (R1-R6), consumed directly via `node -e`.
#
# Why this suite exists: a session that had just documented the four
# false-green test classes then shipped six guards-that-guard-nothing in
# three commits (2026-09-11, Reinhard, 18 mutations). Every case below names
# the single production-code change that turns it red — see the plan's Wave 1
# fixture table (007-retro-gate-id-validator-wave-plan.md).

set -u
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/tmp.sh" || exit 2

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO_ROOT/_shared/lib/gate-ids.cjs"
CORPUS="$REPO_ROOT/_test-fixtures/a1-retro-validate/corpus"
REGISTRY="$REPO_ROOT/_shared/gates-registry.md"

pass=0
fail=0
results=()

ok()  { results+=("PASS  $1"); pass=$((pass + 1)); }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); }

# Assert a node expression (with `gi` bound to the required module) prints the
# expected exact string. Module-not-found is deliberately NOT special-cased —
# in the RED phase (module absent) every case below fails via this same path,
# which is the RED artifact this wave is required to observe and report.
expect_json() {
  local label="$1" expr="$2" want="$3" got
  got="$(node -e "const gi=require('$LIB'); $expr" 2>&1)"
  if [[ "$got" == "$want" ]]; then ok "$label"
  else bad "$label (want=$want got=$got)"; fi
}

FIXTURE_REG="$CORPUS/fixture-registry.md"
FIXTURE_REG_ALIAS_TABLE="$CORPUS/fixture-registry-alias-as-table.md"

# ---------- R1: alias-list immunity (positive trap, carries FR-003) ----------
# The alias section in fixture-registry-alias-as-table.md is a 2-column table
# with real-looking ids (`beta-gate-old`, `lane-split-check`, `lane-split`) in
# it. parseRegistryIds must return the SAME six ids as the plain fixture and
# must not contain any alias-table string.
# Red-making change: replacing the header-anchored table span with a
# whole-file `^\| \`` scrape.
caseR1() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const fs=require('fs');
    const plain=gi.parseRegistryIds(fs.readFileSync('$FIXTURE_REG','utf8'));
    const trap=gi.parseRegistryIds(fs.readFileSync('$FIXTURE_REG_ALIAS_TABLE','utf8'));
    const sameAsPlain=JSON.stringify([...plain].sort())===JSON.stringify([...trap].sort());
    const leaked=['beta-gate-old','lane-split-check','lane-split'].filter(x=>trap.includes(x));
    process.stdout.write(sameAsPlain && leaked.length===0 ? 'clean' : 'LEAK:'+JSON.stringify({sameAsPlain,leaked,trap}));
  " 2>&1)"
  if [[ "$got" == "clean" ]]; then
    ok "R1 alias-list immunity: table-shaped alias section is not scraped"
  else
    bad "R1 alias-list immunity ($got)"
  fi
}

# ---------- R2: exact membership against the FIXTURE registry ----------
# Frozen expected list, compared as sorted JSON. Against the LIVE registry,
# assert PROPERTIES ONLY (never a count) per the plan's explicit instruction —
# the live table has grown from 31 to 32 rows already and will grow again.
# Red-making change: dropping the final table row from the parse span.
caseR2() {
  local got want
  # parseRegistryIds returns RAW table ids, unexpanded — the range row stays
  # a single string here; expandRangeIds (R3) is the only place it turns into
  # three ids. Frozen fixture list, four rows.
  want='["alpha-gate","beta-gate","gamma-gate","range-gate1..gate3"]'
  got="$(node -e "
    const gi=require('$LIB');
    const fs=require('fs');
    const ids=gi.parseRegistryIds(fs.readFileSync('$FIXTURE_REG','utf8'));
    process.stdout.write(JSON.stringify([...ids].sort()));
  " 2>&1)"
  if [[ "$got" == "$want" ]]; then
    ok "R2a exact membership against FIXTURE registry"
  else
    bad "R2a exact membership against FIXTURE registry (want=$want got=$got)"
  fi

  # Live registry: property assertions only — no count.
  local live
  live="$(node -e "
    const gi=require('$LIB');
    const fs=require('fs');
    const ids=gi.parseRegistryIds(fs.readFileSync('$REGISTRY','utf8'));
    const hasKnown=ids.includes('gate-1-build');
    const noAliasRhs=!ids.includes('lane-split-check') && !ids.includes('consistency-gate-4-5') && !ids.includes('full-regression-gate');
    process.stdout.write(hasKnown && noAliasRhs ? 'ok' : 'BAD:'+JSON.stringify({hasKnown,noAliasRhs}));
  " 2>&1)"
  if [[ "$live" == "ok" ]]; then
    ok "R2b live registry: known id present, no alias right-hand side present (no count asserted)"
  else
    bad "R2b live registry properties ($live)"
  fi
}

# ---------- R3: range expansion ----------
# Red-making change: deleting the expandRangeIds call, or widening it to
# accept any suffix.
caseR3() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const fs=require('fs');
    const text=fs.readFileSync('$FIXTURE_REG','utf8');
    const ids=gi.parseRegistryIds(text);
    const expanded=gi.expandRangeIds(ids);
    process.stdout.write(JSON.stringify({
      g3: gi.isRegisteredId('range-gate3', expanded),
      g9: gi.isRegisteredId('range-gate9', expanded),
    }));
  " 2>&1)"
  if [[ "$got" == '{"g3":true,"g9":false}' ]]; then
    ok "R3 range expansion: in-range true, out-of-range false"
  else
    bad "R3 range expansion ($got)"
  fi
}

# resolveGateId takes the SAME {literal, ranges} shape isRegisteredId does
# (post-fix contract — see R8). A minimal expanded fixture for R4/R5, which
# only care about literal membership: no ranges needed for those two ids.
EXPANDED_LANE_SPLIT='{literal: new Set(["lane-split"]), ranges: []}'

# ---------- R4: drift carries canonical ----------
# Red-making change: returning {status:'drift'} without the canonical field.
caseR4() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const r=gi.resolveGateId('lane-split-check', $EXPANDED_LANE_SPLIT);
    process.stdout.write(JSON.stringify({status:r.status, canonical:r.canonical}));
  " 2>&1)"
  if [[ "$got" == '{"status":"drift","canonical":"lane-split"}' ]]; then
    ok "R4 drift carries canonical"
  else
    bad "R4 drift carries canonical ($got)"
  fi
}

# ---------- R5: unknown != drift ----------
# isolation-gate is real and measured: present once in the live corpus, in
# neither the table nor KNOWN_ALIASES. Red-making change: collapsing unknown
# into drift, or defaulting canonical to the input.
caseR5() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const r=gi.resolveGateId('isolation-gate', $EXPANDED_LANE_SPLIT);
    process.stdout.write(JSON.stringify({status:r.status, hasCanonical:('canonical' in r)}));
  " 2>&1)"
  if [[ "$got" == '{"status":"unknown","hasCanonical":false}' ]]; then
    ok "R5 unknown status, no canonical field"
  else
    bad "R5 unknown != drift ($got)"
  fi
}

# ---------- R6: alias map is frozen ----------
# Red-making change: removing Object.freeze.
caseR6() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const frozen=Object.isFrozen(gi.KNOWN_ALIASES);
    const before=JSON.stringify(gi.KNOWN_ALIASES);
    try { gi.KNOWN_ALIASES['injected'] = 'x'; } catch (_e) { /* strict mode may throw */ }
    const after=JSON.stringify(gi.KNOWN_ALIASES);
    process.stdout.write(JSON.stringify({frozen, unchanged: before===after}));
  " 2>&1)"
  if [[ "$got" == '{"frozen":true,"unchanged":true}' ]]; then
    ok "R6 KNOWN_ALIASES is frozen and rejects writes"
  else
    bad "R6 KNOWN_ALIASES frozen ($got)"
  fi
}

# ---------- R7: KNOWN_ALIASES has exactly the three measured entries ----------
# Distinct from R6 (frozen-ness) — this pins the CONTENT, transcribed from the
# registry's bullet list. Red-making change: adding, removing, or mis-mapping
# any of the three entries.
caseR7() {
  local got want
  want='{"lane-split-check":"lane-split","consistency-gate-4-5":"gate-4.5-fr-consistency","full-regression-gate":"gate-1-build"}'
  got="$(node -e "
    const gi=require('$LIB');
    process.stdout.write(JSON.stringify(gi.KNOWN_ALIASES));
  " 2>&1)"
  if [[ "$got" == "$want" ]]; then
    ok "R7 KNOWN_ALIASES has exactly the three measured entries"
  else
    bad "R7 KNOWN_ALIASES content ($got)"
  fi
}

# ---------- R8: resolveGateId agrees with isRegisteredId on ranges ----------
# Found 2026-09-11 while registering `isolation-gate`: resolveGateId took a
# literal-only Set and never consulted ranges, so a real range-registered id
# like `modernize-g3` came back `unknown` from resolveGateId while
# isRegisteredId correctly said true for the exact same id and expanded
# input — a retro citing a real gate would have been told to add a row that
# already exists. R3 alone cannot see this: it only calls isRegisteredId, so
# a resolveGateId that silently ignores ranges left R3 green.
# Uses the FIXTURE registry's own range row (`range-gate1..gate3`) rather
# than the live registry's `modernize-g1..g6`, so this case does not depend
# on what Robert has or has not registered live.
# Red-making change: reverting resolveGateId's `ok` branch to test
# `expanded.literal.has(id)` directly instead of delegating to
# isRegisteredId(id, expanded) — range-registered ids report `unknown` again
# while out-of-range ids still correctly report `unknown`, so only the
# in-range half (range-gate3) flips.
caseR8() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const fs=require('fs');
    const text=fs.readFileSync('$FIXTURE_REG','utf8');
    const expanded=gi.expandRangeIds(gi.parseRegistryIds(text));
    const inRange=gi.resolveGateId('range-gate3', expanded);
    const outOfRange=gi.resolveGateId('range-gate9', expanded);
    process.stdout.write(JSON.stringify({inRange: inRange.status, outOfRange: outOfRange.status}));
  " 2>&1)"
  if [[ "$got" == '{"inRange":"ok","outOfRange":"unknown"}' ]]; then
    ok "R8 resolveGateId agrees with isRegisteredId: range id is ok, out-of-range is unknown"
  else
    bad "R8 resolveGateId/isRegisteredId agreement on ranges ($got)"
  fi
}

# ---------- R9: code alias map vs registry prose must not drift ----------
# Invariant 1: the registry's bullet list is the human-owned copy, KNOWN_ALIASES
# is the machine copy. R7 pins the machine copy against a hardcoded literal, but
# nothing asserted the two copies AGREE — edit the registry bullets and every
# test stayed green (a1-reinhard-reviewer, 2026-09-12). Both are the same three
# pairs today; this case keeps them that way.
#
# Red-making change: adding, removing or re-targeting an entry on either side.
caseR9() {
  local got
  got="$(node -e "
    const fs=require('fs');
    const gi=require('$LIB');
    const txt=fs.readFileSync('$REPO_ROOT/_shared/gates-registry.md','utf8');
    const prose={};
    for (const m of txt.matchAll(/written \\\`([^\\\`]+)\\\` → correct id is \\\`([^\\\`]+)\\\`/g)) prose[m[1]]=m[2];
    const norm=(o)=>JSON.stringify(Object.keys(o).sort().map((k)=>[k,o[k]]));
    if (Object.keys(prose).length === 0) { process.stdout.write('no-prose-parsed'); }
    else { process.stdout.write(norm(prose)===norm(gi.KNOWN_ALIASES) ? 'agree' : 'DRIFT'); }
  " 2>&1)"
  if [[ "$got" == "agree" ]]; then
    ok "R9 KNOWN_ALIASES agrees with the registry's alias prose"
  else
    bad "R9 alias map vs registry prose ($got)"
  fi
}

caseR1; caseR2; caseR3; caseR4; caseR5; caseR6; caseR7; caseR8; caseR9

# ===========================================================================
# Wave 2 — `retro validate` CLI cases (V1-V9). These call the CLI, not the
# module directly, so they also exercise a1-tools.cjs dispatch wiring.
# Checked-in retro/registry fixture data is COPIED into mktemp -d before use
# (CONVENTIONS.md — original fixture files stay immutable).
# ===========================================================================

TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIXTURE_LIVE_REGISTRY="$REPO_ROOT/_shared/gates-registry.md"

# ---------- V1: clean retro -> 0 ----------
# Red-making change: making membership fuzzy, or inverting the exit.
caseV1() {
  local work rc out drift
  mk_workdir work work
  cp "$CORPUS/retro-clean.md" "$work/retro.md"
  out="$(node "$TOOLS" retro validate "$work/retro.md" 2>/dev/null)"; rc=$?
  drift="$(node -e "console.log(JSON.parse(process.argv[1]).drift)" "$out" 2>/dev/null)"
  if [[ $rc -eq 0 && "$drift" == "0" ]]; then
    ok "V1 clean retro exits 0, drift:0"
  else
    bad "V1 clean retro (rc=$rc out=$out)"
  fi
}

# ---------- V2: lane-split-check -> 1 + canonical in stderr ----------
# Red-making change: dropping the canonical field from the message template.
# NOTE: the written id `lane-split-check` itself CONTAINS the substring
# `lane-split` — a `grep -q 'lane-split'` assertion would pass even if the
# canonical id were stripped from the message entirely (found while
# mutation-testing this very case: a mutation dropping ${r.canonical} left a
# naive substring check green). The exact word-boundary pattern below only
# matches the bare canonical id, never the id-as-written.
caseV2() {
  local work rc err
  mk_workdir work work
  cp "$CORPUS/retro-drift.md" "$work/retro.md"
  err="$(node "$TOOLS" retro validate "$work/retro.md" 2>&1 1>/dev/null)"; rc=$?
  if [[ $rc -eq 1 ]] && printf '%s' "$err" | grep -qE '`lane-split`'; then
    ok "V2 lane-split-check exits 1, stderr names canonical"
  else
    bad "V2 lane-split-check drift (rc=$rc err=$err)"
  fi
}

# ---------- V3: unregistered, no canonical -> 1 + invariant-7 text, no canonical ----------
# Uses `never-registered-gate` rather than the wave plan's original
# `isolation-gate` example: isolation-gate was registered in commit 26c398a
# before this wave started, so it now resolves `ok`, not `unknown` — reusing
# it here would make the case pass without ever entering the branch it names.
# Red-making change: collapsing unknown into drift (V2 stays green, V3 alone fails).
caseV3() {
  local work rc out err has_canonical
  mk_workdir work work
  cp "$CORPUS/retro-unknown.md" "$work/retro.md"
  out="$(node "$TOOLS" retro validate "$work/retro.md" 2>"$work/stderr.txt")"; rc=$?
  err="$(cat "$work/stderr.txt")"
  has_canonical="$(node -e "
    const j=JSON.parse(process.argv[1]);
    const e=j.entries.find(x=>x.id==='never-registered-gate');
    process.stdout.write(String(!!(e && 'canonical' in e)));
  " "$out")"
  if [[ $rc -eq 1 ]] && printf '%s' "$err" | grep -qi 'invariant 7' && [[ "$has_canonical" == "false" ]]; then
    ok "V3 unregistered-no-canonical exits 1, names invariant 7, no canonical field"
  else
    bad "V3 unregistered-no-canonical (rc=$rc has_canonical=$has_canonical err=$err)"
  fi
}

# ---------- V4: corpus replay (SC-001), FROZEN SNAPSHOT ----------
# Never assert a live-corpus count (numbers moved 4x while this plan was
# written — see corpus/snapshot-58-entries.md's provenance note for a 5th
# discrepancy found and reported during this wave). Assert the SET of
# flagged ids against the checked-in snapshot.
# Red-making change: any narrowing of the parser that misses the 2nd+ list
# item in a block (e.g. only reading the first `- {id: ...}` line).
caseV4() {
  local work out check
  mk_workdir work work
  cp "$CORPUS/snapshot-58-entries.md" "$work/snapshot.md"
  out="$(node "$TOOLS" retro validate "$work/snapshot.md" 2>/dev/null)"
  check="$(node -e "
    const j=JSON.parse(process.argv[1]);
    const expectedDrift=['lane-split-check','consistency-gate-4-5','full-regression-gate'];
    const flagged=j.entries.filter(e=>e.status!=='ok').map(e=>e.id);
    const flaggedSet=new Set(flagged);
    const onlyExpected=[...flaggedSet].every(id=>expectedDrift.includes(id));
    const allExpectedPresent=expectedDrift.every(id=>flaggedSet.has(id));
    const noValidFlagged=j.entries.every(e=>e.status==='ok' || expectedDrift.includes(e.id));
    process.stdout.write(JSON.stringify({
      valid: j.valid, drift: j.drift, unknown: j.unknown,
      onlyExpected, allExpectedPresent, noValidFlagged
    }));
  " "$out")"
  if [[ "$check" == '{"valid":47,"drift":11,"unknown":0,"onlyExpected":true,"allExpectedPresent":true,"noValidFlagged":true}' ]]; then
    ok "V4 corpus replay: flagged-id set matches frozen snapshot (47 valid / 11 drift / 0 unknown)"
  else
    bad "V4 corpus replay ($check)"
  fi

  # Property-only assertion against the LIVE store (never a count — the
  # numbers moved 42->47->48 while this plan was being written). Uses the
  # real vault if resolvable; skips gracefully if A1_VAULT_ROOT/the legacy
  # vault does not exist (e.g. a bare CI checkout with no vault).
  local vault liveCheck
  vault="${A1_VAULT_ROOT:-$HOME/N3URAL-Vault}/pattern/a1-learnings"
  if [[ -d "$vault" ]]; then
    liveCheck="$(node -e "
      const gi=require('$REPO_ROOT/_shared/lib/gate-ids.cjs');
      const fs=require('fs');
      const path=require('path');
      const text=fs.readFileSync('$FIXTURE_LIVE_REGISTRY','utf8');
      const expanded=gi.expandRangeIds(gi.parseRegistryIds(text));
      const dir='$vault';
      const files=fs.readdirSync(dir).filter(f=>f.endsWith('.md'));
      let everyFlaggedAbsent=true, everyUnflaggedPresent=true;
      for (const f of files) {
        const t=fs.readFileSync(path.join(dir,f),'utf8');
        const m=t.match(/^  - \{id: [a-zA-Z0-9._-]+/gm) || [];
        for (const line of m) {
          const id=line.replace(/^  - \{id: /,'');
          const registered=gi.isRegisteredId(id, expanded);
          const r=gi.resolveGateId(id, expanded);
          // property 1: every flagged (non-ok) id is absent from the registry
          if (r.status!=='ok' && registered) everyFlaggedAbsent=false;
          // property 2: every unflagged (ok) id is present in the registry
          if (r.status==='ok' && !registered) everyUnflaggedPresent=false;
        }
      }
      process.stdout.write(JSON.stringify({everyFlaggedAbsent, everyUnflaggedPresent}));
    " 2>&1)"
    if [[ "$liveCheck" == '{"everyFlaggedAbsent":true,"everyUnflaggedPresent":true}' ]]; then
      ok "V4b live store property: flagged<=>unregistered agreement holds (no count asserted)"
    else
      bad "V4b live store property ($liveCheck)"
    fi
  else
    ok "V4b live store property: skipped (no vault at $vault)"
  fi
}

# ---------- V5: registry mutation (SC-002) ----------
# Mutating `lane-split` -> `lane-split-x` in a COPIED registry must turn a
# previously-green retro red. Uses --registry to point at the mutated copy
# (see retro-validate.cjs header comment on why this flag exists).
# Red-making change: hardcoding any id list in the validator instead of
# reading the registry file.
caseV5() {
  local work rc_before rc_after out_before out_after
  mk_workdir work work
  cp "$FIXTURE_LIVE_REGISTRY" "$work/registry.md"
  cp "$CORPUS/retro-clean.md" "$work/retro.md"   # cites `lane-split`, among others

  out_before="$(node "$TOOLS" retro validate "$work/retro.md" --registry "$work/registry.md" 2>/dev/null)"
  rc_before=$?

  sed -i.bak 's/`lane-split`/`lane-split-x`/' "$work/registry.md"
  out_after="$(node "$TOOLS" retro validate "$work/retro.md" --registry "$work/registry.md" 2>/dev/null)"
  rc_after=$?

  if [[ $rc_before -eq 0 && $rc_after -eq 1 ]]; then
    ok "V5 registry mutation turns a green retro red (before=$rc_before after=$rc_after)"
  else
    bad "V5 registry mutation (before=$rc_before after=$rc_after out_before=$out_before out_after=$out_after)"
  fi
}

# ---------- V6: missing field -> 0, malformed -> 2 ----------
# Red-making change: treating unparseable as empty (the silent-discard defect).
caseV6() {
  local work rc_missing rc_malformed
  mk_workdir work work
  cp "$CORPUS/retro-missing-field.md" "$work/missing.md"
  cp "$CORPUS/retro-malformed.md" "$work/malformed.md"

  node "$TOOLS" retro validate "$work/missing.md" >/dev/null 2>&1; rc_missing=$?
  node "$TOOLS" retro validate "$work/malformed.md" >/dev/null 2>&1; rc_malformed=$?

  if [[ $rc_missing -eq 0 && $rc_malformed -eq 2 ]]; then
    ok "V6 missing field exits 0, malformed block exits 2 (asymmetry holds)"
  else
    bad "V6 missing/malformed asymmetry (missing_rc=$rc_missing malformed_rc=$rc_malformed)"
  fi
}

# ---------- V7: all three new registry rows are inside the parsed span ----------
# The parser is header-anchored and stops at the first blank line, so a row
# placed outside that span is invisible to the very tool that reads it. V7 first
# checked only `retro-gate-ids`; a1-reinhard-reviewer pointed out that
# `workflow-pipeline-exit` and `isolation-gate` had no equivalent coverage, so
# the named red-making change (a blank line ending the span early) was only
# guarded for one of three rows.
#
# Red-making change: inserting a blank line above any of the three rows, or
# moving a row below the table.
caseV7() {
  local got
  got="$(node -e "
    const fs=require('fs');
    const gi=require('$LIB');
    const ids=gi.parseRegistryIds(fs.readFileSync('$REPO_ROOT/_shared/gates-registry.md','utf8'));
    const need=['retro-gate-ids','workflow-pipeline-exit','isolation-gate'];
    const missing=need.filter((i)=>!ids.includes(i));
    process.stdout.write(missing.length ? 'missing:'+missing.join(',') : 'all-in-span');
  " 2>&1)"
  if [[ "$got" == "all-in-span" ]]; then
    ok "V7 all three new registry rows are inside the parsed table span"
  else
    bad "V7 registry rows in span ($got)"
  fi
}

# ---------- V8: workflow call sites are capture-then-check ----------
# Red-making change: re-introducing a piped invocation in any of the 5 files.
caseV8() {
  local files=(
    "$REPO_ROOT/_shared/retro-template.md"
    "$REPO_ROOT/skills/a1-execute/workflows/03-verify.md"
    "$REPO_ROOT/skills/a1-fix/workflows/04-verify.md"
    "$REPO_ROOT/skills/a1-new-feature/workflows/06-verify.md"
    "$REPO_ROOT/skills/a1-evolve/workflows/04-apply.md"
  )
  local all_have_invocation=true
  local none_piped=true
  local missing=()
  local piped=()
  for f in "${files[@]}"; do
    if ! grep -q 'retro validate' "$f" 2>/dev/null; then
      all_have_invocation=false
      missing+=("$f")
    fi
    if grep -E 'retro validate.*\|' "$f" >/dev/null 2>&1; then
      none_piped=false
      piped+=("$f")
    fi
  done
  if [[ "$all_have_invocation" == "true" && "$none_piped" == "true" ]]; then
    ok "V8 all 5 touched files invoke retro validate, none piped"
  else
    bad "V8 workflow wiring (missing=${missing[*]:-none} piped=${piped[*]:-none})"
  fi
}

# ---------- V9: hostile input (mandatory) ----------
# Traversal, injection-shaped, and oversized retro-paths must each produce a
# REAL, checkable rejection — never just "did not crash". Learned this week:
# `../../etc` does not EXIST relative to a plain cwd, so a statSync-based
# existence check rejects it for the WRONG reason (not-found, not the guard
# under test) and an exit-code-only assertion cannot tell the difference —
# and separately, `[]` was once absorbed by an exact-match line above the new
# branch, so only whitespace-padded input actually exercised that guard. This
# case avoids both traps: the traversal sub-case targets a path that DOES
# resolve (mirroring caseJ's "real-but-relative" construction) but resolves
# to a DIRECTORY, not a file — reaching a distinct, real branch
# (`stat.isFile()`) rather than the not-found branch — and the assertion
# checks THAT specific stderr message, not a bare exit code.
caseV9() {
  local home canary rc1 rc2 rc3 err1 big work traversal_ok sub rc_file timed_out child_pid
  mk_workdir home home; canary="$home/pwned"
  mk_workdir work work

  # (a) path traversal reaching a REAL, EXISTING directory (not a file) via
  # a traversal-shaped relative path, run with cwd = a subdirectory so the
  # ".." segments are genuine and resolve on disk.
  mkdir -p "$work/sub/deeper" "$work/a-directory"
  rc1=0
  err1="$(cd "$work/sub/deeper" && node "$TOOLS" retro validate "../../a-directory" \
    2>&1 1>/dev/null)" || rc1=$?
  traversal_ok=false
  if [[ $rc1 -eq 2 ]] && printf '%s' "$err1" | grep -q 'not a regular file'; then
    traversal_ok=true
  fi

  # (b) injection-shaped input — must be treated as an inert string, never
  # evaluated. If it were ever passed to a shell, $canary would exist.
  rc2=0
  node "$TOOLS" retro validate "; touch $canary" >/dev/null 2>&1 || rc2=$?

  # (c) oversized value (>= 10000 chars) — must fail fast, not hang. No
  # portable timeout/gtimeout on stock macOS — bash watchdog (same pattern as
  # a1-quick's hostile-oversized-intent case): background + poll + kill.
  big="$(head -c 10005 /dev/zero | tr '\0' 'a')"
  rc_file="$work/oversized-rc.txt"
  (
    node "$TOOLS" retro validate "/$big" >/dev/null 2>&1
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

  if [[ "$traversal_ok" == "true" && $rc2 -eq 2 && "$timed_out" -eq 0 && "$rc3" -eq 2 ]] && [[ ! -e "$canary" ]]; then
    ok "V9 hostile input: traversal/injection/oversized all rejected, nothing executed"
  else
    sub="rc1=$rc1(traversal_ok=$traversal_ok) rc2=$rc2 rc3=$rc3 canary=$([[ -e $canary ]] && echo CREATED || echo absent)"
    bad "V9 hostile input ($sub)"
  fi
}


# ---------- V10: appended-entry files (the shape the real store has) ----------
# Regression case for the defect measured 2026-09-13: every fixture above has
# ONE frontmatter block with gates_fired inside it, so the validator's
# whole-file parseFrontmatter call was never asked to look past the first
# block. Real store files open with a `type: pattern` header that has NO
# gates_fired and append entries below as further `---` blocks -> the
# validator read the header, found nothing, took the legitimate exit-0 path,
# and reported success on all 34 gates_fired blocks in the live store.
#
# Red-making change: reading only candidates[0] instead of every block
# (the pre-fix behaviour) -> entries=[] and rc=0 instead of the 3 ids below.
caseV10() {
  local work rc out valid drift ids
  mk_workdir work work
  cp "$CORPUS/retro-appended-entries.md" "$work/retro.md"
  out="$(node "$TOOLS" retro validate "$work/retro.md" 2>/dev/null)"; rc=$?
  valid="$(node -e "console.log(JSON.parse(process.argv[1]).valid)" "$out" 2>/dev/null)"
  drift="$(node -e "console.log(JSON.parse(process.argv[1]).drift)" "$out" 2>/dev/null)"
  ids="$(node -e "console.log(JSON.parse(process.argv[1]).entries.map(e=>e.id).join(','))" "$out" 2>/dev/null)"
  if [[ $rc -eq 1 && "$valid" == "2" && "$drift" == "1" \
        && "$ids" == "plan-audit,gate-1-build,lane-split-check" ]]; then
    ok "V10 appended entries: all blocks parsed (valid=2 drift=1, ids in order)"
  else
    bad "V10 appended entries (rc=$rc valid=$valid drift=$drift ids=$ids)"
  fi
}

# ---------- V11: the live store is drift-free ----------
# Counterpart to V4b, which asserted an agreement property that held
# trivially while the validator saw zero entries. This one asserts a COUNT:
# the store must parse to >0 entries and 0 drift. It fails both if the
# validator goes blind again (entries drop to 0) and if a new retro writes an
# unregistered id.
caseV11() {
  local store total_entries total_drift out
  store="${A1_VAULT_ROOT:-$HOME/N3URAL-Vault}/pattern/a1-learnings"
  if [[ ! -d "$store" ]]; then
    ok "V11 live store drift-free (skipped: no store at $store)"
    return
  fi
  total_entries=0
  total_drift=0
  for f in "$store"/a1-*.md; do
    [[ -f "$f" ]] || continue
    out="$(node "$TOOLS" retro validate "$f" 2>/dev/null)"
    total_entries=$((total_entries + $(node -e "const d=JSON.parse(process.argv[1]);console.log(d.entries.length)" "$out" 2>/dev/null || echo 0)))
    total_drift=$((total_drift + $(node -e "console.log(JSON.parse(process.argv[1]).drift)" "$out" 2>/dev/null || echo 0)))
  done
  if [[ $total_entries -gt 0 && $total_drift -eq 0 ]]; then
    ok "V11 live store: $total_entries entries parsed, 0 drift"
  else
    bad "V11 live store (entries=$total_entries drift=$total_drift — 0 entries means the validator went blind)"
  fi
}

caseV1; caseV2; caseV3; caseV4; caseV5; caseV6; caseV7; caseV8; caseV9; caseV10; caseV11

# ===========================================================================
# Spec 017 Wave 1 — the registry gains an `invoke` column (last). The id parser
# and `retro validate` must be unaffected; the new cell parser must survive an
# escaped pipe, a stray pipe, an exemption suffix and `none`. Fixture:
# corpus/fixture-registry-invoke.md (frozen copy of fixture-registry.md plus the
# two columns). Each case names the production change that turns it red.
# Measured red 2026-10-20 (snapshot, one line reverted each):
#   parseRegistryRows() tail/notes split made left-positional -> I3, I6
#   parseInvokeCell() isRealDate() check dropped               -> I5
#   invokeMap() keyed by gate id instead of subcommand         -> I4, I7
#   parseInvokeCell() `none` no longer recognised              -> I3, I6
#   registry: `fix class-sweep` cell misspelled                -> I7
#   registry: a row loses a cell                               -> I6
# ===========================================================================

INVOKE_REG="$CORPUS/fixture-registry-invoke.md"

# I1. ids unchanged by the new columns. Red: parseRegistryIds reading the last cell as the id.
expect_json "I1 invoke column does not disturb the id list" \
  "const fs=require('fs'); const a=gi.parseRegistryIds(fs.readFileSync('$INVOKE_REG','utf8')); const b=gi.parseRegistryIds(fs.readFileSync('$FIXTURE_REG','utf8')); process.stdout.write(JSON.stringify(a)===JSON.stringify(b) && a.length===4 ? 'same4' : 'DIFF '+JSON.stringify(a))" \
  "same4"

# I2. retro validate against the invoke registry: clean retro 0, unknown id 1.
# Red: retro-validate reading registry cells positionally from the right.
caseI2() {
  local work rc1 rc2
  work="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-retro-invoke.XXXXXX")" || return 1
  [[ -n "$work" && -d "$work" ]] || return 1
  cp "$CORPUS/retro-fixture-ids.md" "$work/retro.md"
  node "$TOOLS" retro validate "$work/retro.md" --registry "$INVOKE_REG" >/dev/null 2>&1; rc1=$?
  sed 's/id: beta-gate/id: beta-gate-unknown/' "$CORPUS/retro-fixture-ids.md" > "$work/retro2.md"
  node "$TOOLS" retro validate "$work/retro2.md" --registry "$INVOKE_REG" >/dev/null 2>&1; rc2=$?
  rm -rf "${work:?}"
  if [[ $rc1 -eq 0 && $rc2 -eq 1 ]]; then ok "I2 retro validate on the invoke registry: clean 0, planted unknown id 1"
  else bad "I2 retro validate on the invoke registry (clean=$rc1 planted=$rc2)"; fi
}
caseI2

# I3. cell parser: exact result per row. Red: splitRowCells without `\|`, or
# positional-from-the-left notes (the stray pipe in gamma-gate shifts every cell).
expect_json "I3 rowInvokes: kinds, subcommands, skills, exemption per fixture row (escaped pipe and stray pipe rows included)" \
  "const fs=require('fs'); const r=gi.rowInvokes(fs.readFileSync('$INVOKE_REG','utf8')); process.stdout.write(JSON.stringify(r.map(x=>[x.id,x.kind,x.subcommand||null,(x.skills||[]).join('+'),x.exemption?x.exemption.until:null,x.malformed])))" \
  '[["alpha-gate","command","alpha run","a1-new-feature+a1-fix",null,false],["beta-gate","command","beta run","a1-execute","2026-11-30",false],["gamma-gate","none",null,"",null,false],["range-gate1..gate3","none",null,"",null,false]]'

# I4. invokeMap: one entry per command row. Red: invokeMap keyed by gate id.
expect_json "I4 invokeMap is {subcommand -> gate id}" \
  "const fs=require('fs'); process.stdout.write(JSON.stringify(gi.invokeMap(fs.readFileSync('$INVOKE_REG','utf8'))))" \
  '{"alpha run":"alpha-gate","beta run":"beta-gate"}'

# I5. cell grammar edge cases on parseInvokeCell directly.
expect_json "I5 parseInvokeCell: external, empty, missing @, bad date, missing reason, two exemption suffixes" \
  "const k=(c)=>gi.parseInvokeCell(c).kind; process.stdout.write([k('external'),k(''),k('\`x y\` a1-fix'),k('none; unwired_until=2026-13-01; unwired_reason=r'),k('none; unwired_until=2026-11-30'),k('none; unwired_until=2026-11-30; unwired_reason=a; unwired_until=2026-11-30; unwired_reason=b')].join(','))" \
  "external,invalid,invalid,invalid,invalid,invalid"

# I6. the LIVE registry: every id row carries a parsable invoke cell, every
# row is well-formed, and the number of rows equals the number of ids (count assert).
# Red: any row added without an invoke cell, or a row with fewer cells than the header.
expect_json "I6 live registry: all rows have a valid invoke cell (rows == ids, 0 invalid, 0 malformed)" \
  "const fs=require('fs'); const t=fs.readFileSync('$REPO_ROOT/_shared/gates-registry.md','utf8'); const ids=gi.parseRegistryIds(t); const r=gi.rowInvokes(t); process.stdout.write([ids.length===r.length && ids.length>40, r.filter(x=>x.kind==='invalid').length, r.filter(x=>x.malformed||!x.hasInvokeColumn).length].join('/'))" \
  "true/0/0"

# I7. the three rows spec 017 adds exist and name their subcommand (FR-002 / wave 1 brief).
expect_json "I7 live registry carries test-fidelity, fix-class-sweep, pr-merge-check with their subcommands" \
  "const fs=require('fs'); const m=gi.invokeMap(fs.readFileSync('$REPO_ROOT/_shared/gates-registry.md','utf8')); process.stdout.write([m['test-fidelity'],m['fix class-sweep'],m['pr merge-check']].join(','))" \
  "test-fidelity,fix-class-sweep,pr-merge-check"

# ===========================================================================
# Spec 017 Wave 2 — `retro validate --gate-log` (FR-009) and `gates fired --log`.
# The logs are written by the REAL facade hook: a throwaway git repo is gated
# with `realpath-check run` and `schema-check run` (real subcommands, real
# fixtures), so the log lines are authentic, not hand-typed. The retro files are
# edits of the real corpus/retro-clean.md. `--enforced-since 2026-10-01` is the
# test escape hatch for ENFORCED_SINCE (the constant is the 017 release date, 2026-10-21). Each case names the production change that turns it red.
# Measured red 2026-10-20 (git-archive snapshot, one line reverted each):
#   retro-gatelog.cjs entryProblems(): `class !== deterministic` skip removed  -> L1 (prompt entry flagged)
#   retro-gatelog.cjs entryProblems(): no_log_line branch removed              -> L2
#   retro-gatelog.cjs entryProblems(): verdict comparison removed              -> L3
#   retro-gatelog.cjs checkRetroAgainstLog(): blocking-fail loop removed       -> L4a
#   retro-gatelog.cjs checkRetroAgainstLog(): `!named.has(id)` -> always true  -> L4b
#   retro-gatelog.cjs isLegacy(): always false                                 -> L5a
#   retro-gatelog.cjs isLegacy(): `day < since` -> `day <= since`              -> L5b, L5d (boundary day)
#   retro-gatelog.cjs retroVerdict(): error->fail mapping removed              -> L6a
#   retro-gatelog.cjs readGateLog(): chain check dropped (ok forced true)      -> L7b
#   retro-validate.cjs runGateLogCheck(): path value check removed             -> L8b, L8c (message)
#   retro-validate.cjs runGateLogCheck(): date value check removed             -> L8a
#   retro-gatelog.cjs firedYaml(): `caught` hard-coded false                   -> L9a
# ===========================================================================

GL_WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-retro-gatelog.XXXXXX")" || exit 1
[[ -n "$GL_WORK" && -d "$GL_WORK" ]] || exit 1
trap 'rm -rf "${GL_WORK:?}"' EXIT
SINCE=2026-10-01

gl_repo() { # gl_repo <name> <added-file> <content> -> repo dir with one extra commit
  local d="$GL_WORK/$1"
  mkdir -p "$d" && git -C "$d" init -q && git -C "$d" config user.email t@t.dev && git -C "$d" config user.name test || return 1
  echo seed > "$d/seed.txt"; git -C "$d" add -A; git -C "$d" commit -qm base
  mkdir -p "$d/$(dirname "$2")"; printf '%s\n' "$3" > "$d/$2"; git -C "$d" add -A; git -C "$d" commit -qm feat
  echo "$d"
}
gl_run() { (cd "$1" && shift && node "$TOOLS" "$@" >/dev/null 2>&1); } # run a gate inside a repo

# retro <out> <date> <entry>... — real retro-clean.md with another date and gates_fired block
gl_retro() {
  local out="$1" date="$2"; shift 2
  { sed -n '1,8p' "$CORPUS/retro-clean.md" | sed "s/^date: .*/date: $date/"
    for e in "$@"; do printf '  - %s\n' "$e"; done
    sed -n '12,$p' "$CORPUS/retro-clean.md"; } > "$out"
}
gl_validate() { # gl_validate <retro> <log> [extra flags] -> OUT RC ERR
  OUT="$(node "$TOOLS" retro validate "$1" --gate-log "$2" "${@:3}" 2>"$GL_WORK/err")"; RC=$?; ERR="$(cat "$GL_WORK/err")"
}
gl_js() { node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String('"$1"'))' "$OUT" 2>&1; }
gl_check() { # gl_check <label> <want-rc> <js> <want>
  local got; got="$(gl_js "$3")"
  if [[ "$RC" -eq "$2" && "$got" == "$4" ]]; then ok "$1"; else bad "$1 (rc=$RC want=$2; got=$got want=$4; err=$ERR)"; fi
}

PASS_REPO="$(gl_repo pass src/util.js 'export const add = (a, b) => a + b;')" || exit 1
FAIL_REPO="$(gl_repo fail src/db.js "export const q = () => db.query('UPDATE users SET x=1');")" || exit 1
gl_run "$PASS_REPO" realpath-check run --phase r --diff-base HEAD~1 --project .
gl_run "$PASS_REPO" schema-check run --phase r --migrations "$REPO_ROOT/_test-fixtures/a1-schema-check/pass/migrations"
gl_run "$FAIL_REPO" realpath-check run --phase r --diff-base HEAD~1 --project .
gl_run "$PASS_REPO" schema-check run --phase e --migrations "$GL_WORK/no-such-dir"
PASS_LOG="$PASS_REPO/.a1/phases/r/gate-log.jsonl"
FAIL_LOG="$FAIL_REPO/.a1/phases/r/gate-log.jsonl"
ERR_LOG="$PASS_REPO/.a1/phases/e/gate-log.jsonl"

E_RP='{id: gate-0.7-realpath, verdict: pass, caught: false}'
E_SC='{id: gate-0.6-schema, verdict: pass, caught: false}'
E_PA='{id: plan-audit, verdict: pass, caught: false}'
E_BUILD='{id: gate-1-build, verdict: pass, caught: false}'

# L1 green: two deterministic entries match the log; the prompt entry (plan-audit) has no log line and is not checked.
gl_retro "$GL_WORK/l1.md" 2026-10-20 "$E_RP" "$E_SC" "$E_PA"
gl_validate "$GL_WORK/l1.md" "$PASS_LOG" --enforced-since $SINCE
gl_check "L1 retro matches the log (prompt entry unchecked): exit 0, checked, 2 lines, 0 problems" 0 \
  'j.gate_log.checked+"/"+j.gate_log.lines+"/"+j.gate_log.problems.length' "true/2/0"

# L2 an entry of a deterministic gate with no log line -> exit 1
gl_retro "$GL_WORK/l2.md" 2026-10-20 "$E_RP" "$E_SC" "$E_BUILD"
gl_validate "$GL_WORK/l2.md" "$PASS_LOG" --enforced-since $SINCE
gl_check "L2 gate-1-build in the retro, not in the log: exit 1 no_log_line naming it" 1 \
  'j.gate_log.problems.map(p=>p.rule+":"+p.id).join(",")' "no_log_line:gate-1-build"

# L3 same id, other verdict -> exit 1
gl_retro "$GL_WORK/l3.md" 2026-10-20 '{id: gate-0.7-realpath, verdict: fail, caught: true}' "$E_SC"
gl_validate "$GL_WORK/l3.md" "$PASS_LOG" --enforced-since $SINCE
gl_check "L3 retro says fail, the log says pass: exit 1 verdict_mismatch" 1 \
  'j.gate_log.problems.map(p=>p.rule+":"+p.id).join(",")' "verdict_mismatch:gate-0.7-realpath"

# L4 a blocking fail in the log that the retro leaves out -> exit 1; naming it with the log's verdict -> exit 0
gl_retro "$GL_WORK/l4a.md" 2026-10-20 "$E_PA"
gl_validate "$GL_WORK/l4a.md" "$FAIL_LOG" --enforced-since $SINCE
gl_check "L4a log holds fail of blocking gate-0.7-realpath, retro omits it: exit 1 missing_blocking_fail" 1 \
  'j.gate_log.problems.map(p=>p.rule+":"+p.id).join(",")' "missing_blocking_fail:gate-0.7-realpath"
gl_retro "$GL_WORK/l4b.md" 2026-10-20 '{id: gate-0.7-realpath, verdict: fail, caught: true}'
gl_validate "$GL_WORK/l4b.md" "$FAIL_LOG" --enforced-since $SINCE
gl_check "L4b same log, retro names the gate with verdict fail: exit 0, 0 problems" 0 'j.gate_log.problems.length+"/"+j.gate_log.lines' "0/1"

# L5 legacy retros skip the check; the boundary day is enforced; the real constant is honoured
gl_retro "$GL_WORK/l5a.md" 2026-09-12 "$E_BUILD"
gl_validate "$GL_WORK/l5a.md" "$PASS_LOG" --enforced-since $SINCE
gl_check "L5a retro dated before ENFORCED_SINCE with a planted unlogged entry: exit 0, checked=false" 0 'j.gate_log.checked+"/"+j.gate_log.problems.length' "false/0"
gl_retro "$GL_WORK/l5b.md" 2026-10-01 "$E_BUILD"
gl_validate "$GL_WORK/l5b.md" "$PASS_LOG" --enforced-since $SINCE
gl_check "L5b retro dated ON the enforcement day is checked: exit 1" 1 'j.gate_log.checked+"/"+j.gate_log.problems.length' "true/1"
CONST="$(node -e 'process.stdout.write(require(process.argv[1]).ENFORCED_SINCE)' "$REPO_ROOT/_shared/lib/enforced-since.cjs")"
DAY_BEFORE="$(node -e 'const d=new Date(process.argv[1]+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()-1); process.stdout.write(d.toISOString().slice(0,10))' "$CONST")"
gl_retro "$GL_WORK/l5c.md" "$DAY_BEFORE" "$E_BUILD"
gl_validate "$GL_WORK/l5c.md" "$PASS_LOG"
gl_check "L5c without --enforced-since the code constant ($CONST) decides: the day before is legacy, exit 0" 0 'j.gate_log.checked' "false"
gl_retro "$GL_WORK/l5d.md" "$CONST" "$E_BUILD"
gl_validate "$GL_WORK/l5d.md" "$PASS_LOG"
gl_check "L5d a retro dated on the constant is checked: exit 1" 1 'j.gate_log.checked+"/"+j.gate_log.problems.length' "true/1"

# L6 a crashed gate (log verdict error, exit 2) reads as fail in the retro vocabulary
gl_retro "$GL_WORK/l6a.md" 2026-10-20 '{id: gate-0.6-schema, verdict: fail, caught: true}'
gl_validate "$GL_WORK/l6a.md" "$ERR_LOG" --enforced-since $SINCE
gl_check "L6a log says error, retro says fail: exit 0" 0 'j.gate_log.problems.length' "0"
gl_retro "$GL_WORK/l6b.md" 2026-10-20 "$E_SC"
gl_validate "$GL_WORK/l6b.md" "$ERR_LOG" --enforced-since $SINCE
gl_check "L6b log says error, retro says pass: exit 1 verdict_mismatch" 1 'j.gate_log.problems.map(p=>p.rule).join(",")' "verdict_mismatch"

# L7 a log that cannot be trusted is exit 2, never "nothing fired"
cp "$PASS_LOG" "$GL_WORK/tampered.jsonl"
node -e 'const fs=require("fs"),f=process.argv[1];const l=fs.readFileSync(f,"utf8").split("\n");l[0]=l[0].replace("\"pass\"","\"fail\"");fs.writeFileSync(f,l.join("\n"))' "$GL_WORK/tampered.jsonl"
gl_validate "$GL_WORK/l1.md" "$GL_WORK/tampered.jsonl" --enforced-since $SINCE
[[ $RC -eq 2 && -z "$OUT" && "$ERR" == *"not trustworthy"* ]] && ok "L7b first line edited (chain broken): exit 2, no report, message names the log" || bad "L7b (rc=$RC out=$OUT err=$ERR)"
gl_validate "$GL_WORK/l1.md" "$GL_WORK/no-such.jsonl" --enforced-since $SINCE
[[ $RC -eq 2 && "$ERR" == *"unreadable"* ]] && ok "L7a missing log: exit 2" || bad "L7a (rc=$RC err=$ERR)"

# L8 hostile flag values
gl_validate "$GL_WORK/l1.md" "$PASS_LOG" --enforced-since not-a-date
[[ $RC -eq 2 ]] && ok "L8a --enforced-since not a date: exit 2" || bad "L8a (rc=$RC)"
gl_validate "$GL_WORK/l1.md" "$(printf 'x\ny')" --enforced-since $SINCE
[[ $RC -eq 2 && "$ERR" == *"needs a plain path"* ]] && ok "L8b newline in --gate-log path: exit 2, usage message (not an internal error)" || bad "L8b (rc=$RC err=$ERR)"
OUT="$(node "$TOOLS" retro validate "$GL_WORK/l1.md" --gate-log 2>"$GL_WORK/err")"; RC=$?; ERR="$(cat "$GL_WORK/err")"
[[ $RC -eq 2 && "$ERR" == *"needs a plain path"* ]] && ok "L8c --gate-log without a value: exit 2, usage message" || bad "L8c (rc=$RC err=$ERR)"
gl_validate "$GL_WORK/l1.md" "$GL_WORK" --enforced-since $SINCE
[[ $RC -eq 2 ]] && ok "L8d --gate-log is a directory: exit 2" || bad "L8d (rc=$RC)"

# L9 `gates fired --log` prints the block the template tells the writer to paste; pasted, it validates
FIRED="$(node "$TOOLS" gates fired --log "$PASS_LOG" 2>&1)"; FRC=$?
WANT=$'gates_fired:\n  - {id: gate-0.7-realpath, verdict: pass, caught: false}\n  - {id: gate-0.6-schema, verdict: pass, caught: false}'
[[ $FRC -eq 0 && "$FIRED" == "$WANT" ]] && ok "L9 gates fired prints both gates with their last verdict (exact block)" || bad "L9 (rc=$FRC out=$FIRED)"
FIRED_F="$(node "$TOOLS" gates fired --log "$FAIL_LOG" 2>&1)"
[[ "$FIRED_F" == $'gates_fired:\n  - {id: gate-0.7-realpath, verdict: fail, caught: true}' ]] && ok "L9a a fail line prints verdict fail, caught true" || bad "L9a ($FIRED_F)"
{ sed -n '1,7p' "$CORPUS/retro-clean.md" | sed 's/^date: .*/date: 2026-10-20/'; printf '%s\n' "$FIRED"; sed -n '12,$p' "$CORPUS/retro-clean.md"; } > "$GL_WORK/l9.md"
gl_validate "$GL_WORK/l9.md" "$PASS_LOG" --enforced-since $SINCE
gl_check "L9b the pasted block validates against its own log: exit 0, 2 lines, 0 problems" 0 'j.valid+"/"+j.gate_log.lines+"/"+j.gate_log.problems.length' "2/2/0"
node "$TOOLS" gates fired --log "$GL_WORK/tampered.jsonl" >/dev/null 2>&1; FRC=$?
[[ $FRC -eq 2 ]] && ok "L9c gates fired on a tampered log: exit 2" || bad "L9c (rc=$FRC)"

# L10 without --gate-log nothing changes: no gate_log key, same exit as before
OUT="$(node "$TOOLS" retro validate "$GL_WORK/l2.md" 2>/dev/null)"; RC=$?
[[ $RC -eq 0 && "$(gl_js 'Object.prototype.hasOwnProperty.call(j,"gate_log")')" == "false" ]] && ok "L10 no --gate-log: exit 0, no gate_log key" || bad "L10 (rc=$RC out=$OUT)"

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-retro-validate: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
