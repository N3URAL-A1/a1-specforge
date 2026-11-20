# Phase 5 — Implement

**Goal:** Walk through the Wave-Plan one wave at a time. For each wave, the skill dispatches the
suggested agent(s) with the brief and tracks wave completion. Waves continue on their own while
`wave next-check` prints `continue`; the owner can stop per wave with `--checkpoint-each-wave`, and a stop
reason asks the owner (spec 027 FR-021).

**Sub-agents:** Code agents per wave (Walter / Bernd / Aik / Felix / Alex / project-specific).
The skill dispatches the agent suggested in the wave plan; the owner can name a different one in a stop block.

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
node <repo>/_shared/a1-tools.cjs checklist run <project-slug>/<###>-<feature-slug> --only 9,10,11 --format json --phase <spec-id>
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
node <repo>/_shared/a1-tools.cjs code-scope claim \
  --by <spec-id> --scope <code_scope-paths-comma-separated> --phase <spec-id>
```

- Exit 1 (`CONFLICT`) → **do not start Implementation.** Surface the named
  overlapping feature(s) from stderr to the user and ask how to proceed.
- Exit 0 → proceed. Idempotent on re-run (e.g. resuming after a context
  reset) as long as the scope is unchanged.

## Step 1 — Set status to implementing (first time only)

If status is still `planned`:

```bash
node <repo>/_shared/a1-tools.cjs spec update-status \
  <spec-path> implementing
```

## Step 1b — Event stores (every start)

`wave next-check` reads `observations.jsonl` and `GOAL.md` (with `## Decisions`) under `.a1/phases/<spec-id>/` and stops when either is
missing (owner decision 2026-11-20, "missing source = stop"). This block creates what is missing, registers the union merge for both
paths and commits what it created or changed (decided by the git state of the two files, so a re-run after a failed commit commits the
staged files). `<dir>` is the feature worktree, the same `<dir>` the wave gates pass as `--project`. The stores ride in the feature PR.
`<spec title>` is substituted as one line inside the quoted heredoc, so quotes, `$(...)` and backticks stay literal. The orchestrator
strips all newlines from the title first (a title line equal to `A1_GOAL_EOF` would close the heredoc early) and checks `<spec-id>`
against `^[A-Za-z0-9_][A-Za-z0-9._-]*$` before running the block; a spec id that fails the check is a STOP. The block repeats the check
on the single-quoted `SPEC_ID` value (`STOP: bad spec id`, exit 2).

```bash
WORK_PATH="<dir>"
SPEC_ID='<spec-id>'
case "$SPEC_ID" in ""|[!A-Za-z0-9_]*|*[!A-Za-z0-9._-]*) echo "STOP: bad spec id"; exit 2;; esac
P="$WORK_PATH/.a1/phases/$SPEC_ID"; mkdir -p "$P"
if [ ! -e "$P/observations.jsonl" ]; then : > "$P/observations.jsonl"; fi
if [ ! -e "$P/GOAL.md" ]; then
  cat > "$P/GOAL.md" <<'A1_GOAL_EOF'
# Goal: <spec title>

## Decisions
A1_GOAL_EOF
fi
if ! grep -qE '^##[[:space:]]+Decisions[[:space:]]*$' "$P/GOAL.md"; then printf '\n## Decisions\n' >> "$P/GOAL.md"; fi
A="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)/info/attributes"; mkdir -p "${A%/*}"
for L in '.a1/phases/*/observations.jsonl merge=union' '.a1/phases/*/GOAL.md merge=union'; do grep -qxF "$L" "$A" 2>/dev/null || printf '%s\n' "$L" >> "$A"; done
if [ -n "$(git -C "$WORK_PATH" status --porcelain -- "$P/observations.jsonl" "$P/GOAL.md")" ]; then git -C "$WORK_PATH" add -- "$P/observations.jsonl" "$P/GOAL.md" && git -C "$WORK_PATH" commit -q -m "chore($SPEC_ID): event stores" -- "$P/observations.jsonl" "$P/GOAL.md"; RC=$?; if [ "$RC" -ne 0 ]; then echo "STOP: event-store commit exit=$RC"; exit "$RC"; fi; fi
echo "event stores ready: $P"
```

