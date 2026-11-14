# Sourced by run-tests.sh (spec 028 FR-001..FR-004, wave 1). Uses the suite helpers: newproj, stub, cfg, seal, vrun, check, check_rc, g, js.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (wave report, 2026-11-14): the whole file was run once against `git archive fa73852`; every HC/HB/HR case below
# fails there except the explicit controls (HC1b, HC2a, HB2, BC1, BC2), which pin behaviour that must not change.
#
# vnode <proj> <host json> [base ref] [cache:1]: runVerify in process with an injected host ({platform, probeTimeoutMs}); sets OUT, RC.
vnode() {
  OUT="$(cd "$1" && node -e '
    const r = require(process.argv[1]);
    const o = { project: process.argv[2], noCache: process.argv[5] !== "1", host: JSON.parse(process.argv[3]) };
    if (process.argv[4]) o.base = process.argv[4];
    try { const v = r.runVerify(o); process.stdout.write(JSON.stringify(v)); process.exitCode = v.verdict === "pass" ? 0 : 1; }
    catch (e) { process.stdout.write(JSON.stringify({ error: e.reason || e.message, message: e.message })); process.exitCode = 2; }
  ' "$REPO_ROOT/_shared/lib/verify-run.cjs" "$1" "$2" "${3:-}" "${4:-0}" 2>"$WORK/err")"; RC=$?
  ERR="$(cat "$WORK/err")"
}
LINUX='{"platform":"linux"}'
DARWIN='{"platform":"darwin"}'
lines() { if [[ -f "$1" ]]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }

# ---- FR-001 requires_host ----
HM="$WORK/hc-marker"
newproj hc1; rm -f "$HM"; stub mac "echo mac >> $HM"; stub ok 'exit 0'
cfg '{"commands":[{"id":"mac","argv":["./bin/mac"],"requires_host":["darwin"]},{"id":"any","argv":["./bin/ok"]}]}'; seal
vnode "$P" "$LINUX"
check "HC1 darwin-only id on a linux host: not executed, named under skipped_on_host with exactly {id, requires_host, host_platform}" 0 \
  'JSON.stringify(j.skipped_on_host)+"/"+j.commands.map(c=>c.id).join()' '[{"id":"mac","requires_host":["darwin"],"host_platform":"linux"}]/any'
check "HC1a the skipped command did not run (no marker line)" 0 '"'"$(lines "$HM")"'"' "0"
check "HC1h hints names the skipped id with the target-OS text; exit code stays 0" 0 'j.hints.join("|")' "run these ids on the target OS before merge: mac"
vnode "$P" "$DARWIN"
check "HC1b control: the same config on a darwin host runs the id (marker 1), skipped_on_host empty, no hints key" 0 \
  'j.skipped_on_host.length+"/"+j.commands.map(c=>c.id).join()+"/"+(j.hints===undefined)' "0/mac,any/true"
check "HC1c marker proves the darwin run executed it" 0 '"'"$(lines "$HM")"'"' "1"

# head and base side: neither executes it
newproj hc1d; rm -f "$HM"; stub mac "echo mac >> $HM"; stub ok 'exit 0'
cfg '{"commands":[{"id":"mac","argv":["./bin/mac"],"requires_host":["darwin"]},{"id":"any","argv":["./bin/ok"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "head change"
vnode "$P" "$LINUX" main
check "HC1d --base: darwin-only id not executed on head or base (marker 0), named once under skipped_on_host" 0 'j.skipped_on_host.map(s=>s.id).join()+"/"+j.commands.map(c=>c.id).join()' "mac/any"
check "HC1e --base: marker file stayed empty" 0 '"'"$(lines "$HM")"'"' "0"

# the filter runs before the cache hash: a darwin run's cached result must not serve a linux run
newproj hc1f; rm -f "$HM"; stub mac "echo mac >> $HM"; stub ok 'exit 0'
cfg '{"commands":[{"id":"mac","argv":["./bin/mac"],"requires_host":["darwin"]},{"id":"any","argv":["./bin/ok"]}]}'; seal
vnode "$P" "$DARWIN" "" 1
vnode "$P" "$LINUX" "" 1
check "HC1f cache: a linux run after a cached darwin run is a miss and lists only 'any' (filter precedes the hash)" 0 'j.cache.head+"/"+j.commands.map(c=>c.id).join()' "miss/any"

newproj hc2; rm -f "$HM"; stub ok 'exit 0'
cfg '{"commands":[{"id":"e","argv":["./bin/ok"],"requires_host":[]}]}'; seal
vnode "$P" "$LINUX"
check "HC2a control: an empty requires_host array counts as absent and runs everywhere" 0 'j.commands.map(c=>c.id).join()+"/"+j.skipped_on_host.length' "e/0"
vnode "$P" "$DARWIN"
check "HC2b empty array on darwin runs too" 0 'j.commands.map(c=>c.id).join()+"/"+j.skipped_on_host.length' "e/0"
newproj hc2c; stub ok 'exit 0'
cfg '{"commands":[{"id":"u","argv":["./bin/ok"],"requires_host":["plan9"]}]}'; seal
vrun "$P"
check "HC2c unknown platform string is accepted (not bad_config) and skipped on this host" 1 'j.skipped_on_host.map(s=>s.id+":"+s.requires_host.join()).join()' "u:plan9"
vnode "$P" "$DARWIN"
check "HC2d unknown platform skipped on darwin as well" 1 'j.skipped_on_host.map(s=>s.id).join()' "u"

