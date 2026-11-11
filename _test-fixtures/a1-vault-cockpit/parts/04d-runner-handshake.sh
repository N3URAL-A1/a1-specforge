#!/usr/bin/env bash
# Part 04d — spec 026 FR-023: the I1 handshake with the fixture-suite runner.
# Sourced by run-tests.sh after 04c in the same shell, so caseI1 and I_PROC_LIB exist.
#
# Each case runs the REAL caseI1 in a subshell whose REPO_ROOT is a planted tree: two suites that
# each touch a probe file, and a committed _test-fixtures/a1-reconcile/ file that the first suite
# modifies (like the real a1-reconcile suite does). A nested suite run shows as a probe file; an I2
# restore shows as an "I2 ..." result line and the planted modification being undone.
# The "live runner" is a planted script named run-suites.sh that loops on short sleeps; it is started
# with `&`, identified by $! and killed by $! only.
#
# Red-making changes (all in 04c, each run once for real, see the wave report):
#   valid     — dropping the early `return 0` before the loop: probes appear
#   absent    — making the handshake skip when the marker is unset: probes stay missing
#   dead PID  — dropping the rs_lock_is_runner call from i_marker_run_id: I1 skips on a dead holder
#   mismatch  — dropping the `held == id` comparison: I1 skips on a foreign run id
#   unrelated — dropping the command-line half of the check (kill -0 only): I1 skips for a live sleep
#   decoy     — dropping the i_is_ancestor call (SEC-1): I1 skips for a live run-suites.sh-named process
#               that did not start it (the "valid" case instead runs I1 as a real child of a process whose
#               argv[0] is run-suites.sh, via `exec -a`, so only a true ancestor passes)

HS_RUN_ID="20260101-000000-4242"

# hs_plant — builds the planted tree in $HS_TREE (a git repo with a committed a1-reconcile file).
hs_plant() {
  local n
  mk_workdir HS_TREE h-tree
  mkdir -p "$HS_TREE/_test-fixtures/a1-reconcile"
  printf 'committed\n' > "$HS_TREE/_test-fixtures/a1-reconcile/fixture.txt"
  for n in one two; do
    mkdir -p "$HS_TREE/_test-fixtures/planted-$n"
    printf '#!/usr/bin/env bash\ntouch "$(dirname "$0")/probe"\n' > "$HS_TREE/_test-fixtures/planted-$n/run-tests.sh"
  done
  printf '#!/usr/bin/env bash\ntouch "$(dirname "$0")/probe"\nprintf "modified\\n" > "$(dirname "$0")/../a1-reconcile/fixture.txt"\n' \
    > "$HS_TREE/_test-fixtures/planted-one/run-tests.sh"
  git init -q "$HS_TREE" 2>/dev/null
  git -C "$HS_TREE" add -A >/dev/null 2>&1
  git -C "$HS_TREE" -c user.name=t -c user.email=t@example.invalid commit -q -m plant >/dev/null 2>&1
}

# hs_lock <dir> <pid> — a lock directory in the runner's format.
hs_lock() {
  mkdir -p "$1"
  printf '%s\n' "$HS_RUN_ID" > "$1/run_id"
  printf '%s\n' "$2" > "$1/pid"
}

# hs_under_runner <lockdir> — runs the real caseI1 as a CHILD of a process whose command line is
# run-suites.sh (exec -a); that process writes its own pid into the lock. Prints the result lines.
hs_under_runner() {
  local inner
  inner="$(declare -f caseI1 i_marker_run_id i_is_ancestor i_suites ok bad assert_eq assert_rc mk_workdir 2>/dev/null)
    REPO_ROOT='$HS_TREE'; I_PROC_LIB='$I_PROC_LIB'; I_OWN_SUITE='$I_OWN_SUITE'; I_RESTORE_REL='$I_RESTORE_REL'
    pass=0; fail=0; results=(); export A1_SUITE_RUN_MARKER='$1/run_id:$HS_RUN_ID'
    caseI1; printf '%s\n' \"\${results[@]}\""
  ( exec -a run-suites.sh bash -c 'printf "%s\n" "$$" > "$1/pid"; bash -c "$2"; rc=$?; exit $rc' holder "$1" "$inner" )
}

