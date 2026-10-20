#!/usr/bin/env bash
# Plugin hook wrapper for the Bash matcher (spec 016 wave 10, W10-1): the merge block for `gh pr merge` / `gh api .../pulls/<n>/merge`.
# Blast radius: this matcher sees EVERY Bash call of every repository, so a broken node, module or plugin must not block all of them.
# The early-out below runs in pure shell, before node: any command that merges necessarily contains the substring `merge` or `Merge` (case-sensitive; `enablePullRequestAutoMerge`;
# obfuscated forms are tier 0, see the ADR), so a payload without it is allowed here at once. Only a payload that contains `merge` goes to
# node, and then it fails closed as the other matchers do: Claude Code treats exit 1 of a hook as non-blocking and only exit 2 as blocking,
# so a missing node, a missing module or a crash ends in exit 2, never in 1 or 127.
# stdin is read once with shell builtins only (no cat, no node) and handed to node unchanged.
IFS= read -r -d '' input || true
case "$input" in
  *merge*|*Merge*) ;;
  *) exit 0 ;;
esac
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
printf '%s' "$input" | node "$dir/xprov-consent-hook.cjs" || exit 2