newproj hc3; stub ok 'exit 0'
cfg '{"commands":[{"id":"u","argv":["./bin/ok"],"requires_host":"darwin"}]}'; seal
vrun "$P"
check "HC3a requires_host as a string: exit 2 bad_config" 2 'j.error' "bad_config"
check "HC3a2 the message carries a fix hint naming .a1/verify.json (SC-006)" 2 'j.message.includes("requires_host")&&j.message.includes("edit .a1/verify.json")' "true"
cfg '{"commands":[{"id":"u","argv":["./bin/ok"],"requires_host":["darwin",7]}]}'
vrun "$P"
check "HC3b non-string element: exit 2 bad_config" 2 'j.error' "bad_config"

# each suites are never host-filtered
newproj hc4; mkdir -p "$P/t/a"; printf 'exit 0\n' > "$P/t/a/run.sh"; stub ok 'exit 0'
cfg '{"each":"t/*/run.sh","argv_prefix":["bash"],"commands":[{"id":"u","argv":["./bin/ok"],"requires_host":["plan9"]}]}'; seal
vrun "$P"
check "HC4 each suites run on every host; only the commands[] entry is skipped" 0 'j.commands.map(c=>c.id).join()+"/"+j.skipped_on_host.map(s=>s.id).join()' "t/a/run.sh/u"

# ---- FR-002 -bash32 probe ----
BC="$WORK/hb-count"
newproj hb1; rm -f "$HM" "$BC"; stub five 'if [ "$1" = "-c" ]; then echo 5; else echo ran >> '"$HM"'; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/five","run.sh"]}]}'; seal
vnode "$P" "$LINUX"
check "HB1 stub argv[0] printing 5: -bash32 id skipped with reason shell_major_mismatch, requires_host null, a detail" 1 \
  'const s=j.skipped_on_host[0]; Object.keys(s).sort().join()+"/"+s.id+"/"+s.requires_host+"/"+s.host_platform+"/"+s.reason+"/"+(typeof s.detail==="string"&&s.detail.includes("5"))' \
  "detail,host_platform,id,reason,requires_host/x-bash32/null/linux/shell_major_mismatch/true"
check "HB1a SC-004: the skipped id is never reported as pass (not in commands) and never ran (marker 0)" 1 'j.commands.length+"/"+"'"$(lines "$HM")"'"' "0/0"
check "HB1b the hint lists the id" 1 'j.hints[0]' "run these ids on the target OS before merge: x-bash32"

newproj hb2; rm -f "$HM"; stub three 'if [ "$1" = "-c" ]; then echo 3; else echo ran >> '"$HM"'; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/three","run.sh"]}]}'; seal
vnode "$P" "$LINUX"
check "HB2 control: probe prints 3 -> the id runs and passes, nothing skipped" 0 'j.commands.map(c=>c.id).join()+"/"+j.skipped_on_host.length+"/"+j.verdict' "x-bash32/0/pass"

newproj hb3; stub weird 'if [ "$1" = "-c" ]; then echo x; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/weird","run.sh"]}]}'; seal
vnode "$P" "$LINUX"
check "HB3 non-numeric probe output: skipped as shell_major_mismatch, detail names the output, never passed" 1 'const s=j.skipped_on_host[0]; s.reason+"/"+s.detail.includes("x")+"/"+j.commands.length' "shell_major_mismatch/true/0"

newproj hb4; stub ok 'exit 0'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/does-not-exist","run.sh"]}]}'; seal
vnode "$P" "$LINUX"
check "HB4 missing binary: skipped as shell_major_mismatch with the error text, exit 1 (all skipped, no spawn_failed), never passed" 1 'const s=j.skipped_on_host[0]; s.reason+"/"+(s.detail.length>0)+"/"+j.commands.length' "shell_major_mismatch/true/0"

newproj hb5; stub slow 'if [ "$1" = "-c" ]; then exec sleep 5; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/slow","run.sh"]}]}'; seal
vnode "$P" '{"platform":"linux","probeTimeoutMs":200}'
check "HB5 probe past the (injected) timeout: skipped as shell_major_mismatch, detail names the timeout, never passed" 1 'const s=j.skipped_on_host[0]; s.reason+"/"+/timed? ?out/i.test(s.detail)+"/"+j.commands.length' "shell_major_mismatch/true/0"

