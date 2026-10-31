---
type: bug-report
project: a1-specforge
bug_slug: locks-empty-lockfile-stolen
title: acquireReservationsLock treats a just-created empty lock file as stale, so
  two processes can both hold the lock
status: reported
severity: major
reported_at: 2026-10-21T00:30
reporter: orchestrator (found by spec 017 Wave 2 implementer)
affected_repos:
- a1-specforge
related_deploy: d411418
duplicate_of: null
phase_history:
- phase=report completed=2026-10-20T22:30:00.000Z
recommended_code_agent: null
fix_commit: null
verify_result: null
tags:
- bug
- project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-21-locks-empty-lockfile-stolen
---

# Bug: acquireReservationsLock treats a just-created empty lock file as stale, so two processes can both hold the lock

## Symptom

Under concurrency, two writers both acquire the reservations lock. Seen in spec 017 Wave 2: a hash-chained gate log appended under this lock forked (12 broken links with two parallel writers × 50 lines on a CPU-loaded run). The same lock guards `.a1/reservations.json` and product-docs writes, so lost updates are possible there too.

## Reproduction Steps

1. Two processes call `acquireReservationsLock(file)` at nearly the same time under CPU load.
2. Process A: `fs.openSync(lockPath, 'wx')` succeeds (empty file), has not yet written its payload.
3. Process B: EEXIST → `isLockStale(lockPath)` parses an empty file → `createdAt` NaN → returns true (`_shared/lib/locks.cjs:152`) → reclaims via rename and wins.

Expected: B waits until A releases.
Actual: A and B both proceed inside the critical section.

## Environment

- Browser / OS / Device: macOS and Linux, Node 20
- App version / commit: main d411418
- Tenant / user role: n/a
- Network / VPN / region: n/a

## Frequency

intermittent (needs a reader inside the create→write window; frequent under load)

## Impact

Read-check-write sequences guarded by this lock (reservations, product docs) can lose updates or double-claim under parallel agents.

## Affected Components

- Repo(s): a1-specforge
- Suspected files / routes / services: `_shared/lib/locks.cjs:172-181` (create with 'wx', then write payload) and `:150-155` (unparseable/empty payload = stale)

## Recent Changes

unknown

## Notes

Fix ideas: write the payload to a tmp file and `linkSync` it to the lock path (atomic create-with-content), or treat an empty/unparseable lock younger than a grace period (by file mtime) as live. Spec 017 Wave 2 uses an atomic `mkdir` lock for the gate log instead (decision Q20).