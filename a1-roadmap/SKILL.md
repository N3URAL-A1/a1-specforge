---
name: a1-roadmap
description: >
  Create and manage project roadmaps — milestones, phases, and project scaffolding.
  Produces a roadmap.md and initializes .a1/ structure. MUST trigger when the user says:
  "neues projekt", "new project", "roadmap erstellen", "a1-roadmap", "milestones planen",
  "projekt aufsetzen", "project setup", "meilensteine", "milestone plan erstellen",
  "neue milestone", "new milestone", or any request to plan a project from scratch or
  add a new milestone to an existing project.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---

# a1-roadmap — Project & Milestone Planning

Thin orchestrator. Phase logic in `workflows/`. a1-researcher does domain research.

## When to use

Activate when the user wants to:
- Start a **new project** and plan its milestones and phases
- Add a **new milestone** to an existing project
- Get a **structured breakdown** of a product vision into executable phases

**Output:** `roadmap.md` in `.a1/` + phase directories scaffolded and ready for `a1-plan`.

## Modes

### New Project
Full flow: Discover → Research → Structure → Scaffold

### New Milestone
Abbreviated flow: Understand → Structure → Scaffold (skip full research if project already exists)

## Phases

| # | Phase | Workflow | Agent | Output |
|---|---|---|---|---|
| 1 | Discover | `workflows/01-discover.md` | — (conversation) | Vision doc |
| 2 | Research | `workflows/02-research.md` | a1-researcher | RESEARCH.md |
| 3 | Structure | `workflows/03-structure.md` | — (orchestrator) | Milestone/phase breakdown |
| 4 | Scaffold | `workflows/04-scaffold.md` | — (orchestrator) | .a1/ structure + roadmap.md |

## Storage

```
.a1/
├── roadmap.md              ← milestone/phase overview
└── phases/                 ← one directory per phase (empty until a1-plan runs)
    ├── M1-P1-<name>/
    ├── M1-P2-<name>/
    └── M2-P1-<name>/
```

## Roadmap format

```markdown
---
project: <name>
created: <date>
---

# Roadmap: <project name>

## Vision
<one paragraph>

## Milestone 1: <name>
**Goal:** <one sentence>  
**Success:** <measurable outcome>

### Phase M1-P1: <name>
**Goal:** <one sentence>
**Scope:** <2-3 bullet points>
**Status:** planned

### Phase M1-P2: <name>
[...]

## Milestone 2: <name>
[...]
```

## Hard rules

- Always confirm the milestone/phase breakdown with the user before scaffolding
- Phase names are in format `M<N>-P<N>-<kebab-name>` (e.g., `M1-P1-auth-setup`)
- Never scaffold more than one milestone ahead (avoids over-engineering)
- If project has existing `.a1/`, add new milestone without touching existing phase dirs
