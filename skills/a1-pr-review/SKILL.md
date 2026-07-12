---
name: a1-pr-review
description: >
  Turns a finished feature branch into a reviewed Pull Request. Four phases:
  Detect (scan a1-worktree registry for `handoff`; no registry entry? →
  adopt-first fallback, see workflows/01-detect.md) → Review (spawn
  a1-reinhard-reviewer, findings JSON) → Draft (PR title+body) → Submit
  (`gh pr create`). BLOCKER findings halt; MAJOR go into PR body "Known
  Issues"; MINOR stay as inline comment suggestions.
  MUST trigger when the user says: "pr review for <slug>" (alias: "pr review
  für <slug>"), "a1-pr-review", "review my worktree" (alias: "review meinen
  worktree"), "draft a pr" (alias: "pr draften"), "open a pr" (alias: "pr
  aufmachen"), "feature is done, open a PR" (alias: "feature ist fertig, PR
  aufmachen"), "worktree to review" (alias: "worktree zur review"), "code
  review + PR", "put reinhard on <slug>" (alias: "reinhard auf <slug>
  ansetzen"), or any request to wrap a handoff-state worktree into a Pull
  Request.
  Runs strictly AFTER implementation on a branch that has commits.
  Do NOT activate for: raw `gh pr create` without review (use gh directly),
  generic code-review-only (call a1-reinhard-reviewer directly), worktrees
  still in `active` status (run a1-worktree exit --mode handoff first), or
  branches that already have an open PR.
allowed-tools:
  - Read
  - Bash
  - Agent
---

# a1-pr-review — Handoff to Pull Request

Language: English-first; German trigger aliases supported.

This skill is a thin orchestrator. The lifecycle logic lives in
`workflows/`. The shared CLI helper
(`<repo>/_shared/a1-tools.cjs pr`) handles registry scans,
findings serialization, and status updates. The `gh` CLI is invoked
directly from the workflows — there is no wrapper.

## When to use

Activate when a worktree exits in mode `handoff` (registry status
`handoff`). Typical chain:

```
a1-new-feature → a1-worktree (enter/exit handoff) → a1-pr-review
```

## When NOT to use

- Worktrees still `active` — must exit to `handoff` via a1-worktree first.
- Generic code-review without PR intent — call `a1-reinhard-reviewer` directly.
- Hot-fix branches that already have an open PR.
- Re-runs after `pr-open` — registry status is terminal for this skill.

No registry entry for a worktree the user names directly? → adopt-first
fallback, see `workflows/01-detect.md`.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 1 | Detect | `workflows/01-detect.md` | in-review |
| 2 | Review | `workflows/02-review.md` | reviewed |
| 3 | Draft | `workflows/03-draft.md` | draft-ready |
| 4 | Submit | `workflows/04-submit.md` | pr-open |

## Routing — pick the right phase

1. If the user names a slug and no `.a1-review/findings.json` exists in
   the worktree → Phase 1 (Detect).
2. If `findings.json` exists but no `pr-draft.md` → Phase 3 (Draft) — or
   re-run Phase 2 if the user explicitly asks for re-review.
3. If `pr-draft.md` exists and registry is still `reviewed` →
   Phase 4 (Submit).
4. If the user asks "was steht zur Review?" → call
   `a1-tools pr list-handoff` directly, no phase needed.

## State mechanics

State is split across two locations:

| What | Where |
|---|---|
| Worktree status (`handoff` → `in-review` → `reviewed` → `pr-open`) | `~/.a1-worktrees-registry.json` |
| Review findings (BLOCKER / MAJOR / MINOR arrays) | `<worktree>/.a1-review/findings.json` |
| PR draft (title + body markdown) | `<worktree>/.a1-review/pr-draft.md` |

Update via CLI only — never write the registry directly:

```bash
node <repo>/_shared/a1-tools.cjs pr list-handoff
node <repo>/_shared/a1-tools.cjs pr findings-summary <slug>
node <repo>/_shared/a1-tools.cjs pr mark-pr-open <slug> <pr-url>
```

## Agent integration

Phase 2 spawns the global `a1-reinhard-reviewer` agent via the `Agent` tool. The
brief is structured (worktree path, branch, diff range, scope hint from
the last `phase_history` entry). Reinhard returns findings as inline
JSON which the workflow then writes to `findings.json` via the CLI.

## Hard rules

- BLOCKER findings halt the flow before Phase 4. The user must confirm
  explicitly to proceed despite blockers.
- MAJOR findings are listed in the PR body under "Known Issues".
- MINOR findings are not in the PR body — they go into a separate
  `inline-comments.md` for optional manual posting.
- Never invoke `git push` or `gh pr create` without explicit user
  confirmation in Phase 4.
- Never write `~/.a1-worktrees-registry.json` directly. CLI only.
- User-facing prompts follow `_shared/language-policy.md` (user's language,
  never hardcoded). CLI output (JSON, log lines) and file contents (PR body,
  findings) stay in **English**.

## Hand-offs

- After `pr-open`: terminal. Registry stays at `pr-open` until the user
  merges or closes the PR manually (no further skill in this chain).
- BLOCKER halt → user fixes in worktree, then re-runs Phase 2 (review).
