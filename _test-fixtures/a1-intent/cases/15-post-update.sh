#!/usr/bin/env bash
# cases/15-post-update.sh — spec 016 Wave 11, FR-033 (US-016-8): `a1-tools
# intent post-update` (_shared/lib/intent-post-update.cjs) runs `intent seal`
# and `intent install-agent --force` behind their own owner-only guards and
# prints one combined result. Sourced after 14 (reuses a13_* from
# 13-agent.sh, g14_* from 14-claude-guard.sh, w5b_* and child from 05b).
#
# The library cases go through stub/post-update-lib.cjs (seam for both steps,
# launchctl = the per-sandbox stub; the real launchctl is never run). The guard
# cases that must prove the REAL guard run the real CLI on a pty, in a sandbox
# that holds no seal, so nothing can reach launchctl.
#
# RED proof (CONVENTIONS.md): the one production change that turns each case red:
#   no-argument rule      removing the `args.length > 0` check in
#                         cmdIntentPostUpdate [P12*]
#   seal before install   continuing to the install after a SealRefusal [P2, P3, P4]
#   seal guards           removing the contextRefusal call in prepareSeal
#                         (intent-seal.cjs) [P4, P10a, P10b, P10c]; removing the
#                         isTty check there [P2, P9]
#   install guards        removing guardHuman's tty / child / context line in
#                         intent-agent.cjs [P6, P7, P8]
#   --force               installForced calling install(d, false) [P1b]
#   child allowlist       adding post-update to INTENT_CHILD_ALLOWLIST [P11]
#   owner text            putting the old hint back in intent-cli.cjs [P13d]

P15_NODE="$(command -v node)"

# p15_run <args-json> [patch-json] — one call of post-update-lib.cjs. Sets RC, OUT, ERR.
# patch keys override the spec; "nodeEnv" is extra environment for the node process itself.
p15_run() {
  local spec nodeenv
  spec="$(node -e '
    const [home, host, sb, stub, vault, args, patch] = process.argv.slice(1);
    const p = JSON.parse(patch || "{}");
    const { nodeEnv: _n, ...rest } = p;
    process.stdout.write(JSON.stringify({ home, hostname: host, platform: "darwin", uid: 4242,
      env: { PATH: `${stub}:${sb}/bin`, A1_VAULT_ROOT: vault, ...(p.env || {}) }, args: JSON.parse(args),
      launchctl: `${sb}/lctl/launchctl`, sealTty: true, agentTty: true, sealAnswer: true, agentAnswer: true,
      sealContext: "none", agentContext: "none", child: false, ...rest }));' \
    "$FHOME" "$A13_HOST" "$SB" "$STUB_DIR" "$VAULT" "$1" "${2:-}")"
  nodeenv="$(node -e 'const p = JSON.parse(process.argv[1] || "{}"); process.stdout.write(Object.entries(p.nodeEnv || {}).map(([k, v]) => `${k}=${v}`).join("\n"))' "${2:-}")"
  local envargs=()
  [[ -z "$nodeenv" ]] || while IFS= read -r line; do envargs+=("$line"); done <<<"$nodeenv"
  env ${envargs[@]+"${envargs[@]}"} HOME="$FHOME" "$P15_NODE" "$STUB_DIR/post-update-lib.cjs" "$INTENT_LIB" "$spec" >"$SB/.out" 2>"$SB/.err"
  RC=$?
  OUT="$(cat "$SB/.out")"
  ERR="$(cat "$SB/.err")"
}

# p15_json <js-expr over o> — a value of the stdout JSON, or <no json>.
p15_json() { node -e 'try { const o = JSON.parse(process.argv[1]); const v = eval(process.argv[2]); console.log(v === undefined ? "<undefined>" : String(v)); } catch (e) { console.log("<no json>"); }' "$OUT" "$1"; }

