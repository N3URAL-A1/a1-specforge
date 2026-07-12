# Phase 01 — Scope

Goal: turn a vague request ("Analyze my-project") into a fully scoped analysis
file on disk. Output: analysis file in the Vault with `status: scoped`.

## Inputs you need before starting

- Project slug (e.g. `my-project`, `my-platform`, `a1-specforge`)
- Focus: one of `general`, `security`, `architecture`, `quality`, `onboarding`
- Local code path (absolute) — where the project lives on disk

Max 2 clarifying questions, one per turn.

## Step 1 — Determine project slug

If the user named a project, derive the slug:
- "my-project" → `my-project`
- "my-platform" / "platform" → `my-platform`
- "a1-specforge" / "a1" → ask for explicit slug

If unclear, ask the user:
> "Which project should be analyzed? (slug, e.g. `my-project`, `my-platform`, `a1-specforge`)"

## Step 2 — Determine focus

If the user mentioned a focus area, map to one of the five modes:
- "Security", "Audit", "Auth" → `security`
- "Architecture", "Modules", "System Design", "ADR" → `architecture`
- "Quality", "Code Quality", "Maintainability", "Tests" → `quality`
- "Onboarding", "Docs", "New Developer" → `onboarding`
- "Overview", "General", nothing specific → `general`

If unclear, ask the user:
> "Which focus? Options: `general` (overview), `security` (security + compliance), `architecture` (system design), `quality` (code quality), `onboarding` (for new developers)."

## Step 3 — Determine local code path

The default mapping for known projects (verify via Bash before using):

| Slug | Default path |
|---|---|
| `my-project` | `/path/to/my-project` |
| `my-platform` | `/path/to/my-platform` |
| `a1-specforge` | `/path/to/a1-specforge` |

Verify the path exists:
```bash
ls -d <candidate-path> 2>&1
```

If the path does not exist or is ambiguous, ask the user:
> "Where is the code located locally? (absolute path, e.g. `/path/to/<slug>`)"

## Step 4 — Initialize the analysis file

Run:
```bash
node <repo>/_shared/a1-tools.cjs analyze init <project-slug> <focus> \
  --project-path "<absolute-code-path>" \
  --title "<focus> analysis of <project-slug>"
```

The helper:
- Computes the next free slot (`<YYYY-MM-DD>-<focus>[-N].md`) under
  `projects/<slug>/analyses/`
- Creates the directory if needed
- Writes the file atomically with initial frontmatter and body scaffolding
- Returns JSON with the absolute path

Parse the JSON, capture the path.

## Step 5 — Confirm with the user

Tell the user:

> "Analysis created: `projects/<slug>/analyses/<file>`.
>  Focus: `<focus>`. Local path: `<analyzed_path>`.
>  
>  Should I start Phase 2 (Discover — scan tech stack, deterministic, fast)?"

If yes: proceed to `02-discover.md`.
If no: stop. The file persists with `status: scoped`. The skill can resume.

## Special exits

- **User cancels in Phase 1:** run
  `a1-tools analyze update-status <path> cancelled`. Tell the user:
  "Analysis cancelled before Discover. Status set to cancelled. Slot is
  reserved; next run on the same day will use `-2`."
- **Path not accessible:** tell the user what is broken (path does not exist,
  no read permissions, etc.), wait for correction. Do NOT create the file yet,
  otherwise an empty analysis stays in the Vault.
