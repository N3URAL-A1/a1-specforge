#!/usr/bin/env bash
# cases/14-claude-guard.sh — a1-analyze F-004 (bug intent-approve-guard):
# the three owner commands that read a human answer, or show a secret, on the
# terminal — `intent approve`, `intent seal`, `intent device add` — refuse a
# Claude Code context. A terminal alone proves nothing: an agent gets one
# from script(1). Sourced by run-tests.sh after 13 (reuses w10_* from
# 10-doctor-approve.sh and w5b_* from 05b-child-seal.sh).
#
# Every case runs the real CLI on a real pty (`script`), in a sandbox HOME and
# vault; a delayed "yes" is typed as a script-driving agent would. Nothing of
# the real vault, ~/.a1-intents or seal is touched.
#
# RED proof: removing the guard call at any one site turns that site's cases
# red (the delayed "yes" re-approves / seals / shows the secret in the
# sandbox): cmdIntentApprove (F004-A1*), prepareSeal (F004-A2*), cmdAdd (F004-A3*).
#
# The positive pty cases in 03/05b/10 run the CLI through stub/a1-tools-as.cjs
# with spec {"noClaudeGuard": true}, which replaces the shared helper in the
# loaded copy of xprov-approve.cjs. Nothing here uses that spec.

G14_FEED='process.stdout.on("error", () => process.exit(0)); setTimeout(() => { process.stdout.write("yes\n"); setTimeout(() => {}, 1500); }, 700)'

# NOCLAUDE14 — env argv that unsets every CLAUDECODE / CLAUDE_PID / CLAUDE_CODE_* variable.
NOCLAUDE14=(env)
for v14 in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*)$'); do NOCLAUDE14+=(-u "$v14"); done

# g14_pty <tools> <env-assignment|-> <parent|-> <intent-args...> — the CLI on a
# pty with "yes" typed after a delay. <env-assignment> is e.g. CLAUDECODE=1.
# <parent> = path of a shell copy named `claude` (ancestry case; env stripped).
# Sets PTY_RC, PTY_OUT.
g14_pty() {
  local tools="$1" envvar="$2" parent="$3"
  shift 3
  local inner=("${G14_ENV:-env}" HOME="$FHOME" A1_VAULT_ROOT="$VAULT")
  [[ "$envvar" != "-" ]] && inner+=("$envvar")
  inner+=("${G14_NODE:-node}" "$A1_AS" "$FHOME" - "$tools" intent "$@")
  # Only the injected variable may trigger the refusal, even when the runner is under Claude Code.
  local cmd=("${NOCLAUDE14[@]}" "${inner[@]}")
  [[ -n "${G14_NODE:-}" ]] && cmd=(env -i PATH=/nonexistent "${inner[@]}") # no ps, no lsof: the tree cannot be read
  [[ "$parent" != "-" ]] && cmd=("${NOCLAUDE14[@]}" "$parent" -c '"$@"; exit $?' _ "${inner[@]}")
  if [[ "$(uname -s)" == "Darwin" ]]; then
    node -e "$G14_FEED" | script -q /dev/null "${cmd[@]}" >"$SB/.pty" 2>&1
  else
    node -e "$G14_FEED" | script -qec "$(printf '%q ' "${cmd[@]}")" /dev/null >"$SB/.pty" 2>&1
  fi
  PTY_RC=$?
  PTY_OUT="$(tr -d '\r' <"$SB/.pty")"
}

# g14_fakeparent <path> — a shell copy that keeps its own name (macOS: re-signed ad hoc).
g14_fakeparent() {
  mkdir -p "$(dirname "$1")"
  if [[ "$(uname)" == Darwin ]]; then cp /bin/bash "$1" && codesign -s - -f "$1" >/dev/null 2>&1
  else cp /bin/sh "$1"; fi
  chmod +x "$1"
}

