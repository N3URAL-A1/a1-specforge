# Sourced by run-tests.sh (spec 027 slice 2, D13/FR-010). Not named run*.sh on purpose.
# check-timeout.cjs: timeout_ms === ceil(max(timings.seconds) * 1500). RED-proof: see STATUS-wave 9.
CT="$REPO_ROOT/_test-fixtures/a1-verify/check-timeout.cjs"
cttmp="$WORK/ct"; mkdir -p "$cttmp"
printf '{"timings":{"seconds":{"a/run.sh":316,"b/run.sh":12}}}\n' > "$cttmp/groups.json"
printf '{"timeout_ms":474000}\n' > "$cttmp/ok.json"
printf '{"timeout_ms":7200000}\n' > "$cttmp/mismatch.json"
printf '{"timings":{"seconds":{"a/run.sh":316,"b/run.sh":12,"c/run.sh":400}}}\n' > "$cttmp/groups-new.json"
node "$CT" "$cttmp/ok.json" "$cttmp/groups.json" >/dev/null 2>&1; RC=$?; OUT=""; ERR=""; check_rc "TO1 planted agreement (max 316 -> 474000): exit 0" 0
node "$CT" "$cttmp/mismatch.json" "$cttmp/groups.json" >/dev/null 2>&1; RC=$?; OUT=""; ERR=""; check_rc "TO2 planted mismatch (7200000): exit 1" 1
node "$CT" "$cttmp/ok.json" "$cttmp/groups-new.json" >/dev/null 2>&1; RC=$?; OUT=""; ERR=""; check_rc "TO3 a new slowest suite (400 s) with the old value: exit 1" 1
node "$CT" "$REPO_ROOT/.a1/verify.json" "$REPO_ROOT/_test-fixtures/suite-groups.json" >/dev/null 2>&1; RC=$?; OUT=""; ERR=""; check_rc "TO4 the real verify.json agrees with the real suite-groups.json: exit 0" 0
node "$CT" "$cttmp/nope.json" "$cttmp/groups.json" >/dev/null 2>&1; RC=$?; OUT=""; ERR=""; check_rc "TO5 unreadable file: exit 2" 2
