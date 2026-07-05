# ADR: Gate-Pack format — shareable learning bundles

**Date:** 2026-07-05 · **Status:** proposed · **Context:** VISION.md names the Learning-Exchange as the moat: users import battle-tested gates instead of collecting their own bugs. This ADR fixes the format and trust model before M8 builds it.

## Decision

### 1. A pack is a versioned directory, not a registry entry
```
packs/postgres-rls/            # in-repo under packs/ for v1 (curated); remote registry later
├── pack.yaml                  # manifest
├── patterns/
│   ├── rls-grant-matrix.md    # one file per pattern
│   └── schema-audit-trigger.md
└── checks/                    # optional deterministic payloads
    └── rls-check.args.json    # parameters for existing a1-tools subcommands — NEVER executable code
```

### 2. Manifest (`pack.yaml`)
```yaml
name: postgres-rls
version: 1.2.0            # semver; MAJOR = changed gate semantics
stacks: [postgres, supabase]
provenance:
  occurrences: 11          # corpus count behind the pack
  severity: high
  date_range: 2026-05..2026-07
  source: a1-office (anonymized)
anonymization: A2          # A1=none, A2=paths+slugs stripped, A3=mechanism-only
patterns: [rls-grant-matrix, schema-audit-trigger]
requires_cli: ">=1.4"      # a1-tools compatibility
```

### 3. Pattern file = the same schema as `pattern/a1-learnings/patterns.md` entries, plus a target block
```yaml
id: rls-grant-matrix
class: schema_flaw
trigger_signature: "new table + multi-tenant stack"   # when the gate applies
target:
  kind: brief-line | gate-step | cli-check            # ONLY these three insertion types
  skill: a1-new-feature
  anchor: "Gate 0.6"                                   # section the diff attaches to
diff: |
  - For every new table: verify GRANT matrix covers all three roles (read/write/admin) …
evidence_schema: "grep + psql \\dp output"             # what proof a run must show
```
**Anonymization rule:** strip project slugs, file paths, personal names, URLs; keep bug class + mechanism + trigger. A3 packs additionally drop code snippets. Export tooling enforces this (`pack export` refuses when a deny-regex hits: `/Users/`, vault paths, e-mails, tenant names).

### 4. Import is staged, never self-applying
`a1-tools pack import <dir|url>` → validates manifest + schema → copies to `.a1/packs/<name>/` → **stops**. Application happens exclusively through a1-evolve: imported patterns enter the Cluster phase as `source: community` with their provenance count **capped at 2** (i.e. one local occurrence is still required before a community pattern crosses the propose-threshold of 3). Rationale: community evidence lowers the bar but never replaces local evidence; a poisoned pack can propose nothing on its own, and every application still goes through evolve's per-diff user confirmation + constitution checks.

### 5. Trust model v1: curation over cryptography
v1 packs live in the a1-specforge repo (`packs/`), reviewed via normal PRs — the PR review *is* the signature. No executable payloads (checks/ carries only parameter files for already-shipped CLI subcommands) — that alone removes the code-injection surface. Registry, signing, and ratings are M9+ questions, only if adoption warrants.

### 6. Export closes the loop
`a1-tools pack export --patterns <ids> --anonymize A2 --out packs/<name>/` builds a pack from local `patterns.md` entries. The contribution path in CONTRIBUTING.md: run export → open PR → maintainer review checks anonymization + evidence schema.

## Consequences
+ Network effect has a concrete artifact; contribution is one CLI call + one PR.
+ No new trust infrastructure for v1; poisoning bounded by the local-evidence cap + evolve confirmation.
− Packs can go stale vs skill refactors → `requires_cli` + anchor-miss = import warning, evolve marks pattern `orphaned`.
− In-repo curation doesn't scale past ~dozens of packs — acceptable; that would be a success problem.

## First pack (validation of the format)
`postgres-rls` from the a1-office corpus: rls-grant-matrix (3×), schema-audit-trigger (8×), fk-type-match — precisely the patterns Gate 0.6 already enforces locally, i.e. we can verify the pack reproduces known-good gates before publishing.
