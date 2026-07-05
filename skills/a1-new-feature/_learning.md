# a1-new-feature — Learning Log

Entries appended automatically by Phase 6 (Verify) after every run.
Used by a1-evolve for pattern clustering (threshold: 3+ same tag = proposal).

Tags: missing_wiring | wrong_behavior_vs_spec | deployment_incomplete | schema_flaw | regression | spec_omission

---

---
date: 2026-05-08
spec: forensics-batch
project: n3ural-platform
result: fail
bugs_found_in_verify: 12
bug_classes: [missing_wiring, wrong_behavior_vs_spec, schema_flaw, regression, spec_omission]
gate_that_caught_most: none
phase_that_produced_most_bugs: implement
one_line_learning: Phase 6 Verify must diff spec FRs against shipped code to catch orphaned waves; 8 of 12 bugs would have been caught by Wave-Check gates (Build+Preview-Deploy+Smoke) if enforced
---

# Ausgaben-Erfassung Spec 001 — May 8-10 Postmortem (12 Bugs)

Wave 1-6 shipped to production (2026-05-08) with 12 critical bugs discovered in user testing and post-deploy:
- Upload route 404 (Wave 6 page missing) — missing_wiring
- Save fails 500 (schema NOT NULL + RLS mismatch) — schema_flaw
- Save persists nothing (RLS grant gaps) — wrong_behavior_vs_spec
- Duplicate confirm loop (no flag in schema) — spec_omission
- OCR date not extracted (gRPC→REST regression) — regression
- Migration 023 not applied in prod (schema drift) — wrong_behavior_vs_spec
- reverse_charge_flag missing UI — missing_wiring
- Ausgabe-Detail edit mode never planned — spec_omission
- List not sorted + no total — missing_wiring
- Reports Ausgaben show 0 (wrong filter) — wrong_behavior_vs_spec
- Reports KPI tables wrong name — wrong_behavior_vs_spec
- Reports KPI columns wrong + error swallowing — wrong_behavior_vs_spec

8 of 12 would have been caught by existing gates if Wave-Check (Build+Deploy+Smoke) applied at time. 
4 required spec completeness (FR enumeration + acceptance scenario review). Added 4 gate improvements to skill on 2026-05-10.


---
date: 2026-05-17
spec: 001-consolidate-ai-extraction-pipeline
project: niimo
result: pass
bugs_found_in_verify: 0
bug_classes: []
gate_that_caught_most: Phase-4.5
phase_that_produced_most_bugs: none
one_line_learning: 6-Wave plan with bijective FR-to-Wave mapping + Consistency Gate (Phase 4.5) prevented bugs — adherence to Wave isolation + spec completeness = zero post-deploy defects
---

# Niimo Spec 001 — AI Extraction Pipeline (6 Waves, May 17 Complete)

Specification → Planning → Implementation → Verify completed in single session, 2026-05-17.
- Phase 1 (Discover): 10-topic interview with Rene
- Phase 2 (Specify): 7 FRs, 4 P1 User Stories, 6 Scenario Classes
- Phase 3: (skipped, no clarification needed)
- Phase 4 (Plan): 6-wave plan by Vincente
- Phase 4.5 (Consistency Gate): PASS — 7 FRs bijectively mapped to waves, no orphans
- Phases 5-6 (Implement+Verify): Zero bugs in user testing

Wave structure: Wave 1 (backend-bernd, read-only analysis), Waves 2-3 (TDD+refactor), Wave 4 (cleanup), 
Wave 5 (QA compliance), Wave 6 (deploy). Each wave had explicit acceptance criteria tied to specific FRs.
Consistency Gate before implementation prevented Wave 6 omissions that plagued Spec 001.


---
date: 2026-05-17
spec: niimo-meal-swap-onboarding-redesign
project: niimo
result: fail
bugs_found_in_verify: 3
bug_classes: [missing_wiring, spec_omission, regression]
gate_that_caught_most: none
phase_that_produced_most_bugs: spec
one_line_learning: UI-heavy features (Cookbook, Meal-Swap, Onboarding) with incomplete route specs + missing planId context = navigation + state bugs; require explicit "context propagation matrix" in spec phase
---

# Niimo Meal-Swap + Onboarding — May 17-18 Session (3 Bugs, 1 Redesign)

Parallel work on meal-swap flow (Wochenplan tab) and onboarding (step 5/6) uncovered 3 spec/design gaps:

## Bug 1: Rezept erkennen layout regression (May 11, Flutter)
- Root: Variante-D-Redesign moved BottomPanel visibility below fold on small devices
- Fix: BottomPanel pinned to Stack, content Expanded with bottom padding
- Class: regression + missing_wiring (layout contract not tested for device constraints)

