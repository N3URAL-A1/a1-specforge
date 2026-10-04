#!/usr/bin/env bash
# PreToolUse hook (spec 009 FR-030 j, defence in depth): denies every Bash
# command whose text contains `allowlist approve` or `allowlist-approvals`.
# The approval of the snapshot secret-scan allowlist belongs to the owner, in a
# separate terminal; `xprov allowlist approve` refuses agent process trees on
# its own — this hook only stops the attempt earlier. Side effect, accepted:
# agents cannot grep for the store name either.
# The command text is normalised before matching (Samuel S-m4): quotes and
# backslash-newline continuations removed, every whitespace run collapsed to one
# space — so `allowlist \<newline>approve`, `allowlist  approve`, a tab or
# `allowlist "approve"` are caught. `allowlist-approval` also covers the
# singular spelling of the store name.
# Spec 009 FR-007 (Wave 7, Samuel MAJOR): the same for the human waiver —
# `xprov waive` and the waiver store path `a1-xprov/waivers`, same
# normalisation. The script keeps its name: .claude/settings.json wires it.
# Without node the raw JSON is judged: JSON `\n` escapes become spaces and
# backslashes go with the quotes, so an escaped `\"waive\"` matches too.
# Input: the hook JSON on stdin. Output: a deny decision as JSON, or nothing.
input="$(cat)"
command_text="$(printf '%s' "$input" | node -e '
  let raw = ""; process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    let t;
    try { const j = JSON.parse(raw); t = String((j.tool_input && j.tool_input.command) || ""); }
    catch (_e) { t = raw; } // unparsable input: judge the raw text
    process.stdout.write(t.replace(/\\\r?\n/g, "").replace(/["\x27]/g, "").replace(/\s+/g, " "));
  });' 2>/dev/null || printf '%s' "$input" | sed 's/\\n/ /g' | tr -d "\"'\\\\" | tr -s '[:space:]' ' ')"
case "$command_text" in
  *"allowlist approve"*|*"allowlist-approval"*)
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The allowlist approval is the owner'"'"'s step: run `a1-tools xprov allowlist approve` yourself in a separate terminal (spec 009 FR-030 j). Agents never run it or read the approval store."}}'
    ;;
  *"xprov waive"*|*"a1-xprov/waivers"*)
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"A waiver is the owner'"'"'s step: run `a1-tools xprov waive` yourself in a separate terminal (spec 009 FR-007). Agents never run it or touch the waiver store."}}'
    ;;
esac
exit 0
