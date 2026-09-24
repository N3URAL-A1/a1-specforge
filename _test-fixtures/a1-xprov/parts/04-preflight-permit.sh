#!/usr/bin/env bash
# Part 04 — Wave 4: preflight, init-home, permit-check/permit, observe.
# Sourced by run-tests.sh (never run on its own). Cases from the wave plan's
# Wave 4 fixture table (R14, R21, R25, R26) plus the two checks a1-samuel-security
# made mandatory after the 2026-09-24 capture runs (Codex auto-installed two
# remote plugins into the dedicated home although config.toml had no
# [plugins.*] table): S1 plugins cache must be empty, S2 the newest session log
# may only show exec-class tools. Every case names the single production change
# that turns it red.
#
# RED run (2026-09-24, before the modules existed): every arm below failed with
# the facade's `xprov <sub>: not implemented yet (planned wave 4)` on exit 2.
#
# Measured facts frozen here as literals (never imported from the module):
#  - `codex features list` (0.155.1, temp CODEX_HOME) lists `plugins` and
#    `remote_plugin` as stable+true; `codex features disable <f>` writes
#    `[features]\n<f> = false` into config.toml. That is the switch init-home
#    writes and preflight demands (check `remote_plugin_switch`).
#  - `codex plugin marketplace list` in a fresh home prints "No plugin
#    marketplaces in scope": `openai-curated-remote` is NOT a configured
#    marketplace, so `marketplace remove` cannot be the primary control.
#  - Session logs: tool calls are `response_item` records whose payload.type
#    ends in `_call` and carries `name` (`custom_tool_call` / `exec` measured);
#    a `CommandExecution` event embeds file names inside `command`, so a naive
#    grep for `"name"` reports `add.js` as a tool — S2 has that decoy.
#  - Plugin cache shape: plugins/cache/<marketplace>/<plugin>/<version>/ plus
#    plugins/.remote-plugin-install-staging/.

# The exact file init-home writes into a fresh home — byte-identical to the real
# ~/.codex-a1-review/config.toml after `codex features disable plugins` and
# `… remote_plugin` (2026-09-24). Frozen literal, compared byte-for-byte in R14e.
COMPLIANT_CONFIG_W4='# a1-specforge — dedicated Codex home for cross-provider REVIEW runs only.
# Created 2026-09-24 (analysis finding F-049, spec 009-cross-provider-review-gate).
# Invariants: read-only sandbox, on-request approvals, NO MCP servers, NO plugins.
# The claudex-loop runner overrides approval_policy per call; the sandbox and the
# absence of MCP servers are what this file guarantees.
sandbox_mode = "read-only"
approval_policy = "on-request"

[features]
plugins = false
remote_plugin = false'

EXPECTED_PREFLIGHT_CHECKS="codex_home_is_global home_exists config_exists config_is_symlink home_mode_0700 sandbox_read_only mcp_servers_absent plugins_disabled remote_plugin_switch unexpected_config_key plugins_cache_empty session_tools_exec_only auth_present runner_pin python_version codex_cli"

# make_home_w4 — alias of the harness make_home (whose COMPLIANT_CONFIG carries
# the [features] switch since the Wave 4 measurement). Kept so no arm breaks.
make_home_w4() { make_home; }

# make_fake_global_home — a temp HOME holding .codex/ (with auth.json) so the
# global-home check has something real to realpath against. Sets FAKE_HOME.
make_fake_global_home() {
  FAKE_HOME="$(mktemp -d)"
  mkdir -p "$FAKE_HOME/.codex"
  printf '{"fixture":true}\n' > "$FAKE_HOME/.codex/auth.json"
  chmod 600 "$FAKE_HOME/.codex/auth.json"
}

# xprov_w4 <sub> [args…] — runs the TREE copy's a1-tools xprov <sub> with the
# fake HOME and the given XHOME; stdout → W4_OUT, stderr → W4_ERR, exit → W4_RC.
xprov_w4() {
  local errf; errf="$(mktemp)"
  W4_OUT="$(HOME="$FAKE_HOME" A1_XPROV_CODEX_HOME="$XHOME" node "$TREE_TOOLS" xprov "$@" 2>"$errf")"; W4_RC=$?
  W4_ERR="$(cat "$errf")"; rm -f "$errf"
}

