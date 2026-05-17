# Alex — alex-super-architekt (linked sub-agent)

Used in Phase 3 (Probe) as a secondary architecture-level prober when the
spec has > 5 function/endpoint anchors. Catches DIVERGED cases where the
artifact technically exists but the abstraction has drifted (wrong module,
wrong layer, broken boundary).

Definition source: `~/.claude/agents/alex-super-architekt.md` (canonical).

This file is a pointer, not a redefinition.

## How a1-reconcile uses it

- Dispatched in parallel with `codebase-mapper` via `Task` tool.
- Brief from `templates/agent-probe-brief.md`, with a header hint at the top:
  "Focus: Architecture drift. Do not spend time on file existence —
  codebase-mapper covers that. Look instead for Boundary/Layer/Coupling drift
  against the spec expectation."
- **JSON-only output is mandatory.** Alex tends to produce prose explanations.
  The brief must start with: "IMPORTANT: Return ONLY a JSON array. No text
  before or after. No headers. No markdown. Only the array." The workflow
  must re-ask once if Alex returns prose, and record failure if he does it twice.
- Read-only.
- Same Output Contract as codebase-mapper.
- Conflicts with codebase-mapper output are resolved in Phase 3 Step 4:
  higher-severity class wins (DIVERGED > MISSING > EXTRA > STALE > IN_SYNC).
- Alex is NOT dispatched for MISSING/EXTRA checks — codebase-mapper owns those.
  Alex's value is DIVERGED detection (wrong layer, broken boundary, coupling shift).
