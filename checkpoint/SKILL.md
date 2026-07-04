---
name: checkpoint
description: Save session state across all memory layers (project MEMORY.md, Obsidian Vault, Cloud-Brain-Wiki, optional git) and free the context window. Use whenever context is getting heavy, when switching between major tasks mid-session, or when ending a session. Triggers on "checkpoint", "save state", "neuen context", "context refresh", "save and clear", "frischer context", "gute nacht", "session beenden", "feierabend", "ich geh dann mal", or any indication the user wants to preserve work and either refresh or close. Use proactively when context is above 70% capacity. Replaces the old `new-context` skill and `/gute-nacht`. Two modes — default (mid-session refresh) and full (session end with git + farewell). The user signals full mode with phrases like "feierabend", "session beenden", "gute nacht", "--end", or by explicitly asking to commit and close.
---

# Checkpoint — Save State, Free Context

Persist everything worth keeping across all memory layers, then hand the context window back. The metaphor is a savepoint in a game: you stop, save, and either keep playing with a clean slate or shut down.

## Two Modes

| Mode | Trigger | Steps |
|---|---|---|
| **Refresh** (default) | "checkpoint", "save and clear", "frischer context", mid-session | 1-5 |
| **Full** (session end) | "feierabend", "gute nacht", "session beenden", "--end" | 1-7 |

The mode is inferred from the user's phrasing. If unclear, ask once: "Refresh oder Session-Ende?"

## Behavior Rules

- Never ask for confirmation on individual steps. The user invoked the skill deliberately. **Einzige Ausnahme:** CLAUDE.md-Änderungen in Step 7 — siehe dort.
- One brief status line per step in German ("Memory aktualisiert.", "Obsidian synchronisiert.").
- If a step fails, report the error and continue. Don't abort the whole routine.
- If a previous skill (`rem-sleep`, `obsidian-vault`) ran in the same session and nothing changed since, abbreviate that step to "bereits gelaufen, übersprungen."
- Effort is proportional to context size. Short session with few changes → light steps. Long session with many decisions → thorough steps.
- All German user-facing output. Internal reasoning in English is fine.

---

## Step 1 — Session Summary

Write 3-5 bullets covering what happened since the last checkpoint or session start:

- Decisions made
- Files changed (paths, not full diffs)
- Things learned (surprises, gotchas, validated assumptions)
- Open threads (what is unfinished)

**Reihenfolge-Regel (hart):** Diese Summary MUSS das erste sichtbare Output des Skills sein. Führe Steps 2-7 erst aus, NACHDEM die Summary im Chat steht. Niemals erst persistieren und dann zusammenfassen — der User soll Gelegenheit haben, im Zweifel abzubrechen, bevor Files geschrieben werden.

## Step 2 — Project MEMORY.md

Locate the project-local auto-memory directory:

```
~/.claude/projects/<slug>/memory/
```

Where `<slug>` is the working directory path with `/` replaced by `-` and a leading `-`. For `/Users/rob/code/n3ural-platform` the slug is `-Users-rob-code-n3ural-platform`.

If the directory exists:

1. Read `MEMORY.md` (the index).
2. For each significant insight from Step 1, decide: new memory file, update existing, or skip (already covered).
3. Memory files use frontmatter (`name`, `description`, `type` ∈ {user, feedback, project, reference}).
4. Add the new pointer to `MEMORY.md` as a one-liner under ~150 chars.
5. Remove or rewrite entries that are now stale.

If the directory does not exist: skip with one line ("Kein Auto-Memory für dieses Projekt — übersprungen.").

Do **not** save: code patterns derivable from the repo, git history, ephemeral task state, anything already in CLAUDE.md.

## Step 3 — Obsidian Vault Sync (7-Typen-IA)

Vault path: `~/N3URAL-Vault/`. Struktur-Spec: `~/N3URAL-Vault/reference/brain-ia.md`.
**Wildwuchs-Verbot:** KEINE `daily-notes`/`sessions`/`wiki`/`areas`/`Meta`-Ordner anlegen. Nur die 7 Typen.

