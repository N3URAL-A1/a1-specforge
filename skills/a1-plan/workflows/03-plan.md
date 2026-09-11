# Phase 3: Plan

Spawn `a1-pablo-planner` to create the PLAN.md.

## Shared-interface contract (HARD, only when >1 phase is planned in one run)

Fix the shared surface BEFORE the first planner spawns, and hand every planner
the same block verbatim inside its prompt:

- field names of every shared schema or payload, spelled out
- **the owner phase per field** — exactly one phase writes it, the rest read it
- server-wide lists (operator ids, allow-lists): one location, named
- token / permission classes that cross a phase boundary

Left unfixed, each planner invents its own spelling and the auditors find the
same second truth once per phase. 2026-09-10, n3ural-contentbot M4-P1…P6: three
separate BLOCKERs, one per phase, all this one root cause.

**Dated facts line per neighbour phase (HARD).** Every plan records, for each
neighbour phase it depends on, which artifact it was planned against and when:

```
Neighbour M4-P2 — PLAN.md rev 4, read 2026-09-10
```

When phases are planned concurrently the facts go stale within hours. Planning
against a neighbour's RESEARCH while its PLAN was already final produced a
duplicate build of five modules (M4-P4). Auditors check this line against the
neighbour's current state, not against its research.

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
**Lane decision required:** Step 4.5 — set `lanes:` in the frontmatter, either
`none` (the default, with a one-line reason) or a lane block. Then verify it:
`node <repo>/_shared/a1-tools.cjs lane-split check --plan <output path>`.
<if revision_mode>
**Mode:** REVISION — the AUDIT.md contains BLOCKER findings that must be resolved.
</if>
```

## Lane gate (deterministic, after Pablo returns)

```bash
node <repo>/_shared/a1-tools.cjs lane-split check --plan .a1/phases/<phase_name>/PLAN.md
```

Exit 0 → proceed to the audit. Exit 1 → the declared lane split is unsound
(overlapping write sets, unassigned waves, cross-lane dependency, or a cutover
wave inside a lane); hand the findings back to a1-pablo-planner as a revision
before Adam sees the plan. Exit 2 → usage/parse error, fix the invocation.

A plan without lanes exits 0 — this gate is free for the sequential default.

## Completion

Planning phase is done when `PLAN.md` exists at the output path with `status: planned` (or `status: revised`) in frontmatter, and `lane-split check` exits 0.

## Revision mode

If this is Phase 3 in a revision loop (AUDIT returned FAIL):
- Pass both PLAN.md and AUDIT.md to a1-pablo-planner
- Include "Mode: REVISION" in the prompt
- a1-pablo-planner will update PLAN.md and mark it as `status: revised`
