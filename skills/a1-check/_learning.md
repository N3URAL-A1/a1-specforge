# a1-check — Learning Log
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
