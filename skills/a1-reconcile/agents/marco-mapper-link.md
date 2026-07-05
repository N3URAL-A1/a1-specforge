# a1-marco-mapper (linked sub-agent)

Used in Phase 3 (Probe) as the primary structural prober. Maps spec-referenced
artifacts to actual repo state.

Definition source: `~/.claude/agents/a1-marco-mapper.md` or an equivalent
codebase exploration agent in your local setup (canonical).

This file is a pointer, not a redefinition. If the agent's behaviour changes,
update the source — not this file.

## How a1-reconcile uses it

- Dispatched via `Task` tool with `subagent_type="a1-marco-mapper"` if
  available, else `subagent_type="general-purpose"` with the persona on line
  1 of the probe brief.
- Brief from `templates/agent-probe-brief.md`.
- Read-only: never modifies repo, spec, or drift report.
- Output Contract: JSON drift array per `templates/agent-probe-brief.md`.
- On non-JSON response: re-asked once. On second failure: skipped with
  `probe_notes[]` entry.
