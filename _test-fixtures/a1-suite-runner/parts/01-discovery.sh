# Part 01 (Wave 1) — discovery and the declaration file. Sourced by run-tests.sh.
# FR-001 (discovery = glob + parser runner), FR-025 (declaration file, exit 2 when missing/invalid).
#
# Red-making changes (one production-code line each, run on a git archive snapshot):
#  D1a/D1b/D1c: dropping the `run-parser.sh` append in discovery (the parser runner vanishes from the
#               list and the count).
#  D1d:         widening the glob to `_test-fixtures/*/*/run*.sh` (run-deep.sh is discovered and run).
#  D1e:         a bare `*.sh` glob instead of `run*.sh` (helper.sh is discovered and run).
#  D3:          the declaration file is not required to hold the four keys (real file shape check).
#  D4a-c / D5a-c / D6a-c: not exiting 2 on a missing / invalid / wrongly shaped file, or exiting 2
#               only after the pool started (the probe file then exists).

# ---- S0: the runner exists (every later case depends on it) ----
if [[ -f "$RUNNER" ]]; then ok "S0 bin/run-suites.sh exists"; else bad "S0 bin/run-suites.sh exists" "missing: $RUNNER"; fi
for h in run-suites-proc.sh run-suites-report.sh; do
  if [[ -f "$REPO_ROOT/bin/$h" ]]; then ok "S0 bin/$h exists"; else bad "S0 bin/$h exists" "missing"; fi
done

# ---- D1: discovery on a planted tree ----
mk_tree T_DISC disc
PROBE_DISC="$T_DISC/probe-must-not-exist"
plant_ok "$T_DISC" a1-x/run-tests.sh
plant_ok "$T_DISC" a1-x/run-other.sh
plant_ok "$T_DISC" a1-schema-check/parser/run-parser.sh
plant_suite "$T_DISC" a1-x/helper.sh ": > \"$PROBE_DISC.helper\""          # not run*.sh
plant_suite "$T_DISC" a1-x/sub/run-deep.sh ": > \"$PROBE_DISC.deep\""      # one directory level too deep
plant_suite "$T_DISC" a1-schema-check/parser/other.sh ": > \"$PROBE_DISC.other\""
rs_run "$T_DISC"
DISC_LIST="$(printf '%s\n' "$RS_OUT" | grep -E '^[^ ]+\.sh$')"
DISC_EXPECTED='a1-schema-check/parser/run-parser.sh
a1-x/run-other.sh
a1-x/run-tests.sh'
assert_eq "D1a discovered identities equal the literal expected list" "$DISC_LIST" "$DISC_EXPECTED"
assert_eq "D1b discovered count equals the literal count (3)" "$(printf '%s\n' "$DISC_LIST" | grep -c '')" "3"
assert_contains "D1c header names the count" "$RS_OUT" "discovered 3 suites"
assert_file_absent "D1d run-deep.sh (one level too deep) is neither listed nor run" "$PROBE_DISC.deep"
assert_file_absent "D1e helper.sh and other.sh (not run*.sh) are neither listed nor run" "$PROBE_DISC.helper"
assert_file_absent "D1e2 parser/other.sh is neither listed nor run" "$PROBE_DISC.other"
assert_eq "D1f three green planted suites exit 0" "$RS_RC" "0"
assert_absent "D1g no a1-reconcile selected: no reconcile line, no git skip line" "$RS_OUT" "no git work tree"

# ---- D3: the real declaration file ----
REAL_GROUPS="$REPO_ROOT/_test-fixtures/suite-groups.json"
keys="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(Object.keys(j).sort().join(","))' "$REAL_GROUPS" 2>&1)"
assert_eq "D3a real suite-groups.json has exactly the four keys" "$keys" "ci_jobs,no_count,serial,timings"
nc="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.no_count.indexOf("a1-schema-check/parser/run-parser.sh")>=0))' "$REAL_GROUPS" 2>&1)"
assert_eq "D3b run-parser.sh is listed under no_count" "$nc" "true"

# ---- D4..D6: missing / invalid / wrongly shaped declaration file -> exit 2, no suite started ----
decl_case() { # label setup-command-string
  local label="$1" tree probe
  mk_workdir tree decl
  mkdir -p "$tree/_test-fixtures"
  probe="$tree/probe-started"
  plant_suite "$tree" p/run-tests.sh ": > \"$probe\"; echo 'p: 1 passed, 0 failed'"
  case "$label" in
    missing) ;;
    invalid) printf '{ nope' > "$tree/_test-fixtures/suite-groups.json" ;;
    shape)   printf '{"serial":"x","no_count":[],"ci_jobs":{},"timings":{}}' > "$tree/_test-fixtures/suite-groups.json" ;;
    nokey)   printf '{"serial":[],"ci_jobs":{},"timings":{}}' > "$tree/_test-fixtures/suite-groups.json" ;;
  esac
  rs_run "$tree"
  assert_eq "D4/$label exit 2" "$RS_RC" "2"
  assert_contains "D4/$label message names suite-groups.json" "$RS_OUT" "suite-groups.json"
  assert_file_absent "D4/$label no suite started (probe file absent)" "$probe"
}
decl_case missing
decl_case invalid
decl_case shape
decl_case nokey
