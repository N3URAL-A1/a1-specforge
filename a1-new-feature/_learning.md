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

