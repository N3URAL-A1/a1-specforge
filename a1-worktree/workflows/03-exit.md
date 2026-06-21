# Phase 3 — Exit (Cleanup / Handoff)

**Goal:** End the lifecycle of an active worktree. Three modes:

| Mode | Worktree | Branch | Registry status |
|---|---|---|---|
| `keep` | removed | kept | `cleaned` |
| `discard` | removed | deleted | `cleaned` |
| `handoff` | kept | kept | `handoff` |

**Sub-agent:** none.

## Step 1 — Identify the worktree

The user can name the worktree by `id`, by `slug`, or implicitly ("der
worktree den wir gerade gemacht haben" → take the most recent `active`
entry).

If ambiguous, list candidates:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs worktree list --status=active
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
node ~/.claude/skills/_shared/a1-tools.cjs worktree status <id>
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
node ~/.claude/skills/_shared/a1-tools.cjs worktree exit <id> --mode <keep|discard|handoff>
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

## Step 5 — Confirm to user

- `keep`: > "Worktree removed. Branch `<branch>` is kept."
- `discard`: > "Worktree and branch `<branch>` are gone."
- `handoff`: > "Worktree stays at `<path>`. Status `handoff` — ready for
  `a1-pr-review`."

## Hard rules

- Never run `git worktree remove --force` without user confirmation.
- `discard` with unmerged commits requires `--force-discard` AND explicit
  user confirmation. Default: refuse and suggest `handoff` instead.
- Never delete a branch outside the CLI. Registry must stay consistent.
- After `handoff`, this skill is done. Do not call `a1-pr-review` directly —
  inform the user and let them invoke it.

## Retro (mandatory, every run)

After every run — pass or fail — write one structured entry. Takes 2 minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-worktree/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: <short description, e.g. "worktree für auth-rework, exit handoff">
project: <project-slug>
result: <pass|fail|partial>
issues: [<relevant tags, e.g. prepare-blocker, dirty-tree, branch-collision, handoff-clean>]
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

**To Vault:**
Append the same entry to:
`~/N3URAL-Vault/pattern/a1-learnings/a1-worktree.md`

A run with no issues is still useful data — write the entry.
