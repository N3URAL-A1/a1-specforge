# docs/product/ — Schema v1 (binding contract)

Status: **binding** (promoted from draft 2026-07-10). Any writer (human, skill, or CLI) MUST
conform to this document. `docs/product/index.schema.json` is the machine-checkable twin of the
`index.json` section below — field names are identical in both.

This directory is the single source of truth for a project's roadmap, milestones, and
in-flight features, readable by ProOrg and by every a1 skill. It replaces ad-hoc
`.a1/roadmap.md` / `docs/roadmap.html` / `docs/roadmap.md` conventions going forward (see
`FR-011` / `FR-017` for gate + migration behavior — out of scope for this document, which
defines the contract only).

## 0. English-only rule (FR-016)

All `docs/product/` artifacts — `ROADMAP.md`, `NEXT.md`, `CHANGELOG-archive.md`, and every
`features/<###>-<slug>/*.md` file — **MUST be authored in English**, regardless of the
project's other documentation language. This applies to frontmatter values and body prose
alike. Rationale: these files are the cross-project machine/human contract (ProOrg, adopt
mode, import) and must be diffable and parseable independent of project locale.

## 1. `docs/product/ROADMAP.md` — frontmatter contract (FR-001)

File: `docs/product/ROADMAP.md` in the project repo. Frontmatter = machine contract, body =
human-readable narrative. Every field below is required unless marked optional.

```yaml
---
schema_version: 1                # int, current: 1
type: roadmap                    # const "roadmap"
project: <slug>                  # kebab-case project identifier
title: <Product name — Roadmap>  # human title, English
status: active                   # active | paused | done
updated: YYYY-MM-DD              # last-write date, ISO 8601
source: <string>                 # provenance, e.g. "migrated from docs/roadmap.html (2026-07-10)"
milestones:                      # machine index; mirrors body "## Milestones" sections
  - id: <m-slug>                 # stable kebab-case slug, never recycled
    title: <short>               # human title
    status: done|in-progress|planned
    target: YYYY-MM | null       # target month, or null if unscheduled
features:                        # rolling wave: ALL features named upfront, 1-sentence goal each
  - id: <###-feature-slug>       # 3-digit zero-padded sequence + kebab-slug, never recycled
    milestone: <m-slug>          # must reference an id in milestones[]
    title: <short>               # human title
    status: done|in-flight|planned|cancelled
    stage: null|started|complete|review|verify|merge|origin-cleanup|done
                                  # lifecycle stage while in-flight; null when not in-flight.
                                  # Values reuse CODE_SCOPE_STAGES (_shared/a1-tools.cjs) —
                                  # do not invent a parallel stage vocabulary.
    depends_on: []                # array of feature ids this feature depends on
    started: YYYY-MM-DD | null    # date work began, or null if not yet started
    finished: YYYY-MM-DD | null   # date work completed, or null if not yet finished
    spec_path: <path> | null      # optional: repo-relative path to the feature's spec doc
    plan_path: <path> | null      # optional: repo-relative path to the feature's wave-plan doc
next: <id> | null                # id of the recommended next feature, or null
---
```

Notes:
- `milestones[]` and `features[]` are the machine index; the body sections under `## Milestones`
  render the same data for humans and MUST stay in sync (the CLI regenerates both together —
  see Wave 2/3; this document only defines the shape).
- `spec_path` / `plan_path` are optional at the ROADMAP.md level because not every feature has
  a formal spec/plan (pre-schema or trivial features) — when present they point at the same
  paths recorded in the feature's own `feature.md` frontmatter (see §2) and in `index.json` (§3).
- Every feature belongs to exactly one milestone. IDs (milestone and feature) are never recycled.

### Body structure

```markdown
# <Title>

> One-paragraph vision/goal.

## Milestones

### <Milestone title> <!-- entry: <m-slug> -->
Status: … · Target: …
Goal: 1-2 sentences.

**Features:**
- [x]/[~]/[ ] **<id>** — <title>: <1-sentence goal> (depends on: …)
  ([x]=done, [~]=in-flight, [ ]=planned)

## In-flight features
(section rendered from reservations when present; "none" otherwise)

## Changelog
- **YYYY-MM-DD** — <what changed> — <why>

## Appendix — migrated details
(optional; see §4)
```

Rules:
- `<!-- entry: <slug> -->` markers on every milestone, and optionally per feature — this is the
  roadmap-linkage convention already live in `a1-roadmap`.
- The Changelog's first entry documents the migration itself (when the file was adopted/migrated
  from a prior format).

## 2. `docs/product/features/<###>-<slug>/` — directory contract (FR-004)

Each in-flight or planned feature that has a formal spec/plan gets its own directory:

```
docs/product/features/<###>-<slug>/
├── feature.md      # required — frontmatter + body, see below
├── spec.md         # optional — full specification
└── plan.md         # optional — wave plan
```

- `<###>-<slug>` MUST match the feature's `id` in `ROADMAP.md` `features[]` exactly (same
  3-digit sequence + kebab-slug).
- Features without a directory are still valid — the directory is created once a feature gets
  a formal spec/plan (see FR-015/FR-017 for the on-touch creation rule; out of scope here).

### `feature.md` frontmatter contract

Required fields, English-only:

