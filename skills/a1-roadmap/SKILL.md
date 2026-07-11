---
name: a1-roadmap
description: >
  Create and manage project roadmaps — break a product vision into milestones,
  phases, and a scaffolded docs/product/ + .a1/ directory ready for a1-plan.
  Four phases: Discover (interview vision) → Research (a1-rico-researcher
  domain scan) → Structure (milestones + phases breakdown) → Scaffold (write
  docs/product/ROADMAP.md via the product CLI + .a1/roadmap.md + per-phase
  GOAL.md). Three modes: new-project (full flow), new-milestone (abbreviated,
  skips research if stack unchanged), and adopt (brownfield migration — derives
  the done-part of the roadmap from an evidence ladder — VERIFICATION.md,
  merged branches/commits, spec status=done — and interviews the user only for
  the undetermined future part; conflicting legacy state is resolved
  newest-evidence-wins with a logged changelog line). MUST trigger when the
  user says: "new project" (alias: "neues projekt"), "create a roadmap" (alias:
  "roadmap erstellen"), "a1-roadmap", "plan milestones" (alias: "milestones
  planen"), "set up a project" (alias: "projekt aufsetzen"), "project setup",
  "milestones" (alias: "meilensteine"), "create a milestone plan" (alias:
  "milestone plan erstellen"), "new milestone" (alias: "neue milestone"), "set
  up a project from scratch" (alias: "projekt von null aufsetzen"), "how do we
  structure the project" (alias: "wie strukturieren wir das projekt"), "plan the
  project from scratch", "break this product into milestones", "adopt this
  project" (alias: "projekt adoptieren"), "migrate the roadmap for <project>"
  (alias: "roadmap für <projekt> migrieren"), "bring this existing project into
  docs/product" (alias: "bestehendes projekt in docs/product überführen"), or
  any request to plan a project from scratch, add a new milestone to an
  existing project, or bring an existing (brownfield) project into the
  docs/product structure. Hands off to a1-plan once the first phase is
  scaffolded. Do NOT activate for: planning a single phase that already exists
  (use a1-plan), checking project status (use a1-progress), feature ideas
  without a project (use a1-new-feature), constitution/rules (use
  a1-constitution), or reverse-engineering a spec from code without a roadmap
  (use a1-modernize spec-only, which adopt mode may call into internally).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-roadmap — Project & Milestone Planning

Language: English-first; German trigger aliases supported.

Thin orchestrator. Phase logic in `workflows/`. a1-rico-researcher does domain research.

## When to use

Activate when the user wants to:
- Start a **new project** and plan its milestones and phases
- Add a **new milestone** to an existing project
- Get a **structured breakdown** of a product vision into executable phases

**Output:** `roadmap.md` in `.a1/` + phase directories scaffolded and ready for `a1-plan`.

## Modes

### New Project
Full flow: Discover → Research → Structure → Scaffold

### New Milestone
Abbreviated flow: Understand → Structure → Scaffold (skip full research if project already exists)

### Adopt (brownfield migration)
Brings an existing project — with or without `docs/product/` — into a valid
schema-v1 `docs/product/ROADMAP.md` **without** the user re-describing work
that is already provably done. Never triggered automatically — always an
explicit, confirmed hand-off from the on-touch rule in
`a1-new-feature`/`a1-execute`, or a direct user request ("adopt this
project", "migrate the roadmap for `<project>`").

**Never hand-writes `docs/product/` files.** Every write goes through
`node <repo>/_shared/a1-tools.cjs product ...` (`init` /
`add-milestone` / `add-feature` / `feature-init` / `stage` / `changelog`) —
same hard rule as every other mode. Adopt mode's job is to *derive the
arguments* to those CLI calls from evidence, and to *ask* for whatever
evidence can't answer.

#### Step 1 — Evidence ladder (derives the "done" part, FR-018)

For each candidate milestone/feature found in the project (from
`.a1/phases/*`, `.a1/roadmap.md`, an existing `docs/product/ROADMAP.md`, spec
files under a learning store, or — as a last resort — `a1-modernize`
spec-only reverse-spec), classify it as **done** using the first rung of this
ladder that matches; anything not caught by rungs (a)–(c) is weaker evidence
and falls through to the Step 2 interview instead of being guessed:

1. **(a) VERIFICATION.md present** — a `VERIFICATION.md` (at
   `.a1/phases/<name>/VERIFICATION.md`, or a root-level
   `VERIFICATION-<spec-id>.md` — both shapes are observed in real projects)
   with a PASS/verified verdict for that phase/feature → **done**.
2. **(b) Merged feature branch or commits referencing the feature** — a
   merged `feature/<slug>` branch, or `git log --oneline --grep` hits
   referencing the feature id/slug in commit subjects on the default branch
   → **done**. Query with:
   ```bash
   git -C <project-root> log --oneline --grep="<feature-slug>\|<feature-id>" --all
   git -C <project-root> branch --merged main | grep -i "<feature-slug>"
   ```
3. **(c) Spec frontmatter `status: done`** — a spec file (vault or
   repo-local learning store) with YAML frontmatter `status: done` for that
   feature → **done**.
4. **Weaker than (a)–(c)** (e.g. only a TODO comment, a partially-merged
   branch, an ambiguous commit) → do not guess; add it to the Step 2
   interview queue instead.

Evidence is gathered read-only; nothing is written during this step.

#### Step 2 — Interview for the future part (FR-019)

Everything the ladder could not classify as done — plus the entire
planned/rolling-wave future — is established by interview, **one question at
a time** (this project's standing convention; never a multi-part
questionnaire in one message):

1. Confirm the derived milestone list (name + one-sentence goal each) — ask
   once, allow edits, do not re-litigate per-feature.
2. For each feature the ladder left undetermined: ask a single yes/no or
   short-answer question ("Is `<feature/slug>` finished? If not, what
   milestone does it belong to and what's left?").
3. Ask for the future/planned milestones and features not present in any
   evidence at all (rolling-wave: names + one-sentence goals for everything
   known, not just the next one).
4. Confirm before writing anything — adopt mode changes shared project
   state, unlike the read-only Discover interview in New Project mode.

#### Step 3 — Write via CLI, newest-evidence-wins on conflict (FR-020)

Once confirmed, write the derived + interviewed structure through the CLI,
in this order, inside the target project's working directory:

```bash
node <repo>/_shared/a1-tools.cjs product init --project <slug> --title "<Product name>"
node <repo>/_shared/a1-tools.cjs product add-milestone --id <m-slug> --title "<short>" --status <planned|in-progress|done> --target <YYYY-MM|omit>
# repeat add-milestone per milestone, then per feature:
node <repo>/_shared/a1-tools.cjs product add-feature --id <###-slug> --milestone <m-slug> --title "<short>" --depends-on <a,b|omit>
# for every feature the evidence ladder (or the interview) marked done:
node <repo>/_shared/a1-tools.cjs product stage --by <###-slug> --set done
```

`product stage --set done` derives `status: done`, stamps `finished`, and
auto-appends its own changelog line — do not add a duplicate manual entry
for a plain done-marking.

**Conflict handling (FR-020):** when adopt mode finds legacy state that
disagrees with newer evidence (e.g. a stale `.planning/` directory, or a
`.a1/roadmap.md` entry, that contradicts what commit history / VERIFICATION
show), it MUST NOT silently pick one side. It takes the **newest** evidence
(by commit date / VERIFICATION timestamp — never by which file happens to be
read first) and logs the discrepancy as an explicit changelog line via the
CLI's changelog mechanism:

```bash
node <repo>/_shared/a1-tools.cjs product changelog \
  --entry "adopt: <milestone/feature> resolved from conflicting legacy state" \
  --why "<what disagreed, e.g. '.planning/<dir>/ marked in-progress but VERIFICATION.md (2026-07-06) and merged commits show done>; newest evidence (VERIFICATION.md) wins"
```

This changelog call is required whenever a conflict is detected — never skip
it because the resolution "seems obvious"; the discrepancy must be
discoverable later from `## Changelog` alone.

#### Notes

- May internally invoke `a1-modernize` in `spec-only` mode to reverse-spec
  code that has no spec at all, purely as an evidence source for the ladder
  — adopt mode does not depend on `a1-modernize`'s fix-plan/execute phases.
- On-touch, not big-bang: adopt mode is one deliberate, user-confirmed run
  per project, not a background migration — see "Hard rules" below.
- Fixture/regression coverage: `_test-fixtures/product-adopt/run.sh`.

## Phases

| # | Phase | Workflow | Agent | Output |
|---|---|---|---|---|
| 1 | Discover | `workflows/01-discover.md` | — (conversation) | Vision doc |
| 2 | Research | `workflows/02-research.md` | a1-rico-researcher | RESEARCH.md |
| 3 | Structure | `workflows/03-structure.md` | — (orchestrator) | Milestone/phase breakdown |
| 4 | Scaffold | `workflows/04-scaffold.md` | — (orchestrator) | .a1/ structure + roadmap.md |

## Storage

New projects scaffold **both** the `docs/product/` layer (schema v1, human +
machine contract — see `docs/product/SCHEMA.md`) and the `.a1/` layer
(machine execution state only — phases/waves/status). `docs/product/` is
never overwritten by hand; the Scaffold phase writes it exclusively via
`node <repo>/_shared/a1-tools.cjs product ...`.

```
docs/product/
├── ROADMAP.md              ← schema v1: ALL milestones + ALL features named
│                              upfront with 1-sentence goals (rolling wave)
├── NEXT.md                 ← generated — do not hand-edit (Wave 3 CLI output)
└── index.json               ← generated — do not hand-edit (Wave 3 CLI output)

.a1/
└── phases/                 ← one directory per phase, machine state only
    ├── M1-P1-<name>/
    ├── M1-P2-<name>/
    └── M2-P1-<name>/
```

Legacy projects (only `.a1/roadmap.md`, no `docs/product/`) are migrated via
`adopt` mode, on-touch — never big-bang (see "Adopt mode" below, landing in
Wave 5).

## Roadmap format

```markdown
---
project: <name>
created: <date>
---

# Roadmap: <project name>

## Vision
<one paragraph>

## Milestone 1: <name>
**Goal:** <one sentence>  
**Success:** <measurable outcome>

### Phase M1-P1: <name>
**Goal:** <one sentence>
**Scope:** <2-3 bullet points>
**Status:** planned

### Phase M1-P2: <name>
[...]

## Milestone 2: <name>
[...]
```

## Feature → Roadmap Linkage (machine-readable)

Every roadmap entry (milestone or phase) carries a **stable kebab-case slug** so
features can reference it deterministically without an LLM. This is what
`a1-new-feature`'s Phase 0 Roadmap Gate and `a1-execute`'s Load phase check
against.

### Entry marker

Add an HTML comment marker directly under each `##`/`###` heading in
`.a1/roadmap.md`:

```markdown
## Milestone 1: Auth & Onboarding
<!-- entry: m1-auth-onboarding -->
**Goal:** Ship a working login + signup flow.
**Success:** New user can sign up, verify email, log in.

### Phase M1-P1: auth-setup
<!-- entry: m1-p1-auth-setup -->
**Goal:** Wire up auth provider and session handling.
**Scope:** ...
**Status:** planned
```

Slug rules:
- kebab-case, derived from the milestone/phase name (lowercase, spaces → `-`,
  strip punctuation)
- unique within `roadmap.md`
- immutable once referenced by a feature spec — renaming the heading text is
  fine, the `entry:` slug never changes

### Feature-side reference

A feature's spec (and/or its wave-plan) carries a `roadmap_entry:` frontmatter
field pointing at the slug it belongs to:

```yaml
---
id: 007-password-reset
project: my-project
feature_slug: password-reset
roadmap_entry: m1-p1-auth-setup
status: draft
---
```

### Deterministic membership check (grep, no LLM)

```bash
# Does .a1/roadmap.md contain this entry slug?
grep -q "<!-- entry: m1-p1-auth-setup -->" .a1/roadmap.md && echo "FOUND" || echo "MISSING"
```

This is the exact check `a1-new-feature` Phase 0 and `a1-execute` Phase 1 run
before proceeding — read-only, deterministic, no parsing beyond a grep.

## In-flight features (roadmap view)

Whenever the roadmap is displayed (Discover/Structure confirm steps, Scaffold
confirmation, or on request), render an "In-flight features" section built
from the same reservation data a1-progress reads — never a separate source:

```bash
node _shared/a1-tools.cjs code-scope list --stale-days 7
```

For each `code_scope` reservation, render feature id (`by`), lifecycle
`stage`, and declared scope (`paths`). Group entries under their roadmap
entry when the feature's spec/wave-plan carries a matching `roadmap_entry:`
slug (see "Feature → Roadmap Linkage" above) — resolve the grouping by
matching the feature's `roadmap_entry` frontmatter value against the
`<!-- entry: <slug> --> ` markers in `.a1/roadmap.md`. Features with no
resolvable linkage are listed under an "Unlinked" group, not dropped.

```
## Milestone 1: Auth & Onboarding
<!-- entry: m1-auth-onboarding -->
...

  In-flight features:
    007-password-reset      stage: review    scope: src/auth/reset.ts

## Milestone 2: Payments
<!-- entry: m2-payments -->
...

  In-flight features:
    (none)

Unlinked:
  099-experimental-spike     stage: started   scope: src/spike/
```

Stale entries (per the `stale`/`hint` fields from `code-scope list
--stale-days 7`) are annotated the same way as in a1-progress — never
auto-released here either.

## docs/product Wiring (HARD RULE — CLI-only mutations)

All writes to `docs/product/ROADMAP.md`, `NEXT.md`, `index.json`, and any
`features/<###>-<slug>/feature.md` go through
`node <repo>/_shared/a1-tools.cjs product ...` — never hand-written
frontmatter or hand-edited generated files. The Scaffold phase
(`workflows/04-scaffold.md`) is the primary caller for new projects; see that
workflow for the exact CLI invocation that emits the full rolling-wave
`ROADMAP.md`.

## Hard rules

- Always confirm the milestone/phase breakdown with the user before scaffolding
- Phase names are in format `M<N>-P<N>-<kebab-name>` (e.g., `M1-P1-auth-setup`)
- Never scaffold more than one milestone ahead in `.a1/phases/` (avoids
  over-engineering the execution scaffold) — this does NOT limit
  `docs/product/ROADMAP.md`, which always names ALL milestones/features
  upfront per the rolling-wave contract (schema v1)
- If project has existing `.a1/`, add new milestone without touching existing phase dirs
- Never hand-write or hand-edit `docs/product/` artifacts — always through
  `a1-tools product ...`
- Never big-bang-migrate a legacy-only project — on-touch via `adopt` mode only
