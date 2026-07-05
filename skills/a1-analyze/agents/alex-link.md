# Alex — Super Architekt (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

Alex's identity is defined in:

```
~/.claude/agents/a1-alex-architekt.md
```

That file is the single source of truth.

## Usage in a1-analyze

Alex is spawned via the `Task` tool in Phase 3 (Analyze) for these focuses:

| Focus | Mode | Brief location |
|---|---|---|
| `architecture` | System Design Review | inline in workflow Step 2 |
| `onboarding` | Architecture-Storytelling for Newcomers | inline in workflow Step 2 |

## Hard rules

- Read-only in this skill.
- Returns findings in the strict JSON Output Contract.
- BLOCKER reserved for structural damage (circular deps in core, broken module
  boundaries that prevent parallel work).
- Architectural drift findings go to MAJOR; ADR gaps to MINOR unless the
  decision is undocumented AND non-obvious.