# p15_unsealed — an executor sandbox whose seal is gone (the state before the step).
p15_unsealed() {
  a13_sandbox "$1"
  chmod -R u+w "$FHOME/.a1-intents-seal"
  rm -rf "$FHOME/.a1-intents-seal"
  a13_reset
}

# p15_seal_refused <name> <step> <reason> — exit 1, that step and reason, nothing sealed, no plist, no launchctl call.
p15_refused() {
  local name="$1" step="$2" want="$3" got_step got_reason
  got_step="$(p15_json 'o.step')"
  got_reason="$(p15_json 'o.reasons.join(",")')"
  if [[ "$RC" -eq 1 && "$(p15_json o.ok)" == "false" && "$got_step" == "$step" && "$got_reason" == "$want" && ! -e "$A13_PLIST" && -z "$(a13_calls)" ]]; then ok "$name"
  else bad "$name" "expected exit 1 step [$step] reason [$want], no plist, no launchctl call; got exit $RC step [$got_step] reason [$got_reason]" "stdout: ${OUT:0:300}" "stderr: ${ERR:0:200}"; fi
}

# ---------- P1: the update scenario, one command ----------
a13_sandbox p15-update
a13_run '["install-agent"]'  # the agent runs the old seal
P1_OLD_SEAL="$A13_SEAL"
printf 'plugin updated\n' >>"$PLUGIN_SRC/README.md"  # the plugin update: new bytes, new root hash
cp "$FHOME/.a1-intents/devices.json" "$SB/devices.before"
: >"$A13_LOG"
p15_run '[]'
P1_NEW_SEAL="$(w5b_seal_dir)"
P1_PLIST_TOOLS="$(a13_plist_json "$A13_PLIST" | node -e 'let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => { try { console.log(JSON.parse(s).ProgramArguments[1]); } catch (e) { console.log("<no plist>"); } })')"
if [[ "$RC" -eq 0 && "$(p15_json o.ok)" == "true" && "$(p15_json o.seal.seal_dir)" == "$P1_NEW_SEAL" && "$P1_NEW_SEAL" != "$P1_OLD_SEAL" \
  && "$(p15_json o.seal.files)" -gt 0 && "$(p15_json o.install_agent.action)" == "installed" \
  && "$P1_PLIST_TOOLS" == "$P1_NEW_SEAL/_shared/a1-tools.cjs" && "$(a13_calls)" == *"bootstrap|gui/4242|"* \
  && "$ERR" == *"intent post-update: done"* ]] && cmp -s "$FHOME/.a1-intents/devices.json" "$SB/devices.before"; then
  ok "P1 post-update after a plugin update: new seal, then the agent plist re-pointed to it, one combined JSON, exit 0, devices.json untouched [FR-033 spec016]"
else bad "P1 post-update after a plugin update: new seal, then the agent plist re-pointed to it, one combined JSON, exit 0, devices.json untouched [FR-033 spec016]" "exit $RC" "plist tools: $P1_PLIST_TOOLS new seal: $P1_NEW_SEAL" "stdout: ${OUT:0:400}" "stderr: ${ERR:0:300}" "calls: $(a13_calls)"; fi

# P1b: the plist differs from the existing one (the old seal's) and is replaced without a second flag (--force is in).
if [[ "$P1_PLIST_TOOLS" != "$P1_OLD_SEAL/_shared/a1-tools.cjs" && "$(a13_calls)" == *"bootout"* ]]; then
  ok "P1b the differing plist of the old seal is replaced in the same run (install-agent --force behaviour, no extra flag) [FR-033 spec016]"
else bad "P1b the differing plist of the old seal is replaced in the same run (install-agent --force behaviour, no extra flag) [FR-033 spec016]" "plist tools: $P1_PLIST_TOOLS" "calls: $(a13_calls)"; fi

