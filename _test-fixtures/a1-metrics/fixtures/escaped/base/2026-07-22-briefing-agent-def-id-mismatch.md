---
type: postmortem
project: a1-office
bug_slug: briefing-agent-def-id-mismatch
bug_report: projects/n3ural-platform/fixes/2026-07-22-briefing-agent-def-id-mismatch.md
severity: blocker
fix_commit: d81c1e9
pr: 100
merged_at: 2026-07-22 21:32:16+00:00
permalink: vault/project/a1-office/postmortems/2026-07-22-briefing-agent-def-id-mismatch
---

# Postmortem: agent_run-Workflows scheiterten 5 Tage silent (agentId UUID statt Slug)

## Was passiert ist

Robert meldete: das Briefing-Banner zeigt "wird erstellt…" und verschwindet
dann ohne Ergebnis; beim allerersten App-Öffnen erscheint gar kein Banner.
Die anfängliche UI-Diagnose (Poll-Timeout nach 60s + Auto-Dismiss nach 10s)
war real, aber nicht die vollständige Ursache. Erst eine direkte Abfrage
gegen die Production-DB (`api.workflow_runs`) deckte auf: **alle 7**
`agent_run`-Workflow-Runs seit 2026-07-17 (5 Tage, jeder Tag ein Fehlschlag)
steckten auf `status='pending'` fest — komplett unsichtbar in Logs, Tests
oder Monitoring.

Root Cause: `startAgentRunWorkflow` schrieb die `api.agents.id`-UUID statt
`api.agents.agent_def_id` (String-Slug) in `workflow_runs.input.agentId`.
`getAgentDef()` ist auf String-Slugs gekeyed — die UUID matchte nie, jeder
Run warf einen Fehler, der die komplette `withTenantContext`-Transaktion
zurückrollte (inkl. des `workflow_steps`-Inserts) und dabei ungeloggt blieb.
Der Run blieb `pending`, wurde jede Minute erneut vom Cron-Tick geclaimt und
scheiterte identisch — ein unsichtbarer Endlos-Loop.

## Zeitleiste (grob)

1. Robert meldet UI-Symptom ("Punkt Punkt Punkt, dann verschwindet")
2. Falk diagnostiziert den UI-Poll-Timeout (`BriefingStatusBanner.tsx`,
   still-working-Auto-Dismiss) — korrekt, aber unvollständig
2. Vor Fix-Dispatch: DB-Check zeigt kein Schedule/keine Mail-Connection bei
   DTG-Tenant — Symptom A dort spec-konform, kein Bug
3. Robert korrigiert: bei N3URAL (sein echter Account) ist beides aktiv
4. DB-Check bei N3URAL: Schedule aktiv, Google-Connection verbunden, ABER
   alle 7 `workflow_runs` seit 5 Tagen `pending`
5. `vercel crons ls` + `vercel crons run` + `vercel logs` bestätigen: Cron
   feuert korrekt minütlich, claimt Runs (`tick.claim`-Log), aber danach nie
   `tick.completed`/`tick.release` — Fehler bleibt unsichtbar
6. Code-Lesen (`workflow-tick.ts` → `activity-io.ts` → `schedules-tick.ts`)
   findet die UUID-vs-Slug-Verwechslung; DB-Query bestätigt
   `api.agents.agent_def_id='claudia'` vs. `input.agentId`=UUID
7. Walter fixt beide Call-Sites zentral über `start-agent-run.ts`, härtet
   das Logging, fixt den UI-Poll-Bug, räumt die 7 Runs auf
8. PR #100, 10/10 CI-Checks grün, gemergt

## Root Cause

`lib/workflow/tick/start-agent-run.ts` (vor dem Fix): `StartAgentRunParams`
hatte nur ein `agentId`-Feld, das für zwei unterschiedliche Zwecke
missbraucht wurde — als FK-Wert für `agent_conversations.agent_id`/
`workflow_runs.agent_id` (dort korrekt: UUID) UND als Wert für
`workflow_runs.input.agentId` (dort falsch: sollte der String-Slug sein,
den `getAgentDef()` in `activity-io.ts` erwartet). Kein Typsystem-Fehler
(beide sind `string`), keine Laufzeit-Exception an der Schreibstelle — der
Fehler manifestierte sich erst zwei Komponenten weiter entfernt, in einer
anderen Datei, beim Lesen des Werts.

## Warum es 5 Tage unsichtbar blieb

Drei unabhängige Verstärker:

1. **Fehler ungeloggt:** der `catch`-Block in `workflow-tick.ts` (Pro-Run-
   Ausführung) pushte den Fehler nur in ein lokales Array, ohne
   `console.error` — nichts landete in Vercel-Logs.
