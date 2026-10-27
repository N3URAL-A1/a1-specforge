---
type: spec
id: 001-roadmap-gate-parallel-features
project: a1-specforge
feature_slug: roadmap-gate-parallel-features
title: Roadmap Gate + Parallel Feature Lifecycle
status: done
created: 2026-07-10
phase_history:
- phase=discover completed=2026-07-10T10:18:53.394Z
- phase=specify completed=2026-07-10T10:23:24.242Z
- phase=clarify completed=2026-07-10T10:23:24.242Z
- phase=plan completed=2026-07-10T10:28:19.941Z
- phase=implement completed=2026-07-10T11:25:12.677Z
- phase=verify completed=2026-07-10T11:25:12.677Z
wave_plan_path: projects/a1-specforge/plans/001-roadmap-gate-parallel-features-wave-plan.md
verify_failures: []
permalink: vault/project/a1-specforge/spec/001-roadmap-gate-parallel-features
---

# Roadmap Gate + Parallel Feature Lifecycle

> Spec ID: `001-roadmap-gate-parallel-features` · Project: `a1-specforge` · Status: `discovering`

---

## Discovery — Problem

- The a1 skill set does not enforce that a roadmap exists or that work adheres to it; features can be started ad-hoc without roadmap alignment.
- There is no enforced feature lifecycle completion gate: a feature can be left half-done (not reviewed, not verified, not merged, branch not cleaned on origin) while new features are started.
- Parallel features are allowed in practice, but nothing prevents two in-flight features from touching the same code area, causing merge conflicts and the parallel-session corruption class already observed (half-finished pushes, build-red main).
- The roadmap has no visibility of which features are currently in flight in parallel.

## Discovery — Primary User

- Robert (project owner, non-developer) — needs guardrails so autonomous agent sessions cannot drift from the roadmap or collide with each other.
- Secondary: all a1 skills/agents (a1-new-feature, a1-execute, a1-roadmap, a1-progress, a1-worktree) that start or finish feature work.

## Discovery — User Journey

- A feature is requested → the skill first checks that `.a1/roadmap.md` exists (if not, route to a1-roadmap) and that the feature maps to a roadmap item.
- Before implementation starts, a conflict gate checks the declared code scope (files/modules) of the new feature against all in-flight features; overlap → feature is blocked until the overlapping feature is merged.
- Non-overlapping features may run in parallel; the roadmap/status view shows all in-flight features and their lifecycle stage.
- Each feature runs Start → Complete → Review → Verify → Merge → Origin cleanup (delete remote+local branch, remove worktree) before it counts as done — only then does it free its code scope.

## Discovery — Akzeptanzkriterien

- Starting a1-new-feature (or a1-execute) without a roadmap triggers the roadmap gate (hard stop / route to a1-roadmap).
- A feature whose declared code scope overlaps an in-flight feature cannot enter Phase 5 (Implement); the block message names the conflicting feature.
- A feature is only marked `done` after review, verify, merge to main, and origin branch cleanup are all confirmed.
- a1-progress / roadmap view shows parallel in-flight features with their lifecycle stage and code scope.

## Discovery — Erfolgsmetriken

- 0 occurrences of two in-flight features editing the same files (no more parallel-corruption incidents).
- 0 features started without roadmap linkage after rollout.
- 100% of merged features have their origin branch deleted (no stale remote branches).

## Discovery — Out of Scope

- Automatic/semantic conflict detection (git-diff tripwire) — decided: declared scope only (2026-07-10).
- Production deployment steps (Dirk/Dennis) remain out of scope.

## Discovery — Edge Cases

- Feature with unknown/undeclarable code scope (greenfield) — how to declare scope?
- Hotfixes (a1-fix) — decided (2026-07-10): bypass allowed WITH warning; gate names the overlapping in-flight feature so the merge is coordinated.
- Conflict detection — decided (2026-07-10): declared scope (files/directories listed in the wave plan), compared deterministically; no git-diff analysis.
- Abandoned/cancelled in-flight feature must release its scope reservation.
- Stale reservations after crashed sessions.

## Discovery — Compliance

