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
# Spec 012 FR-015 (Wave B): the same for the permit — `xprov permit` (also
# `permit --deny`; NOT `xprov permit-check`, which is read-only) and the denial
# store path `a1-xprov/permit-denials`. A permit or denial is the owner's act:
# without the guard an agent could permit a repository or switch a gate off.
# The store name is matched by its stem `permit-den` (covers a glob such as
# `permit-den*`); the normaliser also drops single backslashes (`per\mit`) and `$`
# before a quote (`$'permit'`), and a variable in the subcommand slot (`xprov $p`)
# is denied. NOT detectable by text: a variable for the tool itself or split over
# several commands (`x=xprov; $x permit`, `eval "$cmd"`); there the TTY/ancestor
# guard of `xprov permit` is the control.
# Without node the raw JSON is judged: JSON `\n` escapes become spaces and
# backslashes go with the quotes, so an escaped `\"waive\"` matches too.
# Spec 016 FR-032 (Wave 4): a command whose every segment starts with a read-only program (grep, rg, cat, head, tail, wc, ls, echo,
# sed -n '<n>p', git log|diff|show; `for NAME in ...; do <read-only>; done` loops count too) and that has no redirect, command
# substitution or backtick only reads or prints text. For it the COMMAND-phrase patterns below (`allowlist approve`, `xprov waive`,
# `xprov permit`, `xprov $`) do not apply: `grep a1-xprov "$S/summary.txt"` is no longer read as `xprov $S`. The STORE-name patterns
# (`allowlist-approval`, `a1-xprov/waivers`, `a1-xprov/permit-den`) apply to every command as before (parts 08/11/12). A quoted-delimiter
# heredoc written by one `cat`/`tee` is judged by its header line: a body that merely mentions a phrase passes, a write TO a store is
# still caught by its target path. `grep x; xprov permit`, `xprov permit`, `xprov $v` and tab-separated forms stay denied: one segment
# that is not read-only puts the whole command back under the patterns. The classifier is xprov-bash-class.cjs (same directory); if it
# cannot run, the old behaviour applies. Not a security boundary: see the notes above on what text cannot detect.
# Input: the hook JSON on stdin. Output: a deny decision as JSON, or nothing.
input="$(cat)"
mode=plain
classified="$(printf '%s' "$input" | node "$(dirname "${BASH_SOURCE[0]}")/xprov-bash-class.cjs" 2>/dev/null)" && {
  mode="${classified%%$'\n'*}"
  [[ "$mode" == heredoc ]] && input="${classified#*$'\n'}"
}
[[ "$mode" == readonly || "$mode" == heredoc ]] || mode=plain
command_text="$(printf '%s' "$input" | node -e '
  let raw = ""; process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    let t;
    try { const j = JSON.parse(raw); t = String((j.tool_input && j.tool_input.command) || ""); }
    catch (_e) { t = raw; } // unparsable input: judge the raw text
    // line continuations, then every single backslash (`per\mit`), `$` before a quote (`$\x27permit\x27`), the quotes
    process.stdout.write(t.replace(/\\\r?\n/g, "").replace(/\\/g, "").replace(/\$(?=["\x27])/g, "").replace(/["\x27]/g, "").replace(/\s+/g, " "));
  });' 2>/dev/null || printf '%s' "$input" | sed 's/\\n/ /g' | tr -d "\"'\\\\\$" | tr -s '[:space:]' ' ')"
deny() {
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$1\"}}"
  exit 0
}
MSG_ALLOWLIST='The allowlist approval is the owner'"'"'s step: run `a1-tools xprov allowlist approve` yourself in a separate terminal (spec 009 FR-030 j). Agents never run it or read the approval store.'
MSG_WAIVE='A waiver is the owner'"'"'s step: run `a1-tools xprov waive` yourself in a separate terminal (spec 009 FR-007). Agents never run it or touch the waiver store.'
MSG_PERMIT='A permit or denial is the owner'"'"'s step: run `a1-tools xprov permit` (or `permit --deny`) yourself in a separate terminal (spec 012 FR-014). Agents never run it or touch the denial store.'
# STORE names: judged for every command, read-only or not.
case "$command_text" in
  *"allowlist-approval"*) deny "$MSG_ALLOWLIST" ;;
  *"a1-xprov/waivers"*) deny "$MSG_WAIVE" ;;
esac
# `xprov permit-check` is read-only: it is removed before matching `xprov permit`, so
# `xprov permit-check && xprov permit --by x` is still caught by its second half.
permit_text="${command_text//xprov permit-check/}"
case "$permit_text" in *"a1-xprov/permit-den"*) deny "$MSG_PERMIT" ;; esac
# COMMAND phrases: not judged for a read-only command (it only prints the text).
if [[ "$mode" != readonly ]]; then
  case "$command_text" in *"allowlist approve"*) deny "$MSG_ALLOWLIST" ;; esac
  case "$command_text" in *"xprov waive"*) deny "$MSG_WAIVE" ;; esac
  case "$permit_text" in *"xprov permit"*|*'xprov $'*) deny "$MSG_PERMIT" ;; esac
fi
exit 0
