# Sourced by run-tests.sh (spec 027 slice 2, FR-006/FR-007, wave 2). Uses the suite helpers newproj/stub/cfg/seal/vrun/vcheck/check/check_rc/g.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# `verify run --affected` end to end, the scope marker and the verify-check refusal (D1, D2).
# RED-proof (wave 2 report): affected+base guard removed -> AC8b, AC9; --out accepted -> AC8a; scope check removed -> AC12a, AC12c;
# scope check refuses a missing scope -> AC12b and BC1; applyEnvRed gets settled ids only -> AC10; runPlan unused for headCommands -> AC1.

ACFG='{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"affected":{"src/":["_test-fixtures/s1/"],"docs/":["_test-fixtures/s2/run-tests.sh"]},"smoke":["_test-fixtures/smk/"]}'
# acproj <label> [extra cfg json merged over ACFG] -> $P on branch feat, three suites that append to $P/probe
acproj() {
  newproj "$1"
  local s; for s in s1 s2 smk; do mkdir -p "$P/_test-fixtures/$s"; printf 'echo %s >> "%s.probe"\nexit 0\n' "$s" "$P" > "$P/_test-fixtures/$s/run-tests.sh"; done
  mkdir -p "$P/docs" "$P/bin"; printf 'x\n' > "$P/docs/x.md"; printf '#!/bin/sh\n' > "$P/bin/run-suites.sh"; printf 'a\n' > "$P/src/a.js"
  cfg "${2:-$ACFG}"; seal
}
achange() { printf '%s\n' "$2" >> "$P/$1"; g "$P" add -A; g "$P" commit -q -m chg; }

acproj ac1; achange src/a.js more
vrun "$P" --affected --no-cache
check "AC1 mapped change: scope affected, subset/mapped, ran s1+smk, not_run s2" 0 \
  'j.scope+"/"+j.affected.selection+"/"+j.affected.reason+"/"+j.commands.map(c=>c.id.split("/")[1]).join()+"/"+j.affected.not_run.map(i=>i.split("/")[1]).join()+"/"+j.affected.selected+"of"+j.affected.total' \
  "affected/subset/mapped/s1,smk/s2/2of3"
if grep -qx s2 "$P.probe"; then bad "AC1b s2 ran"; else ok "AC1b s2 did not run"; fi

acproj ac2; achange README.md more
vrun "$P" --affected --no-cache
check "AC2 unmapped path: full/unmapped_path, 3 commands, scope affected" 0 'j.scope+"/"+j.affected.selection+"/"+j.affected.reason+"/"+j.commands.length+"/"+j.affected.paths.join()' "affected/full/unmapped_path/3/README.md"

acproj ac3; achange bin/run-suites.sh '# x'
vrun "$P" --affected --no-cache
check "AC3 runner script changed: full/runner_or_config_changed" 0 'j.affected.selection+"/"+j.affected.reason+"/"+j.commands.length' "full/runner_or_config_changed/3"

acproj ac4; g "$P" rm -q docs/x.md; g "$P" commit -q -m rm
vrun "$P" --affected --no-cache
check "AC4 deleted path: full/path_deleted" 0 'j.affected.selection+"/"+j.affected.reason' "full/path_deleted"

acproj ac5
vrun "$P" --affected --no-cache
check "AC5 no change: full/empty_change_set" 0 'j.affected.selection+"/"+j.affected.reason' "full/empty_change_set"

newproj ac6
for s in s1 s2 smk; do mkdir -p "$P/_test-fixtures/$s"; printf 'exit 0\n' > "$P/_test-fixtures/$s/run-tests.sh"; done
cfg "$ACFG"; g "$P" checkout -q -b work; g "$P" add -A; g "$P" commit -q -m base
vrun "$P" --affected --no-cache
check "AC6 no main/master/origin: full/no_diff_base" 0 'j.affected.selection+"/"+j.affected.reason+"/"+j.commands.length' "full/no_diff_base/3"

acproj ac7; achange src/a.js more
vrun "$P" --no-cache
check "AC7 without --affected: scope full, no affected key, all commands" 0 'j.scope+"/"+(j.affected===undefined)+"/"+j.commands.length' "full/true/3"

