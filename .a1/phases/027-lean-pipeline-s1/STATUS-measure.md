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
RED-proof 3.1 setRecordExtra line removed -> CEW1, CEW2 red (rc=1)
RED-proof 3.2 idempotence check removed -> RR2, RR3 red (rc=1)
RED-proof 3.2 store check creates dirs -> RR4 red (rc=1)
RED-proof 3.2 mainCheckoutDir returns the worktree -> RR9 red (rc=1)
RED-proof 3.3 no_duration not counted -> PT1 red (rc=1)
RED-proof 3.3 dedup against store removed -> PT4 red (rc=1)
RED-proof 3.3 --force check removed -> PT9 red (rc=1)
RED-proof 3.3 host-context key check removed -> PT10 extra-key case red (rc=1)
RED-proof 3.3 host: os.hostname() written -> PT8 hostname case red (rc=1)

## Wave 3 — Merge-check field, run record, phase-time (lane measure)
Completed: 2026-11-13

| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 ci_evidence_why into merge-check record | DONE | 3e3088b | |
| 3.2 a1-tools run record | DONE | 83a16ad | run-record.cjs 157 lines, a1-tools.cjs 778 lines |
| 3.3 metrics phase-time + --baseline | DONE | ed0a62c | one module, 308 lines; AU4a now 7 |

### Deviations
- [Rule 1] 06/07 fixtures first used GNU-only `sed -i` to tamper the chain; a1-vault-fallback L1b caught it; replaced by a node tamper helper (same commit as 3.3).
- metrics-phase-time.cjs header comment reworded so the plan's grep for child_process is 0.
- PT1 asserts the plan's "runs 5" as the sum of row runs (rows are per gate), plus the depth-pass row (3 runs, 350 ms, 1 without duration).
- Full run-suites.sh: only a1-intent red (known env-red); a1-vault-cockpit was green here.

## Wave 5 — 05-merge.md call and ADR note (lane measure)
Completed: 2026-11-13

| Task | Status | Commit | Notes |
|---|---|---|---|
| 5.1 run record in merge close-out | DONE | 4b29c13 | block order DCMGRP, RR-guard case added |
| 5.2 ADR note 3a + invariant sentence | DONE | 4b29c13 | section 7 lines |

### Deviations
- None. Tasks 5.1 and 5.2 committed together (one atomic wave commit).
