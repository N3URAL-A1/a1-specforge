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

Next step: Run `a1-plan` on the first phase to create an executable plan.

Start with M1-P1-<name>? [y/n]
```

If user says yes: hand off to `a1-plan` with the phase goal from GOAL.md.
