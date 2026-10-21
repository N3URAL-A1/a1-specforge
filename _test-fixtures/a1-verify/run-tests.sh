#!/usr/bin/env bash
# Fixture: `a1-tools verify run` / `verify check` (spec 017-enforced-self-checks, Wave 3, FR-011..FR-014, FR-018).
#
# Inputs: corpus/vitest-3-40-2.json and corpus/pytest-3-40-2.xml are REAL reporter
# outputs (vitest 4.1.5, pytest 8.4.2; 40 passed, 3 failed, 2 skipped; paths and host
# name scrubbed). The jest case reuses the vitest file (vitest's JSON reporter is
# jest-shaped; jest itself is not installed here). node:test output is produced by
# a real `node --test` run. Runner binaries are bash stubs named like the runner that
# copy the real report to the --outputFile / --junitxml path the tool injected.
# Planted defects are string edits of those real copies.
#
# Measured red 2026-10-21 (git-archive snapshot, one production line reverted, suite run):
#   verify-run.cjs commandReason(): crash branch `failed === 0 || (signal && failed null)` -> false : C2, D1, D2, M0, M1b
#   verify-run.cjs commandReason(): `r.timed_out` line removed                            : C3
#   verify-run.cjs commandReason(): `reported_failures` line removed                      : C4
#   verify-run.cjs commandReason(): zero_tests line removed                               : D3, D3b (hostile name)
#   verify-run.cjs isSourcePath(): docs/.md exclusion removed                             : D4
#   verify-run.cjs resolveCommands(): no_tests_reason branch removed                      : A4b
#   verify-run.cjs resolveCommands(): no_test_command throw removed                       : A4
#   verify-run.cjs runVerify(): requires_env check removed                                : A7
#   verify-run.cjs expandEach(): `..` guard removed                                       : A6b
#   verify-reporters.cjs parseJunit(): errors not added to failed                         : B3b (error count)
#   verify-reporters.cjs injectFlags(): jest `--json` flag removed                        : B2
#   verify-reporters.cjs parseTap(): skipped sum removed                                  : B4
#   verify-check.cjs checkVerification(): verify_run_missing branch removed               : E1
#   verify-check.cjs checkVerification(): `p !== self` exclusion removed                  : E5
#   verify-check.cjs checkVerification(): A1_PREFIX exclusion removed                     : E3c
#   verify-check.cjs checkVerification(): code_changed_after_run branch removed           : E4
#   verify-check.cjs checkVerification(): head_sha_unknown branch removed                 : E2
#
# Wave 6 (spec 017 FR-015, FR-016, FR-039), measured red 2026-10-21 the same way:
#   verify-base.cjs settle(): base-subset rule (`fresh.length === 0 && baseIds !== null`) removed : F2, M3b
#   verify-base.cjs settle(): unlisted-flaky test (`!flakyBase.includes(i)`) disabled              : G1, G3, G4
#   verify-base.cjs settle(): retry disabled (`retried = false`)                                   : G1, G1b, G2, G3, G4, G4b, G5b
#   verify-run.cjs runBaseSide(): `c.file && !existsSync` (absent-on-base) removed                 : F6
#   verify-run.cjs groupRunnerMain(): `process.kill(-child.pid)` -> `process.kill(child.pid)`      : P1c (grandchild survives)
#   verify-base.cjs readCache(): always a miss                                                     : K2, K2b, K3, K3b, K4b, K4c, K5
#   verify-base.cjs dirtyPaths(): gate-log/cache exclusion removed                                 : K5, K8
#   verify-run.cjs runHeadSide(): dirty-tree check removed                                         : K4, K4b
#   verify-base.cjs commandHash(): timeout left out of the hash                                    : K6
#   verify-base.cjs withSnapshot(): rmSync removed                                                 : F5c
#   verify-base.cjs resolveMergeBase(): merge-base failure check removed                           : S2
#   verify-base.cjs flakyBaseGrown(): `!had.has(i)` -> false                                       : G6, G6e
#
# Wave 8 (spec 017 FR-017, FR-025), measured red 2026-10-21 the same way:
#   verify-base.cjs applySkipIncrease(): equal counts judged (`<=` -> `<`)                       : S5 (also F2, M3b)
#   verify-base.cjs applySkipIncrease(): disposition ignored                                     : S2
#   verify-base.cjs applySkipIncrease(): any disposition of the command covers any increase     : S3
#   verify-base.cjs applySkipIncrease(): any skip_increase disposition covers it (no id/counts)   : S3, S4
#   verify-run.cjs runVerify(): skip rule not applied                                            : S1, S2, S3, S4, S6, S8, S9
#   verify-run.cjs skipIncreaseDispositions(): unreadable store swallowed                        : S8
#   disposition-store.cjs clearedFingerprints(): overturned entries clear                        : S6
unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${A1_FX_TOOLS:-$REPO_ROOT/_shared/a1-tools.cjs}"
CORPUS="$REPO_ROOT/_test-fixtures/a1-verify/corpus"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/a1-fx-verify.XXXXXX")" || exit 1
[[ -n "$WORK" && -d "$WORK" ]] || exit 1
trap 'rm -rf "${WORK:?}"' EXIT

export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
export A1_FX_CORPUS="$CORPUS"

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

g() { local d="$1"; shift; git -C "$d" -c commit.gpgsign=false -c user.name=t -c user.email=t@t "$@"; }