On `STOP: event-store commit exit=<n>`: fix the cause (hook output above, a held `.git/index.lock`), then run the block again.
The two `merge=union` lines stay in `<git-common-dir>/info/attributes` (local, never committed, repo-wide for these two append-only
paths: it applies to every worktree and branch merge of this repository, so a merge of a foreign branch also unions its `GOAL.md` Decisions rows); to remove them delete those two lines from that file.

## Step 2 — Read the wave-plan and pick the next wave

Read `<plan-path>`. Identify the next wave whose dependencies are satisfied (all earlier
waves marked complete in the plan, or "none"). If multiple waves are unblocked **and**
marked `Parallelizable: ja`, you may propose them as a parallel batch.

**Size-S fast path:** a `size: S` spec has a single-wave plan, so this phase
naturally collapses to one dispatch and **one** closing checkpoint (the
wave's own Build+Deploy+Smoke gate). Do not add intermediate check-ins beyond
that — the gates are the checkpoints.

Track wave completion **inline in the wave-plan file** by appending a status line to each
wave heading after dispatch:

```markdown
## Wave N — <title>  ⟶ status: in-progress / done / failed
```

## Step 3 — Next wave and its agent(s)

Read `### Suggested agent(s)` for Wave N from the wave plan (the brief, FRs and goal come from the same section).

Before Wave 1 run `wave next-check <spec-id> 0 --since <precondition_start> --project <dir> --plan <wave-plan path>`
(wave 0 checks only that Wave 1 names an agent; the preconditions above stop on their own exit codes). Before Wave N+1 run it with
`<N>` and `--since <wave_start>`. Add `--checkpoint-each-wave` when the owner started the run with it.

```bash
NEXT="$(node <repo>/_shared/a1-tools.cjs wave next-check <spec-id> <N> --since <wave_start> --project <dir> --plan <wave-plan path>)"; RC=$?
echo "wave next-check: $NEXT (exit $RC)"
```

- `continue` (exit 0) → dispatch the suggested agent(s) at once, no question.
- `stop:<reason>` (exit 1) → the stop block below.
- Exit 2 → STOP, fix the call.

<!-- a1:stop -->
On `stop:<reason>` present the proposal and let the owner decide:

> "**Wave N — <Title>**
>
> Goal: <goal>
> FRs: <list>
> Brief: <short summary>
>
> Stop reason: <reason>
> Suggestion: **<agent-name>** for <sub-task>.
>
> Should I dispatch the agent like this, or would you like a different one?"

Wait for user confirmation. Do **not** dispatch automatically.

| Reason | What to do |
|---|---|
| `gate_red` | fix the cause and re-run the failed gate call |
| `deviation` | read `observations.jsonl`; a missing file is itself the stop: recreate it per Step 1b |
| `scope_change` | confirm the GOAL.md decision; a date-only row stops every wave of its day, rewrite it with an ISO timestamp to clear it |
| `agent_unnamed` | name the agent in the wave plan (`### Suggested agent(s)`) |
| `owner_requested` | the owner started the run with `--checkpoint-each-wave` |
<!-- /a1:stop -->

## Step 4 — Dispatch

Spawn the suggested agent (or the agent the owner named in a stop block) via the Agent tool with
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
> Tests: write or extend the tests that correspond to the FR-### and the `**Edge cases covered:**` of this wave.
> **Discriminating tests per AC (mandatory):** for every AC that states a styling or
> content property, a language, an ORDER ("A then B then C"), or a success-path side
> effect ("clicking X launches Y"), write a test IN THIS WAVE that fails specifically
> when that property breaks — position comparison for order, call-capture for
> launches, a style/content assertion with a negative control for styling/language.
> "All pieces present" (findsOneWidget per element) and "failure path handled"
> (empty-state, missing-path) do NOT verify these ACs. If the wave resolves or
> constructs a filesystem path from external data (config, JSON, frontmatter), at
> least one test must assert the resolved path points at a REAL existing file —
> "missing file handled gracefully" and "path resolution broken" are two DISTINCT
> scenarios, never one no-crash test. If components key on a DB enum/status value,
> one test must prove the WRITER produces that exact value under realistic
> (non-empty) conditions.
>
> When done: report "Wave N done. <short summary of changes>."

If the wave is parallelizable and the plan names both agents, dispatch them in a
**single** assistant turn (parallel Task calls).

On dispatch run `date -u +%Y-%m-%dT%H:%M:%SZ` and note the printed value as `<wave_start>` of this wave (substituted literally into the
`wave next-check` call of Step 3 for Wave N+1).

When the agent's hand-back reports a deviation or "spec unstable", append one line
`{"ts":"<ISO>","agent":"<agent>","skill":"a1-new-feature","phase":"<spec-id>","wave":<N>,"type":"deviation","severity":"major","msg":"<one sentence>"}`
to `<dir>/.a1/phases/<spec-id>/observations.jsonl` (the a1-new-feature source of `deviation`), then commit it at once (the agent has
returned, so no executor runs in that worktree):

```bash
git -C "<dir>" commit -q -m "chore(<spec-id>): observation wave <N>" -- ".a1/phases/<spec-id>/observations.jsonl"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: store commit exit=$RC"; fi
```

**Mid-run decision rule.** When the owner changes a requirement during a wave, append
`- <ISO-8601 UTC timestamp from date -u +%Y-%m-%dT%H:%M:%SZ> — <decision> — affects: <FR or AC id>` under `## Decisions` in
`<dir>/.a1/phases/<spec-id>/GOAL.md` before the next wave (the a1-new-feature source of `scope_change`), then commit it, never while the
wave's agent still runs (index lock):

```bash
git -C "<dir>" commit -q -m "chore(<spec-id>): decision" -- ".a1/phases/<spec-id>/GOAL.md"; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: store commit exit=$RC"; fi
```

On `STOP: store commit`: fix the cause (a held `.git/index.lock`, a hook) and commit again. The spec's `## Clarifications` entry follows as today.

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
- Claimed "flaky" / "green when run alone" → rerun only that case on the agent's branch and on `origin/main` before accepting; a deterministic difference is a regression.
- Empty or missing hand-back → read `git log` and `git diff --stat` of the agent's branch before accepting; never re-spawn blindly.

This is the one owner of the hand-back check (a1-execute, a1-fix and a1-pr-review fix rounds point here).

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
sign-off (checks: audit trigger per table, RLS enabled, FK type match):

```bash
node <repo>/_shared/a1-tools.cjs schema-check run --migrations <dir> --phase <spec-id>; RC=$?
echo "schema-check exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: schema-check red, wave not signed off"; fi
```

Exit 1 = wave not signed off. Semantic checks (enum completeness, expand→migrate→contract)
stay in the 04-plan.md migration checklist.

**Gate 0.7 — Real-path proof (waves touching SQL / RLS / external HTTP only)**

If this wave's diff touches a SQL query, an RLS policy, or an external HTTP call, mocked tests
are not evidence — they routinely color broken code green. Before wave sign-off, run the
deterministic real-path check:

```bash
node <repo>/_shared/a1-tools.cjs realpath-check run \
  --diff-base <wave-start-ref> --project <dir> --phase <spec-id>; RC=$?
echo "realpath-check exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: realpath-check red, wave not signed off"; fi
```

The check scans the wave diff for SQL shapes (statements, clause lines, driver calls; not English words) and external fetch signatures, and requires the executor to have produced
`.a1/realpath-evidence.md` — one entry per touched surface category (SQL, RLS, external HTTP)
containing the command run AND its real (non-mock) output. **Exit 1 = wave NOT signed off.**

Rationale: `mock_tests_hide_sql_bugs` has recurred 3× — most damagingly an hourly-rate crash
that shipped behind 23 green tests because none hit the real DB path. This gate kills that class
structurally instead of by prompt appeal.

**Gate 0.8 — Test fidelity (every wave)**

Green tests that mock the changed code, are skipped, return early or do not run in CI prove
nothing. Scan the tests this wave added or changed:

```bash
node <repo>/_shared/a1-tools.cjs test-fidelity --diff-base <wave-start-ref> --project <dir> --phase <spec-id>; RC=$?
echo "test-fidelity exit=$RC"
if [ $RC -ne 0 ]; then echo "STOP: test-fidelity red (findings as JSON above)"; fi
```

Exit 1 = wave not signed off: the agent fixes the tests. The only other way out is a recorded
`disposition add --kind fidelity ... --reason <why> --by <agent>`; Reinhard reviews it at PR
review. There is no skip flag.
The merge step of a1-pr-review runs this scan once more on the final head (`05-merge.md` 5.3).

**Gate 1 — Build**

Run the project's deterministic build and test check (commands from `.a1/verify.json`, else the
npm `typecheck`/`build`/`test` scripts):

