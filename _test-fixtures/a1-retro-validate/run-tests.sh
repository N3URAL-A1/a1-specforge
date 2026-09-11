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

# ---------- R4: drift carries canonical ----------
# Red-making change: returning {status:'drift'} without the canonical field.
caseR4() {
  local got
  got="$(node -e "
    const gi=require('$LIB');
    const r=gi.resolveGateId('lane-split-check', new Set(['lane-split']));
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
    const r=gi.resolveGateId('isolation-gate', new Set(['lane-split']));
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

caseR1; caseR2; caseR3; caseR4; caseR5; caseR6; caseR7

printf '%s\n' "${results[@]}"
echo "----"
echo "a1-retro-validate: $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
