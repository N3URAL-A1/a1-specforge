## Wave 1 — Record fields and shared helpers (lane measure)
Completed: 2026-11-12

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 Gate-log started_at, duration_ms, setRecordExtra | DONE | 272cdb8 | gate-log.cjs 439 lines |
| 1.2 Shared project-slug helper | DONE | 181144c | |
| 1.3 retro-gatelog gatesFired export | DONE | 9935488 | |

RED-proof 1.1 duration_ms required in shapeProblem -> GF2 red (rc=1)
RED-proof 1.1 pendingExtra reset removed -> GF6 red (rc=1)
RED-proof 1.1 allowlist bypassed -> GF4 red (GF4b, GF4c) (rc=1)
RED-proof 1.1 constant 0 instead of hrtime -> GF7 red (rc=1)

### Deviations
- GF4 asserts 8 "ignored" notes (7 from the first call plus 1 for the 10000-char key, which is a second setRecordExtra call); the plan's "7" counts the first call only.
