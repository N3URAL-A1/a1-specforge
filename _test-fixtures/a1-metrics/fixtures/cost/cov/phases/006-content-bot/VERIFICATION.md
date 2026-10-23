---
plan: .a1/learnings/projects/maison-muelhens/plans/006-content-bot-wave-plan.md
goal: "Wave 6 (Bildpipeline P2, FR-020/FR-021/FR-022, US-006-5/US-006-6): Ein Foto in der Telegram-Gruppe wird zu einem optimierten Bild im Repo — über exakt dieselbe Freigabestrecke wie eine Textänderung, ohne zweiten Review-Prozess. Wave 6b ergänzt die zuvor offene Download-/Magic-Bytes-/Cleanup-Strecke."
verdict: PASS
passed: 8
gaps: 0
verified: 2026-08-01
---

# Verification: Feature 006-content-bot — Wave 6 + Wave 6b (Bildpipeline)

## Verdict: PASS
**Cost:** unavailable (a1-tools.cjs nicht im Projekt/PATH auffindbar — weder unter `${CLAUDE_PROJECT_DIR}/_shared/`, noch über Verzeichnis-Aufwärtssuche vom Repo-Root, noch unter `~/code/a1-skills/_shared/`)

Alle drei Bildpipeline-FRs (FR-020, FR-021, FR-022) sind im Code substantiell implementiert, durch 66 Vitest-Fälle (Wave 6 + 6b, davon 23 + 33 neu) mit echter Grenzfall-Abdeckung belegt, und im tatsächlich live importierten n8n-Workflow (`03-queue-orchestration.workflow.json`, nicht nur im historischen `01-intake-triage.workflow.json`) vollständig und ohne dangling connections verdrahtet. Die einzige akzeptierte Einschränkung — kein Test gegen echtes Telegram/n8n/sharp — ist explizit vom Auftrag als bekannt und nicht blockierend eingestuft.

## Acceptance Criteria Results (Spec-ACs verbatim)