# probe runs once per distinct argv[0]
newproj hb6; rm -f "$BC" "$BC-b"
stub five 'if [ "$1" = "-c" ]; then echo p >> '"$BC"'; echo 5; fi'; stub six 'if [ "$1" = "-c" ]; then echo p >> '"$BC-b"'; echo 5; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/five","a.sh"]},{"id":"y-bash32","argv":["./bin/five","b.sh"]},{"id":"z-bash32","argv":["./bin/six","c.sh"]}]}'; seal
vnode "$P" "$LINUX"
check "HB6 three -bash32 ids, two distinct argv[0]: both skipped" 1 'j.skipped_on_host.map(s=>s.id).join()' "x-bash32,y-bash32,z-bash32"
check "HB6a two ids sharing argv[0] probe it once (counter 1)" 1 '"'"$(lines "$BC")"'"' "1"
check "HB6b a different argv[0] is probed once too (counter 1)" 1 '"'"$(lines "$BC-b")"'"' "1"

# non-empty requires_host: no probe; empty array: probed
newproj hb7; rm -f "$BC" "$HM"; stub five 'if [ "$1" = "-c" ]; then echo p >> '"$BC"'; echo 5; else echo ran >> '"$HM"'; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/five","a.sh"],"requires_host":["linux"]}]}'; seal
vnode "$P" "$LINUX"
check "HB7 -bash32 id with a non-empty requires_host is not probed (counter 0) and runs on a matching host" 0 '"'"$(lines "$BC")"'"+"/"+j.commands.map(c=>c.id).join()+"/"+j.skipped_on_host.length' "0/x-bash32/0"
newproj hb7b; rm -f "$BC" "$HM"; stub five 'if [ "$1" = "-c" ]; then echo p >> '"$BC"'; echo 5; else echo ran >> '"$HM"'; fi'
cfg '{"commands":[{"id":"x-bash32","argv":["./bin/five","a.sh"],"requires_host":[]}]}'; seal
vnode "$P" "$LINUX"
check "HB7b empty requires_host on a -bash32 id: probed (counter 1) and skipped" 1 '"'"$(lines "$BC")"'"+"/"+j.skipped_on_host.map(s=>s.reason).join()' "1/shell_major_mismatch"
newproj hb7c; rm -f "$BC"; stub five 'if [ "$1" = "-c" ]; then echo p >> '"$BC"'; echo 5; fi'; stub ok 'exit 0'
cfg '{"commands":[{"id":"plain","argv":["./bin/five","a.sh"]}]}'; seal
vnode "$P" "$LINUX"
check "HB7c an id without the -bash32 suffix is never probed (counter 0)" 0 '"'"$(lines "$BC")"'"' "0"

# ---- FR-003 host record ----
newproj hr1; stub ok 'exit 0'; cfg '{"commands":[{"id":"a","argv":["./bin/ok"]}]}'; seal
vrun "$P"
check "HR1 verify run record carries host {platform, arch, node} and nothing else, matching this machine" 0 \
  'const os=require("os"); Object.keys(j.host).sort().join()+"/"+(j.host.platform===os.platform())+"/"+(j.host.arch===os.arch())+"/"+(j.host.node===process.version)' "arch,node,platform/true/true/true"
check "HR1a no hostname anywhere in the record (key or value)" 0 \
  'const os=require("os"); const s=JSON.stringify(j); (!/hostname/i.test(s))+"/"+(os.hostname().length<4||!s.includes(os.hostname()))' "true/true"
check "HR1b skipped_on_host is an empty array when nothing was skipped; hints absent" 0 'Array.isArray(j.skipped_on_host)+"/"+j.skipped_on_host.length+"/"+(j.hints===undefined)' "true/0/true"
VF="$P/.a1/VERIFICATION.md"
printf -- '---\nverdict: PASS\n---\n' > "$VF"
vrun "$P" --out "$VF"
vcheck "$VF"
check_rc "HR2 a VERIFICATION.md written with the new fields (host, skipped_on_host) is accepted by verify check: exit 0" 0

# back-compat: a record written before this feature (no host, no skipped_on_host, no env_red) stays valid and is never rewritten
newproj bc1; stub ok 'exit 0'; cfg '{"commands":[{"id":"a","argv":["./bin/ok"]}]}'; seal
BC_HEAD="$(g "$P" rev-parse HEAD)"
printf -- '---\nverdict: PASS\nverify_run: {"verdict":"pass","reason":null,"reasons":[],"no_tests_reason":null,"source":"verify.json","head_sha":"%s","base_sha":"%s","touches_source":false,"changed_files":1,"flaky":[],"pre_existing_red":[],"cache":{"head":"miss","base":"none"},"commands":[{"id":"a","argv":["./bin/ok"],"exit_code":0,"signal":null,"timed_out":false,"reason":null}],"duration_ms":{"head":28,"base":null,"total":39}}\n---\n' "$BC_HEAD" "$BC_HEAD" > "$P/.a1/VERIFICATION.md"
BC_BEFORE="$(cksum < "$P/.a1/VERIFICATION.md")"
vcheck "$P/.a1/VERIFICATION.md"
check_rc "BC1 control: a pre-028 verify_run record (no host, no skipped_on_host, no env_red) is accepted by verify check" 0
if [[ "$(cksum < "$P/.a1/VERIFICATION.md")" == "$BC_BEFORE" ]]; then ok "BC2 the old record was not rewritten (checksum before/after)"; else bad "BC2 the old record was rewritten"; fi
