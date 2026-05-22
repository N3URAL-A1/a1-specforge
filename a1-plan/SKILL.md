---
name: a1-plan
description: >
  Full planning pipeline for an implementation phase: Research → Map → Plan → Audit, producing
  an executor-ready PLAN.md with waves, tasks, and verifiable success criteria. State lives in
  `.a1/phases/<name>/`. MUST trigger when the user says: "plan phase", "phase planen",
  "neue phase planen", "plan erstellen", "PLAN.md erstellen", "a1-plan", "plan this milestone",
  "plan M2-P1", "I need a plan for X", "let's plan the next phase", or any request to turn a
  goal/spec into an actionable, audited plan before execution. Auto-loops back through plan→audit
  on FAIL verdicts (max 2 cycles). Do NOT activate for: feature ideation from scratch (use
  a1-new-feature), bug fixes (use a1-fix), running an existing PLAN.md (use a1-execute),
  or codebase analysis without plan output (use a1-analyze).
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
| 1 | Research | `workflows/01-research.md` | a1-rico-researcher | RESEARCH.md |
| 2 | Map | `workflows/02-map.md` | a1-marco-mapper | MAP.md |
| 3 | Plan | `workflows/03-plan.md` | a1-pablo-planner | PLAN.md |
| 4 | Audit | `workflows/04-audit.md` | a1-adam-auditor | AUDIT.md |

**Audit loop:** If AUDIT.md verdict is FAIL, route back to Phase 3 (a1-pablo-planner in revision mode) with the AUDIT.md findings. Maximum 2 revision cycles.

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
- Never edit PLAN.md directly — always go through a1-pablo-planner
- If the user provides a spec file, pass its path to a1-rico-researcher and a1-pablo-planner
- Present the PLAN.md summary to the user after audit passes — they should confirm before executing
