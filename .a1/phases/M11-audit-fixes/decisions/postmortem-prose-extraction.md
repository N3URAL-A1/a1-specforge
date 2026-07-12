---
topic: extract postmortem prose from agent prompts
task: 7.3
status: decided
decision: (a) lessons file + one-line principles — executed M12 Wave 3 (pilot Pablo)
decided: 2026-07-12 (Robert delegated via "setze die angesprochenen Punkte um")
executed: _shared/agent-lessons.md created; Pablo paragraph compressed per the doc's example diff; a1-evolve 04-apply.md append-target HARD RULE added. Repo-wide sweep deferred until the pilot proves out (per the doc's own risk note).
created: 2026-07-12
---

# Decision: extract accumulating postmortem prose out of agent prompt bodies

## Problem

`a1-evolve` applies learnings by appending dated, narrative postmortem
paragraphs directly into agent prompt files. Over time this makes agent
prompts grow unboundedly and mixes two different kinds of content in one
file: (1) the agent's stable operating principles, and (2) a growing log of
specific incidents that motivated a specific rule.

## Live inventory (verified 2026-07-12 — corrects the plan's basis text)

The plan's basis paragraph names "Pablo 3.5-3.7, Erik 3c-ter/3c-quater" as
the evidence. Live grep found a **different actual shape** for each agent —
noted here so the decision doc reflects what's really in the files, not the
plan's shorthand:

- **Pablo** (`agents/a1-pablo-planner.md`): no numbered "3.5-3.7" subsections
  exist. What exists is a single inline sentence inside Step 3
  ("Goal-backward decomposition") carrying a dated citation:
  > "Direct DB call via `withTenantContext`, **NEVER an HTTP self-call to
  > your own API routes**. Self-calls hide failures behind silent fallbacks
  > (e.g. KPI cards showing 0) and cause cold-start cascades. Multi-query
  > server components get one `withTenantContext` call per query, each with
  > its own `.catch()`. (Pattern from 4 postmortems: a1-evolve 2026-06-08.)"

  This is one paragraph, not three — but it's exactly the pattern the task
  describes: a specific, dated, evidence-cited rule embedded inline in a
  step that's otherwise generic decomposition guidance. It's a good
  candidate for extraction precisely because a future reader of Pablo's
  prompt has to read a Next.js/tenant-isolation-specific incident story to
  understand a step that's supposed to be stack-agnostic.

- **Erik** (`agents/a1-erik-executor.md`): confirmed 2 sections matching the
  plan's naming — `### 3c-ter. Serverless backend tasks — request-scoped
  state (mandatory)` and `### 3c-quater. Code-move/refactor tasks —
  dangling-reference sweep (mandatory)`. Both read as standalone mandatory
  sub-procedures (not narrative postmortem prose citing a specific incident
  the way Pablo's paragraph does) — they're closer to "rules" than "war
  stories," but the plan's evidence is directionally correct: the
  `3c-obs`/`3c-bis`/`3c-ter`/`3c-quater` lettering itself is a symptom of
  ad-hoc appending (four insertions bolted onto one step number rather than
  restructured as their own numbered steps).

- **Victor** (`agents/a1-victor-verifier.md`): grep for dated/postmortem
  markers returned **zero hits**. The plan's basis text doesn't name Victor
  as a postmortem-accumulation site — confirmed correctly out of scope for
  this specific task (Victor's other issue, hardcoded paths, was Task 4.2,
  already fixed).

## Options

**(a) Move recurring-lesson prose into referenced workflow/reference files;
agent prompts keep one-line principles.** Concretely: create
`agents/reference/lessons/<agent-slug>.md` (or a shared
`_shared/agent-lessons.md` with per-agent sections) holding the full
narrative + citation; the agent prompt keeps a single compressed imperative
sentence plus a pointer, e.g. Pablo's paragraph becomes:

> "Direct DB call via `withTenantContext`, never an HTTP self-call to your
> own API routes (see `_shared/agent-lessons.md#pablo` for why)."

