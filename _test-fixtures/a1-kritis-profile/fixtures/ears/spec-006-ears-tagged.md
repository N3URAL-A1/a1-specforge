---
id: 006-specforge-kritis-profile
project: a1-specforge
title: "Fold SpecForge into a1 — EARS/STRIDE/NIS2 as an optional `--profile kritis`"
status: implementing
---

# SpecForge -> a1 KRITIS profile

## Functional Requirements

- **FR-001**: The system shall let `a1-new-feature` accept `--profile kritis` as a CLI flag,
  auto-enabling it when `docs/product/index.json` carries `profile: kritis` or the project
  constitution declares it. [EARS: ubiquitous]
- **FR-002**: While the KRITIS profile is active, the system shall require every FR to be
  expressed in EARS form (Ubiquitous / Event-driven / State-driven / Unwanted / Optional) using
  the template migrated from SpecForge Anhang C, flagging non-EARS FRs at Gate 4.5.
  [EARS: state-driven]
- **FR-003**: While the profile is active, Gate C shall spawn `a1-samuel-security` for a STRIDE
  pass producing `docs/product/features/<id>/threat-model.md` (template from Anhang E).
  [EARS: state-driven]
- **FR-004**: While the profile is active, the system shall append the NIS2/KRITIS NFR catalogue
  (migrated from SpecForge) as `FR-NFR-###` entries with source references, deduplicated against
  existing FRs. [EARS: state-driven]
- **FR-005**: Where stakeholder and reviewer simulation is requested, the system shall make it
  available as an optional Clarify sub-step (`--simulate security-officer,dpo,ops`) in Rene's
  workflow. [EARS: optional]
- **FR-006**: The system shall not port SpecForge Modus 8, covering its needs instead with
  `product status`, `product markers`, and N3URAL Brain, and stating so explicitly in the
  deprecation notice. [EARS: ubiquitous]
- **FR-007**: If the `specforge` skill is retired, then the system shall become an alias skill
  (<=40 lines) that prints a deprecation message and invokes `a1-new-feature --profile kritis`,
  with its trigger list reduced to "specforge" only so it no longer competes with a1 triggers.
  [EARS: unwanted]
- **FR-008**: The system shall keep `a1-new-feature` byte-identical without the profile
  (fixture-verified): no NFR injection, no STRIDE spawn, no EARS check. [EARS: ubiquitous]

## Success Criteria

- **SC-001**: Fixture run of `a1-new-feature --profile kritis` on a sample feature produces a
  spec whose FRs all pass the EARS check, a threat-model.md, and >=1 FR-NFR entry.
