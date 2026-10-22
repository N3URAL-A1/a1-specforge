# Part 02 — spec 018 Wave 2: `metrics escaped` (FR-006..FR-009, FR-015, SC-001).
# Sourced by run-tests.sh; helpers (ok/bad/assert_*/run_tools/mk_workdir) come from there.
#
# Inputs are byte copies of real vault postmortems (fixtures/escaped/base/ from
# a1-office, fixtures/postmortems/ from a1-specforge); mk_pm edits ONLY the named
# frontmatter keys. Runs come from the real spec/fix fixtures (14 runs; the oldest
# of the last 10 is 2026-09-13, of the last 3 is 2026-10-14).
#
# Each case names the single production change that turns it red:
#   ES2 BLOCKER upper case : dropping the lowercase step in metrics-escaped.cjs
#   ES4 unknown/legacy     : counting found_by/should_have_caught "unknown" as escaped
#   ES3/ES5 window         : window start not the oldest run of the last N
#   ES6 tie order          : group sort by insertion order instead of count, name
#   ES7 fail-above         : breach test not strictly "greater than"

ESC_BASE="$FIXT/escaped/base"
BASE_A="$ESC_BASE/2026-07-22-briefing-agent-def-id-mismatch.md"          # blocker, no date, no keys
BASE_B="$ESC_BASE/2026-09-10-invoice-pdf-snapshot-grant-revoked.md"      # BLOCKER (upper), dated
BASE_C="$FIXT/postmortems/2026-07-12-cmd-injection-git-helper.md"        # blocker, dated
BASE_D="$FIXT/postmortems/2026-10-08-intent-approve-guard.md"            # major, dated

# set_key <file> <key> <value|-> — replace, insert or (value "-") drop one frontmatter key.
set_key() {
  local f="$1" k="$2" v="$3" t="$1.new"
  K="$k" V="$v" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; n = 0; done = 0 }
    /^---[ \t]*$/ { n++; if (n == 2 && !done && v != "-") print k ": " v; print; next }
    n == 1 && index($0, k ":") == 1 { done = 1; if (v != "-") print k ": " v; next }
    { print }' "$f" > "$t" && mv "$t" "$f"
}

# mk_pm <vault> <dest-name> <base-file> [key=value ...]
mk_pm() {
  local vault="$1" dest="$2" base="$3" kv; shift 3
  mkdir -p "$vault/project/demo/postmortems"
  cp "$base" "$vault/project/demo/postmortems/$dest"
  for kv in "$@"; do set_key "$vault/project/demo/postmortems/$dest" "${kv%%=*}" "${kv#*=}"; done
}

# mk_demo <VAR> <label> — vault with project "demo": the 14 real runs and no postmortems.
mk_demo() {
  local __dv
  mk_workdir __dv "$2"
  mkdir -p "$__dv/project/demo/postmortems"
  cp -R "$FIXT/spec" "$FIXT/fixes" "$__dv/project/demo/"
  printf -v "$1" '%s' "$__dv"
}

# add_base_set <vault> — 3 escaped, 2 non-escaped, 2 legacy, 1 escaped-but-before-the-window.
add_base_set() {
  local v="$1" gate=gate-0.6-schema
  mk_pm "$v" 2026-10-01-invoice-grant.md "$BASE_B" date=2026-10-01 found_by=user should_have_caught=$gate
  mk_pm "$v" 2026-10-02-briefing-id.md "$BASE_A" found_by=post-merge-ci should_have_caught=gate-99-removed
  mk_pm "$v" 2026-10-16-cmd-injection.md "$BASE_C" date=2026-10-16 found_by=production should_have_caught=reviewer:a1-samuel-security
  mk_pm "$v" 2026-10-06-reviewer-caught.md "$BASE_C" date=2026-10-06 found_by=reviewer:a1-reinhard-reviewer should_have_caught=$gate
  mk_pm "$v" 2026-10-07-major.md "$BASE_D" date=2026-10-07 found_by=user should_have_caught=$gate
  mk_pm "$v" 2026-10-03-legacy-a.md "$BASE_A"
  mk_pm "$v" 2026-10-04-legacy-b.md "$BASE_B" date=2026-10-04
  mk_pm "$v" 2026-09-01-before-window.md "$BASE_C" date=2026-09-01 found_by=user should_have_caught=$gate
}

# line_count <text> <fixed-string> — count of lines containing the string.
line_count() { grep -cF -- "$2" <<<"$1"; }
# json_get <expr over j> — evaluates against $OUT parsed as JSON.
json_get() { printf '%s' "$OUT" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String('"$1"'))'; }

