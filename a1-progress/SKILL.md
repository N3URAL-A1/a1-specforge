---
name: a1-progress
description: >
  Check project progress, show what's done/in-progress/blocked, and route to the right next action.
  MUST trigger when the user says: "progress", "status", "was ist der stand", "wie weit sind wir",
  "a1-progress", "what's next", "was kommt als nächstes", "wo stehen wir", "projekt status",
  "show progress", or any request to understand the current state of a project.
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# a1-progress — Project Status & Routing

No sub-agents needed. The orchestrator reads project state directly and presents it.

## When to use

Activate when the user wants to understand **where a project stands** and what to do next.

Works at any level: single phase, full milestone, or overall project.

## What it shows

```
Project: <name>
Branch: <current branch>

Phase: <name> [PLANNING | EXECUTING | VERIFYING | DONE | BLOCKED]

✓ Wave 1 — Foundation (3/3 tasks, committed)
✓ Wave 2 — Core Logic (4/4 tasks, committed)  
→ Wave 3 — Integration (0/3 tasks, ready to execute)
  Wave 4 — Tests (waiting for Wave 3)

Last commit: <message> (<time ago>)
Tests: <passing/total>
Build: <ok/failing>

→ NEXT ACTION: a1-execute (Wave 3 ready)
```

## Routing decisions

| State | Routing |
|---|---|
| No `.a1/` exists | → `a1-roadmap` (start planning) |
| `.a1/phases/*/PLAN.md` exists but no STATUS.md | → `a1-execute` |
| STATUS.md has incomplete waves | → `a1-execute` (resume) |
| All waves done, no VERIFICATION.md | → `a1-execute` (runs verifier) |
| VERIFICATION.md exists with FAIL/PARTIAL | → Show gaps, suggest targeted re-execution |
| VERIFICATION.md PASS | → DONE 🎉 (suggest git tag or deploy) |
| No PLAN.md but goal exists | → `a1-plan` |

## Implementation

1. Detect project root (look for `.a1/`, `CLAUDE.md`, `.git`)
2. Scan `.a1/` structure for phases and their state
3. Read PLAN.md for wave structure
4. Read STATUS.md for completed tasks
5. Run git log for recent commits
6. Run test suite briefly (`npm test -- --passWithNoTests 2>/dev/null | tail -5`)
7. Present status and route
