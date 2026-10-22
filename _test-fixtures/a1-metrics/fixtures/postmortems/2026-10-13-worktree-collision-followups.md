---
type: postmortem
bug_slug: worktree-collision-followups
project: a1-specforge
date: 2026-10-13
severity: minor
terminal_status: fixed
root_cause_class:
- spec_omission
fix_wave_count: 2
diagnosis_rounds: 1
phase_that_produced_most_friction: fix
quak_regression: skipped
fix_required_test_first: true
one_line_learning: 'Review of a test-harness change must check the cleanup path: a
  guarded mktemp is part of the fix, not of the nits'
created_at: 2026-10-13 16:49:23.871000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-13-worktree-collision-followups
---

# Postmortem: worktree-collision-followups (2026-10-13)

## Bug Summary

Five minor gaps left by the slug-collision fix (#42): slug >= 249 bytes overflowed the 255-byte folder name; a symlinked repo root counted as another repo; ids were only unique against active entries of other repos (cleaned and same-repo entries produced duplicates, `adopt` had no re-check); an invalid `A1_NOW_OVERRIDE` printed `internal error`; the a1-reconcile suite rewrote tracked fixtures. Fixed in PR #44 (d581ebd).

## Timeline

| Time | Event |
|------|-------|
| 2026-10-13 | Reported from the #42 re-review notes |
| 2026-10-13 | Diagnosed: all five reproduced on main with isolated HOME and throwaway repos |
| 2026-10-13 | Fixed: red-first cases 28-31, then code; PR #44 |
| 2026-10-13 | Review: 1 BLOCKER, 2 MINOR fixed in a second commit; squash-merged as d581ebd |

## Root Cause

#42 decided uniqueness per repo and per active status only, used `path.resolve` for the repo root, and set no limit on the slug. Each gap is a case that the first design did not name.

## Contributing Factors

- Minor findings of the #42 re-review were parked in a postmortem list instead of a ticket, so they waited a day.
- The reconcile suite wrote into its own source tree since 2026-05; nobody saw it because the files were rewritten with equal content on the author's machine.
- Registry ids are looked up by first match, so any duplicate stays silent until `enter`.

## What Went Well

- Every gap reproduced in minutes; cases 28-33 go red when the matching fix is reverted (reviewer and orchestrator both measured it).
- Reviewer found the blocker by stubbing `mktemp`, a failure mode no suite run exercises.
- Linux check in node:20 before the merge.

## What Didn't Go Well

- The new `WORK=$(cd "$(mktemp -d)" && pwd -P)` line, written to make paths real, removed the guard on a failed `mktemp`; the EXIT trap would then `rm -rf` the cwd. Same class as the CLAUDE.md gotcha "leeres `cd` im Checkout".
- A helper `cat > file` without input blocked the first test insertion for 10 minutes; I only noticed through an empty log.
- The first test run finished green because the new cases were never inserted; only the missing RED output revealed it.

## One-Line Learning

Review of a test-harness change must check the cleanup path: a guarded mktemp is part of the fix, not of the nits

## Suggested Lesson (for promote-lessons to evaluate)

A test suite that creates a work dir must guard it in three steps (`mktemp || exit`, realpath `|| exit`, non-empty and is-dir check) before any EXIT trap can `rm -rf` it. Candidate for a shared `mk_workdir` helper in the fixture lib (third occurrence of this class).
