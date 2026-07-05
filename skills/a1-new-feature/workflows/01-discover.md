# Phase 1 — Discover

**Goal:** Capture the raw feature idea via a structured interview. Produce a `discovering`-status
spec file with bullet-point answers to ten mandatory topics. No formal spec yet.

**Sub-agent:** Rene (`~/.claude/agents/a1-rene-requirement-engineer.md`).

**Status transition:** (none yet) → `discovering`.

## Step 1 — Identify project + feature slug

Ask the user which project this feature belongs to and a short kebab-case slug
for the feature. Example: project `my-project`, slug `meal-swap-history`.

If the project has no `projects/<slug>/spec/` directory yet, create it via the helper before
the next step.

## Step 2 — Create spec file from template

```bash
# Get next sequence number for the project
node ~/.claude/skills/_shared/a1-tools.cjs spec next-number <project-slug>
```

Then `Read` the template `~/.claude/skills/a1-new-feature/templates/spec-template.md`, fill in:

- `id`: `<###>-<feature-slug>` (use the number returned by the helper)
- `project`: `<project-slug>`
- `feature_slug`: `<feature-slug>`
- `status: discovering`
- `created`: today's date (YYYY-MM-DD)
- Title: working title from the user

Write to `projects/<project-slug>/spec/<###>-<feature-slug>.md` (relative to vault root).

## Step 3 — Spawn Rene with the Discovery brief

Use the **Agent** tool with `subagent_type: "a1-rene-requirement-engineer"` and this brief:

> You are Rene conducting the discovery for a new feature idea. Your task: run a
> structured interview, **one question per turn**. You must cover the following
> ten required topics in this order:
>
> 1. Problem — What is the problem being solved?
> 2. Primary User — Who is the main persona that benefits?
> 3. User Journey — What does the ideal flow look like?
> 4. Acceptance Criteria — How does the user know it works?
> 5. Success Metrics — How do we measure success? (quantitative if possible)
> 6. Out of Scope — What is explicitly NOT included?
> 7. Edge Cases — Which special cases must be considered now?
> 8. Compliance — Privacy, legal, industry rules, etc.?
> 9. Dependencies — Does this feature depend on other features, APIs, or data?
> 10. Priority — How urgent? Which user story is P1, which P2/P3?
>
> One question per turn. If the answer is vague, ask a follow-up question before
> moving to the next topic. Keep your language concise and let the user talk.
>
> After each user turn: append the answer as a bullet under the matching
> `## Discovery — <Topic>` header in the spec file. Raw notes are fine for now.
> When all ten topics are done, report "Discovery complete. Ready for Phase 2 (Specify)?"

Rene appends to the spec file directly while the interview runs.

## Step 4 — Confirm completion

When Rene reports "Discovery complete":

1. Verify all ten Discovery sections in the spec have at least one bullet.
2. Ask the user: "Discovery looks like this — does it look right, or is anything important missing?"
3. On confirmation, do **not** advance status yet. Phase 2 (Specify) updates status to `draft`
   when Rene writes the formal spec.

## Hand-off to Phase 2

Tell the user: "Phase 1 complete. Should I have Rene write the formal spec now (Phase 2)?"

If yes: load `workflows/02-specify.md`.
If the user wants to abandon the idea: run
`a1-tools spec update-status <spec-path> cancelled`.
