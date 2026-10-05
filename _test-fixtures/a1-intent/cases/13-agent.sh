#!/usr/bin/env bash
# cases/13-agent.sh — spec 011 Wave 11 (ops half): `a1-tools intent
# install-agent [--uninstall|--status]` (_shared/lib/intent-agent.cjs).
# Sourced by run-tests.sh after 05b (it reuses w5b_seal_sandbox / w5b_project_sandbox).
#
# SAFETY: the real launchctl is never run. Every success path goes through
# stub/agent-lib.cjs (library seam: HOME, hostname, platform, uid 4242,
# launchctl = a per-sandbox copy of stub/launchctl that logs its argv and
# reads its mode from files next to itself, not from the environment — README
# "Stub processes read their mode ..."). The cases that call the CLI itself
# (A6b, A7a, A7c on a pty; A8 from an intent child; A31 `intent seal`) are
# refused before the first write or never touch launchctl; none can reach
# it in a sandbox that holds no valid seal. Nothing is written under
# the real ~/Library or ~/.a1-intents: HOME is the sandbox.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, measured on a `git archive`-style copy of the branch (case ids in
# brackets; the full table with the removed statements is in the Wave 11 ops
# report):
#   argv / render    bootstrap argv without the plist [A1a]; plist mode 0644
#                    [A2a]; host block never removed [A2a,A2c]; host id not
#                    rendered [A3a]; host id unvalidated [A3c]; claude's dir
#                    not first in PATH [A2a,A26]; confirmation without the PATH
#                    line [A26]; & < > or a newline not rejected [A2d,A2e,A2f];
#                    value check moved behind doctor [A2f]; template read from
#                    this file's directory, not the seal [A22,A23]; the
#                    A1_INTENT_* key assertion dropped [A23].
#   sealed a1-tools  plist pointing at the plugin cache [A2a,A4].
#   gates            doctor ignored [A5a,A5b]; TTY check dropped [A6a,A6b];
#                    CLAUDE* env check dropped [A7a,A7b,A7c]; child mode
#                    ignored [A7d,A7e]; allowlist row naming install-agent [A8];
#                    seal verdict ignored [A9a,A9b]; stale seal accepted
#                    [A9b]; claude / vault / executor host / platform / home
#                    checks dropped [A10,A11,A12,A13,A21]; confirmation
#                    skipped [A15]; uninstall without the context guard [A7e].
#   plist file       differing plist overwritten [A14a,A14b]; --force without
#                    bootout [A14b,A14c,A16b]; identical plist refused [A14c];
#                    loaded identical plist bootstrapped again [A14e]; link
#                    atomicity (rename instead of link) [A27]; a link accepted
#                    by readExisting [A24,A25]; a doctor-gate case only: A14d.
#   failures         bootstrap failure swallowed [A16a]; new plist not removed
#                    [A16a]; old plist not restored [A16b]; stderr claiming
#                    "nothing was changed" [A16a]; bootout failure ignored
#                    [A18d,A18e]; print error read as "not loaded" [A18e,A19d];
#                    plist_problem swallowed [A25]; raw errors not wrapped
#                    [A28,A29]; /dev/tty error not wrapped [A28].
#   arguments        --yes honoured [A17a]; unknown flags accepted [A17b].
#   uninstall/status uninstall without bootout [A18a]; plist left [A18b];
#                    abort when not loaded [A18c]; status without print
#                    [A19a]; whole log tail [A19a]; launchctl by bare name
#                    [A20].
#   seal skew        agentRootSkew dropped [A30b,A30c]; tick without the check
#                    [A30c]; run's verifySeal without it [A30b]; the hint of
#                    `intent seal` dropped [A31].
#
# Not red-able, stated honestly: xmlEscape is a second line behind the & < >
# refusal (A2d); no case can make it matter.

A13_HOST="$W5B_HOST"
A13_JOB="ai.n3ural.a1-intent-tick"
A13_UID=4242
A13_PS="$SUITE_DIR/vault/w10-measured-ps.txt"
A13_LSOF="$SUITE_DIR/vault/w10-measured-lsof.txt"
A13_NODE="$(command -v node)" # the sandbox bin dir symlinks it

# a13_sandbox <name> — executor sandbox with a valid seal, a node-only bin
# dir, the launchctl stub copy and the stub claude on PATH.
# The template is read from the SEALED copy: it goes into the fake plugin first
# (A13_NO_TEMPLATE=1 leaves it out; A13_TEMPLATE_EXTRA=<line> adds a line to it).
a13_sandbox() {
  w5b_seal_sandbox "$1"
  if [[ -z "${A13_NO_TEMPLATE:-}" ]]; then
    mkdir -p "$PLUGIN_SRC/_shared/templates"
    cp "$REPO_ROOT/_shared/templates/ai.n3ural.a1-intent-tick.plist" "$PLUGIN_SRC/_shared/templates/"
    [[ -z "${A13_TEMPLATE_EXTRA:-}" ]] || sed -i.bak "s#<key>PATH</key>#${A13_TEMPLATE_EXTRA}<key>PATH</key>#" "$PLUGIN_SRC/_shared/templates/ai.n3ural.a1-intent-tick.plist"
    rm -f "$PLUGIN_SRC/_shared/templates/"*.bak
  fi
  node "$STUB_DIR/seal-lib.cjs" "$INTENT_LIB" "$FHOME" "$A13_HOST" >"$SB/.seal.json" 2>&1
  A13_SEAL="$(w5b_seal_dir)"
  mkdir -p "$SB/bin" "$SB/lctl"
  ln -s "$A13_NODE" "$SB/bin/node"
  cp "$STUB_DIR/launchctl" "$SB/lctl/launchctl"
  chmod 755 "$SB/lctl/launchctl"
  # the agent joins paths (path.join): a TMPDIR with a trailing slash must not leave "//" in the expectations
  A13_FHN="$(printf '%s' "$FHOME" | sed 's#//#/#g')"
  A13_PLIST="$A13_FHN/Library/LaunchAgents/$A13_JOB.plist"
  A13_SBN="$(printf '%s' "$SB" | sed 's#//#/#g')"
  A13_LOG="$SB/lctl/argv.log"
}

# a13_reset — a clean slate between cases of one sandbox.
a13_reset() {
  rm -f "$A13_PLIST" "$SB/lctl/argv.log" "$SB/lctl/mode" "$SB/lctl/print.txt"
}

