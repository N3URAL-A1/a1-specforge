# Phase 01 — Scope

Goal: turn a vague request ("Analysiere mal Niimo") into a fully scoped analysis
file on disk. Output: analysis file in the Vault with `status: scoped`.

## Inputs you need before starting

- Project slug (e.g. `niimo`, `n3ural-platform`, `n3ural.a1`)
- Focus: one of `general`, `security`, `architecture`, `quality`, `onboarding`
- Local code path (absolute) — where the project lives on disk

Max 2 clarifying questions, one per turn, **in German**.

## Step 1 — Determine project slug

If the user named a project, derive the slug:
- "Niimo" → `niimo`
- "n3ural-platform" / "Plattform" → `n3ural-platform`
- "n3ural.a1" / "a1" / "a1-specforge" → ask for explicit slug, both exist

If unclear, ask **in German**:
> "Welches Projekt soll analysiert werden? (slug, z.B. `niimo`, `n3ural-platform`, `a1-specforge`)"

## Step 2 — Determine focus

If the user mentioned a focus area, map to one of the five modes:
- "Security", "Audit", "DSGVO", "Auth" → `security`
- "Architektur", "Module", "System-Design", "ADR" → `architecture`
- "Quality", "Code-Qualität", "Wartbarkeit", "Tests" → `quality`
- "Onboarding", "Doku", "neuer Entwickler", "Einstieg" → `onboarding`
- "Überblick", "allgemein", nichts spezifisch → `general`

If unclear, ask **in German**:
> "Welcher Fokus? Optionen: `general` (Überblick), `security` (Sicherheit + Compliance), `architecture` (System-Design), `quality` (Code-Qualität), `onboarding` (für neue Entwickler)."

## Step 3 — Determine local code path

The default mapping for known projects (verify via Bash before using):

| Slug | Default path |
|---|---|
| `niimo` | `/Users/rob/code/niimo` |
| `n3ural-platform` | `/Users/rob/code/n3ural-platform` |
| `a1-specforge` | `/Users/rob/code/a1-specforge` |

Verify the path exists:
```bash
ls -d <candidate-path> 2>&1
```

If the path does not exist or is ambiguous, ask **in German**:
> "Wo liegt der Code lokal? (absoluter Pfad, z.B. `/Users/rob/code/<slug>`)"

## Step 4 — Initialize the analysis file

Run:
```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze init <project-slug> <focus> \
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

Tell the user **in German**:

> "Analyse angelegt: `projects/<slug>/analyses/<file>`.
>  Fokus: `<focus>`. Lokaler Pfad: `<analyzed_path>`.
>  
>  Soll ich Phase 2 (Discover — Tech-Stack scannen, deterministisch, schnell) starten?"

If yes: proceed to `02-discover.md`.
If no: stop. The file persists with `status: scoped`. The skill can resume.

## Special exits

- **User abbricht in Phase 1:** run
  `a1-tools analyze update-status <path> cancelled`. Tell Robert auf Deutsch:
  "Analyse abgebrochen vor Discover. Status auf cancelled. Slot bleibt belegt;
  beim nächsten Lauf am selben Tag wird `-2` vergeben."
- **Path nicht zugreifbar:** sage Robert was kaputt ist (Pfad existiert nicht,
  keine Read-Rechte, etc.), warte auf Korrektur. Lege noch KEIN File an, sonst
  hängt eine leere Analyse im Vault.
