---
name: a1-worktree
description: >
  Isolated Git worktree lifecycle: Prepare → Enter → Exit (keep/discard/handoff).
  Lets agents work on a feature branch in a parallel checkout without polluting
  the main tree. Registry at `~/.a1-worktrees-registry.json`, worktrees at
  `<repo-parent>/a1-worktrees/<slug>/`, branches default `feature/<slug>`.
  MUST trigger when the user says: "worktree for <feature>" (alias: "worktree
  für <feature>"), "isolated branch" (alias: "isolierter branch"), "a1-worktree",
  "create a new worktree" (alias: "neuen worktree anlegen"), "clean up worktree"
  (alias: "worktree aufräumen"), "worktree exit", "worktree handoff", "prepare
  worktree for PR" (alias: "worktree für PR vorbereiten"), "develop
  experimentally" (alias: "experimentell entwickeln"), "let an agent work in a
  worktree" (alias: "agent in worktree arbeiten lassen"), or any request to
  spawn, manage, or tear down an isolated working copy.
  Distinct from a1-new-feature (which produces specs/plans). Hands off to
  a1-pr-review when exited with `--mode handoff`.
  Do NOT activate for: ordinary `git checkout <branch>` without parallelism,
  raw `git worktree` commands outside the registry, or PR creation
  (use a1-pr-review).
allowed-tools:
  - Read
  - Bash
---

# a1-worktree — Isolated Worktree Lifecycle

Language: English-first; German trigger aliases supported.

This skill is a thin orchestrator. The lifecycle logic lives in `workflows/`.
The shared CLI helper (`~/.claude/skills/_shared/a1-tools.cjs worktree`)
handles all deterministic git + registry operations.

## When to use

Activate when an agent needs to work on a feature branch in isolation from
the main checkout — typical case: `a1-new-feature` finished Phase 4 (Plan)
and Phase 5 (Implement) is about to start. The implementing agent should
operate in a worktree so the user's main checkout stays untouched.

## When NOT to use

- Ordinary `git checkout <branch>` workflows where no parallelism is needed.
- PR creation, review, merge — those belong to `a1-pr-review`.
- Direct `git worktree` operations the user wants to run themselves outside
  the registry.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 1 | Prepare | `workflows/01-prepare.md` | prepared |
| 2 | Enter | `workflows/02-enter.md` | active |
| 3 | Exit | `workflows/03-exit.md` | cleaned (or handoff) |
| 4 | Adopt / Reconcile | `workflows/04-adopt-reconcile.md` | active (adopt) / unchanged or cleaned (reconcile) |

## Routing — pick the right phase

1. If the user wants a new worktree → Phase 1 (Prepare).
2. If a registry entry exists with status `prepared` for the slug → Phase 2 (Enter).
3. If the user wants to wrap up an active worktree → Phase 3 (Exit).
4. If a worktree exists on disk (raw `git worktree add`, or registry drift)
   with no matching registry entry → Phase 4 (Adopt / Reconcile).
5. If the user asks about state (`list`, `status`) → call the CLI directly,
   no phase needed.

**Recovery note:** Worktree exists but `exit` says "no registry entry"
→ `worktree adopt`, see `workflows/04-adopt-reconcile.md`.

## State mechanics

State is persisted in a user-global registry at `~/.a1-worktrees-registry.json`.
Update it via the CLI helper only — never write the file directly:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs worktree prepare <repo-root> <slug>
node ~/.claude/skills/_shared/a1-tools.cjs worktree enter <id>
node ~/.claude/skills/_shared/a1-tools.cjs worktree exit <id> --mode <keep|discard|handoff>
```

Registry writes are atomic (read → modify → write-tmp → rename).

## Storage

| Artifact | Location |
|---|---|
| Worktrees | `<repo-parent>/a1-worktrees/<slug>/` |
| Registry | `~/.a1-worktrees-registry.json` (user-global) |

Override registry location via `A1_WORKTREE_REGISTRY` env var (used in tests).

## Exit modes

| Mode | Behavior |
|---|---|
| `keep` | Worktree removed, branch kept. Use when feature continues on `main` checkout. |
| `discard` | Worktree removed, branch deleted. Only allowed if branch has no unmerged commits. Otherwise CLI refuses. |
| `handoff` | Worktree stays, registry status set to `handoff`. Signals to `a1-pr-review` that the branch is ready for PR review. |

## Origin cleanup (Step 4.5 of Exit)

After local `git worktree remove` + `git branch -D` (in `discard`, or for an
already-merged branch on request), the exit workflow additionally deletes the
**remote** branch: `git push origin --delete <branch>`, guarded by explicit
user confirmation. A remote branch that is already gone
(`git ls-remote --heads origin <branch>` empty, or the delete fails with
"remote ref does not exist") is treated as **success**, never as an error to
retry or force through. See `workflows/03-exit.md` Step 4.5 for the full
sequence.

## Agent integration

None. This skill is pure lifecycle management. Other skills (notably
`a1-new-feature` Phase 5) call into it.

## Hard rules

- Never run `git worktree add/remove` or `git branch -D` outside the CLI.
  The registry must stay in sync.
- Never modify `~/.a1-worktrees-registry.json` directly with Edit/Write.
- Pre-Flight checks are mandatory before `enter` — never skip Prepare.
- User must confirm before any destructive action (`exit --mode discard`,
  any branch deletion — local or remote, origin cleanup included —
  force-remove of a dirty worktree).
- User-facing prompts and messages are in **German**. CLI output (JSON, log
  lines) stays in English.
- One worktree per `<repo-root, slug>` tuple. If a registry entry already
  exists for that pair, `prepare` refuses unless `--force-reset` is given.

## Hand-offs

- Prepare PASS → user proceeds to Enter (or this skill chains directly into
  Phase 2).
- Enter complete → worktree path is returned to the caller (usually the user
  or another skill). The implementing agent then operates inside that path.
- Exit `handoff` → `a1-pr-review` takes over. The registry entry remains
  with status `handoff` until that skill clears it.
- Exit `keep` / `discard` → terminal. Registry entry status `cleaned`.
