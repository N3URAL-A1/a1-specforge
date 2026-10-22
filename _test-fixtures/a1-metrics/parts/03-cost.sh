# Part 03 — spec 018 Wave 3: `metrics cost` (FR-010..FR-013, SC-003).
# Sourced by run-tests.sh; helpers come from there. Fixtures: fixtures/cost/<project>/ are byte
# copies of real vault VERIFICATION.md / fix reports; the edits are listed per case.
#
# Each case names the single production change that turns it red:
#   CO1 total/rows   : COST_LINE_RE without the line-start anchor (M6 table row 777 and list item 555 win)
#   CO2 note         : first cost line winning instead of the last (007 gives 182699867, not 200000000)
#   CO3 coverage     : percent rounding or the reported/total denominator
#   CO4 fixes        : fix runs not read, or non-fixed reports counted
#   CO5 hostile      : size cap removed (10 MB read) or "1,23,456" parsed as a number
#
# Hand-computed (SC-003), project demo (10 phase dirs, 8 report a number):
#   101126344 + 35267619 + 34129128 + 65314797 + 39500000 + 37119580 + 200000000 + 21475310
#   = 533932778 ; unreported: 006-content-bot (unavailable), M1-P1-story-business-case (ambiguous 1,23,456)

COST_FX="$FIXT/cost"
DEMO_TOTAL=533932778

# mk_cost_vault <VAR> <label> <project...> — fresh vault holding copies of the named cost fixtures.
mk_cost_vault() {
  local __cv
  mk_workdir __cv "$2"
  mkdir -p "$__cv/project"
  local p
  for p in "${@:3}"; do cp -R "$COST_FX/$p" "$__cv/project/$p"; done
  printf -v "$1" '%s' "$__cv"
}

# count_lines <regex> <text> — number of lines matching the extended regex
count_lines() { grep -cE -- "$1" <<<"$2" || true; }

mk_cost_vault CV cost1 demo
run_tools "$CV" metrics cost --project demo
assert_rc "CO0 metrics cost on demo" 0 "$RC" "$OUT"
assert_eq "CO1a row count (8 phase rows)" "$(count_lines '^phase ' "$OUT")" "8"
assert_has "CO1b rows header" "$OUT" "rows: 8"
assert_has "CO1c exact total (hand-computed literal)" "$OUT" "total: $DEMO_TOTAL tokens"
assert_has "CO1d anchor: M6 row is 35267619 (table 777 and list 555 ignored)" "$OUT" "phase demo/M6-works-for-rob 35267619 tokens"
assert_eq "CO1e no row carries 777 or 555 (count)" "$(count_lines ' (777|555) tokens' "$OUT")" "0"
assert_has "CO1f format '**Cost:** N tokens'" "$OUT" "phase demo/infra-rename-cutover 101126344 tokens"
assert_has "CO1g format '**Cost:** Cost: N tokens'" "$OUT" "phase demo/M1-P2-pitch-deck 34129128 tokens"
assert_has "CO1h 'see cost line at bottom' uses the bottom line" "$OUT" "phase demo/M7-oss-ready 65314797 tokens"
assert_has "CO1i thousands separators stripped" "$OUT" "phase demo/M12-review-fixes 37119580 tokens"
assert_has "CO1j '~' accepted and flagged approx" "$OUT" "phase demo/M13-residuals 39500000 tokens approx"
assert_has "CO1k directory name with spaces" "$OUT" "phase demo/M4 P2 dataset expansion 21475310 tokens"
assert_has "CO1l unreported count" "$OUT" "unreported: 2"
assert_has "CO1m 'unavailable' is unreported" "$OUT" "unreported phase demo/006-content-bot (unavailable)"
assert_has "CO1n '1,23,456' is ambiguous, unreported" "$OUT" "unreported phase demo/M1-P1-story-business-case (ambiguous)"
assert_has "CO1o coverage 8/10" "$OUT" "coverage: 8/10 (80%)"

# ---- CO2 FR-011: two cost lines -> the last wins, a note names the file ----
assert_has "CO2a last line wins (007: 200000000, first line was 182699867)" "$OUT" "phase demo/007-retro-gate-id-validator 200000000 tokens"
assert_has "CO2b note names the file and the count" "$OUT" "note: demo/007-retro-gate-id-validator: 2 cost lines in phases/007-retro-gate-id-validator/VERIFICATION.md, using the last"
assert_eq "CO2c exactly one note (count)" "$(count_lines '^note: ' "$OUT")" "1"

