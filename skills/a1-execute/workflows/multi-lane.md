<!-- load: conditional trigger=lane-split check -->
# Multi-lane phases

Waves run sequentially unless PLAN.md's frontmatter declares lanes (written by
a1-pablo-planner Step 4.5, verified by `lane-split check` in `a1-plan`). A lane
is an arbeitseinheit under R1 above — one worktree, one branch, one executor.
N lanes = N worktrees, same rules as N phases, no new convention.

Step 1 (the check) runs in SKILL.md; the `--imports` rationale and steps 2-7 follow here.

   **Pass `--imports`, always.** Without it the JSON reports
   `imports_checked: false` and the run only compared declared path sets. Two
   lanes can own disjoint files and still depend on each other by importing
   across them — no overlap, real dependency, and they cannot run concurrently.
   That gap is why this gate fired 15 times with zero catches: at plan time
   there is no code to read, so it was only ever asked the question it could not
   answer. Check `imports_checked` in the output before trusting a PASS.
2. **Claim each lane's scope separately** (`a1-tools.cjs code-scope`), branch
   `feature/<phase-slug>-<lane-id>`; each lane branches off the phase branch, after Phase start
   (`workflows/02-execute.md`), so it inherits the tracked event stores. STOP on overlap — never "just this once".
3. **One executor per lane**, spawned concurrently, each with `$WORK_PATH` set
   to its own worktree and a `**Lane:**` line in its brief.
4. **Status per lane** — `STATUS-<lane-id>.md`. Never one shared STATUS.md:
   concurrent appends interleave, or produce N copies of which N-1 die at merge.
5. **`wave next-check` per lane**, not one global checkpoint — a blocked storage lane
   must not hold up a green runtime lane.
6. **Stage transitions exactly once, in the primary checkout, after the last
   lane merges.** The docs/product HARD RULE above mutates shared state; N lanes
   calling `product stage` concurrently is the R2 collision class by another
   name. Lane checkpoints are stage-neutral.
7. **Merge lanes one at a time**, each green, before any wave in
   `sequential_after_lanes:` starts. Then consolidate the per-lane STATUS files
   into STATUS.md — before the remaining waves run and before Victor is
   spawned, since both read the consolidated file.


Lanes are for independent subsystems. A wave that switches DNS, cuts over the
production database, or flips a live ENV is single-lane by nature — the check
rejects it inside a lane, and that rejection is not to be worked around.