acproj ac8; achange src/a.js more
vrun "$P" --affected --out "$P/.a1/V.md"
check_rc "AC8a --affected with --out: exit 2" 2
check "AC8a usage error" 2 'j.error' "usage"
if [[ -e "$P/.a1/V.md" ]]; then bad "AC8a file written"; else ok "AC8a no file written"; fi
vrun "$P" --affected --base main
check "AC8b --affected with --base: exit 2 usage" 2 'j.error' "usage"

acproj ac9; achange src/a.js more
OUT="$(node -e '
  try { require(process.argv[1]).runVerify({ project: process.argv[2], base: "main", affected: true }); process.stdout.write(JSON.stringify({ reason: "no_throw" })); }
  catch (e) { process.stdout.write(JSON.stringify({ reason: e.reason || e.message })); }' "$REPO_ROOT/_shared/lib/verify-run.cjs" "$P" 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"
check "AC9 runVerify itself (merge-check path) refuses affected with base" 0 'j.reason' "usage"

acproj ac10 '{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"affected":{"src/":["_test-fixtures/s1/"]},"smoke":["_test-fixtures/smk/"],"env_red":[{"id":"_test-fixtures/s2/run-tests.sh","host":"'"$(node -p 'process.platform')"'","reason":"x"}]}'
achange src/a.js more
vrun "$P" --affected --no-cache
check "AC10 unselected env_red id: no env_red_stale warning, subset run" 0 '(j.warnings||[]).filter(w=>w.reason==="env_red_stale").length+"/"+j.affected.selection' "0/subset"

acproj ac11; achange src/a.js more
vrun "$P" --affected
vrun "$P"
check "AC11 full run after a subset run on the same sha: cache miss, 3 commands with integer durations" 0 \
  'j.cache.head+"/"+j.commands.length+"/"+j.commands.every(c=>Number.isInteger(c.duration_ms))' "miss/3/true"

acproj ac12; achange src/a.js more
vrun "$P" --affected --no-cache
printf '%s' "$OUT" > "$WORK/ac12.json"
mkwrite() { # <record json file> <out md> [js to mutate r]
  node -e '
    const { writeOut } = require(process.argv[1]); const r = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")); delete r.ok; delete r.out;
    eval(process.argv[4] || ""); writeOut(process.argv[3], r);' "$REPO_ROOT/_shared/lib/verify-cli.cjs" "$1" "$2" "$3"
}
for v in a b c; do printf -- '---\nverdict: PASS\n---\nbody\n' > "$P/.a1/V$v.md"; done
mkwrite "$WORK/ac12.json" "$P/.a1/Va.md" ""
mkwrite "$WORK/ac12.json" "$P/.a1/Vb.md" "delete r.scope"
mkwrite "$WORK/ac12.json" "$P/.a1/Vc.md" "r.scope='partial'"
vcheck "$P/.a1/Va.md"
check "AC12a a record with scope affected: refused scope_not_full" 1 'j.reasons.join()' "scope_not_full"
vcheck "$P/.a1/Vb.md"
check "AC12b control: the same record without scope is a legacy full record, accepted" 0 'j.ok' "true"
vcheck "$P/.a1/Vc.md"
check "AC12c scope partial: refused scope_not_full" 1 'j.reasons.join()' "scope_not_full"
vrun "$P" --no-cache --out "$P/.a1/Vd.md"
check_rc "AC12d fresh verify run --out: exit 0" 0
vcheck "$P/.a1/Vd.md"
check "AC12d verify check accepts it" 0 'j.ok' "true"
OUT="$(node -e 'const c=require("fs").readFileSync(process.argv[1],"utf8"); const {parseFrontmatter}=require(process.argv[2]); process.stdout.write(JSON.stringify(require(process.argv[3]).readVerifyRun(parseFrontmatter(c).fm)));' "$P/.a1/Vd.md" "$REPO_ROOT/_shared/lib/io-frontmatter.cjs" "$REPO_ROOT/_shared/lib/verify-check.cjs")"; RC=0
check "AC12d the written record says scope full, no affected key" 0 'j.scope+"/"+(j.affected===undefined)' "full/true"

acproj ac13; achange src/a.js more
vrun "$P" --affected=1
check_rc "AC13a --affected=1: exit 2" 2
vrun "$P" --affected --project "$(printf 'x%.0s' $(seq 1 5000))"
check_rc "AC13b over-long --project: exit 2" 2
