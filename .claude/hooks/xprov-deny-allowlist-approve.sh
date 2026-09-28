#!/usr/bin/env bash
# PreToolUse hook (spec 009 FR-030 j, defence in depth): denies every Bash
# command whose text contains `allowlist approve` or `allowlist-approvals`.
# The approval of the snapshot secret-scan allowlist belongs to the owner, in a
# separate terminal; `xprov allowlist approve` refuses agent process trees on
# its own — this hook only stops the attempt earlier. Side effect, accepted:
# agents cannot grep for the store name either.
# Input: the hook JSON on stdin. Output: a deny decision as JSON, or nothing.
input="$(cat)"
command_text="$(printf '%s' "$input" | node -e '
  let raw = ""; process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    try { const j = JSON.parse(raw); process.stdout.write(String((j.tool_input && j.tool_input.command) || "")); }
    catch (_e) { process.stdout.write(raw); } // unparsable input: judge the raw text
  });' 2>/dev/null || printf '%s' "$input")"
case "$command_text" in
  *"allowlist approve"*|*"allowlist-approvals"*)
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The allowlist approval is the owner'"'"'s step: run `a1-tools xprov allowlist approve` yourself in a separate terminal (spec 009 FR-030 j). Agents never run it or read the approval store."}}'
    ;;
esac
exit 0
