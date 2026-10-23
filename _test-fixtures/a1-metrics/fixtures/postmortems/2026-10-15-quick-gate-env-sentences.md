---
type: postmortem
bug_slug: quick-gate-env-sentences
project: a1-specforge
date: 2026-10-15
severity: major
terminal_status: fixed
root_cause_class:
- schema_flaw
fix_wave_count: 5
diagnosis_rounds: 1
phase_that_produced_most_friction: fix
quak_regression: passed
fix_required_test_first: true
one_line_learning: A copied glob matcher needs a per-glob liveness table (each forbidden
  glob must match one real path) and a normalisation parity test against the reference
  matcher
created_at: 2026-10-15 12:00:23.013000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-15-quick-gate-env-sentences
---

# Postmortem: quick-gate-env-sentences (2026-10-15)

## Bug Summary

The XS quick-lane eligibility gate let env files through: its forbidden-surface globs `**/*.env` and `**/.env.*` never matched a real path, because the matcher compared whole path segments only. Separately, the intent sentence counter counted dots inside file names, so one-sentence intents naming files were refused. Found by the spec 016 wave 6 agent (scope parity) and by quick run roadmap-refs.

## Timeline

| Time | Event |
|------|-------|
| 2026-10-14 13:20Z | Reported |
| 2026-10-14 14:52Z | Diagnosed (Falk, high confidence) |
| 2026-10-15 11:59Z | Fixed (commit 9fffcd7, PR #49, 5 review rounds) |
| 2026-10-15 12:00Z | Verified (37/37 suites on snapshot, CI pass, Reinhard APPROVE) |

## Root Cause

`segmentsMatchGlob` in `quick.cjs` (copied in b123a81, 2026-07-22, and again in `code-scope.cjs`) treated a segment as a wildcard only when it was exactly `*` or `**`; every other segment, including in-segment globs like `*.env`, was compared literally. The two env globs were the only in-segment globs in the list, so the gate failed open for exactly the secret-bearing files. The sentence counter used `/[.!?]/g` and counted every dot.

## Contributing Factors

- No per-glob liveness test: the fixtures only tested one whole-segment path, so 2 of 14 globs were dead for three months.
- Same lesson as `fixes/2026-07-10-leading-glob-overmatch` (glob matcher class) was not turned into a check.
- The fix itself needed 5 review rounds: false overlaps and ReDoS (r1), root scope (r2), directory vs leading `**` (r3), `.` segments diverging from 016 `xprov scope` (r4). Each round found a new normalisation edge, because there was no parity test against the reference implementation until round 4.

## What Went Well

- Falk's diagnosis was correct and complete in one round, including the second affected module.
- Reinhard's fuzz harness (335,790 pairs) and the real-plan class check (47/69 lane plans, 286 real reservation paths) proved no regression on real data.
- Every guard got RED evidence against the previous commit.

## What Didn't Go Well

- Review rounds were spent on point fixes; the class sweep against `xprov-scope.cjs` `segmentsOf` should have been round 1.
- CI takes ~31 min per push.

## One-Line Learning

A copied glob matcher needs a per-glob liveness table (each forbidden glob must match one real path) and a normalisation parity test against the reference matcher

## Suggested Lesson (for promote-lessons to evaluate)

When a fix touches a matcher or normaliser that has a reference implementation elsewhere in the repo, the first fix round must include a generated parity test (reference vs fixed on a path corpus) and a liveness row per pattern; review rounds on single edge cases are a signal to switch to the parity sweep.

Follow-ups (in analysis 2026-10-14): scope re-claim drops the directory signal (MINOR), trailing `/.` dir signal (NIT).
