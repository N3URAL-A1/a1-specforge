## Wave 5 — Help text, call sites, P2, registry (lane lint)
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 5.1 Document and wire --affected and verify reuse | DONE | c528949 | all action-8 checks exit 0 |

### Deviations
- Plan action 8 says `gates lint --phase ...`; the subcommand rejects --phase (exit 2). Ran `gates lint` without it: exit 0, no findings.
