# Phase 2: Map

Spawn `a1-marco-mapper` to map the codebase structure relevant to this phase.

## Prompt template

```
Map the codebase for this planning task and write MAP.md.

<files_to_read>
- .a1/phases/<phase_name>/RESEARCH.md
</files_to_read>

**Task context:** <phase_goal>
**Output path:** .a1/phases/<phase_name>/MAP.md
**Focus:** all (tech + arch + quality + concerns)
```

## Completion

Map phase is done when `MAP.md` exists at the output path.

Present to user: "Codebase mapped. Structure understood."

Note: If this is a new/empty project, MAP.md will be minimal — that's fine, a1-pablo-planner handles it.