# check_result <json> <check-name> — prints the check's result string.
check_result() {
  node -e "
    let j; try { j = JSON.parse(process.argv[1]); } catch (e) { process.stdout.write('UNPARSEABLE'); process.exit(0); }
    const c = (j.checks || []).find((x) => x.name === process.argv[2]);
    process.stdout.write(c ? c.result + '|' + String(c.measured) : 'ABSENT');
  " "$1" "$2"
}

# ---------- R14: preflight refuses MCP tables, the global home; passes a compliant home ----------
# Red-making change: checking only `enabled = true` tables (R14a), or
# comparing home paths as strings instead of realpaths (R14b).
caseR14() {
  make_tree; make_fake_global_home

  # R14a — [mcp_servers.x] with enabled = false is still a FAIL naming the table
  make_home_w4
  printf '\n[mcp_servers.x]\nenabled = false\n' >> "$XHOME/config.toml"
  xprov_w4 preflight
  assert_rc "R14a preflight exits 1 on [mcp_servers.x] + enabled = false" 1 "$W4_RC" "$W4_ERR"
  assert_eq "R14a mcp_servers_absent check FAILs naming the table" "$(check_result "$W4_OUT" mcp_servers_absent)" "FAIL|table [mcp_servers.x]"
  assert_json "R14a stdout summary carries the AC line" "$W4_OUT" "(j.summary||[]).includes('mcp_servers_absent: FAIL (table [mcp_servers.x])')" "true"
  assert_json "R14a preflight lists every check even after a failure" "$W4_OUT" "(j.checks||[]).map(c=>c.name).join(' ')" "$EXPECTED_PREFLIGHT_CHECKS"

  # R14b — a symlink to ~/.codex resolves to the global home → exit 1 (realpath, not string)
  ln -s "$FAKE_HOME/.codex" "$FAKE_HOME/review-link"
  XHOME="$FAKE_HOME/review-link"
  xprov_w4 preflight
  assert_rc "R14b preflight exits 1 when the home is a symlink to ~/.codex" 1 "$W4_RC" "$W4_ERR"
  assert_eq "R14b codex_home_is_global FAILs (realpath comparison)" "$(check_result "$W4_OUT" codex_home_is_global | cut -d'|' -f1)" "FAIL"

  # R14c — compliant 0700 home, fake codex, TREE runner pin → exit 0, all checks listed
  make_home_w4
  ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  xprov_w4 preflight
  assert_rc "R14c preflight exits 0 on the compliant home" 0 "$W4_RC" "$W4_ERR"
  assert_json "R14c every check is listed with a result" "$W4_OUT" "(j.checks||[]).map(c=>c.name).join(' ')" "$EXPECTED_PREFLIGHT_CHECKS"
  assert_json "R14c no check FAILs and ok is true" "$W4_OUT" "j.ok === true && (j.checks||[]).filter(c=>c.result==='FAIL').length" "0"
  assert_eq "R14c codex_cli records the measured version string" "$(check_result "$W4_OUT" codex_cli)" "PASS|$EXPECTED_CLI_VERSION"
  assert_eq "R14c session_tools_exec_only is SKIP (no session), not a pass claim" "$(check_result "$W4_OUT" session_tools_exec_only)" "SKIP|no session"
  assert_json "R14c remote_plugin_switch PASSes with both features off" "$W4_OUT" "(j.checks.find(c=>c.name==='remote_plugin_switch')||{}).result" "PASS"

  # R14d — init-home on the compliant home: no write, {changed:false}, bytes identical
  local before after; before="$(sha256_of "$XHOME/config.toml")"
  xprov_w4 init-home
  after="$(sha256_of "$XHOME/config.toml")"
  assert_rc "R14d init-home exits 0 on a compliant home" 0 "$W4_RC" "$W4_ERR"
  assert_json "R14d init-home reports changed:false" "$W4_OUT" "j.changed" "false"
  assert_eq "R14d config.toml bytes unchanged" "$after" "$before"

  # R14e — init-home on a missing dir creates 0700 + the frozen config + auth symlink; preflight then passes
  XHOME="$(mktemp -d)/fresh-home"
  xprov_w4 init-home
  assert_rc "R14e init-home exits 0 creating a fresh home" 0 "$W4_RC" "$W4_ERR"
  assert_json "R14e init-home reports changed:true" "$W4_OUT" "j.changed" "true"
  local mode; mode="$(stat -f '%Lp' "$XHOME" 2>/dev/null || stat -c '%a' "$XHOME")"
  assert_eq "R14e fresh home is 0700" "$mode" "700"
  assert_eq "R14e config.toml is byte-identical to the frozen compliant file" "$(cat "$XHOME/config.toml")" "$COMPLIANT_CONFIG_W4"
  [[ -L "$XHOME/auth.json" && "$(readlink "$XHOME/auth.json")" == "$FAKE_HOME/.codex/auth.json" ]] \
    && ok "R14e auth.json is a symlink to ~/.codex/auth.json" || bad "R14e auth.json symlink missing or wrong target"
  assert_json "R14e target mode is reported, not changed" "$W4_OUT" "j.auth && j.auth.target_mode" "600"
  xprov_w4 preflight
  assert_rc "R14e preflight passes on the home init-home just built" 0 "$W4_RC" "$W4_ERR"

  # R14f — init-home never overwrites a human's non-compliant file
  make_home_w4
  printf '\n[mcp_servers.node_repl]\nenabled = false\n' >> "$XHOME/config.toml"
  before="$(sha256_of "$XHOME/config.toml")"
  xprov_w4 init-home
  after="$(sha256_of "$XHOME/config.toml")"
  assert_rc "R14f init-home exits 1 on a non-compliant existing home" 1 "$W4_RC"
  assert_eq "R14f non-compliant config.toml bytes untouched" "$after" "$before"
  assert_json "R14f the failing check is named" "$W4_OUT" "(j.failed||[]).includes('mcp_servers_absent')" "true"

  # R14g — init-home refuses to initialise the global home itself
  XHOME="$FAKE_HOME/.codex"
  xprov_w4 init-home
  assert_rc "R14g init-home exits 1 when the target is ~/.codex" 1 "$W4_RC"

  # R14h — a features table with plugins = true fails remote_plugin_switch
  make_home
  printf '\n[features]\nplugins = true\nremote_plugin = false\n' >> "$XHOME/config.toml"
  ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  xprov_w4 preflight
  assert_rc "R14h preflight exits 1 when features.plugins = true" 1 "$W4_RC"
  assert_eq "R14h remote_plugin_switch FAILs" "$(check_result "$W4_OUT" remote_plugin_switch | cut -d'|' -f1)" "FAIL"

  # R14i — unreadable SHA256SUMS is a runner_pin FAIL, not a skip
  make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  local saved; saved="$(mktemp -d)"; mv "$TREE_VENDOR/SHA256SUMS" "$saved/"
  xprov_w4 preflight
  mv "$saved/SHA256SUMS" "$TREE_VENDOR/SHA256SUMS"
  assert_rc "R14i preflight exits 1 without SHA256SUMS" 1 "$W4_RC"
  assert_eq "R14i runner_pin FAILs with sums_unreadable" "$(check_result "$W4_OUT" runner_pin)" "FAIL|sums_unreadable"

  # R14j (Samuel) — config.toml as a symlink to a compliant file is a FAIL
  # (lstat, not stat): a link onto ~/.codex/config.toml would pass later global
  # changes through. Red-making change: stat/existsSync instead of lstat.
  make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  mv "$XHOME/config.toml" "$XHOME/real.toml"; ln -s "$XHOME/real.toml" "$XHOME/config.toml"
  xprov_w4 preflight
  assert_rc "R14j preflight exits 1 when config.toml is a symlink" 1 "$W4_RC"
  assert_eq "R14j config_is_symlink FAILs naming the target" "$(check_result "$W4_OUT" config_is_symlink)" "FAIL|symlink -> $XHOME/real.toml"
  xprov_w4 init-home
  assert_rc "R14j init-home exits 1 on a symlinked config" 1 "$W4_RC"
  assert_json "R14j init-home names config_is_symlink and leaves the link alone" "$W4_OUT" "(j.failed||[]).includes('config_is_symlink')" "true"
  [[ -L "$XHOME/config.toml" ]] && ok "R14j the symlink is still there (nothing rewritten)" || bad "R14j init-home replaced the symlink"
}

