# Migration record — SpecForge Anhänge/Modi → `_shared/profiles/kritis/`

Spec `006-specforge-kritis-profile`, Wave 1. This is the disposition table
decided in the wave plan, with line ranges re-measured against the source
file on this host and this date (not re-derived or guessed).

**Source:** `~/.claude/skills/specforge/SKILL.md`
**Measured:** 2026-10-28, this host
**Lines:** 2933
**sha256:** `32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54`

Not under git; not in this repo. This file and the sha256 above are the only
provenance once the alias skill replaces it (Wave 7).

Line ranges below are inclusive, re-measured with
`grep -n "^## Anhang\|^### Modus" SKILL.md`: each section starts at its
listed heading and ends one line before the next top-level Anhang/Modus
heading (or at EOF for Anhang I).

| Source (old SKILL.md) | Lines | Disposition | Target | Wave |
|---|---|---|---|---|
| Anhang A — Spec template | 1072–1267 | partial: only the sections the profile adds to an a1 spec (KRITIS NFR section, threat-model link, stakeholder-simulation section); the rest is superseded by `skills/a1-new-feature/templates/spec-template.md` | `spec-sections.md` | 4 |
| Anhang B — Constitution template | 1268–1431 | partial: regulatory frame + security baseline + the `a1-profile: kritis` marker rule; the rest is superseded by the a1-constitution template | `constitution-addendum.md` | 2 |
| Anhang C — EARS | 1432–1596 | migrated to canonical English keywords (The/When/While/Where/If…then … shall) | `ears.md` | 3 |
| Anhang D — KRITIS NFR checklist | 1597–1702 | migrated, 41 items, baseline wording reviewed | `nfr-catalogue.md` | 4 |
| Anhang E — STRIDE | 1703–1850 | migrated, 42 items + output table | `stride.md`, `threat-model-template.md` | 5 |
| Anhang F — Golden Principles | 1851–2099 | GP-01..10 migrated (used by the harness-auditor role); ADR/EP templates superseded by a1-alex ADRs and wave plans | `golden-principles.md` | 6 |
| Anhang G — Folder convention | 2100–2255 | superseded (pointer only): a1 storage convention | `skills/a1-new-feature/SKILL.md` § Storage | — |
| Anhang H — Spec-First Chain | 2256–2480 | superseded (pointer only): a1 phases and gates | `skills/a1-new-feature/SKILL.md` § Phases, `_shared/gates-registry.md` | — |
| Anhang I — Enforcement engine | 2481–2933 | superseded (pointer only): spec status machine and deterministic gates | `spec update-status`, `_shared/gates-registry.md` | — |
| Modus 6 — Stakeholder simulation | 692–720 | migrated | `stakeholder-roles.md` | 6 |
| Modus 8 — Management & traceability | 777–788 | **not ported**: covered by `product status`, `product markers`, N3URAL Brain | — | 7 |
| Session isolation / blank slate | 50–65 | profile flag (Clarification 2026-10-27) | resolver `isolation` field + SKILL.md block | 2, 8 |

Catalogue counts, also re-verified: Anhang D holds 41 NFR ids (AVA 8, SEC 10,
AUD 6, PER 5, DAT 7, OPS 5); Anhang E holds 42 STRIDE items over 6
categories.

Targets do not overlap: every row's `Target` column names at most one new
file under `_shared/profiles/kritis/` (or an existing a1 path for superseded
rows), and no two rows share a target file for different source ranges
except Anhang E, which deliberately splits into two target files (the
catalogue and the template).

## Session isolation / blank slate — source line range

The brief's disposition table lists this row without a measured range. The
"Wissensquellen — Strikte Session-Isolation" section (the blank-slate rule's
source) is at lines 50–65, bounded by the next heading `## Architekturmodell`
at line 66. Measured and added here; not present in the original wave-plan
table.
