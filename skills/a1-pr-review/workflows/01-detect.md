# Phase 1 — Detect

Goal: pick the worktree to review. Output: a single registry entry with
slug, worktree path, branch, repo root.

## Inputs

- Either: user names a slug (e.g. "review `auth-rework`" / "review für `auth-rework`")
- Or: user says "what's up for review?" / "review the next one" ("was steht zur Review?" / "review nächsten")

## Steps

### 1.1 Scan registry

```bash
node ~/.claude/skills/_shared/a1-tools.cjs pr list-handoff
```

Returns a JSON array of registry entries with `status: handoff`. Each
entry has `{ id, slug, repo_root, worktree_path, branch, created_at,
phase_history }`.

### 1.2 Resolve to one entry

- If user named a slug → filter by `slug`. If 0 matches → tell the user
  which slugs ARE available, abort.
- If user did not name one and the array has exactly one entry → use it.
- If more than one entry → list slugs to the user, ask which to use.

### 1.3 Validate worktree on disk

```bash
test -d "<worktree_path>/.git" || test -f "<worktree_path>/.git"
```

If the worktree path is gone (registry drift), tell the user. Suggest
`a1-tools worktree gc` to reconcile. Do not auto-clean from this skill.

### 1.4 Prepare review directory

```bash
mkdir -p "<worktree_path>/.a1-review"
```

### 1.5 Update registry

```bash
node ~/.claude/skills/_shared/a1-tools.cjs pr mark-status <id> in-review
```

### 1.6 Hand-off to Phase 2

Tell the user what was selected (slug, branch, commits since
base). Then proceed to `workflows/02-review.md` automatically.

## Failure modes

- No handoff entries → exit with message: "No worktrees in status
  `handoff`. Use `a1-worktree exit --mode handoff` to hand off a branch first."
- Slug ambiguous → ask the user, do not guess.
- Worktree path missing → do not proceed; user must run `worktree gc`.
