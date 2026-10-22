---
type: bug-report
project: a1-specforge
bug_slug: quick-gate-env-sentences
title: "quick eligibility misses env files and counts file-name dots as sentences"
status: fixed
severity: major
reported_at: 2026-10-14T15:20
reporter: "orchestrator (found by spec 016 wave 6 agent and quick run roadmap-refs)"
affected_repos:
  - a1-specforge
related_deploy: "unknown (since quick lane spec 003, 2026-07)"
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-14T13:20:00Z"
  - "phase=diagnose completed=2026-10-14T14:52:48.185Z"
  - "phase=fix-start completed=2026-10-14T14:53:03.973Z"
  - "phase=verify completed=2026-10-15T12:00:22.959Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: 9fffcd7
verify_result: "2026-10-15: PASS — env globs forbid .env/a/.env/prod.env/.env.local/.env.example and dot-segment variants; one-sentence intents with file names ELIGIBLE; 37/37 suites on snapshot of 8b8a03b, CI pass, Reinhard APPROVE round 5; 47 real lane plans identical main vs branch"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-14-quick-gate-env-sentences
---

# Bug: quick eligibility misses env files and counts file-name dots as sentences

## Symptom

1. `quick eligibility` lets env files through: the forbidden-surface globs `**/*.env` and `**/.env.*` never match, so an XS quick run may touch `.env` files without escalation.
2. `--intent` naming files (`docs/VISION.md and CLAUDE.md`) in one sentence is counted as 6 sentences → false NOT_ELIGIBLE.

## Reproduction Steps

1. `node -e 'const q=require("./_shared/lib/quick.cjs"); for (const p of ["a/prod.env","a/.env.local",".env.local.example",".env","a/.env","src/auth/x.ts"]) console.log(p, q.matchesForbiddenSurface(p))'` on main 64a5954.
2. `node _shared/a1-tools.cjs quick eligibility --intent "Point docs/VISION.md and CLAUDE.md to docs/product/ROADMAP.md + NEXT.md as the roadmap source of truth; docs/roadmap.md is history." --files 2 --diff-lines 8 --scope docs/VISION.md,CLAUDE.md --no-migration --no-new-route --no-new-dep --by x`

Expected: (1) all five env paths `true`; (2) ELIGIBLE (one sentence).
Actual: (1) all five `false`, only `src/auth/x.ts` `true`; (2) NOT_ELIGIBLE "--intent has 6 sentences".

## Environment

- macOS, Node ≥ 18; CLI `_shared/a1-tools.cjs`; commit 64a5954.

## Frequency

always

## Impact

