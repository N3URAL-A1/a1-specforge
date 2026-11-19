# Part 17 (spec 027 slice 3, Task 3.1) — `--contract` and `--json-out`. Sourced by run-tests.sh (after 16-extra-jobs).
# The runner answers the handshake line and writes the D7 JSON (single writer: rs_write_json_out). The reader
# is readRunnerResult in _shared/lib/verify-runner-path.cjs; this part pins the writer side.
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  J1: the contract line text changed / J2: the leak note not passed to rs_record_result
#  J3: the existing-file check of rs_check_json_out removed

# jo_get <file> <js expression over j> — one value of the JSON file, printed as JSON.
jo_get() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(eval(process.argv[2])))' "$1" "$2" 2>&1; }
jo_runs() { ls "$RS_TMPD/a1-suite-runs-$(id -u)" 2>/dev/null | wc -l | tr -d ' '; }

mk_tree T_JO jo
plant_suite "$T_JO" ok/run-tests.sh 'echo "ok: 1 passed, 0 failed"'
plant_suite "$T_JO" red/run-tests.sh 'echo "red: 0 passed, 1 failed"; exit 3'
plant_suite "$T_JO" leak/run-tests.sh 'echo x > "$A1_VAULT_ROOT/leaked"; echo "leak: 1 passed, 0 failed"'
plant_suite "$T_JO" nosum/run-tests.sh 'exit 0'
mk_workdir W_JO jow

rs_run "$T_JO" --contract
assert_eq "J1a --contract prints exactly the handshake line" "$RS_OUT" "a1-suite-runner-contract 1"
assert_eq "J1b --contract exits 0" "$RS_RC" "0"
assert_eq "J1c --contract creates no log dir" "$(jo_runs)" "0"

JO="$W_JO/out.json"
rs_run "$T_JO" --json-out "$JO"
assert_eq "J2a the run with a red suite exits 1" "$RS_RC" "1"
assert_file_present "J2b the JSON file exists" "$JO"
assert_eq "J2c ok result" "$(jo_get "$JO" 'j.results.filter(r=>r.id==="ok/run-tests.sh").map(r=>[r.exit_code,r.signal,r.timed_out,r.leak_note,r.summary_note])[0]')" '[0,null,false,"",""]'
assert_eq "J2d red exit_code" "$(jo_get "$JO" 'j.results.find(r=>r.id==="red/run-tests.sh").exit_code')" "3"
assert_eq "J2e leak note" "$(jo_get "$JO" 'j.results.find(r=>r.id==="leak/run-tests.sh").leak_note')" '"wrote into its sentinel vault"'
assert_eq "J2f summary note" "$(jo_get "$JO" 'j.results.find(r=>r.id==="nosum/run-tests.sh").summary_note')" '"no assert summary"'
assert_eq "J2g contract, lock_wait_ms, result count" "$(jo_get "$JO" '[j.contract,j.lock_wait_ms,j.results.length]')" '[1,0,4]'
assert_eq "J2h file mode is 600" "$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$JO")" "600"
assert_eq "J2i no temp file is left behind" "$(ls "$W_JO" | grep -c 'tmp')" "0"

rs_run "$T_JO" --json-out "$JO"
assert_eq "J3a an existing --json-out exits 2" "$RS_RC" "2"
assert_eq "J3b no suite started (no log dir)" "$(jo_runs)" "0"
assert_eq "J3c the file is unchanged" "$(jo_get "$JO" 'j.results.length')" "4"

rs_run "$T_JO" --json-out relative.json
assert_eq "J4 a relative --json-out exits 2" "$RS_RC" "2"

ln -s "$W_JO/nowhere" "$W_JO/link.json"
rs_run "$T_JO" --json-out "$W_JO/link.json"
assert_eq "J5 a symlink at the --json-out path exits 2" "$RS_RC" "2"

# J6: a tree without .git skips the learnings/phases checks; a git tree passes them.
assert_eq "J6a no .git: checks skipped" "$(jo_get "$JO" '[j.checks.learnings,j.checks.phases]')" '["skipped_nogit","skipped_nogit"]'
mk_tree T_JG jg
plant_ok "$T_JG" a/run-tests.sh
git -C "$T_JG" init -q && git -C "$T_JG" add -A && git -C "$T_JG" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm planted
rs_run "$T_JG" --json-out "$W_JO/git.json"
assert_eq "J6b git tree: run exits 0" "$RS_RC" "0"
assert_eq "J6c git tree: learnings and phases ok, reconcile not selected" "$(jo_get "$W_JO/git.json" '[j.checks.learnings,j.checks.phases,j.checks.reconcile]')" '["ok","ok","not_selected"]'

# J7: two selectors give subset true and exactly those ids.
rs_run "$T_JO" ok/run-tests.sh red/run-tests.sh --json-out "$W_JO/sub.json"
assert_eq "J7 subset true and the two ids" "$(jo_get "$W_JO/sub.json" '[j.subset,j.results.map(r=>r.id).sort()]')" '[true,["ok/run-tests.sh","red/run-tests.sh"]]'

# J8: a SIGKILLed suite has no exit code and a signal name.
plant_suite "$T_JO" kill/run-tests.sh 'kill -KILL $$'
rs_run "$T_JO" kill/run-tests.sh --json-out "$W_JO/kill.json"
assert_eq "J8 killed suite: exit_code null, signal SIGKILL" "$(jo_get "$W_JO/kill.json" '[j.results[0].exit_code,j.results[0].signal]')" '[null,"SIGKILL"]'

# J9 (review fix, Reinhard 1 / SEC-3): an exit code above 128 is a signal only when kill -l names it plainly.
# 255 has no name (the old code wrote "SIG" and the reader rejected the file); 130 stays SIGINT (a shell cannot tell it from a real kill).
plant_suite "$T_JO" e255/run-tests.sh 'echo "e: 0 passed, 1 failed"; exit 255'
rs_run "$T_JO" e255/run-tests.sh --json-out "$W_JO/e255.json"
assert_eq "J9a exit 255: plain exit_code, no signal" "$(jo_get "$W_JO/e255.json" '[j.results[0].exit_code,j.results[0].signal]')" '[255,null]'
plant_suite "$T_JO" e130/run-tests.sh 'echo "e: 0 passed, 1 failed"; exit 130'
rs_run "$T_JO" e130/run-tests.sh --json-out "$W_JO/e130.json"
assert_eq "J9b exit 130: SIGINT, no exit code" "$(jo_get "$W_JO/e130.json" '[j.results[0].exit_code,j.results[0].signal]')" '[null,"SIGINT"]'
