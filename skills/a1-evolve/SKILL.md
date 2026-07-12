---
name: a1-evolve
description: >
  Self-optimization engine for the a1 skill set. Reads accumulated observations
  (`.a1/phases/*/observations.jsonl`) and per-skill _learning.md files plus the
  learning store's `pattern/a1-learnings/*.md` (repo-local `.a1/learnings/` by
  default; set `A1_VAULT_ROOT` to use an external vault, e.g. Obsidian),
  clusters recurring patterns, scores
  by impact (frequency × severity), and proposes concrete diff-level
  improvements to agent files and SKILL.md / workflow files. Four phases:
  Collect → Cluster → Propose → Apply (with user confirmation per diff).
  Confidence thresholds: 1-2 occurrences = monitor, 3-4 = propose, 5+ =
  high-confidence. Commits applied changes to the skills repo (detected via git). MUST trigger
  when the user says: "a1-evolve", "improve skills" (alias: "skills
  verbessern"), "evaluate learnings" (alias: "learnings auswerten"), "what can
  we improve" (alias: "was können wir verbessern"), "skill optimization",
  "review retros" (alias: "retros auswerten"), "synthesize learnings", "pattern
  analysis", "improve the a1 skills", "evolve the agents", or when a1-execute
  reports 5+ accumulated learnings
  since last synthesis. Scope: only edits files in the skills repo — never
  touches ~/.claude/rules/ (user-authored). Do NOT activate for: a single
  retro entry (just write it via the host skill's Retro block), planning new
  features (use a1-new-feature), or routine project execution.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# a1-evolve — Self-Optimization Engine

Language: English-first; German trigger aliases supported.

Reads what went wrong and right across all a1 skill runs, then proposes precise, targeted
improvements to skill and agent files.

**Philosophy:** Skills improve through use, not through theorizing. Every observation is a
data point. Patterns that appear 3+ times across different projects are signal — not noise.

## Input sources

This is the ONE canonical list of what a1-evolve consumes. It must match the
description above. Any new learning store MUST be added here AND to the collect
globs in `workflows/01-collect.md` in the same commit (framework invariant 4).

| # | Source | What it contains |
|---|--------|-----------------|
| 1 | `~/.claude/skills/<skill>/_learning.md` | Per-skill _learning.md caches — per-run retros with structured observations |
| 2 | `.a1/phases/*/observations.jsonl` | Raw inline observations from agents during execution |
| 3 | Learning store `pattern/a1-learnings/*.md` | **Canonical learning store** — synthesized per-skill retros. Defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` to point at an external vault (e.g. Obsidian) as an optional sink instead |
| 4 | a1-fix postmortems | Learning store `wiki/postmortems/` (detail) + promoted lessons in `wiki/lessons/`, plus the normalized retros a1-fix appends to `pattern/a1-learnings/a1-fix.md` |

**Not an input:** `~/.claude/skills/_shared/learnings-index.md` is an OUTPUT cache
written by this skill after synthesis — it is never read as an input source.

### Learning-enabled skill set (honesty note)

"All skills" in the Philosophy line above means "all skills that write a Retro" —
not literally every skill in the repo. Verified live against every
`skills/*/SKILL.md` + `workflows/*.md` file (grep for a Retro heading), the
learning-enabled set is 15: `a1-execute`, `a1-analyze`, `a1-checklist`,
`a1-new-feature`, `a1-new-project` (originally documented group), `a1-fix`
(postmortem-based — a distinct mechanism, see source #4 above, not a
`_learning.md` Retro block), plus `a1-plan`, `a1-roadmap`, `a1-reconcile`,
`a1-modernize`, `a1-constitution` (added M11-audit-fixes Wave 6, Task 6.1),
plus `a1-phantom`, `a1-pr-review`, `a1-worktree` — all three carry a wired,
mandatory Retro block despite being deterministic gates or read-only
reporters. (`a1-check` was in this set until M13 retired it into
a1-checklist's checks #9/#10; its retro history migrated into
`a1-checklist/_learning.md`.) `a1-evolve` itself also retros (source of the
15th name above). Only `a1-progress`
(read-only status scan, confirmed no `_learning.md` and no retro mechanism
anywhere in its files) is genuinely excluded today. `hero-animation-builder`
follows no a1 convention (no `workflows/` dir) and was never a candidate (see
Wave 7 decision doc).

## Workflow

See `workflows/01-collect.md` → `02-cluster.md` → `03-propose.md` → `04-apply.md`

## Output

1. **Pattern report** — what's recurring, how often, what impact
2. **Diff proposals** — concrete edits to specific files with before/after
3. **Applied changes** — on user approval, commits to repo

## Confidence thresholds

| Occurrences | Action |
|---|---|
| 1-2 | Log in index, monitor |
| 3-4 | Propose improvement (user reviews) |
| 5+ | Propose with "high confidence" flag — suggest direct apply |

## Scope

a1-evolve only proposes changes to files in the skills repo (detected via git):
- `agents/*.md` — agent instructions
- `*/SKILL.md` — skill definitions
- `*/workflows/*.md` — workflow steps

It never auto-modifies `~/.claude/rules/` — those are user-authored.
