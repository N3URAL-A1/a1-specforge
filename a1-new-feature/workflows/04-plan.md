# Phase 4 — Plan

**Goal:** Convert the clarified spec into a Wave-Plan (sequenced, parallelizable implementation
units with explicit code-agent assignments and dependencies).

**Sub-agent:** Vincente (`vincente-vibe-optimizer`).

**Status transition:** `clarified` → `planned`.

## Precondition

Spec status is `clarified` and contains zero `[NEEDS CLARIFICATION]` markers. If not, return
to Phase 3.

## Step 1 — Determine wave-plan path

```
plan_path = projects/<project-slug>/plans/<###>-<feature-slug>-wave-plan.md
```

`<###>` is the same sequence number as the spec. If `projects/<slug>/plans/` does not exist,
create it (use Bash with the absolute vault root).

## Step 2 — Spawn Vincente with the Plan brief (model: claude-opus-4-7)

Use the **Agent** tool with `subagent_type: "vincente-vibe-optimizer"` and
`model: "opus"` to spawn Vincente with this brief:

> You are Vincente. The spec is at `<spec-path>` with status `clarified`. Your task:
> build a wave plan and save it under `<plan-path>`.
>
> **Required inputs from the spec:**
> - User Stories (P1/P2/P3) → wave order follows priority.
> - FR-### → distributed across waves; each FR lands in exactly one wave.
> - SC-### → kept for Phase 6; use them only as a fitness check per wave.
> - Dependencies → determine the order.
>
> **Wave plan structure (Markdown with YAML frontmatter):**
>
> ```yaml
> ---
> spec_path: <spec-path>
> spec_id: <###>-<feature-slug>
> project: <project-slug>
> created: YYYY-MM-DD
> waves: <count>
> ---
> ```
>
> Per wave:
>
> ```markdown
> ## Wave N — <short title>
>
> **Goal:** <1 sentence, what works after this wave>
> **Depends on:** Wave M (or "none")
> **Parallelizable:** yes/no (multiple code agents in this wave?)
> **FRs covered:** FR-001, FR-002, …
> **Stories advanced:** US-<###>-1, …
>
> ### Brief for code agents
>
> <Concrete task, file-ownership hints (lib/ vs functions/src/),
> expected test behavior, acceptance reference>
>
> ### Suggested agent(s)
>
> - **<agent-name>** for <concrete sub-task in this wave>
> ```
>
> **Code agent suggestions:**
> - Frontend / Web: Walter
> - Backend / API / Cloud Functions: Bernd or Walter (generic)
> - AI/ML/RAG/LLM: Aik
> - Flutter Mobile: Felix (or project-specific flutter agent)
> - System design / ADRs (needed before a wave?): Alex
>
> You **suggest** the agents; the user dispatches in Phase 5.
>
> **HTTP contract requirement (for each wave combining API + client):**
> When a wave delivers both an API route and a client (React component, fetch call,
> link href), the wave brief must explicitly state:
> - HTTP method: must be identical in the route handler export (`export async function DELETE`)
>   AND in the client fetch call (`method: "DELETE"`) — never leave it implicit.
> - Response shape: which keys does the route return, which does the client read?
>   (e.g. `{ expenses: [...] }` not `{ data: [...] }`)
> - URL pattern: for `<Link href=...>` explicitly state relative vs. absolute paths.
>   Relative hrefs from a list page can double the segment — use `${id}/` not
>   `list/${id}/`.
>
> **Hard rules:**
> - Every FR must land in exactly one wave.
> - No wave without an explicit acceptance reference.
> - If a wave carries > 5 FRs: split into two waves.
> - If the right agent is unclear: suggest with comment `(uncertain: …)`.
>
> When done: report "Wave plan complete: N waves, M FRs distributed, K parallelizable."

## Step 3 — Update spec frontmatter

After Vincente reports completion, link the wave-plan back into the spec:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> planned --wave-plan-path "<plan-path>"
```

Helper sets `wave_plan_path` and appends `phase: plan, completed: <iso>` to `phase_history`.

## Step 4 — Sanity check (structural)

The structural FR↔Wave consistency check has been moved into its own gate
(Phase 4.5). You no longer need to grep FR counts here. Only verify the
human-readable bits that the gate does **not** cover:

- Every Wave has `Suggested agent(s)`.
- Dependencies form a DAG (no cycles, no Wave that depends on a later Wave).

If either fails, ask Vincente to revise before handing off.

## Hand-off to Phase 4.5 (Consistency Gate)

Tell the user:

> "Wave plan ready: N waves, suggested agents per wave included. Running the
> consistency gate against the spec now — it is deterministic and takes no time."

Then load `workflows/04.5-consistency-gate.md`. **Do not skip the gate**, even
if you are confident the plan is correct. The gate is cheap and prevents
late-stage drift.