# a13_run <argv-json> [patch-json] — one call of agent-lib.cjs. patch keys
# override the spec; envExtra/envDrop edit its env; path replaces PATH.
a13_run() {
  local spec
  spec="$(node -e '
    const [home, host, sb, stub, vault, ps, lsof, argv, patch] = process.argv.slice(1);
    const p = JSON.parse(patch || "{}");
    const env = { PATH: p.path || `${stub}:${sb}/bin`, A1_VAULT_ROOT: vault, ...(p.envExtra || {}) };
    for (const k of p.envDrop || []) delete env[k];
    const { path: _p, envExtra: _e, envDrop: _d, ...rest } = p;
    process.stdout.write(JSON.stringify({ home, hostname: host, platform: "darwin", uid: 4242, env, argv: JSON.parse(argv),
      launchctl: `${sb}/lctl/launchctl`, tty: true, answer: true, context: "none", child: false, doctor: "clean",
      psFile: ps, lsofFile: lsof, ...rest }));' \
    "$FHOME" "$A13_HOST" "$SB" "$STUB_DIR" "$VAULT" "$A13_PS" "$A13_LSOF" "$1" "${2:-}")"
  if [[ -n "${A13_DETACH:-}" ]]; then # no controlling terminal: /dev/tty cannot be opened (ENXIO)
    python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' node "$STUB_DIR/agent-lib.cjs" "$INTENT_LIB" "$spec" >"$SB/.out" 2>"$SB/.err" </dev/null
  else
    node "$STUB_DIR/agent-lib.cjs" "$INTENT_LIB" "$spec" >"$SB/.out" 2>"$SB/.err"
  fi
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}

# a13_reason — the single reason of a refusal JSON, or <not a refusal>.
a13_reason() {
  node -e 'let o; try { o = JSON.parse(process.argv[1]); } catch (e) { console.log("<stdout is not JSON>"); process.exit(0); }
    console.log(o.ok === false && Array.isArray(o.reasons) ? o.reasons.join(",") : "<not a refusal>");' "$OUT"
}

# a13_calls — the stub's argv.log with tabs shown as "|".
a13_calls() { [[ -f "$A13_LOG" ]] && tr '\t' '|' <"$A13_LOG" || true; }

# a13_refused <name> <reason> — exit 1, that reason, no plist, no launchctl call.
a13_refused() {
  local name="$1" want="$2" got calls
  got="$(a13_reason)"
  calls="$(a13_calls)"
  if [[ "$RC" -eq 1 && "$got" == "$want" && ! -e "$A13_PLIST" && -z "$calls" ]]; then ok "$name"
  else bad "$name" "expected exit 1 reason [$want], no plist, no launchctl call; got exit $RC reason [$got] plist=$([[ -e "$A13_PLIST" ]] && echo yes || echo no) calls=[$calls]" "stderr: ${ERR:0:200}"; fi
}

# a13_plist_json — the plist read by python3 plistlib as JSON (independent parser).
a13_plist_json() {
  python3 -c 'import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], "rb"))))' "$1" 2>&1
}

# ---------- A1–A4: install ----------
a13_sandbox a13-main
a13_reset
a13_run '["install-agent"]'
A1_WANT="3|bootstrap|gui/$A13_UID|$A13_PLIST"
A1_GOT="$(a13_calls)"
if [[ "$RC" -eq 0 && "$A1_GOT" == "$A1_WANT" && "$(node -e 'const o = JSON.parse(process.argv[1]); console.log(o.ok + "|" + o.action)' "$OUT")" == "true|installed" ]]; then
  ok "A1a install: exit 0 and launchctl got exactly one call, argv [bootstrap, gui/<uid>, <plist>] [FR-032]"
else bad "A1a install: exit 0 and launchctl got exactly one call, argv [bootstrap, gui/<uid>, <plist>] [FR-032]" "exit $RC" "want: $A1_WANT" "got:  $A1_GOT" "stdout: ${OUT:0:200}" "stderr: ${ERR:0:200}"; fi

A2_JSON="$(a13_plist_json "$A13_PLIST")"
A2_GOT="$(node -e 'let o; try { o = JSON.parse(process.argv[1]); } catch (e) { console.log("<not a plist> " + process.argv[1].slice(0, 200)); process.exit(0); }
  const env = o.EnvironmentVariables || {};
  console.log([o.Label, o.StartInterval, o.ProgramArguments.join(" "), Object.keys(env).sort().join(","), env.A1_VAULT_ROOT, env.PATH, o.StandardOutPath].join("|"));' "$A2_JSON")"
# the PATH holds the dirs of node and claude, each once, then the system dirs
A2_WANT="$A13_JOB|30|$A13_SBN/bin/node $A13_SEAL/_shared/a1-tools.cjs intent tick|A1_VAULT_ROOT,PATH|$VAULT|$STUB_DIR:$A13_SBN/bin:/usr/bin:/bin:/usr/sbin:/sbin|$FHOME/.a1-intents/agent.log"
A2_MODE="$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$A13_PLIST")"
if [[ "$A2_GOT" == "$A2_WANT" && "$A2_MODE" == "600" ]]; then
  ok "A2a the installed plist parses (plistlib): Label, StartInterval 30, [node, sealed a1-tools, intent, tick], env exactly A1_VAULT_ROOT and PATH (claude's dir first, then node's, then the system dirs), log outside the vault, mode 0600 [FR-032]"
else bad "A2a the installed plist parses (plistlib): Label, StartInterval 30, [node, sealed a1-tools, intent, tick], env exactly A1_VAULT_ROOT and PATH (claude's dir first, then node's, then the system dirs), log outside the vault, mode 0600 [FR-032]" "want: $A2_WANT mode 600" "got:  $A2_GOT mode $A2_MODE"; fi
if ! grep -q '<key>A1_HOST_ID</key>' "$A13_PLIST" && ! grep -q '<!--A1_HOST_ID-->' "$A13_PLIST" && ! grep -q '<key>A1_INTENT_' "$A13_PLIST" && ! grep -q '{{' "$A13_PLIST"; then
  ok "A2c without A1_HOST_ID the host block (both markers) is gone, no A1_INTENT_* key and no placeholder is left in the file [FR-032, FR-046]"
else bad "A2c without A1_HOST_ID the host block (both markers) is gone, no A1_INTENT_* key and no placeholder is left in the file [FR-032, FR-046]" "$(grep -n 'A1_HOST_ID\|<key>A1_INTENT_\|{{' "$A13_PLIST" | head -5)"; fi