| Was | Typ/Ordner |
|---|---|
| Projekt-Status/-Entscheidungen | `project/<slug>.md` (Hub aktualisieren) |
| Wiederverwendbares Know-how / Lessons | `pattern/<slug>.md` |
| Dauerhafte Entscheidung/Ergebnis | `record/YYYY-MM-DD-<slug>.md` |
| Idee | `idea/<slug>.md` |
| Extern (Tool/Person/Research) | `reference/<slug>.md` |

Rules:

- Append/Update, never overwrite blind. YAML-Frontmatter (`type:` Pflicht) erhalten.
- **Relationen ergänzen** (`## Relations`: `part_of [[project/…]]`, `relates_to`, `used_agent [[agent/…]]`). Spine = Projekt-Hub.
- German content. Wikilinks im IA-Format `[[ordner/slug]]`.
- **KEINE Session-/Daily-Notes manuell schreiben** — der Stop-Hook erzeugt verlinkte `session/`-Notizen automatisch. Die Session-Summary aus Step 1 fließt dort ein, nicht in eine Daily-Note.
- Slug = kebab-case; Datum nur bei `record/`.
- Lokales Basic Memory (Daemon) indexiert Änderungen automatisch — kein manuelles Reindex nötig.

If `obsidian-vault` skill ran earlier in the session and nothing changed since: skip with one line.

## Step 3b — Cloud-Brain Sync (PFLICHT)

Der **Cloud-MT-Brain** (`brain-proxy-mt`, Roberts Tenant) ist die Single Source of Truth.
Der Vault bleibt als Backup/Schreib-Quelle erhalten, aber JEDE in Step 3 geschriebene oder
aktualisierte Vault-Notiz wird zusätzlich in den Cloud-Brain gespiegelt — damit das Wissen
sofort über Claude Desktop durchsuchbar ist und nicht erst beim nächsten Bulk-Import.

Vorgehen:

1. Sammle die Liste der Vault-`.md`-Dateien, die du in Step 3 angelegt/geändert hast (volle Pfade).
   Wenn Step 3 nichts geschrieben hat → skip mit einer Zeile ("Cloud-Brain: nichts zu syncen.").
2. Push sie mit dem Helper-Script (stdlib-only, idempotent via `overwrite=True`):

   ```bash
   export BRAIN_ROBERT_TOKEN="$(security find-generic-password -s brain-robert-token -w)"
   python3 ~/.claude/skills/checkpoint/push-to-brain.py <pfad1.md> <pfad2.md> …
   ```

3. Output kurz fassen ("Cloud-Brain: 2 ok, 0 fail.").

**Fallback:** Schlägt der Push fehl (Token weg, Proxy down, `… fail`-Zeile): mit
"Cloud-Brain-Sync übersprungen (<grund>) — Vault bleibt die Backup-Persistenz." markieren
und weiter zu Step 4. Kein Retry, kein Abbruch. Der Vault-Eintrag aus Step 3 ist die Absicherung.

**Hinweis (Roadmap):** Solange der Checkpoint die Schreib-Quelle Vault→Brain ist, bleibt der
Vault nötig. „Vault ganz weg" hieße: Step 3 schreibt direkt + nur in den Brain. Noch nicht — der
Vault ist aktuell bewusst das Backup.

## Step 3c — Projekt-Roadmap aktualisieren

Wenn die Session Fortschritt an einem getrackten Projekt erzeugt hat (Status-Wechsel von Epics/Stories, neue Entscheidungen, abgeschlossene Meilensteine):

1. Prüfe ob ein Roadmap-Ordner existiert:
   ```
   ~/N3URAL-Vault/projects/<slug>/roadmap/data.json
   ```
   Falls nicht vorhanden: eine Zeile "Keine Roadmap-Änderung." und weiter zu Step 4.

2. Wenn vorhanden und Roadmap-relevante Dinge passiert sind:
   - `data.json` aktualisieren: Status-Badges der betroffenen Items (Epic/Story/Milestone) auf neuen Stand setzen.
   - Einen Changelog-Eintrag hinzufügen (Datum + 1 Satz was sich geändert hat).
   - Dann `node generate.mjs` im selben Ordner ausführen, damit die HTML-Ausgabe regeneriert wird.
   - Melden: "Roadmap aktualisiert: `<n>` Items, Changelog v`<version>`."

