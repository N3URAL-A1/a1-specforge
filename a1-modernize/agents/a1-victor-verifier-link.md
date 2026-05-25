# a1-victor-verifier (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-victor-verifier.md
```

## Usage in a1-modernize

Spawned per wave in Phase 6 (Execute) after Erik's implementation. Victor
checks goal-backward: does the codebase now deliver what the wave's FR-ACs
promised? Produces VERIFICATION.md in `.a1/phases/<slug>/waves/<wave-id>/`.
