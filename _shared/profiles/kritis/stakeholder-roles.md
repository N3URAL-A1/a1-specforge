source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 692-720

# Stakeholder and reviewer simulation roles (KRITIS profile)

> Migrated from SpecForge Modus 6 (German original, re-measured 2026-10-28 against the
> hash-pinned archive above: `### Modus 6` starts at line 692, the next heading `### Modus 7`
> starts at line 721, so Modus 6's content ends at line 720). Method: Devil's Advocate
> (Advocatus Diaboli, formalised 1587) + steelmanning — the strongest version of the opposing
> position, never a strawman. Every role must name at least one assumption the spec's author
> treats as given. Used by `profile simulate-roles` and `profile simulate-check`
> (`_shared/lib/profile-simulate.cjs`).

## Role catalogue (9 roles)

The source table (Modus 6, lines 702-711) lists eight roles with German names and no stable
ids. The `id` column below is this migration's English mapping — recorded here as the
provenance, since the source has no id to carry over unchanged (Standard wave contract item
10's "IDs from the source stay unchanged" does not apply: there is no source id).

| id | German source name (Modus 6 table) | Focus | Method |
|---|---|---|---|
| `product-owner` | Product Owner | Business value, ROI, MVP scope | MoSCoW, Value/Effort |
| `architect` | System Architect | API design, module structure, ADR compliance | FLEX + ARCEVAL |
| `contract-guardian` | Contract Guardian | Spec-to-schema chain, fixture validity, consistency | iSAQB governance |
| `security-officer` | Security Reviewer | OWASP Top 10, STRIDE, auth, secrets, security ADRs | STRIDE (all 6 categories) |
| `data-engineer` | Data Engineer | Storage patterns, data flow, retention, concurrency | Retention policy check |
| `harness-auditor` | Harness Auditor | Golden Principles, file placement, exec plans, doc freshness | GP-01..GP-10 (see `golden-principles.md`) |
| `end-user` | Endnutzer | Usability, comprehensibility, fault tolerance | Persona-based |
| `dpo` | Datenschutzbeauftragter | GDPR, data categories, deletion concepts, DPIA | GDPR Art. 25, 35 |
| `ops` | — (no Modus 6 row) | Monitoring, deployment, incident response, capacity | Anhang D's OPS checklist (OPS-01..OPS-05) |

**`ops` is not one of Modus 6's eight rows.** It is derived from Anhang D's "6. Betrieb (OPS)"
category (source lines 1668-1680, OPS-01 Monitoring through OPS-05 Kapazitätsplanung) because
the spec's own worked example (`006-specforge-kritis-profile.md` FR-005: `--simulate
security-officer,dpo,ops`) names an `ops` role that Modus 6 does not define. Rather than invent
an undocumented ninth focus, this migration ties `ops` to the one existing catalogue item that
already covers the same ground (operational NFRs), so the role's focus and method are
traceable to a source section instead of being authored from scratch.

## Deviation from "min. 3, max. 5 roles"

The source text (Modus 6, "Delta", line 695): *"Min. 3, max. 5 Rollen pro Review."* ("Min. 3,
max. 5 roles per review.") This migration does not enforce a minimum. `profile simulate-roles
--roles <csv>` accepts **1 to 5** roles; the spec's acceptance criteria (FR-005, see the wave
plan Wave 6 brief) describe the user picking roles explicitly through `--roles`, with no lower
bound beyond "at least one id was given" (an empty `--roles` is a usage error, not a minimum-3
violation). The upper bound of 5 is kept unchanged from the source.

## Role card shape

`profile simulate-roles --roles <csv>` renders one card per requested id, in the order given,
each with:

```
### <id>
Focus: <focus>
Method: <method>
Question: name one assumption the author treats as given.
```

The question line is fixed text (Modus 6's "Verify" line, line 696: *"Hat jede Rolle mindestens
eine Annahme identifiziert, die der Spec-Autor für selbstverständlich hielt?"*) — every role
asks the same mandatory question; only the focus and method differ per role.

## Verification shape (`profile simulate-check`)

A spec that has gone through simulation carries a `## Stakeholder Simulation` section (literal
heading, per the wave plan) with one `### <role-id>` block per requested role, each containing
an `Assumption challenged:` line — the spec-side record that the role's mandatory question (see
above) was actually answered, not just asked. `profile simulate-check --spec <path> --roles
<csv>` verifies this mechanically: one block per requested role, each with the required line.