# ---- ES0 fixtures are byte copies of real vault files ----
n_same=0
cmp -s "$BASE_A" "$HOME/N3URAL-Vault/project/a1-office/postmortems/2026-07-22-briefing-agent-def-id-mismatch.md" 2>/dev/null && n_same=$((n_same + 1))
[[ -d "$HOME/N3URAL-Vault" ]] || n_same=1   # vault absent (CI): the byte check is local-only
assert_eq "ES0 escaped base fixtures present (count assert, 2 files)" "$(ls "$ESC_BASE"/*.md | wc -l | tr -d ' ')" "2"
assert_eq "ES0b base A byte-equal to its vault source (count)" "$n_same" "1"
assert_eq "ES0c base A holds severity blocker (lower) and no found_by (count 1/0)" \
  "$(grep -c '^severity: blocker$' "$BASE_A")/$(grep -c '^found_by:' "$BASE_A")" "1/0"
assert_eq "ES0d base B holds severity BLOCKER (upper) (count 1)" "$(grep -c '^severity: BLOCKER$' "$BASE_B")" "1"

# ---- ES1 FR-006: 3 escaped, 2 non-escaped, 2 legacy; list is exactly the 3 ----
mk_demo V2 es1
add_base_set "$V2"
assert_eq "ES1a demo vault holds 8 postmortems (count)" "$(ls "$V2/project/demo/postmortems" | wc -l | tr -d ' ')" "8"
run_tools "$V2" metrics escaped --project demo --last 10
assert_rc "ES1b report exits 0" 0 "$RC" "$OUT"
assert_has "ES1c escaped: 3" "$OUT" "escaped: 3"
assert_eq "ES1d exactly 3 evidence lines (count assert)" "$(line_count "$OUT" 'found_by=')" "3"
for n in 2026-10-01-invoice-grant 2026-10-02-briefing-id 2026-10-16-cmd-injection; do
  assert_eq "ES1e lists $n (count 1)" "$(line_count "$OUT" "postmortems/$n.md")" "1"
done
for n in 2026-10-06-reviewer-caught 2026-10-07-major 2026-10-03-legacy-a 2026-10-04-legacy-b 2026-09-01-before-window; do
  assert_eq "ES1f does not list $n (count 0)" "$(line_count "$OUT" "$n")" "0"
done
assert_has "ES1g evidence carries found_by and should_have_caught" "$OUT" "found_by=post-merge-ci should_have_caught=gate-99-removed"
assert_eq "ES1h evidence sorted by date (first line is the 10-01 file)" \
  "$(grep -F 'found_by=' <<<"$OUT" | sed -n 1p | grep -c '2026-10-01-invoice-grant')" "1"
assert_has "ES1i unknown/legacy equals the 2 legacy files" "$OUT" "unknown/legacy: 2"

# ---- ES2 case-insensitive severity: BLOCKER (upper) and blocker (lower) both count ----
assert_eq "ES2a upper-case BLOCKER file is listed (count 1)" "$(line_count "$OUT" '2026-10-01-invoice-grant')" "1"
assert_eq "ES2b lower-case blocker file is listed (count 1)" "$(line_count "$OUT" '2026-10-02-briefing-id')" "1"
assert_eq "ES2c removed-gate name still counts (count 1)" "$(line_count "$OUT" 'should_have_caught=gate-99-removed')" "1"

# ---- ES1j --json carries the same data; default N is 10 ----
run_tools "$V2" metrics escaped --project demo --json
assert_rc "ES1j --json exits 0" 0 "$RC" "$OUT"
assert_eq "ES1k json escaped" "$(json_get 'j.escaped')" "3"
assert_eq "ES1l json evidence length" "$(json_get 'j.evidence.length')" "3"
assert_eq "ES1m json unknownLegacy" "$(json_get 'j.unknownLegacy')" "2"
assert_eq "ES1n json runs (default N=10 of 14 runs)" "$(json_get 'j.runs')" "10"
assert_eq "ES1o json evidence keys" "$(json_get 'Object.keys(j.evidence[0]).join(",")')" "path,date,found_by,should_have_caught"
assert_eq "ES1p json is one line (count)" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" "1"

# ---- ES3 window: --last 3 starts at 2026-10-14 ----
run_tools "$V2" metrics escaped --project demo --last 3
assert_has "ES3a runs: 3" "$OUT" "runs: 3"
assert_has "ES3b since 2026-10-14" "$OUT" "since: 2026-10-14"
assert_has "ES3c only the 10-16 file is inside" "$OUT" "escaped: 1"
assert_eq "ES3d one evidence line (count)" "$(line_count "$OUT" 'found_by=')" "1"
assert_has "ES3e unknown/legacy 0 inside the short window" "$OUT" "unknown/legacy: 0"
run_tools "$V2" metrics escaped --project demo --last 10
assert_has "ES3f --last 10 starts at 2026-09-13" "$OUT" "since: 2026-09-13"

