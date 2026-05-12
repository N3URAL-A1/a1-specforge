# Phase 01 — Report (Triage by Falk)

Goal: turn a vague user report ("X is broken") into a complete, structured bug
report on disk. Output: a bug-report file in the Vault with `status: reported`.

## Inputs you need before starting

- Project slug (e.g. `n3ural-platform`, `niimo`)
- A symptom description (even one sentence is enough to start)

If the project slug is unclear, **ask the user in German**:
> "In welchem Projekt tritt der Bug auf? (slug, z.B. `n3ural-platform`)"

## Step 1 — Duplicate check (before anything else)

Extract 2–4 candidate keywords from the symptom (nouns + error terms, lowercase,
≥ 3 chars). Run:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix find-duplicates <project-slug> <kw1> <kw2> [<kw3> ...]
```

The helper greps the last 30 days of bug reports in the project. If matches come
back with `hit_count >= 2`, surface them to the user **in German**:

> "Es gibt vorhandene Bug-Reports der letzten 30 Tage, die ähnlich aussehen:
> - <file> ("<title>", status: <status>) — Treffer: <keywords>
>
> Ist das derselbe Bug, oder ein eigener Report?"

If user says "derselbe": stop here. Open the existing file, append a new symptom
note in `## Notes`, do NOT create a new file.

If user says "neuer Report, aber verwandt": continue with Step 2 and add
`duplicate_of: <path>` to the new bug's frontmatter after creation.

## Step 2 — Spawn Falk for the triage interview

Use the `Task` tool to spawn Falk (`~/.claude/agents/falk-bug-hunter.md`) with this brief:

> Du bist Falk im Triage-Modus. Aufgabe: ein strukturiertes Bug-Triage-Interview
> mit Robert führen. Pflicht-Themen, in dieser Reihenfolge:
>
> 1. Symptom (was geht konkret schief)
> 2. Reproduction Steps (Schritte 1–N + Expected vs Actual)
> 3. Environment (Browser/OS, App-Version/Commit, Tenant/Role, Netzwerk)
> 4. Frequency (always / X-of-Y / once / unknown)
> 5. Severity-Vorschlag (blocker / major / minor / nit) mit Begründung
> 6. User-Impact (wer ist betroffen, was geht nicht)
> 7. Affected Components (Repos, vermutete Files/Routes/Services)
> 8. Recent Changes (jüngste Deploys/Migrationen im Verdachtsfenster)
>
> **Hard Rules:** Eine Frage pro Turn. Deutsch mit Robert. Keine Diagnose, keine
> Code-Reads in dieser Phase — nur Fakten sammeln. Wenn Robert sagt "weiß ich
> nicht": akzeptieren, "unknown" notieren, nächste Frage.
>
> Wenn der Bug nicht reproduzierbar ist (Reproduction Steps unklar bleiben nach
> 2 Versuchen): Status "cant-reproduce" vorschlagen, Pause empfehlen.
>
> Output: ein strukturierter Block mit allen 8 Pflicht-Themen, sowie einem
> vorgeschlagenen `bug_slug` (kebab-case, max 5 Wörter) und Severity.

## Step 3 — Compute the file slot

Once Falk returns the structured info:

```bash
DATE=$(date +%F)   # YYYY-MM-DD
node ~/.claude/skills/_shared/a1-tools.cjs fix next-suffix <project-slug> $DATE
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
- Severity from Falk's recommendation
- Affected repos as a YAML list
- All eight interview themes filled into the corresponding sections

If a duplicate-of relation was confirmed in Step 1, set `duplicate_of: <vault-path>`.

Write the file via the Write tool to the absolute path
`<vault-root>/projects/<project-slug>/fixes/<file>`.

## Step 5 — Confirm and hand off

Tell the user **in German**:

> "Bug-Report angelegt: `projects/<slug>/fixes/<file>`. Status: reported,
> Severity: <severity>. Soll ich Phase 2 (Diagnose mit Falk) starten?"

If yes: proceed to `02-diagnose.md`.
If no: stop. The file persists; the skill can resume from frontmatter status.

## Special exits

- **cant-reproduce:** run
  `a1-tools fix update-status <bug-path> cant-reproduce` and tell Robert in German:
  "Bug nicht reproduzierbar nach Triage. Status auf cant-reproduce gesetzt.
  Wenn das Symptom wiederkehrt: einfach erneut melden."
- **cancelled:** if Robert wants to drop the report mid-triage, run
  `a1-tools fix update-status <bug-path> cancelled`. The slot stays.