# A2d (Reinhard review): a value with & < > or a control character is refused as invalid_value — doctor's
# plist reader rejects `&`, so such a plist would brick doctor. The XML escaping stays as a second line.
mkdir -p "$SB/vault&<x>"
a13_reset
a13_run '["install-agent"]' "{\"envExtra\":{\"A1_VAULT_ROOT\":\"$SB/vault&<x>\"}}"
a13_refused "A2d a vault root holding & and <> is refused as invalid_value, nothing written [FR-032, FR-037]" invalid_value
a13_run '["install-agent"]' "{\"envExtra\":{\"A1_VAULT_ROOT\":\"$SB/v\\nx\"}}"
a13_refused "A2e a vault root holding a newline is refused as invalid_value, nothing written [FR-032]" invalid_value
# the value check runs before doctor and seal (gate order): a bad value AND a failing doctor -> invalid_value
a13_run '["install-agent"]' "{\"doctor\":\"obsidian-open\",\"envExtra\":{\"A1_VAULT_ROOT\":\"$SB/vault&<x>\"}}"
a13_refused "A2f the value check precedes doctor: a bad vault root with the *:58589 listener is invalid_value, not doctor_failed [FR-032]" invalid_value
a13_reset
a13_run '["install-agent"]'

# A4: the plist runs the SEALED copy, not the plugin cache the seal came from.
A4_TOOLS="$(node -e 'const o = JSON.parse(process.argv[1]); console.log(o.ProgramArguments[1])' "$A2_JSON")"
if [[ "$A4_TOOLS" == "$A13_SEAL/_shared/a1-tools.cjs" && "$A4_TOOLS" != "$PLUGIN_SRC"* && -f "$A4_TOOLS" ]]; then
  ok "A4 the plist runs <seal_dir>/_shared/a1-tools.cjs (the sealed copy), not the plugin cache [FR-040]"
else bad "A4 the plist runs <seal_dir>/_shared/a1-tools.cjs (the sealed copy), not the plugin cache [FR-040]" "got: $A4_TOOLS" "seal: $A13_SEAL" "cache: $PLUGIN_SRC"; fi

# A3: the optional host id.
a13_reset
a13_run '["install-agent"]' '{"envExtra":{"A1_HOST_ID":"mac-fixture"}}'
A3_GOT="$(a13_plist_json "$A13_PLIST" | node -e 'let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => { try { const e = JSON.parse(s).EnvironmentVariables; console.log(Object.keys(e).sort().join(",") + "|" + e.A1_HOST_ID); } catch (x) { console.log("<unparsable>"); } })')"
if [[ "$RC" -eq 0 && "$A3_GOT" == "A1_HOST_ID,A1_VAULT_ROOT,PATH|mac-fixture" ]]; then
  ok "A3a with A1_HOST_ID=mac-fixture the plist env is exactly A1_HOST_ID, A1_VAULT_ROOT, PATH and carries the value [FR-032, spec 010 FR-034]"
else bad "A3a with A1_HOST_ID=mac-fixture the plist env is exactly A1_HOST_ID, A1_VAULT_ROOT, PATH and carries the value [FR-032, spec 010 FR-034]" "exit $RC got: $A3_GOT" "stdout: ${OUT:0:200}"; fi
a13_reset
a13_run '["install-agent"]' '{"envExtra":{"A1_HOST_ID":"</string><x/>"}}'
a13_refused "A3b an A1_HOST_ID that is not [A-Za-z0-9._-]{1,64} (markup) is refused as invalid_value, nothing written [FR-032]" invalid_value
a13_run '["install-agent"]' '{"envExtra":{"A1_HOST_ID":"mac host;1"}}'
a13_refused "A3c an A1_HOST_ID with a space and a semicolon (no markup, so only the host-id rule catches it) is refused as invalid_value [FR-032]" invalid_value

# ---------- A5: doctor ----------
a13_reset
a13_run '["install-agent"]' '{"doctor":"obsidian-open"}'
if [[ "$(a13_reason)" == "doctor_failed" && "$OUT" == *obsidian_listener* ]]; then a13_refused "A5a the measured *:58589 Obsidian listener: doctor fails, install refused as doctor_failed (names obsidian_listener), nothing written [FR-037]" doctor_failed
else bad "A5a the measured *:58589 Obsidian listener: doctor fails, install refused as doctor_failed (names obsidian_listener), nothing written [FR-037]" "exit $RC" "stdout: ${OUT:0:300}"; fi
a13_reset
a13_run '["install-agent"]' '{"envExtra":{"A1_INTENT_TIMEOUT_MS":"1"}}'
a13_refused "A5b an A1_INTENT_* variable in the installing shell fails doctor's overrides check: refused as doctor_failed [FR-046]" doctor_failed

