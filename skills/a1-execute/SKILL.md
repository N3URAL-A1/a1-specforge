---
name: a1-execute
description: >
  Wave-by-wave execution of an existing PLAN.md: waves continue on their own while `wave next-check`
  prints continue; a stop reason or `--checkpoint-each-wave` asks the owner. Ends with final goal-backward verification. State lives in `.a1/phases/<name>/STATUS.md`; a
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

## Spawn Policy (HARD RULE)

Spawn a1 agents by `subagent_type` without `name` (else pass `model` explicitly); briefs carry
paths, not documents. Details + self-check: `_shared/spawn-policy.md`.

## Phases

| # | Phase | Workflow | Agent | Trigger |
|---|---|---|---|---|
| 1 | Load (incl. Roadmap Gate + plan-review check `load-check`) | `workflows/01-load.md` | — (orchestrator) | Always |
| 2 | Execute | `workflows/02-execute.md` | a1-erik-executor (per wave) | Per wave |
| 3 | Verify | `workflows/03-verify.md` | a1-victor-verifier | After all waves |

## Cross-provider review gates (spec 009, HARD RULE — enforcement lives in the registry)

Only the plan and design files go to a second provider (Codex, through the vendored
claudex-loop runner); never a code diff. There is no cross-provider code step on waves; the load check is deterministic:

- **Load precondition** (`workflows/01-load.md` Step 0c): `xprov load-check`
  — the current PLAN.md sha256 must match the newest `plan-review-xprov` pass
  entry from a1-plan Phase 4b. No match → `plan_review_missing`.
- **Design files only** (`workflows/02-execute.md` 2b-d, gate `design-review-xprov`): a wave that changed an ADR or `docs/architecture/` document gets those files reviewed (`xprov design-targets --base "$PRE_WAVE_HEAD"`); never a code diff, `warning` row.
- **Before every wave** (`workflows/02-execute.md`): `xprov load-check
  --expect-sha <sha accepted at Load>` — a PLAN.md edited mid-phase halts.

The workflows read `enforcement` from the driver's stdout JSON (it echoes the
gate's row in `_shared/gates-registry.md`): `warning` → warning block and
continue, `blocking` → halt. The code never applies enforcement, so the Wave 7
flip changes one registry cell. A waiver exists only as a human action
(`xprov waive`, described in the workflows, never inside a skill's `bash`
block) and never yields `verdict: pass`.

## Checkpoint protocol

After each wave:
1. Show wave completion summary (tasks done, deviations)
2. Run `git status` to confirm commits
3. Run `wave next-check`: `continue` starts the next wave at once; `stop:<reason>` (or `--checkpoint-each-wave`) pauses for the owner
4. At a stop the owner can say "continue" / "weiter" to proceed or "stop" to halt

This prevents runaway execution — the gates, the deviation and decision stores and the plan decide whether a wave may follow on its own, and the owner decides at every stop reason (spec 027 FR-021).

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

`<spec-id>` is the product-CLI feature id (definition: `a1-new-feature` `workflows/00-roadmap-gate.md`).

Call this at each wave checkpoint (`workflows/02-execute.md`, Step 2c) — it
keeps `reservations.json` / `feature.md` / `ROADMAP.md` in sync in one
invocation. Commit the result, but do not push or open a chore PR per wave: it
rides in the next start or finish push (`_shared/push-cadence.md` P3).
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

No wave code is written in the primary checkout. Before the first wave (Wave 0 if the plan has one), the phase MUST
be moved into its own git worktree on a fresh branch off `main` — full
convention (worktree naming, shared-state rule, scope claim, merge discipline,
gotchas): `_shared/parallel-spec-isolation.md`. Short form:

1. Sync the primary checkout, then claim the phase's `code_scope` via
   `a1-tools.cjs code-scope` (STOP on overlap with an active reservation of
   another spec); push the claim before step 2. Commands:
   `_shared/push-cadence.md` P3, start step.
2. Create the worktree with the `a1-worktree` skill (`prepare`, then `enter`); every erik wave runs inside that path.
3. Shared-state mutations (`docs/product/**`, `.a1/reservations.json`,
   `.a1/roadmap.md`) happen ONLY in the primary checkout and are committed
   immediately; when they are pushed: `_shared/push-cadence.md` P3.
4. Merge only when the final wave is GREEN; tear the worktree down afterwards.
   Waves commit, they never push (`_shared/push-cadence.md` P1).

This enables parallel specs on one project: N phases = N worktrees = N branches,
zero shared-working-tree conflicts.

## Multi-lane phases (PLAN.md declares a `lanes:` block)

Waves run sequentially unless PLAN.md declares lanes.

1. **Re-run the check before trusting the plan, WITH `--imports`.** A stale
   PLAN.md is likelier than a wrong one — and here, unlike at plan time, the
   completed waves' code exists, so the import check can actually run:
   ```bash
   node <repo>/_shared/a1-tools.cjs lane-split check \
     --plan <plan path> --imports <repo root> --phase <phase_name>
   ```
   Exit 1 → do not start any lane; back to `a1-plan`.

When the JSON prints `"lanes"` greater than 1, read `workflows/multi-lane.md` now and follow it; `imports_checked` must be `true`.

## Routing

0. **Roadmap Gate first** (`workflows/01-load.md` Step 0) — no wave loads or
   executes until this passes.
1. Ask for: project path + phase name (or detect from `.a1/phases/`)
2. Read PLAN.md — confirm wave count and goal with user
3. Execute waves one at a time via a1-erik-executor
4. After each wave run `wave next-check` — continue on `continue`, ask the owner on a stop reason
5. After all waves: run a1-victor-verifier
6. If PARTIAL/FAIL: show gaps, ask if user wants targeted re-execution

## Hard rules

- Never execute a wave in the primary checkout — Isolation Gate first (`_shared/parallel-spec-isolation.md`)
- Never skip `wave next-check` between waves (multi-lane: per lane, not one global check); never continue past a `stop:<reason>` without the owner
- Never start a lane whose `lane-split check` exits non-zero; never run a cutover or contract wave as a lane
- Always show the diff summary after each wave (`git log --oneline -5`)
- If a wave is BLOCKED (a1-erik-executor reports blocked tasks), surface to user before continuing
- Never re-execute already-committed tasks — check STATUS.md first
- Never start the first wave (Wave 0 if the plan has one) while `xprov load-check` reports `plan_review_missing` under `blocking`; Victor is spawned after the last wave with no Codex precondition
- Never run `xprov waive` from this skill — the human runs it, the skill only prints the command
