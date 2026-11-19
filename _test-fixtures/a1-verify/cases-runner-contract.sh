# Sourced by run-tests.sh (spec 027 slice 3 wave 6: runner-path module). Uses the suite helpers: ok, bad. Unit level only; the cases run in
# check-runner-contract.cjs (node) against planted repos and planted JSON files under $WORK.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (scratch copy of verify-runner-path.cjs, see STATUS.md wave 6):
#   (a) requested-vs-returned set comparison removed          : RC5b, RC5c, RC10g red
#   (b) lstat symlink check removed (statSync instead)        : RC5k red
#   (c) runner-exit-1 consistency rule removed                : RC6a red
#   (d) contract line compare loosened to startsWith          : RC4b red
#   (e) cap removed from runnerCeilingMs                      : RC9b red
RCW="$WORK/rc-contract"; mkdir -p "$RCW"
RC_OUT="$(A1_VERIFY_LOCK_DIR="$RCW/lock" A1_VERIFY_LOCK_WAIT_MS=1000 node "$REPO_ROOT/_test-fixtures/a1-verify/check-runner-contract.cjs" "$REPO_ROOT" "$RCW" 2>"$RCW/err")"; RC_RC=$?
if [[ $RC_RC -ne 0 || -z "$RC_OUT" ]]; then bad "RC driver ran (rc=$RC_RC, err=$(head -c 400 "$RCW/err"))"; fi
while IFS=$'\t' read -r rc_id rc_state rc_detail; do
  [[ -z "$rc_id" ]] && continue
  if [[ "$rc_state" == PASS ]]; then ok "$rc_id"; else bad "$rc_id ${rc_detail}"; fi
done <<< "$RC_OUT"
