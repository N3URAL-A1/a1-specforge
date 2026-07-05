---
name: a1-fix
description: >
  End-to-end bug pipeline with project-scoped learning loop: Pre-Flight → Report →
  Diagnose → Fix → Verify → Postmortem. State persists in bug-report YAML frontmatter
  (reported → diagnosed → fixing → fixed). Bug reports live under
  `projects/<slug>/fixes/<YYYY-MM-DD>-<bug-slug>.md` in the Obsidian Vault.
  MUST trigger when the user says: "bug in <X>" (alias: "fehler in <X>"),
  "<X> crashes" (alias: "<X> crasht"), "<feature> doesn't work" (alias:
  "<feature> funktioniert nicht"), "X is broken", "broken since deploy", "regression",
  "crash", "a1-fix", "fix this", "create a bug report" (alias: "bug-report anlegen"),
  "this used to work", "it stopped working", or any request to investigate/diagnose/fix
  a malfunction in shipped functionality. Orchestrates a1-falk-fault-finder (triage + diagnosis) and a
  project code agent (the fix). Writes a structured Postmortem to the Obsidian Vault
  after every terminal verdict. Do NOT activate for: new feature work (use
  a1-new-feature), PR code review without a reported defect (use Reinhard), or
  refactor without a defect.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-fix — Bug Pipeline (Pre-Flight → Postmortem)

Language: English-first; German trigger aliases supported.

This skill is a thin orchestrator. The phase logic lives in `workflows/`. The
shared CLI helper (`~/.claude/skills/_shared/a1-tools.cjs`) handles deterministic
file ops. Sub-agents do the actual thinking.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 0 | Pre-Flight | `workflows/00-preflight.md` | — (no file created yet) |
| 1 | Report | `workflows/01-report.md` | reported |
| 2 | Diagnose | `workflows/02-diagnose.md` | diagnosed |
| 3 | Fix (incl. Scope-Clarify Gate) | `workflows/03-fix.md` | fixing → (fix_commit set) |
| 4 | Verify + Postmortem | `workflows/04-verify.md` | fixed (or back to Phase 2) |

**Scope-Clarify Gate (Phase 3, Step 1.5):** For any fix touching UI (columns,
buttons, forms, layouts), ask up to 3 targeted scope questions **before** dispatching
the code agent. Model: the pinned reasoning-tier model. Skip for pure logic/crash bugs.

Terminal non-fix statuses: `cant-reproduce`, `wont-fix`, `duplicate`, `cancelled`.
Bugs in these states stay on disk; slots are NOT recycled.

## Drift-Prevention Architecture

This skill treats two layers differently:

**IMMUTABLE EXECUTOR** (never written by the skill at runtime):
- `agents/*.md` — agent definitions
- `skills/*.md` — skill definitions

**MUTABLE KNOWLEDGE LAYER** (written by the skill, always append-only):
- `wiki/postmortems/<project>/<date>-<bug-slug>.md` — raw learning artifacts
- `wiki/bug-patterns/<project>.md` — pattern proposals section only (append)
- `wiki/lessons/<agent>/_suggestions/<date>-<slug>.md` — candidate lessons

**Robert is THE ONLY writer to `wiki/lessons/<agent>/_active.md`.** The skill
never touches `_active.md` files. Promote-lessons writes suggestions only.

## Pre-Flight (mandatory on every new bug)

Before Phase 1, run `00-preflight.md`. Four checks:

