# Phase 0 — Roadmap Gate (hard gate, before Discover)

**Goal:** Ensure a feature is never discovered/planned in a vacuum — verify a
project roadmap exists and, once a `roadmap_entry` is known, that it maps to a
real entry. Deterministic, read-only, no LLM judgment calls.

**Runs:** before Phase 1 (Discover), on every invocation of `a1-new-feature`
(new feature or resuming an existing spec).

## Steps 1–3 — Run the canonical check

Execute the shared check exactly as defined in
`_shared/roadmap-gate-check.md` (existence with docs/product preference →
parseability → entry membership), using its canonical bash snippets and
user-facing prompt wordings verbatim. Caller-specific values for this skill:

- `<work>` in the MISSING prompt = **"Feature work"**.
- The membership check applies once the spec has a `roadmap_entry:`
  frontmatter field (usually from Phase 2 Specify onward). On first-time
  Discover for a brand-new feature there is no `roadmap_entry` yet — skip
  membership and proceed to Phase 1.

## Outcome

| Check | Result | Action |
|---|---|---|
| both roadmap files missing | HALT | Route to `a1-roadmap`, do not start Discover |
| roadmap file exists, unparseable | HALT (treated as missing) | Warn "do not overwrite", confirm before routing to `a1-roadmap` |
| `docs/product/ROADMAP.md` found | PASS (preferred path) | Proceed against it |
| only `.a1/roadmap.md` found (legacy) | PASS (fallback) | Proceed against it; note recommended on-touch migration |
| roadmap parseable, no `roadmap_entry` yet | PASS | Proceed to Phase 1 (Discover) |
| roadmap parseable, `roadmap_entry` matches | PASS | Proceed |
| roadmap parseable, `roadmap_entry` mismatch | SOFT STOP | Surface mismatch notice, user confirms to continue |

## `<spec-id>`: the one id for `--by` and `--phase`

`<spec-id>` is the product-CLI feature id: the `- id: <###-slug>` entry that `product add-feature --id` wrote to
`docs/product/ROADMAP.md` (the same id `product stage --by` takes). It is required before the first `--by` or `--phase`
call after Discover (Phase 2 onward): without it run `a1-roadmap` / `product add-feature` first. Phase 1 Step 2b
(`quick eligibility`) runs before any feature id exists and is the third exception, next to `retro-` and `pr-<n>`. Do not use the spec number: the spec
number and the feature id can differ, and `product stage` then silently skips the reservation mirror (the 004/016 split).
`roadmap_entry` is not the id when it is a legacy slug that several features share (`m1-p1-auth-setup`).
A project without `docs/product/` (legacy `.a1/roadmap.md`) uses the spec's `id:` frontmatter (`<###>-<slug>`) in every
call, consistently.

Every `--by` and `--phase` of a1-new-feature and a1-execute uses it, with two deliberate exceptions: `retro validate`
runs under `--phase retro-<spec-id>`, and `a1-pr-review` logs under `pr-<n>`.

On PASS, load `workflows/01-discover.md` (or the phase indicated by the
spec's current `status`, per the Routing table in SKILL.md).