# ---------- S1 (Samuel): plugin dirs in the dedicated home fail preflight, are named, never deleted ----------
# Red-making change: skipping the plugins/cache walk, or allowlisting by default.
caseS1() {
  make_tree; make_fake_global_home
  make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  mkdir -p "$XHOME/plugins/cache/x/1.0" "$XHOME/plugins/.remote-plugin-install-staging"
  xprov_w4 preflight
  assert_rc "S1a preflight exits 1 with a plugin dir in the cache" 1 "$W4_RC"
  assert_eq "S1a plugins_cache_empty FAILs naming plugin dir and staging dir" \
    "$(check_result "$W4_OUT" plugins_cache_empty)" "FAIL|.remote-plugin-install-staging, x/1.0"
  [[ -d "$XHOME/plugins/cache/x/1.0" ]] && ok "S1b preflight never deletes a plugin dir" || bad "S1b plugin dir was removed"

  # allowlisted plugin passes; staging dir still fails
  rmdir "$XHOME/plugins/.remote-plugin-install-staging"
  xprov_w4 preflight --allow-plugins x/1.0
  assert_eq "S1c an allowlisted plugin dir PASSes" "$(check_result "$W4_OUT" plugins_cache_empty)" "PASS|allowlisted: x/1.0"

  # init-home --prune-marketplaces with the fake codex (no marketplace subcommand): reports, never deletes
  xprov_w4 init-home --prune-marketplaces
  assert_json "S1d prune is not attempted when codex lacks the subcommand" "$W4_OUT" "j.pruned && j.pruned.attempted" "false"
  assert_json "S1d init-home reports the plugin dirs it found" "$W4_OUT" "(j.plugins_found||[]).join(',')" "x/1.0"
  [[ -d "$XHOME/plugins/cache/x/1.0" ]] && ok "S1e init-home never deletes a plugin dir" || bad "S1e plugin dir was removed by init-home"
}

