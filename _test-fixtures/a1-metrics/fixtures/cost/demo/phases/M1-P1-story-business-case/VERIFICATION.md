---
plan: .a1/phases/M1-P1-story-business-case/PLAN.md
goal: Eine einseitige SCQA-Story und ein belegter Business Case liegen als Markdown unter docs/pitch/ vor, jede Zahl darin steht mit Quelle, Status und Konfidenz im Zahlen-Register, und die Folientabelle ist direkt von M1-P2 (vf-tk-deck) konsumierbar.
verdict: PASS
passed: 11
gaps: 0
findings_minor: 6
not_applicable_by_user_decision: 3
verified: 2026-10-08
scope: reduziert durch Robert 2026-10-08 („wir brauchen nur die story“, ENTSCHEIDUNGEN.md L-2); Waves 3, 5, 6 und Task 2.1 entfallen
work_path: /Users/rob/claude-projects/a1-worktrees/m1-p1-story-business-case
---

# Verification: M1-P1 Story (SCQA) und Business Case

## Verdict: PASS (reduzierter Scope, 6 kleinere Befunde)
**Cost:** 1,23,456 tokens (in 2768, out 179994, cache 37757345) — Projekt `-Users-rob-claude-projects-ai-net`, seit 2026-10-08T00:00Z

Alle Kriterien im reduzierten Scope sind im Dateiinhalt belegt. V1–V14 wurden im Worktree neu ausgeführt. Einzige Meldung: V11 „kein Versanddatum“ für A–D. Das ist der Teil von SC-5, der nur durch die gestrichenen Waves erfüllbar war (nicht anwendbar durch Nutzerentscheidung). Keine Phantom-BLOCKER. Die Befunde unten blockieren nicht. Sie sollten vor M1-P2 behoben werden, weil M1-P2 die Deck-Strings unverändert übernimmt.

## Acceptance Criteria Results

Spec = GOAL.md (Scope-Punkte wörtlich). Danach die SC-* aus PLAN.md.

### Spec (GOAL.md)

| Kriterium (wörtlich) | Status | Evidence |
|---|---|---|
| „Story nach SCQA festlegen und den Business Case belastbar machen.“ | ✓ PASS (Story) / N/A (Belastbarkeit BC) | STORY.md `status: final`, SCQA 177 Wörter. BUSINESS-CASE.md `status: entwurf`, alle €-Werte Schätzung/L. Absicherung durch Antworten entfiel mit L-2. |
| „Antwort-zuerst-Narrativ: Problem, Beleg (KrewerIT-Automatisierung läuft seit Juli), Ask“ | ✓ PASS | Folie 1 = Answer (Variante D), Folie 3 Problem [Z-I13], Folie 4 Proof KrewerIT [Z-I02, Z-I04], Folie 7 Ask [Z-A01]. „seit Juli“ = Z-I01, nur Backup. |
| „KrewerIT-Savings-Zahl (1–1,5 Mio. €) mit Controlling oder Einkauf absichern“ | N/A durch Nutzerentscheidung | Datenanfragen nicht versandt (L-2). Z-K00 korrekt `ungeklärt`/`offen`/`intern`, nicht auf Folien. |
| „Benchmarks auswählen und belegen (DT, Telefónica, VF-Glasfaser 2023, McKinsey)“ | ✓ PASS | BENCHMARKS.md: DT (Z-B01, Z-B03) und VF 5x (Z-B04) mit Wortzitat und Abrufdatum. Telefónica (Z-B06) und McKinsey (Z-B05) nicht belegbar, daher `offen`/Backup. |

### PLAN.md Success Criteria

