# Phase 4 — Submit

Goal: open the actual Pull Request via `gh pr create`. Update registry
to `pr-open`. This phase is terminal.

## Pre-flight

User must have confirmed in Phase 3. If unclear, ask again:
> "Are you sure you want to create the PR now? (yes / no)"

### 4.1 Check `gh` auth

```bash
gh auth status
```

If not authenticated: tell the user to run `gh auth login`, abort.

### 4.2 Push branch (if needed)

```bash
git -C "<worktree_path>" push -u origin "<branch>"
```

If push fails (e.g. branch already pushed, non-fast-forward): show the
git error, ask the user before retrying with `--force-with-lease`.
Never force-push to `main`.

### 4.3 Read draft

Read `<worktree>/.a1-review/pr-draft.md`. Split into TITLE and body.

### 4.4 Create PR

```bash
cd "<worktree_path>" && gh pr create \
  --title "<title>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

Capture the returned PR URL.

### 4.5 Update registry

```bash
node ~/.claude/skills/_shared/a1-tools.cjs pr mark-pr-open <id> "<pr-url>"
```

This sets `status: pr-open` and appends to `phase_history`.

### 4.6 Report

```
PR is open: <pr-url>

Inline comments from MINOR findings (optionally post manually):
<worktree>/.a1-review/inline-comments.md  (X entries)

a1-pr-review is complete. Registry status: `pr-open`.
```

## Failure modes

- `gh pr create` fails (e.g. existing PR for branch): show error, do
  NOT mark registry. Suggest `gh pr view` to inspect.
- Push rejected: do not auto-force. Ask user.
- User aborts at confirm: registry stays `reviewed`. Draft remains on
  disk for later submission.

## Retro (mandatory, every run)

After every run — pass or fail — write one structured entry. Takes 2 minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-pr-review/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: <short description, e.g. "PR review for auth-rework, 0 BLOCKER, 2 MAJOR">
project: <project-slug>
result: <pass|fail|partial>
issues: [<relevant tags, e.g. reinhard-no-json, push-rejected, gh-auth, blocker-overridden>]
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

**To Vault:**
Append the same entry to:
`~/N3URAL-Vault/pattern/a1-learnings/a1-pr-review.md`

A run with no issues is still useful data — write the entry.