3. Was als Roadmap-relevant gilt:
   - Wave oder Phase einer Spec wechselt Status (z.B. DONE, IN PROGRESS, BLOCKED)
   - Neuer Meilenstein oder Epic angelegt
   - Dauerhafte Architektur-Entscheidung (ADR) getroffen
   - Feature-Scope geändert (Hinzufügen, Streichen, Verschieben)

4. Was NICHT Roadmap-relevant ist:
   - Reine Bug-Fixes ohne Spec-Bezug
   - Refactoring ohne Auswirkung auf Spec-Status
   - Interne Anpassungen (Tests, Doku-Aktualisierungen)
   - Sessions die nur lesen/analysieren, nichts liefern

**Fallback:** Schlägt `node generate.mjs` fehl (Datei fehlt, Node-Fehler): `data.json` trotzdem speichern und melden "Roadmap-Daten gespeichert, HTML-Generierung fehlgeschlagen (`<Fehler>`) — manuell `node generate.mjs` ausführen."

## Step 4 — Brain-Wiki Status (optional)

Der direkte Vault→Brain-Sync läuft bereits in **Step 3b** (die SSOT-Persistenz ist damit abgedeckt). Step 4 ist nur noch für den Fall gedacht, dass die Session einen **getrackten Feature-/Projekt-Status** berührt hat, der eine eigene Status-Notiz im Brain-Wiki verdient (z.B. OF-P-* spec, A1 Office feature catalog, brand compass) und der nicht schon als Vault-Notiz in Step 3 geschrieben wurde.

How to decide:

- Step 3/3b hat den Status bereits gespiegelt → Step 4 entfällt ("Brain-Status bereits via Step 3b abgedeckt.")
- Session changed implementation status of a tracked feature, aber keine Vault-Notiz dafür → kurze Status-Notiz via Norbert
- Pure bug-fix or refactor with no spec impact → no
- Unsure → no (better to skip than to spam the Brain-Wiki)

Delegation pattern:

> "Norbert, kurzer Status-Update für [Feature/Project]: [1-2 Sätze aus Step 1]. Bitte die zugehörige Brain-Wiki-Notiz (project/<slug>) aktualisieren."

If the Brain-Wiki is not separately relevant for this session: one line ("Kein Brain-Wiki-Update nötig — via Step 3b abgedeckt.") and continue.

**Fallback bei Agent-Fehler:** Wenn `norbert-notion-keeper` nach 60 Sekunden nicht antwortet, einen Fehler zurückgibt oder nicht verfügbar ist: Step 4 mit "Brain-Wiki-Update übersprungen (Agent nicht verfügbar)." markieren und sofort zu Step 5 weitergehen. Kein Retry, kein Block. Der Vault-Eintrag aus Step 3 + der Push aus Step 3b sind die Persistenz.

## Step 5 — Handoff Note + Clear Instruction

Output a short visible handoff:

- **Was gemacht wurde** (1-2 Sätze)
- **Was noch offen ist** (falls relevant)
- **Was Robert als Nächstes wahrscheinlich will** (1 Zeile)

**Uncommitted-Changes-Check (PFLICHT, auch im Refresh-Modus):**
Vor dem `/clear`-Hinweis IMMER `git status --porcelain` laufen lassen. Wenn die Ausgabe nicht leer ist (uncommitted oder staged changes), einen sichtbaren Warn-Block ausgeben:

> ⚠ **Achtung:** Es liegen uncommitted Changes im Repo:
> - `<file1>` (modified)
> - `<file2>` (untracked)
>
> Wenn du jetzt `/clear` tippst, geht der Chat-Verlauf weg — die Files bleiben aber lokal erhalten. Wenn du die Arbeit committen willst, sag "commit" oder rufe checkpoint im Full-Modus auf ("feierabend").

**Auto-Push committeter Commits (PFLICHT, auch im Refresh-Modus):**
Robert will, dass nach JEDEM Checkpoint der lokale Stand auf origin landet — nicht nur im Full-Modus. Daher nach dem Uncommitted-Check IMMER prüfen, ob bereits committete, ungepushte Commits vorliegen, und sie pushen:

