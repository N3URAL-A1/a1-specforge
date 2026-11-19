# Part 21 (spec 027 slice 3, review-fix round) — pins for the review findings that touch the runner itself.
# Sourced by run-tests.sh after 20-watchdog. Red-making change, one production-code line each:
#  RV1: rs_spawn_worker passes `$vl` unquoted again (SEC-4)
#  RV2: check-assert-deletions.sh without the repo-top-level cd (AD from a subdirectory)

# RV1: a TMPDIR that contains a space must not split the per-worker lock dir assignment into two words.
mk_tree T_RV rv
plant_suite "$T_RV" lk/run-tests.sh 'echo "$A1_VERIFY_LOCK_DIR" > "$RV_OUT"; echo "lk: 1 passed, 0 failed"'
mk_workdir W_RV rvw
mkdir -p "$W_RV/tmp dir"
( cd "$W_RV" && exec env -u A1_VERIFY_LOCK_TOKEN -u A1_SUITE_RUN_MARKER -u A1_VAULT_ROOT RV_OUT="$W_RV/lockdir.txt" A1_SUITE_LOCK_DIR="$W_RV/lock" \
  TMPDIR="$W_RV/tmp dir" bash "$RUNNER" --root "$T_RV" lk/run-tests.sh ) > "$W_RV/out.txt" 2>&1 < /dev/null &
rv_pid=$!; rv_ticks=0
while kill -0 "$rv_pid" 2>/dev/null; do sleep 0.2; rv_ticks=$((rv_ticks + 1)); if [[ $rv_ticks -ge 150 ]]; then kill -TERM "$rv_pid" 2>/dev/null; break; fi; done
wait "$rv_pid"; RV_RC=$?
assert_eq "RV1a TMPDIR with a space: the runner exits 0" "$RV_RC" "0"
RV_LD="$(cat "$W_RV/lockdir.txt" 2>/dev/null)"
assert_eq "RV1b the suite saw one lock dir path under the spaced TMPDIR" "$([[ "$RV_LD" == "$W_RV/tmp dir/"*/vlock ]] && echo yes || echo "no: [$RV_LD]")" "yes"
