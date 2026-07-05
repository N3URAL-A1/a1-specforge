# Phase 01 — Scope

Goal: turn a vague request ("modernize my-app") into a fully scoped master file
on disk. Output: master file in the Vault with `status: scoped`.

## Inputs needed

- Project slug (e.g. `niimo`, `my-app`)
- Mode: `spec-only` or `full`
- Local code path (absolute)

Max 2 clarifying questions, one per turn.

## Step 1 — Determine project slug

If the user named a project, derive the slug. If unclear:
> "Which project should be modernized? (slug, e.g. `niimo`, `my-app`)"

## Step 2 — Determine mode

Ask unless the user already indicated:
> "Which mode?
> - `spec-only` — just understand what the app does (read-only, fast, no code changes)
> - `full` — understand + close gaps + modernize the code (with your approval per step)"

Map user answers (aliases in either language):
- "just understand", "read", "analyze" / "nur verstehen", "lesen", "analyse" → `spec-only`
- "clean up", "fix", "modernize", "improve" / "aufräumen", "fixen", "modernisieren", "verbessern" → `full`

## Step 3 — Determine local code path

Verify the path exists:
```bash
ls -d "<candidate-path>" 2>&1
```

If the path does not exist, ask:
> "Where is the code? (absolute path, e.g. `<project-root>`)"

## Step 4 — Initialize the master file

```bash
node ~/.claude/skills/_shared/a1-tools.cjs modernize init \
  <project-slug> <mode> \
  --project-path "<absolute-code-path>"
```

Parse the returned JSON, capture the master file path.

## Step 5 — Run stack discovery

```bash
node ~/.claude/skills/_shared/a1-tools.cjs modernize discover-stack \
  "<absolute-code-path>"
```

This populates `discover.tech_stack`, `discover.loc`, `discover.file_count`,
and `discover.test_coverage_pre` in the frontmatter. Use the output to determine
which agents will be relevant in Phase 4.

## Step 6 — Confirm with the user

> "Modernize run created: `projects/<slug>/modernize/<file>`.
> Mode: `<mode>`. Code path: `<analyzed_path>`.
> Stack detected: <tech_stack list>.
>
> Shall I start Phase 2 (Reverse-Spec — Rafael reads the code and derives its behavior)?"

If yes: proceed to `02-reverse-spec.md`.
If no: stop. Master file persists with `status: scoped`.

## Special exits

- **User cancels:** `a1-tools modernize update-status <path> cancelled`
- **Path not accessible:** tell the user what is broken, wait for correction. Do NOT create the master file yet.
