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

Implement only the expected files listed in Step 2's spec-lite, and run these
three tripwire checks inline as you go (full definitions in "Tripwires"
below):

1. **Before touching any file not already in the spec-lite's expected-files
   list**, stop and check: does this make a 3rd distinct file? → tripwire
   T1.
2. **After every edit**, run `git -C <repo> diff --stat` and check the total
   changed-line count against the ~50-line budget → tripwire T2.
3. **While implementing**, self-check whether the change you're making still
   serves the single stated intent from Step 2, or whether a second,
   independent intent has crept in → tripwire T4.

If a change touches a path outside the declared scope, re-run the
forbidden-surface check from Step 1 (`quick eligibility`'s forbidden-surface
glob list) against the actual changed path, not just the originally declared
`--scope` → tripwire T3.

Any tripwire hit during this step → stop implementing immediately and go to
"Escalation handoff" below. Do not finish the edit in progress first.

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
4. **(Fixes only) Root-cause check.** If `kind: fix`, confirm the verify
   result actually explains the reported symptom (not just "tests pass").
   If, after this one focused look, the root cause is still unclear → check
   this once and record the outcome — a second unclear pass is tripwire T6.

Keep a run-scoped verify-failure counter, starting at 0. If verify fails:
fix and re-run once (counter → 1). If the 2nd consecutive run also fails
(counter → 2), that is tripwire T5 — stop, do not loop a third time.

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
- **Escalated**: follow "Escalation handoff" below — set `result: escalated`,
  `escalated: true`, and fill the `handoff_seed:` block before handing off.

## Tripwires (checked during Implement / Verify)

`a1-quick` hard-stops and hands off to the full pipeline the moment any of
these fire. Each has a stable ID (referenced from the run record's
`handoff_seed.tripwire` field) and an exact checkpoint — no tripwire is
checked "eventually", each one is checked at a named point in Step 3 or 4:

| ID | Condition | Checked where |
|---|---|---|
| T1 | A 3rd file becomes necessary | Step 3, before every new file edit — compare the file about to be touched against the expected-files list from Step 2's spec-lite; a 3rd distinct entry fires T1 |
| T2 | The diff exceeds the ~50-line budget | Step 3, after every edit — `git -C <repo> diff --stat` against `main`, sum of changed lines compared to the 50-line cap |
| T3 | A forbidden surface turns out to be touched | Step 3, whenever a path outside the declared `--scope` is touched, and again at the start of Step 4 — re-run the Wave-1 forbidden-surface check (the same glob list `quick eligibility` uses) against the actual changed paths from `git diff --name-only`, not just the originally declared scope |
| T4 | A second, distinct intent emerges | Step 3, ongoing self-check — does every edit still serve the single intent statement from Step 2? |
| T5 | Verify fails twice in a row | Step 4 — the verify-failure counter described there; fires when the counter reaches 2 |
| T6 | (Fixes only) Root cause stays unclear after one focused investigation pass | Step 4's root-cause check, `kind: fix` only — self-assessed once, fires if still unclear after that single pass |

## Escalation handoff

On any tripwire (T1–T6): STOP implementation immediately — do not finish the
edit or verify pass in progress. Then:

1. Set the run record's frontmatter: `result: escalated`, `escalated: true`.
2. Add a `handoff_seed:` block to the run record, filled from whatever was
   gathered in Steps 2–4 so far (never left empty — this is what SC-004
   calls a "non-empty seed artifact"):

   ```yaml
   handoff_seed:
     tripwire: T1              # the ID from the table above that fired
     intent: "<the Step 2 intent statement, verbatim>"
     acceptance_checks:
       - "<AC 1>"
       - "<AC 2, if present>"
     files:
       - "<files actually touched so far, from git diff --name-only>"
     diff_lines: <n>            # from the last git diff --stat check
     notes: "<one line: what was learned before the tripwire fired>"
   ```

3. Tell the user, based on `kind`:
   - **`kind: feature`**: "hand this run record to `a1-new-feature` Phase 1
     as the Discovery starting point" — the `handoff_seed` block pre-fills
     Rene's mini-spec interview (intent, ACs, and files already known, no
     need to re-ask from scratch).
   - **`kind: fix`**: "hand this run record to `a1-fix` Phase 1 as the
     bug-report draft starting point" — the `handoff_seed` block pre-fills
     the bug report (symptom/intent, expected files, and — for T6 — the
     partial root-cause notes already gathered).

4. **If a commit already exists on `quick/<slug>`** (i.e. Step 3 reached a
   point where work was committed before the tripwire fired — not the
   common case, since Step 6's commit only happens after the Step 5
   checkpoint, but possible if a partial commit was made deliberately mid-
   implementation): do not discard it. Instruct adopting the branch into the
   full pipeline's worktree flow using the exact same mechanism
   `a1-worktree adopt` uses — `cmdWorktreeAdopt` in
   `_shared/lib/worktree.cjs`, invoked as:

   ```bash
   node <repo>/_shared/a1-tools.cjs worktree adopt <repo-root> <slug> --branch quick/<slug>
   ```

   This is the same adopt path documented in
   `skills/a1-worktree/SKILL.md` (Phase 4, `workflows/04-adopt-reconcile.md`)
   for out-of-band branches — reuse it as-is, do not build a second
   adoption mechanism. Once adopted, the branch behaves like any worktree
   entry: the full pipeline's implementing agent continues on it, and the
   original `quick/<slug>` commit stays reachable, never force-discarded.

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
