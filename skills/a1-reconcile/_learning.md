# a1-reconcile — Learning Log

Entries appended automatically by Phase 4 (Report) after every run.
Used by a1-evolve for pattern clustering (threshold: 3+ same tag = proposal).

Tags: false_missing | false_extra | agent_json_failure | spec_parse_gap | repo_path_missing | stale_misclassified | diverged_overcalled | scope_too_broad

---

---
date: 2026-05-17
task: Niimo Spec 001 consolidate-ai-extraction-pipeline Wave 1 analysis
project: niimo
result: pass
issues: [spec_stale, drift_found, reconcile_triggered_fix]
what_worked: Read-only analysis phase identified that `validateExtraction` function diverged between Cloud Functions — cookbook/ and ai/recipeExtraction/ had different implementations
one_line_learning: Spec divergence should be caught BEFORE implementation starts — add a "ADR-010/ADR-017 compliance check" as Phase 1 (Discover) sub-task in a1-new-feature to flag where safety logic must be synchronized
---

---
date: 2026-05-13
task: Ship a1-reconcile skill v1
project: a1-skills
result: pass
issues: [drift_found, reconcile_triggered_fix]
what_worked: Spec-drift detector (MISSING/EXTRA/DIVERGED/STALE) with 3 trigger-modes and 38 passing tests identifies splits between spec and implementation
one_line_learning: Reconcile works backward (spec→impl check); need forward check too (impl→spec audit) to catch spec creep during implementation — add "impl discovery" phase to detect new features built but not spec'd
---
