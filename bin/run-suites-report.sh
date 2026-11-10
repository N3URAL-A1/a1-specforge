#!/usr/bin/env bash
# bin/run-suites-report.sh — reporting side of the fixture-suite runner (spec 026). Sourced by
# bin/run-suites.sh; functions and globals only.
#
# Wave 1 holds minimal working versions behind the contract names (identity, status, seconds per
# suite; failing suites named with their log); Wave 2 owns the real table, the strict count parser
# and the failure output.

# Result records (parallel indexed arrays, index = completion order).
RS_N_RES=0
RS_RES_ID=()
RS_RES_RC=()
RS_RES_SEC=()
RS_RES_LOG=()
RS_RES_NOTE=()

# rs_record_result <identity> <rc> <seconds> <log> <note>
rs_record_result() {
  RS_RES_ID[$RS_N_RES]="$1"
  RS_RES_RC[$RS_N_RES]="$2"
  RS_RES_SEC[$RS_N_RES]="$3"
  RS_RES_LOG[$RS_N_RES]="$4"
  RS_RES_NOTE[$RS_N_RES]="$5"
  RS_N_RES=$((RS_N_RES + 1))
}

# rs_parse_count <logfile> — W1 placeholder; Wave 2 implements the three summary formats.
rs_parse_count() { printf 'n/a\n'; }

# rs_print_table — one row per result in completion order (Wave 2: sorted by elapsed, with counts).
rs_print_table() {
  local i=0 st
  echo "suite results:"
  while [ "$i" -lt "$RS_N_RES" ]; do
    st=PASS
    [ "${RS_RES_RC[$i]}" -eq 0 ] && [ -z "${RS_RES_NOTE[$i]}" ] || st=FAIL
    printf '  %-4s %5ss  %s\n' "$st" "${RS_RES_SEC[$i]}" "${RS_RES_ID[$i]}"
    i=$((i + 1))
  done
}

# rs_print_failures — every failing suite with its log path and reason.
rs_print_failures() {
  local i=0 n=0
  while [ "$i" -lt "$RS_N_RES" ]; do
    if [ "${RS_RES_RC[$i]}" -ne 0 ] || [ -n "${RS_RES_NOTE[$i]}" ]; then
      echo "FAILED: ${RS_RES_ID[$i]} (rc=${RS_RES_RC[$i]}${RS_RES_NOTE[$i]:+, ${RS_RES_NOTE[$i]}}) log: ${RS_RES_LOG[$i]}"
      n=$((n + 1))
    fi
    i=$((i + 1))
  done
  return 0
}
