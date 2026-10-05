#!/usr/bin/env bash
# cases/13-agent.sh — spec 011 Wave 11 (ops half): `a1-tools intent
# install-agent [--uninstall|--status]` (_shared/lib/intent-agent.cjs).
# Sourced by run-tests.sh after 05b (it reuses w5b_seal_sandbox / w5b_project_sandbox).
#
# SAFETY: the real launchctl is never run. Every success path goes through
# stub/agent-lib.cjs (library seam: HOME, hostname, platform, uid 4242,
# launchctl = a per-sandbox copy of stub/launchctl that logs its argv and
# reads its mode from files next to itself, not from the environment — README
# "Stub processes read their mode ..."). The three cases that call the CLI
# itself (A6, A7, A8) are refused before the first write; none can reach
# launchctl in a sandbox that holds no valid seal. Nothing is written under
# the real ~/Library or ~/.a1-intents: HOME is the sandbox.
#
# RED proof (CONVENTIONS.md): the single production change that turns each
# case red, measured on a `git archive` copy of the branch:
#   A1  bootstrap argv wrong (gui/<uid> or the plist path dropped, bootout
#       before bootstrap): A1a; calling bash -c instead of argv: A1a too.
#   A2  hard-coded node/PATH, not writing 0600, rendering the host block
#       when A1_HOST_ID is empty (A2c), emitting an A1_INTENT_* key (A2d).
#   A3  host id not rendered (A3a), host id not validated (A3b).
#   A4  the plist pointing at the plugin cache instead of the sealed copy.
#   A5  not running doctor / ignoring its verdict.
#   A6  dropping the TTY check; A7 dropping the CLAUDECODE env check;
#       A7b ignoring child mode; A8 an allowlist row naming install-agent.
#   A9  not calling verifySeal (A9a), accepting a stale seal (A9b).
#   A10 resolving claude through the stub dir only / not refusing (A10).
#   A11 not requiring A1_VAULT_ROOT; A12 skipping the executor-host check;
#   A13 skipping the platform check.
#   A14 overwriting a differing plist (A14a), --force without bootout
#       (A14b), refusing an identical plist (A14c), following a symlink (A14d).
#   A15 skipping the confirmation (A15).
#   A16 swallowing a launchctl failure (A16).
#   A17 honouring --yes (A17a); accepting unknown flags (A17b).
#   A18 uninstall without bootout (A18a), leaving the plist (A18b), aborting
#       when the job is not loaded (A18c).
#   A19 status without `print` (A19a), reading the whole log (A19b),
#       reporting loaded when print fails (A19c).
#   A20 launchctl by PATH name instead of /bin/launchctl.

A13_HOST="$W5B_HOST"
A13_JOB="ai.n3ural.a1-intent-tick"
A13_UID=4242
A13_PS="$SUITE_DIR/vault/w10-measured-ps.txt"
A13_LSOF="$SUITE_DIR/vault/w10-measured-lsof.txt"
A13_NODE="$(command -v node)" # the sandbox bin dir symlinks it

# a13_sandbox <name> — executor sandbox with a valid seal, a node-only bin
# dir, the launchctl stub copy and the stub claude on PATH.
a13_sandbox() {
  w5b_seal_sandbox "$1"
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
  node "$STUB_DIR/agent-lib.cjs" "$INTENT_LIB" "$spec" >"$SB/.out" 2>"$SB/.err"
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
A2_WANT="$A13_JOB|30|$A13_SBN/bin/node $A13_SEAL/_shared/a1-tools.cjs intent tick|A1_VAULT_ROOT,PATH|$VAULT|$A13_SBN/bin:$STUB_DIR:/usr/bin:/bin:/usr/sbin:/sbin|$FHOME/.a1-intents/agent.log"
A2_MODE="$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$A13_PLIST")"
if [[ "$A2_GOT" == "$A2_WANT" && "$A2_MODE" == "600" ]]; then
  ok "A2a the installed plist parses (plistlib): Label, StartInterval 30, [node, sealed a1-tools, intent, tick], env exactly A1_VAULT_ROOT and PATH (dirs of claude and node, then system dirs), log outside the vault, mode 0600 [FR-032]"
else bad "A2a the installed plist parses (plistlib): Label, StartInterval 30, [node, sealed a1-tools, intent, tick], env exactly A1_VAULT_ROOT and PATH (dirs of claude and node, then system dirs), log outside the vault, mode 0600 [FR-032]" "want: $A2_WANT mode 600" "got:  $A2_GOT mode $A2_MODE"; fi
if ! grep -q '<key>A1_HOST_ID</key>' "$A13_PLIST" && ! grep -q '<!--A1_HOST_ID-->' "$A13_PLIST" && ! grep -q '<key>A1_INTENT_' "$A13_PLIST" && ! grep -q '{{' "$A13_PLIST"; then
  ok "A2c without A1_HOST_ID the host block (both markers) is gone, no A1_INTENT_* key and no placeholder is left in the file [FR-032, FR-046]"
