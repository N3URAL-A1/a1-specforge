# Part 12 (Wave 8, Task 8.4) — sleep audit of a1-xprov parts and a1-intent cases (spec 026 FR-019). Sourced by run-tests.sh.
# Every code line that calls `sleep` in _test-fixtures/a1-xprov/parts/*.sh and _test-fixtures/a1-intent/cases/*.sh is
# either inside a bounded polling helper (poll_until, defined in a1-intent/lib.sh; a case file holds no raw sleep for
# it) or the line before it carries `deliberate-timeout: <reason>` (bash `#` or JS `//`). Comment-only lines do not count.
# Red-making change: a bare `sleep` line without the annotation (e.g. strip one annotation line) · an annotation
# without a reason · poll_until losing its bound or its sleep.

SA_FIX="$REPO_ROOT/_test-fixtures"
SA_FILES=("$SA_FIX"/a1-xprov/parts/*.sh "$SA_FIX"/a1-intent/cases/*.sh)

# sa_scan <files...> — prints "<total> <annotated> <annotated-without-reason> <bare-lines...>"
sa_scan() {
  awk '
    FNR == 1 { prev = "" }
    {
      line = $0
      if (line ~ /^[ \t]*#/ || line !~ /(^|[^A-Za-z0-9_])sleep([^A-Za-z0-9_]|$)/) { prev = line; next }
      total++
      if (line ~ /deliberate-timeout:/ || prev ~ /(#|\/\/) deliberate-timeout:/) {
        ann++
        src = (prev ~ /deliberate-timeout:/) ? prev : line
        sub(/.*deliberate-timeout:[ \t]*/, "", src)
        if (src == "") noreason++
      } else bare = bare " " FILENAME ":" FNR
      prev = line
    }
    END { printf "%d %d %d%s\n", total, ann, noreason, bare }
  ' "$@"
}

SA_RES="$(sa_scan "${SA_FILES[@]}")"
read -r SA_TOTAL SA_ANN SA_NOREASON SA_BARE <<<"$SA_RES"
SA_POLLED=0   # sleep lines inside the polling helper: none live in the case files, the helper is in lib.sh
assert_eq "SA1 the audit sees sleep lines (not vacuous)" "$([[ "$SA_TOTAL" -gt 0 ]] && echo yes || echo no)" "yes"
assert_eq "SA2 polled + annotated sleep lines equal the total sleep lines (bare: ${SA_BARE:-none})" "$((SA_POLLED + SA_ANN))" "$SA_TOTAL"
assert_eq "SA3 every annotation names a reason" "$SA_NOREASON" "0"

# the helper itself: bounded and polling
SA_LIB="$SA_FIX/a1-intent/lib.sh"
SA_HELPER="$(awk '/^poll_until\(\) \{/,/^\}/' "$SA_LIB")"
assert_contains "SA4a poll_until takes a bound in seconds" "$SA_HELPER" 'local bound="$1"'
assert_contains "SA4b poll_until loops a finite number of times and sleeps between tries" "$SA_HELPER" 'sleep 0.1'
assert_contains "SA4c poll_until counts its iterations from the bound" "$SA_HELPER" 'n=$(( bound * 10 ))'

# the audit itself catches a bare sleep and an annotation without a reason
SA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/sa12.XXXXXX")"
printf 'x\nsleep 1\n' > "$SA_TMP/bare.sh"
printf '# deliberate-timeout: because\nsleep 1\n' > "$SA_TMP/ann.sh"
printf '# deliberate-timeout:\nsleep 1\n' > "$SA_TMP/noreason.sh"
printf '// deliberate-timeout: js\n  const c = cp.spawn("/bin/sleep", ["30"]);\n' > "$SA_TMP/js.sh"
printf '# sleep in a comment\necho "sleeps"\n' > "$SA_TMP/none.sh"
assert_eq "SA5a a bare sleep is counted as bare" "$(sa_scan "$SA_TMP/bare.sh" | cut -d' ' -f1-2)" "1 0"
assert_eq "SA5b an annotated sleep passes" "$(sa_scan "$SA_TMP/ann.sh")" "1 1 0"
assert_eq "SA5c an annotation without a reason is flagged" "$(sa_scan "$SA_TMP/noreason.sh")" "1 1 1"
assert_eq "SA5d a JS-style annotation covers a /bin/sleep spawn" "$(sa_scan "$SA_TMP/js.sh")" "1 1 0"
assert_eq "SA5e comments and words like sleeps are not sleep calls" "$(sa_scan "$SA_TMP/none.sh")" "0 0 0"
rm -rf "$SA_TMP"

# FR-018: a1-xprov times every part in the same shell and prints a sorted summary
SA_XR="$SA_FIX/a1-xprov/run-tests.sh"
assert_contains "SA6a a1-xprov times each sourced part with SECONDS" "$(cat "$SA_XR")" 'xp_dt=$((SECONDS - xp_t0))'
assert_contains "SA6b a1-xprov prints a per-part time line" "$(cat "$SA_XR")" 'echo "time  $xp_name ${xp_dt}s"'
assert_contains "SA6c a1-xprov prints the summary sorted by elapsed descending" "$(cat "$SA_XR")" 'sort -k3,3nr'