- None (internal tooling).

## Discovery — Dependencies

- Existing `.a1/reservations.json` claim registry in a1-tools (`check reservations`) — natural extension point for code-scope claims.
- a1-worktree skill (isolation), a1-roadmap (roadmap creation), a1-progress (status view).

## Discovery — Priorität

- P1: roadmap gate + conflict gate + lifecycle completion gate.
- P2: roadmap parallel-status visualization.

---

<!--
  Phase 2 (Specify) appends from here downward. Until Phase 2 runs, the sections below are
  placeholders and may be empty.
-->

## Overview

This feature hardens the a1 skill set against two failure modes observed in autonomous multi-agent operation: (1) feature work starting or executing with no roadmap alignment, and (2) parallel in-flight features silently colliding on the same files, causing merge conflicts and build-red main. It introduces three enforcement mechanisms across the shared CLI helper (`skills/_shared/a1-tools.cjs`) and the affected skills (`a1-new-feature`, `a1-execute`, `a1-roadmap`, `a1-progress`, `a1-worktree`, `a1-fix`):

1. **Roadmap gate** — any feature/execution entry point verifies `.a1/roadmap.md` exists and the work maps to a roadmap item before proceeding; missing roadmap routes the user to `a1-roadmap`.
2. **Feature lifecycle completion gate** — a feature is only `done` after Start → Complete → Review → Verify → Merge to main → Origin cleanup (remote+local branch deleted, worktree removed) are all confirmed.
3. **Parallel features with conflict gate** — features declare their code scope (files/directories) in their wave plan; a new feature whose declared scope overlaps an in-flight feature's scope is blocked from entering Implementation until the overlap is merged. Extends the existing `.a1/reservations.json` claim registry (`check reservations` subcommand in a1-tools). `a1-fix` bugfixes may bypass the gate, but must emit a warning naming the overlapping feature. Roadmap/status views (`a1-progress`, `roadmap.md`) display all in-flight parallel features with lifecycle stage and declared code scope.

Conflict comparison is deterministic (declared scope vs. declared scope) — no git-diff or semantic analysis, per the 2026-07-10 scope decision.

## User Stories

### US-001-1 (P1)
**As a** feature-starting a1 skill (a1-new-feature or a1-execute), **I want** to verify a roadmap exists and the feature maps to it before proceeding, **So that** no feature work happens without roadmap alignment.

### US-001-2 (P1)
**As a** developer/agent starting implementation on a new feature, **I want** the system to block me if my declared code scope overlaps an in-flight feature's scope, **So that** two parallel features cannot corrupt the same files.

### US-001-3 (P1)
**As a** project owner (Robert), **I want** a feature to only be marked `done` after review, verify, merge to main, and origin branch/worktree cleanup are all confirmed, **So that** no feature is left half-finished while appearing complete.

### US-001-4 (P2)
**As a** project owner (Robert), **I want** `a1-progress` and `roadmap.md` to show all in-flight parallel features with their lifecycle stage and declared code scope, **So that** I can see at a glance what is running and where conflicts might arise.

### US-001-5 (P2)
**As a** a1-fix agent fixing an urgent bug, **I want** to bypass the conflict gate with an explicit warning naming the overlapping in-flight feature, **So that** urgent fixes are not blocked but the overlap is still visible for coordination.

### US-001-6 (P3)
**As a** feature owner whose feature is abandoned or cancelled, **I want** its code-scope reservation released, **So that** the scope becomes available to other features again.

## Functional Requirements

