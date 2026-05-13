# Phase 02 — Discover (CLI-driven, no sub-agents)

Goal: build a deterministic fact base about the project so Phase 3 dispatches
have precise context. Output: analysis file with `status: discovered` and a
filled Discover section.

This phase runs WITHOUT sub-agents. Speed and reproducibility are the priority.

## Step 1 — Run the discover helper

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze discover <absolute-project-path>
```

The helper returns JSON:
```json
{
  "project_path": "/Users/rob/code/niimo",
  "tech_stack": ["docker", "flutter", "node", "supabase", "typescript"],
  "loc": 24800,
  "file_count": 312,
  "last_commit": "2026-05-11T10:32:14+02:00",
  "branch": "main",
  "commit_count_30d": 47
}
```

Capture this JSON. If the helper exits non-zero or returns empty `tech_stack`,
do NOT proceed — tell Robert which path was tried and ask for a corrected path.
A discover step with no stack signals fail-fast.

## Step 2 — Persist into frontmatter

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze update-status \
  "<analysis-path>" discovered \
  --phase-data '<the JSON object from Step 1, stringified>'
```

The helper merges keys from the JSON into `discover[]` as `key=value` entries
and appends a `phase=discover` entry to `phase_history`.

## Step 3 — Render the Discover section in the body

Use the Edit tool to replace the placeholder under `## Discover (Phase 2 — filled by CLI)`
with a Markdown table:

```
## Discover

| Key | Value |
|---|---|
| Tech stack | <comma-separated list> |
| LOC | <n> |
| File count | <n> |
| Last commit | <ISO date> |
| Branch | <name> |
| Commits (30 days) | <n> |
```

## Step 4 — Summarize for Robert, in German

> "Discover abgeschlossen für `<project-slug>`:
>  - Tech-Stack: <list>
>  - <loc> LOC in <file_count> Dateien
>  - Letzter Commit: <date> auf Branch `<branch>` (<n> Commits in 30 Tagen)
>  
>  Soll ich Phase 3 (Analyze — Sub-Agents parallel dispatchen) starten?"

If yes: proceed to `03-analyze.md`.
If no: stop. State persists; resume reads `status: discovered`.

## Edge cases

- **No git repo (`last_commit` is null):** that's okay, the helper handles it.
  In the summary, say: "Kein Git-Repo gefunden — Commit-Stats nicht verfügbar."
- **Empty tech_stack:** likely the path is not actually a project root.
  Stop. Ask Robert to verify the path. Do NOT advance status.
- **Very large repo (LOC > 200k):** flag it in the summary auf Deutsch
  ("Großes Repo, Sub-Agent-Dispatches in Phase 3 brauchen mehr Tokens"). Robert
  decides whether to continue.
- **Mono-repo:** if the helper detects `turborepo` or `nx` in the stack, mention
  in the summary that sub-agents in Phase 3 should be briefed with the specific
  sub-package path if the user has a focus on one part of the mono-repo.
