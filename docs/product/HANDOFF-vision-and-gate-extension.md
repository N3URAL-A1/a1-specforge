# Handoff: `docs/product/` Schema Extension — Vision + Gate Feature Type

Status: **proposal, not yet implemented**. Written 2026-07-15 during Pro Orc's
`001-detail-roadmap-redesign` feature work as a forward reference — Pro Orc's
new Roadmap UI reads whatever this schema provides today (§1–§4 of
`docs/product/SCHEMA.md`) and does **not** depend on this extension shipping.
Implement this separately, in this repo's own thread, whenever convenient.

## Why

Auditing niimo's `docs/roadmap.html` / vision-and-audit HTML mockups against
the current `docs/product/` schema (SCHEMA.md v1) surfaced two gaps: the
schema has no home for a product **vision statement**, and no way to mark a
feature as a **blocking gate** (a decision/approval/legal step that blocks
downstream work) as opposed to an ordinary feature. Pro Orc's new Roadmap tab
wants to render both prominently (a vision header on the roadmap overview,
and gates visually distinct — e.g. amber/warning styling — from regular
in-flight features) but has nothing to read today.

## Proposal 1 — `docs/product/VISION.md`

A new optional top-level file, sibling to `ROADMAP.md`:

```markdown
---
schema_version: 1
type: vision
project: <slug>
updated: YYYY-MM-DD
---

# <Product name> — Vision

> One-paragraph vision statement (the "why" of the product, not a feature list).

## Pillars

- **<Pillar name>** — 1-2 sentence description.
- **<Pillar name>** — 1-2 sentence description.
(3-4 pillars typical, matching the audit-HTML reference's "pillars" grid)
```

- Optional file — its absence is not an error; consumers (Pro Orc) show no
  vision header if the file is missing, same graceful-degradation convention
  as every other tier in the roadmap fallback chain.
- `index.json` gains an optional top-level field `"vision": { "statement":
  "...", "pillars": [{"name": "...", "description": "..."}] } | null`, ← ←
  populated from VISION.md when present, `null` otherwise. Same
  generated/machine-owned convention as the rest of `index.json`.
- English-only rule (FR-016) applies to this file like every other
  `docs/product/` artifact.
- `a1-roadmap`'s Discover phase gains an optional interview question ("one
  paragraph vision + pillars?") when scaffolding a brand-new roadmap; existing
  roadmaps are not retroactively required to add one.

## Proposal 2 — Gate feature type

Extend the `features[]` entry shape (both `ROADMAP.md` frontmatter and
`index.json`) with one new optional field:

```yaml
features:
  - id: <###-feature-slug>
    ...                        # all existing fields unchanged
    kind: feature | gate        # NEW, optional, default "feature" when absent
```

- `kind: gate` marks a feature as a blocking decision/approval/external
  dependency rather than a unit of implementation work — e.g. niimo's "Robert
  — 5 Open Decisions freigeben" or "Ludwig: DSGVO Bildverarbeitung" entries in
  its legacy `docs/roadmap.html`.
- Backward-compatible: every existing `features[]` entry across all three
  fixture projects (this repo, niimo, n3ural-platform — see SCHEMA.md §5)
  omits `kind`, which defaults to `feature`. No migration required for
  existing data.
- Rendering convention (consumer-side, e.g. Pro Orc): gates get a distinct
  visual treatment (amber/warning accent) in both the milestone-lane list and
  the feature-card grid, same idea as the audit-HTML's honey-colored "GATE"
  badges. Gates still participate in `depends_on` normally — a regular
  feature can depend on a gate the same way it depends on another feature.
- `product add-feature` CLI gains an optional `--kind gate` flag (default
  `feature`); `product validate` accepts both enum values.

## Suggested implementation shape (for the a1-skills thread)

1. Update `docs/product/SCHEMA.md` §1 (ROADMAP.md frontmatter), §3
   (index.json), and `index.schema.json` — add `kind` enum to the feature
   shape, add the optional top-level `vision` object.
2. Update `_shared/a1-tools.cjs`:
   - `product add-feature` — accept `--kind gate|feature`, default `feature`.
   - `product init` / regeneration logic — read `VISION.md` if present,
     project it into `index.json`'s new `vision` field.
   - `product validate` — validate `kind` enum, validate VISION.md frontmatter
     when the file exists.
3. Re-validate against the same three fixtures listed in SCHEMA.md §5 (this
   repo, niimo, n3ural-platform) to confirm no drift — all three currently
   omit `kind` (fine, defaults apply) and have no `VISION.md` (fine, optional).
4. Optional follow-up: `a1-roadmap`'s adopt-mode migration (importing legacy
   `docs/roadmap.html`-style files) could auto-detect gate-like entries (e.g.
   rows whose legacy `custom_class` was `"gate"` in a Frappe-Gantt task list,
   as seen in niimo's old `docs/roadmap.html`) and set `kind: gate`
   automatically during import, with everything else defaulting to `feature`.

## Non-goals

- No change to the `stage` lifecycle vocabulary (`CODE_SCOPE_STAGES`) — gates
  use the same stages as regular features (a gate can be `planned`, then
  `started` while awaiting approval, then `done` once cleared).
- No new top-level file beyond `VISION.md` — pillars live inside it, not as
  separate files.
- Not scoped here: any Pro Orc-side rendering code. That lives in Pro Orc's
  own `001-detail-roadmap-redesign` feature and will consume `vision`/`kind`
  once they exist, degrading gracefully (no vision header, no gate styling)
  until this extension ships.