| Criterion (verbatim aus Spec) | Status | Evidence |
|---|---|---|
| FR-020: "For a message classified as content-change (image), the system MUST accept an attached image sent either as a Telegram 'photo' or as a 'document'/file attachment, in JPEG, PNG, or WebP format, up to 10 MB. Images in unsupported formats (e.g. HEIC) or exceeding 10 MB MUST be rejected with a German hint explaining the accepted formats/size." | ✓ PASS | `automation/bot/scripts/handle-image-request.core.mjs:49-125` (extractImagePayload normalisiert photo+document auf identische Form, validateImagePayload prüft Format vor Größe); Grenzfall-Tests exakt an der Grenze: `handle-image-request.test.ts:111-137` ("akzeptiert eine Datei exakt an der 10-MB-Grenze" / "lehnt eine Datei bei 10 MB + 1 Byte ab"); deutsche Texte `imageFormatRejected`/`imageSizeRejected` in `messages.de.json:30-32`; im Live-n8n-Workflow dupliziert als `Code — Bild-Validierung`-Node vor jedem Download (Metadaten-Prüfung, kein Download bei Ablehnung) |
| FR-020 (Magic-Bytes-Härtung, Wave 6b-Ergänzung): eine als `.jpg` getarnte HEIC-Datei darf nicht durchrutschen | ✓ PASS | `automation/bot/scripts/download-telegram-file.core.mjs:75-160` — `detectImageFormatFromBytes` prüft echte Bytes nach Download gegen `expectedMimeType`; bei Mismatch **kein** `fs.writeFile` (Kommentar Zeile 153-155); Test `download-telegram-file.test.ts:194-207` deckt genau das Szenario "getarnte HEIC" ab und bestätigt `fs.writtenFiles.size === 0` |
| FR-021: "The system MUST place accepted images under `public/assets/` following existing project conventions, and MUST optimize them server-side before commit: quality ~75, max width 2560px, WebP preferred" | ✓ PASS | `automation/bot/scripts/optimize-image.core.mjs:22-94` — `MAX_OPTIMIZED_WIDTH=2560`, `OPTIMIZED_QUALITY=75`, `withoutEnlargement: true` (kein Hochskalieren), WebP als Default-Zielformat (`resolveTargetFormat`); Ablage unter `public/assets/` erfolgt im Claude-Code-Prompt (`run-image-change.core.mjs:139-146`, Zielbestimmung über Begleittext + `ASSETS.md`); `sharp` **nicht** in `package.json` (dependencies/devDependencies geprüft — nicht enthalten), stattdessen über `resolveSharpModulePath()` + `IMAGE_TOOLS_PATH` (Default `/home/claude-bot/tools`) aufgelöst — Scope-Contract-konform |
| FR-022: "Image-replacement requests MUST go through the same build-gate → push → preview → Approve/Change/Discard flow defined in FR-005 through FR-016" | ✓ PASS | `run-image-change.core.mjs:196-326` durchläuft git fetch/checkout → Claude Code → `diff --stat` → `npm run build` (Gate, blockiert Push bei Fehler) → Commit im selben Format `content: <...> (tg:<id> von <sender>)` → Push; im n8n-Live-Workflow mündet `Bild-Preview + Buttons posten` in **exakt dieselbe** Callback-Data-Konvention (`a:`/`c:`/`d:`-Präfix + PR-Nummer) wie der Text-Pfad; der Callback-Handler (`Router — Nachricht vs. Callback` → `Callback-Data parsen` → `Switch — Callback-Aktion` → `Approve-Merge aufrufen`/`Discard aufrufen`) ist **ein einziger, kind-agnostischer Zweig** — er unterscheidet nicht zwischen Text- und Bild-PRs, die Whitelist-Prüfung greift damit identisch für beide |
| Foto- UND Dokument-Payload landen im selben Verarbeitungspfad | ✓ PASS | Code: `extractImagePayload` normalisiert beide auf identische `ImagePayload`-Form, Test `handle-image-request.test.ts:40-46` prüft explizit gleiche Schlüsselmenge; n8n: `IF — Bild-Anhang`-Node prüft `$json.message.photo \|\| $json.message.document` als einzige, exklusive Weiche (Notiz bestätigt: "sonst würde eine Bildnachricht mit Caption doppelt beantwortet") |
| Unklares Ziel-Asset → Rückfrage statt Commit | ✓ PASS | `AMBIGUOUS_MARKER = "RUECKFRAGE:"` (`run-content-change.core.mjs:177`, wiederverwendet in `run-image-change.core.mjs:28`); `isAmbiguousResponse()` prüft Marker-Präfix; Test `run-image-change.test.ts:212-224` bestätigt `AMBIGUOUS_ABORT`-Exit-Code UND dass **kein** `git commit`-Aufruf stattfand; `messages.de.json:34` liefert `imageTargetUnclear`-Text; `automation/bot/CLAUDE.md` (Bild-Regeln-Abschnitt) instruiert Claude Code explizit, bei Unklarheit nichts zu ändern und mit dem Marker zu antworten |
| Temp-Cleanup läuft auch im Fehlerfall (try/finally) | ✓ PASS | `run-image-change.core.mjs:217-325` — `try { ... } finally { await adapters.cleanup.run(...) }` umschließt den gesamten Pipeline-Körper; Tests bestätigen Cleanup-Aufruf bei Erfolg (`run-image-change.test.ts:159-171`), Download-Fehler (193-197), Optimierungs-Fehler (200-209), Build-Fehler (240-244) und AMBIGUOUS_ABORT (246-250) — alle fünf Pfade abgedeckt; `cleanupTempFile` selbst wirft nie (`download-telegram-file.core.mjs:171-179`, Test 239-247 bestätigt "wirft nicht, wenn das Löschen fehlschlägt") |
| US-006-5/US-006-6 (Acceptance Scenarios): Bildwunsch startet dieselbe Build-Gate-Pipeline, Robert sieht dieselben drei Buttons ohne separaten Review-Prozess | ✓ PASS | Siehe FR-022-Nachweis oben — ein Bildwunsch produziert strukturell identische Preview-Nachricht und denselben Freigabe-Callback-Zweig wie ein Textwunsch |