2. **Transaktions-Rollback verschluckte alle Spuren:** `withTenantContext`
   rollt bei jedem Fehler die komplette Transaktion zurück — auch den
   `workflow_steps`-Insert, der sonst als Beweis für "Run wurde mindestens
   angefasst" gedient hätte.
3. **Der Schedule selbst meldete Erfolg:** `agent_schedules.last_run_at`
   wird beim Erstellen des Workflow-Runs fortgeschrieben, nicht bei dessen
   erfolgreichem Abschluss — `consecutive_failures` blieb bei 0.
4. **Kein Monitoring darüber:** der einzige Health-Check prüft nur
   DB-Liveness, nicht ob Workflow-Runs innerhalb einer erwarteten Zeit
   terminieren.

## Was gut lief

- Live-DB-Query (statt nur Code/UI zu lesen) war der entscheidende Schritt,
  der die tiefere Root Cause freilegte — die ursprüngliche UI-Diagnose wäre
  ein Teilfix gewesen, der das Kernproblem nicht behoben hätte.
- `vercel crons run` + `vercel logs --json` erlaubten vollständige
  Live-Verifikation der Infra-Schicht (Cron feuert, Auth funktioniert) ohne
  Vercel-Dashboard-Zugriff — Falks anfängliche "kann ich nicht prüfen"-Grenze
  wurde durch CLI-Tools überwunden.
- Robert korrigierte eine falsche Tenant-Annahme (DTG statt N3URAL) sofort
  und präzise — verhinderte, dass Zeit auf die falsche Spur verwendet wurde.
- Walter fasste den Fix zentral in `start-agent-run.ts` statt an beiden
  Call-Sites separat zu patchen — eine strukturelle Verbesserung gegenüber
  dem ursprünglichen Diagnose-Vorschlag (zwei separate Stellen).
- Vor dem Merge wurde jede Behauptung des Implementierers (Testzahlen,
  DB-Cleanup, CI-Status) unabhängig nachverifiziert statt übernommen —
  deckte keine Abweichung auf, bestätigte aber, dass diese Verifikation
  den Prozess nicht verlangsamt hat.

## Was schlecht lief / Lektionen

1. **DB-Zustand vor UI-Verhalten prüfen, wenn "Feature hat nie funktioniert
   seit X"-Meldungen kommen.** Die erste Diagnose (nur UI-Code lesen) fand
   einen echten, aber nicht den Haupt-Bug. Bei "seit Tagen kaputt"-Meldungen
   sollte die Workflow-/Job-Tabelle (hier `workflow_runs`) von Anfang an Teil
   der Standard-Triage sein, nicht erst nach einer Nutzer-Korrektur.
2. **Silent-Failure-Klasse:** ein `catch`-Block ohne Logging plus
   Transaktions-Rollback ist eine gefährliche Kombination — sie kann einen
   Fehler vollständig unsichtbar machen, selbst bei aktivem, korrekt
   konfiguriertem Cron. Für neue Tick-/Worker-artige Loops: IMMER im
   catch-Pfad loggen, bevor man sich auf Nutzer-Reports als Fehlerkanal
   verlässt.
3. **Zwei Bedeutungen in einem Feldnamen (`agentId` = mal UUID, mal Slug)**
   ist ein struktureller Risikofaktor — der Fix hat das explizit in zwei
   benannte Felder (`agentId`/`agentDefId`) mit Dokumentationskommentaren
   aufgelöst. Bei künftigen ähnlichen Workflow-Input-Feldern: expliziten,
   selbsterklärenden Feldnamen statt überladenem generischen Namen wählen.
4. **CI-Wartezeit-Wahrnehmung während des Merge-Vorgangs war mehrfach
   falsch eingeschätzt** (gefühlt "14 Minuten", tatsächlich unter 2) — beim
   Prüfen von Job-Laufzeiten immer die exakten `started_at`-Timestamps via
   `gh api .../jobs/<id>` gegen die aktuelle UTC-Zeit rechnen, nicht auf
   subjektives Zeitgefühl zwischen Tool-Calls verlassen.

## Präventionsmaßnahme umgesetzt

`workflow-tick.ts`: catch-Block loggt jetzt `tick.run_error` mit `runId` +
Fehlermeldung — jeder künftige Fehler dieser Klasse erscheint sofort in
Vercel-Logs statt erst nach manueller DB-Forensik sichtbar zu werden.

## Präventionsmaßnahme NICHT umgesetzt (Folge-Idee, außerhalb Scope)

Kein aktiver Alarm/Health-Check für "Workflow-Run seit > N Minuten pending
ohne Fortschritt" — würde diese Bug-Klasse in Zukunft proaktiv statt erst
bei Nutzer-Report sichtbar machen. Nicht Teil dieses Fixes (Scope-Disziplin),
aber als Verbesserungsidee festgehalten.