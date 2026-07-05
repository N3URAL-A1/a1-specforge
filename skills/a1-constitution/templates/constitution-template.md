# Constitution for <PROJECT_SLUG>

> This is the per-project behavioral-rules artifact. It complements `CLAUDE.md`
> (which holds data + context). Conflict resolution: for **behavior**,
> constitution.md wins; for **project facts**, CLAUDE.md wins.

## Override Precedence (4 Layers)

When two rules conflict, the higher layer wins. From lowest to highest:

1. **Global Rules** — `~/.claude/rules/common/*.md`. Apply to every project.
2. **Project CLAUDE.md** — `<repo-root>/CLAUDE.md`. Project-specific facts +
   project-level rules. Overrides Global Rules for this project only.
3. **Agent Frontmatter** — YAML at the top of `~/.claude/agents/<agent>.md` (or
   project-local `.claude/agents/`). An agent's own constraints override
   project-level rules for that agent's scope of work.
4. **Session Instruction** — User instructions in the current conversation
   (including the system reminder block, plan-mode directives, ad-hoc commands).
   Highest priority. A session instruction overrides everything below it for
   the duration of the session.

### Examples

| Conflict | Winner | Reasoning |
|---|---|---|
| Global says "create new commits, don't amend"; session says "amend the last commit" | Session | Layer 4 > Layer 1 |
| Project CLAUDE.md says "use pnpm"; an agent's frontmatter says "use npm" | Agent | Layer 3 > Layer 2 |
| Two global rules conflict | (impossible in practice — file later in `~/.claude/rules/common/` wins lexically) | — |

## Project Behavioral Rules

> Project-specific rules that are NOT covered by global rules. These extend or
> tighten the global baseline.

<filled by Alex from interview Q1>

## Agent-Specific Constraints

> Restrictions or scope-limits that apply to specific agents when working on
> this project. Leave empty (or "None.") if there are no agent-level overrides.

<filled by Alex from interview Q2; may be "None."  if user provided no input>

## Key Convention

> The one thing a new agent must know in 30 seconds before touching code.

<filled by Alex from interview Q3>

## Notes

<optional, may stay empty>
