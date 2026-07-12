# Phase 01 — Report (Triage by Falk)

Goal: turn a vague user report ("X is broken") into a complete, structured bug
report on disk. Output: a bug-report file in the Vault with `status: reported`.

**Pre-condition:** Phase 00 (Pre-Flight) must have completed with integrity-check
status `ok` or `bootstrapped`. Never run Phase 01 if integrity-check returned
`mismatch`.

## Inputs you need before starting

- Project slug (e.g. `my-platform`, `my-project`)
- A symptom description (even one sentence is enough to start)
- Bug-patterns summary from Pre-Flight (carry forward into Falk's brief)
- Related postmortems found in Pre-Flight (if any)

If the project slug is unclear, **ask the user**:
> "In which project does the bug occur? (slug, e.g. `my-platform`)"

## Step 1 — Duplicate check (before anything else)

Extract 2–4 candidate keywords from the symptom (nouns + error terms, lowercase,
≥ 3 chars). Run:

```bash
node <repo>/_shared/a1-tools.cjs fix find-duplicates <project-slug> <kw1> <kw2> [<kw3> ...]
```

The helper greps the last 30 days of bug reports in the project. If matches come
back with `hit_count >= 2`, surface them to the user:

> "There are existing bug reports from the last 30 days that look similar:
> - <file> ("<title>", status: <status>) — matched: <keywords>
>
> Is this the same bug, or a separate report?"

If user says "same bug": stop here. Open the existing file, append a new symptom
note in `## Notes`, do NOT create a new file.

If user says "new report, but related": continue with Step 2 and add
`duplicate_of: <path>` to the new bug's frontmatter after creation.

## Step 2 — Spawn Falk for the triage interview

Use the `Task` tool to spawn Falk (`~/.claude/agents/a1-falk-fault-finder.md`) with this brief:

> You are Falk in triage mode. Task: conduct a structured bug triage interview
> with the user. Required topics, in this order:
>
> **Context from Pre-Flight (use to inform diagnosis cross-check):**
> <bug-patterns-summary from Phase 00>
> <related-postmortems from Phase 00, if any>
>
> 1. Symptom (what exactly is going wrong)
> 2. Reproduction Steps (steps 1–N + Expected vs Actual)
> 3. Environment (Browser/OS, App version/commit, Tenant/Role, Network)
> 4. Frequency (always / X-of-Y / once / unknown)
> 5. Severity suggestion (blocker / major / minor / nit) with reasoning
> 6. User Impact (who is affected, what they cannot do)
> 7. Affected Components (repos, suspected files/routes/services)
> 8. Recent Changes (recent deploys/migrations in the suspected window)
>
> **Hard Rules:** One question per turn. No diagnosis, no code reads in this
> phase — only collect facts. If the user says "don't know": accept it, record
> "unknown", move to the next question.
>
> If the bug is not reproducible (reproduction steps remain unclear after
> 2 attempts): suggest status "cant-reproduce", recommend a pause.
>
> Output: a structured block with all 8 required topics, a suggested
> `bug_slug` (kebab-case, max 5 words), and severity.

## Step 3 — Compute the file slot

Once Falk returns the structured info:

```bash
DATE=$(date +%F)   # YYYY-MM-DD
node <repo>/_shared/a1-tools.cjs fix next-suffix <project-slug> $DATE
```

The helper returns `{ suffix: "" | "-2" | "-3" | ... }`. Final filename:

```
projects/<project-slug>/fixes/<YYYY-MM-DD>-<bug-slug><suffix>.md
```

## Step 4 — Render the bug report

Read `~/.claude/skills/a1-fix/templates/bug-report-template.md` and substitute:

- `<PROJECT_SLUG>`, `<BUG_SLUG>`, `<ONE_LINE_TITLE>`
- `<YYYY-MM-DDTHH:MM>` for `reported_at` (use local time, minute precision)
- `<ISO_TIMESTAMP>` for the `phase_history` entry (full ISO)
- `<REPORTER>` — the name or identifier of the person reporting (from user context)
- Severity from Falk's recommendation
- Affected repos as a YAML list
- All eight interview themes filled into the corresponding sections

If a duplicate-of relation was confirmed in Step 1, set `duplicate_of: <vault-path>`.

Write the file via the Write tool to the absolute path
`<vault-root>/projects/<project-slug>/fixes/<file>`.

## Step 5 — Confirm and hand off

Tell the user:

> "Bug report created: `projects/<slug>/fixes/<file>`. Status: reported,
> Severity: <severity>. Should I start Phase 2 (Diagnose with Falk)?"

If yes: proceed to `02-diagnose.md`.
If no: stop. The file persists; the skill can resume from frontmatter status.

## Special exits

- **cant-reproduce:** run
  `a1-tools fix update-status <bug-path> cant-reproduce` and tell the user:
  "Bug not reproducible after triage. Status set to cant-reproduce.
  If the symptom comes back, just report it again."
- **cancelled:** if the user wants to drop the report mid-triage, run
  `a1-tools fix update-status <bug-path> cancelled`. The slot stays.
