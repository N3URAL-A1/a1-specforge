# STATUS-verify (lane verify)

## Wave 1 — Selection module
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 verify-affected.cjs + cases-affected-unit.sh | DONE | 00ea5a4 | 206 lines; a1-verify 260 passed, 0 failed; run-tests.sh diff 1/0 |

RED-proof 1.1 rule-6 check removed -> AU2, AU10b red (rc=1)
RED-proof 1.1 HARD_FULL_PATHS emptied -> AU3 (all 6) red (rc=1)
RED-proof 1.1 selectorMatches exact-only -> AU1, AU8, AU10, AU13 red (rc=1)
RED-proof 1.1 requirer step removed -> AU10, AU10b red (rc=1)
RED-proof 1.1 ls-files scan narrowed -> AU11 red (rc=1)

### Deviations
none
