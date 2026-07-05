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
---
date: 2026-07-04
phase: p1-pilot-readiness
project: a1-office
result: pass
waves: 4 (+1 BLOCKED-ON-ROBERT)
verification: PASS 10/10 SC, 22/22 neue Integrationstests grün
deviations: 6 (alle minor/dokumentiert)
✅ Was gut war: Parallel-Split Wave 1 (Ludwig+Erik) und Wave 3 (2 Executors, disjunkte Dateien) lief konfliktfrei; Schema-Verifikation vor Code (Preprod \d) verhinderte erfundene Spalten; SC-7-Lücke aus Wave-2-Report direkt in Wave 3 als Zusatz-Task eingeplant statt liegen gelassen.
⚠️ Was nicht passte: Plan referenzierte 2x falsche Pfade/APIs (RESERVED_SLUGS-Modul, vitest singleFork entfernt) — Executor musste abweichen; Test-Skip-Guard prüft DATABASE_URL nicht mit (Verifier-Fund).
💡 Suggestion: Planner-Checkliste ergänzen: Import-Pfade und Lib-API-Versionen (package.json) im Plan real verifizieren, nicht aus MAP übernehmen; Test-Env-Preconditions (ENVs) als expliziten Plan-Fakt aufnehmen.

---
date: 2026-07-05
phase: M7-oss-ready
project: a1-specforge
spec: docs/roadmap.md M7 + .a1/phases/M7-oss-ready/PLAN.md
result: pass
evidence: .a1/phases/M7-oss-ready/VERIFICATION.md (verdict PASS 5/5, CI run 28742174363)
gates_fired:
  - {id: plan-audit, verdict: pass, caught: true}
one_line_learning: Fresh-machine-Claims ohne Fresh-Machine-Test sind wertlos — install.sh war seit M0 auf jeder frischen Maschine kaputt (fehlendes mkdir -p) und niemand hat es gemerkt, weil alle Umgebungen das Zielverzeichnis schon hatten.
---
✅ Was gut war: Wave-Schnitt nach Datei-Ownership (Sweeps zusammengelegt statt parallel) verhinderte Konflikte komplett; Opus-Executor-Agents meldeten Abweichungen ehrlich (Phantom-Gitlinks, zwei-Commit-Bootstrap, install.sh-Bug) statt sie zu verschweigen; erster CI-Lauf rot → Fix → grün in 3 Minuten ist genau der Instrumentierungs-Loop.
⚠️ Was nicht passte: Plan-Annahmen über Fixture-Interna waren 2× falsch (git log -1 walk-up, no-code-tag-Semantik) — der Executor musste vor Ort umentscheiden; CI-Assert prüfte Seiteneffekt eines read-only-Subcommands (next-number legt nichts an).
💡 Suggestion: Für CLI-Subcommands in Plänen immer kennzeichnen ob read-only oder writing — Asserts nur auf writing-Commands bauen.

---
date: 2026-07-05
phase: M8-launch-community
project: a1-specforge
spec: docs/roadmap.md M8 + .a1/phases/M8-launch-community/PLAN.md
result: pass
evidence: .a1/phases/M8-launch-community/VERIFICATION.md (enablers shipped; plugin live-validated 17 skills+18 agents)
gates_fired:
  - {id: plan-audit, verdict: pass, caught: true}
one_line_learning: Manifest-Schemas aus Doku/Research zweimal falsch — der live Validator (claude plugin validate) ist die einzige Wahrheit; Executor korrigierte gegen das Tool statt gegen die Zitate. Zweites Learning: Umlaut-basierte Sprach-Greps übersehen umlautfreie deutsche Sätze — Inventar + breites Safety-Net nötig.
---
✅ Was gut war: Rollback-SHA vor dem git mv (nie gebraucht, aber billig); Live-Plugin-Install als Validierung statt Doku-Vertrauen; Contributor-Dry-Run fand 2 echte Friction-Points die kein Review gefunden hätte.
⚠️ Was nicht passte: MAP-Inventar unvollständig (1 Datei mit deutschem Text fehlte); Wave-3-Agent sah Wave-2-Arbeit nicht (Parallel-Race) und meldete falschen Offen-Status — harmlos, aber Reports aus parallelen Wellen dürfen sich nicht gegenseitig referenzieren.
💡 Suggestion: Parallel-Wave-Briefs sollten explizit sagen "andere Wellen laufen parallel — melde nur deinen eigenen Scope, keine Repo-weiten Statusaussagen".

⚠️ Nachtrag M8 (2026-07-05): Der skills/-Umzug brach Roberts lokale ~/.claude/skills-Symlinks — VERIFICATION prüfte Fresh-Machine, aber nicht die MIGRATION der bestehenden Installation. Lesson: Layout-Moves brauchen einen Bestands-Migrations-Check (install.sh muss tote Symlinks selbst erkennen und ersetzen statt zu skippen). Kandidat für install.sh-Fix + gates-registry Ergänzung.

