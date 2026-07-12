# Phase 05 — Plan

Goal: decompose gap findings + approved proposals into an executable wave plan.
Output: `plan.md` + wave skeletons in `.a1/`, `waves` array in frontmatter,
status `planned`.

**Stop-gate G3 after this phase.** Robert approves the full plan.

## Step 1 — Prepare planner input

Compile a planning brief:

```markdown
## Modernize Plan Input

**Project:** <slug>
**Code path:** <analyzed_path>

**Gap Findings to address:**
- BLOCKER: <list with file:line and recommendation>
- MAJOR (selected): <list>

**Approved Proposals:**
- P-001: <title> (risk: <r>, effort: <e>)
- P-002: ...

**Constraints:**
- Functional parity required: every wave must pass behavior snapshot replay
- Each wave must include unit tests (a1-theo-test-engineer pattern)
- No DB schema change without explicit migration task in the same wave
- Rollback path required per wave
```

## Step 2 — Spawn a1-pablo-planner

Brief:
```
Input: <planning brief above>
Output: PLAN.md written to .a1/phases/<modernize-slug>/PLAN.md
Wave format per wave:
  - Wave ID: W-NN
  - Title
  - Goal (one sentence)
  - FRs: [FR-001 — AC: <behavioral sentence>, ...]
  - Deployment chain: [migrations, RLS grants, ENV vars, services to restart]
  - Test requirement: yes (a1-theo will provide skeleton)
  - Rollback: <how to undo>
  - Depends on: [W-XX, ...]
Wave ordering: resolve dependencies, no circular deps.
Max waves: 8 for a typical brownfield run. If more needed, flag for Robert.
```

## Step 3 — Spawn a1-adam-auditor (after Pablo completes)

Brief:
```
Plan path: .a1/phases/<modernize-slug>/PLAN.md
Check:
  1. Every BLOCKER finding from gap-analysis is addressed in at least one wave
  2. Every approved proposal (P-001, ...) has at least one wave
  3. No wave has circular dependencies
  4. Every wave has: goal, FRs with ACs, deployment chain, rollback, test requirement
  5. FR coverage: every FR in reverse-spec that we're touching has an AC in a wave
Report: BLOCKER gaps (wave plan misses a BLOCKER finding), MAJOR gaps, MINOR
```

Fix any BLOCKER audit findings before proceeding. Ask Robert about MAJOR gaps.

## Step 4 — Add waves to frontmatter

For each wave in the plan:

```bash
node <repo>/_shared/a1-tools.cjs modernize add-wave \
  "<master-path>" \
  --title "<title>" \
  [--depends-on "W-01,W-02"]
```

## Step 5 — Update status

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" planned \
  --phase-data '{"plan_path": ".a1/phases/<slug>/PLAN.md", "wave_count": <N>}'
```

## Step 6 — Gate G3: present plan to Robert

Show wave summary:

```
Plan complete for <project-slug>. <N> waves.

W-01: <title> (depends on: none)
W-02: <title> (depends on: W-01)
...

Full plan: `.a1/phases/<modernize-slug>/PLAN.md`

Shall I start Phase 6 (Execution — wave by wave, each with your approval)?
```

Do not proceed without confirmation. Proceed to `06-execute.md`.
