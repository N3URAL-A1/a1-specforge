# Phase 3: Plan

Spawn `a1-pablo-planner` to create the PLAN.md.

## Prompt template

```
Create an executable PLAN.md for this phase.

<files_to_read>
- .a1/phases/<phase_name>/RESEARCH.md
- .a1/phases/<phase_name>/MAP.md
- <spec_path> (if provided)
- .a1/phases/<phase_name>/PLAN.md (if revision mode — include AUDIT.md too)
- .a1/phases/<phase_name>/AUDIT.md (revision mode only)
</files_to_read>

**Goal:** <phase_goal>
**Output path:** .a1/phases/<phase_name>/PLAN.md
<if revision_mode>
**Mode:** REVISION — the AUDIT.md contains BLOCKER findings that must be resolved.
</if>
```

## Completion

Planning phase is done when `PLAN.md` exists at the output path with `status: planned` (or `status: revised`) in frontmatter.

## Revision mode

If this is Phase 3 in a revision loop (AUDIT returned FAIL):
- Pass both PLAN.md and AUDIT.md to a1-pablo-planner
- Include "Mode: REVISION" in the prompt
- a1-pablo-planner will update PLAN.md and mark it as `status: revised`
