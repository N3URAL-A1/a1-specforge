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

## Wave 2 — `--affected` and `scope` wiring
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 runVerify seam, CLI flag, verify check refusal, cases-affected-cli.sh | DONE | 5363ee7 | a1-verify 283 passed, 0 failed (BC1/BC2 PASS); verify-run.cjs 558 lines; run-tests.sh diff vs wave 1 is +1/-0 |

RED-proof 2.1 affected+base guard removed -> AC8b, AC9 red (rc=1)
RED-proof 2.1 --out accepted -> AC8a red (rc=1)
RED-proof 2.1 scope check removed -> AC12a, AC12c red (rc=1)
RED-proof 2.1 scope check refuses missing scope -> AC12b, BC1 red (rc=1)
RED-proof 2.1 applyEnvRed settled ids only -> AC10 red (rc=1)
RED-proof 2.1 runPlan unused for headCommands -> AC1, AC1b, AC10, AC11 red (rc=1)

### Deviations
none (probe files of the AC fixtures live outside the project dir, next to it as `$P.probe`, so the tree stays clean and AC11 sees a cache miss rather than `dirty`)