### Phantom BLOCKERs
Kein Phantom-Detection-Tool (`a1-tools.cjs`) im Projekt auffindbar (siehe Cost-Zeile) — stattdessen wurde jeder in STATUS.md behauptete Artefakt manuell gegen den Code gegenlesen (Level 1-3: Existenz, Substanz, Verdrahtung). Keine Diskrepanz zwischen STATUS.md-Behauptungen und tatsächlichem Code gefunden. Keine BLOCKER.

### Verify manually (weak phantom matches)
Keine — alle geprüften Artefakte wurden direkt gelesen und funktional nachvollzogen, nicht nur per Namenstreffer bestätigt.

## Gaps
Keine. Verdict PASS ohne Einschränkung bei den Repo-Artefakten.

## Build / Test Status
- TypeScript/Build: nicht erneut ausgeführt (laut Auftrag zweifach bereits verifiziert; STATUS.md dokumentiert `npm run build` grün nach `npm install`-Fix für `@playwright/test`)
- Tests: ✓ Alle bestehen — `npx vitest run automation/bot/tests/` → **17 Testdateien, 226 Tests, alle grün** (0,62s Laufzeit), davon `wave6/` (4 Dateien: optimize-image 9, handle-image-request 14, download-telegram-file 19, run-image-change 17 = 59 Bildpipeline-spezifische Tests) — deckt sich mit den STATUS.md-Zahlen (23 neu in Wave 6, 33 neu in Wave 6b, kumuliert 226)
- n8n-Workflow-JSON: `03-queue-orchestration.workflow.json` strukturell geprüft — 69 Nodes, jeder Bild-bezogene Node hat eine ausgehende Verbindung außer den erwarteten Terminal-Nodes (`Bild abgelehnt → Format-/Größenhinweis`, analog zu bereits bestehenden Terminal-Mustern wie `question → Rückfrage`/`layout_request → Ablehnung`/`other → keine Aktion`) — keine unerwarteten dangling connections

## Deviations from Plan
- Der Wave-Plan benannte für die n8n-Erweiterung nur "automation/bot/n8n/" ohne zwischen dem historischen Wave-1-Entwurf (`01-intake-triage.workflow.json`) und dem tatsächlich live importierten Workflow (`03-queue-orchestration.workflow.json`) zu unterscheiden. Der Bild-Zweig wurde korrekt zusätzlich in `03` nachgezogen (STATUS.md-Deviation, durch eigene Prüfung bestätigt: `IF — Bild-Anhang` und alle Folge-Nodes existieren nachweislich in `03`, nicht nur in `01`). `01` bleibt bewusst auf dem älteren Stand — akzeptabel, da explizit dokumentiert und `03` der maßgebliche Live-Stand ist.
- `run-image-change.core.mjs` wurde als eigenständige Pipeline gebaut statt als Erweiterung von `run-content-change.core.mjs`, mit dupliziertem Endstück (Build-Gate/Commit/Push). Nachvollziehbar begründet (fundamental unterschiedlicher Input-Contract) und funktional gleichwertig getestet — keine Einwände.
- Bekannte, vom Auftrag akzeptierte Einschränkung: kein Live-Test gegen echtes Telegram/n8n/sharp — nur strukturelle Validierung (JSON-Gültigkeit, Vitest gegen Fake-Adapter) plus offene Deploy-Schritte in STATUS.md (sharp-Installation unter `/home/claude-bot/tools/`, Temp-Verzeichnis, `TELEGRAM_BOT_TOKEN`-Env, n8n-Import). Laut Auftrag wird dies durch Roberts vier manuelle Verifikationsszenarien abgedeckt und ist nicht Teil dieses Verdicts. Der Server-Deploy selbst ist laut Auftrag bereits erfolgt.
