---
name: a1-plan
description: >
  Full planning pipeline for a project phase. Research → Map codebase → Create plan → Audit plan.
  Produces a verified, executor-ready PLAN.md. State lives in `.a1/phases/<name>/`.
  MUST trigger when the user says: "phase planen", "plan phase", "a1-plan", "neue phase",
  "plan erstellen", "plan this", "plan phase <name>", or any request to plan a phase or
  milestone of implementation work. Do not activate for: feature ideation (use a1-new-feature),
  bug fixes (use a1-fix), or executing an existing plan (use a1-execute).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---

# a1-plan — Phase Planning Pipeline

Thin orchestrator. Phase logic is in `workflows/`. Sub-agents do the thinking.

## When to use

Activate when the user wants to **plan a phase** of implementation work — not execute it, not ideate it.

The output is a PLAN.md that's ready for `a1-execute`.

## Phases

| # | Phase | Workflow | Agent | Output |
|---|---|---|---|---|
| 1 | Research | `workflows/01-research.md` | a1-researcher | RESEARCH.md |
| 2 | Map | `workflows/02-map.md` | a1-mapper | MAP.md |
| 3 | Plan | `workflows/03-plan.md` | a1-planner | PLAN.md |
| 4 | Audit | `workflows/04-audit.md` | a1-auditor | AUDIT.md |

**Audit loop:** If AUDIT.md verdict is FAIL, route back to Phase 3 (a1-planner in revision mode) with the AUDIT.md findings. Maximum 2 revision cycles.

## Storage

All artifacts live in `.a1/phases/<phase-name>/` in the project directory:

```
.a1/
└── phases/
    └── <phase-name>/
        ├── RESEARCH.md
        ├── MAP.md
        ├── PLAN.md
        └── AUDIT.md
```

The phase directory is created automatically. Phase names are kebab-case from the user's description.

## Routing

1. Ask for: project path (default: current directory) + phase name/goal
2. Create `.a1/phases/<name>/` if not exists
3. Run Phase 1 → 2 → 3 → 4 in sequence (each phase needs the previous output)
4. If AUDIT fails → Phase 3 (revision mode) → Phase 4 (re-audit)
5. Present final PLAN.md location and brief summary

## Hard rules

- Never skip phases — research and mapping take minutes and prevent rework
- Never edit PLAN.md directly — always go through a1-planner
- If the user provides a spec file, pass its path to a1-researcher and a1-planner
- Present the PLAN.md summary to the user after audit passes — they should confirm before executing