# vrun <proj> [args...] -> OUT (stdout), ERR, RC. cwd = project; --phase keeps stderr clean (Q15).
vrun() {
  local p="$1"; shift
  OUT="$(cd "$p" && node "$TOOLS" verify run --project "$p" --phase fx "$@" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}
vcheck() { OUT="$(node "$TOOLS" verify check "$@" 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"; }

js() { # expression over j; "stmt; expr" form returns the last expression
  node -e '
    const j=JSON.parse(process.argv[1]); const e=process.argv[2]; const i=e.lastIndexOf("; ");
    const body = i < 0 ? "return (" + e + ")" : e.slice(0, i + 1) + " return (" + e.slice(i + 2) + ")";
    process.stdout.write(String(new Function("j", body)(j)));' "$OUT" "$1" 2>&1; }
check() { # check <label> <want-rc> <js expr over j> <want>
  local got; got="$(js "$3")"
  if [[ "$RC" -eq "$2" && "$got" == "$4" ]]; then ok "$1"; else bad "$1 (rc=$RC want=$2; got=$got want=$4; err=$ERR)"; fi
}
check_rc() { if [[ "$RC" -eq "$2" ]]; then ok "$1"; else bad "$1 (rc=$RC want=$2; out=$OUT err=$ERR)"; fi; }

# newproj <label> -> $P: git repo on main with one source file and a README (not yet committed)
newproj() {
  P="$WORK/$1"; rm -rf "${P:?}"; mkdir -p "$P/src" "$P/bin" "$P/.a1"
  git -C "$P" init -q -b main
  printf 'module.exports = 1;\n' > "$P/src/app.js"; printf '# demo\n' > "$P/README.md"
}
# seal: commit the set-up on main, continue on branch feat
seal() { g "$P" add -A; g "$P" commit -q -m base; g "$P" checkout -q -b feat; }
cfg() { printf '%s\n' "$1" > "$P/.a1/verify.json"; }
stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$P/bin/$1"; chmod +x "$P/bin/$1"; }

REPORT_STUB='out=""; for a in "$@"; do case "$a" in --outputFile=*) out="${a#--outputFile=}";; --junitxml=*) out="${a#--junitxml=}";; esac; done
printf "%s\n" "$@" > "${A1_FX_ARGS:?}"
sed "s#/work/proj#$(pwd -P)#g" "${A1_FX_REPORT:?}" > "$out"
exit "${A1_FX_RC:-1}"'

# zero-test report: planted edit of the real vitest file (no tests, success)
node -e '
  const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  j.numTotalTests=0; j.numPassedTests=0; j.numFailedTests=0; j.numPendingTests=0; j.testResults=[]; j.success=true; j.numTotalTestSuites=0; j.numFailedTestSuites=0;
  fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$CORPUS/vitest-3-40-2.json" "$WORK/zero.json"
# junit with two errors: planted edit of the real pytest file
node -e '
  const fs=require("fs"); let s=fs.readFileSync(process.argv[1],"utf8");
  s=s.replace(/errors="0" failures="3"/, "errors=\"2\" failures=\"3\"");
  fs.writeFileSync(process.argv[2], s);' "$CORPUS/pytest-3-40-2.xml" "$WORK/pytest-err.xml"
# junit with zero tests (pytest exit 5)
printf '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="0" time="0.01"></testsuite></testsuites>' > "$WORK/pytest-zero.xml"

# ---------- A: command resolution (FR-011) ----------
newproj a1; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; seal
vrun "$P"
check "A1 .a1/verify.json command: exit 0, source verify.json, 1 command, pass" 0 'j.source+"/"+j.commands.length+"/"+j.verdict+"/"+j.commands[0].id' "verify.json/1/pass/unit"
check "A1b record shape: exit_code 0, signal null, timed_out false, counts null (no reporter)" 0 \
  'const c=j.commands[0]; [c.exit_code,c.signal,c.timed_out,c.passed,c.failed,c.skipped].join(",")' "0,,false,,,"
[[ -z "$(g "$P" status --porcelain)" ]] && ok "A1c verify run leaves git status --porcelain empty (gate log excluded)" || bad "A1c dirty tree after verify run"
[[ "$(wc -l < "$P/.a1/phases/fx/gate-log.jsonl" 2>/dev/null | tr -d ' ')" == "1" ]] && ok "A1d one gate-log line written by the facade hook" || bad "A1d gate-log line count"

newproj a2; printf '%s' '{"name":"x","scripts":{"typecheck":"node -e 0","build":"echo \"Error: no test specified\" && exit 1","test":"node -e 0"}}' > "$P/package.json"; seal
vrun "$P"
check "A2 package.json: typecheck + test run (placeholder-free), build skipped; ids counted" 0 'j.source+"|"+j.commands.map(c=>c.id).join(",")+"|"+j.commands.length' "package.json|npm run typecheck,npm run test|2"

newproj a3; printf '[tool.pytest.ini_options]\n' > "$P/pyproject.toml"; seal
OUT="$(node -e 'const r=require(process.argv[1]); const p=r.resolveCommands(process.argv[2]); process.stdout.write(JSON.stringify({s:p.source,a:p.commands[0].argv,k:p.commands[0].kind}))' "$REPO_ROOT/_shared/lib/verify-run.cjs" "$P" 2>"$WORK/err")"; RC=$?
check "A3 pytest config resolves to python3 -m pytest (kind pytest)" 0 'j.s+"|"+j.a.join(" ")+"|"+j.k' "pytest|python3 -m pytest -q|pytest"

newproj a4; seal
vrun "$P"
check "A4 nothing resolvable: exit 2 no_test_command" 2 'j.error' "no_test_command"
cfg '{"no_tests_reason":"docs-only repository"}'
vrun "$P"
check "A4b no_tests_reason declared: exit 0, pass, 0 commands, reason recorded" 0 'j.verdict+"/"+j.commands.length+"/"+j.no_tests_reason' "pass/0/docs-only repository"

newproj a5; stub ok 'exit 0'; cfg '{"commands":[{"argv":["./bin/ok"]}]}'; printf '{"scripts":{"test":"exit 1"}}' > "$P/package.json"; seal
vrun "$P"
check "A5 verify.json wins over package.json (order)" 0 'j.source+"/"+j.commands.length' "verify.json/1"

newproj a6; mkdir -p "$P/suites/a b" "$P/suites/c"; printf 'exit 0\n' > "$P/suites/a b/run x.sh"; printf 'exit 0\n' > "$P/suites/c/run-1.sh"; printf 'exit 0\n' > "$P/suites/c/other.sh"
cfg '{"each":"suites/*/run*.sh","argv_prefix":["bash"]}'; seal
vrun "$P"
check "A6 each glob expands in node: 2 suites incl. a name with a space; ids are the paths" 0 'j.commands.map(c=>c.id).join("|")+"/"+j.commands.length' "suites/a b/run x.sh|suites/c/run-1.sh/2"
cfg '{"each":"suites/../*/run*.sh","argv_prefix":["bash"]}'
vrun "$P"
check "A6b each pattern with .. : exit 2 bad_config" 2 'j.error' "bad_config"

newproj a7; stub ok 'exit 0'; cfg '{"requires_env":["A1_FX_NOPE_DB"],"commands":[{"argv":["./bin/ok"]}]}'; seal
vrun "$P"
check "A7 required env var absent: exit 2 env_missing (never recorded as pass)" 2 'j.error' "env_missing"
A1_FX_NOPE_DB=x vrun "$P"
check "A7b env var present: exit 0" 0 'j.verdict' "pass"

# ---------- B: reporters and record (FR-012) ----------
reporter_case() { # reporter_case <label> <runner name> <report file> <argv-json> <expect-flag>
  newproj "$1"; stub "$2" "$REPORT_STUB"; cfg "{\"commands\":[{\"id\":\"t\",\"argv\":$4}]}"; seal
  export A1_FX_ARGS="$WORK/args-$1" A1_FX_REPORT="$3" A1_FX_RC="${6:-1}"
  vrun "$P"
}
reporter_case b1 vitest "$CORPUS/vitest-3-40-2.json" '["./bin/vitest","run"]'
check "B1 vitest JSON: exit 1, passed 40 failed 3 skipped 2, verdict fail command_failed" 1 \
  'const c=j.commands[0]; [c.exit_code,c.passed,c.failed,c.skipped,j.verdict,c.reason].join(",")' "1,40,3,2,fail,command_failed"
check "B1b three failing test ids, relative file names" 1 'j.commands[0].failed_ids.length+"|"+j.commands[0].failed_ids[0]' "3|a.test.mjs > fail 0"
grep -q -- '--reporter=json' "$A1_FX_ARGS" && grep -q -- '--outputFile=' "$A1_FX_ARGS" && ok "B1c vitest got --reporter=json and --outputFile injected" || bad "B1c vitest flags"
reporter_case b2 jest "$CORPUS/vitest-3-40-2.json" '["./bin/jest"]'
check "B2 jest JSON: same counts, jest --json flag injected" 1 'const c=j.commands[0]; [c.passed,c.failed,c.skipped].join(",")' "40,3,2"
grep -q -- '^--json$' "$A1_FX_ARGS" && ok "B2b jest got --json" || bad "B2b jest flag"
reporter_case b3 pytest "$CORPUS/pytest-3-40-2.xml" '["./bin/pytest"]'
check "B3 pytest junit: passed 40 failed 3 skipped 2, ids test_a::test_fail[0..2]" 1 \
  'const c=j.commands[0]; [c.passed,c.failed,c.skipped,c.failed_ids.join(";")].join("|")' "40|3|2|test_a::test_fail[0];test_a::test_fail[1];test_a::test_fail[2]"
reporter_case b3e pytest "$WORK/pytest-err.xml" '["./bin/pytest"]'
check "B3b junit errors count as failed (3 failures + 2 errors = 5), passed 38" 1 'const c=j.commands[0]; [c.passed,c.failed,c.skipped].join(",")' "38,5,2"

newproj b4; cat > "$P/t.test.js" <<'JS'
const { test } = require('node:test'); const assert = require('node:assert');
for (let i = 0; i < 40; i++) test('pass ' + i, () => {});
for (let i = 0; i < 3; i++) test('fail ' + i, () => { assert.fail('x'); });
for (let i = 0; i < 2; i++) test('skip ' + i, { skip: true }, () => {});
JS
cfg '{"commands":[{"id":"tap","argv":["node","--test","t.test.js"]}]}'; seal
vrun "$P"
check "B4 node:test via TAP (real run): 40/3/2, exit 1, fail" 1 'const c=j.commands[0]; [c.passed,c.failed,c.skipped,c.exit_code,j.verdict].join(",")' "40,3,2,1,fail"

newproj b5; stub plain 'echo "12 passed, 0 failed"; exit 0'; cfg '{"commands":[{"id":"plain","argv":["./bin/plain"]}]}'; seal
vrun "$P"
check "B5 runner without parsable reporter: null counts, verdict from exit code (pass)" 0 'const c=j.commands[0]; [c.passed,c.failed,c.skipped,j.verdict].join(",")' ",,,pass"

newproj b6; stub ok 'exit 0'; cfg '{"commands":[{"argv":["./bin/ok"]}]}'; seal
printf -- '---\nverdict: PASS\npassed: 13\n---\n\n# Verification: demo\n\nbody text\n' > "$WORK/VER.md"
cp "$WORK/VER.md" "$P/VER.md"
vrun "$P" --out "$P/VER.md"
check_rc "B6 --out: exit 0" 0
RUN_FM="$(node -e '
  const {parseFrontmatter}=require(process.argv[1]); const {fm,body}=parseFrontmatter(require("fs").readFileSync(process.argv[2],"utf8"));
  const v=JSON.parse(fm.verify_run); process.stdout.write([fm.verdict,fm.passed,v.verdict,v.head_sha.length,v.base_sha.length,v.commands.length,body.includes("body text")].join(","))' \
  "$REPO_ROOT/_shared/lib/io-frontmatter.cjs" "$P/VER.md")"
[[ "$RUN_FM" == "PASS,13,pass,40,40,1,true" ]] && ok "B6b VERIFICATION.md frontmatter: verify_run with head/base sha and 1 command; other keys and body kept" || bad "B6b ($RUN_FM)"

newproj b7; stub big 'head -c 50000000 /dev/zero | tr "\0" "x"; exit 0'; cfg '{"commands":[{"argv":["./bin/big"]}]}'; seal
vrun "$P"
check "B7 50 MB of output: exit 0, stdout record stays small (cap holds, no raw output stored)" 0 'j.verdict+"/"+(JSON.stringify(j).length<5000)' "pass/true"

# ---------- C: exit / signal / timeout (FR-013) ----------
newproj c1; stub bad 'exit 3'; cfg '{"commands":[{"argv":["./bin/bad"]}]}'; seal
vrun "$P"
check "C1 non-zero exit, no counts: exit 1, fail command_failed, id listed as failed" 1 'j.verdict+"/"+j.reason+"/"+j.commands[0].failed_ids.join()' "fail/command_failed/./bin/bad"
newproj c2; stub killed 'kill -KILL $$'; cfg '{"commands":[{"argv":["./bin/killed"]}]}'; seal
vrun "$P"
check "C2 killed by signal, no failures printed: exit 1, signal SIGKILL, implausible_crash" 1 'j.commands[0].signal+"/"+j.reason+"/"+j.commands[0].exit_code' "SIGKILL/implausible_crash/null"
newproj c3; stub slow 'exec sleep 30'; cfg '{"commands":[{"argv":["./bin/slow"]}]}'; seal
T0=$(date +%s); vrun "$P" --timeout-ms 400; T1=$(date +%s)
check "C3 timeout: exit 1, timed_out true, reason timeout" 1 'j.commands[0].timed_out+"/"+j.reason' "true/timeout"
[[ $((T1 - T0)) -lt 15 ]] && ok "C3b run returned long before the 30 s sleep ended" || bad "C3b took $((T1 - T0)) s"
reporter_case c4 vitest "$CORPUS/vitest-3-40-2.json" '["./bin/vitest"]' x 0
check "C4 exit 0 but the report lists 3 failures: still fail (reported_failures)" 1 'j.verdict+"/"+j.reason' "fail/reported_failures"
newproj c5; cfg '{"commands":[{"argv":["./bin/does-not-exist"]}]}'; seal
vrun "$P"
check "C5 runner binary missing: exit 1 spawn_failed" 1 'j.reason' "spawn_failed"

# ---------- D: implausible crash and zero tests (FR-014, SC-003) ----------
newproj d1; stub tsc 'kill -KILL $$'; cfg '{"commands":[{"id":"typecheck","argv":["./bin/tsc"]}]}'; seal
cp "$WORK/VER.md" "$P/.a1/VERIFICATION.md"
vrun "$P" --out "$P/.a1/VERIFICATION.md"
check "D1 SC-003 typecheck killed with zero parsed failures: fail implausible_crash" 1 'j.verdict+"/"+j.reason' "fail/implausible_crash"
vcheck "$P/.a1/VERIFICATION.md"
check "D1b verify check on the file claiming PASS below that run: exit 1 verify_run_not_pass" 1 'j.reasons.join()' "verify_run_not_pass"
reporter_case d2 pytest "$WORK/pytest-zero.xml" '["./bin/pytest"]' x 5
check "D2 pytest exit 5, junit holds 0 failures: implausible_crash (failed == 0 with non-zero exit)" 1 'j.reason+"/"+j.commands[0].failed' "implausible_crash/0"

reporter_case d3 vitest "$WORK/zero.json" '["./bin/vitest"]' x 0
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "touch source"
vrun "$P"
check "D3 zero tests executed on a diff touching src/app.js: fail zero_tests" 1 'j.reason+"/"+j.touches_source' "zero_tests/true"
newproj d3b; stub vitest "$REPORT_STUB"; cfg '{"commands":[{"argv":["./bin/vitest"]}]}'; seal
printf 'x\n' > "$P/src/new file
name.js"
A1_FX_ARGS="$WORK/args-d3b" A1_FX_REPORT="$WORK/zero.json" A1_FX_RC=0 vrun "$P"
check "D3b hostile: untracked source file with a space and a newline in its name still counts (NUL-separated git output)" 1 'j.reason+"/"+j.changed_files' "zero_tests/1"
reporter_case d4 vitest "$WORK/zero.json" '["./bin/vitest"]' x 0
printf '# demo 2\n' > "$P/README.md"; mkdir -p "$P/docs"; printf 'x\n' > "$P/docs/a.txt"; g "$P" add -A; g "$P" commit -q -m docs
vrun "$P"
check "D4 docs-only diff (README.md, docs/a.txt) with zero tests: pass, touches_source false" 0 'j.verdict+"/"+j.touches_source+"/"+j.changed_files' "pass/false/2"
reporter_case d5 vitest "$WORK/zero.json" '["./bin/vitest"]' x 0
vrun "$P"
check "D5 empty diff with zero tests: pass" 0 'j.verdict+"/"+j.changed_files' "pass/0"

# ---------- E: verify check (FR-018) ----------
newproj e; stub ok 'exit 0'; cfg '{"commands":[{"argv":["./bin/ok"]}]}'; seal
printf -- '---\nverdict: PASS\n---\n\nhand written\n' > "$P/.a1/VERIFICATION.md"
vcheck "$P/.a1/VERIFICATION.md"
check "E1 hand-edited PASS without verify_run: exit 1 verify_run_missing" 1 'j.reasons.join()' "verify_run_missing"
printf -- '---\nverdict: PASS\nverify_run: {"verdict":"pass","head_sha":"%s","commands":[]}\n---\n' "$(printf 'a%.0s' $(seq 1 40))" > "$P/.a1/VERIFICATION.md"
vcheck "$P/.a1/VERIFICATION.md"
check "E2 hand-edited verify_run with a head_sha git does not know: exit 1 head_sha_unknown" 1 'j.reasons.join()' "head_sha_unknown"
printf -- '---\nverdict: PASS\n---\n' > "$P/.a1/VERIFICATION.md"
vrun "$P" --out "$P/.a1/VERIFICATION.md"
vcheck "$P/.a1/VERIFICATION.md"
check "E3 fresh run, nothing committed since: exit 0" 0 'j.ok' "true"
g "$P" add -A; g "$P" commit -q -m "verification"
vcheck "$P/.a1/VERIFICATION.md"
check "E3b committing VERIFICATION.md alone (a .a1/ path): exit 0" 0 'j.ok' "true"
mkdir -p "$P/.a1/phases/x"; printf 'status\n' > "$P/.a1/phases/x/STATUS.md"; g "$P" add -A; g "$P" commit -q -m "status note"
vcheck "$P/.a1/VERIFICATION.md"
check "E3c another .a1/ file changed after the run: exit 0 (bookkeeping is not code)" 0 'j.ok' "true"
printf 'module.exports = 3;\n' > "$P/src/app.js"; g "$P" commit -q -am "late code change"
vcheck "$P/.a1/VERIFICATION.md"
check "E4 code changed after the run: exit 1 code_changed_after_run, 1 path" 1 'j.reasons.join()+"/"+j.changed_after_run' "code_changed_after_run/1"

newproj e5; stub ok 'exit 0'; cfg '{"commands":[{"argv":["./bin/ok"]}]}'; seal
printf -- '---\nverdict: PASS\n---\n' > "$P/VERIFICATION.md"
vrun "$P" --out "$P/VERIFICATION.md"
g "$P" add -A; g "$P" commit -q -m "verification at the root"
vcheck "$P/VERIFICATION.md"
check "E5 VERIFICATION.md outside .a1/ committed alone: exit 0 (file itself excluded)" 0 'j.ok' "true"
printf -- '---\nverdict: FAIL\n---\n' > "$WORK/fail.md"
vcheck "$WORK/fail.md"
check "E6 file not claiming PASS: exit 0 (nothing to refuse)" 0 'j.ok' "true"

# ---------- H: usage and hostile input ----------
vcheck; check_rc "H1 verify check without a file: exit 2" 2
vcheck "$WORK/does-not-exist.md"; check_rc "H2 verify check on a missing file: exit 2" 2
vrun "$P" --base --evil; check_rc "H3 --base value starting with a dash: exit 2 (base_unresolved)" 2
vrun "$P" --nope; check_rc "H4 unknown flag: exit 2" 2
OUT="$(cd "$P" && node "$TOOLS" verify run --project "$WORK/missing-dir" --phase fx 2>/dev/null)"; RC=$?; check_rc "H5 --project not found: exit 2" 2
newproj h6; printf '{"commands":[{"argv":"bash -c true"}]}' > "$P/.a1/verify.json"; seal
vrun "$P"
check "H6 argv as a string (shell form) is refused: exit 2 bad_config" 2 'j.error' "bad_config"
newproj h7; printf '{not json' > "$P/.a1/verify.json"; seal
vrun "$P"
check "H7 malformed .a1/verify.json: exit 2 bad_config" 2 'j.error' "bad_config"
vrun "$P" --timeout-ms 0; check_rc "H8 --timeout-ms 0: exit 2" 2
newproj h9; stub meta 'exit 0'; cfg '{"commands":[{"id":"x;rm -rf /","argv":["./bin/meta","$(touch /tmp/a1-fx-pwned)","a b;c"]}]}'; seal
vrun "$P"
check "H9 shell metacharacters in id and argv stay literal: exit 0, no file created" 0 'j.verdict' "pass"
[[ ! -e /tmp/a1-fx-pwned ]] && ok "H9b no shell interpretation of argv" || { bad "H9b /tmp/a1-fx-pwned exists"; rm -f /tmp/a1-fx-pwned; }

# ---------- F: head vs base snapshot (FR-015) ----------
# alt.json: planted edit of the real vitest file - failing test "fail 0" renamed "fail 9"
sed 's/"fail 0"/"fail 9"/g' "$CORPUS/vitest-3-40-2.json" > "$WORK/alt.json"
MODE_STUB='case "$(cat src/app.js)" in *ALT*) export A1_FX_REPORT="$A1_FX_ALT";; *BAD*) ;; *) exit 0;; esac
'"$REPORT_STUB"
export A1_FX_ARGS="$WORK/args-f" A1_FX_REPORT="$CORPUS/vitest-3-40-2.json" A1_FX_ALT="$WORK/alt.json" A1_FX_RC=1
basecase() { # basecase <label> <marker on base> <marker on head>
  newproj "$1"; stub vitest "$MODE_STUB"; cfg '{"commands":[{"id":"unit","argv":["./bin/vitest","run"]}]}'
  printf 'module.exports = "%s";\n' "$2" > "$P/src/app.js"; seal
  printf 'module.exports = "%s";\n' "$3" > "$P/src/app.js"; g "$P" commit -q -am head
  vrun "$P" --base main
}
basecase f1 ok BAD
check "F1 failure on head only: exit 1, fail, nothing recorded pre_existing_red (base snapshot was green)" 1 'j.verdict+"/"+j.pre_existing_red.length+"/"+j.commands[0].failed_ids.length+"/"+(j.head_sha!==j.base_sha)' "fail/0/3/true"
basecase f2 BAD BAD2
check "F2 same 3 tests red on head and base: exit 0, pass, 3 recorded pre_existing_red" 0 'j.verdict+"/"+j.pre_existing_red.length+"/"+j.pre_existing_red.map(x=>x.id).join("|")' "pass/3/a.test.mjs > fail 0|a.test.mjs > fail 1|a.test.mjs > fail 2"
basecase f3 BAD ALT
check "F3 head fails a test base does not (fail 9): exit 1, the 2 shared ones are pre_existing_red" 1 'j.verdict+"/"+j.pre_existing_red.length+"/"+j.commands[0].failed_ids.includes("a.test.mjs > fail 9")' "fail/2/true"
basecase f4 BAD ok
check "F4 red on base, green on head: exit 0, pass, no pre_existing_red" 0 'j.verdict+"/"+j.pre_existing_red.length' "pass/0"

# the snapshot is a git-archive extraction in a temp dir: live tree untouched, temp dir removed
newproj f5; stub cnt 'pwd -P >> "${A1_FX_CWDLOG:?}"; exit 0'; cfg '{"commands":[{"id":"cnt","argv":["./bin/cnt"]}]}'; seal
printf 'module.exports = 5;\n' > "$P/src/app.js"; g "$P" commit -q -am head
export A1_FX_CWDLOG="$WORK/cwd-f5"; : > "$A1_FX_CWDLOG"; mkdir -p "$WORK/tmp-f5"
TMPDIR="$WORK/tmp-f5" vrun "$P" --base main
check_rc "F5 --base main on a clean branch: exit 0" 0
[[ "$(grep -c 'a1-fx-verify-base-' "$A1_FX_CWDLOG")" == "1" && "$(wc -l < "$A1_FX_CWDLOG" | tr -d ' ')" == "2" ]] && ok "F5b one run inside a base snapshot dir + one on head (2 runs total)" || bad "F5b cwd log: $(cat "$A1_FX_CWDLOG")"
[[ -z "$(ls -A "$WORK/tmp-f5")" ]] && ok "F5c snapshot dir and tar removed after the run" || bad "F5c leftovers: $(ls -A "$WORK/tmp-f5")"
[[ "$(g "$P" rev-parse --abbrev-ref HEAD)" == "feat" && -z "$(g "$P" status --porcelain)" && "$(cat "$P/src/app.js")" == 'module.exports = 5;' ]] && ok "F5d live tree untouched (branch feat, clean, head content)" || bad "F5d live tree changed"

# a suite file that exists only on head cannot be masked by "red on base" (absent on base != red on base)
newproj f6; mkdir -p "$P/suites/a" "$P/suites/b"; printf 'exit 0\n' > "$P/suites/a/run.sh"; cfg '{"each":"suites/*/run*.sh","argv_prefix":["bash"]}'; seal
printf 'exit 1\n' > "$P/suites/b/run.sh"; g "$P" add -A; g "$P" commit -q -m "new red suite"
vrun "$P" --base main
check "F6 new suite red on head, file absent on base: exit 1, fail, not pre_existing_red" 1 'j.verdict+"/"+j.pre_existing_red.length+"/"+j.commands.map(c=>c.id+":"+c.reason).join(",")' "fail/0/suites/a/run.sh:null,suites/b/run.sh:command_failed"

# ---------- G: flaky (FR-016) ----------
FLAKY_STUB='n=0; [ -f "${A1_FX_CTR:?}" ] && n="$(cat "$A1_FX_CTR")"; echo $((n + 1)) > "$A1_FX_CTR"
[ "$n" = 0 ] || exit 0
'"$REPORT_STUB"
IDS3='["a.test.mjs > fail 0","a.test.mjs > fail 1","a.test.mjs > fail 2"]'
flakycase() { # flakycase <label> <flaky_base json>
  newproj "$1"; stub vitest "$FLAKY_STUB"; cfg "{\"flaky_base\":$2,\"commands\":[{\"id\":\"unit\",\"argv\":[\"./bin/vitest\",\"run\"]}]}"; seal
  export A1_FX_CTR="$WORK/ctr-$1"; rm -f "$A1_FX_CTR"; vrun "$P"
}
flakycase g1 '[]'
check "G1 fails once, passes on the single re-run, id not in flaky_base: exit 1, new_flaky, 3 flaky recorded (never dropped)" 1 'j.verdict+"/"+j.reason+"/"+j.flaky.length+"/"+j.commands[0].exit_code' "fail/new_flaky/3/0"
[[ "$(cat "$A1_FX_CTR")" == "2" ]] && ok "G1b exactly one re-run (2 invocations)" || bad "G1b invocations $(cat "$A1_FX_CTR")"
flakycase g2 "$IDS3"
check "G2 same three ids listed in flaky_base: exit 0, pass, still recorded flaky" 0 'j.verdict+"/"+j.flaky.length+"/"+j.reason' "pass/3/null"
flakycase g3 '["a.test.mjs > fail 0","a.test.mjs > fail 1"]'
check "G3 only 2 of the 3 flaky ids listed: exit 1 new_flaky (limit 0 for unlisted)" 1 'j.verdict+"/"+j.reason+"/"+j.flaky.length' "fail/new_flaky/3"

newproj g4; stub flk 'n=0; [ -f "${A1_FX_CTR:?}" ] && n="$(cat "$A1_FX_CTR")"; echo $((n + 1)) > "$A1_FX_CTR"; [ "$n" = 0 ] && exit 1; exit 0'
cfg '{"commands":[{"id":"flk","argv":["./bin/flk"]}]}'; seal
export A1_FX_CTR="$WORK/ctr-g4"; rm -f "$A1_FX_CTR"; vrun "$P"
check "G4 runner without ids: whole command re-run once, command id is the flaky id -> new_flaky" 1 'j.reason+"/"+j.flaky.map(x=>x.id).join()' "new_flaky/flk"
cfg '{"flaky_base":["flk"],"commands":[{"id":"flk","argv":["./bin/flk"]}]}'; g "$P" commit -q -am list
rm -f "$A1_FX_CTR"; vrun "$P"
check "G4b command id listed in flaky_base: exit 0" 0 'j.verdict+"/"+j.flaky.length' "pass/1"

newproj g5; stub red 'n=0; [ -f "${A1_FX_CTR:?}" ] && n="$(cat "$A1_FX_CTR")"; echo $((n + 1)) > "$A1_FX_CTR"; exit 1'
cfg '{"commands":[{"id":"red","argv":["./bin/red"]}]}'; seal
export A1_FX_CTR="$WORK/ctr-g5"; rm -f "$A1_FX_CTR"; vrun "$P"
check "G5 fails again on the re-run: a real failure, not flaky (exit 1, command_failed, 0 flaky)" 1 'j.reason+"/"+j.flaky.length' "command_failed/0"
[[ "$(cat "$A1_FX_CTR")" == "2" ]] && ok "G5b retried exactly once" || bad "G5b invocations $(cat "$A1_FX_CTR")"

# frozen list: exported check merge-check uses (reason flaky_base_grown, wave 10)
grown() { node -e 'const b=require(process.argv[1]); process.stdout.write(JSON.stringify(b.flakyBaseGrown(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]))))' "$REPO_ROOT/_shared/lib/verify-base.cjs" "$1" "$2" 2>&1; }
[[ "$(grown '{"flaky_base":["a"]}' '{"flaky_base":["a","b"]}')" == '["b"]' ]] && ok "G6 head list holds b absent from base list: grown [b]" || bad "G6"
[[ "$(grown '{"flaky_base":["a","b"]}' '{"flaky_base":["a"]}')" == '[]' ]] && ok "G6b shrunk list: not grown" || bad "G6b"
[[ "$(grown '{"flaky_base":["a"]}' '{"flaky_base":["a"]}')" == '[]' ]] && ok "G6c equal list: not grown" || bad "G6c"
[[ "$(grown 'null' '{"flaky_base":["x","y"]}')" == '[]' ]] && ok "G6d base has no .a1/verify.json: the creating PR may set the initial list" || bad "G6d"
[[ "$(grown '{}' '{"flaky_base":["x"]}')" == '["x"]' ]] && ok "G6e base file without flaky_base, head adds x: grown" || bad "G6e"

# ---------- K: result cache (FR-039) ----------
newproj k1; stub cnt 'pwd -P >> "${A1_FX_CWDLOG:?}"; exit 0'; cfg '{"commands":[{"id":"cnt","argv":["./bin/cnt"]}]}'; seal
printf 'module.exports = 11;\n' > "$P/src/app.js"; g "$P" commit -q -am head
export A1_FX_CWDLOG="$WORK/cwd-k1"; : > "$A1_FX_CWDLOG"
runs() { wc -l < "$A1_FX_CWDLOG" | tr -d ' '; }
vrun "$P" --base main
check "K1 first run: cache miss on both sides, 2 runs (head + base snapshot)" 0 'j.cache.head+"/"+j.cache.base' "miss/miss"
[[ "$(runs)" == "2" ]] && ok "K1b suite ran twice" || bad "K1b runs $(runs)"
vrun "$P" --base main
check "K2 same clean head sha + same base sha: cache hit on both sides" 0 'j.cache.head+"/"+j.cache.base+"/"+j.verdict' "hit/hit/pass"
[[ "$(runs)" == "2" ]] && ok "K2b no suite spawned (counter file unchanged)" || bad "K2b runs $(runs)"
printf 'module.exports = 12;\n' > "$P/src/app.js"; g "$P" commit -q -am head2
vrun "$P" --base main
check "K3 new head sha, same base sha: head miss, base hit" 0 'j.cache.head+"/"+j.cache.base' "miss/hit"
[[ "$(runs)" == "3" && "$(grep -c 'a1-fx-verify-base-' "$A1_FX_CWDLOG")" == "1" ]] && ok "K3b one more run, base snapshot not re-run" || bad "K3b runs $(runs)"
printf 'dirty\n' > "$P/untracked.txt"
vrun "$P" --base main
check "K4 dirty tree (untracked file): no head reuse" 0 'j.cache.head' "dirty"
[[ "$(runs)" == "4" ]] && ok "K4b suite ran again" || bad "K4b runs $(runs)"
rm -f "$P/untracked.txt"
vrun "$P" --base main
check "K4c tree clean again: the stored clean-head result is reused (dirty run did not overwrite it)" 0 'j.cache.head' "hit"
: > "$P/.git/info/exclude"
vrun "$P" --base main
check "K5 gate-log and cache paths shown by git status (no info/exclude) do not make the tree dirty" 0 'j.cache.head' "hit"
vrun "$P" --base main --timeout-ms 777000
check "K6 different command hash (timeout changed): no reuse" 0 'j.cache.head+"/"+j.cache.base' "miss/miss"
[[ -z "$(g "$P" status --porcelain | grep -v 'gate-log.jsonl\|verify-cache')" ]] && ok "K7 cache files never dirty the real tree" || bad "K7 $(g "$P" status --porcelain)"
DIRTY_OUT="$(node -e 'const b=require(process.argv[1]); process.stdout.write(JSON.stringify(b.dirtyPaths([".a1/phases/x/gate-log.jsonl",".a1/verify-cache/a.json","src/a.js",".a1/phases/x/gate-log.jsonl.bak"])))' "$REPO_ROOT/_shared/lib/verify-base.cjs")"
[[ "$DIRTY_OUT" == '["src/a.js",".a1/phases/x/gate-log.jsonl.bak"]' ]] && ok "K8 dirtyPaths ignores exactly gate-log and cache paths (2 of 4 kept)" || bad "K8 $DIRTY_OUT"
printf '{broken' > "$(ls "$P"/.a1/verify-cache/*.json | head -1)"
vrun "$P" --base main --timeout-ms 777000
check_rc "K9 hostile: corrupted cache file is a miss, not a crash" 0

# ---------- S: shallow clone without the base ----------
newproj s0; stub ok 'exit 0'; cfg '{"commands":[{"argv":["./bin/ok"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am head
git clone -q --depth 1 --branch feat --single-branch "file://$P" "$WORK/shallow" 2>/dev/null
vrun "$WORK/shallow" --base main
check "S1 shallow clone without the base ref: exit 2 base_unresolved, message names git fetch" 2 'j.error+"/"+j.message.includes("git fetch")' "base_unresolved/true"
git -C "$WORK/shallow" fetch -q --depth 1 "file://$P" main:refs/remotes/origin/main 2>/dev/null
vrun "$WORK/shallow" --base origin/main
check "S2 base ref present but no common ancestor in the shallow history: exit 2 base_unresolved" 2 'j.error' "base_unresolved"

# ---------- P: timeout kills the whole process group ----------
is_alive() { local st; st="$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')"; [[ -n "$st" && "$st" != Z* ]]; }
newproj p1; stub suite 'sleep 60 & echo $! > "${A1_FX_PIDFILE:?}"; wait'; cfg '{"commands":[{"id":"suite","argv":["bash","./bin/suite"]}]}'; seal
export A1_FX_PIDFILE="$WORK/pid-p1"; rm -f "$A1_FX_PIDFILE"
vrun "$P" --timeout-ms 700
check "P1 bash suite with a background grandchild times out: exit 1, timeout" 1 'j.reason+"/"+j.commands[0].timed_out' "timeout/true"
GPID="$(cat "$A1_FX_PIDFILE" 2>/dev/null)"
[[ "$GPID" =~ ^[0-9]+$ ]] && ok "P1b grandchild pid recorded ($GPID is a number)" || bad "P1b no grandchild pid"
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do is_alive "$GPID" || break; sleep 0.2; done
if is_alive "$GPID"; then bad "P1c grandchild $GPID survived the timeout kill"; kill "$GPID" 2>/dev/null; else ok "P1c no grandchild survives (process group killed)"; fi

# ---------- M: mutation proof ----------
# A copy of _shared with the crash rule disabled must miss the SC-003 signal case;
# the original catches it.
MUT="$WORK/mut"; mkdir -p "$MUT"; cp -R "$REPO_ROOT/_shared" "$MUT/_shared"
node -e '
  const fs=require("fs"); const f=process.argv[1]; let s=fs.readFileSync(f,"utf8");
  const needle="if (r.failed === 0 || (r.signal !== null && r.failed === null)) return \x27implausible_crash\x27;";
  if (s.split(needle).length !== 2) process.exit(3);
  fs.writeFileSync(f, s.replace(needle, ""));' "$MUT/_shared/lib/verify-run.cjs"
[[ $? -eq 0 ]] && ok "M0 planted defect applied (crash rule removed in the copy)" || bad "M0 needle not found - update this case with commandReason()"
newproj m1; stub tsc 'kill -KILL $$'; cfg '{"commands":[{"argv":["./bin/tsc"]}]}'; seal
OUT="$(cd "$P" && node "$MUT/_shared/a1-tools.cjs" verify run --project "$P" --phase fx 2>/dev/null)"; RC=$?
check "M1 mutated tool: signal kill reports 'signal', not implausible_crash (case turns red)" 1 'j.reason' "signal"
vrun "$P"
check "M1b original tool: implausible_crash again (revert turns it green)" 1 'j.reason' "implausible_crash"

# second planted defect: the base-subset rule removed in a copy must fail F2 (original passes it)
MUT2="$WORK/mut2"; mkdir -p "$MUT2"; cp -R "$REPO_ROOT/_shared" "$MUT2/_shared"
node -e '
  const fs=require("fs"); const f=process.argv[1]; let s=fs.readFileSync(f,"utf8");
  const needle="if (reason !== null && fresh.length === 0 && baseIds !== null) reason = null;";
  if (s.split(needle).length !== 2) process.exit(3);
  fs.writeFileSync(f, s.replace(needle, ""));' "$MUT2/_shared/lib/verify-base.cjs"
[[ $? -eq 0 ]] && ok "M2 planted defect applied (base-subset rule removed in the copy)" || bad "M2 needle not found - update this case with settle()"
newproj m3; stub vitest "$MODE_STUB"; cfg '{"commands":[{"id":"unit","argv":["./bin/vitest","run"]}]}'
printf 'module.exports = "BAD";\n' > "$P/src/app.js"; seal
printf 'module.exports = "BAD2";\n' > "$P/src/app.js"; g "$P" commit -q -am head
OUT="$(cd "$P" && node "$MUT2/_shared/a1-tools.cjs" verify run --project "$P" --phase fx --base main 2>/dev/null)"; RC=$?
check "M3 mutated tool: tests red on both sides fail the verdict (case turns red)" 1 'j.verdict' "fail"
vrun "$P" --base main
check "M3b original tool: pre_existing_red does not fail the verdict (revert turns it green)" 0 'j.verdict+"/"+j.pre_existing_red.length' "pass/3"

# ---------- S: skip increase vs base (spec 017 FR-017, FR-025, Wave 8) ----------
# green.json / more.json: planted edits of the real vitest file - all 3 failures turned green; skipped 2 (base) or 4 (head)
node -e '
  const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  j.numPassedTests=43; j.numFailedTests=0; j.numFailedTestSuites=0; j.success=true;
  for (const f of j.testResults) { f.status="passed"; for (const a of f.assertionResults||[]) if (a.status==="failed") a.status="passed"; }
  fs.writeFileSync(process.argv[2], JSON.stringify(j)); j.numPendingTests=4; fs.writeFileSync(process.argv[3], JSON.stringify(j));' "$CORPUS/vitest-3-40-2.json" "$WORK/green.json" "$WORK/more.json"
SKIP_STUB='case "$(cat src/app.js)" in *MORE*) export A1_FX_REPORT="$A1_FX_MORE";; esac
'"$REPORT_STUB"
skipcase() { # skipcase <label> <head report file> [disposition args...]: base reports 2 skipped, head the given report
  newproj "$1"; stub vitest "$SKIP_STUB"; cfg '{"commands":[{"id":"unit","argv":["./bin/vitest","run"]}]}'; printf 'module.exports = "ok";\n' > "$P/src/app.js"; seal
  printf 'module.exports = "MORE";\n' > "$P/src/app.js"
  export A1_FX_ARGS="$WORK/args-s" A1_FX_REPORT="$WORK/green.json" A1_FX_MORE="$2" A1_FX_RC=0
  if [[ $# -gt 2 ]]; then shift 2; (cd "$P" && node "$TOOLS" disposition add --kind skip_increase --reason "fixture: reviewed skip increase" --by fx "$@" >/dev/null 2>&1); fi
  g "$P" add -A; g "$P" commit -q -m head
  vrun "$P" --base main
}
skipcase s1 "$WORK/more.json"
check "S1 skipped 2 on base, 4 on head, no disposition: exit 1, fail, reason skip_increase" 1 'const c=j.commands[0]; [j.verdict,j.reason,c.reason,c.skip_increase.base,c.skip_increase.head,c.skip_increase.dispositioned].join(",")' "fail,skip_increase,skip_increase,2,4,false"
skipcase s2 "$WORK/more.json" --rule skip-increase --file unit --text "2->4"
check "S2 same increase with a skip_increase disposition for exactly 2->4: exit 0, pass, dispositioned" 0 'const c=j.commands[0]; [j.verdict,c.reason,c.skip_increase.dispositioned,c.skip_increase.fingerprint.startsWith("skip-increase:unit:")].join(",")' "pass,,true,true"
skipcase s3 "$WORK/more.json" --rule skip-increase --file unit --text "2->3"
check "S3 disposition for another increase (2->3) does not cover 2->4: exit 1" 1 'j.verdict+","+j.commands[0].skip_increase.dispositioned' "fail,false"
skipcase s4 "$WORK/more.json" --rule skip-increase --file other-cmd --text "2->4"
check "S4 disposition for another command id does not cover it: exit 1" 1 'j.verdict' "fail"
skipcase s5 "$WORK/green.json"
check "S5 skipped 2 on both sides: exit 0, pass, no skip_increase record" 0 'j.verdict+","+(j.commands[0].skip_increase===undefined)' "pass,true"
skipcase s6 "$WORK/more.json" --rule skip-increase --file unit --text "2->4"
FP="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].fingerprint)' "$P/.a1/dispositions.json")"
(cd "$P" && node "$TOOLS" disposition review "$FP" --verdict overturned --reason "fixture: reviewer overturned" >/dev/null 2>&1); g "$P" commit -q -am overturned
vrun "$P" --base main
check "S6 the same disposition overturned by review clears nothing: exit 1" 1 'j.verdict+","+j.commands[0].skip_increase.dispositioned' "fail,false"
skipcase s7 "$WORK/more.json"; vrun "$P"
check "S7 without --base nothing is compared: exit 0, pass" 0 'j.verdict+","+j.commands[0].skipped' "pass,4"
skipcase s8 "$WORK/more.json"; printf '[{"kind":"skip_increase"}]\n' > "$P/.a1/dispositions.json"; vrun "$P" --base main
check "S8 malformed .a1/dispositions.json: exit 2 bad_config (fail closed)" 2 'j.error' "bad_config"
skipcase s9 "$WORK/more.json"; printf '[]\n' > "$P/.a1/dispositions.json"; g "$P" add -A; g "$P" commit -q -m "empty store"; vrun "$P" --base main
check "S9 empty dispositions store behaves as none: exit 1" 1 'j.verdict' "fail"

echo "a1-verify: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
