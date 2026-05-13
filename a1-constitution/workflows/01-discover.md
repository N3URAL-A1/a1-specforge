# Phase 01 — Discover

Goal: turn a vague request ("Constitution für niimo") into a fully scoped
discovery payload ready to feed Finn in Phase 2. Output: vault constitution
file on disk with `status: discovering` and a `discovery_payload.json` cached
in a tmp file for Phase 2.

## Inputs you need before starting

- Project slug (e.g. `niimo`, `n3ural-platform`)
- Repo root (absolute path on disk) — needed for CLAUDE.md scan + later mirror
- 3-5 project-specific behavioral concerns from the user (interview)

Max 3 user-facing questions, one per turn, **in German**.

## Step 1 — Determine project slug

If the user named a project, derive the slug:
- "Niimo" → `niimo`
- "n3ural-platform" / "Plattform" → `n3ural-platform`
- "a1-specforge" → `a1-specforge`

If unclear, ask **in German**:
> "Für welches Projekt soll die Constitution gebaut werden? (slug, z.B. `niimo`, `n3ural-platform`)"

## Step 2 — Determine repo root

Default mapping (verify via Bash before using):

| Slug | Default repo root |
|---|---|
| `niimo` | `/Users/rob/code/niimo` |
| `n3ural-platform` | `/Users/rob/code/n3ural-platform` |
| `a1-specforge` | `/Users/rob/code/a1-specforge` |

Verify:
```bash
ls -d <candidate-path> 2>&1
```

If ambiguous or missing, ask **in German**:
> "Wo liegt das Repo lokal? (absoluter Pfad, z.B. `/Users/rob/code/<slug>`)"

## Step 3 — Check preconditions and existing state

Run the CLI discover command:
```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution discover <project-slug> \
  --project-path "<repo-root>"
```

Parse the JSON. Check three things:

1. **CLAUDE.md missing?** If `claudemd_present: false` → soft-block. Tell Robert
   **in German**:
   > "CLAUDE.md fehlt unter `<repo-root>/CLAUDE.md`. Constitution braucht CLAUDE.md
   > als Daten-Pendant. Bitte zuerst über `~/.claude/templates/CLAUDE.md.template`
   > anlegen, dann starte ich erneut."

   Stop. Do not init the vault file.

2. **Vault constitution already exists?** Check
   `ls "<vault-root>/projects/<slug>/constitution/constitution.md"`. If yes:
   - Read its frontmatter (via Read tool, just to inspect — do NOT modify).
   - If `status` is `written`: ask Robert **in German**:
     > "Es existiert bereits eine Constitution für `<slug>` (version <N>, zuletzt
     > geschrieben <date>). Möchtest du eine neue Version starten? (ja = aktuelle
     > wird archiviert in `history/`, dann neu init / nein = abbrechen)"
     If yes: run `archive-current` (this also bumps version in the live file)
     and continue with init. Note: re-init will fail if the live file still
     exists, so we delete the live file after archiving:
     ```bash
     node ~/.claude/skills/_shared/a1-tools.cjs constitution archive-current <slug>
     rm "<vault-root>/projects/<slug>/constitution/constitution.md"
     ```
     Then proceed to Step 4.
   - If `status` is `discovering`, `drafted`, or `reviewed`: do NOT init. Tell
     Robert and offer to resume that phase instead.
   - If `status` is `cancelled`: tell Robert and ask him to clean up manually
     (move or delete the cancelled file).

3. **Repo constitution.md already exists but no vault file?** That is a drift.
   Tell Robert **in German**: "Im Repo gibt es bereits eine `constitution.md`,
   aber keine Vault-Version. Soll ich die Vault-Version aus dem Repo importieren
   (manueller Schritt — bitte Inhalt prüfen) oder bei Null anfangen und den
   Repo-Spiegel später überschreiben?" — wait for decision.

## Step 4 — Initialize the vault file

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution init <project-slug> \
  --title "Constitution for <project-slug>"
```

Returns JSON with the absolute vault path. Capture it as `CONST_PATH`.

## Step 5 — Behavioral-rules interview (3-5 Q in German)

Now collect project-specific behavioral concerns. These become the "Project
Behavioral Rules" section in the constitution. Ask **one question per turn**,
in German, max 3 questions total. Suggested:

1. > "Welche 2-3 Regeln gelten projektweit, die nicht in den globalen Rules
   >  stehen? (z.B. RLS-Pflicht, kein Hotfix ohne PR-Review, Migrations immer
   >  in eigener PR, ...)"

2. > "Gibt es Agent-Rollen, die in diesem Projekt **eingeschränkt** sind?
   >  (z.B. „Walter darf hier nichts deployen, nur lokal bauen", „Aik macht
   >  keine RAG-Experimente in production code", ...)"

3. > "Was ist die wichtigste Konvention, die ein neuer Agent in 30 Sekunden
   >  wissen muss, bevor er Code anfasst?"

Capture answers verbatim. They go into the Finn brief in Phase 2.

## Step 6 — Stash discovery payload for Phase 2

Write a tmp JSON file with everything Finn needs. Use `Write` tool to a path
like `/tmp/a1-const-<slug>-<timestamp>.json`. Schema:

```json
{
  "project": "<slug>",
  "repo_root": "<abs>",
  "vault_path": "<CONST_PATH>",
  "discovery": {
    "claudemd_path": "...",
    "claudemd_excerpt": "...",
    "global_rules": ["common/coding-style.md", "common/agents.md", ...],
    "has_link_to_constitution": false,
    "repo_constitution_present": false
  },
  "interview": {
    "project_rules": "<verbatim Q1 answer>",
    "agent_restrictions": "<verbatim Q2 answer>",
    "key_convention": "<verbatim Q3 answer>"
  }
}
```

Capture the tmp path as `DISCOVERY_PAYLOAD_PATH`.

## Step 7 — Confirm and route to Phase 2

Tell Robert **in German**:
> "Discovery abgeschlossen. Vault-Datei: `projects/<slug>/constitution/constitution.md`
>  (status: discovering). Globale Rules erfasst: <N>, CLAUDE.md gelesen, Interview
>  geführt.
>
>  Soll ich Phase 2 starten? Finn (cc-architect) bekommt den Discovery-Output
>  und entwirft die Constitution."

If yes: proceed to `02-draft.md`. Do NOT auto-update status — the status moves
to `drafted` only AFTER Finn returns successfully in Phase 2.

## Special exits

- **User abbricht in Phase 1:**
  ```bash
  node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
    "<CONST_PATH>" cancelled
  ```
  Tell Robert auf Deutsch: "Constitution abgebrochen vor Draft. Status auf
  cancelled. Vault-File bleibt für Audit. Beim nächsten Start bitte erst
  manuell aufräumen."

- **CLI-Error in `init` (file already exists):** that means there's a leftover
  file the routing in Step 3 missed. Tell Robert auf Deutsch was kaputt ist
  und biete an, ihn beim Aufräumen zu unterstützen — aber editiere keine Files
  ohne explizite Bestätigung.
