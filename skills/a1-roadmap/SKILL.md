---
name: a1-roadmap
description: >
  Create and manage project roadmaps — break a product vision into milestones,
  phases, and a scaffolded .a1/ directory ready for a1-plan. Four phases:
  Discover (interview vision) → Research (a1-rico-researcher domain scan) →
  Structure (milestones + phases breakdown) → Scaffold (write .a1/roadmap.md +
  per-phase GOAL.md). Two modes: new-project (full flow) and new-milestone
  (abbreviated, skips research if stack unchanged). MUST trigger when the
  user says: "new project" (alias: "neues projekt"), "create a roadmap" (alias:
  "roadmap erstellen"), "a1-roadmap", "plan milestones" (alias: "milestones
  planen"), "set up a project" (alias: "projekt aufsetzen"), "project setup",
  "milestones" (alias: "meilensteine"), "create a milestone plan" (alias:
  "milestone plan erstellen"), "new milestone" (alias: "neue milestone"), "set
  up a project from scratch" (alias: "projekt von null aufsetzen"), "how do we
  structure the project" (alias: "wie strukturieren wir das projekt"), "plan the
  project from scratch", "break this product into milestones", or any request to
  plan a project from scratch or add a new milestone to an existing project. Hands
  off to a1-plan once the first phase is scaffolded. Do NOT activate for:
  planning a single phase that already exists (use a1-plan), checking project
  status (use a1-progress), feature ideas without a project (use
  a1-new-feature), or constitution/rules (use a1-constitution).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-roadmap — Project & Milestone Planning

Language: English-first; German trigger aliases supported.

Thin orchestrator. Phase logic in `workflows/`. a1-rico-researcher does domain research.

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
| 2 | Research | `workflows/02-research.md` | a1-rico-researcher | RESEARCH.md |
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