Intent child (`A1_INTENT_CHILD=1`): skip the block below. A child cannot run `verify run` (the spawn guard refuses it, exit 77).
Record "gate-1-build: verify deferred to owner" in the wave report instead. The owner runs `verify run` after the child ends and
before any merge; `pr merge-check` runs the suites itself, so a deferred gate never lets a red suite through.

```bash
node <repo>/_shared/a1-tools.cjs verify run --project <dir> --affected --phase <spec-id>; RC=$?
echo "verify run exit=$RC"
if [ $RC -eq 2 ]; then echo "STOP: gate-1-build not run (exit 2: error lock_timeout = another local verify run held the CLI lock past 15 min, host busy, re-run, not red; any other error = usage or config)"; elif [ $RC -ne 0 ]; then echo "STOP: gate-1-build red (verdict fail, exit $RC)"; fi
```

Reading the `verify run` record (spec 028): name every `skipped_on_host` id in the wave report and never count a skipped id as a pass (it did not run on this host); name every `env_red` entry (a known environment-red suite, excused on this platform only, never on a head-only red) and every `env_red_stale` warning (`warnings[]`: the entry is green or names no command, remove it from `.a1/verify.json`); copy each `hints` line into the report. `skipped_on_host`, `env_red_stale` and `hints` do not change the exit code; an `env_red` entry takes its id out of the verdict on this platform (under `--base` only when the id is red on base and head), and a run where zero commands ran fails with `all_commands_skipped_on_host`. None of this adds a step.

