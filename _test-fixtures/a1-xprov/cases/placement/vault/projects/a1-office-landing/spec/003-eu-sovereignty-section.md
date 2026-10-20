---
type: spec
id: 003-eu-sovereignty-section
project: a1-office-landing
feature_slug: eu-sovereignty-section
title: EU Sovereignty Section
status: done
created: 2026-08-20
phase_history:
- phase=discover completed=2026-08-20T00:00:00.000Z
- phase=specify completed=2026-08-20T08:10:19.288Z
- phase=clarify completed=2026-08-20T08:10:19.289Z
- phase=plan completed=2026-08-20T08:14:16.611Z
- phase=implement completed=2026-08-20T08:44:42.831Z
- phase=verify completed=2026-08-20T08:44:42.832Z
wave_plan_path: null
verify_failures: []
roadmap_entry: 003-eu-sovereignty-section
size: S
permalink: vault/project/a1-office-landing/spec/003-eu-sovereignty-section
---

# EU Sovereignty Section

> Spec ID: `003-eu-sovereignty-section` · Project: `a1-office-landing` · Status: `draft`

---

## Discovery — Problem

- (Derived, compact path — Robert not available for interview, order given verbatim, spec written directly per team lead brief) EU sovereignty ("EU-Souveränität") of the A1//office platform is a real, materializing product capability — Scaleway Key Manager (EU KMS, region fr-par) went live 2026-08-18, an EU-region database migration (Scaleway Managed PostgreSQL) is in preparation — but this is currently under-communicated on the public landing page. `ValueSection`'s existing "Datenschutz ist nie ein Aufpreis" item only gestures at "EU-compliant providers" in one bullet; there is no dedicated section naming the concrete infrastructure commitment.

## Discovery — Primary User

- (Derived) Same as specs 001/002: prospective A1//office customers (SMB decision-makers, EU-based) evaluating the product on the public start page — specifically those for whom data sovereignty/GDPR posture is a purchase-decision factor (regulated or security-conscious SMEs, agencies handling client data).

## Discovery — User Journey

- (Derived) Visitor lands on `/en/start` or `/de/start`, scrolls Hero → Value → (new) EU Sovereignty moment → Pricing → Contact. The sovereignty message should land either as its own compact section or as a reinforced/expanded value-item + hero-adjacent trust badge — the visitor should not have to reach Pricing/legal pages to learn the EU-infrastructure story.

## Discovery — Acceptance Criteria

- User decision (verbatim, team lead brief): a new "EU Sovereignty" section/moment on the landing page, plus optionally a compact trust badge/mention in the Hero. Max 2 FRs with acceptance criteria for the section itself.
- (Derived) Claims MUST be factually accurate to the current infra state: Scaleway (single EU provider strategy), region fr-par (Paris), Scaleway Key Manager live since 2026-08-18 (encryption keys held by an EU provider, by-design non-extractable), EU database migration described as in progress / underway — NOT claimed as complete. ISO 27001 (Scaleway) may be named; SecNumCloud and C5 certifications MUST NOT be claimed (not held).
- (Derived) Tone must read as an honest commitment/program ("EU-sovereign infrastructure, underway") rather than a finished-state guarantee — consistent with the project's existing anti-voice rule (`lib/site/content.ts` header: "nie: revolutionär, smart, intelligent, magisch, bahnbrechend, innovativ").

## Discovery — Success Metrics

- (Derived) Qualitative: Robert judges the new section communicates the EU-sovereignty commitment clearly and honestly, consistent with `lib/site/content.ts`'s voice guideline.
- (Derived) No regression to Core Web Vitals (CLS) — the new section is static content, no motion-heavy additions beyond the existing `StaggerReveal`/`SectionReveal` patterns already in use.
- (Derived) No factual overstatement — every claim in the new copy traceable to a real, dated infra fact from the brief (KMS live 2026-08-18, fr-par region, Scaleway ISO 27001).

## Discovery — Out of Scope

