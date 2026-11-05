# `_shared/profiles/kritis/` — the KRITIS profile's migrated assets

Spec `006-specforge-kritis-profile`. Everything the `kritis` profile adds to
a1-new-feature lives here, migrated from the retired SpecForge skill
(`~/.claude/skills/specforge/SKILL.md`, not under git — see
[`MIGRATION.md`](./MIGRATION.md) for provenance). Every file opens with a
`source:` line naming the exact SpecForge line range it was migrated from.
IDs from the source (AVA-01, S-01, GP-01, ...) stay unchanged; prose is
migrated to English per `_shared/language-policy.md`.

Written one wave at a time (Wave 1 writes only this index and the migration
record; the files below do not exist yet):

| File | Wave | From (SpecForge) | Content |
|---|---|---|---|
| `constitution-addendum.md` | 2 | Anhang B (partial) | Regulatory frame, security baseline, the `a1-profile: kritis` constitution marker rule |
| `ears.md` | 3 | Anhang C | The five canonical EARS patterns (English keywords), tag syntax, vague-term list |
| `nfr-catalogue.md` | 4 | Anhang D | The 41-item NIS2/KRITIS NFR catalogue (AVA/SEC/AUD/PER/DAT/OPS), severity table |
| `spec-sections.md` | 4 | Anhang A (partial) | Shape of the three profile-added spec sections (NFR section, threat-model link, Stakeholder Simulation) |
| `stride.md` | 5 | Anhang E | The six STRIDE categories and their 42 check items |
| `threat-model-template.md` | 5 | Anhang E | The `docs/product/features/<id>/threat-model.md` template |
| `stakeholder-roles.md` | 6 | Modus 6 | The nine simulation role ids, focus, method, challenge question |
| `golden-principles.md` | 6 | Anhang F (partial) | GP-01..10 for the harness-auditor role |

`MIGRATION.md` is the full disposition record: every SpecForge Anhang/Modus,
where it went (migrated, superseded, or not ported), and why.
