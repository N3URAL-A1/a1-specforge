---
id: 906-ears-nfr-section
project: a1-kritis-profile-fixtures
title: Synthetic fixture — FR-NFR-### lines inside the profile's NFR section are read too
status: draft
---

## Functional Requirements

- **FR-001**: The system shall return every API response as JSON. [EARS: ubiquitous]

## Non-Functional Requirements (KRITIS profile)

- **FR-NFR-001**: The system shall log every authentication failure to the security audit log.
  [EARS: ubiquitous]
- **FR-NFR-002**: If the incident response SLA is breached, then the system shall escalate to
  the on-call security officer. [EARS: unwanted]
