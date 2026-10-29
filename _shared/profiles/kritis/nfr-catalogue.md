source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1597-1702

# KRITIS NFR catalogue (KRITIS profile)

> Migrated from SpecForge Anhang D (German original, re-measured 2026-10-29 against the
> hash-pinned archive above: `## Anhang D` starts at line 1597, the next heading `## Anhang E`
> starts at line 1703, so this Anhang's content ends at line 1702). Checklist of non-functional
> requirements for KRITIS-regulated environments. `profile nfr-inject` appends every item a spec
> does not yet cover as an ordinary `FR-###` line.

41 items in six categories (AVA 8, SEC 10, AUD 6, PER 5, DAT 7, OPS 5). Ids are unchanged from
the source, per the Standard wave contract item 10.

## How to read the columns

| Column | Meaning |
|---|---|
| `id` | Stable catalogue id, `^(AVA\|SEC\|AUD\|PER\|DAT\|OPS)-\d{2}$`. Travels into specs as the source tag `kritis-nfr:<ID>`. |
| `category` | Category name with its prefix. |
| `requirement (EARS)` | The item as an ubiquitous EARS requirement ("The system shall ..."). It repeats the baseline value, so an injected line stands on its own. |
| `baseline` | The value the requirement uses. Prefixed **SpecForge baseline, not a legal minimum** unless a primary text states the value; then it is prefixed `Primary text:` and names the article. |
| `source` | Primary-text articles only (NIS2 = Directive (EU) 2022/2555, GDPR = Regulation (EU) 2016/679). Empty means: no article was verified for this item. Empty is not "no legal basis". |
| `question` | The question the item puts to a spec (SpecForge: "Frage an Spec"). |

**Open thresholds.** A `[X ...]` placeholder in the `requirement (EARS)` and `baseline` cells
(PER-01, PER-02, PER-03) marks a value the spec author must supply. The injector turns the
placeholder into `[NEEDS CLARIFICATION: ...]`. No other item carries a placeholder.

## Catalogue

| id | category | requirement (EARS) | baseline | source | question |
|---|---|---|---|---|---|
| AVA-01 | Availability (AVA) | The system shall provide an uptime of at least 99.9 % (at most 8.76 h downtime per year). | SpecForge baseline, not a legal minimum: uptime >= 99.9 % | | Is an uptime target defined? |
| AVA-02 | Availability (AVA) | The system shall restore a critical system within a recovery time objective (RTO) of at most 4 h. | SpecForge baseline, not a legal minimum: RTO <= 4 h for critical systems | | Is the maximum recovery time defined? |
| AVA-03 | Availability (AVA) | The system shall limit data loss for critical data to a recovery point objective (RPO) of at most 1 h. | SpecForge baseline, not a legal minimum: RPO <= 1 h for critical data | | Is the maximum data-loss window defined? |
| AVA-04 | Availability (AVA) | The system shall have no single point of failure. | SpecForge baseline, not a legal minimum: no single point of failure | | Are redundancy requirements documented? |
| AVA-05 | Availability (AVA) | The system shall fail over automatically within 60 s. | SpecForge baseline, not a legal minimum: automatic failover <= 60 s | | Is failover behaviour specified? |
| AVA-06 | Availability (AVA) | The system shall keep backups under the 3-2-1 rule (3 copies, 2 media, 1 offsite). | SpecForge baseline, not a legal minimum: 3-2-1 rule (3 copies, 2 media, 1 offsite) | NIS2 Art. 21(2)(c) | Is a backup strategy defined? |
| AVA-07 | Availability (AVA) | The system shall have a documented disaster recovery plan with a documented test schedule. | SpecForge baseline, not a legal minimum: DR plan with documented test schedule | NIS2 Art. 21(2)(c) | Is a disaster recovery scenario described? |
| AVA-08 | Availability (AVA) | While a component has failed, the system shall operate in a defined degraded mode. | SpecForge baseline, not a legal minimum: defined behaviour on partial failure | | Is degraded-mode behaviour specified? |
| SEC-01 | Security (SEC) | The system shall require multi-factor authentication for administrative access. | SpecForge baseline, not a legal minimum: MFA for administrative access | NIS2 Art. 21(2)(j) | Is the authentication method specified? |
| SEC-02 | Security (SEC) | The system shall enforce authorisation by role-based or attribute-based access control with least privilege. | SpecForge baseline, not a legal minimum: RBAC/ABAC with least privilege | NIS2 Art. 21(2)(i) | Is the permission model defined? |
| SEC-03 | Security (SEC) | The system shall encrypt data at rest with AES-256 or an equivalent algorithm. | SpecForge baseline, not a legal minimum: AES-256 or equivalent | NIS2 Art. 21(2)(h) | Are encryption requirements documented? |
| SEC-04 | Security (SEC) | The system shall encrypt data in transit with TLS 1.3. | SpecForge baseline, not a legal minimum: TLS 1.3 | NIS2 Art. 21(2)(h) | Is transport encryption specified? |
| SEC-05 | Security (SEC) | The system shall store secrets only in a vault or key management service and never in plaintext. | SpecForge baseline, not a legal minimum: no plaintext secrets; vault/KMS mandatory | | Is secrets handling described? |
| SEC-06 | Security (SEC) | The system shall validate all input server-side against an allowlist. | SpecForge baseline, not a legal minimum: allowlist-based, server-side validation | | Are validation rules defined? |
| SEC-07 | Security (SEC) | The system shall protect sessions with a timeout, session identifier rotation and secure cookie flags. | SpecForge baseline, not a legal minimum: timeout, rotation, secure flags | | Are session requirements documented? |
| SEC-08 | Security (SEC) | The system shall protect its API with rate limiting, API key or OAuth authentication and a CORS policy. | SpecForge baseline, not a legal minimum: rate limiting, API keys/OAuth, CORS | | Are API security requirements defined? |
| SEC-09 | Security (SEC) | The system shall scan for known vulnerabilities (CVE) weekly and remediate critical findings within 48 h. | SpecForge baseline, not a legal minimum: weekly CVE scan, critical findings fixed within 48 h | NIS2 Art. 21(2)(e) | Is the patch process described? |
| SEC-10 | Security (SEC) | The system shall undergo a penetration test by an external provider every year. | SpecForge baseline, not a legal minimum: annual test by an external provider | | Is penetration testing planned? |
| AUD-01 | Audit and logging (AUD) | The system shall log every write operation and every authentication event. | SpecForge baseline, not a legal minimum: all write operations and auth events | | Which events are logged? |
| AUD-02 | Audit and logging (AUD) | The system shall retain logs for at least 90 days and security-event logs for at least 1 year. | SpecForge baseline, not a legal minimum: >= 90 days; >= 1 year for security events | | Is the retention period defined? |
| AUD-03 | Audit and logging (AUD) | The system shall store logs tamper-proof (append-only or signed). | SpecForge baseline, not a legal minimum: tamper-proof (append-only, signing) | | Is log integrity ensured? |
| AUD-04 | Audit and logging (AUD) | The system shall forward logs to a central SIEM. | SpecForge baseline, not a legal minimum: SIEM integration | | Are logs aggregated centrally? |
| AUD-05 | Audit and logging (AUD) | The system shall record for every change the actor, the timestamp and the change. | SpecForge baseline, not a legal minimum: actor, timestamp, change | | Is the audit granularity defined? |
| AUD-06 | Audit and logging (AUD) | The system shall support reporting a significant security incident with an early warning within 24 h and an incident notification within 72 h. | Primary text: early warning within 24 h, incident notification within 72 h (NIS2 Art. 23(4)) | NIS2 Art. 23(4) | Is the reporting process considered? |
| PER-01 | Performance (PER) | The system shall answer critical operations with a p95 response time of at most [X ms]. | SpecForge baseline, not a legal minimum: p95 <= [X ms] for critical operations (open threshold) | | Are latency targets defined? |
| PER-02 | Performance (PER) | The system shall sustain [X] requests per second under load. | SpecForge baseline, not a legal minimum: [X] requests/second under load (open threshold) | | Is the throughput specified? |
| PER-03 | Performance (PER) | The system shall support [X] concurrent users. | SpecForge baseline, not a legal minimum: [X] concurrent users (open threshold) | | Is the concurrent-user count defined? |
| PER-04 | Performance (PER) | The system shall scale horizontally or vertically, with a defined auto-scaling trigger. | SpecForge baseline, not a legal minimum: horizontal/vertical scaling, auto-scaling trigger | | Is scaling behaviour described? |
| PER-05 | Performance (PER) | The system shall enforce a CPU, RAM and storage budget per service. | SpecForge baseline, not a legal minimum: CPU, RAM, storage budgets per service | | Are resource limits defined? |
| DAT-01 | Data protection (DAT) | The system shall classify all processed data into data categories. | SpecForge baseline, not a legal minimum: classification of all processed data | | Which data categories are processed? |
| DAT-02 | Data protection (DAT) | The system shall document a legal basis under GDPR Art. 6 for each processing purpose. | Primary text: a legal basis under Art. 6 GDPR per processing purpose | GDPR Art. 6 | Is the legal basis documented? |
| DAT-03 | Data protection (DAT) | The system shall delete personal data automatically once its purpose is fulfilled. | SpecForge baseline, not a legal minimum: automatic deletion after purpose fulfilment | GDPR Art. 5(1)(e) | Are deletion periods defined? |
| DAT-04 | Data protection (DAT) | The system shall collect only the personal data that is necessary for the purpose. | Primary text: data minimisation (GDPR Art. 5(1)(c)) | GDPR Art. 5(1)(c) | Is data minimisation observed? |
| DAT-05 | Data protection (DAT) | The system shall support data subject requests for access, erasure and portability. | SpecForge baseline, not a legal minimum: access, erasure and portability implementable in the system | GDPR Art. 15, Art. 17, Art. 20 | Are data subject rights considered technically? |
| DAT-06 | Data protection (DAT) | Where processing is likely to result in a high risk to data subjects, the system shall have a data protection impact assessment (DPIA) before processing starts. | Primary text: DPIA for high-risk processing (GDPR Art. 35) | GDPR Art. 35 | Is a DPIA required? |
| DAT-07 | Data protection (DAT) | Where an external provider processes personal data, the system shall be covered by a data processing agreement (DPA). | Primary text: processing by a processor is governed by a contract (GDPR Art. 28) | GDPR Art. 28 | Are DPA requirements documented? |
| OPS-01 | Operations (OPS) | The system shall provide health checks, alerting and dashboards. | SpecForge baseline, not a legal minimum: health checks, alerting, dashboards | | Is monitoring specified? |
| OPS-02 | Operations (OPS) | The system shall support zero-downtime deployment and rollback. | SpecForge baseline, not a legal minimum: zero-downtime deployment, rollback capability | | Is the deployment strategy described? |
| OPS-03 | Operations (OPS) | The system shall keep configuration externalised and versioned, outside the code. | SpecForge baseline, not a legal minimum: externalised, versioned, not in code | | Is configuration management defined? |
| OPS-04 | Operations (OPS) | The system shall have an incident response process with escalation paths and runbooks. | SpecForge baseline, not a legal minimum: escalation paths, runbooks | NIS2 Art. 21(2)(b) | Is an incident response process defined? |
| OPS-05 | Operations (OPS) | The system shall document capacity planning that accounts for forecast growth. | SpecForge baseline, not a legal minimum: forecast growth considered | | Are capacity assumptions documented? |

## Application rules

Migrated from the source's "Anwendung". Rules 1 and 2 describe the SpecForge workflow; under the
a1 profile `profile nfr-inject` performs them (it appends uncovered items instead of marking gaps).

1. Check every spec against all six categories.
2. Add each missing NFR to the spec (SpecForge: mark the gap as `[NFR-Lücke: ...]`).
3. Under KRITIS, **AVA, SEC and AUD are mandatory** — no exception.
4. For a non-KRITIS project, recommend the categories relevant to the domain.
5. Mark an NFR without a quantified target as "not testable".

## Severity of a missing NFR

| category | KRITIS project | non-KRITIS project |
|---|---|---|
| AVA (availability) | BLOCKER | MAJOR |
| SEC (security) | BLOCKER | MAJOR |
| AUD (audit) | BLOCKER | MINOR |
| PER (performance) | MAJOR | MINOR |
| DAT (data protection) | BLOCKER (with PII) | MAJOR (with PII) |
| OPS (operations) | MAJOR | MINOR |