# ---- CO3 --json carries the same data ----
run_tools "$CV" metrics cost --project demo --json
assert_rc "CO3a --json" 0 "$RC" "$OUT"
J="$(node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log([j.rows.length,j.total,j.unreported.length,j.coverage_percent,j.notes.length].join(" "))' <<<"$OUT" 2>&1)"
assert_eq "CO3b json rows/total/unreported/percent/notes" "$J" "8 $DEMO_TOTAL 2 80 1"

# ---- CO4 FR-012: 3 of 4 reporting ----
mk_cost_vault CV2 cost2 cov
run_tools "$CV2" metrics cost --project cov
assert_rc "CO4a cov" 0 "$RC" "$OUT"
assert_has "CO4b coverage 3/4 (75%)" "$OUT" "coverage: 3/4 (75%)"
assert_has "CO4c total 101126344+37119580+34129128" "$OUT" "total: 172375052 tokens"
assert_eq "CO4d unreported count (1)" "$(count_lines '^unreported phase ' "$OUT")" "1"

# ---- CO5 FR-013: fixed fix reports are runs of kind fix ----
mk_cost_vault CV3 cost3 fx
run_tools "$CV3" metrics cost --project fx
assert_rc "CO5a fx" 0 "$RC" "$OUT"
assert_has "CO5b fixed report with a cost line is summed as kind fix" "$OUT" "fix fx/2026-10-13-intent-suite-not-executor-host 12345678 tokens"
assert_has "CO5c total is that one fix" "$OUT" "total: 12345678 tokens"
assert_has "CO5d fixed report without a cost line is unreported" "$OUT" "unreported fix fx/2026-10-12-worktree-slug-collision (no_cost_line)"
assert_has "CO5e coverage 1/2" "$OUT" "coverage: 1/2 (50%)"
assert_eq "CO5f reported/duplicate reports ignored (no row, no unreported line mentions them; count 0)" \
  "$(count_lines 'locks-empty-lockfile|xprov-preflight' "$OUT")" "0"

# ---- CO6 all projects when --project is absent ----
mk_cost_vault CV4 cost4 demo cov fx
run_tools "$CV4" metrics cost
assert_rc "CO6a all projects" 0 "$RC" "$OUT"
assert_has "CO6b total over demo+cov+fx" "$OUT" "total: 718653508 tokens"
assert_has "CO6c coverage 12/16" "$OUT" "coverage: 12/16 (75%)"
assert_eq "CO6d row count (12)" "$(count_lines '^(phase|fix) ' "$OUT")" "12"

# ---- CO7 --last N limits per kind, newest first by verified date ----
run_tools "$CV" metrics cost --project demo --last 1
assert_has "CO7a --last 1 keeps the newest phase" "$OUT" "total: 101126344 tokens"
assert_has "CO7b --last 1 coverage 1/1" "$OUT" "coverage: 1/1 (100%)"
run_tools "$CV" metrics cost --project demo --last 2
assert_has "CO7c --last 2 total" "$OUT" "total: 122601654 tokens"

# ---- CO8 exit codes ----
run_tools "" metrics cost --project demo
assert_rc "CO8a vault unset" 2 "$RC" "$OUT"
assert_has "CO8b one-line message, no stack" "$OUT" "A1_VAULT_ROOT is not set"
assert_eq "CO8c no stack trace (count)" "$(count_lines '^\s+at ' "$OUT")" "0"
run_tools "$CV/does-not-exist" metrics cost --project demo
assert_rc "CO8d vault is not a directory" 2 "$RC" "$OUT"
run_tools "$CV" metrics cost --project '../x'
assert_rc "CO8e unsafe project slug" 1 "$RC" "$OUT"
run_tools "$CV" metrics cost --project demo --last 0
assert_rc "CO8f --last 0" 1 "$RC" "$OUT"
run_tools "$CV" metrics cost --project demo --last abc
assert_rc "CO8g --last abc" 1 "$RC" "$OUT"
run_tools "$CV" metrics cost --project nobody
assert_rc "CO8h unknown project is an empty report" 0 "$RC" "$OUT"
assert_has "CO8i empty report coverage" "$OUT" "coverage: 0/0 (0%)"

