---
type: bug-report
project: a1-specforge
bug_slug: xprov-r30j2-8-approval-refusal
title: "xprov fixture R30j2-8 is red on main (approval refusal under Claude Code)"
status: fixed
severity: minor
reported_at: 2026-10-13T06:37
reporter: robert
affected_repos:
  - a1-specforge
related_deploy: unknown
duplicate_of: null
phase_history:
  - "phase=report completed=2026-10-13T04:37:17.000Z"
  - "phase=verify completed=2026-10-13T08:52:46.113Z"
recommended_code_agent: null
fix_commit: 4bb0861
verify_result: "Part 08 detached: 190 passed, 0 failed; R30j2-8 passes; PR #43 reviewed (approve with nits)"
tags:
  - bug
  - project/a1-specforge
permalink: vault/project/a1-specforge/fixes/2026-10-13-xprov-r30j2-8-approval-refusal
---

# Bug: xprov fixture R30j2-8 is red on main

## Symptom

`_test-fixtures/a1-xprov/run-tests.sh` reports 2160 passed, 1 failed. The failing case is R30j2-8. Because `a1-vault-cockpit` case I1 runs the xprov suite, it fails too (930 passed, 1 failed).

## Reproduction Steps

1. Snapshot of main: `git archive main`, fresh HOME.
2. `bash _test-fixtures/a1-xprov/run-tests.sh`
3. Observed outcome: FAIL R30j2-8 (refused earlier under Claude Code): output lacks 'Nothing written': Type the number of entries (1) to approve this blob: 2

Expected: the approval is refused earlier under Claude Code and the output contains 'Nothing written'.
Actual: the prompt "Type the number of entries (1) to approve this blob" is reached.

## Environment

- Identical result on a clean main snapshot and on the fix branch of #42 (macOS, fresh HOME). Linux not measured. The case was already noted red during Wave 4 of spec 014 (2026-10-08).

## Frequency

always in this environment (not yet checked outside a Claude Code session)

## Impact

One red case in the largest suite; hides new regressions and breaks `a1-vault-cockpit` I1.

## Affected Components

- `_test-fixtures/a1-xprov/` case R30j2-8, the approve guard (`_shared/lib/xprov-approve.cjs`)

## Recent Changes

Spec 014 Wave 4 (secret patterns) and the allowlist guard work.

## Diagnosis (Phase 02 — filled by Falk)

Not yet diagnosed. Open question: does the case depend on the environment (Claude Code marker variables) or is the guard order wrong?