---
phase: 01-check
purpose: Run phantom detection on a PLAN.md and translate the JSON report into a German summary for the user.
inputs:
  - plan_path: absolute path to a GSD-style PLAN.md
  - repo_path (optional): absolute path to the git repo containing the implementation. Default: nearest .git ancestor of plan_path.
  - since (optional): git ref for the left side of the diff. Default: parent of the commit that last modified plan_path.
outputs:
  - German summary printed to the user
  - On phantoms_found: a per-task list with line number, task text, and recommended action
---

# Phase 1 — Run phantom check

## Step 1 — Validate inputs

Before invoking the CLI:

1. Confirm `plan_path` exists and is readable. If not, ask the user for the
   correct path.
2. If `repo_path` was not supplied, the CLI will walk up from `plan_path`
   to find a `.git` directory. Trust that — only override when the user
   explicitly names a different repo.
3. `since` is almost always best left to the CLI default (parent of the
   commit that last touched the plan). Override only if the user asks for
   a wider or narrower window.

## Step 2 — Invoke the CLI

Run with `--format human` for direct user output, or `--format json` when
embedded in another workflow (e.g. phase-verifier).

```bash
node ~/.claude/skills/_shared/a1-tools.cjs phantom check "<plan_path>" \
  [--repo-path "<repo_path>"] \
  [--since "<git-ref>"] \
  --format human
```

Exit code is always 0. Capture stdout.

## Step 3 — Report to the user (German)

If `status: clean`:

> Phantom-Check sauber: alle {N} erledigten Tasks haben Code-Spuren im Diff
> seit `<since>`.

If `status: phantoms_found`:

> Phantom-Check: {K} von {N} erledigten Tasks haben keine Code-Spur.
>
> Pro Phantom:
>
> 1. **Zeile {line}:** {task}
>    - Gesuchte Begriffe: {keywords}
>    - Grund: {reason}
>    - Optionen:
>      - Code nachliefern (Task war tatsächlich nicht erledigt)
>      - Checkbox zurück auf `[ ]` setzen
>      - `# no-code` an die Task-Zeile anhängen, falls es ein reiner Docs-
>        oder Ops-Schritt war

Always include the docs-only-skipped count when non-zero:

> {M} Tasks waren mit `# no-code` markiert und wurden übersprungen.

## Step 4 — Do NOT auto-fix

This skill never edits PLAN.md. If the user wants to revert checkboxes or
add `# no-code` tags, they (or another agent) do that explicitly. The
phantom report is the deliverable.

## Edge cases

- **No completed tasks in PLAN.md.** Report "Keine erledigten Tasks im
  Plan gefunden — Phantom-Check entfällt." and exit.
- **`git diff` fails** (bad ref, detached HEAD without history, etc.).
  The CLI errors out with exit code 2 in that case (the only non-zero
  exit path). Surface the stderr to the user and suggest passing an
  explicit `--since` ref.
- **PLAN.md never committed** (still in the working tree only). The
  default `--since` walk falls back to `HEAD~20`. Mention this in the
  report so the user knows the baseline is approximate.