# ---- CO9 hostile: 10 MB VERIFICATION.md generated here, never committed ----
mk_cost_vault CV5 cost5 cov
HUGE="$CV5/project/cov/phases/huge"
mkdir -p "$HUGE"
{ printf 'Cost: 5 tokens (in 1, out 1, cache 3)\n'; head -c 10485760 /dev/zero | tr '\0' 'x'; printf '\n'; } > "$HUGE/VERIFICATION.md"
assert_eq "CO9a generated file is >= 10 MB" "$([[ $(wc -c < "$HUGE/VERIFICATION.md") -ge 10485760 ]] && echo yes || echo no)" "yes"
t0="$(date +%s)"
run_tools "$CV5" metrics cost --project cov
t1="$(date +%s)"
assert_rc "CO9b huge file does not crash" 0 "$RC" "$OUT"
assert_has "CO9c huge file is unreported too_large" "$OUT" "unreported phase cov/huge (too_large)"
assert_has "CO9d coverage counts it (3/5)" "$OUT" "coverage: 3/5 (60%)"
assert_has "CO9e total unchanged by the huge file" "$OUT" "total: 172375052 tokens"
assert_eq "CO9f run stayed fast (< 5 s)" "$([[ $((t1 - t0)) -lt 5 ]] && echo yes || echo no)" "yes"

# ---- CO10 review findings: prefix is mandatory, last line of either kind wins ----
# CO10a/b red with an optional prefix; CO10c/d red with "unavailable" not overriding a number.
mk_workdir CV6 cost6
mkdir -p "$CV6/project/pj/phases/prose" "$CV6/project/pj/phases/late-unavail" "$CV6/project/pj/phases/unavail-then-num"
printf '**Cost:** 50 tokens\n\n12 tokens per call is the rate.\n' > "$CV6/project/pj/phases/prose/VERIFICATION.md"
printf 'Cost: 1000 tokens (in 1)\n\nCost: unavailable (rerun failed)\n' > "$CV6/project/pj/phases/late-unavail/VERIFICATION.md"
printf '**Cost:** unavailable\n\n**Cost:** 7 tokens\n' > "$CV6/project/pj/phases/unavail-then-num/VERIFICATION.md"
run_tools "$CV6" metrics cost --project pj
assert_rc "CO10a probe run" 0 "$RC" "$OUT"
assert_has "CO10b bare prose '12 tokens' is not a cost line" "$OUT" "phase pj/prose 50 tokens"
assert_eq "CO10b2 no note for prose (count 0)" "$(count_lines '^note: pj/prose' "$OUT")" "0"
assert_has "CO10c later unavailable overrides an earlier number" "$OUT" "unreported phase pj/late-unavail (unavailable)"
assert_eq "CO10d overridden number is not a row (count 0)" "$(count_lines '^phase pj/late-unavail ' "$OUT")" "0"
assert_has "CO10e later number overrides earlier unavailable" "$OUT" "phase pj/unavail-then-num 7 tokens"

# ---- CO11 missing flag values are usage errors ----
for fl in --project --last; do
  run_tools "$CV" metrics cost "$fl"
  assert_rc "CO11 $fl without value" 1 "$RC" "$OUT"
  run_tools "$CV" metrics cost "$fl" --json
  assert_rc "CO11 $fl followed by a flag" 1 "$RC" "$OUT"
done

# ---- CO12 --last N limits per kind: phases and fixes separately ----
mk_workdir CV7 cost7
mkdir -p "$CV7/project/lk/phases/p1" "$CV7/project/lk/phases/p2" "$CV7/project/lk/fixes"
printf -- '---\nverified: 2026-01-01\n---\nCost: 1 tokens\n' > "$CV7/project/lk/phases/p1/VERIFICATION.md"
printf -- '---\nverified: 2026-01-02\n---\nCost: 2 tokens\n' > "$CV7/project/lk/phases/p2/VERIFICATION.md"
for d in 2026-02-01 2026-02-02; do
  printf -- '---\ntype: bug-report\nstatus: fixed\nreported_at: %s\n---\nCost: 10 tokens\n' "$d" > "$CV7/project/lk/fixes/$d-x.md"
done
run_tools "$CV7" metrics cost --project lk --last 1
assert_rc "CO12a --last 1" 0 "$RC" "$OUT"
assert_has "CO12b one phase plus one fix (2 + 10)" "$OUT" "total: 12 tokens"
assert_has "CO12c two rows" "$OUT" "rows: 2"

# ---- CO13 hostile phase directory name cannot forge report lines ----
mk_workdir CV8 cost8
NL="$CV8/project/hn/phases/evil
unreported phase forged (x)"
mkdir -p "$NL"
printf 'Cost: 3 tokens\n' > "$NL/VERIFICATION.md"
run_tools "$CV8" metrics cost --project hn
assert_rc "CO13a newline dir name" 0 "$RC" "$OUT"
assert_eq "CO13b no forged line (count 0)" "$(count_lines '^unreported phase forged' "$OUT")" "0"
assert_has "CO13c name printed quoted" "$OUT" 'hn/"evil\nunreported phase forged (x)"'
