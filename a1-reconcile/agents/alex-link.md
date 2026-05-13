# Alex — alex-super-architekt (linked sub-agent)

Used in Phase 3 (Probe) as a secondary architecture-level prober when the
spec has > 5 function/endpoint anchors. Catches DIVERGED cases where the
artifact technically exists but the abstraction has drifted (wrong module,
wrong layer, broken boundary).

Definition source: `~/.claude/agents/alex-super-architekt.md` (canonical).

This file is a pointer, not a redefinition.

## How a1-reconcile uses it

- Dispatched in parallel with `codebase-mapper` via `Task` tool.
- Brief from `templates/agent-probe-brief.md`, with a hint at the top:
  "Fokus: Architektur-Drift. Verbringe keine Zeit mit Datei-Existenz —
  codebase-mapper deckt das ab. Suche stattdessen nach Boundary-/Layer-/
  Coupling-Drift gegenüber Spec-Erwartung."
- Read-only.
- Same Output Contract as codebase-mapper.
- Conflicts with codebase-mapper output are resolved in Phase 3 Step 4:
  higher-severity class wins (DIVERGED > MISSING > EXTRA > STALE > IN_SYNC).
