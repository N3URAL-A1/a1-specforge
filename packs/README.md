# Gate-Packs

A pack is a versioned directory bundling battle-tested gate patterns so users
import proven gates instead of collecting their own bugs first. Format and
trust model: `docs/adr/2026-07-05-gate-pack-format.md` (curation over
cryptography — no executable payloads).

## Install a pack into a project

```bash
# validate first (schema, pattern files, checks/ safety) — exit 0 = valid
node <repo>/_shared/a1-tools.cjs pack validate packs/postgres-rls

# import: validate → copy to <your-repo>/.a1/packs/<name>/ — never auto-applies
node <repo>/_shared/a1-tools.cjs pack import packs/postgres-rls --dest /path/to/your/repo
```

Staged patterns enter `a1-evolve`'s clustering as `source: community` with
provenance capped at 2 (ADR §4): community evidence lowers the propose bar but
never reaches it alone — one local occurrence is still required, so a poisoned
pack can propose nothing by itself.

## Export your own pack

```bash
node <repo>/_shared/a1-tools.cjs pack export \
  --patterns <id,id,...> --anonymize A2 --out ./my-pack
```

Export enforces the anonymization deny-regex (project slugs, paths, names,
e-mails); any hit in the generated output aborts with exit 1. `A3` additionally
strips code blocks from diffs.

## Shipped packs

| Pack | Contents |
|---|---|
| `postgres-rls/` | Postgres Row-Level-Security gate patterns: FK type match, RLS grant matrix, schema audit trigger. |
