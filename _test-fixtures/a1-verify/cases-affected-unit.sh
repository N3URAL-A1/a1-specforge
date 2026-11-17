# Sourced by run-tests.sh (spec 027 slice 2, FR-006, wave 1). Uses ok/bad/check/check_rc/g/WORK/REPO_ROOT from run-tests.sh.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# Unit cases for _shared/lib/verify-affected.cjs: the pure selection (D3), the map validation (D4) and the literal-requirer scan (D6).
# RED-proof (wave 1 report): rule-6 check removed -> AU2; HARD_FULL_PATHS emptied -> AU3; selectorMatches exact-only -> AU1;
# requirer step removed -> AU10; ls-files scan narrowed to _shared/lib + _test-fixtures -> AU11.

AFF_LIB="$REPO_ROOT/_shared/lib/verify-affected.cjs"
AU_PLAN='["_test-fixtures/s1/run-tests.sh","_test-fixtures/s2/run-tests.sh","_test-fixtures/smk/run-tests.sh"]'
AU_CFG='{"affected":{"src/":["_test-fixtures/s1/"]},"smoke":["_test-fixtures/smk/"]}'

# asel <changed js expr> <cfg js expr> [exists expr over p] [requirers js expr] -> OUT, RC
asel() {
  OUT="$(AFF="$AFF_LIB" CH="$1" CF="$2" EX="${3:-true}" RQ="${4:-undefined}" PL="$AU_PLAN" node -e '
    const a = require(process.env.AFF);
    const r = a.selectAffected({
      changed: eval("(" + process.env.CH + ")"), exists: new Function("p", "return (" + process.env.EX + ")"),
      cfg: eval("(" + process.env.CF + ")"), planIds: JSON.parse(process.env.PL), requirers: eval("(" + process.env.RQ + ")") });
    process.stdout.write(JSON.stringify(r));' 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}
# avalid <cfg js expr> -> RC 0 valid, 2 bad_config, 1 other
avalid() {
  OUT="$(AFF="$AFF_LIB" CF="$1" node -e '
    const a = require(process.env.AFF);
    try { a.validateAffectedConfig(eval("(" + process.env.CF + ")")); process.stdout.write("{}"); }
    catch (e) { process.stdout.write(JSON.stringify({ reason: e.reason, msg: e.message })); process.exit(e.reason === "bad_config" ? 2 : 1); }' 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}

asel '["src/a.js"]' "$AU_CFG"
check "AU1 mapped path: subset/mapped, ids s1 + smoke" 0 'j.selection+"/"+j.reason+"/"+j.ids.join()' "subset/mapped/_test-fixtures/s1/run-tests.sh,_test-fixtures/smk/run-tests.sh"
asel '["README.md"]' "$AU_CFG"
check "AU2 unmapped path: full/unmapped_path, the path is named, all plan ids" 0 'j.selection+"/"+j.reason+"/"+j.paths.join()+"/"+j.ids.length' "full/unmapped_path/README.md/3"

for hp in bin/run-suites.sh bin/run-suites-proc.sh bin/run-suites-report.sh _test-fixtures/suite-groups.json .a1/verify.json _shared/a1-tools.cjs; do
  asel "[\"$hp\"]" "$AU_CFG"
  check "AU3 $hp: full/runner_or_config_changed" 0 'j.selection+"/"+j.reason' "full/runner_or_config_changed"
done

AU_UNCH='{"affected":{"src/":["_test-fixtures/s1/"],".github/":["_test-fixtures/s1/"],"x/":["_test-fixtures/s1/"]},"smoke":["_test-fixtures/smk/"],"ci_evidence":{"unchanged":[".github/","x/guard.sh"]}}'
asel '[".github/w.yml"]' "$AU_UNCH"
check "AU4a ci_evidence.unchanged prefix entry beats a mapped key: full/runner_or_config_changed" 0 'j.selection+"/"+j.reason' "full/runner_or_config_changed"
asel '["x/guard.sh"]' "$AU_UNCH"
check "AU4b ci_evidence.unchanged exact entry: full/runner_or_config_changed" 0 'j.selection+"/"+j.reason' "full/runner_or_config_changed"

asel '["src/a.js"]' "$AU_CFG" 'false'
check "AU5 mapped path absent from the tree: full/path_deleted" 0 'j.selection+"/"+j.reason+"/"+j.paths.join()' "full/path_deleted/src/a.js"
asel 'null' "$AU_CFG"
check "AU6 no diff base: full/no_diff_base" 0 'j.selection+"/"+j.reason' "full/no_diff_base"
asel '[]' "$AU_CFG"
check "AU7 empty change set: full/empty_change_set" 0 'j.selection+"/"+j.reason' "full/empty_change_set"
asel '["src/a.js"]' '{"affected":{"src/":["_test-fixtures/gone/"]},"smoke":["_test-fixtures/smk/"]}'
check "AU8 selector that matches no plan command: full/selector_unknown, the selector is named" 0 'j.selection+"/"+j.reason+"/"+j.paths.join()' "full/selector_unknown/_test-fixtures/gone/"
asel '["src/a.js"]' '{"affected":{"src/":["_test-fixtures/s1/"]}}'
check "AU9 config without smoke: full/no_affected_map" 0 'j.selection+"/"+j.reason' "full/no_affected_map"
asel '["src/a.js"]' '{}'
check "AU9b config without any map: full/no_affected_map" 0 'j.selection+"/"+j.reason' "full/no_affected_map"

AU_RQ_CFG='{"affected":{"lib/b":["_test-fixtures/s1/"],"lib/a":["_test-fixtures/s2/"]},"smoke":["_test-fixtures/smk/"]}'
asel '["lib/b.cjs"]' "$AU_RQ_CFG" 'true' 'new Map([["lib/b.cjs", new Set(["lib/a.cjs"])]])'
check "AU10 a literal requirer with a key adds its selectors: subset ids s1,s2,smk" 0 'j.selection+"/"+j.ids.map(i=>i.split("/")[1]).join()' "subset/s1,s2,smk"
asel '["lib/b.cjs"]' '{"affected":{"lib/b":["_test-fixtures/s1/"]},"smoke":["_test-fixtures/smk/"]}' 'true' 'new Map([["lib/b.cjs", new Set(["lib/a.cjs"])]])'
check "AU10b a literal requirer without a key: full/unmapped_path naming the requirer" 0 'j.selection+"/"+j.reason+"/"+j.paths.join()' "full/unmapped_path/lib/a.cjs"

# AU11: the scan covers every tracked js file, follows both literal forms, is transitive and skips the facade.
R11="$WORK/au11"; rm -rf "${R11:?}"; mkdir -p "$R11/lib" "$R11/hooks" "$R11/_shared/lib"; git -C "$R11" init -q -b main
printf "const b = require('./b.cjs');\n" > "$R11/lib/a.cjs"
printf "module.exports = 1;\n" > "$R11/lib/b.cjs"
printf "const path = require('path');\nconst a = require(path.join(__dirname, 'a.cjs'));\n" > "$R11/lib/c.cjs"
printf "const path = require('path');\nconst b = require(path.join(__dirname, '..', 'lib', 'b.cjs'));\n" > "$R11/hooks/h.cjs"
printf "module.exports = 2;\n" > "$R11/_shared/lib/b.cjs"
printf "require('./lib/b.cjs');\nrequire('../lib/b.cjs');\n" > "$R11/_shared/a1-tools.cjs"
g "$R11" add -A; g "$R11" commit -q -m init
OUT="$(AFF="$AFF_LIB" PRJ="$R11" node -e '
  const a = require(process.env.AFF);
  const m = a.literalRequirers(process.env.PRJ, ["lib/b.cjs", "_shared/lib/b.cjs"]);
  process.stdout.write(JSON.stringify({ b: Array.from(m.get("lib/b.cjs")).sort(), sb: Array.from(m.get("_shared/lib/b.cjs")).sort() }));' 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"
check "AU11 transitive requirers of lib/b.cjs incl. hooks/ and path.join forms, facade excluded" 0 'j.b.join()+"|"+j.sb.length' "hooks/h.cjs,lib/a.cjs,lib/c.cjs|0"

avalid '{affected: [], smoke: ["a/"]}'
check_rc "AU12a affected as an array: bad_config (2)" 2
avalid '{affected: {"../etc": ["a/"]}, smoke: ["a/"]}'
check_rc "AU12b key with a .. segment: bad_config (2)" 2
avalid '{affected: {"/abs": ["a/"]}, smoke: ["a/"]}'
check_rc "AU12c key with a leading slash: bad_config (2)" 2
avalid '{affected: {["x".repeat(10000)]: ["a/"]}, smoke: ["a/"]}'
check_rc "AU12d key of 10000 chars: bad_config (2)" 2
avalid '{affected: {"src/": []}, smoke: ["a/"]}'
check_rc "AU12e empty selector list: bad_config (2)" 2
avalid '{affected: {"src/": ["; rm -rf /"]}, smoke: ["a/"]}'
check_rc "AU12f selector with shell metacharacters: bad_config (2)" 2
avalid '{affected: {"src/": ["a/../b/"]}, smoke: ["a/"]}'
check_rc "AU12g selector with a .. segment: bad_config (2)" 2
avalid '{affected: Object.fromEntries(Array.from({length: 2001}, (_, i) => ["k" + i, ["a/"]])), smoke: ["a/"]}'
check_rc "AU12h 2001 keys: bad_config (2)" 2
avalid '{affected: {"src/": ["a/"]}, smoke: []}'
check_rc "AU12i empty smoke: bad_config (2)" 2
avalid '{affected: {"src/": ["a/"]}, smoke: ["a/"]}'
check_rc "AU12j control: a valid map passes (0)" 0
avalid '{smoke: ["a/"]}'
check_rc "AU12k no affected key: null, not an error (0)" 0

PWN="$WORK/pwned"
asel "[\"\$(touch $PWN)\"]" '{"affected":{"$":["_test-fixtures/s1/"]},"smoke":["_test-fixtures/smk/"]}'
check "AU13 hostile changed path is an inert string (mapped by key $)" 0 'j.selection' "subset"
[[ ! -e "$PWN" ]] && ok "AU13b the hostile path executed nothing" || bad "AU13b the hostile path executed a command"
