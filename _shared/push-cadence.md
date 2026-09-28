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
   Changes reach `main` only through that PR and its squash merge
   (`gh pr merge --squash --delete-branch`), never through a local merge plus
   `git push origin main`.
2. **Then one push per completed review-fix round.** A round is all
   BLOCKER/MAJOR findings of one review pass. Findings from reviewers that ran
   in parallel on the same pass (e.g. Reinhard and Samuel) are one round.
   Commit each fix locally; push once when the whole round is fixed. If the
   round rebased the branch onto `origin/main`, that push is
   `--force-with-lease`, never plain `--force`.
3. **Never per commit, per wave, or per single finding.** Executors (Erik,
   Walter, any code agent) commit; they do not push.
4. **Push without a PR** only if the repo's CI does not trigger on branch
   pushes (e.g. a backup or a hand-over to another machine).

**The one exception: `a1-quick`.** The XS lane merges its `quick/<slug>`
branch into `main` locally, without a PR. It then pushes `main` exactly once,
after P2. If `main` is protected (see P3, "Protected or not"), a1-quick opens a
PR too and takes the same squash path.

## P2 — Local suite green before every push

Before any push, run the project's local suite and push only on green. A red
suite is fixed locally first. Never push "to see what CI says".

"The suite" means the commands CI runs, taken from the first source that
exists:

1. the commands declared in the project's `CLAUDE.md` or CONVENTIONS;
2. otherwise the `run:` steps of `.github/workflows/*`;
3. otherwise build plus test from `package.json` / `pubspec.yaml`.

- A project without GitHub CI: its deploy build (e.g. `next build`,
  `vercel build`) is the CI.
- Local green does not cover CI's OS matrix; run the portability check where
  one exists.
- A chore PR that touches only `docs/product/**` or `.a1/*` shared state needs
  only the lint/validator for those files (e.g. `product validate`).
- Exempt from P2: the one-time bootstrap push of a new repo (`a1-new-project`)
  and `git push origin --delete <branch>` (`a1-worktree` origin cleanup).

## P3 — Shared-state pushes, batched per session step

Shared state is `docs/product/**`, `.a1/reservations.json` and
`.a1/roadmap.md` (`parallel-spec-isolation.md` R2). It is mutated only in the
primary checkout and **committed immediately**, so the tree is never dirty.
Pushing it is batched: **one push, or one `chore(...)` PR, per session step,
not per mutation.** A session step is one lifecycle transition of one work
unit.

The `a1-tools.cjs` CLI mutates these files but never commits; the skill
commits them on the primary checkout's `main`.

**Protected or not.** Measure it once per session, do not assume it:
`gh api repos/<owner>/<repo>/branches/main/protection` answers 404 **and**
`gh api repos/<owner>/<repo>/rules/branches/main` (the rules active on `main`)
lists no rule of type `pull_request` → unprotected. Anything else → protected.

**How a step is pushed.**

- Unprotected `main`: push the step's shared-state commits directly to
  `origin main` at the step boundary.
- Protected `main`: create a branch `chore/<unit>-<step>` from the local
  shared-state commits, push it, open the chore PR, and squash-merge it. Once
  the merge is proven (`gh pr view --json state,mergedAt`), run
  `git -C <repo> reset --keep origin/main` in the primary checkout, so local
  `main` carries origin's squash commit instead of the originals.

**Start step: hard sync point.** `code-scope` reads only the local
`.a1/reservations.json`, so a claim is only as fresh as the last sync.

1. Run `git -C <repo> pull --rebase origin main` in the primary checkout
   before every `code-scope list` or `code-scope claim`, and after every
   merge into `main` (`a1-pr-review` Hand-offs). This is the only way the
   primary checkout's `main` is synced; never a bare `git pull`. `--rebase`, not
   `--ff-only`: unpushed shared-state commits on local `main` are normal under
   this rule, and `--ff-only` aborts as soon as `origin/main` has moved. On a
   rebase conflict in `.a1/reservations.json` or `docs/product/**`: STOP,
   `git rebase --abort`, do not resolve it yourself; Robert decides.
2. The claim commit is pushed (or its chore PR merged) as the **last action of
   the start step**, before `worktree add` and before Wave 1. A product status
   change of the same step may ride in that push.

**Later steps: batched.**

- Wave-checkpoint `product stage --set` commits are not pushed per wave. They
  ride in the next start or finish push.
- Finish step (scope release, product status, NEXT.md): one push or chore PR.
  Release may be batched like this, because a late release only blocks
  another claim; it never lets two claims collide.
- **Never left behind across sessions.** A step's push happens before the
  step is left, and at the latest before the session ends. A session that
  ends with unpushed shared-state commits breaks R2: sessions on other
  machines read `origin` and would claim colliding scopes.

## Where this applies

- Skills: `a1-pr-review` (`SKILL.md`, `workflows/04-submit.md`),
  `a1-new-feature` (`SKILL.md`, `workflows/06-verify.md`), `a1-fix`,
  `a1-execute`, `a1-quick` (the exception above). The sync and push commands
  of P3 live only here; the skills point to them.
- Agents: `agents/a1-erik-executor.md`, `agents/a1-walter-web-developer.md`.
- Conventions: `parallel-spec-isolation.md` R2, R3, R4.
