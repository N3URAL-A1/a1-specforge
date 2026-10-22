---
type: bug-report
project: a1-specforge
bug_slug: scope-reclaim-dir-signal
title: "code-scope re-claim drops the directory signal; trailing /. is not a directory"
status: fixed
severity: minor
reported_at: 2026-10-15T14:10
reporter: "orchestrator (Reinhard, PR #49 review round 5 MINOR + NIT)"
affected_repos:
  - a1-specforge
related_deploy: "9fffcd7 (PR #49, 2026-10-15)"
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-15T12:10:00Z"
  - "phase=diagnose completed=2026-10-15T12:06:19.881Z"
  - "phase=fix-start completed=2026-10-15T12:06:19.937Z"
  - "phase=verify completed=2026-10-15T13:09:46.200Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: ccc9c19
verify_result: "2026-10-15: PASS — re-claim docs/v1.2 then docs/v1.2/ widens (keeps at/stage), **/x then CONFLICT; docs/v1.2/. is a directory; widening re-claim with conflict returns CONFLICT, stored unchanged; hasDirSignal linear (2e5 pairs <200 ms), 4096-char cap; 37/37 suites on snapshot of 7387f89, CI pass, Reinhard APPROVE round 2"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-15-scope-reclaim-dir-signal
---

# Bug: code-scope re-claim drops the directory signal; trailing /. is not a directory signal

## Symptom

1. `code-scope claim --scope docs/v1.2` then `claim --scope docs/v1.2/` (same feature) is idempotent and keeps the stored file-like path `docs/v1.2`; another feature's `claim/check --scope '**/x'` then gets OK. With `docs/v1.2/` stored directly it gets CONFLICT.
2. `claim --scope docs/v1.2/.` is treated as file-like: `**/x` gets OK, although `docs/v1.2/.` names the directory like `docs/v1.2/`.

## Reproduction Steps

In an empty temp git repo, with `env -u A1_VAULT_ROOT node <repo>/_shared/a1-tools.cjs code-scope …` on main 9fffcd7:
1. `claim --by fa --scope docs/v1.2` → OK; `claim --by fa --scope docs/v1.2/` → OK idempotent:true; `check --by fb --scope '**/x'` → OK.
2. Fresh repo: `claim --by fa --scope docs/v1.2/` → `check --by fb --scope '**/x'` → CONFLICT (expected baseline).
3. Fresh repo: `claim --by fa --scope docs/v1.2/.` → `check --by fb --scope '**/x'` → OK.

Expected: (1) and (3) CONFLICT like (2). Actual: OK (measured 2026-10-15, scratchpad repro-reclaim).

## Environment

- macOS, Node ≥ 18; CLI `_shared/a1-tools.cjs`; commit 9fffcd7.

## Frequency

always (only for a file-like last segment, i.e. one with an extension, vs a scope starting with `**`)

## Impact

Parallel-feature scope collision detection misses a conflict in a narrow case; not a forbidden-surface decision (quick uses `matchesGlob`, not the overlap matcher). No real reservation affected today (Reinhard: 286 real paths checked).

## Affected Components

- Repo(s): a1-specforge
- Suspected files: `_shared/lib/segment-glob.cjs` (`scopeKey` ~l.40, `hasDirSignal` ~l.34), `_shared/lib/code-scope.cjs` (claim idempotency ~l.106); tests `_test-fixtures/a1-code-scope/run-tests.sh`.

## Recent Changes

PR #49 (9fffcd7, 2026-10-15) introduced the directory signal (trailing `/`) and `scopeKey` (segments only) for idempotency; both findings are Reinhard's round-5 MINOR + NIT, accepted as follow-up.

## Diagnosis (Phase 02 — filled by Falk)

**Hypothesis:** (1) `hasDirSignal` (segment-glob.cjs:34-36) only sees a trailing `/`; `normalizeScopePath` (:26-31) keeps a trailing `/.`, `scopeSegments` (:69) drops the `.`, so `docs/v1.2/.` reaches `segmentListsOverlap` as file-like without dir signal. (2) Claim idempotency (code-scope.cjs:105-115) compares `scopeKey` (:40-48, segments only) and returns the stored entry unchanged, so the first-claimed form wins; a wider later claim is dropped (order-dependent).
**Evidence:** scratch repo on 9fffcd7: `docs/v1.2` → re-claim `docs/v1.2/` → `**/x` OK; `docs/v1.2/` → CONFLICT; `docs/v1.2/.` and `docs/v1.2/./.` → OK; reverse order keeps `docs/v1.2/` → CONFLICT. Overlap is monotone in the dir signal (l.216-222, 238, 241), so the signal form is fail-safe. Affected callers: code-scope (both), quick.cjs:160 and lane-split.cjs:259/359 (`/.` gap only). Introduced in 9fffcd7. Real reservations: 25 files, 254 paths, 0 ending in `/.`, 0 duplicate keys → no result change.
**Confidence:** high
**Recommended code agent:** a1-walter-web-developer
**Suggested fix approach:** (a) treat trailing `(/\.)+` as dir signal at the shared root (segments unchanged, so `matchesGlob` and xprov parity unaffected). (b) idempotent branch: merge per scopeKey with dir signal = stored OR candidate; unchanged → today's no-write idempotent; widened → run `findScopeOverlaps(merged)` first: conflict → CONFLICT rc 1, stored unchanged; else write `{...existingSame, paths: merged}` (keeps `at`, `stage`, `by`), `idempotent: true, widened: true`. Never fall through to the fresh-claim path. Document in help. Fixtures 1-7 per Falk (RED set 1-3).

**Orchestrator decisions (2026-10-15, owner delegated autonomy):** check-then-widen variant (fail-safe; a widening re-claim may return CONFLICT, documented in help). The lane-split array-argument NIT (`lane-split.cjs:259`) is fixed in the same PR only if it is a one-line change with a test; otherwise follow-up.

## Fix Plan (Phase 03 — filled by code agent)

`hasDirSignal` as a linear right-to-left scan accepting trailing `(/\.)+`; `MAX_PATH_CHARS = 4096` checked in `scopeSegments` (shared entry, fail closed) and imported by quick; `widenStoredPaths` in code-scope claim (check-then-widen, keeps `at`/`stage`/`by`); help text; lane-split.cjs:259 one-liner `scopePathsOverlap(pattern, rel)`. Commits c9bca52, 6e1c99d (ReDoS fix), 7387f89 (fixture reaches the slow path); squash ccc9c19 (PR #50).

## Verification (Phase 04 — filled by skill)

- 2026-10-15: 37/37 fixture suites rc 0 on a `git archive 7387f89` snapshot with `env -u A1_VAULT_ROOT`; owner stores unchanged; verify-install-sync PASS; CI `test` pass (25m26s).
- RED on old code: code-scope 6 + lane-split 1 (c9bca52 base 9fffcd7); timing fixtures on c9bca52 lib: 5822 ms accepted and 64876 ms vs 200 ms bound.
- Parity: quick ⊆ 016 xprov scope (18,285 paths, xprovOnly 0); segments unchanged (200k random pairs); overlap never narrower than base; lane-split identical on 105 real plans; 27 real reservation files (270 paths, max 49 chars) unaffected.
- Reinhard: round 1 CHANGES (ReDoS MAJOR), round 2 APPROVE (fixture MINOR fixed in 7387f89).
- Postmortem: `postmortems/2026-10-15-scope-reclaim-dir-signal.md`.

## Notes

Owner decision 2026-10-14: autonomous, report after merge. Triage interview skipped: facts measured by Reinhard and re-measured above; internal tool bug, no user-facing questions.