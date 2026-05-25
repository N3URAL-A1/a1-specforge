# a1-reinhard-reviewer (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-reinhard-reviewer.md
```

## Usage in a1-modernize

Spawned in Phase 3 (Gap-Analysis) in parallel with Alex. Reinhard finds security
and quality gaps between the reverse-spec and the code reality. Output contract:
{severity: BLOCKER|MAJOR|MINOR, category, location, description, recommendation,
source_agent: "reinhard"}. Read-only — no code edits.