| Kriterium (wörtlich gekürzt auf Kern) | Status | Evidence (eigener Lauf) |
|---|---|---|
| SC-1 „S, C, A haben je 2–3 Sätze, Q genau 1; der SCQA-Teil hat höchstens 450 Wörter.“ | ✓ PASS | V10: `177`, `S — 3`, `C — 2`, `Q — 1`, `A — 3` |
| SC-2 „Jede Zeile mit Zahl in STORY.md trägt eine [Z-xxx]-Markierung; jede verwendete ID existiert im Register; kein Z-NEU bleibt übrig.“ | ✓ PASS | V1 und V2: keine Ausgabe |
| SC-3 „Jede Registerzeile hat die Spalten 1–9 gefüllt, Status ∈ {…}, Konfidenz ∈ {H, M, L}.“ | ✓ PASS | V3: keine Ausgabe |
| SC-4 „Keine Folie 1–8 … offen/verworfen …; keine Registerzeile mit Verwendung Hauptteil ist offen/verworfen.“ | ✓ PASS | V4 und V9: keine Ausgabe |
| SC-5 „Tracker hat 4 Versanddaten; Z-K00 … gekennzeichnet; G2 … mit Stufe, Entscheider, Datum; Folie 1 entspricht der eingesetzten Stufe (D: kein € in Zeile Folie 1).“ | ✓ PASS (Teile 2–4) / N/A (Teil 1) | V11: `kein Versanddatum: A/B/C/D` (Teil „Tracker hat 4 Versanddaten“ = N/A, Task 2.1 durch L-2 entfallen, Tracker leer, keine Daten erfunden). Z-K00 ohne Meldung. `G2-Stufe: D`, keine €-Meldung. |
| SC-6 Benchmark-Hygiene (≤ 4 Hauptteil, „2,5 Mrd.“, „5x“, McKinsey/Telefónica) | ✓ PASS | V5: `3`, leer, leer, `0` |
| SC-7 „BUSINESS-CASE.md hat die neun Pflichtabschnitte, die Nutzentabelle …, zwei Szenarien, Sensitivität −50 % …“ | ✓ PASS | V12: keine Ausgabe |
| SC-8 „Hardware nur ~6.400 € / ~15.000 €; die Faktor-Zeile Z-I11 ist entschieden …“ | ✓ PASS | V6 und V13: keine Ausgabe. Z-I11 = `verworfen`/`nicht verwenden`, Bemerkung nennt Herleitung Z. 83 |
| SC-9 Folientabelle (Kopfzeile, 8 Zeilen in Reihenfolge, Titel ≥ 6 Wörter mit Punkt, keine Technik auf Folie 1) | ✓ PASS | V7: keine Ausgabe |
| SC-10 „ENTSCHEIDUNGEN.md enthält G1-1 bis G1-7 und G2, jeweils mit wörtlicher Antwort oder Rückfallvermerk, Entscheider und Datum.“ | ✓ PASS | V8: keine Ausgabe (8 Gate-Zeilen). G1-1 = „KrewerIT darf verwendet werden, es ist eine Vodafone präsi“ → Hauptteil, V14 ohne Prüfung |
| SC-11 „Unter docs/product/ gibt es weder geänderte noch neue Dateien.“ | ✓ PASS | V8: `git diff a77d245 -- docs/product/` leer, `git status --porcelain docs/product/` leer, `git remote -v` leer |

### Task 7.1 (Brief: Vault-Hub und Template-Folgearbeit)

| Prüfpunkt | Status | Evidence |
|---|---|---|
| Vault-Hub `## Entscheidungen` vor `## Relations`, je eine Zeile G1-1…G1-7, G2 | ✓ PASS | `~/N3URAL-Vault/project/ai-net.md` Z. 47–58: 8 G-Zeilen plus L-1, L-2, je mit Beleg-Pfad |
| 6a: `grep -c 'VF_template' CLAUDE.md .a1/phases/M1-P2-pitch-deck/GOAL.md` = 0 | ✓ PASS | `CLAUDE.md:0`, `GOAL.md:0`. CLAUDE.md Z. 44 nennt Pfad `/Users/rob/claude-projects/netzdigitalisierung-vf/Master_Neuro_VF.pptx` = SKILL.md „Template Location“ Z. 52; Datei existiert. Diff gegen a77d245: CLAUDE.md 2 Zeilen, GOAL.md 1 Zeile |

### Phantom BLOCKERs
none. `phantom check` → `"status": "clean"`, aber `"total_completed": 0` (PLAN.md hat keine abgehakten Tasks). Die Prüfung ist daher leer; die Artefakte wurden oben direkt geprüft.

### Verify manually (weak phantom matches)
none

## Nicht anwendbar durch Nutzerentscheidung (L-2, Robert 2026-10-08)

| Kriterium | Teil | Grund |
|---|---|---|
| SC-5 | „Tracker hat 4 Versanddaten“ | Task 2.1 nicht ausgeführt; Tracker leer by design |
| GOAL Scope 2 | „KrewerIT-Savings-Zahl … mit Controlling oder Einkauf absichern“ | Datenanfragen entfallen; Z-K00–Z-K02 bleiben `offen` |
| GOAL Goal | „Business Case belastbar machen“ (Absicherung durch Antworten) | BC bleibt Entwurf mit L-Konfidenz; Folie 6 zeigt nur Schätzungen mit Kennzeichnung |

## Gaps
Keine blockierenden Lücken. Kleinere Befunde (vor M1-P2 beheben empfohlen):