# ---------- S2 (Samuel): newest session log may only show exec-class tools ----------
# Red-making change: allowing any tool name, or reading an older session
# instead of the newest one. The exec shape below is copied from a measured
# rollout (2026-09-24T17-32-51); the `node_repl` arm uses the Responses
# `function_call` item shape — no MCP tool call has been captured yet, so the
# check must flag ANY `*_call` name outside exec/shell/local_shell, whatever
# the exact item type. The CommandExecution decoy carries a file name in
# `"name"` position inside `command`, which a naive grep reports as a tool.
caseS2() {
  make_tree; make_fake_global_home
  make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  local sdir="$XHOME/sessions/2026/09/24"; mkdir -p "$sdir"
  local exec_line='{"timestamp":"2026-09-24T15:32:58.020Z","ordinal":12,"type":"response_item","payload":{"type":"custom_tool_call","id":"ctc_1","status":"completed","call_id":"call_1","name":"exec","input":"text(await tools.exec_command({cmd:\"nl -ba src/add.js\"}));"}}'
  local decoy_line='{"timestamp":"2026-09-24T15:33:05.219Z","ordinal":20,"type":"event_msg","payload":{"type":"item_completed","item":{"type":"CommandExecution","id":"exec-1","command":["/bin/zsh","-lc","nl -ba src/add.js"],"cwd":"file:///tmp/x","name":"add.js"}}}'
  local repl_line='{"timestamp":"2026-09-24T15:33:06.000Z","ordinal":21,"type":"response_item","payload":{"type":"function_call","id":"fc_1","status":"completed","call_id":"call_2","name":"node_repl","arguments":"{\"code\":\"1+1\"}"}}'

  printf '%s\n%s\n' "$exec_line" "$decoy_line" > "$sdir/rollout-2026-09-24T17-32-51-old.jsonl"
  touch -t 202609241700 "$sdir/rollout-2026-09-24T17-32-51-old.jsonl"
  xprov_w4 preflight
  assert_rc "S2a exec-only session passes preflight" 0 "$W4_RC" "$W4_ERR"
  assert_eq "S2a session_tools_exec_only PASSes naming the measured tool set" \
    "$(check_result "$W4_OUT" session_tools_exec_only)" "PASS|tools: exec"

  printf '%s\n%s\n%s\n' "$exec_line" "$decoy_line" "$repl_line" > "$sdir/rollout-2026-09-24T17-40-00-new.jsonl"
  touch -t 202609241800 "$sdir/rollout-2026-09-24T17-40-00-new.jsonl"
  xprov_w4 preflight
  assert_rc "S2b newest session with node_repl fails preflight" 1 "$W4_RC"
  assert_eq "S2b session_tools_exec_only FAILs naming node_repl (and only tools, not the add.js decoy)" \
    "$(check_result "$W4_OUT" session_tools_exec_only)" "FAIL|disallowed: node_repl"
}