## Bug 2: Meal-Swap from non-current plan operates on current plan (May 17)
- Root: Route `/recipe/:familyId/:recipeId` has no `planId` param; screen resolves current week plan always
- Fix: Add `?planId=...` query param, pass through wochenplan nav, resolve in screen
- Class: missing_wiring + spec_omission (route design never specified context passing)

## Bug 3: Onboarding Cookbook CTA pulls user into capture flow
- Root: Spec included primary CTA "Rezept hinzufügen" + tappable import cards; should be read-only
- Fix: Remove CTA and card interaction, design 2 mockup variants for step-through explanation only
- Class: spec_omission (UX intent not fully specified; unclear whether user should be PULLED into capture during onboarding)

Learning: Navigation specs for multi-screen flows must include a **context propagation matrix** listing every route, what context it receives, how it resolves defaults, and what it passes to children.

---
date: 2026-06-19
spec: 015-agent-space
project: n3ural-platform
result: pass
waves_total: 4
bugs_found_in_verify: 2
bug_classes: [parallel_collision, agent_self_report_false]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: implement
one_line_learning: Verify fing 2 Branch-Hygiene-Lücken (veralteter dist täuschte roten main; 2 neue Lint-Errors) — Pre-Merge-Rebase + Lint-only-auf-eigene-Dateien hätte sie früher gefangen
---
date: 2026-06-19
spec: 016-capability-mediation-layer
project: n3ural-platform
result: pass
waves_total: 9
bugs_found_in_verify: 2
bug_classes: [parallel_collision, wrong_behavior_vs_spec, gate_friction, agent_self_report_false]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: implement
one_line_learning: Consistency-Gate FAILte 2× durch FR-Token in narrativen Wave-Zeilen; Verify fing Migr-Nummern-Kollision (Spec 017 parallel) + Dashboard-Query die kompilierte aber leer lieferte — Gate-0-Selbstverifikation + Pre-Merge-Migr-Check eingebaut
---
date: 2026-06-03
spec: 001-crm-saas-foundation
project: n3ural-platform
result: pass
waves_total: 9
bugs_found_in_verify: 2
bug_classes: [schema_flaw, deployment_incomplete]
gate_that_caught_most: Gate 3
phase_that_produced_most_bugs: implement
one_line_learning: withTenantContext leakt Connections als "idle in transaction" (35min, blockierte CONCURRENTLY-Index+VACUUM) — Connection-Hygiene gehört in den Wave-Brief bei CONCURRENTLY-Migrationen
---
date: 2026-06-03
spec: 002-crm-pipeline-normalization
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 1
bug_classes: [spec_omission, deployment_incomplete]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: verify
one_line_learning: Spec war "done" aber geplante Integration-Tests fehlten (Phantom-Gap) — Phase 6 muss prüfen ob die im Plan zugesagten Tests real existieren, nicht nur ob Code läuft
---
date: 2026-06-03
spec: 003-crm-activities-consolidation
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 0
bug_classes: [schema_flaw]
gate_that_caught_most: none
phase_that_produced_most_bugs: implement
one_line_learning: Apply-Pattern bewährt — voller Dry-Run der Migrations-Kette in EINER BEGIN/ROLLBACK gegen Prod-Schema (BEGIN/COMMIT der Files via awk strippen), dann backup → echtes Apply
---
date: 2026-06-04
spec: 004-crm-billing-completion
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 1
bug_classes: [schema_flaw]
gate_that_caught_most: Gate 3
phase_that_produced_most_bugs: implement
one_line_learning: time_entries hatte KEINEN audit_row-Trigger (nur update_project_timestamp) — Audit-Trigger-Existenz pro mutierter Tabelle muss im Plan explizit geprüft werden, sonst fehlt GoBD-Audit still
---
date: 2026-06-04
spec: 005-crm-custom-fields-activation
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 0
bug_classes: []
gate_that_caught_most: none
phase_that_produced_most_bugs: implement
one_line_learning: no failures — Custom-Fields JSONB-Aktivierung sauber durch
---
date: 2026-06-04
spec: 006-crm-pipeline-contract
project: n3ural-platform
result: pass
waves_total: 2
bugs_found_in_verify: 1
bug_classes: [deployment_incomplete, regression]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: implement
one_line_learning: Contract-Phase (Spalte droppen) braucht 2-PR-Split + strikte Deploy-Reihenfolge (Code deployt Ready DANN Migration) — sonst Outage; PostgREST !inner Pflicht sonst leaken won/lost
---
date: 2026-06-15
spec: 007-feedback-widget
project: n3ural-platform
result: pass
waves_total: 4
bugs_found_in_verify: 0
bug_classes: [deployment_incomplete]
gate_that_caught_most: none
phase_that_produced_most_bugs: implement
one_line_learning: no failures — HTTP-Contract sauber dokumentiert (POST /api/feedback/ mit trailing slash); Migration 070 als manueller Robert-Schritt offen (Dry-Run lief)
---
date: 2026-06-16
spec: 008-project-types
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 0
bug_classes: [schema_flaw]
gate_that_caught_most: none
phase_that_produced_most_bugs: implement
one_line_learning: Expand→Migrate→Contract sauber (projects.type-Spalte bleibt, Dual-Write); zentrales Behavior-Mapping (billing-method.ts) statt verstreuter Enum-Logik; AFTER-INSERT-Trigger seedet neue Tenants automatisch
---
date: 2026-06-16
spec: 009-business-modul-edit-manage-completeness
project: n3ural-platform
result: pass
waves_total: 4
bugs_found_in_verify: 2
bug_classes: [missing_wiring, wrong_behavior_vs_spec]
gate_that_caught_most: Gate 3
phase_that_produced_most_bugs: implement
one_line_learning: Tobi-Audit-Muster "API existiert, UI fehlt" + DELETE-Route gab immer 409 + Partner-CRUD war nur GET — vollständige CRUD-Surface (nicht nur Read) pro Entity im Clarify-Scan prüfen
---
date: 2026-06-16
spec: 010-pipeline-flow-enforcement
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 2
bug_classes: [wrong_behavior_vs_spec, schema_flaw]
gate_that_caught_most: Gate 3
phase_that_produced_most_bugs: implement
one_line_learning: Bidirektionale Zustands-Kopplung (Won≡Accepted) braucht beidseitige "already in target state"-Guards + direkten client.query (kein HTTP/Trigger zwischen Routen) gegen Loops; invoice declined-Enum-Bug
---
date: 2026-06-17
spec: 011-dual-logo-branding
project: n3ural-platform
result: pass
waves_total: 5
bugs_found_in_verify: 1
bug_classes: [wrong_behavior_vs_spec]
gate_that_caught_most: Gate 3
phase_that_produced_most_bugs: implement
one_line_learning: PDFKit kann kein SVG/WEBP — Logo-Pfade brauchen Format-Guard (nur PNG/JPEG) + 5s-Timeout + Text-Fallback; PDF immer Hell-Logo (weißes Papier)
---
date: 2026-06-17
spec: 012-deal-category-tag
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 1
bug_classes: [schema_flaw, regression]
gate_that_caught_most: Gate 1
phase_that_produced_most_bugs: implement
one_line_learning: GIT-CHAOS-Lesson (Parallel-Branch-Isolation) — bei paralleler Arbeit IMMER frisch von main branchen, selektiv stagen, nie fremde Git-Arbeit rebasen; 1-Pflicht-Tag via direkte FK (nicht n:m taggings), kind-Trennung deal/activity
---
date: 2026-06-17
spec: 013-agentic-layer-klaus
project: n3ural-platform
result: pass
waves_total: 8
bugs_found_in_verify: 6
bug_classes: [missing_wiring, wrong_behavior_vs_spec, deployment_incomplete, schema_flaw]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: implement
one_line_learning: Mocks färbten kaputten Code 3× grün (RLS-Read umging withTenantContext; Confirm-Bypass; ReadPort→WritePort-Miscast) — nur echte Test-DB + echte LLM-Calls fanden die 6 Live-Bugs (Tool-Namen-Punkt, Reasoning-Stream-leer, maxDuration-Override, agent_id-FK-String); bei OpenAI-kompat-Providern keine Punkte in Tool-Namen
---
date: 2026-06-18
spec: 014-durable-workflow-engine
project: n3ural-platform
result: pass
waves_total: 6
bugs_found_in_verify: 1
bug_classes: [env_issue, spec_omission]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: verify
one_line_learning: Integration-Tests grün nur mit DATABASE_URL=...?sslmode=disable (Code nutzt withTenantContext→DATABASE_URL, nicht PG*-Vars; Cloud-SQL-Proxy spricht kein SSL); offene E2E-Lücke (markSent-Effekt im Test umgangen) vor Produktiv-Einsatz als echter Smoke nachholen
---
date: 2026-06-19
spec: 017-agent-model-switch
project: n3ural-platform
result: pass
waves_total: 5
bugs_found_in_verify: 0
bug_classes: [parallel_collision]
gate_that_caught_most: none
phase_that_produced_most_bugs: implement
one_line_learning: parallel zu Spec 016 entwickelt+gemergt — belegte Migr-Nummern 088/089 zuerst (016 musste auf 090/091 rebasen); bei parallelen Features Migr-Nummern früh koordinieren oder beim Merge prüfen