```yaml
---
id: <###-feature-slug>            # matches ROADMAP.md features[].id and the directory name
project: <slug>                   # matches ROADMAP.md project
milestone: <m-slug>               # matches ROADMAP.md milestones[].id
title: <short>                    # human title
status: done|in-flight|planned|cancelled
stage: null|started|complete|review|verify|merge|origin-cleanup|done
depends_on: []                    # array of feature ids
started: YYYY-MM-DD | null
finished: YYYY-MM-DD | null
spec_path: <path> | null          # repo-relative path to spec.md (this dir or elsewhere)
plan_path: <path> | null          # repo-relative path to plan.md (this dir or elsewhere)
schema_version: 1                 # int, current: 1
---

<body — English, human-readable feature summary>
```

`feature.md`'s `status`/`stage`/`depends_on`/`started`/`finished` MUST always mirror the same
feature's entry in `ROADMAP.md` `features[]` — they are two views of one fact, kept in sync by
the same atomic write (see Wave 2; out of scope for this schema document).

## 3. `docs/product/index.json` — manifest shape (FR-003)

`index.json` is a **generated, machine-owned** file (never hand-edited) that gives ProOrg and
other external readers a flat, single-file view of the whole roadmap without parsing Markdown
frontmatter. It is regenerated on every state-changing operation. Encoded formally in
`docs/product/index.schema.json` (JSON Schema draft 2020-12) — field names below are identical
to that schema.

```jsonc
{
  "schema_version": 1,
  "generated": "2026-07-10T12:00:00Z",   // ISO 8601 UTC timestamp of generation
  "project": {
    "id": "<slug>",
    "title": "<Product name>",
    "status": "active"                    // active | paused | done
  },
  "milestones": [
    {
      "id": "<m-slug>",
      "title": "<short>",
      "status": "done",                   // done | in-progress | planned
      "target": "2026-09"                 // YYYY-MM or null
    }
  ],
  "features": [
    {
      "id": "<###-feature-slug>",
      "milestone": "<m-slug>",
      "title": "<short>",
      "status": "in-flight",              // done | in-flight | planned | cancelled
      "stage": "review",                  // null | started|complete|review|verify|merge|origin-cleanup|done
      "depends_on": ["<other-feature-id>"],
      "started": "2026-07-01",            // YYYY-MM-DD or null
      "finished": null,                   // YYYY-MM-DD or null
      "spec_path": "docs/product/features/012-foo/spec.md",  // or null
      "plan_path": "docs/product/features/012-foo/plan.md"   // or null
    }
  ],
  "next": "<feature-id>",                 // recommended next feature id, or null
  "cursor": "<feature-id>"                // pagination/resume cursor for consumers walking the
                                           // feature list incrementally; same id space as `next`,
                                           // may differ from it (next = recommendation, cursor =
                                           // resume position); null when there is nothing to resume.
}
```

Field-by-field mapping to §1/§2:
- `project.*` ← `ROADMAP.md` frontmatter `project`/`title`/`status`.
- `milestones[]` ← `ROADMAP.md` frontmatter `milestones[]`, verbatim.
- `features[]` ← `ROADMAP.md` frontmatter `features[]`, verbatim, with `spec_path`/`plan_path`
  filled from the corresponding `features/<###>-<slug>/feature.md` frontmatter when present.
- `next` ← `ROADMAP.md` frontmatter `next`.
- `cursor` ← generator-owned; not stored in `ROADMAP.md` frontmatter (derived at generation
  time from the in-flight feature list — first not-yet-`done` feature in dependency order).
- `generated` / `schema_version` ← generator-owned metadata, not mirrored from ROADMAP.md.

## 4. Appendix convention (FR-022)

When migrating or authoring content that does not map to any field in this schema (e.g. story
points, historical phase numbers, freeform architecture notes from a legacy roadmap format),
it MUST be preserved — never silently dropped — under a body section:

```markdown
## Appendix — migrated details

<verbatim or lightly-reformatted content that has no home in the schema above>
```

This section is optional (omit it if there is nothing un-mappable) but when present it is the
single sink for such content — do not scatter un-mappable content elsewhere in the body.

## 5. Fixture validation (2026-07-10)

Validated against this finalized contract:

| Fixture | Result |
|---|---|
| `docs/product/ROADMAP.md` (this repo, a1-specforge) | Conforms. Has `## Changelog`, `## Appendix — migrated details`, `next: null`. |
| `/Users/rob/code/niimo/docs/product/ROADMAP.md` | Conforms. Has `## Changelog`, `## Appendix — migrated details`, `next: 007-gate-open-decisions`. |
| `/Users/rob/code/n3ural-platform/docs/product/ROADMAP.md` | Conforms. Has `## Changelog`, `## Appendix — migrated details`, `next: 009-dsgvo-contract-package`. |

No field drift found — all three fixtures already carry `schema_version`, `type`, `project`,
`title`, `status`, `updated`, `source`, `milestones[]`, `features[]` (with `id`, `milestone`,
`title`, `status`, `stage`, `depends_on`, `started`, `finished`), and `next`, matching §1
exactly. None of the three yet has a `features/<###>-<slug>/` directory or `spec_path`/
`plan_path` populated in frontmatter — both are optional per §1/§2, so this is not drift; it is
expected until a feature gets a formal spec/plan (Wave 4, FR-015, on-touch creation).
