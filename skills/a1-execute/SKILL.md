---
name: a1-execute
description: >
  Wave-by-wave execution of an existing PLAN.md with mandatory user-checkpoint between waves
  and final goal-backward verification. State lives in `.a1/phases/<name>/STATUS.md`; a
  VERIFICATION.md captures the verdict. MUST trigger when the user says: "execute plan"
  (alias: "plan ausführen"), "execute phase" (alias: "phase ausführen"), "a1-execute",
  "start implementing" (alias: "implementieren starten"), "start execution", "run the plan",
  "execute wave 1", "let's build this phase", "continue with the phase" (alias:
  "weiter mit der phase"), or any request to implement work from an already-created PLAN.md.
  Captures observations.jsonl during execution and writes a Retro to the Obsidian Vault
  after every run. Do NOT activate for: creating a plan (use a1-plan), feature ideation
  from scratch (use a1-new-feature), bug fixes (use a1-fix).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---

# a1-execute — Phase Execution Pipeline

Language: English-first; German trigger aliases supported.

Thin orchestrator. Wave logic runs via a1-erik-executor. Verification via a1-victor-verifier.

## When to use

Activate when a PLAN.md exists and the user wants to **execute it**.

A plan must exist at `.a1/phases/<name>/PLAN.md` (created by `a1-plan`).
If no plan exists, route the user to `a1-plan` first.

## Phases

| # | Phase | Workflow | Agent | Trigger |
|---|---|---|---|---|
| 1 | Load (incl. Roadmap Gate) | `workflows/01-load.md` | — (orchestrator) | Always |
| 2 | Execute | `workflows/02-execute.md` | a1-erik-executor (per wave) | Per wave |
| 3 | Verify | `workflows/03-verify.md` | a1-victor-verifier | After all waves |

## Checkpoint protocol

After each wave:
1. Show wave completion summary (tasks done, deviations)
2. Run `git status` to confirm commits
3. **Pause for user confirmation** before next wave (default behavior)
4. User can say "continue" / "weiter" to proceed or "stop" to halt

This prevents runaway execution — the user stays in control wave by wave.

## State tracking

```
.a1/phases/<name>/
├── PLAN.md        (input — do not modify)
├── STATUS.md      (updated after each task)
└── VERIFICATION.md (created after all waves)
```

## Roadmap Gate (HARD RULE — before any wave execution)

Before Phase 1 does anything else, it runs a deterministic (grep/parse, no
LLM) roadmap-existence check: `.a1/roadmap.md` must exist and parse (see
`workflows/01-load.md` Step 0, and `a1-roadmap` SKILL.md "Feature → Roadmap
Linkage" for the schema). Missing or unparseable → halt, route to
`a1-roadmap`; an existing-but-unparseable file gets an explicit
do-not-overwrite warning and requires user confirmation before handoff.

## Routing

0. **Roadmap Gate first** (`workflows/01-load.md` Step 0) — no wave loads or
   executes until this passes.
1. Ask for: project path + phase name (or detect from `.a1/phases/`)
2. Read PLAN.md — confirm wave count and goal with user
3. Execute waves one at a time via a1-erik-executor
4. Checkpoint after each wave — wait for user confirmation
5. After all waves: run a1-victor-verifier
6. If PARTIAL/FAIL: show gaps, ask if user wants targeted re-execution

## Hard rules

- Never skip the checkpoint between waves
- Always show the diff summary after each wave (`git log --oneline -5`)
- If a wave is BLOCKED (a1-erik-executor reports blocked tasks), surface to user before continuing
- Never re-execute already-committed tasks — check STATUS.md first
