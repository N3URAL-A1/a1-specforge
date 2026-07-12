# a1-analyze — Learning Log
Entries appended automatically after every run.
---

---
date: 2026-05-17
task: Quality audit of niimo codebase
project: niimo
result: pass
issues: [missing_coverage, arch_drift_found, quality_finding_actionable]
what_worked: 5-phase analysis pipeline (Scope→Discover→Analyze→Synthesize→Report) successfully identified 24 distinct quality findings organized by severity
one_line_learning: Parallel AI extraction implementations (F-005) with divergent allergen/pseudonymization paths create silent food-safety risk — should flag "duplicate critical business logic" as BLOCKER in discovery phase
---

---
date: 2026-05-13
task: Ship a1-analyze skill v1
project: a1-skills
result: pass
issues: [arch_drift_found, quality_finding_actionable]
what_worked: 8 architecture decisions (Generic mode, 5-phase pipeline, YAML state, parallel sub-agents) were bundled in one session with Simon, avoiding decision thrash
one_line_learning: Generic (not domain-specific) project analyzer is more reusable than consistency-gate — a1-analyze should ship first, gates defer to M1
---

---
date: 2026-06-30
project: n3ural-platform
focus: general (all-4: arch+quality+security+compliance)
findings: 4 BLOCKER, 9 MAJOR, 6 MINOR
issue_classes: [write_path_duplication, missing_billthrough, missing_legal_page, avv_gap, duplicate_logic, api_envelope_inconsistency, test_gap, god_module, gobd_invoice, simplification_opportunity, migration_reversibility]
---
✅ Was gut war: 5 read-only Agenten parallel (Alex/Reinhard/Marco/Ludwig/Simplifier) → 3-fache unabhängige Bestätigung der Write-Path-Duplikation (höchstes Vertrauen). Tripwire clean. Reinhards BLOCKER (5. Invoice-Pfad) selbst per grep verifiziert = aktiver Bug gefunden, nicht nur theoretisch. Analyse korroboriert direkt die a1-evolve-Synthese desselben Tages (feature_incomplete_surface_coverage) — Code-Beweis für das Prozess-Learning.
⚠️ Was nicht passte: a1-tools add-finding via Shell-Variable mit Multi-Arg zerbrach (Wortaufspaltung) — Findings stattdessen direkt im Report-Body synthetisiert (robuster, aber findings_count in Frontmatter blieb unvollständig). CLI-Helper braucht Array-sichere Aufruf-Doku oder die Findings sollten direkt im Body landen.
💡 Suggestion: a1-analyze sollte bei "alle 4 Fokus"-Wunsch NICHT 'general' als Container nehmen, sondern explizit comprehensive-Mode unterstützen (5+ Agenten, dedup-Cluster). Und: add-finding-CLI ist fehleranfällig bei langen Beschreibungen — Report-Body-First-Pattern dokumentieren.

## 2026-07-03 — n3ural-platform / architecture
✅ Was gut war: Parallel-Dispatch Alex+Marco deckte Assessment UND Doku-Material in einem Lauf; Gap-Liste direkt an Roadmap-Meilensteine gebunden → Specs sofort priorisierbar; Preprod-DB machte Test-Empfehlungen konkret.
⚠️ Was nicht passte: (a) Always-on-Lanes (code-simplifier, security-review) in der Umgebung nicht verfügbar — nur Notes-Eintrag möglich; (b) Marco verletzte read-only und schrieb docs/ direkt (Tripwire fing es; Inhalt war gewünschtes Deliverable, behalten) — Agent-Briefs müssen "Ausgabe als TEXT zurückgeben" explizit erzwingen wenn read-only gilt; (c) add-finding-CLI einzeln pro Finding ist bei 22 Findings zäh.
💡 Suggestion: a1-analyze Briefs um harte Zeile ergänzen: "Du darfst KEINE Dateien schreiben — auch keine Doku; Ergebnisse NUR als Text zurückgeben" + Batch-Modus für add-finding (JSON-Liste).
issue_classes: [readonly_breach, missing_lanes, cli_ergonomics]

---
date: 2026-07-05
task: niimo full analysis (general + architecture + security + compliance)
project: niimo
result: pass
focus: general
findings_total: 31
findings_blocker: 5
issue_classes: [security_vuln, arch_drift_found, duplicate_critical_logic, simplification_opportunity, quality_finding_actionable]
simplify_lane: ran
security_lane: ran
what_worked: 6 parallel read-only lanes (4 a1 agents + simplify + security-review) dispatched in one turn, git tripwire clean
one_line_learning: security lane found a real cross-family IDOR (unregisterFcmToken missing verifyFamilyScope) that the focused security reviewer missed — the always-on security lane earns its keep by catching sibling-inconsistency IDORs that per-module review overlooks.
---
date: 2026-07-12
task: a1-specforge skillset quality/vision-gap audit
project: a1-specforge
result: pass
focus: quality
findings_total: 15
findings_blocker: 0
issue_classes: [security_vuln, quality_finding_actionable, missing_coverage, arch_drift_found, contract_violation]
simplify_lane: skipped
security_lane: ran
what_worked: 4 parallel lanes (reinhard/marco/tobi/security) each in own context; orchestrator re-verified the 2 highest-risk findings (F-012 broken link, F-015 cmd-injection) by direct file inspection before reporting confirmed
one_line_learning: sub-agents went idle without auto-delivering results — needed explicit SendMessage(to=main) nudge; a1-analyze Phase-3 dispatch should tell agents up front to deliver findings via SendMessage to main, not just return text
