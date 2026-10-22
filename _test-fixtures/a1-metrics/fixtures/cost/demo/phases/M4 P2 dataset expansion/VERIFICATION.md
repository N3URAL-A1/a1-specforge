---
plan: .a1/phases/M4-P2-dataset-expansion/PLAN.md
goal: captrader-gemma4:v2 ist mit train-v2.jsonl (1.159 Dialoge) per QLoRA trainiert, als GGUF in Ollama eingelegt, gegen 19 Validierungs- plus 5 Policy-Fragen mit v1 verglichen und der Vergleich ist dokumentiert, ohne dass v1 oder der Produktivdienst ollama@gemma Schaden nimmt.
verdict: PASS
passed: 12
gaps: 0
verified: 2026-10-13
---

# Verification: M4-P2-dataset-expansion

## Verdict: PASS
**Cost:** Cost: 21475310 tokens (in 570, out 72935, cache 21401805)

Spec-AC 5 ist im Code, in den Ergebnisdateien und auf dem Server belegt. Alle SC-1 bis SC-11 erfüllt.
Keine Phantom-BLOCKER. Vier kleinere Befunde (Doku-Einheiten, AC-2-Datum, leerer Phantom-Lauf,
Template-Rest in 2 v1-Antworten) blockieren nicht.

## Acceptance Criteria Results

Spec 008, Ziel dieser Phase ist nur AC 5 (AC 1, 3, 4 erledigt, AC 2 extern offen, siehe GOAL.md).

| Criterion (quoted verbatim) | Status | Evidence |
|---|---|---|
| "Ein Trainingslauf v2 mit dem erweiterten Datensatz ist erfolgreich durchgelaufen." (AC 5) | PASS | `evidence/train-v2.log` Z. 22 `Datensatz: 1159 Beispiele`, Schluss `Fertig. Ergebnisse unter output/captrader-gemma4-12b-v2/`; Server live: `lora/`, `merged/`, 1x `*q4_k_m*.gguf` (7.381.383.040 B, sha256 560d949a…, = Ollama-Blob von `captrader-gemma4:v2`) |
| "Jedes Frage-Antwort-Paar hat eine Quellenangabe; fachliche Freigabe durch CapTrader ist dokumentiert." (AC 2, nicht Ziel der Phase) | offen (extern, wie spezifiziert) | Spec Z. 29 und Vergleichsdoku Abschnitt 6 Punkt 4 nennen AC 2 als offen |

### Plan-SC (Weg zur Spec)

| SC | Status | Evidence (selbst gemessen) |
|---|---|---|
| SC-1 | PASS | `validation-set.json` 19 Einträge; `core_override` an #2, #7, #8, #10, #11; 14 Einträge identisch zu `d7225c2`; jeder ersetzte Kern whitespace-normalisiert wörtlich in `clean/glossar-basispreis.md`, `handelbare-produkte-{zertifikate,optionen,anleihen}.md`, `plattformen-trading-tools-probabilitylab.md` (clean/ liegt gitignored im Haupt-Checkout) |
| SC-2 | PASS | `training/eval/policy-questions.json` 7 Fragen; 5 Policy-Fragen wortgleich in `docs/CapTrader-Dokumentation-Gemma-Post-Training.md`; alle mit `expected_core`, `core_source`, `in_training` (pol-4 = true) |
| SC-3 | PASS | `rows.py`, `run_eval.py`, `check_verbatim.py`, `summarize.py --self-test` je Exit 0; `run_eval.py --dry-run` = 26 Zeilen |
| SC-4 | PASS | Server: `sha256sum -c backup/v1-sha256-before.txt` (61 Dateien) gegen Original und Backup, Original Exit 0, Backup Exit 0 (61/61); Hash der Hashliste b3680ace… = Evidence 03 |
| SC-5 | PASS | Log-Marker wie oben; `find -iname '*q4_k_m*.gguf' \| wc -l` = 1; weitere GGUF `BF16-mmproj` benannt |
| SC-6 | PASS | Live: `ollama list` enthält `captrader-gemma4:v2` (27ffa65419f2); `diff` der Modelfiles (ohne `^#`) zeigt nur Zeile 2 `FROM` |
| SC-7 | PASS | `answers.jsonl` 52 Zeilen, 26 je Modell, 52 eindeutige (model, qid), 0 `error`, 0 `done_reason=length`; `missing.json` = `[]` |
| SC-8 | PASS | Evidence 04 (Gegentest: curl exit 7 lokal und vom Mac, keine Compute-Apps) und 07 (Vorher/Nachher-Tabelle). Live nachgemessen: `ollama@gemma` active/enabled, `gemma4:31b-it-qat` 100 % GPU, UNTIL Forever, Mac → `/api/tags` HTTP 200 |
| SC-9 | PASS | `judgments.jsonl` 52 Zeilen, Labels A/B; `judge-input.jsonl` 0x `captrader-gemma4`; `verbatim.json`, `report.md` mit Gruppen a–e; (b)+(c) = 5+0 = 5. Summen nachgerechnet: v2 7 korrekt / 6 halluziniert, v1 2 / 19 |
| SC-10 | PASS | `docs/CapTrader-Vergleich-Gemma-v1-v2.md` und `.pdf`; Loss, Laufzeit, Tabellen, Wortlaut, alle 4 Einschränkungen (Abschnitt 6). Pro-Gebiet-Zahlen aus `judgments.jsonl` + `anon-map.json` nachgerechnet: stimmen |
| SC-11 | PASS | Spec 008: Zahlen 1.159/1.045/1.194, Verteilung, 19 Fragen in 4 Gebieten, Abschnitt "Trainingslauf v2 (AC 5)" mit Verweisen; AC 2 als offen (Z. 29) |

