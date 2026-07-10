# docs/product/ROADMAP.md — Schema v1 (draft, agreed 2026-07-10 brainstorm)

File: `docs/product/ROADMAP.md` in the project repo. English. Frontmatter = machine contract, body = human-readable.

```yaml
---
schema_version: 1
type: roadmap
project: <slug>
title: <Product name — Roadmap>
status: active            # active | paused | done
updated: YYYY-MM-DD
source: <origin of this data, e.g. "migrated from docs/roadmap.html (2026-07-10)">
milestones:               # machine index; mirrors the body sections
  - id: <m-slug>          # stable kebab-case slug
    title: <short>
    status: done|in-progress|planned
    target: YYYY-MM | null
features:                 # rolling wave: ALL features named, 1-sentence goal each
  - id: <###-feature-slug>
    milestone: <m-slug>
    title: <short>
    status: done|in-flight|planned|cancelled
    stage: null|started|complete|review|verify|merge|origin-cleanup|done   # lifecycle stage if in-flight
    depends_on: []        # feature ids
    started: YYYY-MM-DD|null
    finished: YYYY-MM-DD|null
next: <id of recommended next feature or null>
---
```

Body structure:
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
```

Rules:
- `<!-- entry: <slug> -->` markers on every milestone AND may appear per feature — this is the Wave-3 roadmap-linkage convention already live in a1-roadmap.
- Every feature in exactly one milestone. IDs never recycled.
- Changelog first entry documents the migration itself.
- Preserve ALL information from the source (phases, story points, dates, architecture notes may go into an `## Appendix — migrated details` section if they don't fit the schema).
