# Sourced by run-tests.sh (spec 028 FR-005, FR-006, FR-009 and the all-skipped hint, wave 4). Uses the suite helpers and vnode/LINUX/DARWIN from cases-host.sh.
# Not named run*.sh on purpose: .a1/verify.json expands `each: _test-fixtures/*/run*.sh`.
#
# RED-proof (wave report, 2026-11-14): run once against `git archive fa73852`; every ER/FC/AS case below fails there except the controls
# (ER1b, ER1c, ER3f, FC2, AS2 and the ones labelled control), which pin behaviour that must not change.

ERCFG() { # <entries json> [extra commands json]
  cfg '{"commands":[{"id":"unit","argv":["./bin/unit"]},{"id":"fine","argv":["./bin/ok"]}],"env_red":'"$1"'}'
}
ENVR_LINUX='[{"id":"unit","host":"linux","reason":"needs a docker socket"}]'

# ---- FR-005 without --base ----
newproj er1; stub unit 'exit 1'; stub ok 'exit 0'; ERCFG "$ENVR_LINUX"; seal
vnode "$P" "$LINUX"
check "ER1 listed red id on a matching host: verdict pass (exit 0), the red result stays in commands[], env_red names it with the recorded reason and the result reason" 0 \
  'j.verdict+"/"+j.commands.map(c=>c.id+":"+c.reason).join()+"/"+JSON.stringify(j.env_red)' \
  'pass/unit:command_failed,fine:null/[{"id":"unit","reason":"needs a docker socket","result_reason":"command_failed"}]'
check "ER1a verdict reasons do not list the excused cause" 0 'j.reasons.length+"/"+j.reason' "0/null"
vnode "$P" "$DARWIN"
check "ER1b control: the same config on a darwin host (entry host linux): no effect, verdict fail, no env_red key" 1 'j.verdict+"/"+j.reason+"/"+(j.env_red===undefined)' "fail/command_failed/true"
newproj er1c; stub unit 'exit 1'; stub ok 'exit 0'; ERCFG '[{"id":"fine","host":"linux","reason":"x"}]'; seal
vnode "$P" "$LINUX"
check "ER1c control: the entry names another id; the red unit still fails the verdict" 1 'j.verdict+"/"+j.reason+"/"+(j.env_red===undefined)' "fail/command_failed/true"
newproj er1d; stub unit 'exit 1'; stub ok 'exit 0'; ERCFG '[{"id":"unit","host":"linux","reason":"a recorded reason that differs from the real failure"}]'; seal
vnode "$P" "$LINUX"
check "ER1d reason text is informational only (A-011): a different failure cause is still env_red" 0 'j.verdict+"/"+j.env_red[0].result_reason' "pass/command_failed"
newproj er1e; mkdir -p "$P/t/a"; printf 'exit 1\n' > "$P/t/a/run.sh"; stub ok 'exit 0'
cfg '{"each":"t/*/run.sh","argv_prefix":["bash"],"commands":[{"id":"fine","argv":["./bin/ok"]}],"env_red":[{"id":"t/a/run.sh","host":"linux","reason":"env"}]}'; seal
vnode "$P" "$LINUX"
check "ER1e an each suite is listed by its repo-relative file path" 0 'j.verdict+"/"+j.env_red[0].id' "pass/t/a/run.sh"

# ---- FR-006 stale and bad_config ----
newproj er2; stub unit 'exit 0'; stub ok 'exit 0'; ERCFG "$ENVR_LINUX"; seal
vnode "$P" "$LINUX"
check "ER2 listed id green on a matching host: warning env_red_stale with the fix hint, exit 0" 0 \
  'j.verdict+"/"+JSON.stringify(j.warnings)+"/"+(j.env_red===undefined)' \
  'pass/[{"reason":"env_red_stale","id":"unit","hint":"remove the entry from .a1/verify.json"}]/true'
