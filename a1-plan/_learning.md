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