### Phantom BLOCKERs
none. `phantom check` meldet `status: clean`, aber `total_completed: 0` — die Task-Checkboxen in PLAN.md sind nicht abgehakt, der Lauf prüfte also nichts. Ersatz: jede SC oben direkt am Artefakt belegt.

### Verify manually (weak phantom matches)
none

## Server-Messung (read-only, 2026-10-13 ca. 19:55–20:05 CEST)

- `systemctl is-active/is-enabled ollama@gemma`: active / enabled. Kein Stop, Restart, Load oder Unload.
- `ollama list`: captrader-gemma4:v2 27ffa65419f2 7.4 GB, captrader-gemma4:v1 df21248c18a0 7.4 GB.
- `ollama ps`: gemma4:31b-it-qat 19 GB, 100 % GPU, 32768, Forever.
- v1-GGUF und v2-GGUF: beide 7.381.383.040 B, unterschiedliche Hashes (5d2d8242… vs 560d949a…).
- `backup/v1.Modelfile`: `sha256sum -c` OK.
- v1-Hashes: `sha256sum -c --quiet backup/v1-sha256-before.txt` gegen Original: Exit 0 (61/61 OK); dieselbe Liste gegen `backup/captrader-gemma4-12b-v1-20261013`: Exit 0 (61/61 OK). Unabhängig nachgerechnet, nicht aus Evidence übernommen.

## Gaps
Keine blockierenden Lücken. Kleinere Befunde:

### Befund 1: Einheiten der GGUF-Größe in der älteren Doku uneinheitlich (minor, vorbestehend)
- **Wo:** `docs/CapTrader-Dokumentation-Gemma-Post-Training.md` Z. 83 „7,4 GB" (SI, wie `ollama list`), Z. 179 und Z. 314 „6,9 GB".
- **Fakt:** 7.381.383.040 B = 7,38 GB (SI) = 6,87 GiB. „6,9 GB" ist ein GiB-Wert mit GB-Etikett.
- **Neue Doku:** `CapTrader-Vergleich-Gemma-v1-v2.md` Z. 81 „ca. 7,4 GB | 7,38 GB" ist einheitlich SI und korrekt (v1 und v2 sind byte-gleich groß).
- **Fix:** Z. 179 und 314 auf „7,4 GB" ändern, PDF neu bauen. Nicht von Task 12.2 erfasst (betraf nur 7.2/7.3).

### Befund 2: AC-2-Stand-Datum (minor)
- Spec 008 Z. 29: „Stand 09.10.2026"; Vergleichsdoku Abschnitt 6 Punkt 4: „Stand 13.10.2026".
- Kein inhaltlicher Widerspruch (beide: offen). Task 12.3 hat die AC-2-Zeile nicht aktualisiert.
- **Fix:** Spec Z. 29 auf „Stand 13.10.2026" setzen.

### Befund 3: Template-Rest in 2 v1-Antworten (info)
- 2 von 26 v1-Antworten beginnen mit `model\n` (Chat-Template-Rest), v2: 0. Betrifft nur v1-Antworten und ändert die Gesamtaussage nicht. In der Doku nicht erwähnt.

### Befund 4: Leerer Phantom-Lauf (plan_quality)
- PLAN.md-Checkboxen bleiben offen, dadurch ist `phantom check` wirkungslos.

## Build / Test Status
- TypeScript / Build: nicht anwendbar (Python, Terraform).
- Self-Tests: 4/4 Exit 0.
- Infrastruktur-Abnahme (infra-verification.md): Wirkung von außen gemessen (HTTP 200 vom Mac), Gegentest im Fenster (curl exit 7, keine GPU-Prozesse), Rückweg (v1-Backup) besteht weiter. Reboot-Test nicht nötig (keine Unit-/Autostart-Änderung; `NeedDaemonReload` war vorher schon offen und blieb unberührt).

## Deviations from Plan
1. v2-Modelfile aus live `backup/v1.Modelfile` statt `training/Modelfile.template` (Orchestrator). Akzeptabel: SC-6 verlangt Gleichheit mit v1 bis auf FROM; das erfüllt nur diese Ableitung.
2. Basismodell `gemma4:12b` nicht verglichen (Robert: „Nein, nur v1 und v2"). SC-7 verlangt mind. v1 und v2: erfüllt. In Doku Abschnitt 4.1 und 6 offen genannt.
3. Codex-Review (xprov) abgelehnt (`d7225c2`), nicht anwendbar.
4. `transformers` 5.14.1 statt im Plan genannter 5.5: Planfakt war falsch, venv wurde nicht verändert (harte Regel 6 eingehalten).
5. Server-`train_qlora.py` war veraltet, ersetzt, Original als `.bak-20261013` gesichert.
6. Spec-vs-Plan: Plan-Goal nennt „19 Validierungs- plus 5 Policy-Fragen"; ausgewertet wurden 26 (zusätzlich 2 Probes). Erweiterung, keine Verwässerung. Spec-AC 5 ist schwächer formuliert („erfolgreich durchgelaufen") als die SC — die SC gehen darüber hinaus, kein Konflikt.
