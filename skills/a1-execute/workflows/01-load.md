# Phase 1: Load Plan

Read the plan and confirm with the user before executing.

## Step 0 — Roadmap Gate (hard gate, before anything else)

Deterministic, read-only check — same convention as `a1-new-feature` Phase 0
(see `a1-roadmap` SKILL.md "Feature → Roadmap Linkage" for the schema).

```bash
test -f .a1/roadmap.md && echo "EXISTS" || echo "MISSING"
```

- **MISSING** → **HALT.** Do not proceed to Step 1. Tell the user:

  > No `.a1/roadmap.md` found for this project. Phase execution needs a
  > roadmap to link into. Routing to `a1-roadmap` to create one first.

  Hand off to the `a1-roadmap` skill; do not load or execute any wave until
  the user has run it.

- **EXISTS but unparseable** (no frontmatter or no `<!-- entry: -->` markers):

  ```bash
  grep -q '^---' .a1/roadmap.md && grep -q '<!-- entry:' .a1/roadmap.md && echo "PARSEABLE" || echo "UNPARSEABLE"
  ```

  Treat as missing (do not proceed), but the file already exists — **never
  overwrite it silently**. Warn the user explicitly and get confirmation
  before routing to `a1-roadmap`:

  > `.a1/roadmap.md` exists but does not look like a valid roadmap. I will
  > not overwrite it automatically — confirm before I hand off to
  > `a1-roadmap`, or fix it yourself and re-run.

- **PARSEABLE** → proceed to Step 0b.

## Step 0b — Roadmap-entry membership check (only if a phase-to-roadmap linkage is known)

Same convention as `a1-new-feature` Phase 0 Step 3 (`workflows/00-roadmap-gate.md`).
This only applies once the phase declares which roadmap entry it belongs to — read
the `roadmap_entry:` (or equivalent linkage) field from `GOAL.md` / `PLAN.md`
frontmatter in `.a1/phases/<phase_name>/`. If no such field exists yet, skip this
check and proceed to Step 1.

If a `roadmap_entry: <slug>` value exists:

```bash
grep -q "<!-- entry: <slug> -->" .a1/roadmap.md && echo "FOUND" || echo "MISMATCH"
```

- **FOUND** → proceed to Step 1.
- **MISMATCH** → **soft stop.** Do not halt outright — surface a notice and let
  the user decide:

  > This phase's `roadmap_entry: <slug>` does not match any entry in
  > `.a1/roadmap.md`. Continue anyway, fix the roadmap_entry value, or add the
  > missing entry to the roadmap first?

  Proceed only after explicit user confirmation to continue.

## Steps

1. Find PLAN.md at `.a1/phases/<phase_name>/PLAN.md`
   - If not found: "No plan found. Run `a1-plan` first to create one."

2. Read PLAN.md — extract:
   - Goal
   - Wave count and names
   - Success criteria
   - Total task count

3. Check STATUS.md for already-completed waves:
   ```bash
   cat .a1/phases/<phase_name>/STATUS.md 2>/dev/null
   ```

4. Check git status:
   ```bash
   git status --short
   git log --oneline -5
   ```

5. Present to user:
   ```
   Ready to execute: <phase name>
   Goal: <one sentence>
   
   Waves:
   → Wave 1: <name> (3 tasks) [ready]
   ✓ Wave 2: <name> (2 tasks) [already done — skip]
   
   This will create ~<N> commits.
   
   Proceed? [y/n]
   ```

6. Wait for user confirmation before proceeding to Phase 2.
