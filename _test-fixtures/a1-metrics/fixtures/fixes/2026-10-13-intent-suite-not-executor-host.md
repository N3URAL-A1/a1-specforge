---
type: bug-report
project: a1-specforge
bug_slug: intent-suite-not-executor-host
title: "a1-intent suite fails in bursts with not_executor_host after a machine stall"
status: fixed
severity: minor
reported_at: 2026-10-13T19:55
reporter: robert
affected_repos:
  - a1-specforge
related_deploy: d581ebd
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-13T17:55:00.000Z"
  - "phase=diagnose completed=2026-10-13T20:27:27.633Z"
  - "phase=fix-start completed=2026-10-13T20:27:31.040Z"
  - "phase=verify completed=2026-10-13T20:27:31.097Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: 8cb8232
verify_result: "intent 1059/0 (x2), cockpit 931/0, guard measured with simulated name change; cause indicated not proven"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-13-intent-suite-not-executor-host
---

# Bug: a1-intent suite fails in bursts with not_executor_host after a machine stall

## Symptom

`_test-fixtures/a1-intent/run-tests.sh` is red in some full runs (reviewer of PR #44: 1036 passed / 23 failed on main and on the PR; own clone run: 986 / 73). `a1-vault-cockpit` I1 wraps the suite and goes red with it. The reviewer's reading "fails in git checkouts, passes in git-archive snapshots" is **not confirmed** (see below).

## Reproduction Steps

1. Fresh `git clone` of main, run `bash _test-fixtures/a1-intent/run-tests.sh` (about 15-35 min).
2. Red run: the first failure is case B4 ("took 308037 ms" for a case with a 2000 ms timeout). Every later claim then fails with `claim exit 1 ... "not_executor_host"` (104 occurrences in the log); the B, T, C groups go red.

Not reproducible on demand: a second run in the same clone (d581ebd) with a hostname log every 5 s gives **1059 passed, 0 failed** and `macbookpro.lan` in all 103 samples.

## Environment

- macOS Darwin 25.5.0, node, `hostname` = `macbookpro.lan` (macOS `HostName` unset, so the name comes from DHCP/DNS), LocalHostName `MacBook-Pro-von-Robert`.
- Red runs happened while other jobs ran (Docker, other suites, agent reviews).

## Frequency

2 of 3 clone runs red today; archive snapshot runs green (3 of 3). Sample is too small to tie it to clone vs archive.

## Impact

False red on the intent suite and `a1-vault-cockpit` I1 on this machine; undermines PR gates that run the full loop.

## Affected Components

- `_test-fixtures/a1-intent/cases/04-claim.sh`, `05-complete.sh`, `05b-child-seal.sh`, `05c-hardening.sh`: each reads `os.hostname()` once at its start (`W4_HOST`, `W5_HOST`, `W5B_HOST`, `ZB_HOST`) and writes it into `executor.json`.
- `_shared/lib/intent-lifecycle.cjs:66,108`: the product compares `executor.json` `executor_host` with `os.hostname()` at every call and answers `not_executor_host` on a mismatch.

## Diagnosis (orchestrator, measured; cause indicated, not proven)

- Measured: all failures after B4 are `not_executor_host` (the log shows it in the claim output); B4 itself stalled for 308 s although its timeout is 2 s, so the machine was stopped or starved at that moment.
- Measured: with a stable hostname (103 samples) the same clone passes 1059/0. So the checkout type is not the cause.
- Indicated, not measured: the hostname changed after the stall (sleep/wake or network change), so the stored `W*_HOST` no longer matched `os.hostname()`. The first red run had no hostname log. A mid-run change is the only path in the code that produces `not_executor_host` for a host that was valid at the start.

## Fix plan (not started)

1. Proof first: log `os.hostname()` and the time in the next red run (or force a change in a throwaway VM/Linux container, not on the host).
2. Make the suite independent of the live hostname: a test-only `--require` preload that pins `os.hostname()` to a constant for the suite process and its children (no product change), or read the hostname at each `set_executor` call.
3. Add a guard assertion that fails with a clear message when the hostname changed during the run, so a flaky host reads as "environment", not as 70 product failures.

## Recent Changes

None related. Same result on main (4bb0861) and PR #44 (d581ebd).
