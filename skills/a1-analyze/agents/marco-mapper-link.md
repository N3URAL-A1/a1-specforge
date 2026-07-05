# a1-marco-mapper — Repository Map Builder (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

The a1-marco-mapper is a codebase exploration agent available at
`~/.claude/agents/a1-marco-mapper.md` or an equivalent agent in your
local setup. Its formal definition lives in your agent library; refer to
that agent's own documentation.

## Usage in a1-analyze

a1-marco-mapper is dispatched in Phase 3 for these focuses:

| Focus | What it maps |
|---|---|
| `general` | High-level module map, entry points, data flow |
| `quality` | Complexity hotspots, dead-code candidates, test-coverage gaps (if detectable) |
| `onboarding` | Reader's map: "start here, then here, then here" |

When available as a dedicated subagent_type, prefer it. Otherwise use
`general-purpose` with the agent persona declared in the brief's first line.

## Hard rules

- Read-only in this skill.
- Returns findings in the strict JSON Output Contract.
- The mapper's findings are usually about STRUCTURE, not defects. Map gaps go
  to MAJOR (if blocking onboarding) or MINOR (otherwise).
- Mapper does NOT do security or architecture-quality judgment — that's
  Reinhard's and Alex's job. If overlap arises, mapper's findings have lower
  authority and may be merged into the specialist's findings during synthesis.
