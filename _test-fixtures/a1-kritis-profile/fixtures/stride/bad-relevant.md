## Assets

- Customer PII stored in the primary database
- Session tokens issued to authenticated users

## Actors

- Authenticated end user
- External API caller (service-to-service)
- Attacker on the public internet

## Trust boundaries

- Public internet to the API gateway
- API gateway to the internal service mesh

## STRIDE

| Category | Relevant | Finding | Risk | Mitigation | Status |
|---|---|---|---|---|---|
| Spoofing | yes | OAuth tokens without MFA on admin routes | medium | Require MFA for admin operations | mitigated |
| Tampering | yes | TLS 1.3 enforced on all channels | low | Control in place and verified | mitigated |
| Repudiation | maybe | Audit logging present for all write operations | low | Control in place and verified | mitigated |
| Information Disclosure | yes | Stack traces suppressed in production | low | Control in place and verified | mitigated |
| Denial of Service | yes | Rate limiting missing on the public upload endpoint | medium | Add a rate limiter | mitigated |
| Elevation of Privilege | yes | RBAC implemented, authorization checked server-side | low | Control in place and verified | mitigated |

## Accepted risks

- (none)
