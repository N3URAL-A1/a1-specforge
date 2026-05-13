# Phase 03 — Analyze (parallel sub-agent dispatch)

Goal: get focus-specific findings from specialist sub-agents, in parallel where
independent, with strict Output-Contract. Output: analysis file with
`status: analyzed`, populated `findings[]` and `agents_dispatched[]`.

## Step 1 — Select sub-agents based on focus

Read the focus from frontmatter. Use this mapping:

| Focus | Agents to dispatch (parallel) |
|---|---|
| `general` | codebase-mapper, Reinhard |
| `security` | Reinhard (always), Ludwig (only if compliance/DSGVO mentioned in Scope) |
| `architecture` | Alex |
| `quality` | Reinhard, codebase-mapper |
| `onboarding` | codebase-mapper, Alex, plus stack-specialist: Aik for AI-heavy, Walter for web-heavy, Felix for Flutter |

The stack-specialist for `onboarding` is chosen from the discover `tech_stack`:
- If `tech_stack` contains `flutter`/`dart` → Felix
- If `tech_stack` contains AI/ML markers (langchain, transformers, vector DBs) → Aik
- Otherwise → Walter

## Step 2 — Build briefs from the template

For each selected agent, read `~/.claude/skills/a1-analyze/templates/agent-brief-template.md`
and construct the brief by substituting:

- `<AGENT_NAME>` — the agent name (e.g. `Reinhard`)
- `<FOCUS_HUMAN>` — the focus label (Security / Architecture / Quality / Onboarding / General)
- `<PROJECT_SLUG>`, `<ANALYZED_PATH>` — from frontmatter
- `<TECH_STACK_LIST>`, `<LOC>`, `<FILE_COUNT>`, `<LAST_COMMIT>`, `<BRANCH>`, `<COMMIT_COUNT_30D>` — from `discover[]`
- `<ANALYSIS_PATH>` — absolute analysis file path
- `<FOCUS_SPECIFIC_PROMPT>` — the focus-specific paragraph from the template's table

All four brief sections (Project Context, Focus, Output Contract, Out of Scope)
MUST appear verbatim. No shortening.

## Step 3 — Dispatch in parallel

Use the `Task` tool with multiple invocations in a single turn (one `Task` call
per agent). This gives each sub-agent its own context window.

Example (conceptual — actual call uses the Task tool):

```
Task(subagent_type="general-purpose", description="Reinhard security scan",
     prompt="<the full brief>")
Task(subagent_type="general-purpose", description="Alex architecture review",
     prompt="<the full brief>")
```

For agents that have a dedicated `subagent_type` available (e.g. `codebase-mapper`),
use that type. Otherwise use `general-purpose` and let the brief's first line
identify the agent persona.

## Step 4 — Validate each agent's output

Each agent MUST return a JSON array of finding objects. Parse the response:

1. If the response contains a valid JSON array → continue.
2. If empty array `[]` → record agent dispatch but no findings.
3. If non-JSON / wrong shape → re-dispatch ONCE with a stricter brief reminder:
   "Last response was not a valid JSON array. Please retry with ONLY JSON per
   Output-Contract." If second attempt also fails → record the failure in the
   Notes section, skip this agent's findings.

Each finding object must have: `severity`, `category`, `location`, `description`.
`recommendation` is optional. Reject and re-ask if any required field is missing.

## Step 5 — Append findings to the analysis file

For each valid finding from each agent:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze add-finding \
  "<analysis-path>" \
  <SEVERITY> \
  "<category>" \
  "<location>" \
  "<description>" \
  --recommendation "<recommendation if present>"
```

The helper auto-increments the ID (F-001, F-002, ...) and atomically appends to
the frontmatter `findings[]`.

## Step 6 — Record dispatch metadata

After all agents have completed:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze update-status \
  "<analysis-path>" analyzed \
  --phase-data '{
    "agents_dispatched": [
      {"name": "Reinhard", "focus": "security", "completed_at": "<ISO>"},
      {"name": "Alex", "focus": "architecture", "completed_at": "<ISO>"}
    ]
  }'
```

## Step 7 — Summarize for the user

> "Analyze complete. <n> findings from <m> sub-agents:
>  - Reinhard: <k> findings (security)
>  - Alex: <k> findings (architecture)
>  
>  Should I start Phase 4 (Synthesize — dedup, prioritization)?"

If yes: proceed to `04-synthesize.md`.
If no: stop. Status `analyzed` persists.

## Edge cases

- **All agents return empty:** that is a legitimate result (project is clean).
  Set status to `analyzed`; in Phase 4 the synthesis will reflect this
  ("no findings in this focus").
- **One agent timeout / no response:** record the failure, continue with the
  other agents. Don't block the phase on one slow agent.
- **Agent returns code edits instead of findings:** Output-Contract violation.
  Reject, re-ask once with "You are read-only, no code edits."
- **Sub-agent says "I need more context":** provide an explicit sub-path or
  file list in the re-dispatch. If that doesn't help, leave findings empty,
  add a Notes entry.