# ---------- R21: permission record — default deny, permit is the only writer ----------
# Red-making change: defaulting an absent .a1/xprov.json to `allowed`.
caseR21() {
  make_tree; make_phase r21-phase
  local out err rc errf; errf="$(mktemp)"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit-check 2>"$errf")"; rc=$?; err="$(cat "$errf")"; rm -f "$errf"
  assert_rc "R21a permit-check exits 1 without .a1/xprov.json" 1 "$rc"
  assert_json "R21a reason is external_review_not_permitted" "$out" "j.reason" "external_review_not_permitted"
  [[ "$err" == *a1-ludwig-legal* ]] && ok "R21a stderr names a1-ludwig-legal for customer repos" || bad "R21a stderr lacks a1-ludwig-legal: $err"

  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --by robert --record project/a1-specforge/record/2026-09-24-xprov.md 2>&1)"; rc=$?
  assert_rc "R21b permit writes the record" 0 "$rc" "$out"
  local rec; rec="$(cat "$PHASE_REPO/.a1/xprov.json" 2>/dev/null)"
  assert_json "R21b record holds external_review: allowed, decided_by, record" "$rec" \
    "[j.external_review, j.decided_by, j.record].join(' ')" "allowed robert project/a1-specforge/record/2026-09-24-xprov.md"
  assert_json "R21b decided_on is an ISO date" "$rec" "/^\d{4}-\d{2}-\d{2}$/.test(j.decided_on)" "true"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit-check 2>/dev/null)"; rc=$?
  assert_rc "R21c permit-check exits 0 after permit" 0 "$rc"

  printf '{"external_review":"denied","decided_by":"robert","decided_on":"2026-09-24","record":"record/x.md"}\n' > "$PHASE_REPO/.a1/xprov.json"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit-check 2>/dev/null)"; rc=$?
  assert_rc "R21d external_review: denied exits 1" 1 "$rc"
  assert_json "R21d reason is external_review_not_permitted" "$out" "j.reason" "external_review_not_permitted"

  printf '{not json\n' > "$PHASE_REPO/.a1/xprov.json"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit-check 2>/dev/null)"; rc=$?
  assert_rc "R21e unparseable record exits 1" 1 "$rc"

  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --by robert --record ../../etc/passwd 2>&1)"; rc=$?
  assert_rc "R21f permit refuses a record path outside record/ or project/" 2 "$rc"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov permit --record record/x.md 2>&1)"; rc=$?
  assert_rc "R21g permit without --by is a usage error" 2 "$rc"

  # R21h (Samuel) — --repo must be the git toplevel; a subdirectory or a
  # non-repo dir is a usage error, never a silent fallback. Red-making change:
  # `path.resolve(flags.repo)` without the rev-parse comparison.
  out="$(node "$TREE_TOOLS" xprov permit-check --repo "$PHASE_REPO/src" 2>&1)"; rc=$?
  assert_rc "R21h permit-check --repo <subdir> is a usage error" 2 "$rc" "$out"
  [[ "$out" == *"git toplevel"* ]] && ok "R21h the message names the toplevel" || bad "R21h message: $out"
  local nogit; nogit="$(mktemp -d)"
  out="$(node "$TREE_TOOLS" xprov permit --repo "$nogit" --by robert --record record/x.md 2>&1)"; rc=$?
  assert_rc "R21h permit --repo <non-repo> is a usage error" 2 "$rc" "$out"
  [[ ! -e "$nogit/.a1/xprov.json" ]] && ok "R21h nothing was written into the non-repo dir" || bad "R21h permit wrote into a non-repo dir"
  out="$(node "$TREE_TOOLS" xprov permit-check --repo "$PHASE_REPO" 2>/dev/null)"; rc=$?
  assert_rc "R21h permit-check --repo <toplevel> works" 1 "$rc"
}

