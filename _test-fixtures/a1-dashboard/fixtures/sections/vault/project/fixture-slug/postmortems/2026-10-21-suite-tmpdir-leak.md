---
type: postmortem
bug_slug: suite-tmpdir-leak
project: a1-specforge
date: 2026-10-21
severity: minor
terminal_status: fixed
root_cause_class:
- env_config
fix_wave_count: 2
diagnosis_rounds: 1
phase_that_produced_most_friction: verify
quak_regression: skipped
fix_required_test_first: false
one_line_learning: 'A TMPDIR redirect is not isolation on macOS: BSD mktemp without
  a template ignores TMPDIR, so a temp-dir rule must be a lint (explicit template)
  plus a runtime empty-TMPDIR check, not a convention'
created_at: 2026-10-21 07:53:48.144000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-21-suite-tmpdir-leak
---

# Postmortem: suite-tmpdir-leak (2026-10-21)

## Bug Summary

The fixture suites left about 15 000 `tmp.*` dirs per day in the macOS user temp dir. 143 253 dirs had to be purged by hand on 2026-10-19. There was no functional break; the cost was disk and inode growth on the owner's Mac.

## Timeline

| Time | Event |
|------|-------|
| 2026-10-20 19:45 | Reported (owner pain point) |
| 2026-10-20 19:45 | Diagnosed (Falk, one pass, measured per suite) |
| 2026-10-21 07:53 | Fixed (commit 54e6366, PR #54) |
| 2026-10-21 07:53 | Verified: CI green, including the cockpit I1 rerun; macOS per-suite leak 0 |

## Root Cause

On macOS, BSD `mktemp -d` without a path template uses `_CS_DARWIN_USER_TEMP_DIR` and ignores `$TMPDIR`. a1-xprov "isolated" its temp dirs by exporting `TMPDIR` into its suite root, and its EXIT trap removed only that root. So every per-case tree leaked: about 300 per run, about 95 % of the total. In addition, about 20 fast suites never cleaned up their per-case dirs, and the CONVENTIONS skeleton taught that pattern.

## Contributing Factors

- CI runs on GNU/Linux, where the redirect works, so CI never showed the leak.
- The cockpit I1 arm reruns every suite, which doubled the xprov leak.
- Cleanup was a convention with no check behind it.

## What Went Well

- Falk measured per suite on a snapshot and fingerprinted the real leaked dirs, which pinned 95 % on three helpers in one pass.
- Reinhard's mutation probes found 5 real MINORs: mode-000 dirs under `set -e`, subshell cleanup, lint gaps, order-dependent cleanup, and an unguarded WORK dir.

## What Didn't Go Well

- Parallel agents ran suites at the same time, which polluted the global temp-dir counts.
- One agent killed processes by pattern, and another killed by a PID it had looked up. Both ended the orchestrator's cockpit runs.
- The local cockpit evidence was never clean; CI was the reliable measurement.

## One-Line Learning

A TMPDIR redirect is not isolation on macOS: BSD mktemp without a template ignores TMPDIR, so a temp-dir rule must be a lint (explicit template) plus a runtime empty-TMPDIR check, not a convention

## Suggested Lesson (for promote-lessons to evaluate)

Every fixture temp dir comes from `_test-fixtures/lib/tmp.sh` (`mk_workdir`) with an explicit template. Lint arm L2 and the a1-tmp-hygiene suite enforce this, so a bare `mktemp` is a CI failure, not a review comment. When agents run suites in parallel, measure leaks against a private TMPDIR or in CI, never against the shared temp dir.