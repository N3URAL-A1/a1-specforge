---
id: 024-ux-studio
project: a1-specforge
feature_slug: ux-studio
title: "a1-ux-studio — orchestrating UX/UI skill (taste-driven diverge/converge)"
status: implementing
created: 2026-11-08
phase_history:
  - "phase=discover completed=2026-11-08T15:52:16.317Z"
  - "phase=specify completed=2026-11-08T16:00:14.100Z"
  - "phase=clarify completed=2026-11-08T16:00:14.100Z"
  - "phase=plan completed=2026-11-08T16:13:58.999Z"
wave_plan_path: /Users/rob/N3URAL-Vault/project/a1-specforge/plans/024-ux-studio-wave-plan.md
verify_failures: []
permalink: vault/project/a1-specforge/spec/024-ux-studio
size: M
type: spec
---


## Clarifications

- **2026-11-07** — Permissions, duplicate submit, navigation context carry, CRUD completeness: Default adopted: not applicable to this feature (public site without login, no forms, listings maintained as repo files). Reason: these concerns belong to the forms and listing-UI features.
- **2026-11-07** — UX/Header: Variant 1A chosen (white sticky header, logo left, nav centre, filled #007ABD phone CTA right; below lg: logo + tel icon button 44x44 + burger opening a full-screen panel #FAFAFA with entries and full-width "Jetzt anrufen" button). Reason: original logo stays legible on white; phone CTA serves both audiences.
- **2026-11-11** — UX/login-screen: Variant B chosen. Reason: calm split layout fits the brief.
  Run: project/a1-specforge/ux/024-ux-studio/2026-11-11-login-screen/run.md
  Handoff notes: touch targets 44 px, visible focus ring, no horizontal scroll at 390 px.
- **2026-11-07** — Gate C fix (US-001-4): Scenario rewritten as a unit test via the `ListingSource` factory (no page); `LISTING_SOURCE=memory` added as test-only value, rejected unless `NODE_ENV=test` and never in a production build (FR-015). Reason: the foundation has no page calling `findBySlug`, and the in-memory source had no defined selector value.

## Requirements

- **FR-001** - placeholder requirement line.
