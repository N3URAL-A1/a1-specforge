---
id: 006-specforge-kritis-profile
project: a1-specforge
feature_slug: specforge-kritis-profile
title: "Fold SpecForge into a1 — EARS/STRIDE/NIS2 as an optional `--profile kritis`"
status: implementing
created: 2026-09-03
phase_history:
  - "phase=discover completed=2026-09-03 (drafted by a1-roadmap run in n3ural-brain;"
  - "phase=specify completed=2026-09-13T20:18:59.184Z"
  - "phase=clarify completed=2026-09-13T20:18:59.185Z"
  - "phase=plan completed=2026-10-27T06:42:09.520Z"
wave_plan_path: project/a1-specforge/plans/006-specforge-kritis-profile-wave-plan.md
verify_failures: []
fixtures: []
permalink: vault/project/a1-specforge/spec/006-specforge-kritis-profile
proposal_source: "~/code/obsidian-notion-clone/.a1/RESEARCH.md"
roadmap_entry: continuous
size: L
type: spec
---

# SpecForge → a1 KRITIS profile

> Spec ID: `006-specforge-kritis-profile` · Project: `a1-specforge` · Status: `draft`
>
> **Kurzfassung (DE):** SpecForge (2.933 Zeilen, 9 Modi) und a1-new-feature/Rene schreiben beide
> Specs — doppelt. Exklusiv in SpecForge sind nur drei Bausteine: EARS-Syntax, STRIDE-Threat-
> Modeling und der NIS2/KRITIS-NFR-Katalog (plus Stakeholder-Simulation). Vorschlag: diese drei
> werden eine optionale Lane `--profile kritis` in a1-new-feature/a1-plan; SpecForge Modus 8
> (Management & Traceability) übernimmt `product status` + N3URAL Brain; der Rest ist redundant.
> Der Skill `specforge` wird zu einem dünnen Alias. **Entscheidung steht noch aus** — Robert
> fragte am 2026-09-03 „brauchen wir SpecForge überhaupt noch?"; dies ist die Antwort als Spec.

---

## Discovery — Problem

- Two spec engines coexist: `specforge` (Modi 1–9: Specify, Clarify, Plan&Tasks, Analyze,
  Checklist, Stakeholder-Simulation, Review, Management&Traceability, Discover) and a1
  (`a1-new-feature` with Rene = Specify/Clarify, Adam = Analyze/Audit, Reinhard = Review,
  Rafael = reverse-spec/Discover, `a1-checklist`). Overlap ≈ 6 of 9 modes.
- Modus 8 (traceability tables, artifact overview, "where do we stand") is display work; a1
  already has `product status`/`markers`/`NEXT.md`, and N3URAL Brain M3 renders it on both devices.
- Exclusive SpecForge value: EARS requirement syntax (Anhang C), STRIDE threat modeling (Anhang
  E), automatic NIS2/KRITIS NFR injection, Devil's-Advocate stakeholder simulation, and the
  "session isolation / blank slate" rule for regulated contexts (Vodafone/KRITIS).
- Cost of the duplication: two vocabularies (spec.md/plan.md/tasks.md vs. `###-slug.md` +
  wave plans), two folder conventions, two learning loops, 2.9k lines of skill text loaded on
  trigger words ("Spezifikation erstellen") that also match a1 triggers.

## Discovery — Primary User

- Robert, choosing one spec pipeline for N3URAL projects and a governance-hardened variant for
  Vodafone/KRITIS work.
- a1 agents (Rene, Adam, Samuel) gaining the KRITIS lane.

## Discovery — User Journey

- Robert runs `a1-new-feature` as today. For a regulated project (constitution or
  `docs/product/index.json` flag `profile: kritis`, or `--profile kritis`), Rene writes
  requirements in EARS form, Samuel runs a STRIDE pass at Gate C, the NIS2/KRITIS NFR catalogue
  is auto-appended as FR-NFR-###, and the stakeholder simulation runs as an optional Clarify step.
- Typing "specforge" or "erstelle eine Spezifikation" routes to `a1-new-feature`; the old
  standalone skill prints a one-line deprecation pointer.

## Discovery — Acceptance Criteria

