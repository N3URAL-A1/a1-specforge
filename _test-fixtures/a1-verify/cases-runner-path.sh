# Sourced by run-tests.sh (spec 027 slice 3 wave 7, FR-013 runner path inside runVerify). Uses the suite helpers: newproj, cfg, seal, check, g, ok, bad.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# runVerify({base, noCache, lazyBase, runner: true}) runs the suites through the BASE runner copy (D5). Real runner files are copied into
# the planted repos; fake-runner.sh (same dir) stands in for a base runner that misbehaves. Every run has its own verify lock dir, its own
# runner lock dir (A1_SUITE_LOCK_DIR) and a bounded wait; the outer A1_VERIFY_LOCK_TOKEN is dropped for the child only (env -u), never in the suite shell.
#
# RED-proof (scratch copy, see STATUS.md wave 7):
#   (a) prepareRunner replaced by the head snapshot's bin/            : RP2 red
#   (b) --groups-file dropped from the runner argv                    : RP3 red
#   (c) the fallback throws instead                                   : RP4 red
#   (d) leak_note branch removed from commandReason                   : RP7, RP13 red
#   (e) the runner exit used as the verdict                           : RP9 red
#   (f) base need = every id                                          : RP11 red
#   (g) the D18 stderr mapping removed                                : RP8 red
#   (h) rp.release() removed from selectSides                         : RP15 red
. "$REPO_ROOT/_test-fixtures/a1-verify/leak-assert.sh"; lk_leak_start
RPW="$WORK/rp"; mkdir -p "$RPW"
cp "$REPO_ROOT/_test-fixtures/a1-verify/fake-runner.sh" "$RPW/fake-runner.sh"

# rp_suite <name> <body>: suite s<name> in $P that prints a count line, then runs <body>
rp_suite() {
  mkdir -p "$P/_test-fixtures/$1"
  printf '#!/usr/bin/env bash\necho "s: 1 passed, 0 failed"\n%s\n' "$2" > "$P/_test-fixtures/$1/run-tests.sh"
}
rp_runner_files() { cp "$REPO_ROOT"/bin/run-suites.sh "$REPO_ROOT"/bin/run-suites-proc.sh "$REPO_ROOT"/bin/run-suites-report.sh "$P/bin/"; }
# rp_repo <label> [base-hook] [head-hook]: hooks are shell snippets run in $P before the base / head commit
rp_repo() {
  newproj "$1"; mkdir -p "$P/_test-fixtures"
  rp_suite s1 'exit 0'; rp_suite s2 'exit 0'; rp_runner_files
  printf '%s\n' '{"serial":[],"no_count":[],"ci_jobs":{},"timings":{}}' > "$P/_test-fixtures/suite-groups.json"
  cfg '{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"timeout_ms":60000}'
  (cd "$P" && eval "${2:-:}"); seal
  (cd "$P" && eval "${3:-:}"); printf 'module.exports = 3;\n' > "$P/src/app.js"; g "$P" add -A; g "$P" commit -q -m head
}
# rp_run <project> <case>: sets OUT (record JSON, or {"error","message"} on VerifyError), RC, ERR; spawn log in $RP_LOG.
rp_run() {
  RP_LOG="$RPW/$2.log"; : > "$RP_LOG"; mkdir -p "$RPW/$2"
  OUT="$(cd "$1" && env -u A1_VERIFY_LOCK_TOKEN A1_VERIFY_LOCK_DIR="$RPW/$2/vlock" A1_VERIFY_LOCK_WAIT_MS=5000 A1_SUITE_LOCK_DIR="$RPW/$2/rlock" \
    A1_VERIFY_SPAWN_LOG="$RP_LOG" TMPDIR="${RP_TMPDIR:-${TMPDIR:-/tmp}}" node -e '
      const r = require(process.argv[1]);
      try {
        const rec = r.runVerify({ project: process.argv[2], base: "main", noCache: true, lazyBase: true, runner: true });
        const left = require("fs").readdirSync(process.env.TMPDIR).filter((n) => n.startsWith("a1-verify-runner-")); // checked before process exit (cleanupOnExit would hide a leak)
        process.stdout.write(JSON.stringify({ ...rec, leftover_runner_dirs: left }));
      }
      catch (e) { if (!(e instanceof r.VerifyError)) throw e; process.stdout.write(JSON.stringify({ error: e.reason, message: e.message })); }' \
    "$REPO_ROOT/_shared/lib/verify-run.cjs" "$1" 2>"$RPW/err")"; RC=$?
  ERR="$(cat "$RPW/err")"
}
rp_count() { grep -c "^$1" "$RP_LOG" | tr -d ' '; }
FAKE_BASE='cp "$RPW/fake-runner.sh" bin/run-suites.sh'
unset A1_FX_RUNNER_MODE A1_FX_RUNNER_SIDES A1_FX_RUNNER_RC A1_FX_RUNNER_ERR

