#!/usr/bin/env bash
# Plugin hook wrapper (spec 016 FR-004, plan D-5: fail closed). Claude Code treats exit 1 of a hook as non-blocking and only exit 2 as
# blocking, so a missing node, a missing module or a crash in the hook must end in exit 2, never in 1 or 127. The node script sits next
# to this file (no environment variable can point it elsewhere). stdin (the hook JSON) goes through to node untouched.
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
node "$dir/xprov-consent-hook.cjs" || exit 2
