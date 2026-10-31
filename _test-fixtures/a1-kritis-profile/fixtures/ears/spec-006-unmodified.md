---
id: 006-specforge-kritis-profile
project: a1-specforge
title: "Fold SpecForge into a1 — EARS/STRIDE/NIS2 as an optional `--profile kritis`"
status: implementing
---

# SpecForge -> a1 KRITIS profile

## Functional Requirements

- **FR-001**: `a1-new-feature` MUST accept `--profile kritis` (CLI flag) and MUST auto-enable it
  when `docs/product/index.json` carries `profile: kritis` or the project constitution declares
  it.
- **FR-002**: Under the KRITIS profile, Rene MUST express every FR in EARS form (Ubiquitous /
  Event-driven / State-driven / Unwanted / Optional) using the template migrated from SpecForge
  Anhang C; a deterministic check MUST flag non-EARS FRs at Gate 4.5.
- **FR-003**: Under the profile, Gate C MUST spawn `a1-samuel-security` for a STRIDE pass
  producing `docs/product/features/<id>/threat-model.md` (template from Anhang E).
- **FR-004**: Under the profile, the NIS2/KRITIS NFR catalogue (migrated from SpecForge) MUST be
  appended as `FR-NFR-###` entries with source references, deduplicated against existing FRs.
- **FR-005**: Stakeholder & reviewer simulation (SpecForge Modus 6) MUST be available as an
  optional Clarify sub-step (`--simulate security-officer,dpo,ops`) in Rene's workflow.
- **FR-006**: SpecForge Modus 8 MUST NOT be ported; its needs are covered by `product status`,
  `product markers`, and N3URAL Brain. The deprecation notice MUST say so explicitly.
- **FR-007**: The `specforge` skill MUST become an alias skill (<=40 lines) that prints a
  deprecation message and invokes `a1-new-feature --profile kritis`; its trigger list MUST be
  reduced to "specforge" only so it no longer competes with a1 triggers.
- **FR-008**: Without the profile, `a1-new-feature` behavior MUST remain byte-identical
  (fixture-verified) — no NFR injection, no STRIDE spawn, no EARS check.

## Success Criteria

- **SC-001**: Fixture run of `a1-new-feature --profile kritis` on a sample feature produces a
  spec whose FRs all pass the EARS check, a threat-model.md, and >=1 FR-NFR entry.
