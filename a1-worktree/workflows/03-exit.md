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

Ask in German:

> "Welcher Worktree soll beendet werden? Aktive: `<id-1>` (`<slug-1>`),
> `<id-2>` (`<slug-2>`), ..."

## Step 2 — Determine the mode

If the user did not specify, ask in German:

> "Wie soll ich den Worktree beenden?
> - `keep` — Worktree wird entfernt, Branch bleibt für späteren Gebrauch
> - `discard` — Worktree weg, Branch gelöscht (geht nur wenn keine ungemergeten Commits)
> - `handoff` — Worktree bleibt stehen, für `a1-pr-review` markiert"

## Step 3 — Status snapshot before action

```bash
node ~/.claude/skills/_shared/a1-tools.cjs worktree status <id>
```

Show the user:

- `commit_count` — wieviele Commits seit Base-Branch
- `has_uncommitted` — gibt es noch ungespeicherte Änderungen?
- `branch_ahead` — wieviele Commits ahead of base

If `has_uncommitted=true`:

> "Achtung: Der Worktree hat noch uncommitted changes. Bei `discard` gehen die
> verloren. Bei `keep` und `handoff` bleibt der Worktree-Inhalt mit den
> Änderungen erhalten — willst du erst committen?"

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

## Step 5 — Confirm to user (German)

- `keep`: > "Worktree entfernt. Branch `<branch>` bleibt erhalten."
- `discard`: > "Worktree und Branch `<branch>` sind weg."
- `handoff`: > "Worktree bleibt unter `<path>`. Status `handoff` — bereit für
  `a1-pr-review` (M3)."

## Hard rules

- Never run `git worktree remove --force` ohne User-Konfirm.
- `discard` mit ungemergetem Commit-Stand braucht `--force-discard` UND
  expliziten User-Konfirm. Default ist: refusen, `handoff` vorschlagen.
- Never delete a branch outside the CLI. Registry must stay consistent.
- After `handoff`, this skill is done. Do not call `a1-pr-review` directly —
  inform the user and let them invoke it.