- (Derived) No new certifications, badges, or logos beyond what is truthfully held today (no SecNumCloud/C5 seals).
- (Derived) No change to `N3URAL //A1` or `A1 //office` brand logos — constraint from brief, logos stay exactly as-is.
- (Derived) No backend/infra work — this is a marketing-copy + presentation change only, reflecting infra state already delivered elsewhere (n3ural-platform ADR 2026-08-03).
- (Derived) No new routes, no new npm dependencies — static content within the existing `start` page render tree.
- (Derived) No claim that the EU database migration is finished — it is explicitly "in preparation" per the brief and must be worded as ongoing.

## Discovery — Edge Cases

- (Derived) If the section names Scaleway/fr-par explicitly, the copy must not accidentally imply multi-provider redundancy — the brief specifies a single-EU-provider strategy.
- (Derived) DE/EN parity: both locales in `lib/site/content.ts` must carry the new copy simultaneously — no locale-specific fact drift (e.g. EN claiming "complete" while DE says "in progress").
- (Derived) The section must degrade gracefully under `prefers-reduced-motion` and on mobile, consistent with `SectionReveal`/`StaggerReveal` behavior already used by `ValueSection`.

## Discovery — Compliance

- (Derived) GDPR-adjacent marketing claim — must not overstate compliance status (no unearned certification claims); aligns with `ludwig-legal` domain but this spec covers copy accuracy only, not a legal sign-off gate.
- (Derived) No new data collection, no new third-party embeds — pure static presentational content.

## Discovery — Dependencies

- (Derived) Depends on the underlying infra facts from `n3ural-platform` (ADR 2026-08-03, P4 waves) being accurate as stated in the brief — this spec does not re-verify infra state, it consumes the facts as given.
- (Derived) Depends on spec 002 (`002-scroll-motion-redesign`, status `done`) being present on `main` for `SectionReveal`/`StaggerReveal` reuse.
- No new npm dependencies.

## Discovery — Priority

- (Derived) P1 — direct, explicit product-communication request from the team lead brief; Size S, single landing-page addition.

---

## Overview

The A1//office landing page's `ValueSection` currently only gestures at EU-compliant data handling in one of three value-proposition cards ("Datenschutz ist nie ein Aufpreis" / "Privacy is never an upsell"). This spec adds a dedicated, honestly-worded EU Sovereignty moment to the start page — communicating the concrete, real infrastructure commitment (single EU provider Scaleway, region fr-par, EU-based encryption key management live since 2026-08-18, EU database migration underway) — plus an optional compact trust mention near the Hero. The addition uses existing content (`lib/site/content.ts`), layout (`ValueSection`'s bento-grid pattern or a small new section following the same `SectionReveal`/`StaggerReveal` conventions), and motion infrastructure; no new dependencies, no new routes, no logo changes.

## User Stories

### P1 (Must-have)

**US-003-1**: **As a** prospective A1//office customer for whom data sovereignty is a purchase factor, **I want** to see a clear, specific statement on the landing page about where and how my company's data and encryption keys are held, **So that** I can evaluate the platform's EU-compliance posture without digging through legal pages.

**US-003-2**: **As a** prospective customer scanning the Hero on arrival, **I want** a compact, immediately visible trust signal about EU sovereignty, **So that** the commitment registers even if I don't scroll further.

## Functional Requirements

- **FR-001**: The start page (`app/[locale]/(site)/start/page.tsx`) MUST render a dedicated EU Sovereignty content block — either as a 4th `ValueSection` item or as its own section directly below/adjacent to `ValueSection` — that names, in both `de` and `en` locales via `lib/site/content.ts`, at minimum: (a) that customer data and encryption keys are held with an EU provider (Scaleway) in the EU (region fr-par/Paris), (b) that encryption key management is live and keys are by-design non-extractable by the provider, and (c) that the move of the primary database to an EU-hosted provider is in progress / underway (not yet complete) — worded as an ongoing commitment, not a finished guarantee, and without claiming SecNumCloud or C5 certification.
- **FR-002**: The Hero section (`components/site/Hero.tsx`) MUST display a compact EU-sovereignty trust mention (e.g. a small badge/line near the eyebrow or subtext, sourced from `lib/site/content.ts`) that is visible without scrolling past the Hero, does not alter the existing `N3URAL //A1`/`A1 //office` brand logos, and does not overstate the claim beyond what FR-001's fuller copy states.

