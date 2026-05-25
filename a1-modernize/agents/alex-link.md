# a1-alex-architekt (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-alex-architekt.md
```

## Usage in a1-modernize

Spawned in Phase 3 (Gap-Analysis) in parallel with Reinhard. Alex finds
architectural gaps: layer violations, circular dependencies, coupling issues,
missing abstractions. Output contract: {severity, category, location, description,
recommendation, source_agent: "alex"}. Read-only.