# ---- ES4 FR-007: unknown / missing never escaped; printed number equals fixture count ----
mk_demo V3 es4
add_base_set "$V3"
mk_pm "$V3" 2026-10-08-unk-both.md "$BASE_C" date=2026-10-08 found_by=unknown should_have_caught=unknown
mk_pm "$V3" 2026-10-09-unk-should.md "$BASE_C" date=2026-10-09 found_by=user should_have_caught=unknown
mk_pm "$V3" 2026-10-10-unk-found.md "$BASE_C" date=2026-10-10 found_by=unknown should_have_caught=gate-0.6-schema
mk_pm "$V3" 2026-10-11-none.md "$BASE_C" date=2026-10-11 found_by=user should_have_caught=none
run_tools "$V3" metrics escaped --project demo
assert_rc "ES4a exits 0" 0 "$RC" "$OUT"
assert_has "ES4b escaped stays 3 with 4 unknown/none files added" "$OUT" "escaped: 3"
assert_has "ES4c unknown/legacy = 2 legacy + 3 unknown (none is neither)" "$OUT" "unknown/legacy: 5"
assert_eq "ES4d no unknown file is listed (count 0)" "$(line_count "$OUT" 'unk-')" "0"
assert_eq "ES4e should=none file is not listed (count 0)" "$(line_count "$OUT" '2026-10-11-none')" "0"

# ---- ES5 FR-008: fewer runs than N, zero runs ----
mk_workdir V4 es5
mkdir -p "$V4/project/demo/spec" "$V4/project/demo/fixes"
cp "$FIXT/spec/007-retro-gate-id-validator.md" "$FIXT/spec/008-false-green-test-guards.md" "$V4/project/demo/spec/"
cp "$FIXT/fixes/2026-10-08-intent-approve-guard.md" "$FIXT/fixes/2026-10-12-worktree-slug-collision.md" "$V4/project/demo/fixes/"
add_base_set "$V4"
run_tools "$V4" metrics escaped --project demo --last 10
assert_rc "ES5a 4 runs with --last 10 exits 0" 0 "$RC" "$OUT"
assert_has "ES5b runs: 4" "$OUT" "runs: 4"
assert_has "ES5c window starts at the oldest of the 4 (2026-09-12)" "$OUT" "since: 2026-09-12"
mk_workdir V5 es5z
mkdir -p "$V5/project/demo/postmortems"
add_base_set "$V5"
run_tools "$V5" metrics escaped --project demo
assert_rc "ES5d zero runs exits 0" 0 "$RC" "$OUT"
assert_has "ES5e runs: 0" "$OUT" "runs: 0"
assert_has "ES5f escaped: 0 despite 3 escaped files (empty window)" "$OUT" "escaped: 0"
assert_has "ES5g unknown/legacy: 0 (empty window)" "$OUT" "unknown/legacy: 0"
run_tools "$V5" metrics escaped --project nosuch
assert_rc "ES5h unknown project is a report, not an error" 0 "$RC" "$OUT"
assert_has "ES5i unknown project: runs: 0" "$OUT" "runs: 0"

# ---- ES6/ES7 FR-009 + FR-015: five escaped, a tie, fail-above ----
mk_demo V6 es6
add_base_set "$V6"
mk_pm "$V6" 2026-10-08-esc-four.md "$BASE_C" date=2026-10-08 found_by=user should_have_caught=gate-0.6-schema
mk_pm "$V6" 2026-10-03-esc-five.md "$BASE_C" date=2026-10-03 found_by=user should_have_caught=gate-0.1-early
run_tools "$V6" metrics escaped --project demo --group-by should-have-caught
assert_rc "ES6a group-by exits 0" 0 "$RC" "$OUT"
assert_has "ES6b five escaped" "$OUT" "escaped: 5"
GROUPS_OUT="$(sed -n '/^by should-have-caught:/,$p' <<<"$OUT" | sed 1d)"
WANT="$(printf '%s\n' '  gate-0.6-schema: 2' '  gate-0.1-early: 1' '  gate-99-removed: 1' '  reviewer:a1-samuel-security: 1')"
assert_eq "ES6c counts descending, ties by name ascending" "$GROUPS_OUT" "$WANT"
assert_eq "ES6d four groups (count assert)" "$(printf '%s\n' "$GROUPS_OUT" | wc -l | tr -d ' ')" "4"
FIRST="$OUT"
run_tools "$V6" metrics escaped --project demo --group-by should-have-caught
assert_eq "ES6e identical across repeated runs" "$OUT" "$FIRST"
run_tools "$V6" metrics escaped --project demo --group-by should-have-caught --json
assert_eq "ES6f json groups in the same order" "$(json_get 'j.groups.map(g=>g.name+"="+g.count).join(" ")')" \
  "gate-0.6-schema=2 gate-0.1-early=1 gate-99-removed=1 reviewer:a1-samuel-security=1"