Also define the a1-evolve rule going forward: **append to the reference
file, not the prompt.** The prompt only gets a new one-line principle if the
lesson introduces a genuinely new rule category not already covered by an
existing principle; if it's reinforcing/refining an existing rule, only the
reference file grows.

- **Effort:** low for the extraction itself (mechanical: move prose, leave a
  pointer). Medium for defining and documenting the new a1-evolve
  append-target rule so it's actually followed going forward (needs an edit
  to `a1-evolve`'s own Apply-phase workflow, `workflows/04-apply.md`, which
  currently appends directly to agent files).
- **Risk:** low. Pure content move; no behavior change to what the agent
  does, only where the "why" lives. Slight risk that compressing "why" into
  a pointer reduces the rule's persuasive weight for the LLM reading the
  prompt at inference time (a citation with a concrete failure mode, like
  "KPI cards showing 0," may be more effective at preventing recurrence than
  an abstract imperative) — worth testing on one agent before a repo-wide
  sweep.
- **Benefit:** bounds prompt growth going forward; separates stable
  operating principles from an append-only incident log, which is more
  honest about what each file is for and easier for a1-evolve to manage
  (a reference file can be pruned/reorganized without touching the
  "identity" prompt).

**(b) Leave as-is; accept unbounded prompt growth as the cost of a
concrete, evidence-backed rule.** No structural change.

- **Effort:** none.
- **Risk:** none immediately; compounds over time as more postmortems land
  (a1-evolve's stated cadence is "periodic synthesis, ~every 5 runs" per the
  global framework rules — this is not a one-time cost).
- **Benefit:** keeps the persuasive concrete-incident framing in the
  prompt itself, which may matter more for LLM compliance than file
  organization tidiness.

## Recommendation

**(a).** Prompt bloat is a real, measured cost (token overhead on every
agent invocation, discoverability cost for humans reading the prompt to
understand "what does this agent do" vs. "what incidents shaped this
agent"), and it compounds every ~5 runs per a1-evolve's own synthesis
cadence. The reference-file split can preserve the concrete citation
("KPI cards showing 0") in the linked file rather than deleting it, so (a)'s
persuasiveness risk is mitigable by keeping the citation, just moved.

## Example diff — Pablo (Task 7.3's required one-agent example)

**Before** (`agents/a1-pablo-planner.md`, inside Step 3):
```markdown
5. **How is data ACCESSED** in Server Components / Middleware? → Direct DB call via `withTenantContext`, **NEVER an HTTP self-call to your own API routes**. Self-calls hide failures behind silent fallbacks (e.g. KPI cards showing 0) and cause cold-start cascades. Multi-query server components get one `withTenantContext` call per query, each with its own `.catch()`. (Pattern from 4 postmortems: a1-evolve 2026-06-08.)
```

**After** (`agents/a1-pablo-planner.md`):
```markdown
5. **How is data ACCESSED** in Server Components / Middleware? → Direct DB call via `withTenantContext`, **never** an HTTP self-call to your own API routes. One `withTenantContext` call per query in multi-query components, each with its own `.catch()`. Why this matters: `_shared/agent-lessons.md#pablo-tenant-context`.
```

**New file** (`_shared/agent-lessons.md`, new section):
```markdown
## Pablo — tenant-context self-calls

Added 2026-06-08 (pattern from 4 postmortems, via a1-evolve synthesis).

Self-calls from a Server Component to your own API routes hide failures
behind silent fallbacks (observed failure mode: KPI cards silently showing
0 instead of surfacing the error) and cause cold-start cascades under load.
Always call the DB layer directly via `withTenantContext`.
```

**a1-evolve Apply-phase rule change** (`skills/a1-evolve/workflows/04-apply.md`):
add a line stating new synthesized lessons are appended to
`_shared/agent-lessons.md#<agent-slug>` by default; a new one-line prompt
principle is only added to the agent file itself when the lesson introduces
a rule category with no existing principle to link from.

## Not done by this task

No files were edited. `_shared/agent-lessons.md` does not exist yet; the
diff above is illustrative, not applied. `workflows/04-apply.md`'s append
behavior is unchanged.
