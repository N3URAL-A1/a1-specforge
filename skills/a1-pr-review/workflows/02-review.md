# Phase 2 — Review (a1-reinhard-reviewer sub-agent)

Goal: run a structured code review via `a1-reinhard-reviewer`. Output:
`<worktree>/.a1-review/findings.json` with BLOCKER / MAJOR / MINOR
arrays.

## Inputs (from Phase 1)

- `repo_root` (the main checkout, NOT the worktree)
- `worktree_path` (the isolated checkout a1-reinhard-reviewer reads)
- `branch` (the feature branch)
- `phase_history` (last entry, used as scope hint)

## Steps

### 2.1 Compute diff range

Determine the base branch (default `main`; allow override if registry
entry has `base`). Then:

```bash
git -C "<worktree_path>" rev-parse --abbrev-ref HEAD
git -C "<worktree_path>" log --oneline main..HEAD
git -C "<worktree_path>" diff --stat main...HEAD
```

If `main..HEAD` is empty: BLOCKER, no commits to review. Abort.

### 2.2 Spawn a1-reinhard-reviewer via Task tool

Use the `Task` tool with `subagent_type: "a1-reinhard-reviewer"`. The brief MUST
include:

```
Worktree path: <worktree_path>
Branch: <branch>
Diff range: main...HEAD (run from worktree_path)
Last phase note: <last phase_history entry, if any>

Deliverable: review findings ONLY as a single JSON block at the end of
your response, fenced with ```json. Schema:

{
  "summary": "<one-paragraph English summary>",
  "blocker": [{"file": "...", "line": 42, "title": "...", "detail": "..."}],
  "major":   [{"file": "...", "line": 42, "title": "...", "detail": "..."}],
  "minor":   [{"file": "...", "line": 42, "title": "...", "detail": "..."}]
}

Focus areas: security, immutability, multi-tenant correctness, error
handling, input validation. Use the project's CLAUDE.md and rules as the
review baseline.
```

Wait for a1-reinhard-reviewer's response.

### 2.3 Extract JSON block

Parse the fenced ```json block from a1-reinhard-reviewer's response. If parsing
fails, tell the user and re-prompt a1-reinhard-reviewer with a stricter
"JSON only, no prose" directive (max one retry).

### 2.4 Persist findings

Write the parsed JSON to `<worktree_path>/.a1-review/findings.json`
(atomic: write to `.tmp`, then `mv`).

### 2.5 Update registry status

```bash
node ~/.claude/skills/_shared/a1-tools.cjs pr mark-status <id> reviewed
```

### 2.6 Report to user

Show counts: "Reinhard reviewed: X BLOCKER, Y MAJOR, Z MINOR." Then:

- If BLOCKER count > 0: list each BLOCKER (title + file:line). Ask
  the user explicitly:
  > "There are BLOCKERs. Draft the PR anyway (Phase 3), or fix them
  > in the worktree first?"

  - Answer "anyway" / "continue" → Phase 3.
  - Answer "fix first" / "stop" → exit skill. User edits worktree, re-
    runs Phase 2 later.

- If only MAJOR/MINOR or zero findings: proceed to Phase 3 automatically.

## Failure modes

- Reinhard returns no JSON → one retry, then escalate to user.
- Reinhard times out → tell user, do not change registry status.
- Empty diff → BLOCKER, halt.
