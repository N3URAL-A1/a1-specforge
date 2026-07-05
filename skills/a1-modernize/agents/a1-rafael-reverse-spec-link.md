# a1-rafael-reverse-spec (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-rafael-reverse-spec.md
```

## Usage in a1-modernize

Spawned in Phase 2 (Reverse-Spec) together with `a1-marco-mapper`.

Marco runs first and produces `MAP.md`. Rafael reads the map and the code,
then extracts observed behavior into the reverse-spec section of the master file.

Brief must include: project path, Marco's MAP.md path, output path, focus scope.
