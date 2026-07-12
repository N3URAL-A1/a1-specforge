# Phase 5: Feature-Loop

Walk the backlog one feature at a time. After EACH feature: checkpoint (save
state across all memory layers AND free the context window), then start the
next. The loop is fully resumable from `.a1/features-backlog.md` — never from
context.

## Loop invariant (read this first on every (re-)entry)

All progress lives in the file, not in the context window. On entry — including
a fresh context after `checkpoint` — do:

1. Read `.a1/features-backlog.md`.
2. Find the first feature whose status is NOT `done`/`cancelled` (top to bottom,
   respecting `Depends on`).
3. That is the feature to work. If all are `done` → the loop is complete; go to
   "Loop complete" below.

This is why the loop survives a context reset: the backlog file IS the program
counter.

## Per-feature iteration

For the selected feature:

### 1. Mark in-progress

Update its row in `.a1/features-backlog.md`: `pending → in-progress`. Use an
atomic edit on the table row. (No spec exists yet, so a1-tools `spec
update-status` does not apply at this point — that operates on the feature
spec, which `a1-new-feature` creates next.)

### 2. Run a1-new-feature

Invoke the `a1-new-feature` skill for this feature, in the target project,
feeding the feature goal + rough acceptance from the backlog as the Discover
input. Let it run its full pipeline (Discover → Specify → Clarify → Plan →
Consistency Gate → Implement → Verify), including its own Isolation Gate /
worktree handling. Do NOT bypass any of a1-new-feature's phases or gates.

When `a1-new-feature` creates the spec, capture its Vault path
(`projects/<slug>/spec/<###>-<feature-slug>.md`) and write it into the `Spec`
column of the backlog row — so a resumed loop can locate prior work.

### 3. Mark done

When `a1-new-feature` reaches Verify = pass and the feature is merged: update
the backlog row `in-progress → done`. If it could not complete (blocked), leave
it `in-progress`, note the blocker in the feature section, surface to the user,
and stop the loop — do not silently skip to the next feature.

### 4. Checkpoint (MANDATORY — do not skip)

Invoke the `checkpoint` skill (refresh mode) to persist session state across all
memory layers (project MEMORY.md, Vault, cloud brain) and prepare to free the
context window before the next feature. Skipping it is tagged `checkpoint_skipped`
in the retro.

**Know how checkpoint actually ends the context.** The `checkpoint` skill does
NOT clear the context itself — it saves everything, then instructs the user to
type `/clear`. So the boundary between features is a real handoff, not a silent
auto-continue:

1. Run `checkpoint` → it saves state and prints a clear instruction + the resume
   pointer.
2. **Surface the resume pointer to the user explicitly**, e.g.:
   ```
   Feature <N> ✓ — state saved. Type /clear, then say "a1-new-project continue"
   (or "a1-new-project weiter", or just restart a1-new-project) — the loop reads
   .a1/features-backlog.md and continues with Feature <N+1>. Nothing is lost; the
   state lives in the file.
   ```
3. On the next (fresh-context) invocation, the SKILL.md routing table sees a
   backlog with non-`done` features and re-enters here at the Loop invariant.

This is why the loop is **resumable, not unattended**: state carried forward =
the backlog file only. If the user prefers to keep going in the SAME context
without `/clear` (smaller projects, healthy context budget), that is allowed —
still run checkpoint to save state, just skip the `/clear` step and continue
straight to the next feature. The hard requirement is the *save*, not the clear.

## Resume after a context reset

When the user comes back (or a new session re-triggers this skill) and a
`.a1/features-backlog.md` exists with non-`done` features:
- Do NOT re-bootstrap, re-scope, re-roadmap, or re-split.
- Jump straight here, apply the Loop invariant, continue the next feature.
The routing table in SKILL.md enforces this file-based entry.

## Loop complete

When every backlog feature is `done` (or `cancelled` by the user):

```
All features completed ✓

Project: <name>
Features done: <N>/<total>
Repo: <path>   (Remote: <yes/no>)

Next steps: deployment (Dirk/Dennis), or a new milestone via a1-roadmap.
```

Then write the Retro (below).

---

## Retro (mandatory, every run — pass or fail)

After the loop ends — completed, partial, or blocked — write one retro entry
per `_shared/retro-template.md` (entry format + write targets: learning store
first, dev cache best-effort), with skill = `a1-new-project` and these
**additional fields**: `features_total: <N>`, `features_done: <N>`.

- task wording: `<project-slug> bootstrap (zero → feature backlog)`
- issue tags: [scope_unclear, bootstrap_collision, feature_split_too_coarse,
  feature_split_too_fine, checkpoint_skipped, roadmap_handoff_failed,
  over_engineering, repo_already_exists]

Tags reference: `scope_unclear` (Phase 2 left ambiguity that bit later),
`bootstrap_collision` / `repo_already_exists` (Phase 1 hit existing files),
`feature_split_too_coarse` / `feature_split_too_fine` (Phase 4 sizing),
`checkpoint_skipped` (Phase 5 loop hygiene), `roadmap_handoff_failed`
(Phase 3 produced an empty roadmap), `over_engineering` (scaffolded or planned
more than the scope warranted).
