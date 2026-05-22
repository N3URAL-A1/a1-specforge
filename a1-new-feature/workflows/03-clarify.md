# Phase 3 — Clarify

**Goal:** Resolve every blocking `[NEEDS CLARIFICATION]` marker AND proactively surface hidden
scope assumptions that would otherwise cause rework during implementation.

**Sub-agent:** Rene (`~/.claude/agents/a1-rene-requirement-engineer.md`).
**Model: `claude-opus-4-7`** — Clarify is the highest-leverage phase: wrong decisions here
cascade into multiple fix cycles. Use Opus for deeper reasoning.

**Status transition:** `draft` → `clarified`.

## Precondition

Spec exists with status `draft`. Run even if no `[NEEDS CLARIFICATION]` markers exist —
the proactive scope scan (Step 1) always runs.

## Step 1 — Enumerate markers + proactive scope scan

```bash
grep -n "\[NEEDS CLARIFICATION" <spec-path>
```

Then read the full spec and identify implicit scope gaps in these categories. Each gap
gets added to the question queue alongside the explicit markers:

| Category | What to look for |
|---|---|
| **UI: elements in/out** | Does the feature touch an existing screen? Which existing columns/buttons/links stay, which go? |
| **Navigation & routing** | How does the user reach the new screen? Where do they go after saving/completing an action? |
| **State after action** | After save/delete/submit — same page, redirect, toast, modal close? |
| **Empty & error states** | What does the user see when there's no data? When an API fails? |
| **Permissions / roles** | All tenant users, owner only, superadmin only? |
| **Mobile vs Desktop** | Does the spec mention responsive behavior? Is mobile parity required? |
| **Out of scope gaps** | Is there anything users will *expect* to work that is not explicitly excluded? |
| **Data / existing records** | Does the feature change existing data? What happens to records created before the feature exists? |
| **Duplicate submit** | What happens if the user submits the same data twice (double-tap, back-and-resubmit, concurrent session)? Is there duplicate detection? If yes: what does the UI show, and what happens when the user confirms "save anyway"? |
| **Navigation context carry** | When navigating from screen A to screen B via a link or button: what context does B need from A (IDs, date range, plan reference)? How is it passed (route param, query param, global state)? What does B show if the context is missing or stale? |

Add any discovered gaps as `[NEEDS CLARIFICATION: <question>]` inline in the spec before
spawning Rene, so Rene has a complete list in one pass.

## Step 2 — Spawn Rene with the Clarify brief (model: claude-opus-4-7)

Use the **Agent** tool with `subagent_type: "a1-rene-requirement-engineer"` and
`model: "opus"` to spawn Rene with this brief:

> You are Rene. The spec at `<spec-path>` has N open `[NEEDS CLARIFICATION]` markers —
> both from the Specify step and freshly identified scope gaps.
> Your task: clarify every marker. **Maximum 2 questions per turn**.
>
> **Approach per marker:**
>
> 1. Read the location including context (story, FR, SC, edge case, scope-gap category).
> 2. Ask the user the concrete question. Where useful, offer 2–3 options with a clear
>    recommendation (1-sentence reasoning). Rule of thumb: if the answer significantly
>    changes the implementation → ask; if there is a sensible default → recommend and just
>    confirm.
> 3. Once the answer is in:
>    - Replace the marker with the concrete value/decision.
>    - Append under `## Clarifications`:
>      ```
>      - **YYYY-MM-DD** — <Category>: <Decision>. Reason: <1-sentence>.
>      ```
> 4. Next marker.
>
> **Scope-gap questions** (category tags in the markers): additionally prioritize by
> rework risk. A wrong assumption about "Navigation after save" costs 2 fixes; a wrong
> default for "Mobile" costs 0 if we build desktop-first. Prioritize accordingly.
>
> **Hard rules:**
> - Never overwrite markers without asking.
> - If a new ambiguity emerges while clarifying: immediately add it as a marker and
>   resolve it in this session — no deferring.
> - If the user says "just do it": document the chosen default as a Clarification entry
>   with "Default adopted:" and close the marker.
> - Phase 3 ends only when ALL markers are gone (0 remaining).
>
> When done: report "Clarify complete. N clarifications saved. Spec is
> implementation-ready." and briefly list the decisions.

## Step 2b — UX Mockups (frontend features only)

**Skip this step if** the feature has no user-facing UI (pure API, background job, migration, etc.).

**Trigger:** feature spec mentions screens, pages, components, modals, forms, tables, or UI state changes.

### 2b-1 — Identify screens

Read the (now clarified) spec and list every screen that is **new** or **significantly changed**:

```
Screen 1: <name> — <what it shows / what user does here>
Screen 2: …
```

### 2b-2 — Determine design system skill

Check target project CLAUDE.md. Use the mapping from SKILL.md → `Design-System Skill per Project`.
Fallback if no design system is specified: `frontend-design`.

### 2b-3 — Spawn Uwe

Use the **Agent** tool with `subagent_type: "a1-uwe-ux-expert"` and this brief:

> You are Uwe. We are in Phase 3 (Clarify) of the a1-new-feature flow for the feature
> `<feature-name>`.
>
> **Your task:** Build **at least 2–3 mockup variants** for each of the following screens
> (ASCII wireframe style, clearly labeled) and present them to the user for approval.
>
> **Screens:**
> <list from 2b-1>
>
> **Design system:** Project `<project-name>`. Load the skill `<design-system-skill>` and
> keep all mockups strictly within it: color palette, spacing system, typography, component
> names (buttons, badges, cards, tables, modals) exactly as defined in the design system.
>
> **Approach per screen:**
> 1. Build 2–3 variants (different layouts / interaction patterns — not just cosmetic
>    differences). Each variant gets a name and a 1-sentence rationale.
> 2. Recommend one variant with max. 2 sentences of reasoning.
> 3. Present the variants to the user and ask for a selection or feedback.
> 4. After selection: document the decision as a `UX Decision` (format below).
>
> **UX Decision format:**
> ```
> - **YYYY-MM-DD** — UX/<screen-name>: Variant <X> chosen. Reason: <1-sentence>.
> ```
> Append all UX Decisions under `## Clarifications` in the spec:
> `<spec-path>`
>
> **Hard rules:**
> - Never present a variant that doesn't comply with the design system.
> - If the user says "just do it": take the recommended variant, document as "Default adopted:".
> - If the user brings their own idea: add it as Variant 0 and compare it with the others.
> - If the screen must be responsive: show Desktop + Mobile for each variant.
>
> When all screens are approved: report "UX Mockups approved. N screens, N decisions saved."
> and briefly list the chosen variants.

### 2b-4 — Verify UX decisions written

After Uwe finishes:

```bash
grep -c "UX/" <spec-path>
```

Must return ≥ 1 per screen identified in 2b-1.

## Step 3 — Verify all markers resolved

```bash
grep -c "\[NEEDS CLARIFICATION" <spec-path>
```

Must return `0` before proceeding. If not, repeat Step 2.

## Step 4 — Status update

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> clarified
```

Helper appends `phase: specify, completed: <iso>` and `phase: clarify, completed: <iso>` to
`phase_history` if not already present.

## Hand-off to Phase 4

Tell the user: "Spec is clarified. Should Vincente build the wave plan now (Phase 4)?"

On yes: load `workflows/04-plan.md`.
On hold: stop. The spec sits at status `clarified` and can be picked up later without rework.