### Befund 1: Z-I15 lässt „bis zu“ weg (Faktentreue)
- **Betrifft:** Folie 2 (Status `bestätigt`), SCQA-S
- **Erwartet:** Quelle `.a1/RESEARCH.md` Z. 29: „für **bis zu** 68.000 Mitarbeitende“
- **Vorhanden:** Deck-String „68.000 Mitarbeitende mit Microsoft 365 Copilot“, Status `bestätigt`, Live-Abruf scheiterte (403)
- **Fix:** Deck-String auf „bis zu 68.000 Mitarbeitende mit Microsoft 365 Copilot“ setzen, in STORY.md (S, Folie 2) nachziehen

### Befund 2: Veraltete Gate-Hinweise in Register und Business Case
- **Vorhanden:** BUSINESS-CASE.md „Der Vergleichswert des Vendors ist offen (Gate G1-4, Z-I10)“, obwohl G1-4 = (a); Z-BC01/Z-BC02 Bemerkung „G1-5 offen“, obwohl G1-5 entschieden; Register-Kopf „Stand: … Wave 2“; Z-K00-Bemerkung trägt einen fremden G1-1/V14-Hinweis
- **Fix:** Texte an G1-4 (a) und G1-5 angleichen, Register-Stand aktualisieren, G1-1-Satz aus Z-K00 entfernen

### Befund 3: Doppelungen im SCQA-Text
- **Vorhanden:** S „rollt Copilot für 68.000 Mitarbeitende mit Microsoft 365 Copilot aus“; A „Das Mandat läuft über 90 Tage [Z-A02] und endet in einer Go/No-Go-Entscheidung, Go/No-Go nach 90 Tagen [Z-A04], auf Messwerten.“
- **Fix:** Sätze glätten (ein Deck-String je Aussage), danach V2 und V10 erneut laufen lassen

### Befund 4: KrewerIT-Einsparbehauptung in CLAUDE.md und Vault-Hub widerspricht dem Register
- **Vorhanden:** CLAUDE.md Z. 28–29 „KrewerIT (ca. 1–1,5 Mio.) ist kurzfristig durch Digitalisierung einsparbar — das ist das Business-Case-Argument“; Hub `## Story / Narrativ` gleichlautend. Register: Z-K00 `offen`, Brutto ≠ Einsparung, G2 = D ohne Euro-Anker
- **Fix:** Nicht Teil von 7.1 (bestehende Abschnitte unverändert lassen). Robert entscheidet, ob WHY und Hub-Narrativ auf L-1/G2 = D angepasst werden; sonst übernimmt M1-P2/P3 die alte Aussage

### Befund 5: STATUS-Aussage zu uncommitteten Dateien stimmt nicht
- **Vorhanden:** STATUS Wave 7: „gehen in den Abschluss-Commit“. `git diff --stat`: PLAN-REVIEW-LOG.md, observations.jsonl, xreview/wave-status.last-run.json weiter uncommittet
- **Fix:** beim Merge-Vorbereiten committen

### Befund 6: Vault-Hub nicht versioniert
- **Vorhanden:** `project/ai-net.md` ist im Vault-Git untracked (`??`). Ob 7.1 „bestehende Abschnitte nicht ändern“ eingehalten hat, ist nicht prüfbar (Key Decisions und Nächste Schritte enthalten G1-Inhalte)
- **Fix:** keiner nötig für M1-P1; Hinweis

## Build / Test Status
- TypeScript: n/a (kein Code)
- Tests: n/a; Gate-Kriterium V1–V14 laut Plan: alle ohne Meldung außer V11-Tracker (N/A)
- Build: n/a

## Deviations from Plan
- Waves 3, 5, 6 und Task 2.1 entfallen (L-2). Wave 4 und 7 liefen am 2026-10-08. G2 = D durch Robert, nicht per Rückfall. Akzeptabel, durch Nutzerentscheidung gedeckt.
- Task 1.4: keine Kalendertermine (Robert). Akzeptabel.
- Task 3.1 nur als E4/E8-Teilmenge: Z-I10 Schätzung/Backup, Z-I11 und Z-I12 `verworfen`. Akzeptabel.
- Z-BC02/Z-BC06 von Backup auf Hauptteil, weil Folie 6 sie zitiert. Konsistent (V4/V9 leer).
- Vault-Hub hat 10 statt 8 Zeilen (L-1, L-2 zusätzlich). Akzeptabel.
- `updated: 2026-10-08` statt 2026-10-22 in STORY.md. Folge der Scope-Kürzung.
- Spec-vs-Plan: GOAL.md verlangt „belastbaren“ Business Case; die SC prüfen nur Struktur (V12), nicht Belastbarkeit. Mit L-2 ist das gegenstandslos, bleibt aber eine Planlücke.
- observations.jsonl nicht ergänzt: Der Auftrag erlaubte nur VERIFICATION.md.
