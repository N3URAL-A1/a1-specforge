---
name: a1-quick
description: >
  XS Quick Lane: a single-session flow for tiny, low-risk features and trivial
  bug fixes that pass the deterministic `quick eligibility` gate (≤2 files,
  ≤50-line diff, one intent, no forbidden surface, clean tree, no reservation
  conflict). Zero mandatory sub-agent spawns — spec-lite, implement, inline
  verify, and one checkpoint all happen in the current session. Isolation is a
  short-lived `quick/<slug>` branch in the primary checkout, not a git
  worktree. Writes exactly one run-record artifact per run to
  `projects/<slug>/quick/<YYYY-MM-DD>-<slug>.md`. Invoke directly with
  "a1-quick", "run the quick lane", "quick fix" (alias: "quick-fix",
  "kleinigkeit"), "tiny feature", or "one-liner" once eligibility is known.
  Do NOT activate for anything that fails `quick eligibility` (auth, payment,
  tenant-boundary, migration, new route, new dependency, >2 files, >50-line
  diff, dirty tree, conflicting reservation) — those go through
  `a1-new-feature` (S/M/L) or `a1-fix`.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# a1-quick — XS Quick Lane

Language: English-first; German trigger aliases supported.

This skill is a **single-session flow**, not a phase pipeline: no
`workflows/` subdirectory, no sub-agent spawns in its core steps. Contrast
with `a1-new-feature`'s per-phase agent table (Rene, Uwe, Vincente, code
agents, Reinhard, Diana) and `a1-fix`'s agent table (Falk × 2) — `a1-quick`
spawns none of them. The `Agent` tool is deliberately absent from
`allowed-tools` above.

## When to use

Only after XS eligibility is established — either:
- the caller (`a1-new-feature`'s Discover phase or `a1-fix`'s Phase 0) already
  ran `quick eligibility` and is handing off, or
- this skill is invoked directly, in which case Step 1 below runs the gate
  inline before anything else happens.

## Step 1 — Confirm eligibility

If eligibility was already checked by the caller (handoff from
`a1-new-feature` / `a1-fix`), skip to Step 2 — the caller's exit-0 result is
the confirmation.

If invoked directly (standalone), run the gate inline first:

```bash
node <repo>/_shared/a1-tools.cjs quick eligibility \
  --intent "<1-2 sentence intent>" --files <n> --diff-lines <estimate> \
  --scope <path>[,<path>...] --no-migration --no-new-route --no-new-dep \
  --by quick-<slug>
```

- **Exit 0 (ELIGIBLE)** → proceed to Step 2.
- **Exit 1 (NOT_ELIGIBLE)** → STOP. Report the `reasons[]` from the JSON
  output to the user in plain language and hand off to `a1-new-feature` (new
  feature intent) or `a1-fix` (bug intent) instead. Never proceed past a
  failed gate in this skill.

## Step 2 — Spec-lite

Write the run-record file from `templates/run-record-template.md` to:

```
projects/<slug>/quick/<YYYY-MM-DD>-<slug>.md
```

Fill in inline — no separate spec file is created:
- **Intent** (1–2 sentences, matches the `--intent` used in Step 1)
- **Acceptance Checks** (1–3, concrete and checkable)
- **Expected files** (matches the `--scope` used in Step 1, ≤2 files)

Set frontmatter `result: in-progress`, `escalated: false`.

## Step 3 — Implement

```bash
git -C <repo> checkout -b quick/<slug> main
```

No `git worktree add` call anywhere in this skill — the clean-tree
precondition is already guaranteed by Step 1's eligibility check (or the
caller's), so no separate isolation step is needed here. All edits happen in
the primary checkout on this branch.

Implement only the expected files listed in Step 2's spec-lite. See
"Tripwires" below for what to do if scope grows mid-implementation.

## Step 4 — Verify

1. **Run the project's affected tests/build.** Discover the command the same
   way `a1-fix` Phase 4 does: read the target project's `CLAUDE.md` and/or
   package manifest (`package.json` scripts, `Makefile`, or the project's
   documented test entry point) for the test/build command, then run it.
2. **Check each stated Acceptance Check once** against the implemented
   change. Record pass/fail with a one-line evidence note per AC.
3. **Record a fixed 5-point self-review** as a bullet list in the run
   record's `## Verify` section — no agent spawn for review:
   - Immutability — no in-place mutation of existing objects
   - Error handling — errors handled explicitly, not swallowed
   - Input validation — validated at system boundaries where applicable
   - No hardcoded secrets
   - No scope creep — change matches the stated intent and expected files
     exactly