## Success Criteria

- **SC-001**: A visitor on `/en/start` or `/de/start` can identify, without leaving the start page, that A1//office data/keys are held with an EU provider in an EU region, and that key management is live while database migration is in progress — verified by reading the rendered `ValueSection`/new-section copy in both locales.
- **SC-002**: A visitor viewing only the Hero (no scroll) sees a compact EU-sovereignty trust mention within the initial viewport on desktop — verified by inspecting the rendered Hero DOM above the fold.
- **SC-003**: No copy in either locale claims the database migration is complete, or claims SecNumCloud/C5 certification — verified by text review of both `de` and `en` entries in `lib/site/content.ts`.
- **SC-004**: The new content block reveals via the existing `SectionReveal`/`StaggerReveal` motion conventions (fade/translateY/scale, reduced-motion-gated, non-replaying) with zero added CLS — verified by manual QA consistent with spec 002's AC dry-run method.

## Acceptance Scenarios

**US-003-1** (EU Sovereignty content block)
- **Given** a visitor scrolls to the Value/EU-Sovereignty area of `/en/start`, **When** the block is in view, **Then** they read a specific, accurate statement naming the EU provider, region, and current status (keys live, DB migration underway) — not a vague "GDPR compliant" claim alone.
- **Given** the same visitor switches to `/de/start`, **When** they reach the equivalent block, **Then** the German copy states the same facts with no drift (e.g. does not claim completion where the English copy says "underway").

**US-003-2** (Hero trust mention)
- **Given** a visitor lands on the start page and views only the Hero (no scroll), **When** the page has finished rendering, **Then** a compact EU-sovereignty mention is visible in the Hero without requiring interaction, alongside the unmodified `A1//office` brand mark.
- **Given** a visitor with `prefers-reduced-motion: reduce` set, **When** they land on the Hero, **Then** the trust mention is still visible (it is static content, not motion-gated away).

## Edge Cases

- The new content block must not silently overwrite or duplicate the existing "Datenschutz ist nie ein Aufpreis" / "Privacy is never an upsell" `ValueSection` item — either that item is expanded/replaced with the more specific EU-sovereignty copy, or the new block is additive; either resolution must avoid two contradictory or redundant privacy claims on the same page.
- If implemented as a 4th `ValueSection` item, the existing bento-grid CSS (`md:grid-cols-3`, first card `md:col-span-2`) must be re-validated for a 4-item layout — the current grid assumes 3 items and was not designed for 4.
- Hero space is already tight (eyebrow, two-line gradient headline, subtext, dual CTA, mockup) — the trust mention must fit without pushing CTAs below the fold on common viewport sizes or breaking the existing `HeroParallax`/`.animate-mockup-float` composition.
- Locale switch (DE/EN) causes a full page reload (per spec 001/002 AC dry-run) — no client-state concern for the new static content.

## Out of Scope

- Any new compliance certification acquisition or claim (SecNumCloud, C5, or others not currently held).
- Backend/infrastructure changes — this spec is presentation-only, consuming already-delivered/in-progress infra facts from `n3ural-platform`.
- Changes to `N3URAL //A1` or `A1 //office` brand logos.
- A dedicated new route/page for compliance/security detail (e.g. no new `/security` or `/trust` page) — content lives within the existing start page.
- Automated visual-regression or copy-accuracy test infrastructure (manual QA remains the acceptance method, consistent with specs 001/002).

## Dependencies