# ---------- R25: observe accepts xprov-codex and full a1 names only ----------
# Red-making change: accepting any non-`a1-*` agent, or accepting `a1-<first>`.
caseR25() {
  make_tree; make_phase r25-phase
  local obs="$PHASE_DIR/observations.jsonl" out rc
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent xprov-codex --skill a1-plan --phase r25-phase --type gap --severity major --msg "Wave 2 writes the migration but nothing registers it" --provider codex 2>&1)"; rc=$?
  assert_rc "R25a observe --agent xprov-codex exits 0" 0 "$rc" "$out"
  local line; line="$(tail -n 1 "$obs" 2>/dev/null)"
  assert_json "R25a line carries pattern xprov_finding and agent xprov-codex" "$line" "[j.pattern, j.agent, j.skill, j.phase, String(j.wave), j.type, j.severity].join(' ')" "xprov_finding xprov-codex a1-plan r25-phase null gap major"

  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent a1-victor --skill a1-execute --phase r25-phase --type gap --severity minor --msg x 2>&1)"; rc=$?
  assert_rc "R25b --agent a1-victor (first-name shorthand) exits 1" 1 "$rc"
  [[ "$out" == *"invariant 5"* ]] && ok "R25b rejection names invariant 5" || bad "R25b rejection lacks 'invariant 5': $out"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent codex --skill a1-execute --phase r25-phase --type gap --severity minor --msg x 2>&1)"; rc=$?
  assert_rc "R25c --agent codex (bare provider name) exits 1" 1 "$rc"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent a1-victor-verifier --skill a1-execute --phase r25-phase --wave 2 --type blocker --severity major --msg "wave 2 lacks a test" 2>&1)"; rc=$?
  assert_rc "R25d --agent a1-victor-verifier exits 0" 0 "$rc" "$out"
  assert_eq "R25d exactly two lines were appended (rejections write nothing)" "$(wc -l < "$obs" | tr -d ' ')" "2"
  assert_json "R25d wave is an integer" "$(tail -n 1 "$obs")" "j.wave" "2"

  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent xprov-codex --skill a1-plan --phase ../r25-phase --type gap --severity major --msg x 2>&1)"; rc=$?
  [[ $rc -ne 0 && "$out" == *"--phase must be a plain identifier"* ]] && ok "R25e hostile --phase ../ is refused by the segment guard (named message)" || bad "R25e hostile phase accepted (rc=$rc): $out"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent xprov-codex --skill a1-plan --phase no-such-phase --type gap --severity major --msg x 2>&1)"; rc=$?
  assert_rc "R25f observe refuses a phase dir that does not exist" 1 "$rc"

  grep -q 'xprov-codex' "$REPO_ROOT/_shared/learning-schema.md" && ok "R25g learning-schema.md documents xprov-codex" || bad "R25g learning-schema.md lacks xprov-codex"

  # R25h (Samuel) — --repo must be the git toplevel (see R21h)
  local before; before="$(wc -l < "$obs" | tr -d ' ')"
  out="$(node "$TREE_TOOLS" xprov observe --repo "$PHASE_REPO/src" --agent xprov-codex --skill a1-plan --phase r25-phase --type gap --severity major --msg x 2>&1)"; rc=$?
  assert_rc "R25h observe --repo <subdir> is a usage error" 2 "$rc" "$out"
  assert_eq "R25h nothing appended on the usage error" "$(wc -l < "$obs" | tr -d ' ')" "$before"
  out="$(node "$TREE_TOOLS" xprov observe --repo "$PHASE_REPO" --agent xprov-codex --skill a1-plan --phase r25-phase --type gap --severity major --msg x 2>&1)"; rc=$?
  assert_rc "R25h observe --repo <toplevel> works" 0 "$rc" "$out"
}

