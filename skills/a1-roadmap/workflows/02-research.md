# Phase 2: Research

Spawn `a1-rico-researcher` for domain and tech research.

## When to run

- **New project:** Always — need to validate stack choices, understand ecosystem
- **New milestone:** Only if new tech/domain is involved — skip if same stack as prior milestones

## Model

Spawn with `model: "opus"` (Agent tool override). Project-level research runs
once per project and decides the stack — judgment tier per
`token-optimization.md`. Phase-level research (`a1-plan`) stays on the agent
default (sonnet).

## Prompt template

```
Research the domain and tech stack for this project roadmap.

**Vision summary:**
<paste vision summary from Phase 1>

**Output path:** .a1/RESEARCH.md
**Focus:** tech stack recommendations, ecosystem maturity, key risks, implementation patterns
```

## Completion

When RESEARCH.md exists at `.a1/RESEARCH.md`.

Before moving on, read its `## Decisions needed` section (also echoed at the end of
the researcher's summary). Put every row that is not `none` to the user with
`AskUserQuestion`, one question per turn, and record the answers in `.a1/RESEARCH.md`
under the same table (`Answer` column) before Phase 3 structures milestones — a
product question left "open" here resurfaces after the plan is written
(`_shared/agent-lessons.md#rico-decisions-needed`).

Brief user: "Research done. Key finding: <most important thing>. Moving to milestone planning."
