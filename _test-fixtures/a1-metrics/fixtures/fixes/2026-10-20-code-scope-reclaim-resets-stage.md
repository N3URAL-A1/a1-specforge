---
type: bug-report
project: a1-specforge
bug_slug: code-scope-reclaim-resets-stage
title: code-scope claim with a changed path list replaces the reservation and resets
  its stage to started
status: reported
severity: minor
reported_at: 2026-10-20T19:40
reporter: orchestrator (session 2026-10-20)
affected_repos:
- a1-specforge
related_deploy: 97855fc
duplicate_of: null
phase_history:
- phase=report completed=2026-10-20T17:40:00.000Z
recommended_code_agent: null
fix_commit: null
verify_result: null
tags:
- bug
- project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-20-code-scope-reclaim-resets-stage
---

# Bug: code-scope claim with a changed path list replaces the reservation and resets its stage to started

## Symptom

A feature that already holds a reservation at stage `verify` needed one more path. `code-scope claim --by 019-depth-pass-planning --scope _shared/gates-registry.md` replaced the eleven stored paths with the single new path and set `stage: started`. A second claim with the full list plus the new path kept all paths but still reset the stage; it had to be restored with `code-scope stage --set verify`. Nothing warns that the stage was lost.

## Reproduction Steps

1. `code-scope claim --by F --scope a,b` then `code-scope stage --by F --set verify`.
2. `code-scope claim --by F --scope c` (or `--scope a,b,c`).
3. Read `.a1/reservations.json`.

Expected: either an additive claim (paths a,b,c), or an explicit re-scope, and in both cases the stage is kept (or the CLI refuses / warns that the stage resets).
Actual: paths replaced by `c` (step 2 first form), `stage: started`, `at` reset, exit 0, output `idempotent: false` with no warning.

## Environment

- Browser / OS / Device: macOS, Node 20
- App version / commit: main 97855fc
- Tenant / user role: n/a
- Network / VPN / region: n/a

## Frequency

always

## Impact

Lifecycle bookkeeping: a feature silently drops back to `started`, which can make later `stage` transitions or the Lifecycle Completion Gate misreport; a narrowing replace also silently frees paths another feature may then claim.

## Affected Components

- Repo(s): a1-specforge
- Suspected files / routes / services: `_shared/lib/code-scope.cjs:175-177` (`cmdCodeScopeClaim`: non-identical re-claim builds a fresh reservation with `stage: 'started'` and filters out the old one)

## Recent Changes

Re-claim widening for directory signals added with PR #49 (lines 128-161); the non-identical path was not changed.

## Notes

Fix idea: keep `stage` (and maybe `at`) of the existing reservation on re-claim, and make replace vs add explicit (e.g. `--add`), or at least print a warning when paths are dropped. Logged during the 2026-10-20 session; fix later.