# ---------- R26: retro with both gate ids validates; observation carries provider + model fields ----------
# Retro half: no production change beyond R1's registry rows turns it red (the
# case documents the dependency). Observation half red-making change: dropping
# the `provider` field from the writer, or copying model_requested into
# model_observed.
caseR26() {
  make_tree; make_phase r26-phase
  local retro; retro="$(mktemp -d)/retro.md"
  cat > "$retro" <<'EOF'
---
date: 2026-09-24
task: R26 fixture — retro carrying both xprov gate ids
project: a1-specforge
result: pass
issues: []
evidence: fixture
gates_fired:
  - {id: plan-review-xprov, verdict: pass, caught: false}
  - {id: wave-inspect-xprov, verdict: fail, caught: true}
one_line_learning: n/a — fixture.
---
EOF
  local rc
  (cd "$REPO_ROOT" && node "$TOOLS" retro validate "$retro" >/dev/null 2>&1); rc=$?
  assert_rc "R26a retro validate exits 0 with plan-review-xprov and wave-inspect-xprov" 0 "$rc"
  sed -i.bak 's/plan-review-xprov/xprov-review/' "$retro"
  (cd "$REPO_ROOT" && node "$TOOLS" retro validate "$retro" >/dev/null 2>&1); rc=$?
  assert_rc "R26b retro validate exits 1 with the unregistered id xprov-review" 1 "$rc"

  local out; out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent xprov-codex --skill a1-execute --phase r26-phase --wave 1 --type gap --severity minor --msg "finding" 2>&1)"; rc=$?
  assert_rc "R26c observe exits 0 with the default provider" 0 "$rc" "$out"
  local line; line="$(tail -n 1 "$PHASE_DIR/observations.jsonl")"
  assert_json "R26c line carries provider codex, model_requested default literal, model_observed unknown" "$line" \
    "[j.provider, j.model_requested, j.model_observed].join('|')" "codex|CLI default (unresolved)|unknown"
  out="$(cd "$PHASE_REPO" && node "$TREE_TOOLS" xprov observe --agent xprov-codex --skill a1-execute --phase r26-phase --wave 1 --type gap --severity minor --msg "finding" --model-requested gpt-5-codex 2>&1)"; rc=$?
  line="$(tail -n 1 "$PHASE_DIR/observations.jsonl")"
  assert_json "R26d model_observed stays unknown when only --model-requested is given (never copied)" "$line" \
    "[j.model_requested, j.model_observed].join('|')" "gpt-5-codex|unknown"
}

