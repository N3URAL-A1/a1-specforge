# Phase 1 — Prepare (Pre-Flight)

**Goal:** Validate that an isolated worktree can be created safely for
`<slug>` on `<repo-root>` before touching git.

**Sub-agent:** none. All checks are deterministic and live in the CLI.

## Step 1 — Collect input

You need:

- **Repo root** — absolute path to the source repo. If the user did not give
  one, default to the current working directory (`pwd`). If `pwd` is not a
  git repo, ask one German question:
  > "In welchem Repository soll der Worktree angelegt werden? (absoluter Pfad)"
- **Slug** — short feature identifier (kebab-case). If absent, ask:
  > "Welchen Slug soll der Worktree bekommen? (kurz, kebab-case, z.B. `auth-rework`)"
- **Optional branch** — only if user explicitly named one. Default is
  `feature/<slug>`.
- **Optional base branch** — default `main`. Override only on explicit ask.

## Step 2 — Run prepare

Call the CLI:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs worktree prepare <repo-root> <slug> [--branch <name>] [--base <branch>]
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

Show the user a German summary:

> "Pre-Flight grün. Worktree-ID: `<id>`. Soll ich den Worktree jetzt anlegen?"

If yes → proceed to **Phase 2 (Enter)**.

### Exit 1 — BLOCKER

Read the `checks` array, list each failed check in German:

| Check | German hint |
|---|---|
| `working_tree_clean` | "Der Working Tree hat uncommitted changes. Bitte erst committen oder stashen." |
| `base_branch_exists` | "Der Base-Branch (`<base>`) existiert nicht. Anderen Base nennen oder erst Branch anlegen." |
| `target_branch_free` | "Der Branch `<branch>` existiert bereits oder hat schon einen Worktree. Anderen Branch wählen oder bestehenden aufräumen." |
| `worktree_path_free` | "Der Pfad `<path>` ist nicht frei. Manuell aufräumen oder anderen Slug wählen." |
| `no_active_registry_entry` | "Für `<repo-root, slug>` existiert schon ein aktiver Registry-Eintrag. Erst `exit` für den alten, dann neu starten — oder anderen Slug." |

Stop. Do not auto-fix.

### Exit 2 — ERROR

Show the user the stderr message. Typical: invalid slug, not a git repo.

## Hard rules

- Never proceed to Phase 2 on non-zero exit.
- Never re-run `prepare` to "force through" a failed check — fix the
  underlying issue.
- Always pass `--format json` if you need the structured result for branching;
  the default human output is for the user.
