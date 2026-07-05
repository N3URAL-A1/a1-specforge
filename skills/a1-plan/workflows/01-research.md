# Phase 1: Research

Spawn `a1-rico-researcher` to gather context for this phase.

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
