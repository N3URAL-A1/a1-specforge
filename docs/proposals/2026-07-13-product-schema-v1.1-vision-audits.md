---
type: proposal
project: a1-specforge
title: "Product docs schema v1.1 — VISION.md + audit surface"
status: draft
created: 2026-07-13
author: "Fable 5 session in niimo (Robert)"
target_pipeline: a1-new-feature
predecessor_spec: 002-product-docs-layer
fixtures:
  - "niimo docs/product/ (commit 0e2d3a6, 2026-07-13) — manual reference migration"
references:
  - "niimo: docs/product/ROADMAP.md (53 features incl. mirrored audit findings 023-053)"
  - "niimo vault analysis: projects/niimo/analyses/2026-07-05-general.md (31 findings, machine frontmatter)"
  - "presentation artifact: 'Niimo — Audit, Vision & Roadmap' (claude.ai artifact 487e1605, 2026-07-05)"
  - "schema v1 contract: docs/product/SCHEMA.md + index.schema.json"
  - "Pro Orc consumer concept: 'Pro Orc M8 — Konzept Projekt-Hub' (claude.ai artifact c3e13420, 2026-07-12)"
---

# Proposal: Product docs schema v1.1 — VISION.md + audit surface

> **TL;DR (Deutsch):** Die manuelle Migration des Niimo-Dokuments „Audit, Vision & Roadmap"
> nach `docs/product/` (2026-07-13) hat zwei Schema-Lücken aufgezeigt: Produktvision und
> Audit-Ergebnisse haben keinen maschinenlesbaren Platz im v1-Vertrag. Dieser Vorschlag
> definiert beide als optionale v1.1-Erweiterungen plus die CLI-Kommandos, damit Pro Orc
> Vision- und Audit-Panels rein aus dem File-Contract rendern kann. Aufgreifen im
> a1-specforge-Thread via `a1-new-feature`.

## 1. Problem

Schema v1 (spec `002-product-docs-layer`) covers roadmap, features, next-step markers and
the generated manifest. Two content classes that real projects demonstrably produce have no
home in the contract:

1. **Product vision.** The niimo migration had to fold the vision (mission statement +
   3 pillars) into the free-text ROADMAP.md body. That works for humans but is invisible to
   `index.json` — Pro Orc cannot render a vision panel without parsing prose.
2. **Audit results.** a1-analyze produces structured findings (id, severity, category,
   location, description, recommendation — see the niimo analysis frontmatter), but the
   product layer has no surface for them. In niimo we mirrored all 31 findings as roadmap
   features (023-053) — good for work tracking, but the audit-level aggregates (scorecard
   5/11/15, fixed-vs-open trend, finding→feature mapping, validation history) live nowhere
   machine-readable. A consumer cannot answer "what did the last audit say and how much of
   it is closed?" from the contract.

Both gaps were bridged manually on 2026-07-13; the manual result is committed in niimo
(`0e2d3a6`) and serves as the reference fixture for this feature.

## 2. Proposed extensions (v1.1, all optional / backward-compatible)

### 2a. `docs/product/VISION.md`

```yaml
---
schema_version: 1          # bumped only if field semantics change
type: vision
project: <slug>
title: "<Product name> — Vision"
updated: YYYY-MM-DD
pillars:                   # optional, machine-readable core claims
  - id: <slug>
    title: "<short>"
    summary: "<one sentence>"
---

<body — free-form vision narrative, English (FR-016)>
```

- Optional file. Absence is valid v1.1.
- `pillars[]` is the machine-readable part Pro Orc renders as cards; the body is prose.
- Frontmatter machine-owned (CLI), body human-owned — same split as ROADMAP.md.

### 2b. `docs/product/audits/<YYYY-MM-DD>-<focus>.md`

One file per completed a1-analyze run that the project owner chooses to publish into the
product layer (not every analysis auto-publishes — publishing is an explicit CLI step).

```yaml
---
schema_version: 1
type: audit
project: <slug>
focus: general|security|architecture|quality|onboarding
date: YYYY-MM-DD
source: "<path to the canonical analysis in the learning store / vault>"
verdict: "<one line, e.g. 'beta-ready, 5 launch blockers'>"
counts: { blocker: 5, major: 11, minor: 15 }
findings:
  - id: F-001
    severity: MAJOR
    category: "ADR drift"
    status: open|fixed|accepted|obsolete
    fixed_commit: <sha|null>
    feature: <roadmap-feature-id|null>   # where the work is tracked
last_validated: YYYY-MM-DD               # findings re-checked against the codebase
---

<body — executive summary, cross-cutting patterns, validation notes>
```

- `findings[].feature` is the join to ROADMAP.md — exactly the 023-053 mirroring niimo did
  manually, now expressible without duplicating descriptions.
- `status` lifecycle per finding: `open → fixed` (or `accepted`/`obsolete`), updated via CLI.

### 2c. `index.json` additions

