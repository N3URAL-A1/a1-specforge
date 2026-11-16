## Wave 5 — Help text, call sites, P2, registry (lane lint)
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 5.1 Document and wire --affected and verify reuse | DONE | c528949 | all action-8 checks exit 0 |

### Deviations
- Plan action 8 says `gates lint --phase ...`; the subcommand rejects --phase (exit 2). Ran `gates lint` without it: exit 0, no findings.

## Wave 6 — Workflow-lint rules (lane lint)
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 6.1 Rules verify-scope and verify-reuse-ban | DONE | 04aff23 | workflow-lint suite 29/0; real tree verify_scope_checked 5, reuse_ban_checked 2 |

RED-proof: (a) PER_WAVE group dropped -> VS2 red; (b) substring --affected -> VS8 red; (c) agents/ presence condition dropped -> W11 red (+VS4); (d) REUSE_RE without verify-reuse -> VS5b red.
Full run-suites: a1-intent 12 failed (subset of accepted set); no other failure seen in the tail. run-tests.sh diff: 3 added, 0 deleted.