Owner and agents using the XS lane: env/secret files are not treated as forbidden surface (the gate's purpose); valid one-sentence intents with file names are refused, forcing rephrasing.

## Affected Components

- Repo(s): a1-specforge
- Suspected files: `_shared/lib/quick.cjs` (`matchesForbiddenSurface`, `FORBIDDEN_SURFACE_GLOBS` lines ~65-66, `countIntentSentences` ~138-150); tests `_test-fixtures/a1-quick/`.

## Recent Changes

None in the window; `quick.cjs` last changed in vault-path refactors. Related postmortem: `fixes/2026-07-10-leading-glob-overmatch.postmortem.md` (glob matcher class). Spec 016 `xprov scope` includes `FORBIDDEN_SURFACE_GLOBS` and matches in-segment `*` correctly.

## Diagnosis (Phase 02 — filled by Falk)

**Hypothesis:** (A) `segmentsMatchGlob` treats a segment as wildcard only when it is exactly `*`/`**`; other segments compare literally, so the in-segment globs `**/*.env` and `**/.env.*` (quick.cjs:65-66, the only 2 of 14 with in-segment `*`) never match a real path — fails open. (B) `countIntentSentences` counts every `.`/`!`/`?` (`/[.!?]/g`), so file names, versions and `...` inflate the count; `"Fix typo in README.md"` passes only thanks to the file-name dot.
**Evidence:** quick.cjs:83-102 (literal fallthrough `pathSegs[si] === seg`), :114-121, :143-147, :275-285; module run on main 64a5954: 12/14 globs live, `**/*.env` and `**/.env.*` false for `.env`, `a/.env`, `prod.env`, `.env.local`, `x/.env.example`, true for the literal string `*.env`. Same matcher class in code-scope.cjs:49-71 (+ nonGlobPrefix 85-88; `src/*.ts` vs `src/a.ts` false) and quick.cjs:200-215 — latent (no in-segment globs in current reservations). Not affected: vault-mirror globToRegExp, glob-liveness, xprov-normalize firstSentence. Fixtures `_test-fixtures/a1-quick/run-tests.sh:121-131` only test a whole-segment path; no per-glob liveness table; intents are plain prose. Origin: b123a81 (2026-07-22), copied matcher never checked against in-segment globs (same lesson as 2026-07-10 leading-glob-overmatch).
**Confidence:** high
**Recommended code agent:** a1-walter-web-developer
**Suggested fix approach:** shared `_shared/lib/segment-glob.cjs` (no import of quick) with in-segment `*` → `[^/]*`, `?` → `[^/]`, case-insensitive, `**` multi-segment; used by quick and code-scope. Sentence counter `/[.!?]+(?=\s|$)/g`, 0 stays fail-closed, cap 2. Keep `FORBIDDEN_SURFACE_GLOBS` export, contents, order and the exact text `"  '**/.env.*',\n];"` (016 part 27 SC3 anchors on it); quick must stay a subset of 016 `xprov scope`. a1-intent 05b-child-seal expects `--intent x` → exit 1 (keep).

**Orchestrator decisions (2026-10-14, owner delegated autonomy):** `.env.example` templates are forbidden surface (the glob says so, 016 agrees); matching is case-insensitive (APFS, fail-safe, still a subset of scope); code-scope.cjs fixed in the same PR via the shared module (same class).

## Fix Plan (Phase 03 — filled by code agent)

New shared `_shared/lib/segment-glob.cjs` (in-segment `*`/`?`, `**`, case-insensitive, linear two-pointer matcher, `.`/empty segments dropped like 016 `xprov-scope` `segmentsOf`, suspicious paths rejected, directory signal for trailing `/`, `scopeKey` for claim idempotency) used by `quick.cjs`, `code-scope.cjs`, `lane-split.cjs`; stored over-limit scopes fail closed per pair; `code-scope check` validates `--scope`. Sentence counter `/(?<![.!?])[.!?]+["')\]]*(?=\s|$)/g`. `FORBIDDEN_SURFACE_GLOBS` unchanged. Commits 09835d9, 7e72a54, 87c0728, 4db9e70, 8b8a03b; squash 9fffcd7 (PR #49).

## Verification (Phase 04 — filled by skill)

- 2026-10-15: all 37 fixture suites rc 0 on a `git archive 8b8a03b` snapshot with `env -u A1_VAULT_ROOT`; owner stores unchanged; `verify-install-sync` PASS; CI `test` pass (30m52s).
- RED evidence per round against the previous commit (quick, code-scope, lane-split suites).
- Class checks: quick ⊆ 016 `xprov scope` on 18,285 generated paths (0 xprov-forbidden/quick-allowed); fuzz 335,790 scope pairs (0 strict false negatives, 0 false positives); lane-split identical main vs branch on 69 real plans; 286 real reservation paths and 43 real quick-run files not newly flagged.
- Reinhard: rounds 1-4 CHANGES, round 5 APPROVE. Remaining MINOR + NIT moved to analysis follow-ups.
- Postmortem: `postmortems/2026-10-15-quick-gate-env-sentences.md`.

## Notes

Owner decision 2026-10-14: autonomous after clarify, report after merge. Triage interview skipped: facts measured above, internal tool bug, no user-facing questions needed.