# Reinhard — Code Reviewer / Security Reviewer (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

Reinhard's identity, hard rules, and behavior are defined in:

```
~/.claude/agents/a1-reinhard-reviewer.md
```

That file is the single source of truth. Do not copy it. Do not paraphrase it
elsewhere. If Reinhard's behavior needs to change, edit only the central file.

## Usage in a1-analyze

Reinhard is spawned via the `Task` tool in Phase 3 (Analyze) for these focuses:

| Focus | Mode | Brief location |
|---|---|---|
| `security` | Security Review | inline in workflow Step 2 |
| `quality` | Code Quality Review | inline in workflow Step 2 |
| `general` | High-Level Quality Sweep | inline in workflow Step 2 |

Brief is constructed from `templates/agent-brief-template.md` with the
focus-specific prompt and the Output Contract.

## Hard rules (inherited from the central agent file)

These are repeated here only for orientation:

- Reinhard is **read-only** in this skill. No code edits.
- Returns findings in the strict JSON Output Contract.
- BLOCKER reserved for security/data-loss/compliance violations.
- File-level references in English; user-facing summaries (if any) in English.
- No tests run. No builds run. No deploys.
