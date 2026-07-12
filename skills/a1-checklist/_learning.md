# a1-checklist — Learning Log
Entries appended automatically after every run.
---

---
date: 2026-05-17
task: Post-mortem on a1-new-feature gate effectiveness after 18-bug corpus analysis
project: a1-skills
result: partial
issues: [gate_effective, blocker_missed, false_green]
what_worked: Existing 3-gate pattern (Build + Preview-Deploy + Smoke Test) when rigorously applied would have caught 8 of 18 bugs (44%) — gates are effective if enforced
one_line_learning: Gates were only added on 2026-05-10 after Ausgaben-Erfassung postmortem; pre-May-10 bugs show gates were missing earlier — checklist must enforce gate execution before Phase 6
---

---
date: 2026-05-13
task: Ship a1-checklist skill v1
project: a1-skills
result: pass
issues: [gate_effective, scope_too_narrow]
what_worked: 8-check pre-flight validator with slug+ID resolution, 9 test-fixtures all green, covers essential blockers (naming, spec structure)
one_line_learning: Checklist should include "did all gates from a1-new-feature Phase 5 execute?" as a late-phase gate to prevent false green before phase-6 verification
---

<!-- Migrated from skills/a1-check/_learning.md on 2026-07-12 (M13): a1-check retired, its gate lives on as checklist checks #9/#10. -->
Entries appended automatically after every run.
---

---
date: 2026-05-17
task: Consistency Gate check auf Niimo Spec 001 wave plan
project: niimo
result: pass
issues: []
what_worked: Bijektive FR-Coverage-Prüfung fand keine Lücken; alle 7 FRs auf genau eine Wave gemappt
one_line_learning: Gate ist am effektivsten wenn direkt nach Phase 4 (Plan) ausgeführt — nicht als nachträgliche Verifikation
---

---
date: 2026-05-10
task: Consistency Gate check auf n3ural-platform Spec 001 nach 12-Bug-Postmortem
project: n3ural-platform
result: fail
issues: [spec_stale, false_alarm]
what_worked: CLI-Ausgabe war präzise — zeigte genau welche FRs im Plan fehlten
one_line_learning: Gate hätte vor Wave 6 Deploy laufen sollen; nachträglich bestätigt es nur was schon kaputt ist — Enforcement-Punkt ist NACH Plan, VOR Implement
---