- **FR-001**: The system MUST check for the existence of `.a1/roadmap.md` at the start of `a1-new-feature` and `a1-execute` before any feature or phase work begins.
- **FR-002**: If `.a1/roadmap.md` does not exist, the system MUST halt the invoking skill and route the user to `a1-roadmap` instead of proceeding.
- **FR-003**: If `.a1/roadmap.md` exists, the system MUST verify the feature/phase being started maps to an entry in the roadmap; if it does not map, the system MUST surface this to the user before continuing.
- **FR-004**: Each feature's wave plan MUST declare its code scope as an explicit list of files and/or directories.
- **FR-005**: Before a feature enters its Implementation phase, the system MUST compare its declared code scope against the declared code scope of every currently in-flight feature via the `.a1/reservations.json` registry.
- **FR-006**: If any overlap is found between the new feature's declared scope and an in-flight feature's declared scope, the system MUST block the new feature from entering Implementation.
- **FR-007**: The block message MUST name the specific overlapping in-flight feature(s) by identifier.
- **FR-008**: A blocked feature MUST become unblocked automatically once the overlapping feature's scope reservation is released (i.e., that feature is merged/completed).
- **FR-009**: `a1-fix` bugfix workflows MUST be permitted to bypass the conflict gate even when their declared scope overlaps an in-flight feature.
- **FR-010**: When `a1-fix` bypasses the conflict gate, the system MUST emit a warning that names the overlapping in-flight feature.
- **FR-011**: A feature MUST NOT be marked `done` until all of the following are confirmed: Complete, Review, Verify, Merge to main, and Origin cleanup.
- **FR-012**: Origin cleanup MUST include deletion of the feature's remote branch, deletion of its local branch, and removal of its worktree (if one was used).
- **FR-013**: The system MUST track each in-flight feature's current lifecycle stage (Start, Complete, Review, Verify, Merge, Origin cleanup, Done) in a queryable state store.
- **FR-014**: `a1-progress` MUST display all in-flight parallel features together with their current lifecycle stage and declared code scope.
- **FR-015**: `.a1/roadmap.md` (or its rendered view) MUST display all in-flight parallel features together with their current lifecycle stage and declared code scope.
- **FR-016**: When a feature is abandoned or cancelled, the system MUST release its code-scope reservation so other features may claim overlapping scope.
- **FR-017**: The conflict gate comparison MUST be a deterministic string/path comparison of declared scopes only — it MUST NOT perform git-diff or other semantic analysis of actual changed files.

## Success Criteria

- **SC-001**: Zero incidents of two in-flight features editing the same declared-scope files after rollout (measured via reservation-overlap blocks triggering as designed, with no bypass-without-warning occurrences).
- **SC-002**: 100% of features started via `a1-new-feature` or `a1-execute` after rollout have a verified roadmap mapping (0 features proceed past the gate without one).
- **SC-003**: 100% of features marked `done` have confirmed Review, Verify, Merge, and Origin cleanup (no `done` feature with a dangling remote/local branch or worktree).
- **SC-004**: `a1-progress` and the roadmap view correctly list 100% of currently in-flight features with stage and scope, verified by cross-checking against `.a1/reservations.json`.
- **SC-005**: 100% of `a1-fix` conflict-gate bypasses emit a warning naming the overlapping feature (0 silent bypasses).

## Acceptance Scenarios

**US-001-1**
- Given no `.a1/roadmap.md` exists in the project, When a user invokes `a1-new-feature`, Then the skill halts and routes the user to `a1-roadmap` instead of proceeding to Discover.
- Given `.a1/roadmap.md` exists but the requested feature has no corresponding roadmap entry, When a user invokes `a1-new-feature`, Then the skill surfaces a roadmap-mismatch notice before continuing.

**US-001-2**
- Given Feature B declares code scope `["src/auth/"]` and Feature A (in-flight) has already reserved `["src/auth/", "src/api/"]`, When Feature B attempts to enter Implementation, Then the system blocks it and names Feature A as the conflicting feature.
- Given Feature C declares code scope `["src/billing/"]` with no overlap against any in-flight feature, When Feature C attempts to enter Implementation, Then the system allows it to proceed and creates its own scope reservation.

**US-001-3**
- Given a feature has completed Verify and Merge but its remote branch still exists, When someone checks its status, Then the feature is NOT marked `done`.
- Given a feature has confirmed Complete, Review, Verify, Merge, and Origin cleanup, When the lifecycle state is evaluated, Then the feature is marked `done` and its scope reservation is released.

**US-001-4**
- Given two features are in-flight in parallel with different declared scopes, When a user runs `a1-progress`, Then both features appear with their current lifecycle stage and declared code scope.