# RP1: both green
rp_repo rp1; rp_run "$P" rp1
check "RP1 both green: pass, runner_source base, base_run.ran [], head checks skipped, no base side" 0 \
  'j.verdict+"|"+j.runner_source+"|"+JSON.stringify(j.base_run.ran)+"|"+j.runner.sides.head.checks_skipped.map(x=>x.split(":")[0]).join(",")+"|"+j.runner.sides.base+"|"+j.runner.fallback' "pass|base|[]|learnings,phases|null|null"
[[ "$(rp_count runner:base)" == "0" && "$(rp_count runner:head)" == "2" && "$(rp_count h)" == "0" ]] && ok "RP1b spawn log: 2 runner:head lines, no runner:base, no serial line" || bad "RP1b log: $(cat "$RP_LOG")"

# RP2: the head's own runner never runs
rp_repo rp2 : 'f=bin/run-suites.sh; { head -n 1 "$f"; echo '"'"'touch "$A1_FX_MARK"'"'"'; tail -n +2 "$f"; } > "$f.new"; mv "$f.new" "$f"; chmod +x "$f"'
rm -f "$RPW/mark"; export A1_FX_MARK="$RPW/mark"; rp_run "$P" rp2
check "RP2 head edits bin/run-suites.sh: runner_source base, pass" 0 'j.runner_source+"|"+j.verdict' "base|pass"
[[ ! -e "$RPW/mark" ]] && ok "RP2b the head's runner copy did not run (marker absent)" || bad "RP2b the head runner ran"
(cd "$P" && bash bin/run-suites.sh --contract >/dev/null 2>&1); [[ -e "$RPW/mark" ]] && ok "RP2c control: the head runner would create the marker" || bad "RP2c control marker missing"
unset A1_FX_MARK

# RP3: a broken head groups file does not matter (the base copy is used)
rp_repo rp3 : 'printf "{not json\n" > _test-fixtures/suite-groups.json'; rp_run "$P" rp3
check "RP3 head suite-groups.json broken: pass, runner_source base" 0 'j.verdict+"|"+j.runner_source' "pass|base"

# RP4: the base has no runner
rp_repo rp4 'rm -f bin/run-suites.sh bin/run-suites-proc.sh bin/run-suites-report.sh' 'cp "$REPO_ROOT"/bin/run-suites*.sh bin/'; rp_run "$P" rp4
check "RP4 base without runner files: none, base_copy_missing, pass" 0 'j.runner_source+"|"+j.runner.fallback+"|"+j.verdict' "none|base_copy_missing|pass"
[[ "$(rp_count h)" == "2" && "$(rp_count runner:)" == "0" ]] && ok "RP4b serial path ran (h lines, no runner lines)" || bad "RP4b log: $(cat "$RP_LOG")"

# RP5: the base runner is an exit-2 stub (what main before this slice answers)
rp_repo rp5 'printf "#!/usr/bin/env bash\nexit 2\n" > bin/run-suites.sh'; rp_run "$P" rp5
check "RP5 base runner exit 2: none, no_contract, pass" 0 'j.runner_source+"|"+j.runner.fallback+"|"+j.verdict' "none|no_contract|pass"

# RP6: the runner returns one id too few
rp_repo rp6 "$FAKE_BASE"; export A1_FX_RUNNER_MODE=drop-one; rp_run "$P" rp6
check "RP6 runner drops an id: runner_result_mismatch" 0 'j.error' "runner_result_mismatch"

# RP7: a leak note on the first id
rp_repo rp7 "$FAKE_BASE"; export A1_FX_RUNNER_MODE=leak-first A1_FX_RUNNER_RC=1; rp_run "$P" rp7
check "RP7 leak note: first id reason leak_note, verdict fail" 0 'j.verdict+"|"+j.commands[0].reason' "fail|leak_note"

# RP8: runner lock timeout and an unrelated exit 2
rp_repo rp8 "$FAKE_BASE"; export A1_FX_RUNNER_MODE=exit2 A1_FX_RUNNER_RC=2 A1_FX_RUNNER_ERR='run-suites: lock wait of 5 ms exceeded; another run holds the lock'; rp_run "$P" rp8
check "RP8 runner lock held past the wait: lock_timeout with the runner text" 0 'j.error+"|"+j.message.includes("lock wait of 5 ms exceeded")' "lock_timeout|true"
rp_repo rp8b "$FAKE_BASE"; export A1_FX_RUNNER_ERR='run-suites: unknown argument: --x'; rp_run "$P" rp8b
check "RP8b other runner exit 2: suite_runner_failed with the runner text" 0 'j.error+"|"+j.message.includes("unknown argument: --x")' "suite_runner_failed|true"