newproj er2b; stub unit 'exit 0'; stub ok 'exit 0'; ERCFG '[{"id":"gone","host":"linux","reason":"x"}]'; seal
vnode "$P" "$LINUX"
check "ER2b listed id that matches no command: the same warning, exit 0" 0 'j.verdict+"/"+j.warnings.map(w=>w.reason+":"+w.id).join()' "pass/env_red_stale:gone"
vnode "$P" "$DARWIN"
check "ER2c an entry for another host is not judged stale on this host (no effect)" 0 'j.verdict+"/"+(j.warnings===undefined)' "pass/true"
newproj er2d; stub unit 'exit 1'; stub ok 'exit 0'; ERCFG "$ENVR_LINUX"; seal
vnode "$P" "$LINUX"
check "ER2d a red listed id is not stale (no warnings key)" 0 '(j.warnings===undefined)+""' "true"

bad_env() { # <label> <entries json>
  newproj "er3$1"; stub unit 'exit 0'; stub ok 'exit 0'; ERCFG "$2"; seal
  vrun "$P"
}
bad_env a '[{"host":"linux","reason":"x"}]'
check "ER3a missing id: exit 2 bad_config, message names env_red and the file" 2 'j.error+"/"+(j.message.includes("env_red")&&j.message.includes(".a1/verify.json"))' "bad_config/true"
bad_env b '[{"id":"unit","reason":"x"}]'
check_rc "ER3b missing host: exit 2" 2
bad_env c '[{"id":"unit","host":"linux","reason":""}]'
check "ER3c empty reason: exit 2 bad_config" 2 'j.error' "bad_config"
bad_env d '[{"id":"unit","host":"linux","reason":"x"},{"id":"unit","host":"linux","reason":"y"}]'
check "ER3d duplicate {id, host} pair: exit 2 bad_config" 2 'j.error' "bad_config"
bad_env e '"linux"'
check "ER3e env_red that is not an array: exit 2 bad_config" 2 'j.error' "bad_config"
bad_env f '[{"id":"unit","host":"linux","reason":"x"},{"id":"unit","host":"darwin","reason":"y"}]'
check "ER3f control: the same id for two different hosts is not a duplicate" 0 'j.verdict' "pass"

# ---- FR-005 with --base ----
newproj er5; stub unit 'exit 1'; stub ok 'exit 0'; ERCFG "$ENVR_LINUX"; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "head change"
vnode "$P" "$LINUX" main
check "ER5 --base: a listed id red on base AND head: verdict pass, named under env_red" 0 'j.verdict+"/"+j.env_red.map(e=>e.id).join()+"/"+j.commands[0].reason' "pass/unit/null"
newproj er5b; stub unit 'exit 0'; stub ok 'exit 0'; ERCFG "$ENVR_LINUX"; seal
stub unit 'exit 1'; g "$P" add -A; g "$P" commit -q -m "break unit on head"
vnode "$P" "$LINUX" main
check "ER5b --base: a listed id red on head but green on base stays red (regression never masked), not under env_red" 1 'j.verdict+"/"+j.reason+"/"+(j.env_red===undefined)' "fail/command_failed/true"
newproj er5c; stub unit 'exit 0'; stub ok 'exit 0'; ERCFG "$ENVR_LINUX"; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "head change"
vnode "$P" "$LINUX" main
check "ER5c --base: a listed id green on both sides is stale" 0 'j.warnings.map(w=>w.reason+":"+w.id).join()' "env_red_stale:unit"

# ---- FR-005: entry change stays guarded ----
newproj er6; stub unit 'exit 1'; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/unit"]},{"id":"fine","argv":["./bin/ok"]}]}'; seal
ERCFG "$ENVR_LINUX"; g "$P" commit -q -am "add env_red"
vnode "$P" "$LINUX" main
check "ER6 adding an env_red entry on the branch is a verify.json change: verify_config_changed (field env_red), the base's own config judges the run (red unit, no excuse)" 1 \
  'j.reason+"/"+j.config_changed.fields.join()+"/"+(j.env_red===undefined)' "verify_config_changed/env_red/true"

# ---- FR-009 verify_config_first ----
newproj fc1; stub ok 'exit 0'; seal
cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; g "$P" add -A; g "$P" commit -q -m "first config"
vrun "$P" --base main
check "FC1 base has no .a1/verify.json, head adds it: reason verify_config_first (not verify_config_changed), config_changed carries the disposition hint" 1 \
  'j.reason+"/"+j.reasons.includes("verify_config_changed")+"/"+j.config_changed.hint+"/"+j.config_changed.dispositioned' \
  "verify_config_first/false/commit an upheld config_change disposition for config_changed.fingerprint (05-merge.md 5.3)/false"