run_tools "$V6" metrics escaped --project demo
assert_eq "ES6g without --group-by no group block (count 0)" "$(line_count "$OUT" 'by should-have-caught')" "0"

run_tools "$V6" metrics escaped --project demo
assert_rc "ES7a 5 escaped, no flag: exit 0" 0 "$RC" "$OUT"
run_tools "$V6" metrics escaped --project demo --fail-above 4
assert_rc "ES7b --fail-above 4: exit 1" 1 "$RC" "$OUT"
assert_has "ES7b2 breach still prints the report" "$OUT" "escaped: 5"
run_tools "$V6" metrics escaped --project demo --fail-above 5
assert_rc "ES7c --fail-above 5: exit 0" 0 "$RC" "$OUT"
run_tools "$V6" metrics escaped --project demo --fail-above 0 --last 3
assert_rc "ES7d --fail-above 0 with 1 escaped in window: exit 1" 1 "$RC" "$OUT"

# ---- ES8 I/O and usage errors exit 2 with one line, no stack ----
check_err() { # name expected-substring
  assert_rc "$1 exits 2" 2 "$RC" "$OUT"
  assert_has "$1 message" "$OUT" "$2"
  assert_eq "$1 no stack trace (count 0)" "$(line_count "$OUT" '    at ')" "0"
}
OUT="$(env -u A1_VAULT_ROOT node "$TOOLS" metrics escaped --project demo 2>&1)"; RC=$?
check_err "ES8a vault unset" "A1_VAULT_ROOT"
run_tools "$V6/does-not-exist" metrics escaped --project demo
check_err "ES8b vault path absent" "not a directory"
run_tools "$V6" metrics escaped
check_err "ES8c --project missing" "--project"
run_tools "$V6" metrics escaped --project '../x'
check_err "ES8d slug with path separator" "plain identifier"
run_tools "$V6" metrics escaped --project demo --last 0
check_err "ES8e --last 0" "--last"
run_tools "$V6" metrics escaped --project demo --last abc
check_err "ES8f --last abc" "--last"
run_tools "$V6" metrics escaped --project demo --fail-above -1
check_err "ES8g --fail-above -1" "--fail-above"
run_tools "$V6" metrics escaped --project demo --group-by severity
check_err "ES8h --group-by other value" "--group-by"
run_tools "$V6" metrics escaped --project demo --bogus
check_err "ES8i unknown flag" "unknown argument"

# ---- ES9 hostile input: odd names and values are data, never a crash ----
mk_demo V7 es9
add_base_set "$V7"
mk_pm "$V7" "2026-10-12-name with spaces.md" "$BASE_C" date=2026-10-12 found_by=user should_have_caught=gate-0.6-schema
mk_pm "$V7" 2026-10-13-inject.md "$BASE_C" date=2026-10-13 found_by=user 'should_have_caught="x\n---"'
printf -- '---\ntype: postmortem\nseverity: blocker\ndate: 2026-10-14\nfound_by: [unclosed\n' > "$V7/project/demo/postmortems/2026-10-14-broken.md"
run_tools "$V7" metrics escaped --project demo
assert_rc "ES9a hostile files: exit 0" 0 "$RC" "$OUT"
assert_has "ES9b 3 base + spaces file + injected-value file" "$OUT" "escaped: 5"
assert_eq "ES9d spaced file listed once (count)" "$(line_count "$OUT" 'name with spaces.md')" "1"
assert_has "ES9e0 broken frontmatter file is counted as unreadable, not fatal" "$OUT" "unreadable: 1"
assert_eq "ES9e injected value never prints a bare --- line (count 0)" "$(grep -c '^---$' <<<"$OUT")" "0"
assert_eq "ES9f injected value is printed as quoted data (count 1)" "$(line_count "$OUT" 'should_have_caught="x\\n---"')" "1"
run_tools "$V7" metrics escaped --project demo --json
assert_rc "ES9g json with hostile files: exit 0" 0 "$RC" "$OUT"
assert_eq "ES9h json is one line (count)" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" "1"

# ---- ES10 SC-001: 14 runs + 14 postmortems finish well under 2 s ----
T0="$(date +%s)"
run_tools "$V7" metrics escaped --project demo --last 10
T1="$(date +%s)"
assert_rc "ES10a timing run exits 0" 0 "$RC" "$OUT"
[[ $((T1 - T0)) -le 2 ]] && ok "ES10b report took $((T1 - T0))s (<= 2s incl. one-second clock granularity)" || bad "ES10b report took $((T1 - T0))s"
