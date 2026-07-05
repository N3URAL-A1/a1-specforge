# Gate Architecture Review — data-driven redesign proposal

**Date:** 2026-07-05 · **Basis:** full gate inventory (~35 gates across 10 skills) + catch statistics from the complete learning corpus (24 documented runs, 6 postmortems, 15 applied patterns) · **Status:** analysis — execution items marked ▸

## 1. What the data says

**Catch distribution (`gate_that_caught_most`, all recorded runs):**

| Gate | Catches | Cost class |
|---|---|---|
| Phase 6 (Verify) | 8 | HIGH (agent dispatch + live walkthrough) |
| none | 8 | — |
| Gate 3 (Smoke) | 6 | MED-HIGH (live actions per wave) |
| Gate 4.5 (FR consistency) | 2 | CHEAP (CLI) |
| Gate 1 (Build) | 1 | MED |
| Gates 0 / 0.5 / 0.6 | 0 recorded | CHEAP-MED (added 2026-06/07 — too new for data) |

**Reading `none` correctly:** 5 of the 8 `none` runs were *clean* (0 verify bugs) — `none` conflates "nothing to catch" with "everything escaped". The 3 true full-escape runs share three escape classes no current gate covers:

1. **Spec-level blindness** (forensics-batch 12 bugs, meal-swap 3): the bug was already in the spec/nav design — every downstream gate faithfully verified the wrong thing.
2. **Mock-test blind spot** (hourly-rate crash behind 23 green tests; 013: mocks colored broken code green 3×): tests as executed prove nothing about the real DB/LLM path. Caught only by ad-hoc orchestrator self-verification — not a gate.
3. **Cross-run coordination** (017 migration-number claim): single-run gates can't see parallel work.

**Structural finding:** detection is back-loaded — 14 of 17 attributed catches happen at the two most expensive, latest gates. The 2026-06/07 gate additions (0, 0.5, 0.6, DB-checklist) all push left; none has catch data yet.

## 2. Overlap map (where we pay twice)

| Overlap | Verdict |
|---|---|
| a1-check ≡ Gate 4.5 | Same CLI, two entrypoints — fine, keep (no double cost) |
| Gate 3 (per-wave FR-ACs live) vs Phase 6 (all FR-ACs live) | **Real double-pay.** Phase 6 re-runs everything Gate 3 already proved |
| a1-phantom ⊂ Victor (Step 6.5) | Fine as subroutine — but phantom **always exits 0** (warning-only), so it can never enforce |
| Reinhard / Tobi / Victor | Three LLM reviewers with overlapping cross-cutting concerns, all HIGH cost |
| Gate 0.5 vs a1-reconcile | Same failure class (incomplete surface wiring), different phase — acceptable (in-flight vs post-hoc) |

## 3. Redesign proposals (priority order)

### P1 ▸ Close the mock-test blind spot with a deterministic gate ("Gate 0.7 — real-path proof")
The single most damaging escape class with zero deterministic coverage. Rule: any wave that adds/changes a SQL query, RLS policy, or external-API call must show **one test execution against the real backend** (test output containing a real connection banner / non-mock marker), else Gate FAIL. Implementation: `a1-tools realpath-check` — greps the wave diff for SQL/fetch signatures, then requires a matching entry in a test-evidence file the executor must produce (command + output hash). Deterministic, cheap, kills the 3×-recurring `mock_tests_hide_sql_bugs` class structurally instead of by prompt appeal.

### P2 ▸ Add the missing spec-level gate (pre-Phase-4)
Today the earliest gate fires *after* planning — spec-level omissions ride through untouched (15+ bugs across 2 runs). Add a cheap LLM "AC dry-run" at end of Clarify: for each FR-AC, narrate the user path step-by-step against the current app's actual nav/layout (one agent pass, no build). Catches "operates on wrong plan", "CTA pulls into capture", "below-fold regression" — the entire meal-swap class — for the cost of one cheap dispatch instead of a full failed run.

### P3 ▸ De-duplicate Gate 3 / Phase 6
Phase 6 should re-run only (a) FR-ACs that failed or were re-touched after their Gate-3 pass, (b) cross-wave integration scenarios, (c) edge cases + SCs. Everything Gate 3 proved per-wave gets a ✓-reference, not a re-run. Estimated saving: the single biggest cost block in the pipeline, at zero detection loss (Gate 3 evidence is already live-URL-based).

### P4 ▸ Make phantom enforce at Phase 6
`phantom check` exit 0 always → a gate that cannot fail is documentation, not a gate. Change: inside Victor's Step 6.5, PHANTOM verdicts on non-`# no-code` tasks become BLOCKER findings in VERIFICATION.md (CLI keeps exit 0 for standalone use; enforcement lives in the verifier contract).

### P5 ▸ Gate registry + per-gate hit instrumentation (make evolve gate-aware)
Gates live as prose scattered over 10 skills; catch attribution is one hand-filled retro field. Create `_shared/gates-registry.md` (id, phase, class det/prompt, cost class, owning file) and extend the retro schema: `gates_fired: [{id, verdict, caught}]`. With the cost tracker this enables **Gate-ROI = catches × severity / token cost** — then a1-evolve can propose retiring gates, not only adding them. This is the difference between a framework that grows and one that converges.

### P6 ▸ Scope the three reviewers explicitly
Reinhard = diff-level, pre-merge only. Victor = goal-backward vs **spec** (not plan — see red-team FMEA-1). Tobi = launch-readiness only, never per-feature. One line in each agent brief; prevents triple-paying for overlapping LLM review.

### P7 ▸ Cross-run coordination gate (small)
`parallel_collision` (3×) has plan-time and merge-time mitigations but no shared state. Minimal fix: `.a1/reservations.json` (migration numbers, route claims) checked by Gate 4.5 — deterministic, one CLI extension.

## 4. What NOT to change
- Gate 4.5/a1-check, a1-checklist, Gate 0.6, integrity-check: cheap, deterministic, keep as-is.
- The Gate-0/0.5 thrust is right — give them 5 more runs of data before judging (they're 2 weeks old).
- Modernize G1–G6 human gates: keep, but see FMEA-5 (auto-approval precedent needs an audit trail).

## 5. Success metric
After P1–P4 land: over the next 10 runs, ≥60% of catches attributed to gates ≤ Gate 3 (today: 18%), and zero `mock_tests_hide_sql_bugs` recurrences.
