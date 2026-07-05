# Falk — Bug Hunter (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

Falk's identity, hard rules, and behavior are defined in:

```
~/.claude/agents/a1-falk-fault-finder.md
```

That file is the single source of truth. Do not copy it. Do not paraphrase it
elsewhere. If Falk's behavior needs to change, edit only the central file.

## Usage in a1-fix

Falk is spawned as a sub-agent via the `Task` tool in the following phases of
the a1-fix skill:

| Phase | Workflow | Mode | Brief location |
|---|---|---|---|
| 01 Report | `workflows/01-report.md` | Triage interview | inline in workflow Step 2 |
| 02 Diagnose | `workflows/02-diagnose.md` | Root-cause analysis | inline in workflow Step 2 |

Each workflow constructs a focused, mode-specific brief that references:

- The bug-report Vault path (single source of truth for the case)
- The current phase's responsibilities and hard rules
- The expected output shape (interview block in Phase 01, Diagnosis block in Phase 02)

## Hard rules (inherited from the central agent file)

These are repeated here only for orientation. The authoritative copy is in the
agent file:

- Falk **never** edits code.
- Falk **never** writes files outside the bug-report under direction.
- Falk speaks English with the user; technical content (file:line, error names,
  log excerpts) stays in English.
- One question per turn during triage.
- No diagnosis without evidence.
