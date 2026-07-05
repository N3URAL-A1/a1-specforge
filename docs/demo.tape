# a1-specforge demo — VHS tape (charmbracelet/vhs)
#
# Renders a ~35s terminal demo of the deterministic gate CLI running against
# the repo's own test fixtures. Every command is real — no faked echo output.
#
# Render:  vhs docs/demo.tape   (requires vhs + ttyd + ffmpeg on the host)
# Output:  docs/assets/demo.gif
#
# Narrative:
#   1. schema-check catches a missing RLS policy in a migration (exit 1)
#   2. the "pass" migration set clears the same gate (exit 0)
#   3. pack validate confirms a shareable gate-pack is well-formed

Output docs/assets/demo.gif

Set FontSize 16
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 40ms

Type "# a1-specforge: deterministic quality gates for Claude Code"
Enter
Sleep 1s

Type "# 1. schema-check finds a migration that forgot Row-Level Security"
Enter
Sleep 800ms
Type "node _shared/a1-tools.cjs schema-check run --migrations _test-fixtures/a1-schema-check/fail-no-rls/migrations"
Enter
Sleep 2500ms

Type "# ^ FAIL, exit 1 — the gate blocks before the bug ships"
Enter
Sleep 1500ms

Type "# 2. the corrected migration set clears the same gate"
Enter
Sleep 800ms
Type "node _shared/a1-tools.cjs schema-check run --migrations _test-fixtures/a1-schema-check/pass/migrations"
Enter
Sleep 2500ms

Type "# 3. validate a gate-pack — a shareable bundle of learned checks"
Enter
Sleep 800ms
Type "node _shared/a1-tools.cjs pack validate _test-fixtures/a1-pack/valid-pack"
Enter
Sleep 2500ms

Type "# same checks run every phase, and the loop feeds new patterns back in."
Enter
Sleep 2500ms
