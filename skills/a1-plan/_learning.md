# a1-plan — Learning Log

Entries appended automatically by Phase 4 (Audit) after every run.
Used by a1-evolve for pattern clustering (threshold: 3+ same tag = proposal).

Tags: missing_acceptance_criteria | vague_tasks | no_success_criteria | wave_too_large | missing_dependency | unverifiable_goal | spec_omission

Canonical source: `~/N3URAL-Vault/pattern/a1-learnings/a1-plan.md`. This file is a fast-access cache.

---

---
date: 2026-05-10
task: Plan Spec 001 (Expense Document Preview) mit 6 Waves
project: n3ural-platform
result: partial
audit_findings: [missing_acceptance_criteria, vague_tasks, spec_omission]
what_worked: Full FR/US coverage bis Phase 4 — Wave Plan war strukturell solid
one_line_learning: Edit-Modus (BUG-08) wurde nicht im Initial-Spec geplant; explizite "is this CRUD complete?" Frage in Clarify hätte es gefangen
---

---
date: 2026-05-11
task: Plan Spec 003 (Reports Period Navigation) mit Header-Stepper + 5 KPI-Datenquellen
project: n3ural-platform
result: partial
audit_findings: [missing_acceptance_criteria, spec_omission]
what_worked: URL-State-Persistence im Plan explizit verankert; Periode-Filter-Architektur korrekt
one_line_learning: Multi-Query HTTP-Self-Calls nicht als Architektur-Risiko erkannt — Wave-Brief muss Query-Isolation-Pattern für Promise.all verpflichtend fordern
---

---
date: 2026-05-17
task: Plan Niimo Spec 001 (consolidate-ai-extraction-pipeline) mit 6 Waves
project: niimo
result: pass
audit_findings: []
what_worked: 7 FRs bijektiv auf 6 Waves mapped; Consistency Gate Phase 4.5 PASS; Compliance-Tests als explizite Wave eingeplant
one_line_learning: Refactoring-Voraussetzungen (Quality-Audit-Findings) hätten vor Planning stattfinden sollen — Plan baute auf unsauberem Ist-Stand auf
---
---
date: 2026-05-29
phase: ofp046-markdown-brain-railway
project: a1-office
spec: ~/.claude/plans/rolle-du-bist-senior-giggly-backus.md
result: pass
revisions: 0
audit_findings: 0
finding_classes: [vague_tasks, missing_dependency]
phase_that_produced_issues: [plan]
one_line_learning: Planner-Live-Check der installierten Tool-Config (basic-memory Default-Embedding = bge-small-en-v1.5, englisch-only) deckte einen ziel-kritischen Task auf, den alle Eingabe-Docs uebersahen — Tool-Defaults immer gegen das Ziel verifizieren, nie annehmen.
---
date: 2026-06-04
phase: crm-read-path-consolidation
project: n3ural-platform
spec: none
result: pass-after-revision
revisions: 1
audit_findings: 3
finding_classes: [missing_dependency, unverifiable_goal]
phase_that_produced_issues: [plan]
one_line_learning: Bei Tenant-kritischen Migrationen muss der Äquivalenz-Beweis (Wave 0) verschachtelte Embed-Child-Isolation + Pool-Rollen-Kontamination explizit als testbare STOP-Gates enthalten, nicht nur Top-Level-Row-Isolation.
---
date: 2026-07-04
phase: p1-pilot-readiness
project: a1-office
spec: none (roadmap data.json P1)
result: pass-after-revision
revisions: 1
audit_findings: 2
finding_classes: [missing_dependency, vague_tasks]
phase_that_produced_issues: [map, plan]
one_line_learning: Planner sollte Schema-Annahmen (Spalten/Signaturen) schon im ersten Durchgang per Live-Check verifizieren statt aus MAP.md zu übernehmen — beide Blocker waren unverifizierte Annahmen.