**US-001-5**
- Given Feature A (in-flight) has reserved `["src/payments/"]` and a bug is reported in `src/payments/refund.ts`, When `a1-fix` starts fixing the bug, Then the fix proceeds without being blocked but emits a warning naming Feature A.

**US-001-6**
- Given Feature D is cancelled while holding a scope reservation on `["src/reports/"]`, When the cancellation is processed, Then the reservation for `["src/reports/"]` is released and becomes available to new features.

## Edge Cases

- Greenfield features (no existing files): declare the *target directories they will create* (e.g. `skills/new-skill/`) as scope — no gate exemption (decided 2026-07-10).
- Stale reservations after crashed sessions: no auto-TTL; `a1-progress` flags reservations older than 7 days as "stale" with a hint to the manual release command (decided 2026-07-10).
- Race conditions on reservation writes: atomic write (temp-file + rename), same pattern as `spec update-status` — sufficient for single-user operation (decided 2026-07-10).
- A feature's scope needs to change mid-flight (e.g., discovers it must touch an additional file) — scope amendment is a new reservation claim that is re-checked against all other in-flight features before being accepted.
- Malformed/unparseable `.a1/roadmap.md`: treated like missing (route to a1-roadmap), but with an explicit warning that a file exists and must not be overwritten without confirmation (decided 2026-07-10).

## Out of Scope

- Automatic/semantic conflict detection via git-diff or static analysis of actual changed files — declared scope only (decided 2026-07-10).
- Production deployment steps (owned by Dirk/Dennis) remain untouched by this feature.
- Retroactive enforcement on features already in flight before this feature ships (migration behavior for existing in-flight work is not addressed here).

## Dependencies

- `.a1/reservations.json` claim registry and its `check reservations` subcommand in `_shared/a1-tools.cjs` — extended, not replaced. NOTE (Gate C 2026-07-10): current schema is exact-match scalar claims only; path-list claims + prefix/glob overlap comparison are NEW work.
- NEW elements this feature must build (confirmed absent by Gate C dry-run): (a) lifecycle-stage state store (FR-013) — e.g. `stage` field on reservations.json entries; (b) reservation-release subcommand (FR-008/016); (c) remote-branch deletion in worktree exit / merge flow (FR-012 — today only local branch + worktree are removed); (d) machine-readable feature→roadmap-entry linkage convention (FR-003); (e) `code_scope:` wave-plan frontmatter field + validation; (f) a1-progress read of reservations.json incl. 7-day stale flag; (g) a1-fix bypass warning; (h) roadmap in-flight view.
- `a1-worktree` skill — provides the worktree lifecycle (create/enter/exit) that Origin cleanup must hook into.
- `a1-roadmap` skill — target of the roadmap gate's routing when `.a1/roadmap.md` is missing.
- `a1-progress` skill — surfaces the parallel in-flight feature view.
- Git remote access (for remote branch deletion during Origin cleanup) — assumes the standard a1-skills repo remote conventions already in use.

## Clarifications

- **2026-07-10** — Scope-declaration format: YAML frontmatter field `code_scope:` (list of paths/globs) in the wave plan. Reason: machine-readable for the deterministic CLI gate.
- **2026-07-10** — Greenfield scope: declare the target directories the feature will create; no gate exemption. Reason: keeps the gate universal and deterministic.
- **2026-07-10** — Stale reservations: no auto-TTL; `a1-progress` flags reservations >7 days old as stale with a manual release hint. Reason: auto-expiry could silently unblock a real conflict.
- **2026-07-10** — Reservation write atomicity: temp-file + rename (same as `spec update-status`); no cross-process locking. Reason: single-user operation; simplest safe primitive.
- **2026-07-10** — Malformed roadmap.md: treated like missing (route to a1-roadmap) plus an explicit do-not-overwrite warning. Reason: safe default without destroying user content.

## Review Checklist

- [x] All P1 stories have at least one Acceptance Scenario
- [x] All FRs are binary and testable
- [x] All SCs are measurable
- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Out of Scope is non-empty (be explicit, not implicit)
- [x] Dependencies are listed or explicitly "none"