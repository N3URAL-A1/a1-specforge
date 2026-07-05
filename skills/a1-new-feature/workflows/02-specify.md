# Phase 2 — Specify

**Goal:** Convert the Discovery bullets into a formal Spec-Kit-compatible spec — User Stories
(P1/P2/P3), Functional Requirements (FR-###), Success Criteria (SC-###), Acceptance Scenarios,
Edge Cases, Review Checklist. Mark anything ambiguous with `[NEEDS CLARIFICATION]`.

**Sub-agent:** Rene (`~/.claude/agents/a1-rene-requirement-engineer.md`).

**Status transition:** `discovering` → `draft`.

## Precondition

The spec file exists with status `discovering` and all ten Discovery sections filled. If not,
return to Phase 1.

## Step 1 — Spawn Rene with the Specify brief

Use the **Agent** tool with `subagent_type: "a1-rene-requirement-engineer"` and this brief:

> You are Rene. Phase 1 (Discovery) is complete; the answers are in
> `<spec-path>` under the `## Discovery —` headers. Your task: write a complete
> spec in Spec-Kit format **directly into the same file**, below the discovery sections.
>
> The spec MUST have the following sections (in English — the output is a technical artifact):
>
> 1. **Overview** — 2–4 sentences describing what the feature is and why.
> 2. **User Stories** — organized by priority:
>    - `### P1 (Must-have)` — at least one story.
>    - `### P2 (Should-have)` — optional.
>    - `### P3 (Nice-to-have)` — optional.
>    Each story as `**As a** [role], **I want** [action], **So that** [outcome].`
>    plus story ID `US-<###>-N` (### = spec sequence number from frontmatter).
> 3. **Functional Requirements** — FR-### (zero-padded to 3 digits), each a binary,
>    testable statement. Aim 5–20 FRs.
> 4. **Success Criteria** — SC-### measurable, outcome-oriented (not "code written"
>    but "user can do X in <2s"). Aim 3–8 SCs.
> 5. **Acceptance Scenarios** — at least one Given/When/Then scenario per user story.
>    These become the Verify checklist in Phase 6.
> 6. **Edge Cases** — bullet list of known edge cases from Discovery, plus any more
>    you spot while writing.
> 7. **Out of Scope** — bullet list of what is explicitly NOT included.
> 8. **Dependencies** — other features, APIs, migrations, ADRs.
> 9. **Clarifications** — initially empty; filled in Phase 3.
> 10. **Review Checklist** — standard list:
>     - [ ] All P1 stories have at least one Acceptance Scenario
>     - [ ] All FRs are binary and testable
>     - [ ] All SCs are measurable
>     - [ ] No `[NEEDS CLARIFICATION]` markers remain
>     - [ ] Out of Scope is non-empty (be explicit, not implicit)
>     - [ ] Dependencies are listed or explicitly "none"
>
> **Important rule:** When you are unsure about something while writing (numbers, thresholds,
> business rules, exact error messages), mark the spot inline with
> `[NEEDS CLARIFICATION: <specific question>]`. Do not invent values. Phase 3 (Clarify)
> will resolve the markers.
>
> Do not write over the Discovery sections — they stay as a trail. Append the spec
> sections below them.
>
> When done: report "Spec draft complete, N FRs, N SCs, N open clarifications."

## Step 2 — Status update

After Rene reports completion:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> draft
```

The helper appends `phase: discover, completed: <iso-timestamp>` to `phase_history`.

## Step 3 — Quick sanity scan

Read the spec file. Confirm:

- Every P1 story has at least one Acceptance Scenario.
- FR-### and SC-### are zero-padded and contiguous (FR-001, FR-002, …).
- The Review Checklist is present (boxes unchecked is fine at this stage).

If anything is missing, ask Rene to fix it before proceeding.

## Hand-off to Phase 3

Count `[NEEDS CLARIFICATION]` markers in the file:

```bash
grep -c "\[NEEDS CLARIFICATION" <spec-path>
```

- If **>0**: tell the user "Spec draft ready, N open points. Should I start Phase 3
  (Clarify)?" → `workflows/03-clarify.md`
- If **0**: skip Phase 3, ask "Spec is clean. Proceed directly to Phase 4 (Plan)?" — when confirmed,
  update status to `clarified` and load `workflows/04-plan.md`.
