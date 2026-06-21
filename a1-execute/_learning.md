# a1-execute — Learning Log

Entries appended automatically by Phase 3 (Verify) after every run.
Used by a1-evolve for pattern clustering (threshold: 3+ same tag = proposal).

Tags: plan_drift | missing_dependency | wave_too_large | flaky_test | env_issue | spec_omission | unverifiable_criterion | blocker_unforeseen

Canonical source: `~/N3URAL-Vault/pattern/a1-learnings/a1-execute.md`. This file is a fast-access cache.

---

---
date: 2026-05-08
task: Wave 4-6 Execution + Deploy Spec 001 (Ausgaben-Erfassung)
project: n3ural-platform
result: partial
issues: [unverifiable_criterion, wave_too_large, blocker_unforeseen]
what_worked: GCP Document AI Processor-ID + Location-Bug schnell diagnostiziert; Zod v4 Breaking Change erkannt
one_line_learning: 12 Post-Deploy-Bugs nach 182/188 grünen Tests zeigen: Acceptance-Szenarien waren zu oberflächlich — Smoke-Tests nicht gegen echte URLs durchgeführt
---

---
date: 2026-05-11
task: Spec 003 Deploy (Reports Period Navigation) + 4 Post-Deploy Regressions gefixt
project: n3ural-platform
result: partial
issues: [blocker_unforeseen, plan_drift]
what_worked: withTenantContext Bug-Root-Cause schnell identifiziert (Promise.all Transaction Isolation); api.workshops → api.workshop_sessions sofort klar
one_line_learning: Server Components mit mehreren KPI-Queries brauchen separate withTenantContext Calls mit eigenem .catch() — Architektur-Pattern muss im Wave-Brief stehen, nicht implizit sein
---

---
date: 2026-05-17
task: Wave 1-6 Execution Niimo Spec 001 (AI Extraction Pipeline)
project: niimo
result: pass
issues: []
what_worked: TDD-first (42 Tests, 100% Coverage); ADR-010/017 Compliance explizit als Wave 5; 3 CFs zu Thin Wrapper (-448 Zeilen)
one_line_learning: Zero Production-Bugs bei stricter Wave-Isolation + expliziten Compliance-Tests als eigene Wave — Muster wiederholen
---