0. **isolation-gate (HARD RULE — runs FIRST)** — before any code is touched, the
   fix MUST run in an isolated git worktree on its own branch. This prevents the
   parallel-session corruption class (two sessions in the same working tree
   overwrite each other's files and push half-finished work to `main`). See
   **Isolation Gate** below. If the gate cannot be satisfied: STOP and ask Robert.
1. **integrity-check** — verifies agents and skills have not drifted from the lock
   file. If mismatch detected: STOP, report to Robert, write nothing.
2. **bug-patterns lookup** — reads `wiki/bug-patterns/<project>.md` and surfaces
   relevant patterns to Falk's context before triage.
3. **postmortem search** — searches `wiki/postmortems/<project>/` for similar bugs.

## Isolation Gate (HARD RULE — before any code change)

Every fix runs in its own git worktree on a fresh branch off `main`. No exceptions
for "it's just a one-liner". The flow:

1. **Create the worktree** (delegate to the `a1-worktree` skill, or inline):
   ```bash
   git -C <repo> fetch origin main
   git -C <repo> worktree add ../a1-worktrees/fix-<bug-slug> -b fix/<bug-slug> origin/main
   ```
   All subsequent edits, builds, and tests happen inside that worktree path —
   never in the primary checkout.
2. **Work the fix** there (Phases 1–4). Build + test must be GREEN in the worktree.
3. **Merge + push** only after GREEN:
   ```bash
   git -C <repo> checkout main && git -C <repo> pull --ff-only origin main
   git -C <repo> merge --no-ff fix/<bug-slug> && git -C <repo> push origin main
   ```
   If `git pull` brings in a broken `main` (build fails for reasons unrelated to
   your fix): STOP, do NOT layer your fix on top, report to Robert.
4. **Tear down** the worktree (`a1-worktree` exit, or `git worktree remove`).

**Never** cherry-pick a commit from a feature branch onto a fresh main branch as a
workaround — that is the anti-pattern this gate exists to eliminate. **Never** push
a build-red `main`. **Never** edit files in the primary checkout while another
session may be using it.

## Routing — pick the right phase

1. If the user provides a bug-report path: read frontmatter `status`.
2. If no bug-report exists yet: run Pre-Flight → Phase 1 (Report).
3. Otherwise route by status:
   - `reported` → Phase 2 (Diagnose) via Falk
   - `diagnosed` → Phase 3 (Fix) — propose code agent, user dispatches
   - `fixing` → Phase 4 (Verify) once fix_commit is set
   - `fixed` → no work; ask if a follow-up regression run is needed
   - `cant-reproduce`, `wont-fix`, `duplicate`, `cancelled` → no work; confirm and stop

## State mechanics

State is persisted in the bug-report frontmatter. Update via the shared CLI:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "projects/<slug>/fixes/<YYYY-MM-DD>-<bug-slug>.md" <new-status> [flags]
```

Flags: `--recommended-code-agent <name>`, `--fix-commit <hash>`,
`--verify-result <text>`, `--duplicate-of <path>`.

## Storage — Write Whitelist (HARD RULE)

The skill may ONLY write to these paths inside the Vault:

| Path | What |
|------|------|
| `projects/<slug>/fixes/<date>-<slug>.md` | Bug reports |
| `wiki/postmortems/<project>/<date>-<slug>.md` | Postmortems |
| `wiki/bug-patterns/<project>.md` | Proposals section only (append) |
| `wiki/lessons/<agent>/_suggestions/<date>-<slug>.md` | Lesson candidates |
| `wiki/_canonical/agents.lock.json` | Lock file (bootstrap only) |
| `wiki/_state/last_promote.json` | Promote state |

**NEVER WRITE:**
- `agents/*.md` (agent definitions)
- Any `skills/*.md` file
- `wiki/lessons/<agent>/_active.md`

## Learning Loop (4 stages)

**Stage 1 — Pre-Flight:** Check integrity + load patterns + search postmortems.

**Stage 2 — Fix Execution:** Normal Phase 1–3.

**Stage 3 — Post-Mortem (hard gate in Phase 4):** After every terminal verdict,
write a structured postmortem via `fix init-postmortem`. Not optional.

**Stage 4 — promote-lessons (auto-trigger):** After Phase 4, count postmortems
since last promote. If ≥5 new postmortems: offer Robert to run promote-lessons.
Promote-lessons reads all postmortems, clusters patterns, writes suggestions to
`wiki/lessons/<agent>/_suggestions/` only. Robert manually promotes to `_active.md`.

## Agent integration

| Phase | Agent | Source |
|---|---|---|
| 0 Pre-Flight | Skill itself (no agent) | — |
| 1 Report | Falk | `~/.claude/agents/a1-falk-fault-finder.md` |
| 2 Diagnose | Falk | same |
| 3 Fix | Project code agent (a1-walter-web-developer / backend-bernd / a1-aik-ai-engineer / felix-flutter-engineer / a1-alex-architekt) | Read target CLAUDE.md |
| 4 Verify | Skill itself; optionally a1-tobi-tester (severity ≥ MAJOR) | — |

Falk is spawned via the `Task` tool. Falk never edits code.

## Hard rules

- **Never touch code outside an isolated worktree on a fix branch.** The Isolation
  Gate runs before everything. Merge to `main` only when build + tests are GREEN.
  Never cherry-pick as a merge workaround. Never push a build-red `main`.
- Never edit bug-report frontmatter with Edit/Write — always use `fix update-status`.
- Never skip Phase 0 (Pre-Flight). If integrity-check fails: STOP immediately.
- Never skip Phase 1 (Report). Structured triage prevents diagnosis on incomplete info.
- Never let Falk fix code. Falk diagnoses; code agents fix.
- Never recycle date+suffix slots.
- Postmortem is a hard gate after every terminal verdict — not optional.
- promote-lessons writes to `_suggestions/` only. Never to `_active.md`.
- User-facing prompts and questions in **German**. File content stays in English.
- One question per turn during Phase 1. No wall-of-text.

## Hand-offs

- New features: `a1-new-feature`.
- PR code review: Reinhard.
- QA regression suite design: a1-tobi-tester (Phase 4, severity ≥ MAJOR).
- Cross-cutting incident response: Pablo + Dirk.
