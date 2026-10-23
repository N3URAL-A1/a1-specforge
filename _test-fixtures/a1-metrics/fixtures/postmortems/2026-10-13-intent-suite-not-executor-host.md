---
type: postmortem
bug_slug: intent-suite-not-executor-host
project: a1-specforge
date: 2026-10-13
severity: minor
terminal_status: fixed
root_cause_class:
- test_environment
fix_wave_count: 1
diagnosis_rounds: 1
phase_that_produced_most_friction: diagnose
quak_regression: skipped
fix_required_test_first: false
one_line_learning: A test that pins an environment value once must re-read it where
  the product re-reads it, and report a mid-run change as an environment fault
created_at: 2026-10-13 20:27:34.014000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-13-intent-suite-not-executor-host
---

# Postmortem: intent-suite-not-executor-host (2026-10-13)

## Bug Summary

The a1-intent suite went red in bursts (73 of 1059 cases in one clone run) with `not_executor_host` after a machine stall. Fixed in PR #46 (8cb8232), test-only.

## Timeline

| Time | Event |
|------|-------|
| | Reported |
| | Diagnosed |
| | Fixed (commit ) |
| | Verified |

## Root Cause

Each case file read `os.hostname()` once and wrote it into `executor.json`; the product compares it at every call. A name change mid-run makes every later claim fail. The change is indicated (a 308 s stall in a 2 s case, then only `not_executor_host`) but not proven: the red run had no hostname log, and a second run with a log stayed green with a stable name.

## Contributing Factors

- The suite assumed a constant host name; nothing checked it.
- The reviewer first read the failure as "git clone vs git archive"; one clean clone run refuted that.
- NODE_OPTIONS cannot pin the name: the product refuses foreign NODE_OPTIONS.

## What Went Well

- A hostname log every 5 s in the second run ruled out the checkout type quickly.
- The two-rounds-stop rule produced a bug report instead of a third guess.
- Reviewer measured the guard in bash 3.2 and GNU bash with a stubbed `live_host`.

## What Didn't Go Well

- Each full run takes 15-35 min; three runs for one fix.
- The cause stays unproven; the fix makes the symptom readable, it does not prevent it. The guard fires at the next `set_executor @live`.
- Open: W*_HOST list still coupled to case-file names (MINOR-4), dead ZB_HOST/W10_HOST.

## One-Line Learning

A test that pins an environment value once must re-read it where the product re-reads it, and report a mid-run change as an environment fault

## Suggested Lesson (for promote-lessons to evaluate)

A fixture that pins an environment value (host name, clock, user) once must re-read it wherever the product re-reads it, and report a mid-run change once as an environment fault, not as product failures.