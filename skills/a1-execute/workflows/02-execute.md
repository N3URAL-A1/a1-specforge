# Phase 2: Execute Waves

Execute each wave via a1-erik-executor, with checkpoints between waves.

## Work path (`$WORK_PATH`)

Every git command below runs against `$WORK_PATH` — the worktree the wave
actually executes in, never the primary checkout:

```bash
WORK_PATH=<phase worktree path>        # sequential phase (Isolation Gate)
WORK_PATH=<lane worktree path>         # multi-lane: one per lane
```

Getting this wrong is silent: `git -C <primary checkout> rev-parse HEAD` in a
lane run measures a tree the executor never touched, so the commit-landed gate
below either reports a false "empty" or counts another lane's commits as this
one's.

## Per-wave loop

For each wave in PLAN.md (skipping already-completed waves per STATUS.md):

### 2a. Spawn a1-erik-executor

Record the pre-wave HEAD first — step 2b compares against it:

```bash
PRE_WAVE_HEAD=$(git -C "$WORK_PATH" rev-parse HEAD)
```

```
Execute Wave <N> of the plan.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/RESEARCH.md
- .a1/phases/<phase_name>/STATUS.md        (lane run: STATUS-<lane-id>.md)
- ./CLAUDE.md (if exists)
</files_to_read>

**Wave:** <N>
**Phase dir:** .a1/phases/<phase_name>/
**Project path:** $WORK_PATH
<lane runs only>
**Lane:** <lane-id> — write status to STATUS-<lane-id>.md, and expect only this
lane's earlier waves in the git history.
</lane runs only>
```

### 2b. Process wave result

After a1-erik-executor returns:

**If COMPLETE:**
```bash
git -C "$WORK_PATH" log --oneline "$PRE_WAVE_HEAD"..HEAD
git -C "$WORK_PATH" status --porcelain
```
Show commit list to user.
Note: if the plan declares a one-commit-per-wave ground rule, the expected
commit count is per-wave, not per-task — expect one commit for the whole wave.

**Commit-landed gate (blocking).** A "COMPLETE" report is a claim; HEAD is the
evidence. Treat the wave as NOT complete if either holds:

- `"$PRE_WAVE_HEAD"..HEAD` is **empty** → the executor changed nothing, or its
  work sits uncommitted. Do not advance to the next wave. Show
  `git status --porcelain` to the user: dirty tree → have the executor commit
  its own work (never commit it for them — the commit message and task
  attribution are theirs); clean tree → the wave did nothing, re-dispatch or
  escalate.
- `git status --porcelain` is **non-empty** after a COMPLETE report → part of
  the wave is uncommitted. Same handling: back to the executor before the
  checkpoint.

Observed 2026-07-22 (pro-orc 008): a fully implemented, 705-tests-green Wave 1
sat uncommitted in a worktree and was only noticed by Wave 2's agent — one
discarded worktree away from silent total loss. The next run (009) explicitly
demanded commit proof and was clean, so this gate is cheap and it works.

**Audit auto-close (FR-022):** if the project has `docs/product/audits/*.md`,
check each new wave commit message for the explicit closing convention before
moving to the checkpoint — see "Audit Auto-Close" below.

**If PARTIAL (some tasks blocked):**
Show which tasks are blocked and why.
Ask: "Wave <N> is partially complete. <N> tasks blocked. Continue to next wave or stop?"

**If BLOCKED (wave couldn't start):**
Surface error to user. Do not continue.

### 2c. Checkpoint

Present wave summary:
```
Wave <N> — <name> ✓ Complete
Tasks done: <N>/<N>
Commits: <list>
Deviations: <list or "none">

→ Next: Wave <N+1> — <name> (<N> tasks)
Continue? [y to proceed / n to stop]
```

Wait for user input before starting next wave.

## Audit Auto-Close (FR-022, spec `003-product-schema-v1.1-vision-audits`)

Wave commits can close tracked audit findings the same way a fix commit can.
This check runs once per wave, in Step 2b's COMPLETE branch, after the commit
list is retrieved and before the Step 2c checkpoint is shown.

**When it applies:** only if the project has `docs/product/audits/*.md`
(schema v1.1). If not, skip this section entirely — no note needed.

**Detection logic:** for each commit message in the wave's `git log` output,
match against:

```
/\b(closes?|fix(?:es|ed)?)\s+F-(\d{3})\b/i
```

- The keyword (`Closes`/`Close`/`Fixes`/`Fix`/`Fixed`, case-insensitive) MUST
  immediately precede the `F-0NN` token — e.g. `Closes F-007` or
  `Fixes F-012` match; a commit that merely mentions `F-007` in passing,
  without one of these keywords right before it, does NOT match and MUST NOT
  auto-close anything. This mirrors `a1-fix`'s identical Step 4.5 logic
  (`skills/a1-fix/workflows/03-fix.md`) — same regex, same rationale (a bare
  substring match is too false-positive-prone per FR-022).

**If a commit matches:** resolve which audit file contains the extracted
`F-0NN` finding id by searching `docs/product/audits/*.md` for a
`findings[]` entry with that `id`, then auto-call (no extra confirmation
step — the explicit convention is the deliberate signal):

```bash
node <repo>/_shared/a1-tools.cjs product audit-set \
  --audit <resolved-audit-path> \
  --finding <finding-id> \
  --status fixed \
  --commit <commit-sha>
```

**If no audit file contains the finding id** (or the project has no
`docs/product/` at all): skip silently and mention it in the wave summary
shown at the Step 2c checkpoint, e.g. "Commit `<sha>` used `Closes F-007`
but no audit file declares finding F-007 — skipped auto-close." Do not block
the checkpoint on this.

**If `audit-set` itself fails** (finding already `fixed`, invalid `--feature`
id, etc.): surface the CLI error in the wave summary as a note; never fail
the wave or block the checkpoint because of it.

## After all waves

Proceed to Phase 3 (Verify) automatically.