1. Upstream prüfen: `git rev-parse --abbrev-ref --symbolic-full-name @{u}`.
   - Schlägt fehl (kein Upstream) → **kein Push**, Hinweis: "Branch trackt keinen Remote — Commits liegen lokal. Einmalig: `git push -u origin <branch>`." (Refresh-Mode endet hier.)
2. Ungepushte Commits zählen: `git rev-list --count @{u}..HEAD`.
   - `0` → nichts zu tun, weiter.
   - `>0` → `git push` ausführen. Hinterher kurz melden: "`N` Commit(s) nach `<remote>/<branch>` gepusht." Bei GitHub optional die Repo-URL.
3. **Force/Rewrite-Schutz:** Wenn der Push rejected wird (non-fast-forward), NICHT mit `--force` nachlegen. Stattdessen melden: "Push abgelehnt — origin ist voraus. Vor dem nächsten Push `git pull --rebase` nötig." Robert entscheidet.

Das deckt den Normalfall ab (committed im Verlauf der Session, aber noch nicht gepusht). Uncommitted Changes bleiben Sache des Full-Modus (Step 6) bzw. eines expliziten "commit".

Erst NACH Warn-Block UND Auto-Push kommt diese exakte Zeile:

> **Jetzt `/clear` eingeben — der Context wird komplett zurückgesetzt. Alles Wichtige ist gespeichert.**

`/clear` is a built-in CLI command that the user must type — it cannot be invoked from a skill. Unlike `/compact`, `/clear` wipes the window completely. This is safe because Steps 1-4 already persisted everything **chat-context-relevante**. Files im Working Tree sind eine eigene Persistenz-Schicht — daher der Warn-Block oben.

**Refresh mode ends here.**

---

## Step 6 — Build-Check + Git Commit & Push (full mode only)

Code is the most valuable artifact. Don't leave it uncommitted overnight. **Aber:** "Code committed" ≠ "Code funktioniert" — daher zuerst Build-Check, dann Commit.

### 6a — Build-Check (PFLICHT vor erstem Commit)

1. Wenn Working Tree clean ist: skip 6a, weiter zu 6b.
2. Build-Command ermitteln:
   - Erst CLAUDE.md im Repo-Root lesen — dort ist der Build-Command meist unter "Commands" dokumentiert (z.B. `npm run build`, `pnpm build`, `cargo build`).
   - Fallback bei Node-Projekt: `npm run build` (oder `pnpm build` wenn `pnpm-lock.yaml` existiert).
   - Fallback bei anderem Stack: skip mit Hinweis "Kein Build-Command bekannt — Build-Check übersprungen."
3. Build laufen lassen. Output kurz fassen (Exit-Code + letzte Fehlerzeile bei rot).
4. Resultat merken — fließt in 6b ein.

### 6b — Commit

1. `git status` und `git diff --stat` zeigen.
2. Wenn clean: "Repo ist sauber." → fertig.
3. Wenn Changes existieren:
   - Logisch gruppieren (feature, fix, refactor, docs, chore).
   - Pro Unit ein Commit. Conventional Commit Format: `<type>(<scope>): <description>`.
   - **Niemals** stagen: `.env*`, Credentials, `.DS_Store`, Build-Artefakte, oder irgendwas das `.gitignore` matcht. Explizite Pfade angeben, nie `git add -A` / `git add .`.
   - **Bei rotem Build (aus 6a):** Commit trotzdem ausführen, ABER mit Warn-Body in der Commit-Message:
     ```
     <type>(<scope>): <description>

     ⚠ Build failing — committed for safety, fix before deploy.
     <kurze Fehler-Zusammenfassung aus 6a>
     ```
4. Bei Konflikten oder Hook-Failures: klar reporten, nicht force-resolven, niemals `--no-verify`.

### 6c — Push

Push-Logik ist deterministisch:

