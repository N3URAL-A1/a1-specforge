# Push Cadence (cross-skill rule)

> Owner of every "when do we push" instruction in a1 skills. Skills that push a
> branch or open a PR reference this file and do not restate it. Robert's
> decision, 2026-09-28.

## Why

Every push to a PR branch starts a full CI run, and CI minutes are billed.
Measured for org N3URAL-A1 on 2026-09-28: GitHub Actions minutes doubled month
over month (July 3,030, August 4,123, September 9,093); one repo caused ~95 %
of them at ~16 billed minutes per PR push. In a September sample, single
branches had 21–23 CI runs because review fixes were pushed one at a time.

## P1 — Feature and fix branches

1. **First push = PR opening.** The branch is pushed once, directly before
   `gh pr create` (`a1-pr-review` Phase 4.2). Until then it stays local.
2. **Then one push per completed review-fix round.** A round is all
   BLOCKER/MAJOR findings of one review pass (Reinhard, Samuel, or any other
   reviewer). Commit each fix locally; push once when the whole round is fixed.
3. **Never per commit, per wave, or per single finding.** Executors (Erik,
   Walter, any code agent) commit; they do not push.

## P2 — Local suite green before every push

Before any push (branch or `main`), run the project's local suite in the
worktree: the same test, lint and build commands CI runs. Push only on green.
A red suite is fixed locally first. Never push "to see what CI says".

## P3 — Shared-state chore PRs batch per session step

Shared-state files (`docs/product/**`, `.a1/reservations.json`,
`.a1/roadmap.md`, see `parallel-spec-isolation.md` R2) are still mutated only
in the primary checkout and **committed immediately**, so the working tree is
never dirty. Pushing is batched:

- **One push / one `chore(...)` PR per session step, not per mutation.** A
  session step is one lifecycle transition of one work unit, e.g. "start"
  (scope claim plus product status) or "finish" (scope release, product
  status, NEXT.md). Collect all of that step's commits, then push once.
- **Never left behind across sessions.** The step's chore PR is merged (or,
  without branch protection, the commits pushed to `main`) before the step is
  left, and at the latest before the session ends. A session that ends with
  unpushed shared-state commits breaks R2: sessions on other machines read
  `origin` and would claim colliding scopes.
- Local suite green before this push too (P2).

## Where this applies

`a1-pr-review` (Submit, review-fix rounds), `a1-new-feature` and `a1-fix`
(Isolation Gate, merge), `a1-execute` (Isolation Gate item 3),
`parallel-spec-isolation.md` (R2, R4).
