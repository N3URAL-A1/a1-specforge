# Phase 3 — Exit (Cleanup / Handoff)

**Goal:** End the lifecycle of an active worktree. Three modes:

| Mode | Worktree | Branch | Registry status |
|---|---|---|---|
| `keep` | removed | kept | `cleaned` |
| `discard` | removed | deleted | `cleaned` |
| `handoff` | kept | kept | `handoff` |

**Sub-agent:** none.

## Step 1 — Identify the worktree

The user can name the worktree by `id`, by `slug`, or implicitly ("the
worktree we just made" → take the most recent `active`
entry).

If ambiguous, list candidates:

```bash
node <repo>/_shared/a1-tools.cjs worktree list --status=active
```

Ask the user:

> "Which worktree should be ended? Active: `<id-1>` (`<slug-1>`),
> `<id-2>` (`<slug-2>`), ..."

## Step 2 — Determine the mode

If the user did not specify, ask:

> "How should I end the worktree?
> - `keep` — worktree removed, branch kept for later use
> - `discard` — worktree gone, branch deleted (only if no unmerged commits)
> - `handoff` — worktree stays, marked for `a1-pr-review`"

## Step 3 — Status snapshot before action

```bash
node <repo>/_shared/a1-tools.cjs worktree status <id>
```

Show the user:

- `commit_count` — number of commits since base branch
- `has_uncommitted` — uncommitted changes still present?
- `branch_ahead` — number of commits ahead of base

If `has_uncommitted=true`:

> "Warning: The worktree still has uncommitted changes. With `discard` they
> will be lost. With `keep` and `handoff` the worktree content is preserved —
> would you like to commit first?"

## Step 4 — Run exit

```bash
node <repo>/_shared/a1-tools.cjs worktree exit <id> --mode <keep|discard|handoff>
```

The CLI:

- `keep`: `git worktree remove <path>`, leave branch alone. Registry → `cleaned`.
- `discard`: refuse if `branch_ahead > 0` unless `--force-discard`. Else
  `git worktree remove <path>` + `git branch -D <branch>`. Registry → `cleaned`.
- `handoff`: leave both worktree and branch alone. Registry → `handoff`.
  Sets `agent_brief: null` so a1-pr-review can pick it up.

JSON on success:

```json
{
  "id": "...",
  "exit_mode": "keep",
  "status": "cleaned",
  "removed": true,
  "branch_kept": true
}
```

Exit 0 on success, 1 on user/usage error (e.g. discard with unmerged commits
and no `--force-discard`), 2 on internal error.

## Step 4.5 — Origin cleanup (remote branch deletion, `discard`/`handoff`→merged only)

This is the third leg of "Origin cleanup" alongside local `git branch -D` and
`git worktree remove` (see FR-012 in the roadmap-gate-parallel-features spec):
a feature's lifecycle is not fully torn down until its **remote** branch is
also gone, not just the local one.

Run this step only for `discard` (after Step 4 succeeds) or when the user
explicitly asks to finish origin cleanup for a branch that has already been
merged to `main` (e.g. after `a1-new-feature` Phase 6 merges and the worktree
is being torn down). Never run it for plain `keep` or an unmerged `handoff` —
those modes intentionally preserve the branch.

1. **Check the remote branch actually exists** before attempting deletion —
   this makes the "already gone" case a no-op instead of an error:

   ```bash
   git -C <repo> ls-remote --heads origin <branch>
   ```

   Empty output → remote branch is already gone. Treat this as **success**,
   skip straight to reporting (no error, no retry).

2. **If present, ask for explicit confirmation before deleting the remote
   branch** — same "never force without confirmation" rule as local discard:

   > "Also delete the remote branch `origin/<branch>`? This cannot be undone
   > locally by anyone still tracking it. (yes/no)"

3. On yes, delete it:

   ```bash
   git -C <repo> push origin --delete <branch>
   ```

   - Exit 0 → remote branch removed. Report success.
   - Non-zero exit but the error text matches "remote ref does not exist" /
     "unable to delete '<branch>': remote ref does not exist" → treat as
     **success** (race: someone else deleted it between the check and the
     push). Do not surface this as a failure.
   - Any other non-zero exit (auth failure, network, protected branch) →
     report the actual git error to the user; do NOT retry silently, do NOT
     fall back to `--force`.

4. On no → skip remote deletion, tell the user the local cleanup is done but
   `origin/<branch>` still exists, and note they can re-run this step later.

## Step 5 — Confirm to user

- `keep`: > "Worktree removed. Branch `<branch>` is kept."
- `discard` (origin cleanup ran): > "Worktree, local branch, and remote
  branch `origin/<branch>` are all gone." (or, if the remote was already
  gone / user declined: "Worktree and local branch `<branch>` are gone.
  Remote branch `origin/<branch>` was already deleted." / "... still exists
  — re-run origin cleanup later if you want it removed.")
- `handoff`: > "Worktree stays at `<path>`. Status `handoff` — ready for
  `a1-pr-review`."

## Hard rules

- Never run `git worktree remove --force` without user confirmation.
- `discard` with unmerged commits requires `--force-discard` AND explicit
  user confirmation. Default: refuse and suggest `handoff` instead.
- Never delete a branch outside the CLI (local) or without explicit
  confirmation (remote). Registry must stay consistent.
- Never run `git push origin --delete <branch>` without the Step 4.5
  confirmation step. Treat "remote ref does not exist" as success, never as
  an error to retry or force through.
- After `handoff`, this skill is done. Do not call `a1-pr-review` directly —
  inform the user and let them invoke it.

## Retro (mandatory, every run)

Write one retro entry exactly as defined in `_shared/retro-template.md`
(entry format + write targets: learning store first, dev cache best-effort),
with skill = `a1-worktree`.

- task wording: <short description, e.g. "worktree for auth-rework, exit handoff">
- issue tags: [<relevant tags, e.g. prepare-blocker, dirty-tree, branch-collision, handoff-clean>]