---
date: 2026-07-05
phase: M6-works-for-rob
project: a1-skills
result: pass-after-revision (phase complete, 4 waves, 9/9 fixture suites green)
✅ Was gut war: Audit-Loop hat einen echten Blocker gefangen (Roadmap-Kriterium "add-findings --json fixture test" war im ersten Plan-Entwurf gedroppt → als Task 1.4 zurückgeholt). Wave-2 Sequential-Edit-Constraint auf a1-tools.cjs (2.1a → 2.1b → 2.2) hat funktioniert — kein Clobber trotz drei Tasks in derselben Datei. Cost-Tracker Spike-first (Task 1.3 als hartes Gate vor 2.2) hat Rework verhindert: exakte JSONL-Feldpfade + Dedup-Erkenntnis (message.id, Subagent-Logs) lagen vor der Implementierung fest.
⚠️ Was nicht passte: M5 galt seit 2026-05-25 als "shipped", aber die End-to-End-Validierung in Task 3.2 fand 2 echte Frontmatter-Round-Trip-Bugs in der CLI, die nur end-to-end erreichbar waren — "shipped" ≠ "validated".
💡 Suggestion: End-to-End-Validierungs-Runs gehören in den Shipping-Milestone selbst, nicht in einen späteren Milestone deferred — jede Phase, die CLI-Subcommands liefert, braucht mindestens einen echten Durchlauf auf einem Wegwerf-Projekt vor dem Abhaken.
---
date: 2026-07-05
phase: p2-mobile-voice
project: a1-office
spec: roadmap data.json P2 + docs/adr/2026-07-05_mobile-auth-und-push.md
result: pass-after-revision
revisions: 1
audit_findings: 2
finding_classes: [spec_omission, vague_tasks]
phase_that_produced_issues: [research, map]
one_line_learning: Research/Map-Behauptungen über "fehlt komplett" (OpenAPI-Pfade) und offene Spaltenfragen (device_name) waren faktisch falsch — Auditor-Stichproben gegen den Code sind der wirksame Fang; Planner sollte "X fehlt"-Aussagen immer selbst greppen.

---
date: 2026-07-05
phase: p1.5-hardening
project: a1-office
spec: roadmap data.json / reviews
result: pass-after-revision
revisions: 1
audit_findings: 1
finding_classes: [missing_dependency]
phase_that_produced_issues: [map]
one_line_learning: CI-Migrations-Replay-Annahme (init/ vs migrations/) war unverifiziert — pg_dump-Schema-Seed als robustere Alternative etabliert
---
date: 2026-07-05
phase: p3-pilot-enterprise
project: a1-office
spec: roadmap data.json / reviews
result: pass-after-revision
revisions: 1
audit_findings: 2
finding_classes: [missing_dependency]
phase_that_produced_issues: [plan]
one_line_learning: Parallel erstellte Pläne kollidieren bei Migrations-Nummern — Reservierungstabelle MIGRATIONS-RESERVED.md als Konvention etabliert
---
date: 2026-07-05
phase: p4-eu-sovereign
project: a1-office
spec: roadmap data.json / reviews
result: pass-after-revision
revisions: 1
audit_findings: 2
finding_classes: [missing_dependency]
phase_that_produced_issues: [map]
one_line_learning: MAP fand nur 1 von 2 GcsProvider-Instanziierungen — Auditor-Stichproben gegen Code bleiben Pflicht
---
date: 2026-07-06
phase: p3-pilot-enterprise (extension)
project: a1-office
spec: reference/paperclip-competitor-analyse.md
result: pass-after-revision
revisions: 0 (2 Minors inline)
audit_findings: 0
finding_classes: []
phase_that_produced_issues: []
one_line_learning: Competitor-Analyse → gezielte Plan-Extension via Pablo mit grep-Verifikation des Bestands (Spend-Cap existierte als Konstante!) verhindert Doppel-Implementierung; fokussiertes Extension-Audit (nur neue Teile) reicht bei stabilem Rest-Plan.
