# Part 20 (spec 027 slice 3, Task 4.1) — --suite-timeout-ms watchdog and the per-worker verify lock dir (D12).
# Sourced by run-tests.sh (after 19-lock-wait). Each runner start is bounded to 40 s by rs_run.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  WD1: rs_watchdog not called · WD2: the KILL escalation removed · WD5: D12 made unconditional

RS_RUN_LIMIT_TICKS=200   # x 0.2 s = 40 s kill bound for the cases below
wd_get() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(eval(process.argv[2])))' "$1" "$2" 2>&1; }

mk_tree T_WD wd
mk_workdir W_WD wdw
plant_suite "$T_WD" hang/run-tests.sh 'sleep 60'
plant_suite "$T_WD" fast/run-tests.sh 'echo "fast: 1 passed, 0 failed"'
WD_T0=$SECONDS
rs_run "$T_WD" --suite-timeout-ms 2000 --json-out "$W_WD/a.json"
WD_EL=$((SECONDS - WD_T0))
assert_eq "WD1a runner exits 1" "$RS_RC" "1"
if [[ $WD_EL -le 20 ]]; then ok "WD1b ended within 20 s (${WD_EL}s)"; else bad "WD1b ended within 20 s" "took ${WD_EL}s"; fi
assert_eq "WD1c hung suite: timed_out true, exit_code null" "$(wd_get "$W_WD/a.json" 'j.results.filter(r=>r.id==="hang/run-tests.sh").map(r=>[r.timed_out,r.exit_code])[0]')" '[true,null]'
WD_SIG="$(wd_get "$W_WD/a.json" 'j.results.find(r=>r.id==="hang/run-tests.sh").signal' | tr -d '"')"
assert_eq "WD1d signal is SIGTERM or SIGKILL" "$([[ "$WD_SIG" == SIGTERM || "$WD_SIG" == SIGKILL ]] && echo yes || echo "no: [$WD_SIG]")" "yes"
assert_eq "WD3 the fast suite is not timed out" "$(wd_get "$W_WD/a.json" 'j.results.find(r=>r.id==="fast/run-tests.sh").timed_out')" "false"
assert_contains "WD1e the timed-out note is in the output" "$RS_OUT" "timed out after"

mk_tree T_WD2 wd2
plant_suite "$T_WD2" stub/run-tests.sh "trap '' TERM; sleep 60"
WD_T0=$SECONDS
rs_run "$T_WD2" --suite-timeout-ms 2000 --json-out "$W_WD/b.json"
WD_EL=$((SECONDS - WD_T0))
assert_eq "WD2a timed_out true" "$(wd_get "$W_WD/b.json" 'j.results[0].timed_out')" "true"
if [[ $WD_EL -le 20 ]]; then ok "WD2b a TERM-ignoring suite ended within 20 s (${WD_EL}s)"; else bad "WD2b ended within 20 s" "took ${WD_EL}s"; fi

mk_tree T_WD4 wd4
plant_suite "$T_WD4" gc/run-tests.sh "sleep 300 & echo \$! > \"$W_WD/gc.pid\"; wait"
rs_run "$T_WD4" --suite-timeout-ms 2000
WD_GC="$(cat "$W_WD/gc.pid" 2>/dev/null)"
if [[ -n "$WD_GC" ]] && ! kill -0 "$WD_GC" 2>/dev/null; then ok "WD4 the hung suite's grandchild is gone"; else bad "WD4 the hung suite's grandchild is gone" "pid [$WD_GC]"; kill "$WD_GC" 2>/dev/null; fi

mk_tree T_WD5 wd5
plant_suite "$T_WD5" probe/run-tests.sh "printf '%s' \"\${A1_VERIFY_LOCK_DIR-UNSET}\" > \"$W_WD/probe.txt\"; echo 'probe: 1 passed, 0 failed'"
RS_ENV_EXTRA="-u A1_VERIFY_LOCK_TOKEN A1_VERIFY_LOCK_DIR=/outer" rs_run "$T_WD5"
WD_P="$(cat "$W_WD/probe.txt" 2>/dev/null)"
assert_contains "WD5a no token: a private dir named vlock" "$WD_P" "/vlock"
assert_absent "WD5b no token: not the outer value" "$WD_P" "/outer"
case "$WD_P" in "$RS_TMPD"/*) ok "WD5c the dir lies under the runner work dir" ;; *) bad "WD5c the dir lies under the runner work dir" "got [$WD_P]" ;; esac
rm -f "$W_WD/probe.txt"
RS_ENV_EXTRA="A1_VERIFY_LOCK_TOKEN=x A1_VERIFY_LOCK_DIR=/outer" rs_run "$T_WD5"
assert_eq "WD5d with a token the outer dir is kept" "$(cat "$W_WD/probe.txt" 2>/dev/null)" "/outer"

rs_run "$T_WD5" --suite-timeout-ms 0
assert_eq "WD6 --suite-timeout-ms 0 exits 2" "$RS_RC" "2"
RS_RUN_LIMIT_TICKS=300