# ---------- P2-P4: a refusal at the seal step stops everything ----------
p15_unsealed p15-notty
p15_run '[]' '{"sealTty":false}'
p15_refused "P2 no TTY at the seal step: exit 1, step seal, not_a_tty; nothing sealed, install not run [FR-033 spec016]" seal not_a_tty
w5b_nothing_sealed || bad "P2b nothing sealed after the not_a_tty refusal [FR-033 spec016]" "seal dir exists"
p15_unsealed p15-noconfirm
p15_run '[]' '{"sealAnswer":false}'
p15_refused "P3 seal not confirmed: exit 1, step seal, not_confirmed; the install does not run [FR-033 spec016]" seal not_confirmed
if w5b_nothing_sealed; then ok "P3b nothing sealed after the refused confirmation [FR-033 spec016]"; else bad "P3b nothing sealed after the refused confirmation [FR-033 spec016]" "seal dir exists"; fi
p15_unsealed p15-claude
p15_run '[]' '{"sealContext":"real","nodeEnv":{"CLAUDECODE":"1"}}'
p15_refused "P4 Claude Code environment at the seal step: exit 1, step seal, claude_code_context; nothing sealed, install not run [FR-033 spec016]" seal claude_code_context
if w5b_nothing_sealed; then ok "P4b nothing sealed after the claude_code_context refusal [FR-033 spec016]"; else bad "P4b nothing sealed after the claude_code_context refusal [FR-033 spec016]" "seal dir exists"; fi

# ---------- P5-P8: a refusal at the install step keeps its guard ----------
p15_install_refused() { # <name> <reason> — the seal is done, the plist and launchctl untouched
  local name="$1" want="$2"
  if [[ "$RC" -eq 1 && "$(p15_json o.step)" == "install-agent" && "$(p15_json 'o.reasons.join(",")')" == "$want" \
    && -n "$(p15_json o.seal.seal_dir)" && -d "$(p15_json o.seal.seal_dir)" && ! -e "$A13_PLIST" && -z "$(a13_calls)" && "$ERR" == *"seal is done"* ]]; then ok "$name"
  else bad "$name" "expected exit 1 step install-agent reason [$want], seal done, no plist, no launchctl; got exit $RC" "stdout: ${OUT:0:300}" "stderr: ${ERR:0:300}"; fi
}
p15_unsealed p15-install-noconfirm
p15_run '[]' '{"agentAnswer":false}'
p15_install_refused "P5 install not confirmed: exit 1, step install-agent, not_confirmed; seal reported as done, no plist [FR-033 spec016]" not_confirmed
p15_unsealed p15-install-notty
p15_run '[]' '{"agentTty":false}'
p15_install_refused "P6 no TTY at the install step: exit 1, step install-agent, not_a_tty [FR-033 spec016]" not_a_tty
p15_unsealed p15-install-claude
p15_run '[]' '{"agentContext":"real","env":{"CLAUDECODE":"1"}}'
p15_install_refused "P7 Claude Code environment at the install step: exit 1, step install-agent, claude_code_context [FR-033 spec016]" claude_code_context
p15_unsealed p15-install-child
p15_run '[]' '{"child":true}'
p15_install_refused "P8 intent child mode at the install step: exit 1, step install-agent, claude_code_context [FR-033 spec016]" claude_code_context

# ---------- P9-P10: the real CLI, the real guards ----------
new_sandbox p15-cli
set_executor @live
run_intent post-update
if [[ "$RC" -eq 1 && "$(p15_json o.step)" == "seal" && "$(p15_json 'o.reasons.join(",")')" == "not_a_tty" ]] && w5b_nothing_sealed; then ok "P9 the real CLI with stdout redirected: exit 1 step seal not_a_tty, nothing sealed [FR-033 spec016]"
else bad "P9 the real CLI with stdout redirected: exit 1 step seal not_a_tty, nothing sealed [FR-033 spec016]" "exit $RC" "stdout: ${OUT:0:300}"; fi

