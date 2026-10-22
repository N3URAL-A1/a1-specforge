---
type: bug-report
project: a1-specforge
bug_slug: worktree-collision-followups
title: "a1-worktree collision fix (#42) leaves five minor gaps"
status: fixed
severity: minor
reported_at: 2026-10-13T06:37
reporter: robert
affected_repos:
  - a1-specforge
related_deploy: ef7f25e
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-13T04:37:17.000Z"
  - "phase=diagnose completed=2026-10-13T14:45:13.173Z"
  - "phase=fix-start completed=2026-10-13T16:49:19.453Z"
  - "phase=verify completed=2026-10-13T16:49:19.503Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: d581ebd
verify_result: "PR #44: worktree 125/0 (macOS+node:20), reconcile 39/0, pr-review 11/0, lib-units 456/0, quick 38/0, intent 1059/0 (archive); new cases red when fixes reverted"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-13-worktree-collision-followups
---

# Bug: a1-worktree collision fix (#42) leaves five minor gaps

## Symptom

Re-review of PR #42 listed minor gaps that were not fixed before the merge. Source: postmortem `postmortems/2026-10-12-worktree-slug-collision.md`, section "Open follow-ups".

## Reproduction Steps

1. Slug of 249+ characters, cross-repo collision: prefixed folder name 257 bytes, `enter` fails with ENAMETOOLONG.
2. Repo passed via a symlinked path to `prepare`: not seen as the same repo, no collision detected (pre-existing).
3. Discard an entry, re-prepare the same slug in the same minute: duplicate id, lookup hits the cleaned entry; `adopt` has no `idTaken` re-check.
4. `A1_NOW_OVERRIDE=garbage`: output "internal error: ..." instead of "error: ...".
5. Run the fixture suites: `_test-fixtures/a1-reconcile/*/drift-2026-05-13.md` are rewritten in the working tree with a local path.

Expected: each case handled or rejected with a clear message.
Actual: see above.

## Environment

- main at ef7f25e, macOS and node:20

## Frequency

always (each case reproducible)

## Impact

Rare edge cases of the worktree registry; item 5 dirties the tree after every full test run.

## Affected Components

- `_shared/lib/worktree-registry.cjs` (repoTag, activeOtherRepo, nowDate), `_shared/lib/worktree.cjs` (prepare, adopt), `_test-fixtures/a1-reconcile`

## Recent Changes

PR #42 (ef7f25e)

## Diagnosis (Phase 02 — by the orchestrator, measured in isolated HOME with throwaway repos)

All five gaps reproduced on main (d81d2fa).

1. **Long slug.** With repos in one parent and slug of 249 bytes, `disambiguatePath` has `room = 254 - 249 - 1 < 8`, `repoTag` falls back to the bare 6-hex hash and the folder name is 256 bytes (259 at slug 252, 261 at 254). `worktree_path_free` passes, `enter` would fail with ENAMETOOLONG. Root cause: no slug length limit; the tag cannot degrade below `<hash>-`.
2. **Symlink repo root.** `prepare <symlink>` stores `repo_root` = the symlink path and builds the default dir from the symlink parent (`fu/a1-worktrees/sym` vs `fu/p1/a1-worktrees/sym` for the real path). Same repo is seen as two repos. Root cause: `path.resolve` instead of `resolveRealOrAbs` in `prepare`/`adopt`; `activeOtherRepo` compares raw strings.
3. **Id re-use.** Discard `20261013-1000-dup`, re-prepare in the same minute: registry holds two entries with the same id (`cleaned` and `prepared`); `enter <id>` hits the cleaned one (`status "cleaned", expected "prepared"`). Root cause: `holdsId` only looks at non-cleaned entries of other repos. `adopt` does not call the id check at all.
4. **A1_NOW_OVERRIDE=garbage.** Prints `internal error: invalid A1_NOW_OVERRIDE`. Root cause: plain `Error` without `code = 'A1_INPUT'` (`a1-tools.cjs:673` picks the prefix by code).
5. **Fixtures dirty the tree.** `_test-fixtures/a1-reconcile/run-tests.sh` runs lifecycle tests in the tracked fixture dirs and rewrites two tracked `drift-2026-05-13.md` files (`git status` shows `M` after a green run, 38/0). Root cause: suite works on the repo copy, not on a temp copy.

## Fix plan

Files: `_shared/lib/worktree-registry.cjs`, `_shared/lib/worktree.cjs`, `_test-fixtures/a1-worktree/run-tests.sh` (new cases), `_test-fixtures/a1-reconcile/run-tests.sh`.
(1) slug byte limit 200 in `slug_valid`; (2) real repo root in prepare/adopt and real-path compare; (3) id taken by any entry of any status/repo -> repo tag, then counter; same rule in adopt; (4) `A1_INPUT` code; (5) copy fixtures to mktemp, trap cleanup.
