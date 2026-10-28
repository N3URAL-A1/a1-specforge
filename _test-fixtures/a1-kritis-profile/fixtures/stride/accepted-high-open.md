## Assets

- Customer PII stored in the primary database

## Actors

- Authenticated end user
- Attacker on the public internet

## Trust boundaries

- Public internet to the API gateway

## STRIDE

| Category | Relevant | Finding | Risk | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | yes | OAuth without MFA on admin routes | high | Require MFA for admin operations | open |
| Tampering | yes | TLS 1.3 enforced on all channels | low | — | mitigated |
| Repudiation | yes | Audit logging present for all write operations | low | — | mitigated |
| Information Disclosure | yes | Stack traces suppressed in production | low | — | mitigated |
| Denial of Service | yes | Rate limiting in place | low | — | mitigated |
| Elevation of Privilege | yes | RBAC implemented, authorization checked server-side | low | — | mitigated |

## Accepted risks

- Spoofing: high — accepted by Robert on 2026-10-28
