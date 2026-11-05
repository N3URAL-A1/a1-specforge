source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1320-1342

# KRITIS profile — constitution addendum

Migrated from SpecForge "Anhang B: Constitution Template" §3 ("Regulatorischer Rahmen" /
"Sicherheits-Baseline"), English, canonical terms only. §§1, 2, 4, 5, 6 of the original Anhang B
(project principles, Golden Principles, quality standards, architecture decisions, changelog) are
**not** migrated here — they are superseded by a1's own constitution template and by
`_shared/profiles/kritis/golden-principles.md` (Wave 6). This file adds exactly three things to
a project's constitution under the `kritis` profile: the regulatory-applicability table, the
security baseline, and the marker rule that turns the profile on.

This addendum is *data a human fills in* when setting up a regulated project's constitution —
it is not itself enforced by any a1 gate. The only machine-checked line is the marker in the
section below.

## Regulatory applicability

Fill in during project setup (research, not guesswork — the original Anhang B rule #3: "the
regulatory frame is researched at project setup, not guessed").

| Regulation | Applicable | Relevant articles/sections |
|---|---|---|
| KRITIS (BSI, Germany) | Yes/No | [sectors, thresholds] |
| NIS2 | Yes/No | [Art. 21, 23 — risk management, reporting duties] |
| GDPR | Yes/No | [Art. 25, 32, 35 — privacy by design, TOMs, DPIA] |
| IT-SiG 2.0 (Germany) | Yes/No | [relevant duties] |
| Sector-specific | Yes/No | [e.g. EnWG, TKG, BAIT, MaRisk] |

## Security baseline

The minimum; features may set a higher bar, never a lower one (original Anhang B rule #4).

| Category | Minimum requirement |
|---|---|
| Authentication | [e.g. MFA required, OAuth 2.0 + OIDC] |
| Encryption at rest | [e.g. AES-256] |
| Encryption in transit | [e.g. TLS 1.3] |
| Logging & audit | [e.g. every write operation, 90-day retention] |
| Secrets management | [e.g. no plaintext, vault/KMS required] |
| Vulnerability management | [e.g. weekly CVE scan, critical CVEs fixed within 48h] |

## Marker rule — turning the profile on

Add this exact line to the vault constitution body (anywhere; the resolver scans every line):

```
a1-profile: kritis
```

`constitution write-mirror` carries it verbatim to `<repo>/constitution.md`. `a1-tools profile
resolve` reads it as the lowest-precedence source — flag, then spec frontmatter, then
`docs/product/index.json`, then this marker (`docs/adr/2026-10-28-optional-profile-lane.md`
section 3). Any other value on the `a1-profile:` line is a fail-closed error (exit 2, file
named) — there is no fallback to an unregulated run on a typo. A SpecForge-shaped constitution
without this explicit marker line never enables the profile; the resolver uses no heuristics.
