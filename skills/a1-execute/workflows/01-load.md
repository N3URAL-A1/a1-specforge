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

If a `roadmap_entry: <slug>` value exists, run the membership check **exactly as
`_shared/roadmap-gate-check.md` §3 defines it** — do not restate the snippet here.
It accepts both encodings (the `product import` comment and the frontmatter
`- id:` that `product init` writes); a copy of the older single-grep form in this
file reported MISMATCH for 74 of 85 real specs whose slug was present (measured
2026-09-20, invariant 1).

- **FOUND** → proceed to Step 1.
- **MISMATCH** → **soft stop.** Do not halt outright — surface a notice and let
  the user decide:

  > This phase's `roadmap_entry: <slug>` does not match any entry in the
  > project roadmap. Continue anyway, fix the roadmap_entry value, or add the
  > missing entry to the roadmap first?

  Proceed only after explicit user confirmation to continue.

## Step 0c — Plan review check (`load-check`, gate `plan-review-xprov`)

Before the Isolation Gate and before any wave loads: the current PLAN.md must
have been approved by the cross-provider review (a1-plan Phase 4b,
`skills/a1-plan/workflows/04b-xprov-review.md`). The check is deterministic —
the newest `plan-review-xprov` entry in `.a1/phases/<phase_name>/xreview/index.json`
with `verdict: pass` must carry the sha256 of the PLAN.md on disk right now
(FR-003). A plan edited after its review is an unreviewed plan.

```bash
mkdir -p .a1/phases/<phase_name>/xreview
node <repo>/_shared/a1-tools.cjs xprov load-check --phase <phase_name> > .a1/phases/<phase_name>/xreview/load-check.last-run.json; RC=$?
echo "xprov load-check exit=$RC"
```

(The `mkdir -p` matters: if a1-plan never ran Phase 4b the directory does not
exist, the redirect itself would fail with RC=1 and no JSON — indistinguishable
in the routing below from a real `plan_review_missing`. With the directory in
place the check fails with that reason, which is the correct answer.)

- **Exit 0** → proceed to Step 1.
- **Exit 1, `reason: plan_review_missing`** → read `enforcement` from the
  stdout JSON (it echoes the `plan-review-xprov` row of
  `_shared/gates-registry.md`; the workflow applies it, the CLI never does):
  - `warning` → print the block below and **continue** to Step 1. The retro
    records `{id: plan-review-xprov, verdict: fail, caught: false}`.
  - `blocking` → **STOP before the Isolation Gate.** Print the block with the
    first line `❌ … enforcement: blocking`; route the user to `a1-plan`
    Phase 4b (re-run the review on the current PLAN.md). The only other way
    forward is a human waiver — tell the user the command, do not run it:
    `a1-tools xprov waive --phase <phase_name> --gate plan-review-xprov --reason "<text>"`.
- **Exit 2** → usage error or `xprov-gate.cjs` not shipped in this plugin
  version; no stdout JSON. Fix the call, do not treat it as a pass.

```
⚠ Plan review missing for the PLAN.md about to execute (gate plan-review-xprov, enforcement: warning)
   reason:  plan_review_missing — no pass entry matches the current PLAN.md sha256
   fix:     run a1-plan Phase 4b on this phase, or edit nothing and re-check
   Continuing because the registry row is still `warning`.
```

## Steps

1. Find PLAN.md at `.a1/phases/<phase_name>/PLAN.md`
   - If not found: "No plan found. Run `a1-plan` first to create one."

2. Read PLAN.md — extract:
   - Goal
   - Wave count and names
   - Success criteria
   - Total task count

3. Check STATUS for already-completed waves. Multi-lane phases write one file
   per lane (`STATUS-<lane-id>.md`), so read the whole set — reading only the
   plain file during a lane run makes completed waves look untouched and
   re-executes them:
   ```bash
   cat .a1/phases/<phase_name>/STATUS*.md 2>/dev/null
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