# ---------- A6–A8: the human boundary ----------
a13_reset
a13_run '["install-agent"]' '{"tty":false}'
a13_refused "A6a no TTY on stdin/stdout: refused as not_a_tty [FR-040]" not_a_tty
new_sandbox a13-cli
set_executor "$A13_HOST"
run_intent install-agent
if [[ "$RC" -eq 1 && "$(a13_reason)" == "not_a_tty" ]]; then ok "A6b the real CLI with stdout redirected: exit 1 not_a_tty before anything else [FR-040]"
else bad "A6b the real CLI with stdout redirected: exit 1 not_a_tty before anything else [FR-040]" "exit $RC" "stdout: ${OUT:0:200}"; fi
a13_pty() {
  local feed='process.stdout.on("error", () => process.exit(0)); setTimeout(() => {}, 1200)'
  if [[ "$(uname -s)" == "Darwin" ]]; then
    node -e "$feed" | script -q /dev/null env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" "$@" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent install-agent >"$SB/.pty" 2>&1
  else
    node -e "$feed" | script -qec "$(printf '%q ' env HOME="$FHOME" A1_VAULT_ROOT="$VAULT" "$@" node "$A1_AS" "$FHOME" - "$A1_TOOLS" intent install-agent)" /dev/null >"$SB/.pty" 2>&1
  fi
  PTY_OUT="$(tr -d '\r' <"$SB/.pty")"
  OUT="$(printf '%s\n' "$PTY_OUT" | grep '^{' | tail -n 1)"
}
a13_pty CLAUDECODE=1
if [[ "$(a13_reason)" == "claude_code_context" && "$PTY_OUT" == *"environment: "*CLAUDECODE* ]]; then ok "A7a on a real pty with CLAUDECODE=1 the CLI refuses as claude_code_context, naming the variable [FR-040]"
else bad "A7a on a real pty with CLAUDECODE=1 the CLI refuses as claude_code_context, naming the variable [FR-040]" "pty: ${PTY_OUT:0:300}"; fi
a13_pty CLAUDE_CODE_ENTRYPOINT=cli
if [[ "$(a13_reason)" == "claude_code_context" && "$PTY_OUT" == *"environment: "*CLAUDE_CODE_ENTRYPOINT* ]]; then ok "A7c on a real pty with CLAUDE_CODE_ENTRYPOINT set the CLI refuses as claude_code_context [FR-040]"
else bad "A7c on a real pty with CLAUDE_CODE_ENTRYPOINT set the CLI refuses as claude_code_context [FR-040]" "pty: ${PTY_OUT:0:300}"; fi
a13_sandbox a13-main2
a13_run '["install-agent"]' '{"context":"real","envExtra":{"CLAUDE_PID":"1234"}}'
if [[ "$OUT" == *"environment: "*CLAUDE_PID* ]]; then a13_refused "A7b the shipped context guard (library call, CLAUDE_PID in env) refuses as claude_code_context, naming the variable [FR-040]" claude_code_context
else bad "A7b the shipped context guard (library call, CLAUDE_PID in env) refuses as claude_code_context, naming the variable [FR-040]" "stdout: ${OUT:0:300}"; fi
a13_run '["install-agent"]' '{"child":true}'
a13_refused "A7d intent child mode refuses as claude_code_context [FR-041]" claude_code_context
a13_run '["install-agent","--uninstall"]' '{"context":"real","envExtra":{"CLAUDECODE":"1"}}'
if [[ "$(a13_reason)" == "claude_code_context" && -z "$(a13_calls)" ]]; then ok "A7e uninstall also refuses a Claude Code context, launchctl not called [FR-040]"
else bad "A7e uninstall also refuses a Claude Code context, launchctl not called [FR-040]" "exit $RC" "reason: $(a13_reason)" "calls: $(a13_calls)"; fi

# A8: from an intent child the subcommand is not reachable (exit 77, closed allowlist).
# `--yes` keeps the probe harmless even if a row ever admitted it: it would exit 2 at argument parsing.
w5b_project_sandbox a13-child
A8_BAD=""
for action in new-feature plan execute fix progress; do
  child "$action" real-proj intent install-agent --yes
  A8_REASON="$(node -e 'try { const o = JSON.parse(process.argv[1]); console.log(o.error + ":" + o.reason); } catch (e) { console.log("<no json>"); }' "$OUT")"
  [[ "$RC" -eq 77 && "$A8_REASON" == "intent_child_refused:subcommand_not_allowed" ]] || A8_BAD="$A8_BAD $action:$RC:$A8_REASON"
done
if [[ -z "$A8_BAD" ]]; then ok "A8 from an intent child (new-feature, plan, execute, fix, progress) install-agent exits 77 subcommand_not_allowed [FR-041]"
else bad "A8 from an intent child (new-feature, plan, execute, fix, progress) install-agent exits 77 subcommand_not_allowed [FR-041]" "$A8_BAD"; fi

# ---------- A9–A13: refusals before the plist ----------
a13_sandbox a13-seal
chmod -R u+w "$FHOME/.a1-intents-seal"
rm -rf "$FHOME/.a1-intents-seal"
a13_reset
a13_run '["install-agent"]'
A9A_DETAIL="$(node -e 'try { console.log(JSON.parse(process.argv[1]).detail); } catch (e) { console.log("<no json>"); }' "$OUT")"
if [[ "$A9A_DETAIL" == "seal_missing" ]]; then a13_refused "A9a no seal: refused as seal_invalid (detail seal_missing), nothing written [FR-040]" seal_invalid
else bad "A9a no seal: refused as seal_invalid (detail seal_missing), nothing written [FR-040]" "exit $RC" "stdout: ${OUT:0:300}"; fi
a13_sandbox a13-stale
w5b_installed 9.9.1 "$PLUGIN_SRC"
a13_reset
a13_run '["install-agent"]'
A9B_DETAIL="$(node -e 'try { console.log(JSON.parse(process.argv[1]).detail); } catch (e) { console.log("<no json>"); }' "$OUT")"
if [[ "$A9B_DETAIL" == "seal_stale" ]]; then a13_refused "A9b the plugin was updated after the seal: refused as seal_invalid (detail seal_stale) [FR-040]" seal_invalid
else bad "A9b the plugin was updated after the seal: refused as seal_invalid (detail seal_stale) [FR-040]" "exit $RC" "stdout: ${OUT:0:300}"; fi

a13_sandbox a13-env
a13_reset
a13_run '["install-agent"]' "{\"path\":\"$SB/bin\"}"
a13_refused "A10 claude is not on PATH: refused as claude_missing, nothing written [FR-032]" claude_missing
a13_run '["install-agent"]' '{"envDrop":["A1_VAULT_ROOT"]}'
a13_refused "A11 no A1_VAULT_ROOT: refused as vault_root_missing [FR-032]" vault_root_missing
set_executor "some-other-host"
a13_run '["install-agent"]'
a13_refused "A12 this host is not the executor host: refused as not_executor_host [FR-017]" not_executor_host
set_executor "$A13_HOST"
a13_run '["install-agent"]' '{"platform":"linux"}'
a13_refused "A13 launchd exists on macOS only: platform linux refused as unsupported_platform [FR-032]" unsupported_platform
a13_run '["install-agent"]' '{"answer":false}'
a13_refused "A15 the owner does not type yes: refused as not_confirmed, nothing written [FR-040]" not_confirmed

# ---------- A14: an existing plist ----------
a13_reset
mkdir -p "$(dirname "$A13_PLIST")"
printf '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n' >"$A13_PLIST"
chmod 600 "$A13_PLIST"
A14_BEFORE="$(cat "$A13_PLIST")"
a13_run '["install-agent"]'
if [[ "$RC" -eq 1 && "$(a13_reason)" == "plist_exists_differs" && "$(cat "$A13_PLIST")" == "$A14_BEFORE" && -z "$(a13_calls)" ]]; then
  ok "A14a a differing plist is not overwritten without --force: exit 1 plist_exists_differs, file unchanged, no launchctl call [FR-032]"
