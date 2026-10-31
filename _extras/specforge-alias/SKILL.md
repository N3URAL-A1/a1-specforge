---
name: specforge
description: >
  Deprecated alias. Use only when the user types the bare word "specforge" as
  a request. Never for a1-specforge (the plugin/repo name).
---

# specforge (deprecated)

SpecForge is retired. Its three exclusive building blocks — EARS requirement
syntax, STRIDE threat modeling, and the NIS2/KRITIS NFR catalogue, plus the
stakeholder simulation — now live in `a1-specforge:a1-new-feature` as the
optional `--profile kritis` lane (spec `006-specforge-kritis-profile`).

**Modus 8 (management & traceability) was not ported.** Its replacements:
`product status`, `product markers`, and N3URAL Brain.

Old SpecForge-format specs (`spec.md`/`plan.md`/`tasks.md`) adopt on touch
via `a1-modernize spec-only` — they are not rewritten in bulk.

## Hand-off

Tell the user SpecForge is retired and why (above), then invoke
`a1-specforge:a1-new-feature --profile kritis` for the request that was
meant for SpecForge. Do not run any SpecForge mode yourself.
