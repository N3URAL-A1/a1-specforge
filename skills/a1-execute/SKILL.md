---
name: a1-execute
description: >
  Wave-by-wave execution of an existing PLAN.md with mandatory user-checkpoint between waves
  and final goal-backward verification. State lives in `.a1/phases/<name>/STATUS.md`; a
  VERIFICATION.md captures the verdict. MUST trigger when the user says: "execute plan"
  (alias: "plan ausführen"), "execute phase" (alias: "phase ausführen"), "a1-execute",
  "start implementing" (alias: "implementieren starten"), "start execution", "run the plan",
  "execute wave 1", "let's build this phase", "continue with the phase" (alias:
  "weiter mit der phase"), or any request to implement work from an already-created PLAN.md.
  Captures observations.jsonl during execution and writes a Retro to the learning
  store (repo-local default; external vault via `A1_VAULT_ROOT`, e.g. Obsidian)
  after every run. Do NOT activate for: creating a plan (use a1-plan), feature ideation
  from scratch (use a1-new-feature), bug fixes (use a1-fix).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---

# a1-execute — Phase Execution Pipeline

Language: English-first; German trigger aliases supported.

Thin orchestrator. Wave logic runs via a1-erik-executor. Verification via a1-victor-verifier.

## When to use

Activate when a PLAN.md exists and the user wants to **execute it**.

A plan must exist at `.a1/phases/<name>/PLAN.md` (created by `a1-plan`).
If no plan exists, route the user to `a1-plan` first.

## Phases

| # | Phase | Workflow | Agent | Trigger |
|---|---|---|---|---|
| 1 | Load (incl. Roadmap Gate) | `workflows/01-load.md` | — (orchestrator) | Always |
| 2 | Execute | `workflows/02-execute.md` | a1-erik-executor (per wave) | Per wave |
| 3 | Verify | `workflows/03-verify.md` | a1-victor-verifier | After all waves |

## Checkpoint protocol

After each wave:
1. Show wave completion summary (tasks done, deviations)
2. Run `git status` to confirm commits
3. **Pause for user confirmation** before next wave (default behavior)
4. User can say "continue" / "weiter" to proceed or "stop" to halt

This prevents runaway execution — the user stays in control wave by wave.

## State tracking

```
.a1/phases/<name>/
├── PLAN.md        (input — do not modify)
├── STATUS.md      (updated after each task)
└── VERIFICATION.md (created after all waves)
```

## Roadmap Gate (HARD RULE — before any wave execution)

Before Phase 1 does anything else, it runs a deterministic (grep/parse, no
LLM) roadmap-existence check that **prefers `docs/product/ROADMAP.md`**
(schema v1), falling back to the legacy `.a1/roadmap.md` only when the
preferred file is absent (see `workflows/01-load.md` Step 0, and `a1-roadmap`
SKILL.md "Feature → Roadmap Linkage" for the schema). Both missing, or the
found file unparseable → halt, route to `a1-roadmap`; an
existing-but-unparseable file gets an explicit do-not-overwrite warning and
requires user confirmation before handoff. A project on the legacy-only
fallback path proceeds (soft note, not a blocker) with a recommendation to
migrate on next touch — see "On-touch migration rule" below.

## docs/product Wiring (HARD RULE — CLI-only mutations)

When the project uses `docs/product/` (schema v1), every wave checkpoint
mirrors its stage transition through the CLI — never a hand-edited
`ROADMAP.md`/`feature.md`:

```bash
node <repo>/_shared/a1-tools.cjs product stage --by <spec-id> --set <stage>
```

Call this at each wave checkpoint (`workflows/02-execute.md`, Step 2c) — it
keeps `reservations.json` / `feature.md` / `ROADMAP.md` in sync in one
invocation.
Skip it entirely for legacy-only projects (no `docs/product/` directory).

## Audit Auto-Close (HARD RULE — explicit convention only, FR-022)

When the project has `docs/product/audits/*.md`, every wave commit message is
checked for the explicit closing convention (`Closes F-0NN` / `Fixes F-0NN`,
case-insensitive on the keyword, exact `F-0NN` id) before the wave's Step 2c
checkpoint — see `workflows/02-execute.md` "Audit Auto-Close" for the full
detection regex and the `product audit-set` auto-call. A bare mention of an
`F-0NN` id without one of those keywords immediately before it MUST NOT
auto-close the finding. This mirrors `a1-fix`'s identical Step 4.5 hook
(`skills/a1-fix/workflows/03-fix.md`) — same trigger, same non-blocking
failure handling.