else bad "A14a a differing plist is not overwritten without --force: exit 1 plist_exists_differs, file unchanged, no launchctl call [FR-032]" "exit $RC reason $(a13_reason)" "calls: $(a13_calls)"; fi
a13_run '["install-agent","--force"]'
A14B_WANT="2|bootout|gui/$A13_UID/$A13_JOB
3|bootstrap|gui/$A13_UID|$A13_PLIST"
if [[ "$RC" -eq 0 && "$(a13_calls)" == "$A14B_WANT" && "$(cat "$A13_PLIST")" != "$A14_BEFORE" && "$(grep -c "$A13_SEAL/_shared/a1-tools.cjs" "$A13_PLIST")" == 1 ]]; then
  ok "A14b --force replaces it: bootout of the old job, then bootstrap, the file now runs the sealed a1-tools [FR-032]"
else bad "A14b --force replaces it: bootout of the old job, then bootstrap, the file now runs the sealed a1-tools [FR-032]" "exit $RC" "want: $A14B_WANT" "got:  $(a13_calls)"; fi
rm -f "$A13_LOG"
A14C_BEFORE="$(cat "$A13_PLIST")"
a13_run '["install-agent"]'
A14C_WANT="2|print|gui/$A13_UID/$A13_JOB
2|bootout|gui/$A13_UID/$A13_JOB
3|bootstrap|gui/$A13_UID|$A13_PLIST"
if [[ "$RC" -eq 0 && "$(a13_calls)" == "$A14C_WANT" && "$(cat "$A13_PLIST")" == "$A14C_BEFORE" ]]; then
  ok "A14c an identical plist whose job is not loaded: print first, then it is written fresh (never handed on unchecked) and bootstrapped, content the same [FR-032]"
else bad "A14c an identical plist whose job is not loaded: print first, then it is written fresh (never handed on unchecked) and bootstrapped, content the same [FR-032]" "exit $RC" "want: $A14C_WANT" "got:  $(a13_calls)"; fi
rm -f "$A13_LOG"
printf 'x\n' >"$SB/lctl/print.txt"
a13_run '["install-agent"]'
if [[ "$RC" -eq 0 && "$(a13_calls)" == "2|print|gui/$A13_UID/$A13_JOB" && "$(node -e 'console.log(JSON.parse(process.argv[1]).action)' "$OUT")" == "already_installed" ]]; then
  ok "A14e an identical plist whose job is loaded: already_installed, exit 0, only print was called (no bootstrap) [FR-032]"
else bad "A14e an identical plist whose job is loaded: already_installed, exit 0, only print was called (no bootstrap) [FR-032]" "exit $RC" "calls: $(a13_calls)" "stdout: ${OUT:0:200}"; fi
rm -f "$SB/lctl/print.txt"
a13_reset
printf 'elsewhere\n' >"$SB/elsewhere"
ln -s "$SB/elsewhere" "$A13_PLIST"
a13_run '["install-agent","--force"]'
# This is the DOCTOR gate, not readExisting's own link refusal (doctor reads the same plist and fails on a link first);
# that second line is covered by the uninstall and status cases A24 and A25.
if [[ "$RC" -eq 1 && "$(a13_reason)" == "doctor_failed" && "$(cat "$SB/elsewhere")" == "elsewhere" && -z "$(a13_calls)" ]]; then
  ok "A14d a symlink in place of the plist: the doctor gate (its overrides check rejects a link) refuses even with --force as doctor_failed; its target is untouched, no launchctl call [FR-037]"
else bad "A14d a symlink in place of the plist: the doctor gate (its overrides check rejects a link) refuses even with --force as doctor_failed; its target is untouched, no launchctl call [FR-037]" "exit $RC reason $(a13_reason)" "target: $(cat "$SB/elsewhere")" "calls: $(a13_calls)"; fi
rm -f "$A13_PLIST"

# ---------- A16–A17: failures and arguments ----------
a13_reset
printf 'fail\n' >"$SB/lctl/mode"
a13_run '["install-agent"]'
if [[ "$RC" -eq 1 && "$(a13_reason)" == "launchctl_failed" && ! -e "$A13_PLIST" && "$ERR" == *"rolled back: the new plist was removed"* && "$ERR" != *"nothing was changed"* ]]; then
  ok "A16a launchctl bootstrap exits 5 on a fresh install: launchctl_failed, the new plist is removed, stderr says 'rolled back' (not 'nothing was changed') [FR-032]"
else bad "A16a launchctl bootstrap exits 5 on a fresh install: launchctl_failed, the new plist is removed, stderr says 'rolled back' (not 'nothing was changed') [FR-032]" "exit $RC reason $(a13_reason)" "plist: $([[ -e "$A13_PLIST" ]] && echo present || echo absent)" "stderr: ${ERR:0:300}"; fi
a13_reset
mkdir -p "$(dirname "$A13_PLIST")"
printf '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n' >"$A13_PLIST"
A16B_BEFORE="$(cat "$A13_PLIST")"
printf 'bootstrapfail\n' >"$SB/lctl/mode"
a13_run '["install-agent","--force"]'
A16B_WANT="2|bootout|gui/$A13_UID/$A13_JOB
3|bootstrap|gui/$A13_UID|$A13_PLIST
3|bootstrap|gui/$A13_UID|$A13_PLIST"
if [[ "$RC" -eq 1 && "$(a13_reason)" == "launchctl_failed" && "$(cat "$A13_PLIST")" == "$A16B_BEFORE" && "$ERR" == *"rolled back: the previous plist is back"* \
  && "$(a13_calls)" == "$A16B_WANT" && -z "$(ls "$(dirname "$A13_PLIST")" | grep -v "^$A13_JOB.plist$")" ]]; then
  ok "A16b --force over a differing plist and bootstrap fails: the OLD plist is back byte for byte, bootstrapped again best-effort, no .bak or .tmp left, stderr says rolled back [FR-032]"
