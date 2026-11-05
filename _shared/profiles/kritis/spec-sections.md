source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1072-1267 (partial)

# Spec sections added by the KRITIS profile

> Migrated from SpecForge Anhang A (partial). Only the sections the profile adds to an a1 spec
> are kept; the rest of the template is superseded by
> `skills/a1-new-feature/templates/spec-template.md`. This file is the one place the NFR
> injector (`profile nfr-inject`) and the stakeholder simulation take their headings from.

Provenance: the NFR section descends from Anhang A §6 (NFRs; Compliance block with article
references). The threat-model link descends from §5 "STRIDE-Bewertung" and §6 "Sicherheit".
The simulation section has no counterpart in Anhang A; its shape comes from Modus 6 (see
`stakeholder-roles.md`).

## 1. KRITIS NFR section

Heading (literal): `## Non-Functional Requirements (KRITIS profile)`

Placement: directly after `## Functional Requirements`.

Each line is an ordinary FR in the spec's running `FR-###` sequence (not `FR-NFR-###`, which
`_shared/lib/check.cjs:19` does not match). The catalogue id travels in the text:

```
- **FR-NNN**: The system shall ... [EARS: ubiquitous] — Source: kritis-nfr:<ID> (_shared/profiles/kritis/nfr-catalogue.md)[; <regulation article>]
```

- `NNN`: next number after the spec's highest `FR-###`.
- `<ID>`: a catalogue id such as `AVA-01`.
- `; <regulation article>`: the catalogue `source` cell, present only when that cell is not empty.
- An open threshold (`[X ms]`) becomes `[NEEDS CLARIFICATION: ...]` in the line.
- Dedup is tag-based: an item is skipped when `kritis-nfr:<ID>` already appears as a source tag
  on an FR line, or as `(covers kritis-nfr:<ID>)` on an FR.

## 2. Threat-model link line

Form (literal prefix): `Threat model: docs/product/features/<id>/threat-model.md`

- `<id>` is the spec id, `^[0-9]{3}-[a-z0-9-]+$`.
- Placed in the spec's security-relevant part. Not in Anhang A: this line is defined by this
  profile, since the a1 spec keeps the threat model in a separate file.
- **Documentation only, not a contract** (measured 2026-10-29): no code reads this line.
  `profile threat-model-check` resolves the file from the spec id by a fixed path
  (`profile-stride.cjs:184`), never from this line, so a spec without it still gets
  checked and a spec with a wrong path here is not caught. It exists so a human reading
  the spec finds the threat model. Wave 8 decides whether to keep it as prose or give it
  a check; do not assume it is load-bearing.
- Shape of the file it points to: `threat-model-template.md`.

## 3. Stakeholder Simulation

Heading (literal): `## Stakeholder Simulation`

One block per simulated role:

```
### <role-id>
Assumption challenged: <one assumption the author treated as given>
```

- `<role-id>`: an id from `stakeholder-roles.md`.
- The `Assumption challenged:` line is mandatory; `profile simulate-check` verifies one block
  per requested role.
