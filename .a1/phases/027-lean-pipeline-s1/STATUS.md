# Status: 027-lean-pipeline-s1

Consolidated from STATUS-measure.md, STATUS-verify.md, STATUS-gates.md after the last lane wave (6). Lanes ran sequentially in one worktree (GOAL.md Decisions), so there were no lane merges.

# Lane: measure

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

# Lane: verify

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

# Lane: gates

# STATUS gates lane

## Wave 4 — Register pr-security-surface
Completed: 2026-11-13

| Task | Status | Commit | Notes |
|---|---|---|---|
| 4.1 Registry row, 02-review.md wiring, FR-033 fixture | DONE | see git log (feat(027-lean-pipeline-s1): register pr-security-surface) | |

Task 4.1 lists no RED-proof mutations; the discrimination is in-suite: W14b (call line removed -> gates lint exit 1, unwired) and W14c-red (cd removed -> log lands in primary checkout).

### Done-when evidence
- run-wave14.sh: 7 passed, 0 failed; `gates lint` exit 0; `run-suites.sh --check-groups` ok (62 suites).
- Suites of action 6 all PASS (a1-xprov a/b, a1-pr-review, a1-probe, a1-kritis-profile, a1-dashboard, a1-gates-lint run-tests/wave13/wave14, a1-retro-validate, a1-depth-pass). No file under _test-fixtures/a1-xprov changed.

### Deviations
- [Rule 2] README.md fixture-runner count 60 -> 61 (a1-gates-lint N1 went red because the new runner makes 61); one-number fix.

## Wave 6 — Quality-invariant lint
Completed: 2026-11-13

| Task | Status | Commit | Notes |
|---|---|---|---|
| 6.1 quality-invariants.json, invariant_* rules, FR-034 fixture | DONE | 2959388 | |

RED-proof 6.1 JSON/test.yml resolved from __dirname instead of root -> W14l-a, W14l-b, W14k, W14k2, W14m red (rc=1)
RED-proof 6.1 invariant_unwired check removed -> W14h (6 deterministic ids) red (rc=1)
RED-proof 6.1 job-scope check removed -> W14k2 red (rc=1)
RED-proof 6.1 step name compared via unescaped new RegExp(name) -> W14f, W14n, W14k3 (and W14a) red (rc=1)

### Done-when evidence
- run-wave14.sh: 42 passed, 0 failed (12 W14g + 12 W14h per-id asserts = 24). run-tests.sh and run-wave13.sh exit 0 unchanged.
- gates lint exit 0 on the real tree (invariants checked, 12 ids, 2 ci steps); workflow lint exit 0; --check-groups ok (62 suites).
- Full run-suites: only a1-intent red (known env-red). Line counts: quality-invariants.cjs 138, gates-cli.cjs 135, a1-tools.cjs 778.
- suite-groups.json: run-wave14.sh timing 1 -> 4 s (measured 3.4 s).

### Deviations
- None.

