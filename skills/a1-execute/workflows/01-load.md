# Phase 1: Load Plan

Read the plan and confirm with the user before executing.

## Step 0 — Roadmap Gate (hard gate, before anything else)

Deterministic, read-only check — same convention as `a1-new-feature` Phase 0
(see `a1-roadmap` SKILL.md "Feature → Roadmap Linkage" for the schema).

`docs/product/ROADMAP.md` (schema v1) is the **preferred** source — check it
FIRST. Only fall back to the legacy `.a1/roadmap.md` when it's absent:

```bash
if [ -f docs/product/ROADMAP.md ]; then
  ROADMAP_FILE=docs/product/ROADMAP.md
  echo "EXISTS: $ROADMAP_FILE (preferred)"
elif [ -f .a1/roadmap.md ]; then
  ROADMAP_FILE=.a1/roadmap.md
  echo "EXISTS: $ROADMAP_FILE (legacy — recommend on-touch migration)"
else
  echo "MISSING"
fi
```

- **MISSING** (neither file exists) → **HALT.** Do not proceed to Step 1.
  Tell the user:

  > No `docs/product/ROADMAP.md` or `.a1/roadmap.md` found for this project.
  > Phase execution needs a roadmap to link into. Routing to `a1-roadmap` to
  > create one first.

  Hand off to the `a1-roadmap` skill; do not load or execute any wave until
  the user has run it.

- **EXISTS: `.a1/roadmap.md` (legacy)** → proceed, but note to the user once
  (not a blocker):

  > This project's roadmap is still on the legacy `.a1/roadmap.md` path.
  > Recommend migrating to `docs/product/ROADMAP.md` (schema v1) on next
  > touch via `a1-roadmap`'s adopt mode — never a big-bang conversion (see
  > `a1-roadmap` SKILL.md, FR-017).

- **EXISTS but unparseable** (schema v1 file missing `schema_version:`/entry
  markers, or legacy file missing frontmatter/entry markers):

  ```bash
  if [ "$ROADMAP_FILE" = "docs/product/ROADMAP.md" ]; then
    grep -q '^schema_version:' "$ROADMAP_FILE" && grep -q '<!-- entry:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
  else
    grep -q '^---' "$ROADMAP_FILE" && grep -q '<!-- entry:' "$ROADMAP_FILE" && echo "PARSEABLE" || echo "UNPARSEABLE"
  fi
  ```

  Treat as missing (do not proceed), but the file already exists — **never
  overwrite it silently**. Warn the user explicitly and get confirmation
  before routing to `a1-roadmap`:

  > `<$ROADMAP_FILE>` exists but does not look like a valid roadmap. I will
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