# ---------- R14x (Samuel, Waves 3+4 review): config variants Codex loads that a denylist misses ----------
# Every arm appends one shape to the real compliant config; each must FAIL
# `unexpected_config_key` naming the key, the MCP shapes additionally
# `mcp_servers_absent`. Red-making change: disabling the allowlist
# (`const unexpected = []`), or matching MCP only on `[mcp_servers.` headers.
caseR14x() {
  make_tree; make_fake_global_home
  local variant
  # <label>|<toml appended>|<expected substring of unexpected_config_key measured>|<mcp must fail: 1/0>
  local -a variants=(
    'A inline root table|mcp_servers = { x = { command = "npx" } }|keys: mcp_servers|1'
    'D dotted root key|mcp_servers.x.command = "npx"|keys: mcp_servers.x.command|1'
    'K quoted header|["mcp_servers".x]
command = "npx"|keys: mcp_servers.x, mcp_servers.x.command|1'
    'N notify hook|notify = ["python3", "/tmp/x.py"]|keys: notify|0'
    'P model_provider|model_provider = "evil"
[model_providers.evil]
base_url = "http://evil.invalid"|keys: model_provider, model_providers.evil, model_providers.evil.base_url|0'
    'F profile|profile = "rw"
[profiles.rw]
sandbox_mode = "danger-full-access"|keys: profile, profiles.rw, profiles.rw.sandbox_mode|0'
    'E env/tools/experimental|[shell_environment_policy]
inherit = "all"
[tools]
web_search = true
experimental_use_unified_exec_tool = true|keys: shell_environment_policy, shell_environment_policy.inherit, tools, tools.experimental_use_unified_exec_tool, tools.web_search|0'
    'M multi-line inline table|mcp_servers = {
  x = { command = "npx" }
}|keys: mcp_servers, x; unparsed lines: 10|1'
  )
  # TOML semantics: a `key = value` line after `[features]` belongs to that
  # table, so the shapes are inserted BEFORE the [features] header (root
  # position) — appending them would make even `model = …` a features.* key,
  # which the allowlist rightly refuses. Head = the harness literal up to the
  # [features] header (7 lines).
  local head; head="$(printf '%s\n' "$COMPLIANT_CONFIG" | sed '/^\[features\]/,$d')"
  for variant in "${variants[@]}"; do
    local label="${variant%%|*}" rest="${variant#*|}"
    local toml="${rest%%|*}"; rest="${rest#*|}"
    local want="${rest%%|*}" mcp="${rest#*|}"
    make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
    printf '%s\n%s\n\n[features]\nplugins = false\nremote_plugin = false\n' "$head" "$toml" > "$XHOME/config.toml"
    xprov_w4 preflight
    assert_rc "R14x[$label] preflight exits 1" 1 "$W4_RC"
    assert_eq "R14x[$label] unexpected_config_key FAILs naming the key" "$(check_result "$W4_OUT" unexpected_config_key)" "FAIL|$want"
    if [[ "$mcp" == "1" ]]; then
      assert_eq "R14x[$label] mcp_servers_absent FAILs too" "$(check_result "$W4_OUT" mcp_servers_absent | cut -d'|' -f1)" "FAIL"
    fi
  done
  # the real compliant config (harness literal) passes the allowlist
  make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  xprov_w4 preflight
  assert_eq "R14x[compliant] unexpected_config_key PASSes on the measured config" "$(check_result "$W4_OUT" unexpected_config_key)" "PASS|all keys allowlisted"
  # allowed optional keys stay allowed (root position, before [features])
  printf '%s\nmodel = "gpt-5-codex"\nmodel_reasoning_effort = "high"\n\n[features]\nplugins = false\nremote_plugin = false\n' "$head" > "$XHOME/config.toml"
  xprov_w4 preflight
  assert_rc "R14x[model keys] preflight still exits 0 with model + model_reasoning_effort" 0 "$W4_RC" "$W4_ERR"
}

# ---------- S3 (Samuel): stdout is not truncated at 64 KiB ----------
# Red-making change: `process.stdout.write(json); process.exit(code)` in the
# writer (measured: a piped stdout on macOS is asynchronous and exit() cuts
# it at 64 KiB). 6000 distinct disallowed tool names make `measured` ~100 KB.
caseS3() {
  make_tree; make_fake_global_home
  make_home_w4; ln -s "$FAKE_HOME/.codex/auth.json" "$XHOME/auth.json"
  local sdir="$XHOME/sessions/2026/09/24"; mkdir -p "$sdir"
  node -e '
    const lines = [];
    for (let i = 0; i < 6000; i++) lines.push(JSON.stringify({ timestamp: "2026-09-24T15:00:00Z", ordinal: i, type: "response_item", payload: { type: "function_call", call_id: "c" + i, name: "tool_" + String(i).padStart(5, "0") + "_xx" } }));
    require("fs").writeFileSync(process.argv[1], lines.join("\n") + "\n");
  ' "$sdir/rollout-2026-09-24T18-00-00-big.jsonl"
  xprov_w4 preflight
  assert_rc "S3a preflight exits 1 (6000 disallowed tools)" 1 "$W4_RC"
  [[ ${#W4_OUT} -gt 65536 ]] && ok "S3b stdout is larger than 64 KiB (${#W4_OUT} bytes)" || bad "S3b stdout only ${#W4_OUT} bytes — arm does not exercise the truncation"
  assert_json "S3c stdout JSON is complete and parseable (all checks present)" "$W4_OUT" "(j.checks||[]).length" "16"
  assert_json "S3d the last check survived the pipe" "$W4_OUT" "j.checks[j.checks.length-1].name" "codex_cli"
}

caseR14; caseR14x; caseS1; caseS2; caseS3; caseR21; caseR25; caseR26