```jsonc
{
  // ... v1 fields unchanged ...
  "vision": {                       // null when VISION.md absent
    "path": "docs/product/VISION.md",
    "updated": "2026-07-13",
    "pillars": [ { "id": "...", "title": "...", "summary": "..." } ]
  },
  "audits": [                       // [] when no published audits
    {
      "path": "docs/product/audits/2026-07-05-general.md",
      "date": "2026-07-05",
      "focus": "general",
      "verdict": "...",
      "counts": { "blocker": 5, "major": 11, "minor": 15 },
      "open": 13, "fixed": 18,      // derived from findings[].status
      "last_validated": "2026-07-13"
    }
  ]
}
```

`index.schema.json` gains both blocks as optional properties — v1 consumers stay valid.

### 2d. CLI surface (a1-tools product …)

| Command | Behavior |
|---|---|
| `product vision-init --title <t> [--pillar id:title:summary ...]` | Scaffold VISION.md; refuse if exists; regen index.json |
| `product vision-touch` | Bump `updated` after body edits; regen (keeps derived files honest without owning prose) |
| `product audit-publish --analysis <path>` | Parse an a1-analyze result (frontmatter findings) → create `audits/<date>-<focus>.md` with all findings `status: open`; regen |
| `product audit-set --audit <path> --finding F-0NN --status fixed --commit <sha> [--feature <id>]` | Update one finding; auto-changelog line; regen |
| `product audit-mirror --audit <path> --milestone <m-slug> [--only open]` | Generate `add-feature` calls for findings (the niimo 023-053 pattern, automated): id `<###>-f<NNN>-<slug>`, title `F-0NN: <category>`, done findings get status/dates from `fixed_commit` |
| `product validate` | Extended: validate VISION.md/audits/*.md frontmatter, cross-check `findings[].feature` ids exist in ROADMAP.md |

All writers use the existing lock + tmp/rename transaction and regenerate
`index.json`/`NEXT.md`, exactly like `product stage`.

### 2e. Skill wiring

- **a1-analyze** — after `report`, offer `product audit-publish` when `docs/product/` exists
  (opt-in prompt, not automatic).
- **a1-roadmap** — Discover phase captures vision; Scaffold phase writes VISION.md via
  `vision-init` (new projects get it from day one).
- **a1-fix / a1-execute** — when a commit closes a finding tracked in a published audit,
  call `audit-set` (detection heuristic: `F-0NN` in the commit message — the niimo fix
  commits all carry it).

## 3. Out of scope

- Pro Orc rendering (consumer-side; contract only — same split as spec 002).
- Translating any artifact to German (FR-016 stands).
- Auto-publishing every analysis (explicit CLI step by design).
- Migrating audits of other projects (on-touch, like v1).

## 4. Suggested wave cut (for the planning phase, non-binding)

1. **W1 — contract:** SCHEMA.md v1.1 sections, index.schema.json extensions, `product
   validate` coverage. Fixture: hand-written VISION.md + audit file for a1-specforge itself.
2. **W2 — CLI writers:** vision-init/vision-touch, audit-publish/audit-set + regen plumbing.
3. **W3 — audit-mirror + niimo backfill:** run `audit-publish` against
   `projects/niimo/analyses/2026-07-05-general.md`, `audit-set` the 18 fixed findings from
   the commit list, verify the generated mirror matches the manual features 023-053
   (acceptance test: zero diff in ids/statuses/milestones).
4. **W4 — skill wiring** (a1-analyze, a1-roadmap, a1-fix/a1-execute hooks) + docs.

## 5. Open decisions for the spec interview

1. Should `pillars[]` be required in VISION.md or fully optional? (Recommendation: optional.)
2. One audit file per analyze-run vs. one rolling AUDIT.md per focus? (Recommendation: per
   run — history stays append-only, `audits[]` gives the trend.)
3. Does `audit-mirror` mirror ALL findings as features (niimo choice, Robert 2026-07-13) or
   default to open-only with `--all` flag? (Recommendation: default open-only, `--all` opt-in;
   niimo showed all-31 works but 53-feature roadmaps are heavy.)
4. Finding-status `accepted` (won't fix, documented) — needed in v1.1 or later?
5. Commit-message heuristic `F-0NN` for auto `audit-set` — acceptable, or explicit flag only?

## 6. Validation evidence from the niimo reference migration (2026-07-13)

- Manual end state this feature must be able to reproduce: niimo commit `0e2d3a6`.
- Re-validation of findings against the codebase corrected the audit's own execution log in
  3 places (App-Check prep incomplete: planGenerator + sendChatMessage still lack
  verifyAppCheck; console.* count 60→95; god-file split not done, 740 lines) — supporting
  the `last_validated` field and `audit-set` as an explicit, evidence-based step rather than
  trusting execution logs.
- CLI ergonomics finding: 31× `add-feature` in a bash loop worked cleanly (~30 s); the
  legacy hand-migrated `depends_on: "[a, b]"` string format failed `product validate` and
  had to be converted to real arrays — `product import` (spec 002 P3) should normalize this.
