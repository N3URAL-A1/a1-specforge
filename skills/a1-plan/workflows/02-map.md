# Phase 2: Map

Spawn `a1-marco-mapper` to map the codebase structure relevant to this phase.

> **Model override (2026-09-03):** a1-marco-mapper defaults to haiku, which is
> right for small/greenfield repos. For brownfield mapping pass
> `model: "sonnet"` to the Agent tool when the repo has more than 200 tracked
> files — check first: `git ls-files | wc -l` (or `find . -type f -not -path
> './node_modules/*' -not -path './.git/*' | wc -l` outside git).

## Prompt template

Marco runs in the same turn as Rico (group `research-map`, see `01-research.md`), so his prompt names no Phase 1 output file. Pablo still reads the Phase 1 research file and MAP.md.

<!-- a1:parallel group=research-map -->

```
Map the codebase for this planning task and write MAP.md.

<files_to_read>
- ./CLAUDE.md (if exists)
- <spec_path> (if provided by user)
</files_to_read>

**Task context:** <phase_goal>
**Output path:** .a1/phases/<phase_name>/MAP.md
**Focus:** all (tech + arch + quality + concerns)
```

## Completion

Map phase is done when `MAP.md` exists at the output path.

Present to user: "Codebase mapped. Structure understood."

Note: If this is a new/empty project, MAP.md will be minimal — that's fine, a1-pablo-planner handles it.
