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
Proposed feature backlog (in order):

1. <feature> — <one-line goal>   [MVP]
2. <feature> — <one-line goal>   [MVP]   (needs #1)
3. <feature> — <one-line goal>   [Later]

Does the order work? Anything to merge / drop / reorder?
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
have a home. The hub note is `project/<slug>.md` — directly under `project/`,
never inside the project folder — and it declares the project's vault writer
host (`a1_writer_host:`, spec 010 FR-038). Order matters: the hub is written
BEFORE `project/<slug>/` exists, because a project folder without a hub is
`unreadable (hub_missing)` and every host then skips its mirror (fail-closed).

**Step 1 — the writer id of this host.** With an external vault
(`A1_VAULT_ROOT` set), ask a1-tools which id this host goes by:

```bash
WRITER_JSON="$(node <repo>/_shared/a1-tools.cjs vault writer --json)"
HOST_SOURCE="$(printf '%s' "$WRITER_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{process.stdout.write(JSON.parse(s).host_source)})')"
WRITER_ID="$(printf '%s' "$WRITER_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{process.stdout.write(JSON.parse(s).host)})')"
```

Stamp the hub only when `host_source` is `env`. Otherwise **STOP** and ask the
user to set `A1_HOST_ID` in a host-local file (`export A1_HOST_ID=<id>` in
`~/.zshenv`, never a synced dotfile) and open a new shell: with `os` the id is
the DHCP-derived hostname, which changes by itself, and with `invalid` it is
`<invalid>`, which makes the hub unreadable.

```bash
[ "$HOST_SOURCE" = "env" ] || { echo "STOP: set A1_HOST_ID (host_source is $HOST_SOURCE)"; exit 1; }
```

**Step 2 — write the hub, then the folders.** Write `project/<slug>.md` with
`type: project`, `status: active`, `a1_writer_host: <WRITER_ID>` (the `.host`
value from step 1, as one plain frontmatter line), the scope summary and a link
to the backlog. Follow the Vault 7-type IA (project hub is the spine). Only
after the hub exists create the project folder:

```bash
VROOT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
test -f "$VROOT/project/<slug>.md" || { echo "STOP: write the hub note first"; exit 1; }
mkdir -p "$VROOT/project/<slug>/spec" "$VROOT/project/<slug>/plans"
```

Without `A1_VAULT_ROOT` the hub lives in the repo-local tier, nothing is
mirrored and there is no writer to declare: skip step 1 and the key.
Hand-over to another host later is one command on the current writer:
`node <repo>/_shared/a1-tools.cjs vault writer <slug> --set <other id>`.

## Output

A confirmed, prioritized `.a1/features-backlog.md` with every feature `pending`,
plus the Vault project hub. Proceed to **Phase 5 (Feature-Loop)**.