else bad "A16b --force over a differing plist and bootstrap fails: the OLD plist is back byte for byte, bootstrapped again best-effort, no .bak or .tmp left, stderr says rolled back [FR-032]" "exit $RC reason $(a13_reason)" "want calls: $A16B_WANT" "got calls:  $(a13_calls)" "dir: $(ls "$(dirname "$A13_PLIST")")" "stderr: ${ERR:0:300}"; fi
a13_reset
a13_run '["install-agent","--yes"]'
if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == "usage error: intent install-agent: --yes is refused"* && -z "$(a13_calls)" ]]; then ok "A17a --yes is refused: exit 2, no stdout [FR-040]"
else bad "A17a --yes is refused: exit 2, no stdout [FR-040]" "exit $RC" "stdout: ${OUT:0:100}" "stderr: ${ERR:0:200}"; fi
A17B_BAD=""
for arg in --bogus --uninstall,--status --force,--status --force,--uninstall; do
  a13_run "[\"install-agent\",\"${arg//,/\",\"}\"]"
  [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == "usage error: "* ]] || A17B_BAD="$A17B_BAD $arg:$RC"
done
if [[ -z "$A17B_BAD" && ! -e "$A13_PLIST" && -z "$(a13_calls)" ]]; then ok "A17b an unknown flag, --uninstall with --status, --force with either: exit 2, nothing done [FR-032]"
else bad "A17b an unknown flag, --uninstall with --status, --force with either: exit 2, nothing done [FR-032]" "$A17B_BAD"; fi

# ---------- A18: uninstall ----------
a13_reset
a13_run '["install-agent"]'
rm -f "$A13_LOG"
a13_run '["install-agent","--uninstall"]'
if [[ "$RC" -eq 0 && "$(a13_calls)" == "2|bootout|gui/$A13_UID/$A13_JOB" ]]; then ok "A18a uninstall: exactly one launchctl call, [bootout, gui/<uid>/ai.n3ural.a1-intent-tick] [FR-032]"
else bad "A18a uninstall: exactly one launchctl call, [bootout, gui/<uid>/ai.n3ural.a1-intent-tick] [FR-032]" "exit $RC" "calls: $(a13_calls)"; fi
if [[ ! -e "$A13_PLIST" && "$(node -e 'const o = JSON.parse(process.argv[1]); console.log(o.plist_removed + "|" + o.booted_out)' "$OUT")" == "true|true" ]]; then ok "A18b uninstall removes the plist and reports plist_removed, booted_out [FR-032]"
else bad "A18b uninstall removes the plist and reports plist_removed, booted_out [FR-032]" "stdout: ${OUT:0:200}"; fi
a13_reset
a13_run '["install-agent"]'
printf 'notloaded\n' >"$SB/lctl/mode"
a13_run '["install-agent","--uninstall"]'
if [[ "$RC" -eq 0 && ! -e "$A13_PLIST" && "$(node -e 'console.log(JSON.parse(process.argv[1]).booted_out)' "$OUT")" == "false" && "$(a13_calls | tail -n 1)" == "2|print|gui/$A13_UID/$A13_JOB" ]]; then ok "A18c bootout fails and print says 'not loaded': the plist is removed, booted_out false, exit 0 [FR-032]"
else bad "A18c bootout fails and print says 'not loaded': the plist is removed, booted_out false, exit 0 [FR-032]" "exit $RC" "stdout: ${OUT:0:200}" "calls: $(a13_calls)"; fi
# A18d: bootout fails and the job is still loaded -> bootout_failed, the plist stays
a13_reset
a13_run '["install-agent"]'
printf 'bootoutfail\n' >"$SB/lctl/mode"
printf 'x\n' >"$SB/lctl/print.txt"
a13_run '["install-agent","--uninstall"]'
if [[ "$RC" -eq 1 && "$(a13_reason)" == "bootout_failed" && -f "$A13_PLIST" && "$ERR" == *"the plist was kept"* ]]; then ok "A18d bootout fails while print says loaded: exit 1 bootout_failed, the plist stays [FR-032]"
else bad "A18d bootout fails while print says loaded: exit 1 bootout_failed, the plist stays [FR-032]" "exit $RC reason $(a13_reason)" "stderr: ${ERR:0:200}"; fi
# A18e: bootout fails and print cannot be classified -> unknown is never "not loaded"
rm -f "$SB/lctl/print.txt"
printf 'unknown\n' >"$SB/lctl/mode"
a13_run '["install-agent","--uninstall"]'
if [[ "$RC" -eq 1 && "$(a13_reason)" == "bootout_failed" && -f "$A13_PLIST" ]]; then ok "A18e bootout fails and print exits 1 with an unclassifiable text: state unknown, exit 1 bootout_failed, the plist stays [FR-032]"
else bad "A18e bootout fails and print exits 1 with an unclassifiable text: state unknown, exit 1 bootout_failed, the plist stays [FR-032]" "exit $RC reason $(a13_reason)"; fi
# A24: a link in place of the plist -> plist_unsafe before any launchctl call
a13_reset
printf 'elsewhere\n' >"$SB/elsewhere"
mkdir -p "$(dirname "$A13_PLIST")"
ln -s "$SB/elsewhere" "$A13_PLIST"
a13_run '["install-agent","--uninstall"]'
if [[ "$RC" -eq 1 && "$(a13_reason)" == "plist_unsafe" && -L "$A13_PLIST" && "$(cat "$SB/elsewhere")" == "elsewhere" && -z "$(a13_calls)" ]]; then ok "A24 uninstall over a symlinked plist: exit 1 plist_unsafe, the link stays, launchctl is not called [FR-032]"
else bad "A24 uninstall over a symlinked plist: exit 1 plist_unsafe, the link stays, launchctl is not called [FR-032]" "exit $RC reason $(a13_reason)" "calls: $(a13_calls)"; fi
a13_run '["install-agent","--status"]'
if [[ "$RC" -eq 0 && "$(node -e 'const o = JSON.parse(process.argv[1]); console.log(typeof o.plist_problem + "|" + o.plist_present)' "$OUT")" == "string|false" ]]; then ok "A25 status over a symlinked plist reports plist_problem instead of swallowing it [FR-032]"
else bad "A25 status over a symlinked plist reports plist_problem instead of swallowing it [FR-032]" "exit $RC" "stdout: ${OUT:0:300}"; fi
rm -f "$A13_PLIST"