else bad "A2c without A1_HOST_ID the host block (both markers) is gone, no A1_INTENT_* key and no placeholder is left in the file [FR-032, FR-046]" "$(grep -n 'A1_HOST_ID\|<key>A1_INTENT_\|{{' "$A13_PLIST" | head -5)"; fi

# A2d: a vault path with XML metacharacters is escaped, the plist still parses and carries the exact path.
mkdir -p "$SB/vault&<x>"
a13_reset
a13_run '["install-agent"]' "{\"envExtra\":{\"A1_VAULT_ROOT\":\"$SB/vault&<x>\"}}"
A2D_GOT="$(a13_plist_json "$A13_PLIST" | node -e 'let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => { try { console.log(JSON.parse(s).EnvironmentVariables.A1_VAULT_ROOT); } catch (x) { console.log("<unparsable>"); } })')"
if [[ "$RC" -eq 0 && "$A2D_GOT" == "$SB/vault&<x>" ]]; then ok "A2d a vault root holding & and <> is XML-escaped: the plist parses and carries the exact path [FR-032]"
else bad "A2d a vault root holding & and <> is XML-escaped: the plist parses and carries the exact path [FR-032]" "exit $RC got: $A2D_GOT" "stdout: ${OUT:0:200}"; fi
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
if [[ "$RC" -eq 0 && "$(a13_calls)" == "3|bootstrap|gui/$A13_UID|$A13_PLIST" && "$(cat "$A13_PLIST")" == "$A14C_BEFORE" ]]; then
  ok "A14c an identical plist is kept as it is: exit 0, bootstrap only [FR-032]"
else bad "A14c an identical plist is kept as it is: exit 0, bootstrap only [FR-032]" "exit $RC" "calls: $(a13_calls)"; fi
a13_reset
printf 'elsewhere\n' >"$SB/elsewhere"
ln -s "$SB/elsewhere" "$A13_PLIST"
a13_run '["install-agent","--force"]'
# doctor reads the same plist (overrides check) and fails on a link first; readExisting's own link refusal is the second line.
if [[ "$RC" -eq 1 && "$(a13_reason)" == "doctor_failed" && "$(cat "$SB/elsewhere")" == "elsewhere" && -z "$(a13_calls)" ]]; then
  ok "A14d a symlink in place of the plist is refused even with --force (doctor_failed: its overrides check rejects a link); its target is untouched, no launchctl call [FR-032, FR-037]"
else bad "A14d a symlink in place of the plist is refused even with --force (doctor_failed: its overrides check rejects a link); its target is untouched, no launchctl call [FR-032, FR-037]" "exit $RC reason $(a13_reason)" "target: $(cat "$SB/elsewhere")" "calls: $(a13_calls)"; fi
rm -f "$A13_PLIST"

# ---------- A16–A17: failures and arguments ----------
a13_reset
printf 'fail\n' >"$SB/lctl/mode"
a13_run '["install-agent"]'
if [[ "$RC" -eq 1 && "$(a13_reason)" == "launchctl_failed" ]]; then ok "A16 launchctl bootstrap exits 5: exit 1 launchctl_failed, not swallowed [FR-032]"
else bad "A16 launchctl bootstrap exits 5: exit 1 launchctl_failed, not swallowed [FR-032]" "exit $RC reason $(a13_reason)" "stdout: ${OUT:0:200}"; fi
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
if [[ "$RC" -eq 0 && ! -e "$A13_PLIST" && "$(node -e 'console.log(JSON.parse(process.argv[1]).booted_out)' "$OUT")" == "false" ]]; then ok "A18c a job that is not loaded (bootout exits 3): the plist is still removed, booted_out false, exit 0 [FR-032]"
else bad "A18c a job that is not loaded (bootout exits 3): the plist is still removed, booted_out false, exit 0 [FR-032]" "exit $RC" "stdout: ${OUT:0:200}"; fi

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

# ---------- A20: the absolute launchctl path ----------
a13_reset
rm -f "$SB/capture.log"
a13_run '["install-agent","--uninstall"]' "{\"launchctl\":null,\"capture\":\"$SB/capture.log\"}"
if [[ "$(cat "$SB/capture.log" 2>/dev/null)" == "/bin/launchctl	bootout	gui/$A13_UID/$A13_JOB" ]]; then ok "A20 without a seam launchctl is /bin/launchctl, called by absolute path with an argv array [FR-032]"
else bad "A20 without a seam launchctl is /bin/launchctl, called by absolute path with an argv array [FR-032]" "got: $(cat "$SB/capture.log" 2>/dev/null)" "stdout: ${OUT:0:200}"; fi

# the seals are read-only trees; make the work dir removable again (as 06 and 06a do)
chmod -R u+w "$WORK"