- One spec format (a1's `###-slug.md`) for all projects; KRITIS profile adds sections, never a
  second format.
- STRIDE, EARS, NIS2-NFRs, stakeholder simulation available and fixture-tested inside a1.
- `specforge` skill reduced to an alias; SpecForge Anhänge A–I migrated into
  `_shared/profiles/kritis/`.

## Discovery — Out of Scope

- Rewriting existing SpecForge-format specs in Vodafone repos (adopt on touch via
  `a1-modernize spec-only`).
- Any UI — N3URAL Brain covers display separately.

## Discovery — Dependencies

- Robert's go decision (open). 005 is independent.

## Discovery — Priority

- P2. Reduces maintenance and trigger ambiguity; not blocking any N3URAL Brain milestone.

---

## Functional Requirements

- **FR-001**: `a1-new-feature` MUST accept `--profile kritis` (CLI flag) and MUST auto-enable it
  when `docs/product/index.json` carries `profile: kritis` or the project constitution declares
  it.
- **FR-002**: Under the KRITIS profile, Rene MUST express every FR in EARS form (Ubiquitous /
  Event-driven / State-driven / Unwanted / Optional) using the template migrated from SpecForge
  Anhang C; a deterministic check MUST flag non-EARS FRs at Gate 4.5.
- **FR-003**: Under the profile, Gate C MUST spawn `a1-samuel-security` for a STRIDE pass
  producing `docs/product/features/<id>/threat-model.md` (template from Anhang E).
- **FR-004**: Under the profile, the NIS2/KRITIS NFR catalogue (migrated from SpecForge) MUST be
  appended as `FR-NFR-###` entries with source references, deduplicated against existing FRs.
- **FR-005**: Stakeholder & reviewer simulation (SpecForge Modus 6) MUST be available as an
  optional Clarify sub-step (`--simulate security-officer,dpo,ops`) in Rene's workflow.
- **FR-006**: SpecForge Modus 8 MUST NOT be ported; its needs are covered by `product status`,
  `product markers`, and N3URAL Brain. The deprecation notice MUST say so explicitly.
- **FR-007**: The `specforge` skill MUST become an alias skill (≤40 lines) that prints a
  deprecation message and invokes `a1-new-feature --profile kritis`; its trigger list MUST be
  reduced to "specforge" only so it no longer competes with a1 triggers.
- **FR-008**: Without the profile, `a1-new-feature` behavior MUST remain byte-identical
  (fixture-verified) — no NFR injection, no STRIDE spawn, no EARS check.

## Success Criteria

- **SC-001**: Fixture run of `a1-new-feature --profile kritis` on a sample feature produces a
  spec whose FRs all pass the EARS check, a threat-model.md, and ≥1 FR-NFR entry.
- **SC-002**: Fixture run without the profile equals the current golden output.
- **SC-003**: `~/.claude/skills/specforge/SKILL.md` ≤40 lines; "erstelle eine Spezifikation"
  routes to a1 only (trigger-collision check via `skill-doctor`).
- **SC-004**: Retro corpus shows zero SpecForge-format specs created after ship date.

## Acceptance Scenarios

### US-006-1 — KRITIS project
Given `profile: kritis` in index.json, when Robert starts a feature, then EARS + STRIDE + NFRs
are produced without extra prompts.

### US-006-2 — N3URAL project
Given no profile, when Robert starts a feature, then the pipeline is unchanged.

## Clarifications

- **Decided (Robert, 2026-10-27):** retire SpecForge as an alias (FR-007 stands as written).
- **Decided (Robert, 2026-10-27):** "session isolation / blank slate" is a profile flag: under
  `--profile kritis` no memories or learnings are loaded into the run.

## Review Checklist

- [ ] Decision recorded in Clarifications before Plan
- [ ] Anhänge A–I migrated, not duplicated
- [ ] No behavior change without the profile (SC-002)

## Stakeholder Simulation

### security-officer
Assumption challenged: the author assumes `docs/product/index.json` is always trustworthy
input and never attacker-controlled, even though it is a repo file a contributor can edit.

### dpo
Assumption challenged: the author assumes migrating SpecForge's Anhänge carries no personal
data, but Anhang D's NFR catalogue and any worked example specs may still reference real
project or customer names if copied carelessly.

