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
