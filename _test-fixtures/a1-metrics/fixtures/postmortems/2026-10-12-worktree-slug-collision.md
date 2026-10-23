---
type: postmortem
bug_slug: worktree-slug-collision
project: a1-specforge
date: 2026-10-12
severity: major
terminal_status: fixed
root_cause_class:
- spec_omission
fix_wave_count: 3
diagnosis_rounds: 1
phase_that_produced_most_friction: fix
quak_regression: passed
fix_required_test_first: true
one_line_learning: Identifiers and paths derived from a user slug alone must include
  a repo-unique component; check uniqueness across the whole registry, not per repo
created_at: 2026-10-12 20:47:28.958000+00:00
permalink: vault/project/a1-specforge/postmortems/2026-10-12-worktree-slug-collision
---

# Postmortem: worktree-slug-collision (2026-10-12)

## Bug Summary

`a1-worktree prepare`/`adopt` built the registry id as `<UTC minute>-<slug>` and the path as `<parent>/a1-worktrees/<slug>`. Two repos in one parent folder with the same slug got identical ids and paths; `enter <id>` hit the first repo, the second stayed unreachable. Fixed in PR #42 (ef7f25e).

## Timeline

| Time | Event |
|------|-------|
| 2026-10-08 | Reported as a follow-up of spec 014 (hub status) |
| 2026-10-12 18:57 | Diagnosed and reproduced with two throwaway repos (isolated HOME), by the orchestrator, no Falk run |
| 2026-10-12 | Fixed in 3 commits (prepare, adopt, hardening after review), squash-merged as ef7f25e (#42) |
| 2026-10-12 | Verified: a1-worktree 100/0 on macOS and node:20, pr-review 11/0, lib-units 456/0, intent 1059/0; reviewer re-measured 2 mutations red |

## Root Cause

Neither the id nor the default path contained anything that identifies the repo, and the registry never checked id or path uniqueness across repos (check 6 only tested the disk, check 7 only the same repo). A prepared entry has no folder yet, so even the disk check could not see the other repo.

## Contributing Factors

- The convention `<repo-parent>/a1-worktrees/<slug>` was designed for one repo; the multi-repo case was never specified.
- Lookup by id returns the first match, so the duplicate stayed silent until `enter`.
- The first fix added a plain basename suffix; two review rounds then found that the suffix itself can re-collide (sibling slug, same basename in different parents, cleaned entries).

## What Went Well

- Reproduction in minutes with isolated HOME and two throwaway repos.
- Red-first fixtures; reviewer mutated the production lines and measured the cases going red.
- Linux check in node:20 before the PR (a recurring CI-red class).
- Full suite loop found one red (xprov R30j2-8) and a comparison against a clean main snapshot proved it pre-existing.

## What Didn't Go Well

- Three fix commits for one defect: the first design (basename suffix) did not close the class; the hash-based tag only arrived after review.
- Integrity-check mismatch (backend-bernd.md edited the same day) stopped the pipeline; re-bootstrapping the lock needed the user to run it, the permission system blocked the agent.
- `timeout` does not exist on macOS: two verification commands produced no output until noticed.
- Test runs regenerate `_test-fixtures/a1-reconcile/*/drift-*.md` inside the tree (local path leaked into a commit, caught by the reviewer).

## One-Line Learning

Identifiers and paths derived from a user slug alone must include a repo-unique component; check uniqueness across the whole registry, not per repo

## Suggested Lesson (for promote-lessons to evaluate)

When a name is built from user input plus a timestamp, derive uniqueness from a stable owner key (hash of the resolved repo root), re-check the final name against all registry entries (any repo, any status), and write a clock-injectable test; do not rely on a readable suffix.

## Open follow-ups (minor, from re-review, not fixed in #42)

- Slug of 249+ characters can overflow 255 bytes when prefixed (`repoTag` fallback ignores the cap; add a slug length cap or fail `worktree_path_free`).
- Symlinked repo roots are not resolved in `prepare`/`adopt` (pre-existing): use `resolveRealOrAbs(repoRootRaw)`.
- Id uniqueness ignores `cleaned` and same-repo entries while lookups match them; `adopt` lacks the `idTaken` re-check.
- `A1_NOW_OVERRIDE` error should use `e.code = 'A1_INPUT'` (prefix `error:` instead of `internal error:`).
- Test runs regenerate a1-reconcile fixtures in the live tree.
