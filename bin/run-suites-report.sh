#!/usr/bin/env bash
# bin/run-suites-report.sh — reporting side of the fixture-suite runner (spec 026). Sourced by
# bin/run-suites.sh; functions and globals only.
#
# Per suite: identity, exit code, elapsed seconds, log path, assert count (rs_parse_count) and a
# failure note. At the end of a run: the timing table (rows by elapsed seconds, descending), the
# no_count report line and the failure list (every failing suite with its log path).

# Result records (parallel indexed arrays, index = completion order).
RS_N_RES=0
RS_RES_ID=()
RS_RES_RC=()
RS_RES_SEC=()
RS_RES_LOG=()
RS_RES_NOTE=()
RS_RES_CNT=()

RS_NO_SUMMARY_NOTE="no assert summary"
RS_NOCOUNT_LIST=""
RS_NOCOUNT_LOADED=0

# rs_parse_count <logfile> — the assert count (passed + failed) of the LAST summary line in one of
# three formats, or "n/a". Formats: "<x>: N passed, M failed[, skipped=K]" (also bare or after
# "Total:"/"----"), "pass=N fail=M", "passed: N   failed: M". POSIX awk, no gawk extensions.
rs_parse_count() {
  local f="${1:-}"
  if [ -z "$f" ] || [ ! -f "$f" ]; then printf 'n/a\n'; return 0; fi
  awk '
function two(t,   a) { gsub(/[^0-9]+/, " ", t); sub(/^ +/, "", t); split(t, a, " "); return a[1] + a[2] }
/[0-9]+ passed, [0-9]+ failed/ { match($0, /[0-9]+ passed, [0-9]+ failed/); got = two(substr($0, RSTART, RLENGTH)); next }
/pass=[0-9]+ fail=[0-9]+/ { match($0, /pass=[0-9]+ fail=[0-9]+/); got = two(substr($0, RSTART, RLENGTH)); next }
/passed: +[0-9]+ +failed: +[0-9]+/ { match($0, /passed: +[0-9]+ +failed: +[0-9]+/); got = two(substr($0, RSTART, RLENGTH)); next }
END { if (got == "") print "n/a"; else print got }
' "$f" 2>/dev/null || printf 'n/a\n'
}

# rs_load_nocount — reads "no_count" from the declaration file of the run's root once (JSON parse).
rs_load_nocount() {
  [ "$RS_NOCOUNT_LOADED" -eq 0 ] || return 0
  RS_NOCOUNT_LOADED=1
  local f="${RS_ROOT:-.}/_test-fixtures/suite-groups.json" out
  [ -f "$f" ] || return 0
  out="$(node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write((j.no_count || []).join("\n"));
' "$f" 2>/dev/null)" || out=""
  RS_NOCOUNT_LIST=$'\n'"$out"$'\n'
}

# rs_in_nocount <id> — 0 when the suite is declared as printing no assert count.
rs_in_nocount() {
  rs_load_nocount
  [[ "$RS_NOCOUNT_LIST" == *$'\n'"$1"$'\n'* ]]
}

# rs_summary_note <id> <rc> <log> — prints "no assert summary" for a green suite whose log has no
# summary and which is not declared in no_count; empty otherwise (failing suites keep their rc).
rs_summary_note() {
  if [ "$2" -eq 0 ] && [ "$(rs_parse_count "$3")" = "n/a" ] && ! rs_in_nocount "$1"; then
    printf '%s\n' "$RS_NO_SUMMARY_NOTE"
  fi
  return 0
}

# rs_record_result <identity> <rc> <seconds> <log> <note>
rs_record_result() {
  RS_RES_ID[$RS_N_RES]="$1"
  RS_RES_RC[$RS_N_RES]="$2"
  RS_RES_SEC[$RS_N_RES]="$3"
  RS_RES_LOG[$RS_N_RES]="$4"
  RS_RES_NOTE[$RS_N_RES]="$5"
  RS_RES_CNT[$RS_N_RES]="$(rs_parse_count "$4")"
  RS_N_RES=$((RS_N_RES + 1))
}

# rs_result_failed <index> — 0 when the suite counts as failed.
rs_result_failed() { [ "${RS_RES_RC[$1]}" -ne 0 ] || [ -n "${RS_RES_NOTE[$1]}" ]; }

# rs_print_table — one row per suite, elapsed seconds descending (ties: identity), then the
# no_count report. Row: status, seconds, count, identity (identity last, verbatim).
rs_print_table() {
  local i=0 idx st lines
  echo "suite results:"
  lines=""
  while [ "$i" -lt "$RS_N_RES" ]; do
    lines="$lines${RS_RES_SEC[$i]}"$'\t'"${RS_RES_ID[$i]}"$'\t'"$i"$'\n'
    i=$((i + 1))
  done
  while IFS=$'\t' read -r _ _ idx; do
    [ -n "$idx" ] || continue
    st=PASS
    if rs_result_failed "$idx"; then st=FAIL; fi
    printf '  %-4s %5ss %5s  %s\n' "$st" "${RS_RES_SEC[$idx]}" "${RS_RES_CNT[$idx]}" "${RS_RES_ID[$idx]}"
  done <<< "$(printf '%s' "$lines" | LC_ALL=C sort -t"$(printf '\t')" -k1,1nr -k2,2)"
  rs_print_nocount_report
}

# rs_print_nocount_report — a no_count suite that printed a count should leave the list.
rs_print_nocount_report() {
  local i=0
  while [ "$i" -lt "$RS_N_RES" ]; do
    if [ "${RS_RES_CNT[$i]}" != "n/a" ] && rs_in_nocount "${RS_RES_ID[$i]}"; then
      echo "no_count: ${RS_RES_ID[$i]} prints a count (${RS_RES_CNT[$i]}); remove it from no_count in _test-fixtures/suite-groups.json"
    fi
    i=$((i + 1))
  done
  return 0
}

# rs_print_failures — every failing suite with its log path and reason.
rs_print_failures() {
  local i=0
  while [ "$i" -lt "$RS_N_RES" ]; do
    if rs_result_failed "$i"; then
      echo "FAILED: ${RS_RES_ID[$i]} (rc=${RS_RES_RC[$i]}${RS_RES_NOTE[$i]:+, ${RS_RES_NOTE[$i]}}) log: ${RS_RES_LOG[$i]}"
    fi
    i=$((i + 1))
  done
  return 0
}