## Spec 003 (hourly-rate-from-quote) — 2026-06-21
✅ Was gut war: Eigene DB-Verifikation der Agent-Arbeit fing einen Production-Crash (p.billing_method existiert nicht) den 23 grüne Mock-Tests durchwinkten. Migration-Dry-Run mit simuliertem Leerzustand bewies echten Backfill (223→150€). Discover gegen reale Daten (7 hourly-Quotes geprüft) deckte auf dass billing_method='hourly' ≠ Stunden-Position — Pflicht-Regel an Projekt-Typ statt Position aufgehängt.
⚠️ Was nicht passte: Code-Agent (Bernd) lieferte zuerst rein gemockte Tests trotz Spec-Vorgabe "Integration gegen echtes Schema" + riet 3 falsche Fakten in der Spec (Signatur, deals.quote_id, p.billing_method). Mock-Tests verbergen exakt die SQL-Fehlerklasse die in diesem Projekt am häufigsten zuschlägt.
💡 Suggestion: Code-Agent-Briefing für DB-Features MUSS fordern: "mindestens ein echter Integrationstest pro SQL-Funktion gegen Schema, KEINE rein gemockten Tests für SQL-Pfade" — und der Orchestrator MUSS jede neue Raw-SQL-Query selbst einmal gegen die echte DB laufen lassen bevor Merge. Reihenfolge: Agent-Bericht NIE blind vertrauen → Spalten/Queries gegen `\d` + echten Lauf prüfen.

