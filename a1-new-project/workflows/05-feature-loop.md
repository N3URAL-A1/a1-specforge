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

Invoke the `checkpoint` skill (refresh mode) to:
- persist session state across all memory layers (project MEMORY.md, Vault,
  cloud brain), and
- **free the context window** ("content frei machen") before the next feature.

This is the heart of the loop: a clean context per feature prevents drift and
keeps each `a1-new-feature` run sharp. Skipping it is tagged `checkpoint_skipped`
in the retro.

After checkpoint, the context is fresh. Re-entry hits the "Loop invariant"
section above, reads the backlog, and picks the next `pending` feature
automatically. State carried forward = the backlog file only.

## Resume after a context reset

When the user comes back (or a new session re-triggers this skill) and a
`.a1/features-backlog.md` exists with non-`done` features:
- Do NOT re-bootstrap, re-scope, re-roadmap, or re-split.
- Jump straight here, apply the Loop invariant, continue the next feature.
The routing table in SKILL.md enforces this file-based entry.

## Loop complete

When every backlog feature is `done` (or `cancelled` by the user):

```
Alle Features abgearbeitet ✓

Projekt: <name>
Features done: <N>/<total>
Repo: <path>   (Remote: <ja/nein>)

Nächste Schritte: Deployment (Dirk/Dennis), oder neue Milestone via a1-roadmap.
```

Then write the Retro (below).

---

## Retro (mandatory, every run — pass or fail)

After the loop ends — completed, partial, or blocked — write one structured
entry. Takes 2 minutes. Do not skip. A run with no issues is still useful data:
write the entry.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-new-project/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: <project-slug> bootstrap (zero → feature backlog)
project: <project-slug>
result: <pass|fail|partial>
issues: [<relevant tags: scope_unclear, bootstrap_collision, feature_split_too_coarse, feature_split_too_fine, checkpoint_skipped, roadmap_handoff_failed, over_engineering, repo_already_exists>]
features_total: <N>
features_done: <N>
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

**To Vault (canonical):**
Append the same entry to:
`~/N3URAL-Vault/pattern/a1-learnings/a1-new-project.md`

Tags reference: `scope_unclear` (Phase 2 left ambiguity that bit later),
`bootstrap_collision` / `repo_already_exists` (Phase 1 hit existing files),
`feature_split_too_coarse` / `feature_split_too_fine` (Phase 4 sizing),
`checkpoint_skipped` (Phase 5 loop hygiene), `roadmap_handoff_failed`
(Phase 3 produced an empty roadmap), `over_engineering` (scaffolded or planned
more than the scope warranted).
