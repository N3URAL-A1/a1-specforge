source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1703-1850

# Threat-model template (KRITIS profile)

> Fixes the shape `profile threat-model-check --id <###-slug>` (`_shared/lib/profile-stride.cjs`,
> FR-003) parses and verifies. One file per feature, written by `a1-samuel-security` during Gate
> C of `a1-new-feature --profile kritis`, at
> `docs/product/features/<id>/threat-model.md`.

Copy this file, fill every section, do not add or remove the six STRIDE rows.

```markdown
## Assets

- <what is being protected — data, credentials, availability, …>

## Actors

- <who interacts with the system — user roles, services, external callers, attacker personas>

## Trust boundaries

- <where data or control crosses a boundary — network edge, auth boundary, tenant boundary, …>

## STRIDE

| Category | Relevant | Finding | Risk | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | yes/no | <finding, or the reason if Relevant is no> | low/medium/high | <mitigation; required when Status is mitigated> | open/mitigated/accepted |
| Tampering | yes/no | … | low/medium/high | … | open/mitigated/accepted |
| Repudiation | yes/no | … | low/medium/high | … | open/mitigated/accepted |
| Information Disclosure | yes/no | … | low/medium/high | … | open/mitigated/accepted |
| Denial of Service | yes/no | … | low/medium/high | … | open/mitigated/accepted |
| Elevation of Privilege | yes/no | … | low/medium/high | … | open/mitigated/accepted |

## Accepted risks

- <category>: <risk> — accepted by <name> on YYYY-MM-DD
```

## Rules the checker enforces

- `## Assets`, `## Actors`, `## Trust boundaries`, `## STRIDE`, `## Accepted risks` — all five
  sections must be present (`section_missing` otherwise).
- The `## STRIDE` table has exactly one row per category (Spoofing, Tampering, Repudiation,
  Information Disclosure, Denial of Service, Elevation of Privilege) — all six, none duplicated,
  none renamed (`category_missing` for any that is absent).
- `Relevant: no` requires a non-empty `Finding` cell stating the reason
  (`not_applicable_without_reason` otherwise).
- `Relevant` is `yes` or `no` (`bad_relevant` otherwise).
- `Risk` is one of `low`, `medium`, `high` (`bad_risk` otherwise).
- `Status` is one of `open`, `mitigated`, `accepted` (`bad_status` otherwise).
- A row with `Status: accepted` (any risk level), and a row with `Risk: high` and `Status: open`,
  must have a matching entry under `## Accepted risks` naming that category in the exact shape
  `- <category>: <risk> — accepted by <name> on YYYY-MM-DD`, or the check fails with
  `unmitigated`. An unmitigated threat is only closed when a named person accepts it, with a
  date — per `agents/a1-samuel-security.md`'s rule that an unmitigated threat is only closed
  when the user accepts it by name.
- A row with `Status: mitigated` needs a non-empty Mitigation cell (a lone dash does not count)
  unless `Relevant` is `no` (`unmitigated` otherwise).

## Relation to `stride.md`'s free-form table

This is the checkable shape (`| Category | Relevant | Finding | Risk | Mitigation | Status |`);
see `stride.md`'s closing section for how it maps onto Samuel's prose
`threat → likelihood → impact → mitigation → owner` format.
