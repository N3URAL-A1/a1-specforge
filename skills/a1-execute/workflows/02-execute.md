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

## After all waves

Proceed to Phase 3 (Verify) automatically.
