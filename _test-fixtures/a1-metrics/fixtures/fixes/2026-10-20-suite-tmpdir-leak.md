---
type: bug-report
project: a1-specforge
bug_slug: suite-tmpdir-leak
title: "Fixture suites leave mktemp dirs in the macOS user temp dir (~15k per day)"
status: fixed
severity: minor
reported_at: 2026-10-20T19:45
reporter: "orchestrator (owner pain point, session 2026-10-19/20)"
affected_repos:
  - a1-specforge
related_deploy: 26e79c3
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-20T17:45:00.000Z"
  - "phase=diagnose completed=2026-10-20T17:47:03.001Z"
  - "phase=fix-start completed=2026-10-21T06:47:13.018Z"
  - "phase=verify completed=2026-10-21T07:53:38.562Z"
recommended_code_agent: a1-walter-web-developer
fix_commit: 54e6366
verify_result: "CI green incl. cockpit I1 rerun; per-suite macOS leak 0 (was 42/15/14/12/9/9/5/2/1...); a1-xprov docker non-root 4213/0; lint L2 + a1-tmp-hygiene RED-proven"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-20-suite-tmpdir-leak
related_postmortem: project/a1-specforge/postmortems/2026-10-13-worktree-collision-followups.md
---

# Bug: Fixture suites leave mktemp dirs in the macOS user temp dir (~15k per day)

## Symptom

Fixture suites leave `tmp.*` dirs in the macOS user temp dir: 15 238 from the last 24 h, 103 332 in total (2026-10-20 19:40); 143 253 were purged on 2026-10-19 with owner consent. Expected: every suite removes every temp dir it creates, on success and on failure.

## Reproduction Steps

1. On macOS, count `tmp.*` in `$(getconf DARWIN_USER_TEMP_DIR)`.
2. `bash _test-fixtures/a1-glob-liveness/run-tests.sh`.
3. Count again: 42 new dirs.

Expected: 0 new dirs.
Actual: 42 (a1-xprov: ~300 per run).

## Environment

- Browser / OS / Device: macOS 26.5.2, BSD `/usr/bin/mktemp`; Linux CI mostly unaffected
- App version / commit: main 97855fc
- Tenant / user role: n/a
- Network / VPN / region: n/a

## Frequency

always (deterministic)

## Impact

Owner's dev Mac only: disk and inode growth from every agent suite run; periodic manual purges. No functional break.

## Affected Components

- Repo(s): a1-specforge
- Suspected files / routes / services: `_test-fixtures/a1-xprov/run-tests.sh` (make_tree :173, make_phase :219, make_home :250, FAKE_BIN :196, ~55 bare mktemp in `parts/*.sh`); 11 fast suites; `_test-fixtures/CONVENTIONS.md:25` skeleton

## Recent Changes

TMPDIR-redirect isolation in a1-xprov since 26e79c3 (#18, 2026-10-04); spec 016 (#52) added parts 23–32.

## Diagnosis

**Root cause 1 (≈95 %):** macOS `mktemp -d` without a path template uses `_CS_DARWIN_USER_TEMP_DIR` and ignores `$TMPDIR` (man page; probe `TMPDIR=<x> mktemp -d` → `/var/folders/.../T/tmp.*`). a1-xprov sets `TMPDIR="$SUITE_ROOT/tmp"` (`run-tests.sh:61-64`) and its EXIT trap removes only `$SUITE_ROOT`, so every bare mktemp leaks. On GNU the redirect works. Fingerprints of the 15 238 real dirs: make_phase 6156, make_home ~4300, make_tree 2717, `_shared hooks` 620, other phase repos ~700 → a1-xprov ≈ 14 500.

**Root cause 2:** per-case `mktemp -d` without rm/trap in a1-glob-liveness (42/run), a1-code-roots (15), a1-workflow-lint (13), a1-vault-fallback (12), a1-retro-validate (9), a1-lane-split (9), a1-realpath-check (5); single WORK without trap in a1-fix, a1-constitution, a1-learnings, a1-quick, a1-reservations (1 each); named templates without trap in product-schema-v11 (24), product-docs (4), product-audit-mirror (3), product-adopt, product-import, a1-code-scope (1 each). `CONVENTIONS.md:25` teaches the unguarded, trap-less pattern.

**Amplifier:** `a1-vault-cockpit/parts/04c-suite-isolation.sh:47-71` reruns every suite (xprov included).

**Node code:** `_shared/lib/xprov-*.cjs` mkdtempSync sites honor TMPDIR and clean up; not a `tmp.*` source.

Confidence: high (code path + man page + probe + per-suite measurement + real-dir fingerprints). Measurements: Falk, 2026-10-20, git-archive snapshot of 97855fc.

**Fix shape:** new `_test-fixtures/lib/tmp.sh` with `mk_workdir <label>`: explicit template `"${TMPDIR:-/tmp}"/a1-fx-<label>.XXXXXX` (portable GNU/BSD), guarded per the 2026-10-13 postmortem (`|| exit`, non-empty, is-dir, realpath), registry array + one EXIT trap (chmod u+w then rm). Migrate a1-xprov first, then the leaking fast suites and the CONVENTIONS skeleton.

**Regression guards:** (1) lint arm: forbid bare `mktemp`/`mktemp -d`/`mktemp -t` without a path template in `_test-fixtures/**/*.sh` (catches the macOS class on Linux CI); (2) runtime arm: run a suite with an empty private TMPDIR and assert it is empty afterwards.