# ---------- A1: intent approve ----------
for g14_variant in "env:CLAUDECODE=1:-:environment: .*CLAUDECODE" "env:CLAUDE_CODE_ENTRYPOINT=cli:-:environment: .*CLAUDE_CODE_ENTRYPOINT" "parent:-:claude:started as claude"; do
  IFS=: read -r g14_kind g14_env g14_par g14_want <<<"$g14_variant"
  g14_label="$g14_kind"; [[ "$g14_env" != "-" ]] && g14_label="$g14_kind ${g14_env%%=*}"
  w10_sandbox "w14-approve-${g14_label// /-}"
  RJ="$(w10_rejected signature_invalid)"
  ID="$(basename "$RJ" .md)"
  cp "$RJ" "$SB/before.md"
  BEFORE="$(tree_listing "$VAULT" "$FHOME/.a1-intents")"
  [[ "$g14_par" != "-" ]] && { g14_par="$SB/bin/claude"; g14_fakeparent "$g14_par"; }
  g14_pty "$A1_TOOLS" "$g14_env" "$g14_par" approve "$RJ"
  if [[ "$PTY_RC" -eq 1 && "$PTY_OUT" == *claude_code_context* ]] && printf '%s' "$PTY_OUT" | grep -qE "$g14_want" \
    && [[ "$PTY_OUT" != *"Approve?"* ]] && cmp -s "$RJ" "$SB/before.md" && [[ -z "$(ls "$Q")" ]] \
    && [[ "$(tree_listing "$VAULT" "$FHOME/.a1-intents")" == "$BEFORE" ]]; then
    ok "F004-A1 ($g14_label) intent approve on a pty under a Claude context -> exit 1 claude_code_context, no prompt, store/rejected/log unchanged [FR-015, F-004]"
  else bad "F004-A1 ($g14_label) intent approve on a pty under a Claude context -> exit 1 claude_code_context, no prompt, store/rejected/log unchanged [FR-015, F-004]" "rc $PTY_RC queued: $(ls "$Q")" "pty: ${PTY_OUT:0:400}"; fi
done

# ---------- A2: intent seal ----------
for g14_variant in "env:CLAUDECODE=1:-:environment: .*CLAUDECODE" "parent:-:claude:started as claude"; do
  IFS=: read -r g14_kind g14_env g14_par g14_want <<<"$g14_variant"
  w5b_seal_sandbox "w14-seal-$g14_kind"
  [[ "$g14_par" != "-" ]] && { g14_par="$SB/bin/claude"; g14_fakeparent "$g14_par"; }
  g14_pty "$W5B_FALSE_TOOLS" "$g14_env" "$g14_par" seal
  g14_json="$(printf '%s\n' "$PTY_OUT" | grep '^{' | tail -n 1)"
  if [[ "$PTY_RC" -eq 1 && "$g14_json" == *'"claude_code_context"'* ]] && printf '%s' "$PTY_OUT" | grep -qE "$g14_want" && w5b_nothing_sealed; then
    ok "F004-A2 ($g14_kind) intent seal on a pty under a Claude context -> exit 1 claude_code_context, nothing sealed [FR-040, F-004]"
  else bad "F004-A2 ($g14_kind) intent seal on a pty under a Claude context -> exit 1 claude_code_context, nothing sealed [FR-040, F-004]" "rc $PTY_RC json: $g14_json" "pty: ${PTY_OUT:0:400}"; fi
done

# ---------- A3: intent device add ----------
for g14_variant in "env:CLAUDECODE=1:-:environment: .*CLAUDECODE" "parent:-:claude:started as claude"; do
  IFS=: read -r g14_kind g14_env g14_par g14_want <<<"$g14_variant"
  new_sandbox "w14-device-$g14_kind"
  cp "$FHOME/.a1-intents/devices.json" "$SB/devices.before"
  [[ "$g14_par" != "-" ]] && { g14_par="$SB/bin/claude"; g14_fakeparent "$g14_par"; }
  g14_pty "$A1_TOOLS" "$g14_env" "$g14_par" device add phone-new
  if [[ "$PTY_RC" -eq 1 && "$PTY_OUT" == *claude_code_context* ]] && printf '%s' "$PTY_OUT" | grep -qE "$g14_want" \
    && cmp -s "$FHOME/.a1-intents/devices.json" "$SB/devices.before" && ! printf '%s' "$PTY_OUT" | grep -qE '[0-9a-f]{64}' \
    && ! grep -q phone-new "$FHOME/.a1-intents/devices.json"; then
    ok "F004-A3 ($g14_kind) intent device add on a pty under a Claude context -> exit 1 claude_code_context, devices.json unchanged, no secret printed [FR-011, F-004]"
  else bad "F004-A3 ($g14_kind) intent device add on a pty under a Claude context -> exit 1 claude_code_context, devices.json unchanged, no secret printed [FR-011, F-004]" "rc $PTY_RC" "pty: ${PTY_OUT:0:400}"; fi
