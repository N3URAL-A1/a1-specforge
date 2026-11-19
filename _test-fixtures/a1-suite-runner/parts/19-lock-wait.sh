# Part 19 (spec 027 slice 3, Task 4.1) — --lock-wait. Sourced by run-tests.sh (after 18-groups-file).
# A fake live runner (D21 c) holds a planted lock; the runner under test waits, gives up at the ceiling, or
# refuses at once without the option.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  W1: the wait branch skipped (fail fast) · W3: the deadline never reached (no expiry)

# lw_holder <lockdir> <seconds> [release] — sets LW_PID. A bash whose command line keeps `run-suites.sh`
# (D21 c); polled until `ps` shows that name (D21 b), only then is the lock planted. With "release" a
# helper subshell removes the lock after <seconds> s and sends TERM to the holder's own PID.
lw_holder() {
  bash -c 'trap "kill \$c 2>/dev/null; exit 0" TERM; sleep '"$2"' & c=$!; wait' run-suites.sh &
  LW_PID=$!
  local n=0
  while [[ $n -lt 40 ]]; do
    case "$(ps -o command= -p "$LW_PID" 2>/dev/null)" in *run-suites.sh*) break ;; esac
    sleep 0.05; n=$((n + 1))
  done
  if [[ $n -ge 40 ]]; then bad "lw_holder shows the runner name" "holder $LW_PID never showed run-suites.sh"; return 1; fi
  lk_plant_lock "$1" "$LW_PID"
  if [[ "${3:-}" == release ]]; then
    ( sleep "$2"; rm -rf "$1"; kill -TERM "$LW_PID" 2>/dev/null ) >/dev/null 2>&1 &
    LW_REL=$!
  fi
}
lw_end() { kill -TERM "$LW_PID" 2>/dev/null; wait "$LW_PID" 2>/dev/null; [[ -z "${LW_REL:-}" ]] || { wait "$LW_REL" 2>/dev/null; LW_REL=""; }; return 0; }
lw_now() { node -e 'process.stdout.write(String(Date.now()))'; }

# ---- W1: holder for 3 s, then released: the runner waits and runs ----
mk_tree T_LW lw
mk_workdir W_LW lww
plant_suite "$T_LW" w/run-tests.sh "echo ran >> \"$W_LW/ran\"; echo 'w: 1 passed, 0 failed'"
lw_holder "$W_LW/lock1" 3 release
lk_start "$T_LW" "$W_LW/lock1" "$W_LW/tmp1" "$W_LW/out1.txt" --lock-wait 10000 --json-out "$W_LW/r1.json"
lk_finish "$LK_PID"
assert_eq "W1a waiting run exits 0" "$LK_RC" "0"
assert_contains "W1b a waiting line is printed" "$(cat "$W_LW/out1.txt")" "lock: waiting up to 10000 ms for holder PID $LW_PID"
assert_eq "W1c the suite ran" "$(grep -c '' "$W_LW/ran" 2>/dev/null)" "1"
assert_eq "W1d lock_wait_ms is at least 1000" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.lock_wait_ms>=1000?"yes":"no:"+j.lock_wait_ms)' "$W_LW/r1.json" 2>&1)" "yes"
lw_end

# ---- W2: no --lock-wait: refused at once with the existing message (control) ----
lw_holder "$W_LW/lock2" 30
rm -f "$W_LW/ran"
lk_start "$T_LW" "$W_LW/lock2" "$W_LW/tmp2" "$W_LW/out2.txt"
lk_finish "$LK_PID"
assert_eq "W2a refused with exit 2" "$LK_RC" "2"
assert_contains "W2b the existing refusal message" "$(cat "$W_LW/out2.txt")" "another run holds the lock"
assert_absent "W2c no waiting line" "$(cat "$W_LW/out2.txt")" "lock: waiting"
assert_file_absent "W2d no suite started" "$W_LW/ran"
lw_end

# ---- W3: holder 30 s, --lock-wait 1000: gives up after the ceiling ----
lw_holder "$W_LW/lock3" 30
LW_T0="$(lw_now)"
lk_start "$T_LW" "$W_LW/lock3" "$W_LW/tmp3" "$W_LW/out3.txt" --lock-wait 1000
lk_finish "$LK_PID"
LW_EL=$(( $(lw_now) - LW_T0 ))
assert_eq "W3a exit 2" "$LK_RC" "2"
assert_contains "W3b the ceiling message" "$(cat "$W_LW/out3.txt")" "lock wait of 1000 ms exceeded"
if [[ $LW_EL -ge 1000 ]]; then ok "W3c waited at least 1000 ms (${LW_EL} ms)"; else bad "W3c waited at least 1000 ms" "elapsed ${LW_EL} ms"; fi
assert_eq "W3d no log directory" "$(find "$W_LW/tmp3" -maxdepth 1 -name 'a1-suite-runs*' | grep -c '')" "0"
assert_file_absent "W3e no suite started" "$W_LW/ran"
lw_end

# ---- W4: invalid values exit 2 ----
for LW_V in -1 abc 3600001; do
  rs_run "$T_LW" --lock-wait "$LW_V"
  assert_eq "W4 --lock-wait $LW_V exits 2" "$RS_RC" "2"
done