If verify fails: fix and re-run once. A second consecutive verify failure is
a tripwire (see below) — do not loop indefinitely.

## Step 5 — Checkpoint (single, before commit)

Show the user:
- The diff (`git -C <repo> diff main...quick/<slug>`)
- The verify result (tests/build outcome + AC-by-AC pass/fail + 5-point
  self-review) in plain language

Wait for explicit confirmation. **Confirmation happens BEFORE the commit is
made, not after** — review the diff, then commit, never the reverse.

## Step 6 — Commit + merge (on confirmation)

Exactly one commit, then merge to `main`:

```bash
git -C <repo> add <expected files>
git -C <repo> commit -m "<type>(<scope>): <one-line summary>"
git -C <repo> checkout main
git -C <repo> merge --no-ff quick/<slug>
```

One atomic commit — not one commit per file. No 5-stage `code-scope stage`
sequence (`complete` / `review` / `verify` / `merge` / `origin-cleanup`) —
that lifecycle gate belongs to `a1-new-feature`'s full pipeline, not the
quick lane.

If the user declines at the checkpoint: do not commit. Ask what to change,
return to Step 3 (or 4), or abandon the run (run record stays with
`result: in-progress` and a closing note).

## Step 7 — Close the run record

Update the run record's `## Outcome` section and frontmatter:
- **Completed**: `result: completed`, `escalated: false`, the commit's
  short-hash, and a one-line `retro:` field.
- **Escalated**: see "Tripwires" below (Wave 3 extends this skill with the
  full escalation procedure) — for now, note in the run record that a
  tripwire fired and which one.

## Tripwires (checked during Implement / Verify)

`a1-quick` hard-stops and hands off to the full pipeline the moment any of
these fire — see the Escalation handoff below for what happens next:

- A 3rd file becomes necessary (check before each new file edit).
- The diff exceeds the ~50-line budget (check after each edit via
  `git diff --stat`).
- A forbidden surface turns out to be touched (re-run the eligibility check's
  forbidden-surface logic against the actual changed paths, not just the
  declared scope).
- A second, distinct intent emerges during implementation (self-check).
- Verify fails twice in a row.
- (Fixes only) Root cause stays unclear after one focused investigation pass.

## Escalation handoff

On any tripwire: STOP implementation immediately. Set the run record's
`result: escalated`, `escalated: true`, and add a `handoff_seed:` block with
the intent/ACs/files gathered so far.

- **Kind `feature`**: tell the user this run record is being handed to
  `a1-new-feature` Phase 1 (Discover) as the mini-spec starting point.
- **Kind `fix`**: tell the user this run record is being handed to `a1-fix`
  Phase 1 (Report) as the bug-report draft starting point.

If a commit already exists on `quick/<slug>`: it is carried forward, never
discarded — adopt the branch into the full pipeline's worktree flow (same
mechanism as `a1-worktree adopt`; see `skills/a1-worktree/SKILL.md`).

## Run-record schema (FR-015)

Every run (completed or escalated) writes exactly one file at
`projects/<slug>/quick/<YYYY-MM-DD>-<slug>.md` with frontmatter:

| Field | Values |
|---|---|
| `type` | `quick-run` |
| `kind` | `feature` \| `fix` |
| `result` | `in-progress` \| `completed` \| `escalated` |
| `escalated` | `true` \| `false` |
| `files` | list of touched file paths |
| `diff_lines` | integer |
| `verify` | short summary string |
| `retro` | one-line retro (micro-retro variant — see `_shared/retro-template.md`) |

Template: `templates/run-record-template.md`.

## Hard rules

- Never spawn a sub-agent in the core flow (Steps 1–7). If a task turns out
  to need agent-level judgment, that itself is a signal to escalate, not a
  reason to bend this rule.
- Never use `git worktree add` — isolation is the `quick/<slug>` branch only.
- Never commit before the Step 5 checkpoint is confirmed.
- Never make more than one commit per run.
- Never touch a forbidden-surface path, even if discovered only after
  implementation started — that is an escalation tripwire, not a judgment
  call.
- Never silently drop a partial commit on escalation — it is always carried
  forward.

## Hand-offs

- Ineligible from the start, or escalates mid-run (feature intent):
  `a1-new-feature`.
- Ineligible from the start, or escalates mid-run (fix intent): `a1-fix`.
- Adopting an escalated `quick/<slug>` branch into a worktree: `a1-worktree`.