done

# ---------- A5: the process tree cannot be read -> fail closed ----------
# env -i PATH=/nonexistent: no ps, no lsof, no CLAUDE* variable. Pins the try/catch around the walk.
G14_NODE="$(command -v node)"
G14_ENV="$(command -v env)"
w10_sandbox w14-approve-bare
RJ="$(w10_rejected signature_invalid)"
cp "$RJ" "$SB/before.md"
BEFORE="$(tree_listing "$VAULT" "$FHOME/.a1-intents")"
g14_pty "$A1_TOOLS" - - approve "$RJ"
if [[ "$PTY_RC" -eq 1 && "$PTY_OUT" == *claude_code_context* && "$PTY_OUT" == *"cannot read the process tree"* && "$PTY_OUT" != *"Approve?"* ]] \
  && cmp -s "$RJ" "$SB/before.md" && [[ -z "$(ls "$Q")" ]] && [[ "$(tree_listing "$VAULT" "$FHOME/.a1-intents")" == "$BEFORE" ]]; then
  ok "F004-A5 (approve, unreadable process tree) fails closed: exit 1 claude_code_context 'cannot read the process tree', nothing written [FR-015, F-004]"
else bad "F004-A5 (approve, unreadable process tree) fails closed: exit 1 claude_code_context 'cannot read the process tree', nothing written [FR-015, F-004]" "rc $PTY_RC" "pty: ${PTY_OUT:0:400}"; fi
w5b_seal_sandbox w14-seal-bare
g14_pty "$W5B_FALSE_TOOLS" - - seal
g14_json="$(printf '%s\n' "$PTY_OUT" | grep '^{' | tail -n 1)"
if [[ "$PTY_RC" -eq 1 && "$g14_json" == *'"claude_code_context"'* && "$PTY_OUT" == *"cannot read the process tree"* ]] && w5b_nothing_sealed; then
  ok "F004-A5 (seal, unreadable process tree) fails closed: exit 1 claude_code_context, nothing sealed [FR-040, F-004]"
else bad "F004-A5 (seal, unreadable process tree) fails closed: exit 1 claude_code_context, nothing sealed [FR-040, F-004]" "rc $PTY_RC json: $g14_json" "pty: ${PTY_OUT:0:400}"; fi
new_sandbox w14-device-bare
cp "$FHOME/.a1-intents/devices.json" "$SB/devices.before"
g14_pty "$A1_TOOLS" - - device add phone-new
if [[ "$PTY_RC" -eq 1 && "$PTY_OUT" == *claude_code_context* && "$PTY_OUT" == *"cannot read the process tree"* ]] \
  && cmp -s "$FHOME/.a1-intents/devices.json" "$SB/devices.before" && ! printf '%s' "$PTY_OUT" | grep -qE '[0-9a-f]{64}'; then
  ok "F004-A5 (device add, unreadable process tree) fails closed: exit 1 claude_code_context, devices.json unchanged, no secret [FR-011, F-004]"
else bad "F004-A5 (device add, unreadable process tree) fails closed: exit 1 claude_code_context, devices.json unchanged, no secret [FR-011, F-004]" "rc $PTY_RC" "pty: ${PTY_OUT:0:400}"; fi
unset G14_NODE G14_ENV

# ---------- A4: the shared helper ----------
g14_helper="$(CLAUDE_PID= CLAUDECODE=1 node -e 'const X = require(process.argv[1] + "/xprov-approve.cjs"); process.stdout.write(typeof X.claudeContextRefusal === "function" ? String(X.claudeContextRefusal({ CLAUDECODE: "1" })) : "<no export>")' "$INTENT_LIB" 2>&1)"
if [[ "$g14_helper" == "environment: CLAUDECODE" ]]; then ok "F004-A4 xprov-approve exports claudeContextRefusal(env): names the variable [FR-040, F-004]"
else bad "F004-A4 xprov-approve exports claudeContextRefusal(env): names the variable [FR-040, F-004]" "got: $g14_helper"; fi
