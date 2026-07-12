# Phase 1: Load Plan

Read the plan and confirm with the user before executing.

## Step 0 — Roadmap Gate (hard gate, before anything else)

Run the canonical check exactly as defined in
`_shared/roadmap-gate-check.md` (existence with docs/product preference →
parseability), using its bash snippets and user-facing prompt wordings
verbatim. Caller-specific values for this skill:

- `<work>` in the MISSING prompt = **"Phase execution"**.
- **MISSING / UNPARSEABLE** → HALT: do not load or execute any wave until
  the user has run `a1-roadmap` (unparseable additionally requires the
  explicit do-not-overwrite confirmation before handing off).
- **PARSEABLE** → proceed to Step 0b.

## Step 0b — Roadmap-entry membership check (only if a phase-to-roadmap linkage is known)

Same canonical membership check as `_shared/roadmap-gate-check.md` §3.
This only applies once the phase declares which roadmap entry it belongs to — read
the `roadmap_entry:` (or equivalent linkage) field from `GOAL.md` / `PLAN.md`
frontmatter in `.a1/phases/<phase_name>/`. If no such field exists yet, skip this
check and proceed to Step 1.

If a `roadmap_entry: <slug>` value exists:

```bash
grep -q "<!-- entry: <slug> -->" "$ROADMAP_FILE" && echo "FOUND" || echo "MISMATCH"
```

- **FOUND** → proceed to Step 1.
- **MISMATCH** → **soft stop.** Do not halt outright — surface a notice and let
  the user decide:

  > This phase's `roadmap_entry: <slug>` does not match any entry in the
  > project roadmap. Continue anyway, fix the roadmap_entry value, or add the
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
