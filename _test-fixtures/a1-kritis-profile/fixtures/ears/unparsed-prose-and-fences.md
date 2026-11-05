---
id: 906-ears-unparsed-prose-and-fences
project: a1-kritis-profile-fixtures
title: Synthetic fixture — a prose cross-reference and a fenced example are not FR lines
status: draft
---

## Functional Requirements

- **FR-001**: The system shall return every API response as JSON. [EARS: ubiquitous]

Notes: FR-010 from spec 005 stays unchanged.

```
- FR-011 example of a line shape the reader rejects
```

- FR-002: The system shall log every request. [EARS: ubiquitous]

~~~
an unclosed fence is read as text, so the next line still counts
- FR-003: The system shall encrypt every stored record. [EARS: ubiquitous]
