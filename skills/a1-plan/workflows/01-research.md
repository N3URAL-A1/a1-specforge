# Phase 1: Research

Spawn `a1-rico-researcher` to gather context for this phase.

## Model

Agent default (sonnet) — phase-level research is scoped and volume-heavy.
Do not override to opus here; that is reserved for `a1-roadmap` project research.

## Prompt template

```
Research context for this planning task and write RESEARCH.md.

<files_to_read>
- ./CLAUDE.md (if exists)
- <spec_path> (if provided by user)
</files_to_read>

**Goal:** <phase_goal>
**Output path:** .a1/phases/<phase_name>/RESEARCH.md
**Project path:** <project_path>

Focus areas: tech stack, relevant codebase patterns, external dependencies, risks.
```

## Completion

Research phase is done when `RESEARCH.md` exists at the output path.

Present to user: "Research complete. Key findings: <3-line summary from agent>."

Before Phase 2, read the `## Decisions needed` section of RESEARCH.md (Rico also echoes its
rows at the end of his summary). Put every row that is not `none` to the user with
`AskUserQuestion`, one question per turn, and record the answers in RESEARCH.md under the
same table (`Answer` column) before Marco and Pablo run — a product question left open here
comes back as a plan revision (`_shared/agent-lessons.md#rico-decisions-needed`).
