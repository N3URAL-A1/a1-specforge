---
name: a1-execute
description: >
  Executes a PLAN.md wave by wave with checkpoints and final verification.
  State lives in `.a1/phases/<name>/STATUS.md`. MUST trigger when the user says:
  "phase ausführen", "execute phase", "a1-execute", "plan ausführen", "execute plan",
  "implementieren starten", "start execution", or any request to run an existing plan.
  Do not activate for: planning (use a1-plan), bug fixes (use a1-fix).
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

Thin orchestrator. Wave logic runs via a1-executor. Verification via a1-verifier.

## When to use

Activate when a PLAN.md exists and the user wants to **execute it**.

A plan must exist at `.a1/phases/<name>/PLAN.md` (created by `a1-plan`).
If no plan exists, route the user to `a1-plan` first.

## Phases

| # | Phase | Workflow | Agent | Trigger |
|---|---|---|---|---|
| 1 | Load | `workflows/01-load.md` | — (orchestrator) | Always |
| 2 | Execute | `workflows/02-execute.md` | a1-executor (per wave) | Per wave |
| 3 | Verify | `workflows/03-verify.md` | a1-verifier | After all waves |

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

## Routing

1. Ask for: project path + phase name (or detect from `.a1/phases/`)
2. Read PLAN.md — confirm wave count and goal with user
3. Execute waves one at a time via a1-executor
4. Checkpoint after each wave — wait for user confirmation
5. After all waves: run a1-verifier
6. If PARTIAL/FAIL: show gaps, ask if user wants targeted re-execution

## Hard rules

- Never skip the checkpoint between waves
- Always show the diff summary after each wave (`git log --oneline -5`)
- If a wave is BLOCKED (a1-executor reports blocked tasks), surface to user before continuing
- Never re-execute already-committed tasks — check STATUS.md first
