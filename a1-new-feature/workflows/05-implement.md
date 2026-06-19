# Phase 5 — Implement

**Goal:** Walk through the Wave-Plan one wave at a time. For each wave, propose the code
agent(s) and brief, wait for user confirmation, then dispatch. Track wave completion.

**Sub-agents:** Code agents per wave (Walter / Bernd / Aik / Felix / Alex / project-specific).
The skill **proposes**; the user **dispatches**.

**Status transition:** `planned` → `implementing` (on first wave start) → stays `implementing`
until Phase 6 closes it.

## Agent Routing

Before suggesting agents per wave, read the target project's CLAUDE.md (or CLAUDE.md in the project root).
Look for an "Agent Workflow" or agent table section. Project-specific agents take precedence over defaults.
Default fallbacks (if no project CLAUDE.md found): Walter (web/backend), Bernd (Cloud Functions), Aik (AI/ML), Felix (Flutter), Alex (architecture).

## Precondition

Spec status is `planned` and frontmatter `wave_plan_path` is set. Wave-plan file exists.

**Consistency Gate must be PASS before Wave 1 starts.** If it hasn't run yet:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs consistency-check <plan-path> <spec-path>
```

Do NOT start Wave 1 if the gate returns FAIL. Orphaned FRs (FRs not mapped to any wave) produced 44% of historical post-deploy bugs — the gate costs 30 seconds and prevents hours of fixes.

## Step 1 — Set status to implementing (first time only)

If status is still `planned`:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> implementing
```

## Step 2 — Read the wave-plan and pick the next wave

Read `<plan-path>`. Identify the next wave whose dependencies are satisfied (all earlier
waves marked complete in the plan, or "none"). If multiple waves are unblocked **and**
marked `Parallelizable: ja`, you may propose them as a parallel batch.

Track wave completion **inline in the wave-plan file** by appending a status line to each
wave heading after dispatch:

```markdown
## Wave N — <title>  ⟶ status: in-progress / done / failed
```

## Step 3 — Propose the agent(s) to the user

For the next wave, present:

> "**Wave N — <Title>**
>
> Goal: <goal>
> FRs: <list>
> Brief: <short summary>
>
> Suggestion: **<agent-name>** for <sub-task>.
>
> Should I dispatch the agent like this, or would you like a different one?"

Wait for user confirmation. Do **not** dispatch automatically.

## Step 4 — Dispatch

Once the user confirms (or names a different agent), spawn the agent via the Task tool with
this brief:

> You are <agent-name>. You are working on Wave N from the wave plan at `<plan-path>`.
> The associated spec is at `<spec-path>` (READ-ONLY for you — no spec changes
> without asking first).
>
> Your task is in the wave brief under `## Wave N`. Implement strictly per the brief.
> If you notice the spec is unstable while building: stop, report back, suggest a
> spec update — the user decides whether to amend the spec (potentially triggering
> Phase 3/Phase 4 rework).
>
> File ownership: <from wave brief>.
> Tests: write or extend the tests that correspond to the FR-### of this wave.
>
> When done: report "Wave N done. <short summary of changes>."

If the wave is parallelizable and the user wants both agents at once, dispatch them in a
**single** assistant turn (parallel Task calls).

## Step 5 — Nach Agent-Meldung: Build + Deploy + Smoke-Test (Pflicht)

When the agent reports "Wave N done", do NOT mark as `done` immediately.
Run these gates first:

**Gate 0 — Verify the agent's self-report (do NOT trust it)**

Code agents routinely report claims that are false: a sidebar/nav entry they say they
added but didn't, "pre-existing" test failures that are actually green with the right env,
a query they call "green" that returns empty at runtime. Before any other gate, spot-check
the agent's concrete claims against reality — cheaply:
- Claimed a file/symbol/route/nav-entry exists → `grep`/Read it, don't assume.
- Claimed tests pass → re-run them yourself with the correct env (DB vars, etc.).
- Claimed a DB-backed surface "works" → run the actual query/endpoint and confirm it
  returns data, not just that it compiles.
- Claimed "pre-existing failure, not mine" → verify it fails on `origin/main` too before believing it.

If a claim doesn't hold, the wave is NOT done — send it back with the specific gap. This
gate has caught real defects (empty dashboards, missing nav, false green) every time it ran.

**Gate 1 — Build**

Run the project-specific build command (in CLAUDE.md, e.g. `npm run build`).
On build failure: wave stays `in-progress`, agent repairs it. No proceeding.

**Gate 2 — Preview-Deploy**

```bash
vercel   # creates preview URL
```

Record the preview URL for Gate 3 and for Phase 6. Never skip, even for "just a small fix".

**Gate 3 — Smoke test: FR-ACs + wave goal**

The wave brief lists `**FRs covered:**` with one AC sentence per FR. Gate 3 checks **each FR-AC**, not just the wave goal story.

For each FR-AC in this wave:
- Trigger the described action against the preview URL (manually or via Playwright/curl).
- Confirm the described result is observable.

Additionally check the wave goal story:
- If the wave delivers a new UI route: open it, confirm no 404/500.
- If the wave delivers an API route: send a real request, check response body and HTTP status.
- If the wave combines client + API: run through the complete user flow once.

If an FR-AC sentence is vague ("AC: works correctly"): flag it, ask the user to clarify, do not mark Gate 3 green.

On smoke test failure: wave is `failed`, not `done`. Continue with the failure flow below.

**Only after all gates are green:**

Update the wave heading in the wave-plan file: `⟶ status: done`.
Loop to Step 2 for the next wave.

---

If a wave fails (agent reports blockers, tests stay red, smoke test fails):

1. Mark the wave `⟶ status: failed`.
2. Ask user: "Wave N failed — should we adjust the brief, or open the spec
   (back to Phase 3)?"
3. Do not advance the spec status.

## Step 5b — E2E test before last wave approval (required)

When all waves except the current one are `done` (i.e. this is the last wave):

Before transitioning to Phase 6, spawn the project-specific QA agent (from CLAUDE.md
agents table) or a Playwright-capable agent with this brief:

> "Write a Playwright test for the golden path of the spec at `<spec-path>`.
> The test should cover the complete happy path of the P1 user stories:
> <P1-stories from spec, 3–5 steps per story>.
> Run against the preview URL `<preview-url>` (auth state if needed from `.playwright/`).
> The test must be green before Phase 6 can start.
> Place the test at `tests/e2e/<feature-slug>.spec.ts`."

Phase 6 only starts when this E2E test is green.
If Playwright is not available: document this explicitly and escalate to the user.

## Step 6 — All waves done?

When every wave in the plan is marked `done`:

- Tell the user: "All waves complete. Start Phase 6 (Verify)?"
- On yes: load `workflows/06-verify.md`. Status stays `implementing` until Verify passes.
- Do **not** set status to `done` here — that is Phase 6's job.

## Spec-drift guard

If at any point during a wave the user requests a change to the spec (new FR, changed AC):

1. Stop the current wave dispatch.
2. Run `update-status <spec-path> draft` to reopen the spec.
3. Return to Phase 2 or Phase 3 as appropriate.
4. After the spec is `clarified` again, re-evaluate the wave-plan with Vincente.

This is friction by design — silent spec drift is the most common cause of broken Phase 6
verifies.