FC_FP="$(js 'j.config_changed.fingerprint')"
newproj fc2; stub ok 'exit 0'; cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; seal
cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]},{"id":"two","argv":["./bin/ok"]}]}'; g "$P" commit -q -am "change config"
vrun "$P" --base main
check "FC2 control: a later change of an existing verify.json keeps verify_config_changed and carries no hint" 1 'j.reason+"/"+(j.config_changed.hint===undefined)' "verify_config_changed/true"
newproj fc3; stub ok 'exit 0'; seal
cfg '{"commands":[{"id":"unit","argv":["./bin/ok"]}]}'; g "$P" add -A; g "$P" commit -q -m "first config"
vrun "$P" --base main
check "FC3 the fingerprint of the first config matches the one the disposition route needs (same content, same fingerprint as FC1)" 1 'j.config_changed.fingerprint' "$FC_FP"
mkdir -p "$P/.a1"
(cd "$P" && node "$TOOLS" disposition add --kind config_change --fingerprint "$FC_FP" --reason "fixture: first config reviewed" --by fx >/dev/null 2>&1)
g "$P" add -A; g "$P" commit -q -m "disposition"
(cd "$P" && node "$TOOLS" disposition review "$FC_FP" --verdict upheld --reason "fixture: ok" --by reviewer >/dev/null 2>&1)
g "$P" add -A; g "$P" commit -q -m "review"
vrun "$P" --base main
check "FC3b once the disposition is committed and upheld the guard clears (the fingerprint and clearing are unchanged)" 0 'j.verdict+"/"+j.config_changed.dispositioned' "pass/true"

# ---- review round M1: --base requested but the merge-base has no plan: env_red excuses nothing ----
newproj er7; stub unit 'exit 1'; stub ok 'exit 0'; seal
ERCFG "$ENVR_LINUX"; g "$P" add -A; g "$P" commit -q -m "head adds verify.json with a failing command and its env_red entry"
vnode "$P" "$LINUX" main
check "ER7 --base with no plan on the merge-base (verify_config_first): the failing command is NOT excused: verdict fail, command_failed kept in reasons, env_red empty" 1 \
  'j.verdict+"/"+j.reasons.includes("command_failed")+"/"+j.reasons.includes("verify_config_first")+"/"+(j.env_red===undefined)' "fail/true/true/true"

# ---- review round M2: every command skipped on this host (nothing ran): fail ----
newproj as1; stub mac 'exit 1'
cfg '{"commands":[{"id":"mac","argv":["./bin/mac"],"requires_host":["darwin"]}]}'; seal
vnode "$P" "$LINUX"
check "AS1 every commands[] entry skipped on this host and nothing ran: verdict fail, reason all_commands_skipped_on_host (exit 1), hints carries the all-skipped hint" 1 \
  'j.verdict+"/"+j.reason+"/"+j.commands.length+"/"+j.hints.some(h=>h.startsWith("all_commands_skipped_on_host"))' "fail/all_commands_skipped_on_host/0/true"
newproj as1b; stub mac 'exit 1'
cfg '{"commands":[{"id":"mac","argv":["./bin/mac"],"requires_host":["darwin"]}]}'; seal
printf 'module.exports = 2;\n' > "$P/src/app.js"; g "$P" commit -q -am "head change"
vnode "$P" "$LINUX" main
check "AS1b the same with --base: verdict fail, reason all_commands_skipped_on_host" 1 'j.verdict+"/"+j.reason' "fail/all_commands_skipped_on_host"
newproj as2; stub mac 'exit 1'; stub ok 'exit 0'
cfg '{"commands":[{"id":"mac","argv":["./bin/mac"],"requires_host":["darwin"]},{"id":"fine","argv":["./bin/ok"]}]}'; seal
vnode "$P" "$LINUX"
check "AS2 control: one command still runs (partial skip stays warn-only, A-003): verdict pass, no all_commands_skipped_on_host hint" 0 'j.verdict+"/"+j.hints.some(h=>h.startsWith("all_commands_skipped_on_host"))' "pass/false"