# hs_case <name> <marker-or-empty> <expect: skip|run> [lockdir: run I1 under a real runner-named parent]
hs_case() {
  local name="$1" marker="$2" expect="$3" via="${4:-}" out probes i2 content
  hs_plant
  if [[ -n "$via" ]]; then out="$(hs_under_runner "$via")"
  else
    out="$( REPO_ROOT="$HS_TREE"; results=()
      if [[ -n "$marker" ]]; then export A1_SUITE_RUN_MARKER="$marker"; else unset A1_SUITE_RUN_MARKER; fi
      caseI1; printf '%s\n' "${results[@]}" )"
  fi
  probes=""
  [[ -e "$HS_TREE/_test-fixtures/planted-one/probe" ]] && probes+="one "
  [[ -e "$HS_TREE/_test-fixtures/planted-two/probe" ]] && probes+="two "
  i2="$(printf '%s\n' "$out" | grep -c ' I2 ')"
  content="$(cat "$HS_TREE/_test-fixtures/a1-reconcile/fixture.txt")"
  if [[ "$expect" == skip ]]; then
    assert_eq "H $name: no nested suite ran (no probe file)" "$probes" ""
    assert_eq "H $name: no I2 line" "$i2" "0"
    assert_eq "H $name: planted a1-reconcile file untouched" "$content" "committed"
    assert_eq "H $name: one delegation ok line naming the run id" \
      "$(printf '%s\n' "$out" | grep -c "I1 run $HS_RUN_ID: leak check delegated to the runner")" "1"
  else
    assert_eq "H $name: planted suites ran (probe files)" "$probes" "one two "
    assert_eq "H $name: I2 restore branch ran (one I2 line)" "$i2" "1"
    assert_eq "H $name: I2 restored the planted a1-reconcile file" "$content" "committed"
    assert_eq "H $name: no delegation line" "$(printf '%s\n' "$out" | grep -c 'delegated to the runner')" "0"
  fi
}

caseHS1() {
  local hdir hpid dead unrelated lock
  mk_workdir hdir h-holder
  printf '#!/usr/bin/env bash\nwhile :; do sleep 0.2; done\n' > "$hdir/run-suites.sh"
  chmod 0755 "$hdir/run-suites.sh"
  "$hdir/run-suites.sh" &
  hpid=$!
  local t=0
  while [[ $t -lt 50 && "$(ps -o command= -p "$hpid" 2>/dev/null)" != *run-suites.sh* ]]; do sleep 0.1; t=$((t + 1)); done
  assert_eq "H setup: the planted holder shows run-suites.sh in its command line" \
    "$([[ "$(ps -o command= -p "$hpid" 2>/dev/null)" == *run-suites.sh* ]] && echo yes || echo no)" "yes"

  lock="$hdir/lock-valid"; hs_lock "$lock" "0"
  hs_case "valid marker, holder is an ancestor" "" skip "$lock"

  # SEC-1: a live process named run-suites.sh that is NOT an ancestor must not pass the handshake
  lock="$hdir/lock-decoy"; hs_lock "$lock" "$hpid"
  hs_case "live run-suites.sh-named decoy, not an ancestor" "$lock/run_id:$HS_RUN_ID" run

  hs_case "marker absent" "" run

  bash -c 'exit 0' & dead=$!; wait "$dead"
  assert_eq "H setup: the dead PID is gone" "$(kill -0 "$dead" 2>/dev/null && echo alive || echo gone)" "gone"
  lock="$hdir/lock-dead"; hs_lock "$lock" "$dead"
  hs_case "dead holder PID" "$lock/run_id:$HS_RUN_ID" run

  lock="$hdir/lock-mismatch"; hs_lock "$lock" "$hpid"
  hs_case "mismatched run id" "$lock/run_id:20260101-000000-9999" run

  sleep 60 & unrelated=$!
  lock="$hdir/lock-unrelated"; hs_lock "$lock" "$unrelated"
  hs_case "live PID that is not a runner" "$lock/run_id:$HS_RUN_ID" run
  kill "$unrelated" 2>/dev/null; wait "$unrelated" 2>/dev/null

  lock="$hdir/lock-missing"
  hs_case "marker names a missing file" "$lock/run_id:$HS_RUN_ID" run

  kill "$hpid" 2>/dev/null; wait "$hpid" 2>/dev/null
}
caseHS1