# ---------- A19: status ----------
a13_reset
a13_run '["install-agent"]'
rm -f "$A13_LOG"
printf '%s\n' "$A13_JOB = {" "	active count = 0" "	state = not running" "	last exit code = 0" "}" >"$SB/lctl/print.txt"
for n in 1 2 3 4 5 6 7; do printf '{"outcome":"line-%s"}\n' "$n"; done >"$FHOME/.a1-intents/log.jsonl"
chmod 600 "$FHOME/.a1-intents/log.jsonl"
a13_run '["install-agent","--status"]'
A19_GOT="$(node -e 'const o = JSON.parse(process.argv[1]); console.log([o.loaded, o.state, o.last_exit, o.plist_present, o.plist_matches_seal, o.log_tail.length, o.log_tail[0], o.log_tail[4]].join("|"))' "$OUT" 2>&1)"
A19_WANT='true|not running|0|true|true|5|{"outcome":"line-3"}|{"outcome":"line-7"}'
if [[ "$RC" -eq 0 && "$A19_GOT" == "$A19_WANT" && "$(a13_calls)" == "2|print|gui/$A13_UID/$A13_JOB" ]]; then
  ok "A19a status: one launchctl print gui/<uid>/<label>; state, last exit, plist matches the seal, the last 5 of 7 log lines [FR-032]"
else bad "A19a status: one launchctl print gui/<uid>/<label>; state, last exit, plist matches the seal, the last 5 of 7 log lines [FR-032]" "exit $RC" "want: $A19_WANT" "got:  $A19_GOT" "calls: $(a13_calls)"; fi
rm -f "$SB/lctl/print.txt"
a13_run '["install-agent","--status"]'
A19C_GOT="$(node -e 'const o = JSON.parse(process.argv[1]); console.log([o.loaded, o.state, o.last_exit].join("|"))' "$OUT" 2>&1)"
if [[ "$RC" -eq 0 && "$A19C_GOT" == "false|not_loaded|" ]]; then ok "A19c launchctl print fails (113): status reports loaded false, state not_loaded, exit 0 [FR-032]"
else bad "A19c launchctl print fails (113): status reports loaded false, state not_loaded, exit 0 [FR-032]" "exit $RC got: $A19C_GOT"; fi
rm -f "$FHOME/.a1-intents/log.jsonl"

a13_reset
printf 'printfail\n' >"$SB/lctl/mode"
a13_run '["install-agent","--status"]'
A19D_GOT="$(node -e 'const o = JSON.parse(process.argv[1]); console.log([o.loaded, o.state].join("|"))' "$OUT" 2>&1)"
if [[ "$RC" -eq 0 && "$A19D_GOT" == "|unknown" ]]; then ok "A19d launchctl print fails with an unclassifiable error: status reports state unknown (loaded null), never not_loaded [FR-032]"
else bad "A19d launchctl print fails with an unclassifiable error: status reports state unknown (loaded null), never not_loaded [FR-032]" "exit $RC got: $A19D_GOT"; fi
a13_reset

# ---------- A20: the absolute launchctl path ----------
a13_reset
rm -f "$SB/capture.log"
a13_run '["install-agent","--uninstall"]' "{\"launchctl\":null,\"capture\":\"$SB/capture.log\"}"
if [[ "$(cat "$SB/capture.log" 2>/dev/null)" == "/bin/launchctl	bootout	gui/$A13_UID/$A13_JOB" ]]; then ok "A20 without a seam launchctl is /bin/launchctl, called by absolute path with an argv array [FR-032]"
else bad "A20 without a seam launchctl is /bin/launchctl, called by absolute path with an argv array [FR-032]" "got: $(cat "$SB/capture.log" 2>/dev/null)" "stdout: ${OUT:0:200}"; fi

# ---------- A21–A23, A26–A29: the review round (Samuel, Reinhard) ----------
a13_sandbox a13-rev
a13_reset
a13_run '["install-agent"]' "{\"passwdHome\":\"$SB/other-home\"}"
a13_refused "A21 HOME differs from the passwd home: refused as home_mismatch (the plist sets no HOME) [FR-032]" home_mismatch

a13_run '["install-agent"]' "{\"summaryFile\":\"$SB/summary.txt\"}"
if [[ "$RC" -eq 0 && "$(cat "$SB/summary.txt")" == *"  PATH:        $STUB_DIR:$A13_SBN/bin:/usr/bin:/bin:/usr/sbin:/sbin"* ]]; then ok "A26 the confirmation shows the PATH line the plist will carry [FR-040]"
else bad "A26 the confirmation shows the PATH line the plist will carry [FR-040]" "exit $RC" "summary: $(cat "$SB/summary.txt" 2>/dev/null)"; fi
a13_reset
a13_run '["install-agent"]' "{\"plantOnConfirm\":\"$A13_PLIST\"}"
if [[ "$RC" -eq 1 && "$(a13_reason)" == "plist_exists_differs" && "$(cat "$A13_PLIST")" == "planted" && -z "$(a13_calls)" && -z "$(ls "$(dirname "$A13_PLIST")" | grep -v "^$A13_JOB.plist$")" ]]; then
  ok "A27 a file appears at the plist path after the confirmation: JSON refusal plist_exists_differs (no EEXIST stack), the planted file is untouched, launchctl not called, no tmp left [FR-032]"
else bad "A27 a file appears at the plist path after the confirmation: JSON refusal plist_exists_differs (no EEXIST stack), the planted file is untouched, launchctl not called, no tmp left [FR-032]" "exit $RC reason $(a13_reason)" "stderr: ${ERR:0:300}"; fi
rm -f "$A13_PLIST"
a13_reset
A13_DETACH=1 a13_run '["install-agent"]' '{"realConfirm":true}'
unset A13_DETACH
if [[ "$RC" -eq 1 && "$(a13_reason)" == "not_a_tty" && "$OUT" == *"/dev/tty cannot be opened"* && -z "$(a13_calls)" ]]; then ok "A28 no controlling terminal: opening /dev/tty fails (ENXIO) and is a JSON refusal not_a_tty, not a stack trace [FR-040]"
else bad "A28 no controlling terminal: opening /dev/tty fails (ENXIO) and is a JSON refusal not_a_tty, not a stack trace [FR-040]" "exit $RC" "stdout: ${OUT:0:200}" "stderr: ${ERR:0:300}"; fi
cp "$FHOME/.a1-intents/executor.json" "$SB/executor.good"
printf 'not json\n' >"$FHOME/.a1-intents/executor.json"
a13_run '["install-agent"]'
a13_refused "A29 an unreadable executor.json is a JSON refusal executor_unreadable, not a stack trace [FR-017]" executor_unreadable
cp "$SB/executor.good" "$FHOME/.a1-intents/executor.json"