for p15_variant in "a:env:CLAUDECODE=1:-:environment: .*CLAUDECODE" "b:env:CLAUDE_CODE_ENTRYPOINT=cli:-:environment: .*CLAUDE_CODE_ENTRYPOINT" "c:parent:-:claude:started as claude"; do
  IFS=: read -r p15_id p15_kind p15_env p15_par p15_want <<<"$p15_variant"
  w5b_seal_sandbox "p15-pty-$p15_id"
  [[ "$p15_par" != "-" ]] && { p15_par="$SB/bin/claude"; g14_fakeparent "$p15_par"; }
  g14_pty "$W5B_FALSE_TOOLS" "$p15_env" "$p15_par" post-update
  p15_pj="$(printf '%s\n' "$PTY_OUT" | grep '^{' | tail -n 1)"
  if [[ "$PTY_RC" -eq 1 && "$p15_pj" == *'"claude_code_context"'* && "$p15_pj" == *'"step":"seal"'* ]] && printf '%s' "$PTY_OUT" | grep -qE "$p15_want" \
    && [[ "$PTY_OUT" != *"to seal this copy"* ]] && w5b_nothing_sealed && [[ ! -e "$FHOME/Library/LaunchAgents" ]]; then
    ok "P10$p15_id post-update on a pty under a Claude context ($p15_kind) -> exit 1 step seal claude_code_context, no prompt, nothing sealed, no agent file [FR-033 spec016]"
  else bad "P10$p15_id post-update on a pty under a Claude context ($p15_kind) -> exit 1 step seal claude_code_context, no prompt, nothing sealed, no agent file [FR-033 spec016]" "rc $PTY_RC json: $p15_pj" "pty: ${PTY_OUT:0:400}"; fi
done

# ---------- P11: not reachable from an intent child ----------
w5b_project_sandbox p15-child
P11_BAD=""
for action in new-feature plan execute fix progress; do
  child "$action" real-proj intent post-update
  P11_REASON="$(node -e 'try { const o = JSON.parse(process.argv[1]); console.log(o.error + ":" + o.reason); } catch (e) { console.log("<no json>"); }' "$OUT")"
  [[ "$RC" -eq 77 && "$P11_REASON" == "intent_child_refused:subcommand_not_allowed" ]] || P11_BAD="$P11_BAD $action:$RC:$P11_REASON"
done
if [[ -z "$P11_BAD" ]]; then ok "P11 from an intent child (new-feature, plan, execute, fix, progress) post-update exits 77 subcommand_not_allowed [FR-033 spec016, FR-041]"
else bad "P11 from an intent child (new-feature, plan, execute, fix, progress) post-update exits 77 subcommand_not_allowed [FR-033 spec016, FR-041]" "$P11_BAD"; fi

