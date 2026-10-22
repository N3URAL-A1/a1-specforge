---
type: postmortem
bug_slug: worktree-learnings-visibility
project: a1-specforge
date: 2026-07-22
severity: major
terminal_status: fixed
root_cause_class:
- structural-gap-two-correct-mechanisms-not-reconciled
fix_wave_count: 1
diagnosis_rounds: 1
phase_that_produced_most_friction: diagnose
quak_regression: skipped
fix_required_test_first: true
one_line_learning: git worktree add never carries gitignored paths — any repo-local,
  gitignored store (learning store, config, cache) that isolation-gated agents depend
  on must be explicitly mirrored into new worktrees, not assumed present.
created_at: 2026-07-22 14:07:57.248000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-07-22-worktree-learnings-visibility
---

# Postmortem: worktree-learnings-visibility (2026-07-22)

## Bug Summary

<!-- Short description of what was broken -->

## Timeline

| Time | Event |
|------|-------|
| | Reported |
| | Diagnosed |
| | Fixed (commit ) |
| | Verified |

## Root Cause

<!-- One paragraph: what was the technical cause? -->

## Contributing Factors

<!-- What conditions allowed this bug to exist/survive? -->

## What Went Well

<!-- Diagnosis speed, tooling, team response -->

## What Didn't Go Well

<!-- Where did friction come from? -->

## One-Line Learning

git worktree add never carries gitignored paths — any repo-local, gitignored store (learning store, config, cache) that isolation-gated agents depend on must be explicitly mirrored into new worktrees, not assumed present.

## Suggested Lesson (for promote-lessons to evaluate)

<!-- One concrete, actionable rule that would prevent recurrence -->