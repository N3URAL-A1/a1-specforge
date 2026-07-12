# Phase 1 — Detect

Goal: pick the worktree to review. Output: a single registry entry with
slug, worktree path, branch, repo root.

## Inputs

- Either: user names a slug (e.g. "review `auth-rework`" / "review für `auth-rework`")
- Or: user says "what's up for review?" / "review the next one" ("was steht zur Review?" / "review nächsten")

## Steps

### 1.1 Scan registry

```bash
node <repo>/_shared/a1-tools.cjs pr list-handoff
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
node <repo>/_shared/a1-tools.cjs pr mark-status <id> in-review
```

### 1.6 Hand-off to Phase 2

Tell the user what was selected (slug, branch, commits since
base). Then proceed to `workflows/02-review.md` automatically.

### Fallback: no handoff entry

If the user names a branch or worktree path directly and `pr list-handoff`
returns an empty array (no registry entry in status `handoff` for it), use
one of these two fallbacks instead of failing outright:

- **(a) Preferred — adopt first, then continue the normal flow:**
  ```bash
  node <repo>/_shared/a1-tools.cjs worktree adopt <repo-root> <slug> --worktree-path <path>
  node <repo>/_shared/a1-tools.cjs worktree exit <id> --mode handoff
  ```
  This registers the worktree (from git truth) and immediately hands it off,
  after which it appears in `pr list-handoff` and the rest of Phase 1
  (1.3–1.6) proceeds unchanged.
- **(b) Read-only alternative, findings only:**
  ```bash
  node <repo>/_shared/a1-tools.cjs pr findings-summary --worktree-path <path>
  ```
  Works without any registry entry, but is read-only — it only returns the
  findings summary for a worktree that already has
  `.a1-review/findings.json`. It does not update any status.

`pr mark-status` and `pr mark-pr-open` always **write** the registry, so a
path-based bypass is meaningless for them — they require a real registry
entry. Use fallback (a), adopt first, before calling either. The rule
"never write the registry file directly, CLI only" (see SKILL.md) stays in
force for all of the above.

## Failure modes

- No handoff entries → exit with message: "No worktrees in status
  `handoff`. Use `a1-worktree exit --mode handoff` to hand off a branch first."
- Slug ambiguous → ask the user, do not guess.
- Worktree path missing → do not proceed; user must run `worktree gc`.
