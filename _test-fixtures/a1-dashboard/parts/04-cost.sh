# shellcheck shell=bash
# Part 04 — Cost panel on the spec 018 parser (spec 021 Wave 4). FR-012 plus degradation (FR-009 for Cost)
# and the read-seam rule. Fixtures: fixtures/cost/ (real VERIFICATION files, see fixtures/cost/SOURCES.txt).

CF="$SUITE_DIR/fixtures/cost"
# cost_vault <var> <phase dirs...> — fixture vault with the named real phase folders mirrored.
cost_vault() {
  local var="$1" v p; shift
  mk_fixture_vault v
  if [[ $# -gt 0 ]]; then
    mkdir -p "$v/project/fixture-slug/phases"
    for p in "$@"; do cp -R "$CF/phases/$p" "$v/project/fixture-slug/phases/$p"; done
  fi
  printf -v "$var" '%s' "$v"
}
# cost_section <vault> — the Cost section object (JSON) and the paths opened (TRACE), via the real module.
cost_section() {
  local tf="$WORK/trace.$$"
  OUT="$(A1_FX_SHARED="$SHARED" node -e '
    const path = require("path");
    const { costSection } = require(path.join(process.env.A1_FX_SHARED, "lib", "dashboard-cost.cjs"));
    const trace = [];
    const s = costSection({ root: process.argv[1], slug: "fixture-slug", trace, env: process.env });
    require("fs").writeFileSync(process.argv[2], trace.join("\n"));
    process.stdout.write(JSON.stringify(s));' "$1" "$tf" 2>"$WORK/err.$$")"; RC=$?
  ERR="$(cat "$WORK/err.$$")"; TRACE="$(cat "$tf" 2>/dev/null)"; rm -f "$tf" "$WORK/err.$$"
}
items() { json_get "$OUT" 'j.items.join("|")'; }

# ---- FR-012 acceptance: two cost lines (M6, M7) + one run without ----------------------------------------
cost_vault CV1 M6-works-for-rob M7-oss-ready M9-robustness
cost_section "$CV1"
expect "04.1 section exits cleanly" "0" "$RC"
expect "04.2 state is ok" "ok" "$(json_get "$OUT" 'j.state')"
expect "04.3 items: exact sum of the two cost lines, counts, source line" \
  "100,582,416 tokens across 2 runs with a cost line|1 run without cost line|Source: VERIFICATION cost lines (phase runs only)" "$(items)"
expect "04.4 the sum is the exact M6 + M7 token total" "$((35267619 + 65314797))" "$(items | sed 's/ tokens.*//; s/,//g')"

# end to end: the note holds the Cost section with those lines
mk_fixture_repo R4
vault_run "$R4" "$CV1" dashboard build
expect "04.5 build with phases mirror exits 0" "0" "$RC"
note4="$(cat "$CV1/project/fixture-slug/dashboard.md")"
expect_has "04.6 note shows the token sum" "$note4" "100,582,416 tokens"
expect_has "04.7 note shows 2 runs with a cost line" "$note4" "2 runs with a cost line"
expect_has "04.8 note shows 1 run without cost line" "$note4" "1 run without cost line"
expect_has "04.9 note shows the source line" "$note4" "Source: VERIFICATION cost lines (phase runs only)"
expect_count "04.10 exactly one Cost heading" 1 "$note4" "## Cost"

# ---- without: unavailable, unparseable, unreadable never count as zero ------------------------------------
cost_vault CV2 M6-works-for-rob M7-oss-ready
mkdir -p "$CV2/project/fixture-slug/phases/X-unavailable" "$CV2/project/fixture-slug/phases/X-ambiguous" "$CV2/project/fixture-slug/phases/X-unreadable"
cp "$CF/variants/unavailable.md" "$CV2/project/fixture-slug/phases/X-unavailable/VERIFICATION.md"
cp "$CF/variants/ambiguous.md" "$CV2/project/fixture-slug/phases/X-ambiguous/VERIFICATION.md"
mkdir "$CV2/project/fixture-slug/phases/X-unreadable/VERIFICATION.md"   # a directory: the read fails
cost_section "$CV2"
expect "04.11 unavailable + ambiguous + unreadable count as without, sum unchanged" \
  "100,582,416 tokens across 2 runs with a cost line|3 runs without cost line|Source: VERIFICATION cost lines (phase runs only)" "$(items)"

cost_vault CV3 M13-residuals M6-works-for-rob
cost_section "$CV3"
expect "04.12 approximate (~) value is summed and flagged" \
  "74,767,619 tokens across 2 runs with a cost line|0 runs without cost line|1 run with an approximate (~) value included in the sum|Source: VERIFICATION cost lines (phase runs only)" "$(items)"

cost_vault CV4 M9-robustness
cost_section "$CV4"
expect "04.13 only files without a cost line: 0 tokens, 0 with, 1 without" \
  "0 tokens across 0 runs with a cost line|1 run without cost line|Source: VERIFICATION cost lines (phase runs only)" "$(items)"

# ---- degradation -------------------------------------------------------------------------------------------
cost_vault CV5
cost_section "$CV5"
expect "04.14 no phases folder: not_available" "not_available" "$(json_get "$OUT" 'j.state')"
expect "04.15 reason is no_phases_mirror" "no_phases_mirror" "$(json_get "$OUT" 'j.reason')"
mk_fixture_repo R5
vault_run "$R5" "$CV5" dashboard build
expect "04.16 build without phases mirror still exits 0" "0" "$RC"
expect_has "04.17 note says not available (no_phases_mirror)" "$(cat "$CV5/project/fixture-slug/dashboard.md")" "not available (no_phases_mirror)"

cost_vault CV6
mkdir -p "$CV6/project/fixture-slug/phases/P-empty"
cost_section "$CV6"
expect "04.18 phases folder without VERIFICATION files: none" "none" "$(json_get "$OUT" 'j.state')"

# ---- fix runs are not read; read seam; determinism --------------------------------------------------------
cost_vault CV7 M6-works-for-rob
mkdir -p "$CV7/project/fixture-slug/fixes"
printf -- '---\nstatus: fixed\n---\n\nCost: 999999 tokens\n' > "$CV7/project/fixture-slug/fixes/2026-10-01-f.md"
cost_section "$CV7"
expect "04.19 fix runs are not read (sum is M6 alone)" "35,267,619 tokens across 1 run with a cost line" "$(items | cut -d'|' -f1)"
expect "04.20 every open went through the read seam trace (1 file)" "$CV7/project/fixture-slug/phases/M6-works-for-rob/VERIFICATION.md" "$TRACE"

cost_vault CV8 M6-works-for-rob M7-oss-ready M9-robustness
cost_section "$CV8"; a="$OUT"; cost_section "$CV8"
expect "04.21 two reads of the same vault are identical" "$a" "$OUT"
cost_vault CV9 M7-oss-ready M6-works-for-rob M9-robustness
cost_section "$CV9"
expect "04.22 result does not depend on the order the folders were created" "$a" "$OUT"

# a symlinked phase folder is not followed
cost_vault CV10 M6-works-for-rob
mkdir -p "$WORK/outside/ph" && cp "$CF/phases/M7-oss-ready/VERIFICATION.md" "$WORK/outside/ph/"
ln -s "$WORK/outside/ph" "$CV10/project/fixture-slug/phases/L-link"
cost_section "$CV10"
expect "04.23 a symlinked phase folder is not read (sum is M6 alone)" "35,267,619 tokens across 1 run with a cost line|0 runs without cost line|Source: VERIFICATION cost lines (phase runs only)" "$(items)"

# the open order is sorted by folder name (deterministic trace), whatever the creation order was
cost_section "$CV9"
expect "04.24 opens run in sorted folder order" "M6-works-for-rob M7-oss-ready M9-robustness" \
  "$(printf '%s\n' "$TRACE" | sed 's#.*/phases/##; s#/VERIFICATION.md##' | tr '\n' ' ' | sed 's/ $//')"
