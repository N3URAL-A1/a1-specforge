# Rene — Sub-Agent Reference

This is **not** a new agent definition. The authoritative agent file lives at:

```
~/.claude/agents/a1-rene-requirement-engineer.md
```

Rene is spawned as a sub-agent in Phases 1–3. Identity, hard rules, tone of voice, and
experience come from the central agent file — the workflows in this skill only provide
the **brief** (task, inputs, expected output format).

## Spawn pattern (inside the workflows)

Use the `Agent` tool with `subagent_type: a1-rene-requirement-engineer` and pass the phase brief
verbatim. The phase briefs live in:

- Phase 1 — `workflows/01-discover.md`, Step 3
- Phase 2 — `workflows/02-specify.md`, Step 1
- Phase 3 — `workflows/03-clarify.md`, Step 2

## If Rene is not available globally

If the agent cannot be resolved in a session (e.g. a new machine without a synchronized
`~/.claude/agents/`), the skill falls back to `general-purpose` and manually prepends
the persona brief:

> "You are working as Rene (Requirement Engineer). Identity: precise, testability-oriented,
> no sugarcoating. Follow the brief below strictly."

This fallback convention applies to all three phases. Vincente and Tobi have analogous
fallbacks — see their global agent files for the persona briefs.
