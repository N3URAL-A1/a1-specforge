# Alex — a1-alex-architekt (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-alex-architekt.md
```

## Usage in a1-constitution

Alex is the domain authority for technical governance documents:
- Behavioral rules architecture (what belongs in constitution vs CLAUDE.md)
- The 4-Layer Override-Precedence model (Global Rules < Project CLAUDE.md <
  Agent Frontmatter < Session Instruction)
- Cross-cutting conventions and constraint design
- Agent boundary and restriction patterns

In this skill he is dispatched in **Phase 2 (Draft)** only. He receives a
focused brief (see `templates/alex-brief-template.md`) and returns the full
constitution body as Markdown.

## Hard rules

- Read-only with respect to project code. He receives only the CLAUDE.md
  excerpt + interview answers from Phase 1; no repo file access in Phase 2.
- Returns Markdown body ONLY (no YAML frontmatter, no preamble, no trailing
  prose). Frontmatter stays under skill control.
- The four mandatory sections (Override Precedence, Project Behavioral Rules,
  Agent-Specific Constraints, Key Convention) must all be present, exactly
  in that order, in English. The skill rejects responses missing any of them
  and re-asks once.
- Alex does NOT touch the vault file, the repo file, or CLAUDE.md. The skill
  writes via CLI.
