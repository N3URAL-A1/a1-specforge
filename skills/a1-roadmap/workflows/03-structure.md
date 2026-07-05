# Phase 3: Structure

Break the vision into milestones and phases. Present for user approval before scaffolding.

## Milestone design principles

- **One milestone = one shippable increment** (user can derive value from it)
- **2-4 phases per milestone** — if more, split the milestone
- **One phase = one focused area of work** (auth, data model, UI, integrations)
- **Phases within a milestone are roughly sequential** (though parallelism is noted)

## Phase naming

Format: `M<N>-P<N>-<kebab-description>`
Examples:
- `M1-P1-data-model`
- `M1-P2-auth`
- `M1-P3-core-api`
- `M2-P1-dashboard-ui`

## Breakdown template

For each milestone:
1. State the milestone goal (one sentence)
2. Define measurable success criteria
3. Break into 2-4 phases
4. For each phase: one-line goal + 3-bullet scope

## Presentation to user

```
Here's my proposed breakdown:

## Milestone 1: <name>
Goal: <one sentence>
Success: <measurable outcome>

  Phase M1-P1: <name>
  Goal: <one sentence>
  Scope:
  - <bullet 1>
  - <bullet 2>
  - <bullet 3>

  Phase M1-P2: <name>
  [...]

## Milestone 2: <name>
[...]

Does this look right? I'll scaffold the directories once you confirm.
Changes? Tell me what to adjust.
```

Wait for user confirmation before proceeding to Phase 4.
