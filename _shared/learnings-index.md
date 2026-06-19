# Learning Index (cache — canonical is Obsidian Vault pattern/a1-learnings/patterns.md)

Last synthesis: 2026-06-19 (+ backfill of all 17 a1-new-feature retros)
Applied: 10 | Skipped: 0 | Monitoring: 4
Retro corpus: 17 a1-new-feature runs logged (001–017; 015/016 lived, rest reconstructed from memories)

Patterns applied:
- gate_enforcement_gap (4) → a1-new-feature/workflows/05-implement.md
- spec_omission_crud (3) → a1-new-feature/workflows/03-clarify.md
- adr_constraint_too_late (3) → a1-new-feature/workflows/03-clarify.md
- multitenant_rls_not_in_plan (3) → agents/a1-pablo-planner.md
- no_live_url_smoke_test (3) → a1-new-feature/workflows/06-verify.md
- http_self_call_in_server (4) → agents/a1-pablo-planner.md [2026-06-08]
- gate_fr_token_overcount (5) → a1-new-feature/workflows/04-plan.md [2026-06-19] — every FR-NNN token inside a `## Wave` section counts as coverage; narrative FR refs FAIL the gate. Plan brief now mandates: one `**FRs covered:**` line per FR, prose+matrix-pointer elsewhere.
- agent_self_report_false (3) → a1-new-feature/workflows/05-implement.md [2026-06-19] — code agents report claims that are false (missing nav entry, "pre-existing" green tests, "green" query returning empty). New Gate 0: spot-check claims via grep/Read/re-run/DB-query before Build.
- parallel_migration_collision (2) → a1-new-feature/workflows/06-verify.md [2026-06-19] — parallel feature merged to main and took same migration numbers / shared files → pre-merge rebase + migration-number-collision check; keep BOTH sides for additive files; rebuild gitignored dist before declaring main red.
- schema_flaw (8) → a1-new-feature/workflows/04-plan.md [2026-06-19, surfaced by 17-run backfill] — most frequent bug class: missing audit trigger, connection leak (idle-in-tx blocks CONCURRENTLY/VACUUM), enum/CHECK gaps, FK type mismatch, expand-migrate-contract outage. Mandatory per-table DB-schema checklist in the plan brief.

Monitoring (watch, below/at threshold or partly covered):
- rls_grant_matrix_multitable (3) — multi-table mutations under RLS need GRANT+RLS-matrix pre-audit; partly covered by isolation step
- context_propagation_matrix (1) — multi-screen nav routes need explicit context-passing spec (niimo)
- setstate_in_useeffect_lint (1) — new client components trigger cascading-renders lint error; use render-phase prev-prop pattern (if 3+ → add to a frontend-agent brief)
- request_scoped_not_module_global (1) — module-global injected state (writer/handler) leaks across concurrent requests on Fluid Compute; pass request-scoped (security-relevant)
