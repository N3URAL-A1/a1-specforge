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