## Spec 004 (inline-create-combobox) — 2026-06-21
✅ Was gut war: Explore-Agent für die Bestandsaufnahme (7 Felder in 5 Modals) vor dem Bau — verhinderte blindes Patchen + lieferte die Best-Practice-Referenz (CreateDealModal Lead-Inline). Generische Komponente statt 6× Duplikat. Akuter Einzelfall (Position) zuerst als a1-fix gelöst (entblockt User sofort), dann Pattern als Feature. Eigene Verifikation: vorbestehende 72 Test-Failures gegen main gegengeprüft (auch dort rot) statt der eigenen Änderung anzulasten.
⚠️ Was nicht passte: Consistency-Gate FAIL war IRREFÜHREND als "Duplikate Wave 1+Wave 3" angezeigt — echte Ursache war ein FEHLENDES FR-007 in der Wave-Header-Zeile (plan_frs 13 vs spec_frs 14). Außerdem: Matrix-Tabelle nach der letzten Wave platziert → Gate ordnet alles nach `## Wave N` der letzten Wave zu. Bernd lieferte wieder einen tsc-roten Test (Fixture fehlende Felder) trotz grüner vitest-Runs.
💡 Suggestion: (1) Bei Gate-FAIL IMMER zuerst `plan_frs vs spec_frs` aus dem JSON prüfen — wenn ungleich, ist es ein FEHLENDES FR (in einer Header-Zeile übersprungen), nicht ein Duplikat. Die `duplicated_in_plan`-Anzeige ist bei der letzten-Wave-Falle irreführend. (2) FR-Abdeckungs-Matrix IMMER VOR Wave 1 platzieren (Text vor erster `## Wave` wird vom Gate ignoriert). (3) Code-Agent-Briefing: nach jeder Wave `npx tsc --noEmit` auf die GEÄNDERTEN+NEUEN Dateien (inkl. Tests) — vitest grün ≠ tsc grün.
---
date: 2026-07-03
spec: 001-homepage-redesign
project: n3ural-website
result: pass
waves_total: 6
bugs_found_in_verify: 2
bug_classes: [regression, wrong_behavior_vs_spec]
gate_that_caught_most: Phase 6
phase_that_produced_most_bugs: implement
one_line_learning: Content-Ergänzungen (neue Case Study) müssen ALLE abgeleiteten Flächen mitziehen — Anzahl-Wörter in Headings ("Three Products"), Klassifikations-Listen (AI_PRODUCT_SLUGS), Test-Fixtures; beim Hinzufügen einer Entity nach ihrem Namen über Copy+Logik greppen. Zweites Learning: Agent-Teammate-Messaging kreuzt sich regelmäßig — nach jedem Dispatch Commit-Stand prüfen statt auf Reports warten.
