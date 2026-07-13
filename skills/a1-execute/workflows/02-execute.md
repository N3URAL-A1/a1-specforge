# Phase 2: Execute Waves

Execute each wave via a1-erik-executor, with checkpoints between waves.

## Per-wave loop

For each wave in PLAN.md (skipping already-completed waves per STATUS.md):

### 2a. Spawn a1-erik-executor

```
Execute Wave <N> of the plan.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/RESEARCH.md
- .a1/phases/<phase_name>/STATUS.md
- ./CLAUDE.md (if exists)
</files_to_read>

**Wave:** <N>
**Phase dir:** .a1/phases/<phase_name>/
**Project path:** <project_path>
```

### 2b. Process wave result

After a1-erik-executor returns:

**If COMPLETE:**
```bash
git log --oneline -<task_count+2>
```
Show commit list to user.
Note: if the plan declares a one-commit-per-wave ground rule, the expected
commit count is per-wave, not per-task — expect one commit for the whole wave.

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
