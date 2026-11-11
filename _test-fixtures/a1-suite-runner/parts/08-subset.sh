# Part 08 (Wave 4, Task 4.1) — subset selection. Sourced by run-tests.sh (after 08-security).
# FR-020: an argument with "/" is a suite identity, one without is a directory selector over the
# discovered set; the header says "subset run: <identities>" (full runs say "full run"); an argument that
# selects nothing exits 2 before the lock, the work dir, the log dir and any suite exist.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  U1: arguments ignored (full run: more than 2 rows, probes of unselected suites exist)
#  U2: header not printed for subset runs ("subset run:" missing) / printed for full runs
#  U3: directory selector matches nothing or only one runner (bare "product-modules" selects < 5)
#  U4: unknown identity or directory not exit 2 (suites start / exit 0)
#  U5: selection checked after the lock / work dir / log dir exist (entries left behind)
#  U6: an empty selector argument tolerated (also covered by U4: an unknown one among valid ones runs the valid ones)
#  U7: overlapping selectors (directory + identity) start a suite twice

SB_UID="$(id -u)"
mk_tree T_SB sb
mk_workdir W_SB sbw
# sb_plant <identity> — a green suite that leaves one probe line per execution.
sb_plant() {
  plant_suite "$T_SB" "$1" "echo ran >> \"$W_SB/probe-\${0//\//__}\"; echo '$1: 1 passed, 0 failed'"
}
sb_plant a1-gates-lint/run-wave13.sh
sb_plant a1-gates-lint/run-wave2.sh
sb_plant a1-intent/run-tests.sh
sb_plant product-modules/run.sh
sb_plant product-modules/run-derive.sh
sb_plant product-modules/run-files.sh
sb_plant product-modules/run-help.sh
sb_plant product-modules/run-index.sh
sb_plant a1-other/run-tests.sh
sb_rows()   { printf '%s\n' "$1" | grep -cE '^  (PASS|FAIL) '; }
sb_probes() { find "$W_SB" -maxdepth 1 -name 'probe-*' | grep -c ''; }
sb_state()  { find "$RS_TMPD" -mindepth 1 | grep -c ''; }

# two identities
rs_run "$T_SB" a1-gates-lint/run-wave13.sh a1-intent/run-tests.sh
assert_eq "U1a two identities exit 0" "$RS_RC" "0"
assert_eq "U1b the table has exactly 2 rows" "$(sb_rows "$RS_OUT")" "2"
assert_eq "U1c exactly 2 probes (only the selected suites ran)" "$(sb_probes)" "2"
assert_file_present "U1d wave13 ran" "$W_SB/probe-_test-fixtures__a1-gates-lint__run-wave13.sh"
assert_file_present "U1e intent ran" "$W_SB/probe-_test-fixtures__a1-intent__run-tests.sh"
assert_contains "U2a subset header lists both identities" "$RS_OUT" \
  "subset run: a1-gates-lint/run-wave13.sh a1-intent/run-tests.sh"
assert_absent "U2b a subset run never says full run" "$RS_OUT" "full run"

# directory selector
rm -f "$W_SB"/probe-*
rs_run "$T_SB" product-modules
assert_eq "U3a directory selector exits 0" "$RS_RC" "0"
assert_eq "U3b bare directory selects all five runners (5 rows)" "$(sb_rows "$RS_OUT")" "5"
assert_eq "U3c five probes" "$(sb_probes)" "5"
assert_contains "U3d header names a runner of the directory" "$RS_OUT" "product-modules/run-index.sh"

# overlap: directory + one of its identities runs it once
rm -f "$W_SB"/probe-*
rs_run "$T_SB" product-modules product-modules/run.sh a1-intent/run-tests.sh
assert_eq "U7a overlapping selectors: 6 rows, no duplicate" "$(sb_rows "$RS_OUT")" "6"
assert_eq "U7b the overlapped suite ran once" \
  "$(grep -c '' "$W_SB/probe-_test-fixtures__product-modules__run.sh")" "1"

# full run still says so
rm -f "$W_SB"/probe-*
rs_run "$T_SB"
assert_contains "U2c a full run says full run" "$RS_OUT" "full run"
assert_absent "U2d a full run has no subset marker" "$RS_OUT" "subset run:"
assert_eq "U1f a full run has 9 rows" "$(sb_rows "$RS_OUT")" "9"

# unknown selections: exit 2, nothing exists afterwards
for SB_ARG in nope/run-tests.sh nosuchdir run-tests.sh a1-intent/run-nope.sh ""; do
  rm -f "$W_SB"/probe-*
  rs_run "$T_SB" "$SB_ARG"
  assert_eq "U4a selection [$SB_ARG] exits 2" "$RS_RC" "2"
  assert_eq "U4b selection [$SB_ARG]: no suite started" "$(sb_probes)" "0"
  assert_eq "U5a selection [$SB_ARG]: no temp, log dir or lock left" \
    "$(sb_state) $([[ -e "$RS_LOCKD" ]] && echo lock || echo nolock)" "0 nolock"
  assert_contains "U4c selection [$SB_ARG]: the message says what is unknown" "$RS_OUT" "run-suites:"
  assert_absent "U4d selection [$SB_ARG]: no table" "$RS_OUT" "suite results"
done
assert_contains "U4e the message names the unknown identity" "$(rs_run "$T_SB" nope/run-tests.sh; echo "$RS_OUT")" "nope/run-tests.sh"
rm -f "$W_SB"/probe-*
rs_run "$T_SB" a1-intent/run-tests.sh nope/run-tests.sh
assert_eq "U6a a valid and an unknown argument exit 2" "$RS_RC" "2"
assert_eq "U6b the valid one did not run either" "$(sb_probes)" "0"

# ---- [FR-027] workers run under LC_ALL=C ----
# Red-making change: U8: the `export LC_ALL=C` line in bin/run-suites.sh removed (the worker inherits
# LC_ALL empty / LC_COLLATE=en_US.UTF-8: the probe shows no LC_ALL=C and 05b-writer.sh globs before 05-hosts.sh).
mk_tree T_LC lc
mk_workdir W_LC lcw
mkdir -p "$T_LC/_test-fixtures/lc/parts"
: > "$T_LC/_test-fixtures/lc/parts/05-hosts.sh"
: > "$T_LC/_test-fixtures/lc/parts/05b-writer.sh"
plant_suite "$T_LC" lc/run-tests.sh "{ echo \"LC_ALL=\${LC_ALL-UNSET}\"; for f in _test-fixtures/lc/parts/05*.sh; do echo \"glob \${f##*/}\"; done; } > \"$W_LC/probe\"
echo 'lc: 1 passed, 0 failed'"
RS_ENV_EXTRA="LC_ALL= LANG=en_US.UTF-8 LC_COLLATE=en_US.UTF-8" rs_run "$T_LC"
assert_eq "[FR-027] run exits 0" "$RS_RC" "0"
assert_eq "[FR-027] the worker sees LC_ALL=C" "$(head -n 1 "$W_LC/probe" 2>/dev/null)" "LC_ALL=C"
assert_eq "[FR-027] 05-hosts.sh globs before 05b-writer.sh" "$(tail -n +2 "$W_LC/probe" 2>/dev/null | tr '\n' ' ')" "glob 05-hosts.sh glob 05b-writer.sh "
