# Goal: Ship delivery slice 1 "Measure + protect" of spec 027-lean-pipeline as one PR.

## Decisions

- 2026-11-12 — Lanes run sequentially in one worktree (`feature/027-lean-pipeline-s1`), waves 1 → 8 in numeric order. Reason: `lane-split check --imports` exits 1 on the real code with 4 cross-lane imports (`pr-merge-check.cjs` → `verify-run.cjs`, `help.cjs` → `help-gates.cjs`, `gates-cli.cjs` → `gate-log.cjs` and `retro-gatelog.cjs`). Owner chose sequential over a re-plan. Per-lane status files (`STATUS-<lane>.md`) stay as the plan names them; the RED-proof lines go there. — affects: lane decision, execution location (no lane worktrees, no lane merges); success criteria unchanged.
- 2026-11-12 — The spec-027 roadmap entry (`docs/product/**`), the scope claim (`.a1/reservations.json`) and the planning files of this phase were merged to `main` by a chore PR before Wave 1 (precedent #78), because the worktree preflight refuses a dirty primary checkout. Wave 7's carry-over of `docs/product/**` is therefore a no-op check (files already on `origin/main`), not a copy. — affects: Task 7.x carry-over.