# ---------- P12: hostile arguments ----------
p15_unsealed p15-hostile
P12_CANARY="$SB/canary"
P12_BIG="$(head -c 10000 /dev/zero | tr '\0' 'A')"
P12_BAD=""
for p12_arg in ';rm -rf /' "\$(touch $P12_CANARY)" "\`touch $P12_CANARY\`" '../../etc/passwd' '/etc/passwd' '--yes' '--force' '--' 'seal' 'install-agent' "$P12_BIG"; do
  p15_run "$(node -e 'process.stdout.write(JSON.stringify([process.argv[1]]))' -- "$p12_arg")"
  if [[ "$RC" -ne 2 || -n "$OUT" || "$ERR" != "usage error: intent post-update takes no arguments"* || -e "$P12_CANARY" || -e "$A13_PLIST" || -n "$(a13_calls)" ]] || ! w5b_nothing_sealed || (( ${#ERR} > 600 )); then
    P12_BAD="$P12_BAD [${p12_arg:0:20}: rc $RC err ${ERR:0:80}]"
  fi
done
if [[ -z "$P12_BAD" ]]; then ok "P12 any argument (injection shapes, traversal, --yes, --force, 10000 chars): exit 2, empty stdout, bounded usage text, nothing sealed, nothing run [FR-033 spec016]"
else bad "P12 any argument (injection shapes, traversal, --yes, --force, 10000 chars): exit 2, empty stdout, bounded usage text, nothing sealed, nothing run [FR-033 spec016]" "$P12_BAD"; fi
new_sandbox p15-cli-big
set_executor @live
run_intent post-update "$P12_BIG"
if [[ "$RC" -eq 2 && -z "$OUT" && "$ERR" == "usage error: "* ]] && w5b_nothing_sealed; then ok "P12b the real CLI with a 10000-char argument: exit 2, nothing sealed [FR-033 spec016]"
else bad "P12b the real CLI with a 10000-char argument: exit 2, nothing sealed [FR-033 spec016]" "exit $RC" "stderr: ${ERR:0:200}"; fi

# ---------- P13: owner-facing text names only post-update ----------
P13_HELP="$(node -e 'process.stdout.write(require(process.argv[1] + "/help-intent.cjs").INTENT_HELP)' "$INTENT_LIB")"
if [[ "$P13_HELP" == *"a1-tools intent post-update"* && "$P13_HELP" == *"intent device add"* && "$P13_HELP" == *"a1-tools intent approve"* ]] \
  && grep -q 'a1-tools intent post-update' "$REPO_ROOT/_shared/intent-contract.md"; then
  ok "P13a help and contract name 'intent post-update'; device add and approve are still listed as their own commands [FR-033 spec016]"
else bad "P13a help and contract name 'intent post-update'; device add and approve are still listed as their own commands [FR-033 spec016]"; fi
# Phrases that tell the owner to run the second step alone. Typed here, not read from the code.
P13_STALE="$(grep -rnE 'run `?(a1-tools )?intent install-agent --force|re-run with --force|pass --force|Re-run after[[:space:]]*$' \
  "$REPO_ROOT/_shared" "$REPO_ROOT/skills" "$REPO_ROOT/agents" "$REPO_ROOT/README.md" "$REPO_ROOT/docs" 2>/dev/null | grep -v '/adr/' || true)"
if [[ -z "$P13_STALE" ]]; then ok "P13b no owner-facing text still tells the owner to run 'install-agent --force' alone [FR-033 spec016]"
else bad "P13b no owner-facing text still tells the owner to run 'install-agent --force' alone [FR-033 spec016]" "$P13_STALE"; fi
w5b_seal_sandbox p15-hint
seal_pty "$A1_TOOLS" yes
if [[ "$PTY_OUT" == *"a1-tools intent post-update"* && "$PTY_OUT" != *"install-agent --force"* ]]; then ok "P13d the stderr hint after 'intent seal' names only 'a1-tools intent post-update' [FR-033 spec016]"
else bad "P13d the stderr hint after 'intent seal' names only 'a1-tools intent post-update' [FR-033 spec016]" "pty: ${PTY_OUT:0:400}"; fi
a13_sandbox p15-plist-hint
cp "$PLUGIN_SRC/README.md" "$SB/readme.keep"
a13_run '["install-agent"]'
printf 'changed\n' >>"$PLUGIN_SRC/README.md"
node "$STUB_DIR/seal-lib.cjs" "$INTENT_LIB" "$FHOME" "$A13_HOST" >/dev/null 2>&1
a13_run '["install-agent"]'
P13_DETAIL="$(node -e 'try { console.log(JSON.parse(process.argv[1]).detail); } catch (e) { console.log("<no json>"); }' "$OUT")"
if [[ "$(a13_reason)" == "plist_exists_differs" && "$P13_DETAIL" == *"a1-tools intent post-update"* && "$P13_DETAIL" != *"pass --force"* ]]; then ok "P13e the plist_exists_differs refusal points the owner to 'a1-tools intent post-update', not to a bare --force [FR-033 spec016]"
else bad "P13e the plist_exists_differs refusal points the owner to 'a1-tools intent post-update', not to a bare --force [FR-033 spec016]" "reason: $(a13_reason)" "detail: ${P13_DETAIL:0:300}"; fi
