---
type: quick-run
kind: feature|fix
slug: <slug>
project: <project-slug>
created: <YYYY-MM-DD>
result: in-progress|completed|escalated
escalated: false
branch: quick/<slug>
files: []
diff_lines: 0
verify: pending
retro: <one-line retro, filled at close>
---

# Quick Run — <slug>

> Kind: `feature|fix` · Project: `<project-slug>` · Result: `in-progress`

## Spec-lite

**Intent** (1–2 sentences): <what this run does and why>

**Acceptance Checks** (1–3):
1. <AC 1>
2. <AC 2 — optional>
3. <AC 3 — optional>

**Expected files**:
- <path/to/file-1>
- <path/to/file-2 — optional, max 2 total per eligibility>

## Verify

**Tests/build run**: <command(s) used, discovered from target CLAUDE.md / package manifest>
**Result**: <pass|fail summary>

**Acceptance Checks — checked once each**:
1. <AC 1> — <pass/fail + one-line evidence>
2. <AC 2> — <pass/fail + one-line evidence, if present>
3. <AC 3> — <pass/fail + one-line evidence, if present>

**5-point self-review**:
- [ ] Immutability — no in-place mutation of existing objects
- [ ] Error handling — errors handled explicitly, not swallowed
- [ ] Input validation — validated at system boundaries where applicable
- [ ] No hardcoded secrets
- [ ] No scope creep — change matches the stated intent and expected files exactly

## Checkpoint

Diff and verify result presented to the user for confirmation **before** commit.
Confirmation: <yes/no + timestamp>

## Outcome

**Result**: `completed` | `escalated`
**Commit**: <short-hash, if completed>

<!-- If escalated (Wave 3), a `handoff_seed:` block and kind-specific handoff note go here. -->