## On-touch Migration Rule (HARD RULE — never big-bang)

If this skill encounters a project that has only the legacy `.a1/roadmap.md`
(no `docs/product/` directory), it does **not** silently convert it. Offer
adopt-mode migration instead, once, non-blocking:

> This project's roadmap is still on the legacy `.a1/roadmap.md` format.
> Want me to migrate it to `docs/product/ROADMAP.md` (schema v1) now via
> `a1-roadmap`'s adopt mode, or continue on the legacy path for this
> execution run?

Accept → hand off to `a1-roadmap` in `adopt` mode, then resume execution.
Decline/defer → continue wave execution on the legacy path; do not force
migration mid-run.

## Isolation Gate (HARD RULE — before any wave execution)

No wave code is written in the primary checkout. Before Wave 1, the phase MUST
be moved into its own git worktree on a fresh branch off `main` — full
convention (worktree naming, shared-state rule, scope claim, merge discipline,
gotchas): `_shared/parallel-spec-isolation.md`. Short form:

1. Claim the phase's `code_scope` via `a1-tools.cjs code-scope` (STOP on overlap
   with an active reservation of another spec).
2. `git worktree add ../a1-worktrees/<phase-slug> -b feature/<phase-slug> origin/main`
   (delegate to `a1-worktree`, or inline). Every erik wave runs inside that path.
3. Shared-state mutations (`docs/product/**`, `.a1/reservations.json`) happen
   ONLY in the primary checkout and are committed + pushed IMMEDIATELY (small
   `chore(product):` PR under branch protection) — never left dirty for
   parallel sessions to trip over.
4. Merge only when the final wave is GREEN; tear the worktree down afterwards.

This enables parallel specs on one project: N phases = N worktrees = N branches,
zero shared-working-tree conflicts.

### Multi-lane phases (PLAN.md declares `lanes:`)

Waves run sequentially unless PLAN.md's frontmatter declares `lanes:` (written by
a1-pablo-planner Step 4.5). Then each lane is its own arbeitseinheit under R1:
one worktree, one branch, one executor — N lanes = N worktrees, same rules as
N phases, no new convention.

1. **Verify the lane split before trusting it.** For each pair of lanes, confirm
   the `owns:` globs do not overlap and that no lane's waves list a
   `Vorbedingung:` on another lane. A stale PLAN.md is the likelier failure than
   a wrong one — re-check against the current code, do not assume.
2. **Claim each lane's scope separately** (`a1-tools.cjs code-scope`), branch
   `feature/<phase-slug>-<lane-id>`. STOP on overlap — never "just this once".
3. **One executor per lane**, spawned concurrently. Each gets its own STATUS
   section; observations carry the lane id.
4. **Checkpoint per lane**, not one global checkpoint — a blocked storage lane
   must not hold up a green runtime lane.
5. **Merge lanes one at a time**, each green, before any wave in
   `sequential_after_lanes:` starts. Contract/cleanup waves touch several lanes'
   files and MUST run last, in the primary flow, after every lane has merged.

Lanes are for independent subsystems. A wave that switches DNS, cuts over the
production database, or flips a live ENV is single-lane by nature — running
those concurrently buys risk, not speed.

## Routing

0. **Roadmap Gate first** (`workflows/01-load.md` Step 0) — no wave loads or
   executes until this passes.
1. Ask for: project path + phase name (or detect from `.a1/phases/`)
2. Read PLAN.md — confirm wave count and goal with user
3. Execute waves one at a time via a1-erik-executor
4. Checkpoint after each wave — wait for user confirmation
5. After all waves: run a1-victor-verifier
6. If PARTIAL/FAIL: show gaps, ask if user wants targeted re-execution

## Hard rules

- Never execute a wave in the primary checkout — Isolation Gate first (`_shared/parallel-spec-isolation.md`)
- Never skip the checkpoint between waves (in multi-lane phases: per lane, not one global checkpoint)
- Never run a cutover wave (DB, DNS, live ENV) or a contract/cleanup wave as a lane — single-lane by nature, after all lanes merged
- Always show the diff summary after each wave (`git log --oneline -5`)
- If a wave is BLOCKED (a1-erik-executor reports blocked tasks), surface to user before continuing
- Never re-execute already-committed tasks — check STATUS.md first
