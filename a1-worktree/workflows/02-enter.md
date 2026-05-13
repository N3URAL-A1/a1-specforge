# Phase 2 — Enter (Create Worktree)

**Goal:** Materialize the prepared worktree on disk and hand its path back
to the caller. Registry transitions `prepared → active`.

**Sub-agent:** none. The CLI runs `git worktree add` atomically.

## Pre-condition

A registry entry with status `prepared` must exist for the target `<id>`.
If you are entering this phase directly from Phase 1, the `id` is in the
`prepare` JSON output.

## Step 1 — Confirm with user

If Phase 1 just ran and PASS was shown, ask:

> "Create worktree `<id>` now at `<worktree_path>`?"

Wait for explicit yes before proceeding.

## Step 2 — Run enter

```bash
node ~/.claude/skills/_shared/a1-tools.cjs worktree enter <id>
```

The CLI:

1. Reads the registry entry.
2. Re-validates the worktree path is still free (race-safety).
3. Runs `git worktree add -b <branch> <worktree_path> <base_branch>` (or
   `git worktree add <worktree_path> <branch>` if the branch already exists
   — covered in the prepare check matrix).
4. Updates registry: status → `active`, appends phase_history entry.

JSON on success:

```json
{
  "id": "...",
  "worktree_path": "...",
  "branch": "...",
  "status": "active"
}
```

Exit 0 on success, 1 on git failure (e.g. branch race), 2 on internal error.

## Step 3 — Hand off the path

On success, tell the user:

> "Worktree is live. Path: `<worktree_path>`. Branch: `<branch>`.
> The agent can now work there. Let me know when you want to end the worktree —
> the modes are:
> - `keep` — worktree removed, branch stays
> - `discard` — both removed (only if no unmerged commits)
> - `handoff` — worktree stays, handed off to `a1-pr-review`"

Then stop. This skill does not monitor the agent's work inside the worktree.

## On failure

If exit 1 (git failure), show stderr verbatim and ask:

> "Git could not create the worktree. Should I set the registry entry to
> `cleaned` and restart with Prepare?"

If the user agrees, run `exit --mode discard --force` (CLI rolls back the
registry without touching git, since nothing was created).

## Hard rules

- Never call `git worktree add` directly from the workflow. Always via CLI.
- Never run Enter twice for the same `id`. The CLI refuses if status is not
  `prepared`.
- If the user wants to recreate after a failed Enter, force a clean roll-back
  first (see "On failure"), then re-run Phase 1.
