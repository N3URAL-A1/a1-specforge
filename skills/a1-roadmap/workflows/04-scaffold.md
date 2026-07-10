# Phase 4: Scaffold

Create the `.a1/` directory structure and write `roadmap.md`.

## Steps

### 4a. Create directory structure
```bash
mkdir -p .a1/phases
# One directory per phase
mkdir -p .a1/phases/M1-P1-<name>
mkdir -p .a1/phases/M1-P2-<name>
# etc.
```

### 4b. Write `.a1/roadmap.md`

Use the format defined in SKILL.md. Include all milestones and phases from Phase 3.
**Every** milestone (`##`) and phase (`###`) heading gets an `<!-- entry: <slug> -->`
marker directly beneath it — kebab-case, unique, immutable once referenced by a
feature. See "Feature → Roadmap Linkage" in SKILL.md for the exact format.

### 4c. Write phase goal files

For each phase directory, write a brief `GOAL.md`:
```markdown
# Phase: <name>

## Goal
<one sentence from Phase 3>

## Scope
- <bullet 1>
- <bullet 2>
- <bullet 3>

## Status
planned — run `a1-plan` to create PLAN.md
```

### 4d. Confirm to user

```
Project scaffolded ✓

.a1/
├── roadmap.md
└── phases/
    ├── M1-P1-<name>/GOAL.md
    ├── M1-P2-<name>/GOAL.md
    └── M2-P1-<name>/GOAL.md

In-flight features:
  <feature-id>    stage: <stage>    scope: <paths>   [grouped under matching roadmap_entry]

Next step: Run `a1-plan` on the first phase to create an executable plan.

Start with M1-P1-<name>? [y/n]
```

The "In-flight features" block is populated by
`node _shared/a1-tools.cjs code-scope list --stale-days 7` — see "In-flight
features (roadmap view)" in SKILL.md for the grouping-by-`roadmap_entry` rule.
Omit the block entirely if there are zero `code_scope` reservations.

If user says yes: hand off to `a1-plan` with the phase goal from GOAL.md.

## Retro (mandatory, every run)

After every run — pass or fail — write one structured entry. Takes 2 minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-roadmap/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: <short description: new project or new milestone>
project: <project-slug>
result: <pass|fail|partial>
issues: [<relevant tags: vision_unclear, stack_mismatch, milestone_too_big, phase_split_wrong, research_skipped_wrongly, scaffold_collision, ...>]
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

**To the learning store** (defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` for an external vault, e.g. Obsidian):
Append the same entry to:
`<learning-store>/pattern/a1-learnings/a1-roadmap.md`

A run with no issues is still useful data — write the entry.