# RP9: a red result under runner exit 0 and "PASS all": red wins
rp_repo rp9 "$FAKE_BASE"; export A1_FX_RUNNER_MODE=red-first A1_FX_RUNNER_RC=0 A1_FX_RUNNER_SIDES="head retry"; rp_run "$P" rp9
check "RP9 runner exit 0 with a red result: verdict fail, command_failed" 0 'j.verdict+"|"+j.commands[0].reason' "fail|command_failed"
unset A1_FX_RUNNER_SIDES

# RP10: a node-test reporter is not eligible
rp_repo rp10 'printf "const { test } = require(\"node:test\");\ntest(\"ok\", () => {});\n" > t.test.js; cfg "{\"commands\":[{\"id\":\"tap\",\"argv\":[\"node\",\"--test\",\"t.test.js\"]}]}"'
unset A1_FX_RUNNER_MODE A1_FX_RUNNER_RC A1_FX_RUNNER_ERR; rp_run "$P" rp10
check "RP10 node-test command: none, not_eligible, pass" 0 'j.runner_source+"|"+j.runner.fallback+"|"+j.verdict' "none|not_eligible|pass"

# RP11: one suite red on head, green on base (real runner): only that suite runs on base
rp_repo rp11 : 'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nexit 1\n" > _test-fixtures/s2/run-tests.sh'; rp_run "$P" rp11
check "RP11 s2 red on head only: verdict fail, command_failed" 0 'j.verdict+"|"+j.commands.find(c=>c.id.includes("s2")).reason' "fail|command_failed"
[[ "$(rp_count runner:base)" == "1" && "$(grep '^runner:base' "$RP_LOG" | cut -f2)" == "_test-fixtures/s2/run-tests.sh" ]] && ok "RP11b exactly one runner:base line, for s2" || bad "RP11b log: $(cat "$RP_LOG")"

# RP12: the result file is a symlink
rp_repo rp12 "$FAKE_BASE"; export A1_FX_RUNNER_MODE=symlink; rp_run "$P" rp12
check "RP12 result file is a symlink: runner_result_invalid" 0 'j.error' "runner_result_invalid"
unset A1_FX_RUNNER_MODE

# RP13: a suite writes into its sentinel vault on head (real runner)
rp_repo rp13 : 'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\ntouch \"\$A1_VAULT_ROOT/leaked\"\n" > _test-fixtures/s1/run-tests.sh'; rp_run "$P" rp13
check "RP13 real runner, vault leak: reason leak_note, verdict fail" 0 'j.verdict+"|"+j.commands.find(c=>c.id.includes("s1")).reason' "fail|leak_note"

# RP14: the suites run with the verify lock held (token) and the case's lock dir
PROBE='printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nprintf \"%%s\\n%%s\\n\" \"\$A1_VERIFY_LOCK_TOKEN\" \"\${A1_VERIFY_LOCK_DIR:-}\" > \"\$A1_FX_OUT\"\n" > _test-fixtures/s1/run-tests.sh'
rp_repo rp14 : "$PROBE"; export A1_FX_OUT="$RPW/rp14.out"; rm -f "$A1_FX_OUT"; rp_run "$P" rp14
check "RP14 probe run: pass" 0 'j.verdict' "pass"
[[ "$(sed -n 1p "$A1_FX_OUT" 2>/dev/null)" =~ ^[0-9a-f]{32}$ && "$(sed -n 2p "$A1_FX_OUT" 2>/dev/null)" == "$RPW/rp14/vlock" ]] && ok "RP14b suite saw a 32-hex token and the case's verify lock dir" || bad "RP14b probe: $(cat "$A1_FX_OUT" 2>/dev/null)"
unset A1_FX_OUT

# RP15: the prepared runner copy is released when runVerify returns
mkdir -p "$RPW/rp15-tmp"; rp_repo rp15; RP_TMPDIR="$RPW/rp15-tmp" rp_run "$P" rp15
check "RP15 green run: pass, runner_source base, no a1-verify-runner-* dir left when runVerify returns" 0 'j.verdict+"|"+j.runner_source+"|"+j.leftover_runner_dirs.length' "pass|base|0"

# RP16 (review fix, Reinhard 1 / SEC-3): a suite that exits 255 (no signal name) or a deliberate 130 is a failed suite, not an invalid runner result
rp_repo rp16 : 'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nexit 255\n" > _test-fixtures/s2/run-tests.sh'; rp_run "$P" rp16
check "RP16 real runner, suite exit 255: verdict fail, command_failed (not runner_result_invalid)" 0 'j.verdict+"|"+j.commands.find(c=>c.id.includes("s2")).reason' "fail|command_failed"
rp_repo rp16b : 'printf "#!/usr/bin/env bash\necho \"s: 1 passed, 0 failed\"\nexit 130\n" > _test-fixtures/s2/run-tests.sh'; rp_run "$P" rp16b
check "RP16b real runner, suite exit 130: verdict fail (the reason label may be signal-based)" 0 'j.verdict' "fail"

lk_leak_end RP
