---
name: a1-fix
description: >
  End-to-end bug pipeline: Report → Diagnose → Fix → Verify. State persists in the
  bug-report YAML frontmatter (reported → diagnosed → fixing → fixed). Bug reports live
  under `projects/<slug>/fixes/<YYYY-MM-DD>-<bug-slug>.md` in the Obsidian Vault.
  MUST trigger when the user says: "bug in <X>", "fehler in <X>", "<X> crasht",
  "<feature> funktioniert nicht", "X is broken", "broken since deploy", "regression",
  "crash", "a1-fix", "fix this", "bug-report anlegen", "this used to work",
  "it stopped working", or any request to investigate/diagnose/fix a malfunction in
  shipped functionality. Orchestrates a1-falk-fault-finder (triage + diagnosis) and a
  project code agent (the fix); skill never edits code itself. Writes a Retro to the
  Obsidian Vault after every verified fix. Do NOT activate for: new feature work
  (use a1-new-feature), PR code review without a reported defect (use Reinhard),
  or refactor without a defect.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-fix — Bug Pipeline (Report → Verify)

This skill is a thin orchestrator. The phase logic lives in `workflows/`. The
shared CLI helper (`~/.claude/skills/_shared/a1-tools.cjs`) handles deterministic
file ops (suffix calculation, status updates, listing, duplicate-search). Sub-agents
do the actual thinking.

## When to use

Activate when the user reports a malfunction, crash, regression, or any defect in
shipped functionality. If the user wants to add new functionality, use
`a1-new-feature`. If they want a code review without a reported defect, use Reinhard.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 1 | Report | `workflows/01-report.md` | reported |
| 2 | Diagnose | `workflows/02-diagnose.md` | diagnosed |
| 3 | Fix (incl. Scope-Clarify Gate) | `workflows/03-fix.md` | fixing → (fix_commit set, awaits verify) |
| 4 | Verify | `workflows/04-verify.md` | fixed (or back to Phase 2) |

> **Scope-Clarify Gate (Phase 3, Step 1.5):** For any fix that touches UI (columns,
> buttons, forms, layouts), ask up to 3 targeted scope questions **before** dispatching
> the code agent. Model: `claude-opus-4-7`. Skip for pure logic/crash bugs.

Terminal non-fix statuses: `cant-reproduce`, `wont-fix`, `duplicate`, `cancelled`.
Bugs in these states stay on disk; they are NOT deleted. The date+suffix slot is
not recycled.

## Routing — pick the right phase

1. If the user provides a bug-report path: read frontmatter `status`.
2. If no bug-report exists yet: start Phase 1 (Report) — Falk runs triage, the
   skill creates the bug file from the template with status `reported`.
3. Otherwise route by status:
   - `reported` → Phase 2 (Diagnose) via Falk
   - `diagnosed` → Phase 3 (Fix) — propose code agent, user dispatches
   - `fixing` → Phase 4 (Verify) once fix_commit is set
   - `fixed` → no work; ask if a follow-up regression run is needed
   - `cant-reproduce`, `wont-fix`, `duplicate`, `cancelled` → no work; confirm and stop

## State mechanics

State is persisted in the bug-report frontmatter. Update it via the shared CLI
helper, never with raw string-replace on the file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "projects/<slug>/fixes/<YYYY-MM-DD>-<bug-slug>.md" <new-status> [flags]
```

Flags: `--recommended-code-agent <name>`, `--fix-commit <hash>`,
`--verify-result <text>`, `--duplicate-of <path>`.

The helper performs an atomic frontmatter rewrite (read → modify → write-temp →
rename) and appends a `phase_history` entry with the completion timestamp.

## Storage

All artifacts live in the Obsidian Vault:

- Bug reports: `projects/<slug>/fixes/<YYYY-MM-DD>-<bug-slug>.md`

Suffixes `-2`, `-3` are appended for the second, third, ... bug filed on the same
day in the same project. The shared helper `fix next-suffix` returns the next free
slot. Bugs in terminal non-fix states keep their slot.

Default vault root: `~/Documents/Obsidian Vault/` (note the space).
Override via env var `A1_VAULT_ROOT` if testing.

## Agent integration

| Phase | Agent | Source |
|---|---|---|
| 1 Report | Falk | `~/.claude/agents/a1-falk-fault-finder.md` (see `agents/falk-link.md`) |
| 2 Diagnose | Falk | same |
| 3 Fix | Project code agent (Walter / Bernd / Aik / Toni / Felix / Alex) | Read target project's CLAUDE.md → Agent Workflow table. Skill **proposes**; user dispatches. |
| 4 Verify | The skill itself; optionally Quak for QA-regression when severity ≥ MAJOR | — |

Falk is spawned via the `Task` tool with a focused brief. Falk never edits code;
he interviews (Phase 1) and diagnoses (Phase 2) only.

## Hard rules

- Never edit the bug-report frontmatter directly with Edit/Write — always use
  `a1-tools fix update-status`.
- Never skip Phase 1 (Report). Even for "obvious" bugs, the structured triage
  prevents diagnosis on incomplete information.
- Never let Falk fix code. Falk diagnoses, code agents fix.
- Never recycle date+suffix slots. Cancelled / duplicate / wont-fix bugs keep
  their slot.
- If a duplicate is detected in Phase 1: do NOT create a new report; set
  `duplicate_of` on the new entry only if the user insists on a separate
  tracking file, otherwise extend the original.
- User-facing prompts and questions are in **German**. All file content
  (frontmatter, technical notes, file:line references) stays in English.
- One question per turn during Phase 1 triage interview. No wall-of-text.

## Hand-offs (out of scope for this skill)

- New features: `a1-new-feature` skill.
- PR code review: Reinhard.
- QA regression suite design: Quak (spawned from Phase 4 if severity ≥ MAJOR).
- Cross-cutting incident response: project lead (Pablo) + DevOps (Dirk).
