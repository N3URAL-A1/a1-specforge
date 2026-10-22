---
type: bug-report
project: a1-specforge
bug_slug: worktree-slug-collision
title: "a1-worktree gives two repos the same worktree id and path when the slug matches"
status: fixed
severity: major
reported_at: 2026-10-12T20:57
reporter: robert
affected_repos:
  - a1-specforge
related_deploy: unknown
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-12T18:57:41.000Z"
  - "phase=diagnose completed=2026-10-12T18:57:41.646Z"
  - "phase=fix-start completed=2026-10-12T20:47:23.251Z"
  - "phase=verify completed=2026-10-12T20:47:23.296Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: ef7f25e
verify_result: "a1-worktree 100/0 (macOS + node:20), pr-review 11/0, lib-units 456/0, intent 1059/0; full loop only xprov R30j2-8 red, identical on main; PR #42 merged"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-12-worktree-slug-collision
---

# Bug: a1-worktree gives two repos the same worktree id and path when the slug matches

## Symptom

Two repos in the same parent folder that prepare a worktree with the same slug get an identical registry id and an identical worktree path. Follow-up from spec 014.

## Reproduction Steps

1. Two throwaway repos `par/repoA`, `par/repoB`, isolated `HOME`.
2. `a1-tools worktree prepare par/repoA same-slug` then the same for `repoB` within the same minute.
3. `a1-tools worktree enter <id>`.

Expected: two distinct ids and two distinct paths.
Actual: both entries have id `<UTC-minute>-same-slug` and path `par/a1-worktrees/same-slug`. `enter <id>` activates the first match (repoA); repoB stays `prepared` and cannot be addressed by id.

## Environment

- Commit: main at f52eb83 (plugin 1.11.0), macOS, node

## Frequency

always (same slug, same parent folder; the id collides within the same UTC minute)

## Impact

Wrong repo's worktree is entered or exited; the second repo's worktree cannot be addressed by id; the registry looks consistent but is ambiguous.

## Affected Components

- `_shared/lib/worktree-registry.cjs` (`nowCompactId`, `repoParentWorktreeDir`, `findEntryBySlugOrId`)
- `_shared/lib/worktree.cjs:80` (path), `:111` (id), prepare check 6 only tests the disk, check 7 only tests the same repo

## Recent Changes

none known

## Diagnosis (Phase 02 — measured by the orchestrator, no Falk run)

**Hypothesis:** neither the id (`<UTC minute>-<slug>`) nor the path (`<parent>/a1-worktrees/<slug>`) contains anything that identifies the repo; the registry never checks id or path uniqueness across repos.
**Evidence:** worktree-registry.cjs:40-47 (id), :114-116 (parent dir), worktree.cjs:80 (path), :111 (id), :63-70 (checks); reproduced with two repos, two entries share id and path.
**Confidence:** high
**Recommended code agent:** a1-walter-web-developer
**Suggested fix approach:** at prepare, detect an existing non-cleaned entry of another repo with the same id or path and disambiguate with the repo folder name (id and path); keep today's names when there is no collision. Add a fixture for the two-repo case.