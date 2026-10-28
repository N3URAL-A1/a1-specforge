## Assets

- Customer PII stored in the primary database

## Actors

- Authenticated end user

## Trust boundaries

- Public internet to the API gateway

## STRIDE

| Category | Relevant | Finding | Risk | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | yes | OAuth tokens without MFA on admin routes | medium | Require MFA for admin operations | mitigated |
| Tampering | yes | TLS 1.3 enforced on all channels | low | — | mitigated |
| Repudiation | yes | Audit logging present for all write operations | low | — | mitigated |
| Information Disclosure | yes | Stack traces suppressed in production | low | — | mitigated |
| Elevation of Privilege | yes | RBAC implemented, authorization checked server-side | low | — | mitigated |

## Accepted risks

- (none)
