---
type: postmortem
bug_slug: scope-reclaim-dir-signal
project: a1-specforge
date: 2026-10-15
severity: minor
terminal_status: fixed
root_cause_class:
- regression
fix_wave_count: 3
diagnosis_rounds: 1
phase_that_produced_most_friction: fix
quak_regression: passed
fix_required_test_first: true
one_line_learning: A performance-guard fixture must reach the slow code path (seed
  the state it needs) and its RED run must show the slow time, not just a different
  exit code
created_at: 2026-10-15 13:09:46.249000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-15-scope-reclaim-dir-signal
---

# Postmortem: scope-reclaim-dir-signal (2026-10-15)

## Bug Summary

PR #49 introduced a directory signal (trailing `/`) for scope overlap and a segments-only `scopeKey` for claim idempotency. A same-feature re-claim that added the signal was silently dropped (first form wins), and a trailing `/.` was not recognised as a directory, so a later `**/x` claim by another feature missed a conflict. Found by Reinhard in PR #49 round 5 as MINOR + NIT.

## Timeline

| Time | Event |
|------|-------|
| 2026-10-15 12:10Z | Reported (from PR #49 review follow-up) |
| 2026-10-15 ~12:20Z | Diagnosed (Falk, high confidence) |
| 2026-10-15 13:09Z | Fixed (commit ccc9c19, PR #50, 3 commits) |
| 2026-10-15 13:10Z | Verified (37/37 suites, CI pass, Reinhard APPROVE) |

## Root Cause

`hasDirSignal` only tested `endsWith('/')`, while `scopeSegments` dropped the `.` of a trailing `/.`; and the claim idempotency branch compared `scopeKey` (signal-free) and returned the stored entry unchanged, so the wider candidate never reached the store.

## Contributing Factors

- The signal and the identity key were introduced in the same PR with different notions of equality.
- The first fix replaced the check with an unanchored regex that was O(n²) (17 s at 1e5 `/.` pairs inside the reservations lock); `.` segments are dropped before the segment cap counts, so input size was unbounded.
- The first timing fixture ran `check` against an empty reservation file, never reached `hasDirSignal`, and its RED (56 ms, different exit code) proved only the missing length cap, not the ReDoS.

## What Went Well

- Falk proved overlap is monotone in the signal, which made the fail-safe direction (widen, check conflicts first) unambiguous.
- Reinhard caught both the ReDoS regression and the hollow fixture; real data (27 reservation files, 105 plans) unchanged.

## What Didn't Go Well

- Two extra review rounds for issues a first-round checklist ("regex on unbounded input?", "does the RED run show the measured slow time?") would have caught.

## One-Line Learning

A performance-guard fixture must reach the slow code path (seed the state it needs) and its RED run must show the slow time, not just a different exit code

## Suggested Lesson (for promote-lessons to evaluate)

For any new regex on user- or file-supplied input in `_shared/lib`, require a linear-time implementation or an anchored pattern plus a length cap, and a fixture that times the function directly (bypassing caps) with a RED run on the old code that exceeds the bound.
