# Phase 4 — Plan

**Goal:** Convert the clarified spec into a Wave-Plan (sequenced, parallelizable implementation
units with explicit code-agent assignments and dependencies).

**Sub-agent:** Vincente (`a1-vincente-vibe-optimizer`).

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

Use the **Agent** tool with `subagent_type: "a1-vincente-vibe-optimizer"` and
`model: "opus"` to spawn Vincente with this brief:

> You are Vincente. The spec is at `<spec-path>` with status `clarified`. Your task:
> build a wave plan and save it under `<plan-path>`.
>
> **Required inputs from the spec:**
> - User Stories (P1/P2/P3) → wave order follows priority.
> - FR-### → distributed across waves; each FR lands in exactly one wave.
>   **CRITICAL — the consistency gate (Phase 4.5) parses EVERY `FR-NNN` token inside a
>   `## Wave N` section as a coverage claim for that wave.** A bare `FR-001` in a narrative
>   line ("Beitrag zu FR-001", "Vorbereitung für FR-002") counts as a SECOND coverage and
>   FAILs the gate (duplicate across waves). To stay gate-green:
>   - Each FR appears in a `**FRs covered:**` line of EXACTLY ONE wave.
>   - In every OTHER wave, refer to it WITHOUT the `FR-NNN` token — name the requirement in
>     prose and point to the coverage matrix ("siehe Coverage-Matrix"), never write `FR-001`.
>   - Place the coverage-matrix TABLE BEFORE Wave 1 (above the first `## Wave` heading) —
>     text after the LAST `## Wave N` heading is attributed by the gate to that last wave,
>     producing phantom duplicates. A top-of-plan matrix sits outside any wave and is safe.
>   - A DEFERRED FR that is still present in the spec MUST keep exactly one wave as its
>     coverage-home (a placeholder "Wave N — DEFERRED" section carrying only that FR token).
>   - **When the gate FAILs, read `counts.plan_frs` vs `counts.spec_frs` from its JSON FIRST.**
>     If the counts differ, the real cause is a MISSING FR (skipped in a wave header), not a
>     duplicate — the `diffs.duplicated_in_plan` display is misleading in the last-wave trap
>     above. Fix the missing coverage before chasing a "duplicate."
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
> **FRs covered format (mandatory):**
> Do not write bare FR lists. Each FR entry must include one behavioral AC sentence:
> ```
> **FRs covered:**
> - FR-001 — AC: After [action], [user/system] sees/gets [result]
> - FR-002 — AC: After [action], [user/system] sees/gets [result]
> ```
> "AC: see spec" or "AC: works correctly" are not valid — write the behavior explicitly.
>
> **Deployment chain (mandatory per wave):**
> Explicitly state for each wave:
> - **DB migrations:** none / [list migration files — must be created in THIS wave, not a later one]
> - **RLS / grants:** none / [list affected policies and grant statements]
> - **ENV vars:** none / [list new vars — must appear in .env.example in THIS wave]
> - **Services to restart after deploy:** none / [e.g. PostgREST Cloud Run, Cloud Functions]
>
> **DB-schema checklist (mandatory for EVERY new or altered table — `schema_flaw` is the
> single most frequent bug class across runs, 8× over 17 features). For each table the wave
> touches, the brief must answer:**
> - **Audit trigger?** Does the table have the project's `audit_row`/equivalent AFTER-trigger?
>   (Real bug: `time_entries` had only `update_project_timestamp`, no audit trigger → GoBD-audit
>   silently missing.) New mutated tables without an audit trigger are a defect.
> - **RLS + GRANT matrix?** ENABLE+FORCE RLS, SELECT/INSERT/UPDATE policies AND matching GRANTs to
>   the app role. A missing GRANT or policy = silent rollback (42501/42P17), not a loud error.
> - **FK types match?** FK column type == referenced PK type (uuid vs integer vs text). (Real bug:
>   wrote string "klaus" into a uuid FK → crash; `route_ref bigint` vs `agent_runs.id uuid`.)
> - **Enum / CHECK values complete?** Every value the code can write is in the CHECK/enum. (Real
>   bug: code wrote `declined`/`api` not in the enum/CHECK → insert rejected.)
> - **Migration hygiene?** `-down.sql` reversible; NO embedded BEGIN/COMMIT (defeats the
>   BEGIN/ROLLBACK dry-run); `CONCURRENTLY` indexes need connection-leak awareness
>   (`withTenantContext` left an idle-in-transaction conn that blocked VACUUM for 35min).
> - **Expand→Migrate→Contract?** Dropping a column/enum needs a 2-PR split with strict deploy
>   order (code Ready, THEN migration) — never in one shot, or production outage.
>
> **Hard rules:**
> - Every FR must land in exactly one wave.
> - No wave without an explicit acceptance reference.
> - If a wave carries > 5 FRs: split into two waves.
> - If the right agent is unclear: suggest with comment `(uncertain: …)`.
> - No wave may introduce a DB schema change without a migration task in that same wave.
>
> When done: report "Wave plan complete: N waves, M FRs distributed, K parallelizable."

## Step 3 — Update spec frontmatter

After Vincente reports completion, link the wave-plan back into the spec:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> planned --wave-plan-path "<plan-path>"
```

Helper sets `wave_plan_path` and appends `phase: plan, completed: <iso>` to `phase_history`.

## Hand-off to Phase 4.5 (Consistency Gate)

Before handing off: confirm every wave has `Suggested agent(s)` and dependencies form a DAG (no cycles, no wave depending on a later one). If either fails, ask Vincente to revise.

Tell the user:

> "Wave plan ready: N waves, suggested agents per wave included. Running the
> consistency gate against the spec now — it is deterministic and takes no time."

Then load `workflows/04.5-consistency-gate.md`. **Do not skip the gate**, even
if you are confident the plan is correct. The gate is cheap and prevents
late-stage drift.