- Depends on spec 002 (`002-scroll-motion-redesign`, status `done`) for `SectionReveal`/`StaggerReveal` reuse.
- Depends on the accuracy of infra facts supplied in the team lead brief (Scaleway, fr-par, KMS live 2026-08-18, DB migration in progress) — sourced from `n3ural-platform` ADR 2026-08-03 and P4 waves; this spec does not independently re-verify that infra state.
- No new npm dependencies.
- No backend, database, or third-party API dependencies.

## Clarifications

- **2026-08-20** — Compact path: Robert unavailable for interview; team lead brief authorized direct compact-path spec authoring per explicit order. Assumptions below adopted as defaults rather than raised as `[NEEDS CLARIFICATION]` markers, per fast-path instruction.
- **2026-08-20** — Placement: Default adopted — EU Sovereignty content may be implemented either as an expanded/4th `ValueSection` item or as its own adjacent section; exact choice deferred to planning/implementation, both are within FR-001's acceptance bounds. Reason: brief said "new section... plus ggf. compact trust badge", leaving exact layout mechanism open by design.
- **2026-08-20** — Certification wording: Default adopted — Scaleway ISO 27001 may be named as a real, held certification; SecNumCloud/C5 explicitly excluded as not held. Reason: explicit instruction in brief ("Kein Claim von Zertifizierungen die wir nicht haben").
- **2026-08-20** — DB migration status wording: Default adopted — copy must say "in progress / underway", never "complete". Reason: explicit instruction in brief ("NOCH NICHT abgeschlossen").

## Review Checklist

- [x] All P1 stories have at least one Acceptance Scenario
- [x] All FRs are binary and testable
- [x] All SCs are measurable
- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Out of Scope is non-empty (be explicit, not implicit)
- [x] Dependencies are listed or explicitly "none"

## AC Dry-Run

Verified real-code claims before walking the ACs:
- `app/[locale]/(site)/start/page.tsx` confirmed as the real mount point: renders `Hero` (eager `SectionReveal`) then `ValueSection` (`SectionReveal`) then `PricingSection`/`ContactSection` — the real insertion point for FR-001's new block (lines 28-42).
- `ValueSection` confirmed: `components/site/ValueSection.tsx` renders `getSiteContent(locale).value.items` (currently 3 items) inside `StaggerReveal`, bento-grid (`md:grid-cols-3`, first card `md:col-span-2`) — real, existing 3-item assumption noted as an Edge Case for a 4th item.
- `lib/site/content.ts` confirmed as the real, single source of DE/EN copy — `SiteContent.value.items: { title, desc, accent }[]` and `SiteContent.hero: { eyebrow, titleLine1, titleAccent, titleLine2, subtext, primaryCta, secondaryCta }` — both real, extendable interfaces; no `trust`/`sovereignty` field exists yet, confirming FR-001/FR-002 require either extending `SiteContent` or adding a new field, not inventing a nonexistent one.
- Existing "Datenschutz ist nie ein Aufpreis" / "Privacy is never an upsell" item confirmed real at `lib/site/content.ts` (`value.items[1]` in both `de`/`en` blocks) — the Edge Case about avoiding a duplicate/contradictory privacy claim references this real, located item.
- `Hero.tsx` confirmed real: eyebrow + `pulse-dot` span (lines 30-33), two-line gradient headline, subtext, dual CTA, `HeroParallax`-wrapped `HeroDashboardMockup` — real, tight layout confirming the Hero-space Edge Case is grounded in the actual component, not speculative.
- `SectionReveal`/`StaggerReveal` reuse confirmed real and already the established pattern for `ValueSection` (StaggerReveal, `components/motion/StaggerReveal.tsx`) — SC-004's motion-convention reuse is a real, available mechanism, not a new one.

**US-003-1**: PASS — real mount point (`start/page.tsx`), real content source (`lib/site/content.ts`), real existing partial-overlap item identified as an Edge Case to resolve during implementation, not an ambiguity blocking the spec.
**US-003-2**: PASS — real, located `Hero.tsx` component and `SiteContent.hero` interface; addition is a scoped, real extension point.

**Verdict: 2/2 PASS.**