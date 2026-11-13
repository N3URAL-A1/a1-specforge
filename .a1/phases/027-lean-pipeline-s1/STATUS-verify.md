## Wave 2 — Verify-run durations (lane verify)
Completed: 2026-11-13

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 Durations in verify run | DONE | 24f1a8c | verify-run.cjs 530 lines; a1-verify 165 passed |

RED-proof 2.1 runCommand duration_ms constant 0 -> VD5 red (rc=1)
RED-proof 2.1 cache hit duration not nulled -> VD3 red (rc=1)

Full suite (bin/run-suites.sh): only a1-intent red (known environment red, 12-13 failed across two runs); all others green.
run-tests.sh numstat vs 526160e: 2 added, 0 deleted.

### Deviations
- none