| Bedingung | Aktion |
|---|---|
| Branch trackt KEINEN Remote (`git rev-parse --abbrev-ref --symbolic-full-name @{u}` schlägt fehl) | **Kein Push.** Stattdessen ausgeben: "Branch `<name>` trackt keinen Remote. Commits liegen lokal. Zum Pushen: `git push -u origin <name>`." |
| Branch trackt Remote UND User hat "kein push" / "no push" gesagt | **Kein Push.** Ausgeben: "Push übersprungen (auf Wunsch). Remote-Branch: `<remote>/<name>`." |
| Branch trackt Remote UND User hat nicht widersprochen | **Push.** Hinterher Remote-Branch-URL ausgeben (bei GitHub: `gh browse --no-browser` oder Pfad-Konstruktion aus `git remote get-url`). |

Commit-Hashes kurz zeigen, damit der User sieht was gelandet ist.

## Step 7 — CLAUDE.md Check + Farewell (full mode only)

**CLAUDE.md check:** Read the project's `CLAUDE.md`. If this session produced anything future sessions need — architecture decisions, new conventions, changed patterns, new skills — handle it nach folgender Regel:

| Art der Änderung | Vorgehen |
|---|---|
| **Additiv & klein** (z.B. neuer Befehl, neuer Pfad-Hinweis, Status-Update einer Wave) | **Direkt anwenden**, danach kurzen Diff zeigen ("CLAUDE.md aktualisiert: +3 Zeilen unter `## Commands`."). Keine Rückfrage. |
| **Strukturell oder semantisch** (Architektur-Convention ändert sich, Sektion umgeschrieben, > 20 Zeilen Diff) | **Vorschlag im Chat**, NICHT anwenden. User entscheidet. Dies ist die einzige erlaubte Confirmation-Pause im ganzen Skill — bewusst, weil CLAUDE.md jede zukünftige Session prägt. |
| **Keine Änderung nötig** | "CLAUDE.md ist aktuell." |

200-Zeilen-Soft-Limit beachten. Wenn die Datei sich dem Limit nähert, das Auslagern in `.claude/rules/` oder eine Topic-Datei vorschlagen (immer als Vorschlag, nicht direkt umsetzen — fällt unter "strukturell").

**Farewell:** One short friendly sentence in German. No emoji. No long summary (already done in Step 1).

End with this exact line:

> **Du kannst die Session jetzt mit Ctrl+C oder `/exit` schliessen.**

---

## Quick-Skip Logic

| Condition | Effect |
|---|---|
| `rem-sleep` ran <10 min ago, nothing changed | Step 2 → "bereits gelaufen, übersprungen." |
| `obsidian-vault` ran <10 min ago, nothing changed | Step 3 → "bereits gelaufen, übersprungen." |
| Step 3 wrote no vault files | Step 3b → "Cloud-Brain: nichts zu syncen." |
| Kein `roadmap/`-Ordner vorhanden oder nichts Roadmap-Relevantes passiert | Step 3c → "Keine Roadmap-Änderung." |
| `node generate.mjs` nicht vorhanden oder schlägt fehl | Step 3c → `data.json` speichern, HTML-Generierung melden und weiter. |
| `push-to-brain.py` fails / Proxy down | Step 3b → "Cloud-Brain-Sync übersprungen — Vault bleibt Backup." (kein Abbruch) |
| No Brain-Wiki-tracked artifact beyond Step 3b touched | Step 4 → "Kein Brain-Wiki-Update nötig — via Step 3b abgedeckt." |
| Git working tree clean | Step 6 → "Repo ist sauber." (Build-Check entfällt) |
| Branch trackt keinen Remote | Step 6c → Kein Push, Hinweis ausgeben |
| Build-Command in CLAUDE.md nicht auffindbar und kein Node-Stack | Step 6a → "Kein Build-Command bekannt — Build-Check übersprungen." |
| Session was < 5 turns and trivial | Steps 2-4 collapse into a single one-liner |

## Hand-offs

- **`rem-sleep`** — dedicated memory defrag. This skill calls its logic inline; use the standalone skill for explicit cleanup runs.
- **`obsidian-vault`** — dedicated vault sync. Same relationship.
- **`norbert-notion-keeper`** — agent invoked in Step 4 for Brain-Wiki status writes (now the Brain-Wiki keeper).

## Deprecation Note

This skill replaces the older `new-context` skill and the `/gute-nacht` slash command. The old skill remains in `~/.claude/skills/new-context/` as legacy until the next cleanup pass.
