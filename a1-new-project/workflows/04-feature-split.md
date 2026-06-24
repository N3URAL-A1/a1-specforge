# Phase 4: Feature-Split

Decompose the scope + roadmap into concrete, implementable features. Produce a
**prioritized feature backlog** that the Phase 5 loop walks one feature at a
time. Each feature must be sized to roughly one `a1-new-feature` run.

## Sizing rule (avoid coarse AND fine)

- **One feature ≈ one shippable, user-visible capability ≈ one a1-new-feature run.**
- Too coarse (tag: `feature_split_too_coarse`): "build the whole dashboard" —
  that is a milestone, not a feature. Split it.
- Too fine (tag: `feature_split_too_fine`): "add a button" — that is a task
  inside a feature, not a feature. Merge it up.
- A good feature has its own acceptance criteria and could be demoed on its own.

## Derive features from the roadmap

Read `.a1/roadmap.md` and `.a1/scope.md`. For each milestone phase, list the
features it implies. Keep MVP features (from the scope's "MVP Capabilities")
ahead of "Later" features in priority order. Note cross-feature dependencies
(feature B needs feature A's data model) so the loop runs in a build-able order.

## Confirm the split with the user

Present the proposed backlog and priority order. Let the user reorder, merge,
or drop before anything is written:

```
Vorschlag Feature-Backlog (in Reihenfolge):

1. <feature> — <one-line goal>   [MVP]
2. <feature> — <one-line goal>   [MVP]   (braucht #1)
3. <feature> — <one-line goal>   [Später]

Passt die Reihenfolge? Was zusammenlegen / streichen / verschieben?
```

Wait for confirmation. Only then write the backlog.

## Write `.a1/features-backlog.md`

The backlog is the loop's source of truth. Per-feature `status` drives resume.

```markdown
---
type: feature-backlog
project: <slug>
created: <YYYY-MM-DD>
total: <N>
---

# Feature Backlog: <project name>

Status values: pending → in-progress → done (or cancelled).
The Phase 5 loop always works the first non-done feature top to bottom.

| # | Feature | Priority | Depends on | Status | Spec |
|---|---------|----------|-----------|--------|------|
| 1 | <feature-slug> | MVP | — | pending | — |
| 2 | <feature-slug> | MVP | 1 | pending | — |
| 3 | <feature-slug> | Later | — | pending | — |

## Feature 1: <feature-slug>
**Goal:** <one sentence>
**Why MVP:** <reason>
**Acceptance (rough):** <2-3 bullets — refined by a1-new-feature later>

## Feature 2: <feature-slug>
[...]
```

The `Spec` column is filled in Phase 5 with the Vault spec path that
`a1-new-feature` creates, so a resumed loop can find prior work.

## Create the Vault project hub

Mirror the project into the Vault so cross-project memory and `a1-new-feature`
have a home:

```bash
VROOT="${A1_VAULT_ROOT:-$HOME/N3URAL-Vault}"
mkdir -p "$VROOT/projects/<slug>/spec" "$VROOT/projects/<slug>/plans"
```

Write `projects/<slug>/<slug>.md` (project hub) with `type: project`,
`status: active`, the scope summary, and a link to the backlog. Follow the
Vault 7-type IA (project hub is the spine).

## Output

A confirmed, prioritized `.a1/features-backlog.md` with every feature `pending`,
plus the Vault project hub. Proceed to **Phase 5 (Feature-Loop)**.