`--affected` runs the suites the `affected` map in `.a1/verify.json` selects for the branch's changed paths plus `smoke`; anything unmapped runs the full set. The record says `scope: "affected"` and is never Verify evidence: 06-verify.md runs the full set once. Name `affected.selection` and `affected.reason` in the wave report.

Run the project-specific build command from CLAUDE.md too when it is not covered (e.g. `npm run build`).
On build failure: wave stays `in-progress`, agent repairs it. No proceeding.

**Gate 2 — Preview-Deploy**

```bash
vercel   # creates preview URL
```

Record the preview URL for Gate 3 and for Phase 6. Never skip, even for "just a small fix".
Deploy executor: `a1-dario-devops` (preview deploys here; production deploys only on
explicit user instruction).

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
node <repo>/_shared/a1-tools.cjs code-scope stage \
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

A scope cut ("leave FR-3 out"), a deferral or a "do it differently" given in chat **is** a
spec change and takes the same route before the next wave is dispatched — the decision is
written into the spec file (deferred FR, changed AC), never carried only in the conversation.
Phase 6 verifies the file: on 2026-10-15 (captrader 012) the verifier failed an FR the user
had changed in chat; 2026-10-03 (a1-office 059) and 2026-10-08/09
(ai-net M1-P1/P2) ran the same way.
