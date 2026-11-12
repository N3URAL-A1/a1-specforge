<!-- a1-ux-studio run.md template, rendered only by scripts/run/run.cjs init.
Render rule: strip this leading comment (through the first "-->" line) so the frontmatter starts at line 1.
Placeholders, written below as double-brace tokens around these names:
  spec_id            spec id or adhoc-<YYYY-MM-DD>-<topic-slug>
  project            project slug
  screen             screen slug
  created            YYYY-MM-DD (the --date value or today)
  status             run status; init writes "brief"
  aesthetic          brief.aesthetic, verbatim
  reference          brief.reference, verbatim; "none" when empty
  intent_text        brief.intent.text, verbatim
  intent_context     brief.intent.context: brand | product
  intent_viewport    brief.intent.viewport: desktop-first | mobile parity
  guardrails_always  brief.guardrails.always, one "- <item>" line per entry; "- none" when empty
  guardrails_never   brief.guardrails.never, one "- <item>" line per entry; "- none" when empty
-->
---
spec_id: {{spec_id}}
project: {{project}}
screen: {{screen}}
created: {{created}}
status: {{status}}
---

# UX run: {{screen}} ({{spec_id}})

## Brief

### Aesthetic

{{aesthetic}}

### Reference

{{reference}}

Match the feeling, do not copy.

### Intent

{{intent_text}}

Context: {{intent_context}}
Viewport: {{intent_viewport}}

### Guardrails

Always:

{{guardrails_always}}

Never:

{{guardrails_never}}

## Picks

## Assets

## Screenshots

<!-- gate-record:start -->
<!-- gate-record:end -->
