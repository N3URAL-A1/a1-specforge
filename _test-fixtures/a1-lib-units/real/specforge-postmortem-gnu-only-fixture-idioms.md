---
type: postmortem
bug_slug: gnu-only-fixture-idioms
project: a1-specforge
date: 2026-10-28
severity: major
terminal_status: fixed
root_cause_class:
- one-sided-guard
- platform-portability
found_by: cross-platform-run
should_have_caught: fixture-linter
fix_wave_count: 2
diagnosis_rounds: 1
phase_that_produced_most_friction: fix
quak_regression: skipped
fix_required_test_first: true
one_line_learning: 'A guard written for the CI platform only is half a guard: it keeps the other platform''s breakage invisible until somebody runs there.'
created_at: 2026-10-28 23:00:41.751000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-28-gnu-only-fixture-idioms
---
