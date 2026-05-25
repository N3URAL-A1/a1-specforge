# a1-adam-auditor (Sub-Agent Reference)

This is **not** an agent definition. It is a pointer.

## Source of truth

```
~/.claude/agents/a1-adam-auditor.md
```

## Usage in a1-modernize

Spawned in Phase 5 (Plan) after Pablo produces PLAN.md. Adam audits plan
coverage: every BLOCKER finding addressed, every approved proposal in a wave,
no circular dependencies, every wave has a rollback. Returns BLOCKER/MAJOR/MINOR gaps.
