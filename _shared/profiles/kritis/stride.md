source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1703-1850

# STRIDE checklist (KRITIS profile)

> Migrated from SpecForge Anhang E (German original, re-measured 2026-10-28 against the
> hash-pinned archive above: `## Anhang E` starts at line 1703, the next heading `## Anhang F`
> starts at line 1851, so this Anhang's content ends at line 1850). Threat-modeling framework for
> security-relevant requirements. Consult it during a security review or a STRIDE analysis.

Six categories, 42 check items total (S 6, T 7, R 6, I 8, D 8, E 7). Ids are per-category
prefixed (`S-01`, `T-01`, `R-01`, `I-01`, `D-01`, `E-01`) — unchanged from the source, per the
Standard wave contract item 10.

## S — Spoofing

**Threat:** an attacker impersonates a legitimate user, service or system.

| id | check | question |
|---|---|---|
| S-01 | User authentication | How is the user's identity verified? |
| S-02 | Service-to-service auth | How do services authenticate to each other? (mTLS, API keys, OAuth) |
| S-03 | Token validation | Are tokens validated server-side? Signature check? Expiry? |
| S-04 | Credential storage | How are credentials stored? (hashing, salting, algorithm) |
| S-05 | MFA | Is multi-factor authentication required for privileged operations? |
| S-06 | Session hijacking | Are sessions protected against takeover? (Secure, HttpOnly, SameSite) |

**Typical mitigations:** MFA, mTLS, short-lived JWTs, certificate pinning, IP binding.

## T — Tampering

**Threat:** an attacker alters data in transit or at rest.

| id | check | question |
|---|---|---|
| T-01 | Transport encryption | Is TLS 1.3 enforced on every communication channel? |
| T-02 | Data integrity | Are checksums/signatures checked for critical data? |
| T-03 | Input validation | Is every input validated server-side? Allowlist approach? |
| T-04 | SQL injection | Are prepared statements / parameterized queries used? |
| T-05 | XSS | Is output encoding applied consistently? CSP header? |
| T-06 | File upload | Are uploaded files validated? (type, size, content) |
| T-07 | Configuration | Are configuration files protected against tampering? (signing, access control) |

**Typical mitigations:** TLS 1.3, HMAC signatures, input sanitization, CSP, parameterized queries.

## R — Repudiation

**Threat:** a user or system denies having performed an action.

| id | check | question |
|---|---|---|
| R-01 | Audit logging | Are all security-relevant actions logged? |
| R-02 | Log content | Does every log entry carry actor, timestamp, action, resource, result? |
| R-03 | Log integrity | Are logs protected against later tampering? (append-only, signing) |
| R-04 | Timestamps | Is a trusted time source used? (NTP, time server) |
| R-05 | Non-repudiation | Are critical transactions digitally signed? |
| R-06 | Log retention | Are logs retained per regulatory requirements? |

**Typical mitigations:** centralized SIEM, tamper-proof logging, digital signatures, NTP sync.

## I — Information Disclosure

**Threat:** confidential information is disclosed without authorization.

| id | check | question |
|---|---|---|
| I-01 | Error handling | Does the system leak internal detail in error messages? (stack traces, DB schemas) |
| I-02 | API responses | Are only the minimally necessary fields returned? |
| I-03 | Logging | Are sensitive values (passwords, tokens, PII) masked in logs? |
| I-04 | Encryption at rest | Is sensitive data encrypted at rest? |
| I-05 | Header leaks | Are server/framework version headers suppressed? |
| I-06 | Directory listing | Is directory listing disabled? |
| I-07 | Caching | Do sensitive responses carry `Cache-Control: no-store`? |
| I-08 | Side channel | Are timing attacks on auth endpoints prevented? (constant-time comparison) |

**Typical mitigations:** generic error messages, field-level encryption, log masking, security headers.

## D — Denial of Service

**Threat:** an attacker makes the system unavailable to legitimate users.

| id | check | question |
|---|---|---|
| D-01 | Rate limiting | Are there request limits per client/IP/user? |
| D-02 | Resource limits | Are CPU, RAM, connection pools bounded? |
| D-03 | Payload limits | Are there size limits on requests, uploads, batch operations? |
| D-04 | Timeout configuration | Are timeouts configured for every external call? |
| D-05 | Circuit breaker | Are there circuit breakers for dependent services? |
| D-06 | Queue protection | Are message queues protected against overflow? (DLQ, backpressure) |
| D-07 | DDoS protection | Is DDoS mitigation in place? (WAF, CDN, cloud protection) |
| D-08 | Graceful degradation | Is the overload behaviour defined? |

**Typical mitigations:** rate limiting, WAF, auto-scaling, circuit breaker, bulkhead pattern.

## E — Elevation of Privilege

**Threat:** a user gains higher privileges than intended.

| id | check | question |
|---|---|---|
| E-01 | Least privilege | Do users and services hold only the minimally necessary rights? |
| E-02 | Authorization check | Is authorization checked server-side on every operation (not only in the UI)? |
| E-03 | IDOR | Are insecure direct object references prevented? (UUIDs instead of sequential ids, ownership check) |
| E-04 | Admin functions | Are administrative functions additionally secured? (separate auth, IP allowlist) |
| E-05 | Privilege escalation via API | Can a user change rights via API calls that the UI does not expose? |
| E-06 | Default credentials | Are default passwords and default roles forced to change on install? |
| E-07 | Service accounts | Do service accounts run with minimal rights and rotating credentials? |

**Typical mitigations:** RBAC/ABAC, server-side authorization, UUID-based resource ids, privileged access management.

## Application in the profile

1. **When:** for every security-relevant story, or on explicit request.
2. **Scope:** all six categories are checked — even when only some look obviously relevant; a
   category marked `Relevant: no` needs a stated reason (see `threat-model-template.md`).
3. **Output:** the threat-model document's `## STRIDE` table, one row per category.
4. **Severity:** a missing STRIDE analysis for a security-relevant story is a BLOCKER finding in
   Samuel's review.
5. **Iteration:** STRIDE is repeated on spec updates, not done once and forgotten.

## Checkable shape vs. Samuel's prose format

`agents/a1-samuel-security.md` describes a threat table in prose as
`threat → likelihood → impact → mitigation → owner`. `threat-model-template.md` (this wave) uses
`| Category | Relevant | Finding | Risk | Mitigation | Status |` instead — the shape this
profile's deterministic `profile threat-model-check` can parse and verify (one row per STRIDE
category, a closed `Risk`/`Status` vocabulary, and an explicit accepted-risks section). The two
are related, not identical: "likelihood × impact" collapses into the template's single `Risk`
column (low/medium/high), "owner" is implied by the author of the `## Accepted risks` entry
rather than a separate column, and the template is anchored on **category** (one row guaranteed
per STRIDE letter) rather than on an open list of individual threats. Samuel's free-form review
output is unaffected by this file; only the profile's checkable artifact
(`docs/product/features/<id>/threat-model.md`) uses the template shape.
