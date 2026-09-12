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

caseR1; caseR2; caseR3; caseR4; caseR5; caseR6; caseR7; caseR8

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
  work="$(mktemp -d)"
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
  work="$(mktemp -d)"
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
  work="$(mktemp -d)"
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
  work="$(mktemp -d)"
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
  work="$(mktemp -d)"
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
  work="$(mktemp -d)"
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

# ---------- V7: own row exists in the real registry ----------
# Red-making change: forgetting the row, or adding it outside the parsed
# table span (a blank line before it would end the header-anchored span).
caseV7() {
  local grepped resolved
  grepped="$(grep -c 'retro-gate-ids' "$FIXTURE_LIVE_REGISTRY")"
  resolved="$(node -e "
    const gi=require('$REPO_ROOT/_shared/lib/gate-ids.cjs');
    const fs=require('fs');
    const ids=gi.parseRegistryIds(fs.readFileSync('$FIXTURE_LIVE_REGISTRY','utf8'));
    process.stdout.write(String(ids.includes('retro-gate-ids')));
  ")"
  if [[ "$grepped" -ge 1 && "$resolved" == "true" ]]; then
    ok "V7 retro-gate-ids row exists and is inside the parsed table span"
  else
    bad "V7 own row exists (grepped=$grepped resolved=$resolved)"
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
  home="$(mktemp -d)"; canary="$home/pwned"
  work="$(mktemp -d)"

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

caseV1; caseV2; caseV3; caseV4; caseV5; caseV6; caseV7; caseV8; caseV9

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-retro-validate: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