A13_NO_TEMPLATE=1 a13_sandbox a13-notpl
a13_reset
a13_run '["install-agent"]'
a13_refused "A22 the sealed copy holds no plist template: refused as template_missing, nothing written [FR-040]" template_missing
unset A13_NO_TEMPLATE
A13_TEMPLATE_EXTRA='<key>A1_INTENT_FRESHNESS_MS</key><string>1</string>' a13_sandbox a13-badtpl
a13_reset
a13_run '["install-agent"]'
a13_refused "A23 a sealed template that carries an A1_INTENT_* key is refused as template_unfilled, nothing written [FR-046]" template_unfilled

# A31: `intent seal` tells the owner to re-point the agent (the skew guard refuses until then).
w5b_seal_sandbox a13-hint
seal_pty "$A1_TOOLS" yes
if [[ "$PTY_OUT" == *"intent install-agent --force"* ]]; then ok "A31 intent seal prints the hint to run 'intent install-agent --force' after sealing [FR-040]"
else bad "A31 intent seal prints the hint to run 'intent install-agent --force' after sealing [FR-040]" "pty: ${PTY_OUT:0:400}"; fi

# ---------- A30: seal skew (re-seal without install-agent --force) ----------
a13_sandbox a13-skew
a13_reset
a13_run '["install-agent"]'
A13_SEAL_OLD="$A13_SEAL"
printf 'second version\n' >"$PLUGIN_SRC/README2.md"
node "$STUB_DIR/seal-lib.cjs" "$INTENT_LIB" "$FHOME" "$A13_HOST" >"$SB/.seal2.json" 2>&1
A13_SEAL_NEW="$(w5b_seal_dir)"
a13_run '["install-agent","--status"]'
if [[ "$A13_SEAL_NEW" != "$A13_SEAL_OLD" && "$(node -e 'const o = JSON.parse(process.argv[1]); console.log(o.plist_matches_seal + "|" + o.plist_a1_tools)' "$OUT")" == "false|$A13_SEAL_OLD/_shared/a1-tools.cjs" ]]; then
  ok "A30a after a re-seal the status says plist_matches_seal false and names the old sealed a1-tools [FR-040]"
else bad "A30a after a re-seal the status says plist_matches_seal false and names the old sealed a1-tools [FR-040]" "old: $A13_SEAL_OLD" "new: $A13_SEAL_NEW" "stdout: ${OUT:0:300}"; fi
a13_verify() { a13_run '["install-agent"]' "{\"mode\":\"verify\",\"codeRoot\":\"$1\"}"; node -e 'try { const o = JSON.parse(process.argv[1]); console.log(o.ok + "|" + o.detail); } catch (e) { console.log("<no json>"); }' "$OUT"; }
V_OLD="$(a13_verify "$A13_SEAL_OLD")"
V_NEW="$(a13_verify "$A13_SEAL_NEW")"
V_OUT="$(a13_verify "$PLUGIN_SRC")"
if [[ "$V_OLD" == "false|agent_points_at_old_seal" && "$V_NEW" == "true|null" && "$V_OUT" == "true|null" ]]; then
  ok "A30b run's seal check: code running from the OLD seal dir -> sandbox_invalid / agent_points_at_old_seal; from the current seal dir or from outside the seal root (plugin cache) -> ok [FR-040]"
else bad "A30b run's seal check: code running from the OLD seal dir -> sandbox_invalid / agent_points_at_old_seal; from the current seal dir or from outside the seal root (plugin cache) -> ok [FR-040]" "old: $V_OLD" "new: $V_NEW" "outside: $V_OUT"; fi
A30_Q="$VAULT/inbox/intents/queued"
A30_FILE="$(mk_intent)"
a13_run '["install-agent"]' "{\"mode\":\"tick\",\"codeRoot\":\"$A13_SEAL_OLD\"}"
A30_GOT="$(node -e 'try { const o = JSON.parse(process.argv[1]); console.log(o.exitCode + "|" + o.out.ticked + "|" + o.out.reasons.join(",") + "|" + o.out.detail); } catch (e) { console.log("<no json>"); }' "$OUT")"
A30_LOG="$(tail -n 1 "$FHOME/.a1-intents/log.jsonl" 2>/dev/null)"
if [[ "$A30_GOT" == "1|false|seal_stale|agent_points_at_old_seal" && -f "$A30_FILE" && ! -e "$FHOME/.a1-intents/tmp/stub/invocations.log" \
  && "$A30_LOG" == *'"command":"tick"'* && "$A30_LOG" == *agent_points_at_old_seal* ]]; then
  ok "A30c tick from the old seal dir: exit 1 seal_stale / agent_points_at_old_seal, one log line, the queued intent is not claimed, 0 spawns [FR-032, FR-040]"
else bad "A30c tick from the old seal dir: exit 1 seal_stale / agent_points_at_old_seal, one log line, the queued intent is not claimed, 0 spawns [FR-032, FR-040]" "got: $A30_GOT" "queued file kept: $([[ -f "$A30_FILE" ]] && echo yes || echo no)" "log: $A30_LOG"; fi
rm -f "$A30_FILE"
a13_run '["install-agent"]' "{\"mode\":\"tick\",\"codeRoot\":\"$A13_SEAL_NEW\"}"
A30D_GOT="$(node -e 'try { const o = JSON.parse(process.argv[1]); console.log(o.exitCode + "|" + o.out.ticked); } catch (e) { console.log("<no json>"); }' "$OUT")"
a13_run '["install-agent"]' "{\"mode\":\"tick\",\"codeRoot\":\"$PLUGIN_SRC\"}"
A30E_GOT="$(node -e 'try { const o = JSON.parse(process.argv[1]); console.log(o.exitCode + "|" + o.out.ticked); } catch (e) { console.log("<no json>"); }' "$OUT")"
if [[ "$A30D_GOT" == "0|true" && "$A30E_GOT" == "0|true" ]]; then ok "A30d tick from the current seal dir, and from outside the seal root (manual tick), runs as before [FR-032]"
else bad "A30d tick from the current seal dir, and from outside the seal root (manual tick), runs as before [FR-032]" "current: $A30D_GOT" "outside: $A30E_GOT"; fi

# the seals are read-only trees; make the work dir removable again (as 06 and 06a do)
chmod -R u+w "$WORK"
