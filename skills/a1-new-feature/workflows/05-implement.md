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

## Precondition 2 — Scope Claim Gate (before Wave 1, every time)

Before Wave 1 starts (and before any code is touched), claim the feature's
declared `code_scope` (from the wave-plan frontmatter) so parallel features
can't silently collide. The wave-plan's `code_scope:` is a YAML list — join
its entries with commas (no spaces) to build the `--scope` CSV value:

```bash
# code_scope:
#   - app/api/widgets/
#   - components/widgets/
# → --scope "app/api/widgets/,components/widgets/"
node ~/.claude/skills/_shared/a1-tools.cjs code-scope claim \
  --by <spec-id> --scope <code_scope-paths-comma-separated>
```

- Exit 1 (`CONFLICT`) → **do not start Implementation.** Surface the named
  overlapping feature(s) from stderr to the user and ask how to proceed.
- Exit 0 → proceed. Idempotent on re-run (e.g. resuming after a context
  reset) as long as the scope is unchanged.

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

## Step 5 — After the agent reports back: Build + Deploy + Smoke Test (mandatory)

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

**Evidence lines (mandatory — makes skipping visible).** Every spot-check writes ONE evidence
line into STATUS.md, so the gate leaves an auditable artifact instead of relying on discipline:

```
gate0: <claim> → <observed result (route status / file:line / test exit)>
```

Examples:
- `gate0: /dashboard/invoices route → 200`
- `gate0: symbol createInvoice exists → lib/invoices.ts:42`
- `gate0: unit tests pass → exit 0 (14 passed)`

If a check is skipped, record that too — skipping must be visible, not invisible:

```
gate0: SKIPPED <claim> (<reason>)
```

Victor cross-reads these `gate0:` lines in Phase 6, so a skipped or missing check is caught there.

**Gate 0.5 — Surface coverage (every touched field/concept must be wired EVERYWHERE)**

The most expensive bug class is a feature that's built in ONE place but consumed in
several: a new DB field set by one writer but read by none, written via the dashboard
path but not the API/MCP path, saved in a modal but never shown in the detail view.
Symptom: "I can set X but don't see it" / "works from the dashboard but the MCP-created
record is wrong". Cause: the wave touched a field/concept at one surface and the others
silently kept the old behavior.

Before the wave is `done`, for **each new or changed DB column / entity field / domain
concept** in this wave, grep the codebase and confirm it's handled at ALL of these
surfaces (skip the ones that genuinely don't apply, but say so):

- **All write paths** — there is rarely only one. `grep -rn "INSERT INTO <table>\|update<Entity>\|create<Entity>"` across `app/`, `lib/`, `packages/`. A CRM often has 4+ invoice-create paths (web form, "from hours", office-API adapter, MCP). New business logic (bill-through, validation, defaults) must live in EVERY one, ideally via a shared helper, not copy-paste.
- **Read path / JOIN** — if the field lives on a related table, the `SELECT`/JOIN that loads the entity must include it (`SELECT pr.*` is fine; an explicit column list silently drops it).
- **Detail / list render** — a field you can set but not see = half-built. Check the detail component and any table column.
- **API response shape** — new fetch consumers must read the real envelope key (`{ items }` for lists vs `{ data }` for single records — don't guess, grep the route's `return NextResponse.json(...)`).
- **Sync / mirror logic** — if the concept is mirrored to another row (twin/shadow/denormalized copy), the sync must carry ALL relevant fields, not just the ones added first.
- **6. Heading/copy counts** — if the change alters the cardinality of any entity list, grep the old count word/number across `app/ components/ lib/ tests/` (e.g. `grep -rn "Three Products\|three products"`) — every hit must be updated or justified.
- **7. Slug/classification constant lists** — grep the constant name (e.g. `AI_PRODUCT_SLUGS`) across the whole repo; every definition/duplicate must include the new entry.
- **8. Test fixtures/mocks** — grep the new entity name across `tests/_fixtures/ tests/mocks/ tests/e2e/`; every fixture enumerating the entity type must include the new instance.

**Rule: for each new entity/field/concept, grep its name (and any derived count text) across copy + logic + fixtures — not just DB/API/UI.**

Cheap method: `grep -rn "<new_field>" app/ lib/ packages/ components/` and eyeball whether
every hit-site and every sibling site (other writers, the renderer) is consistent. If a
surface is missing — including a hit found in only SOME of the surfaces above — Gate 0.5
FAILS and the wave is NOT signed off.

Rationale: on 2026-07-03 (spec 001-homepage-redesign) a new entity was wired into DB/API/UI
but stale copy counts, a classification constant list, and test fixtures escaped — exactly
surfaces 6–8.

**Anti-pattern this prevents (symptom-fix loop):** when the SAME defect shows up on a
second record/screen, do NOT patch the instance — `grep` for the root surface and fix all
sites at once. Three identical data-corrections in a row means you skipped this gate.

**Gate 0.6 — Schema check (waves with DB migrations only)**

For waves that add or change migrations, run the deterministic pre-gate before wave
sign-off: `node ~/.claude/skills/_shared/a1-tools.cjs schema-check run --migrations <dir>`
(checks: audit trigger per table, RLS enabled, FK type match — exit 1 = wave not signed
off). Semantic checks (enum completeness, expand→migrate→contract) stay in the 04-plan.md
migration checklist.

**Gate 0.7 — Real-path proof (waves touching SQL / RLS / external HTTP only)**

If this wave's diff touches a SQL query, an RLS policy, or an external HTTP call, mocked tests
are not evidence — they routinely color broken code green. Before wave sign-off, run the
deterministic real-path check:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs realpath-check run \
  --diff-base <wave-start-ref> --project <dir>
```

The check greps the wave diff for SQL/fetch signatures and requires the executor to have produced
`.a1/realpath-evidence.md` — one entry per touched surface category (SQL, RLS, external HTTP)
containing the command run AND its real (non-mock) output. **Exit 1 = wave NOT signed off.**

Rationale: `mock_tests_hide_sql_bugs` has recurred 3× — most damagingly an hourly-rate crash
that shipped behind 23 green tests because none hit the real DB path. This gate kills that class
structurally instead of by prompt appeal.

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

**Gate-3 pass bookkeeping (mandatory — feeds Phase 6 de-duplication).** For every FR-AC that
passes its per-wave smoke test, write ONE line into STATUS.md:

```
gate3: <FR-AC id> PASS @<wave> <date>
```

Example: `gate3: FR-012-AC1 PASS @wave3 2026-07-05`

Phase 6 reads these lines to decide which ACs it may reference (verified at Gate 3) instead of
re-running. An AC with no `gate3:` line is treated as unverified and gets re-run in Phase 6 — so
skipping this bookkeeping only costs you a re-run, never a missed check.

On smoke test failure: wave is `failed`, not `done`. Continue with the failure flow below.

**Only after all gates are green:**

Update the wave heading in the wave-plan file: `⟶ status: done`.
Loop to Step 2 for the next wave.

## Step 5c — Lifecycle stage: Complete (after ALL waves are `done`)

Once every wave in the plan is marked `⟶ status: done` (before moving to
Phase 6), advance the lifecycle stage:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs code-scope stage \
  --by <spec-id> --set complete
```

This is the "Complete" transition of the Lifecycle Completion Gate (see
SKILL.md). It does not change the spec's `status` frontmatter — that stays
`implementing` until Phase 6 closes it — it only advances the code-scope
reservation's lifecycle stage so `a1-progress`/roadmap views show accurate
in-flight state.

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
