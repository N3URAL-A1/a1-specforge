# Phase 1 — Prepare (Pre-Flight)

**Goal:** Validate that an isolated worktree can be created safely for
`<slug>` on `<repo-root>` before touching git.

**Sub-agent:** none. All checks are deterministic and live in the CLI.

## Step 1 — Collect input

You need:

- **Repo root** — absolute path to the source repo. If the user did not give
  one, default to the current working directory (`pwd`). If `pwd` is not a
  git repo, ask one question:
  > "Which repository should the worktree be created in? (absolute path)"
- **Slug** — short feature identifier (kebab-case). If absent, ask:
  > "What slug should the worktree get? (short, kebab-case, e.g. `auth-rework`)"
- **Optional branch** — only if user explicitly named one. Default is
  `feature/<slug>`.
- **Optional base branch** — default `main`. Override only on explicit ask.

## Step 2 — Run prepare

Call the CLI:

```bash
node <repo>/_shared/a1-tools.cjs worktree prepare <repo-root> <slug> [--branch <name>] [--base <branch>]
```

The CLI performs these Pre-Flight checks:

| # | Check | Failure mode |
|---|---|---|
| 1 | `repo-root` is a git repo | ERROR |
| 2 | Working tree is clean (no uncommitted changes) | BLOCKER |
| 3 | Base branch exists | BLOCKER |
| 4 | Target branch does not exist locally OR does not have a worktree yet | BLOCKER |
| 5 | Slug is valid kebab-case (`[a-z0-9-]+`) | ERROR |
| 6 | Target worktree path is free | BLOCKER |
| 7 | No active registry entry for this `<repo-root, slug>` pair | BLOCKER |

JSON shape on success:

```json
{
  "id": "20260513-1042-feature-slug",
  "repo_root": "...",
  "worktree_path": "...",
  "branch": "feature/feature-slug",
  "base_branch": "main",
  "status": "prepared",
  "checks": [{ "name": "...", "result": "PASS" }, ...]
}
```

Exit codes: 0 PASS, 1 BLOCKER, 2 ERROR.

## Step 3 — Branch on exit code

### Exit 0 — PASS

Show the user a summary:

> "Pre-flight green. Worktree ID: `<id>`. Should I create the worktree now?"

If yes → proceed to **Phase 2 (Enter)**.

### Exit 1 — BLOCKER

Read the `checks` array, list each failed check:

| Check | Hint |
|---|---|
| `working_tree_clean` | "The working tree has uncommitted changes. Please commit or stash first." |
| `base_branch_exists` | "The base branch (`<base>`) does not exist. Name a different base or create the branch first." |
| `target_branch_free` | "Branch `<branch>` already exists or already has a worktree. Choose a different branch or clean up the existing one." |
| `worktree_path_free` | "Path `<path>` is not free. Clean it up manually or choose a different slug." |
| `no_active_registry_entry` | "An active registry entry already exists for `<repo-root, slug>`. Run `exit` for the old one first, then start again — or choose a different slug." |

Stop. Do not auto-fix.

### Exit 2 — ERROR

Show the user the stderr message. Typical: invalid slug, not a git repo.

## Hard rules

- Never proceed to Phase 2 on non-zero exit.
- Never re-run `prepare` to "force through" a failed check — fix the
  underlying issue.
- Always pass `--format json` if you need the structured result for branching;
  the default human output is for the user.
