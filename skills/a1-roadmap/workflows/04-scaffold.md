# Phase 4: Scaffold

Create the `docs/product/` layer (schema v1, rolling-wave ROADMAP.md — the
binding contract) and the `.a1/` directory structure (machine execution state
only — phases/waves/status, unchanged from before this feature).

## Steps

### 4a. Scaffold docs/product/ (schema v1, rolling-wave) — new projects only

For a **new project** (this phase's "New Project" mode), the full
`docs/product/` structure is created at scaffold time via the CLI — never by
hand-writing `ROADMAP.md`:

```bash
node <repo>/_shared/a1-tools.cjs product init \
  --project <slug> --title "<Product name>" \
  --milestones '<json array from Phase 3: [{"id":"<m-slug>","title":"<short>","status":"planned","target":"<YYYY-MM|null>"}]>' \
  --features '<json array from Phase 3: [{"id":"<###-feature-slug>","milestone":"<m-slug>","title":"<short>","status":"planned","depends_on":[]}]>' \
  --source "scaffolded by a1-roadmap (new-project mode)"
```

This single call must produce a `docs/product/ROADMAP.md` that names **ALL**
milestones and **ALL** features known from Phase 3 upfront — each with its
1-sentence goal — per the rolling-wave contract in `docs/product/SCHEMA.md`
§1. It also regenerates `NEXT.md` and `index.json` (same
`regenerateDerived` path Wave 2/3 use for `product stage`). Do not hand-write
any of the three files.

For a **New Milestone** run on a project that already has `docs/product/`,
extend the existing `ROADMAP.md` instead of re-initializing:

```bash
node <repo>/_shared/a1-tools.cjs product add-milestone \
  --project <slug> --id <m-slug> --title "<short>" --status planned --target <YYYY-MM|null>
node <repo>/_shared/a1-tools.cjs product add-feature \
  --project <slug> --id <###-feature-slug> --milestone <m-slug> --title "<short>" --status planned
# repeat add-feature for every feature named in Phase 3 under this milestone
```

If the project is **legacy-only** (has `.a1/roadmap.md`, no `docs/product/`)
and the user has not explicitly requested `adopt` mode for this run: do not
silently scaffold `docs/product/` alongside the legacy file. Ask once:

> This project only has the legacy `.a1/roadmap.md`. Scaffold the new
> `docs/product/ROADMAP.md` (schema v1) alongside it now, or run `a1-roadmap`
> in `adopt` mode instead to properly migrate the existing history?

Proceed with whichever the user picks — never both silently.

### 4b. Create `.a1/` directory structure (machine execution state, unchanged)

```bash
mkdir -p .a1/phases
# One directory per phase
mkdir -p .a1/phases/M1-P1-<name>
mkdir -p .a1/phases/M1-P2-<name>
# etc.
```

`.a1/` holds phase/wave execution state only (`GOAL.md`, later
`PLAN.md`/`STATUS.md`/`VERIFICATION.md` from `a1-plan`/`a1-execute`) — it is
no longer the source of truth for the roadmap itself once `docs/product/`
exists. Keep it scaffolded exactly as before this feature; `a1-plan` and
`a1-execute` still read/write it unchanged.

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

docs/product/
├── ROADMAP.md    (schema v1 — ALL milestones + ALL features named upfront)
├── NEXT.md       (generated)
└── index.json    (generated)

.a1/
└── phases/
    ├── M1-P1-<name>/GOAL.md
    ├── M1-P2-<name>/GOAL.md
    └── M2-P1-<name>/GOAL.md

In-flight features:
  <feature-id>    stage: <stage>    scope: <paths>   [grouped under matching roadmap_entry]

Next step: Run `a1-plan` on the first phase to create an executable plan.

Start with M1-P1-<name>? [y/n]
```

(Legacy-only projects that declined `docs/product/` scaffolding at Step 4a
show only the `.a1/` block, unchanged from before this feature.)

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
