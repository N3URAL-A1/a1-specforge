---
type: spec
id: 002-scroll-motion-redesign
project: a1-office-landing
feature_slug: scroll-motion-redesign
title: Scroll Motion Redesign
status: done
created: 2026-07-23
phase_history:
- phase=discover completed=2026-07-23T12:14:05.660Z
- phase=specify completed=2026-07-23T12:14:05.710Z
- phase=clarify completed=2026-07-23T12:14:05.710Z
- phase=consistency-gate-fail completed=2026-07-23T12:21:06.207Z
- phase=plan completed=2026-07-23T12:22:41.840Z
- phase=implement completed=2026-07-23T12:42:07.273Z
- phase=verify completed=2026-07-23T12:42:07.273Z
wave_plan_path: /Users/rob/code/a1-office-landing/.a1/learnings/projects/a1-office-landing/plans/002-scroll-motion-redesign-wave-plan.md
verify_failures: []
roadmap_entry: 002-scroll-motion-redesign
size: M
permalink: vault/project/a1-office-landing/spec/002-scroll-motion-redesign
---

# Scroll Motion Redesign

> Spec ID: `002-scroll-motion-redesign` · Project: `a1-office-landing` · Status: `discovering`

---

## Discovery — Problem

- User decision (verbatim): "Die Galerie wieder raus, aber behindert. Überleg dir andere Animationen, die zum Scrolling passen." — the ValueSection horizontal card-shift ("gallery") shipped in spec 001 does not read well and must be removed; the team is delegated to design replacement scroll-driven motion that fits the site's aesthetic.
- (Derived) All other 001 motion (Lenis smooth scroll, section reveals, nav condensation, scroll-progress bar, anchor bridge, reduced-motion/mobile gates) is working and liked — this is a targeted revision, not a re-do of 001.

## Discovery — Primary User

- (Derived) Same as spec 001: prospective A1//office customers (SMB decision-makers) visiting the public start page to evaluate the product.

## Discovery — User Journey

- (Derived) Same start-page journey as spec 001 (Hero → Value → Pricing → Contact → Footer), minus the horizontal card drift moment in ValueSection, plus new subtler motion moments (hero parallax on load/scroll, staggered card reveals in Value and Pricing) to keep the scroll feeling premium without the disliked effect.

## Discovery — Acceptance Criteria

- User decision: the ValueSection cards must never `translateX` on scroll — the horizontal shift is fully removed, not just toned down.
- User decision (delegated to team): replacement motion is chosen by the team — hero parallax drift + staggered per-card reveals — rather than by further user interview.
- (Derived) All 001 guarantees continue to hold: zero CLS, transform-only animations, CTA clickability/focus preserved, reduced-motion and mobile gating, no-JS content visibility, cleanup of listeners on unmount/navigation.

## Discovery — Success Metrics

- (Derived) Qualitative: Robert judges the reworked motion "passt zum Scrolling" (fits the scrolling) — subjective aesthetic acceptance, same as spec 001.
- (Derived) No regression in Core Web Vitals (CLS, INP) vs. the current (post-001) baseline.
- (Derived) No re-introduction of the disliked horizontal-shift effect in any form.

## Discovery — Out of Scope

- (Derived) Pricing and legal pages remain Lenis-baseline-only, unchanged from spec 001 — no new choreography there.
- (Derived) No further new effects beyond the two decided in this spec (hero parallax, staggered reveals) — avoid scope creep from an open-ended "nice" brief a second time.
- (Derived) No other visual change to the removed-gallery cards beyond returning them to their pre-motion (spec-001-baseline reveal only) state — no new hover/tilt/other per-card effect introduced as a silent replacement.

## Discovery — Edge Cases

- (Derived) Removal must leave no dead code: `ValueGalleryMotion` component, its `value-gallery-shifts.ts` config, and `useScrollProgress` consumer wiring for the gallery use case must be cleanly deleted or reduced — not merely disabled/dead-code-flagged.
- (Derived) Hero parallax must not reintroduce CLS — the Hero's `HeroDashboardMockup` already runs `.animate-mockup-float` (CSS keyframe float); the new scroll-parallax transform must compose with it without fighting/overriding the existing float animation on the same element.
- (Derived) Staggered reveals must still trigger once per section per load (matching `SectionReveal`'s existing non-replay guarantee) — per-child stagger is a timing detail within a single reveal event, not a new re-trigger source.

## Discovery — Compliance

- (Derived) Same as spec 001: `prefers-reduced-motion: reduce` disables both new effects entirely (parallax drift and stagger timing collapse to the plain reveal), consistent with the existing `MotionGateProvider`/`useMotionGate` pattern already in the codebase.
- (Derived) No privacy/data impact — purely presentational, client-side, no new dependencies beyond what spec 001 already introduced.

## Discovery — Dependencies

- (Derived) No new npm dependencies — reuses the existing `lenis` package and the `components/motion/*` / `lib/motion/*` infrastructure already shipped in spec 001 (`LenisProvider`, `MotionGateProvider`, `useMotionGate`, `useIsDesktop`, `useReducedMotion`, `SectionReveal`, `useLenis`).
- (Derived) Depends on spec 001 being implemented and merged (confirmed: `status: done` in `001-lenis-smooth-scroll.md`, code present on `main` under `components/motion/` and `lib/motion/`).

## Discovery — Priority

- (Derived) Single-feature revision, P1 — direct user-requested correction of a shipped feature plus a small scoped enhancement, no dependency on other in-flight work.

---

<!--
  Phase 2 (Specify) appends from here downward. Until Phase 2 runs, the sections below are
  placeholders and may be empty.
-->

## Overview

Spec 001 shipped Lenis smooth scrolling plus a scroll-driven horizontal shift on the ValueSection's three feature cards. User feedback rejected the horizontal-shift effect ("die Galerie... behindert") while asking for other scroll-fitting animations, delegating the choice to the team. This spec removes `ValueGalleryMotion` and its horizontal-shift wiring entirely, and replaces it with two more restrained effects on the start page: a subtle hero parallax drift on the dashboard mockup (desktop only), and a per-child stagger added to the existing section-reveal choreography for the ValueSection and pricing-tier cards. All other spec-001 behavior (smooth scrolling, section-level reveals, nav condensation, progress bar, anchor bridge, reduced-motion/mobile gates, zero-CLS/CTA guarantees) is preserved unchanged.

## User Stories

### P1 (Must-have)

**US-002-1**: **As a** prospective customer who found the previous horizontal card-shift distracting, **I want** the ValueSection cards to no longer shift left/right while scrolling, **So that** the section reads calmly and the content is easy to focus on.

**US-002-2**: **As a** prospective customer scrolling through the Hero, **I want** the dashboard mockup (and its background glow) to drift subtly at a different rate than the rest of the page as I scroll past it, **So that** the hero feels like it has depth and polish without being gimmicky.

**US-002-3**: **As a** prospective customer scrolling into the ValueSection or the pricing tiers, **I want** the individual cards to reveal one after another with a slight delay (rather than all at once), **So that** the reveal feels choreographed and guides my eye across the cards in sequence.

### P2 (Should-have)

**US-002-4**: **As a** visitor with reduced-motion preferences or on a mobile viewport, **I want** the new hero parallax and staggered reveals to be disabled or reduced exactly like the existing spec-001 effects, **So that** the site stays comfortable, accessible, and performant for me.

## Functional Requirements

- **FR-001**: The system MUST remove the `ValueGalleryMotion` component's horizontal-shift behavior entirely — ValueSection's three feature cards MUST NOT receive any scroll-progress-driven `translateX` at any viewport size or motion setting.
- **FR-002**: The `components/motion/ValueGalleryMotion.tsx` component and `lib/motion/value-gallery-shifts.ts` config MUST be deleted (or, if the grid-shell responsibility they carried is still needed structurally, reduced to a plain, behavior-free container) — no dead/unreachable gallery-shift code left in the codebase.
- **FR-003**: `ValueSection` MUST continue to render its three feature cards (Coins/ShieldCheck/Workflow, including the first card's `md:col-span-2` bento layout) inside the existing `SectionReveal` choreography, unchanged in visual structure from spec 001 apart from the removed horizontal shift.
- **FR-004**: The system MUST add a hero parallax effect: `HeroDashboardMockup` (and optionally the hero's background gradient glow) MUST translate vertically at a slightly reduced rate relative to native scroll (approx. 0.85x scroll speed feel), with total accumulated drift capped at approximately 40-60px, using transform-only (`translateY`) styling.
- **FR-005**: The hero parallax effect MUST be active on desktop viewports only (≥768px, matching the project's existing `md:`/`useIsDesktop` breakpoint convention) and MUST be disabled entirely under `prefers-reduced-motion: reduce`.
- **FR-006**: The hero parallax effect MUST be driven by the same Lenis scroll signal used elsewhere in the codebase (`useLenis()` from `lib/motion/lenis-context.ts`), with the same null-instance fallback pattern already established in `useScrollProgress` (native passive `scroll` listener fallback when Lenis is unavailable).
- **FR-007**: The hero parallax transform MUST compose with the Hero mockup's existing `.animate-mockup-float` CSS keyframe animation without overriding or fighting it (both must be able to apply simultaneously, e.g. via separate transform layers/wrapper elements, not a single conflicting inline `transform` property).
- **FR-008**: Within the existing `SectionReveal` choreography, the ValueSection's three feature cards and the pricing page's tier cards (Enterprise anchor + Starter/Team/Pro self-service cards) on the start page MUST reveal with a per-child stagger (approx. 100ms offset between consecutive cards), each child transitioning fade (opacity 0→1) + `translateY` (approx. 12-16px → 0) + `scale` (approx. 0.97 → 1), using the existing CSS-transition-based approach (not JS-driven animation).
- **FR-009**: The staggered card reveal MUST trigger once per section per page load (matching `SectionReveal`'s existing non-replay guarantee) — scrolling back up and down again MUST NOT replay the stagger.
- **FR-010**: All spec-001 guarantees MUST remain intact and unregressed: site-wide Lenis smooth scrolling, section-level reveal-on-scroll (Hero/Value/Pricing/Contact), nav condensation (`ScrollAwareNav`), the scroll-progress bar (`ScrollProgress`), anchor-link smooth-scroll bridging, `prefers-reduced-motion`/mobile gating (`MotionGateProvider`/`useMotionGate`), no-JS content visibility (progressive enhancement), zero CLS, and CTA clickability/keyboard-focusability throughout all animations.

## Success Criteria

- **SC-001**: Scrolling through the ValueSection on any viewport/motion setting shows zero horizontal (`translateX`) movement on any of the three feature cards — verified by inspecting computed styles during scroll.
- **SC-002**: On a desktop viewport (≥768px) with default motion settings, scrolling past the Hero shows the dashboard mockup drifting vertically at a visibly different rate than the surrounding page content, with total drift not exceeding ~60px.
- **SC-003**: On a mobile viewport (<768px) or with `prefers-reduced-motion: reduce` set, the hero parallax effect does not apply — the mockup only shows its existing `.animate-mockup-float` motion, no additional scroll-linked drift.
- **SC-004**: Scrolling the ValueSection or PricingSection into view for the first time shows each card revealing in sequence with a visible, distinct delay between consecutive cards (not all cards appearing simultaneously) — verified via manual QA/frame-by-frame inspection.
- **SC-005**: Re-scrolling up and back down past an already-revealed ValueSection or PricingSection does not replay the staggered reveal — cards stay fully visible/static on re-entry.
- **SC-006**: All spec-001 acceptance criteria (Lenis smooth scroll, anchor navigation, nav condensation, progress bar, reduced-motion/mobile gating, zero CLS, CTA clickability) continue to pass unchanged after this change, verified via re-running the spec-001 AC dry-run checks.

## Acceptance Scenarios

**US-002-1** (Gallery shift removal)
- **Given** a visitor scrolling through the start page on desktop, **When** the ValueSection is in view and they continue scrolling, **Then** none of the three feature cards move horizontally — they remain static (aside from the existing hover-lift and the section-level reveal-in motion).
- **Given** a visitor on a mobile viewport scrolling through the ValueSection, **When** they scroll past it, **Then** the cards show the same static (no horizontal-shift) behavior as desktop — the removal applies universally, not just re-gated by viewport.

**US-002-2** (Hero parallax)
- **Given** a visitor on a desktop browser with default motion settings, **When** they scroll down past the Hero section, **Then** the `HeroDashboardMockup` visibly drifts at a slightly different rate than the surrounding text content, capped at ~40-60px total drift, while its existing floating animation keeps playing independently.
- **Given** a visitor with `prefers-reduced-motion: reduce` set, **When** they scroll past the Hero, **Then** no scroll-linked parallax drift occurs on the mockup (only the pre-existing `.animate-mockup-float` animation, if not itself also reduced-motion-gated, continues as before).

**US-002-3** (Staggered reveals)
- **Given** a visitor scrolling down to the ValueSection for the first time, **When** the section enters the viewport, **Then** the three feature cards fade/slide/scale into view one after another with a short delay between each, rather than appearing all at once.
- **Given** a visitor scrolling to the PricingSection for the first time, **When** the section enters the viewport, **Then** the Enterprise anchor card and the Starter/Team/Pro self-service cards reveal with the same per-card stagger pattern.

**US-002-4** (Reduced motion / mobile parity for new effects)
- **Given** a visitor with `prefers-reduced-motion: reduce` set, **When** they scroll through the ValueSection and PricingSection, **Then** all cards appear immediately/statically without the per-child stagger delay (matching the existing reduced-motion fallback behavior of `SectionReveal`).

## Edge Cases

- Deleting `ValueGalleryMotion` must not break `ValueSection`'s grid layout or the first card's `md:col-span-2` styling — the card grid container itself must be preserved (as a plain div or reintegrated directly into `ValueSection`), just without the motion behavior.
- The hero parallax's scroll-position calculation must behave correctly when the Hero is `eager`-revealed (per `SectionReveal eager` in `start/page.tsx`) — i.e. parallax must not assume the section has already gone through a non-eager IntersectionObserver arm/reveal cycle.
- Browser window resize across the mobile/desktop breakpoint while mid-scroll on the Hero must cleanly enable/disable the parallax transform without a visible jump or stuck offset.
- Rapid scroll direction reversal (scroll down then immediately up) through the Hero must keep the parallax transform smooth and responsive, not stutter or lag behind the real scroll position.
- The stagger delay per card must remain reasonable even if a visitor scrolls very fast past the section — the total stagger sequence should complete quickly enough that it doesn't leave later cards invisible if the visitor has already scrolled well past the section (visibility must not depend on dwell time).
- Locale switch (DE/EN) via the nav's cross-host link causes a full page reload (confirmed in spec 001's AC dry-run) — both new effects re-initialize cleanly on the fresh load, no different handling needed than existing spec-001 effects.

## Out of Scope

- Any choreography (parallax, stagger, or otherwise) on the pricing page or legal pages (Impressum/AGB/Datenschutz) — these remain Lenis-baseline-only, unchanged from spec 001.
- Any further new scroll effects beyond hero parallax and staggered card reveals (e.g. no new cursor effects, no scroll-triggered video/canvas, no additional parallax layers beyond the Hero).
- Any visual/content redesign of the ValueSection cards, Hero copy, or pricing tier data beyond the motion changes described here.
- Reintroducing any form of horizontal card movement as a "compromise" — the user's decision is a full removal, not a reduced-amplitude version.
- Automated visual-regression or animation-timing test infrastructure (manual QA remains the acceptance method, consistent with spec 001 and the project's current lack of a test setup).

## Dependencies

- Depends on spec 001 (`001-lenis-smooth-scroll`, status `done`) being present on `main`: `LenisProvider`, `MotionGateProvider`, `useMotionGate`, `useIsDesktop`, `useReducedMotion`, `useLenis`, `SectionReveal`, `ScrollAwareNav`, `ScrollProgress`, and the existing `app/globals.css` reduced-motion/reveal CSS patterns.
- No new npm dependencies.
- No backend, database, or third-party API dependencies.

## Clarifications

## Review Checklist

- [x] All P1 stories have at least one Acceptance Scenario
- [x] All FRs are binary and testable
- [x] All SCs are measurable
- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Out of Scope is non-empty (be explicit, not implicit)
- [x] Dependencies are listed or explicitly "none"

## AC Dry-Run

Verified real-code claims before walking the ACs (post-001 `main`, worktree gone, code confirmed present):
- `ValueGalleryMotion` exists and performs the horizontal shift: confirmed, `components/motion/ValueGalleryMotion.tsx` — computes `active = isDesktop && !prefersReducedMotion && isNearViewport`, applies `transform: translateX(...)` per card via `cloneElement` (lines 76-83), reading amplitude/direction from `lib/motion/value-gallery-shifts.ts` (`VALUE_GALLERY_SHIFTS`, `getCardTranslateX`). Both files are real, both are the concrete removal targets for FR-001/FR-002.
- `ValueSection` wires the gallery motion around its cards: confirmed, `components/site/ValueSection.tsx:10` imports `ValueGalleryMotion`, wraps the `.map()` card block (lines 44-65) — the grid-shell (`className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3"`) currently lives inside `ValueGalleryMotion` (per its own doc comment, lines 10-23), not in `ValueSection` — removal must relocate this shell back into `ValueSection` or a plain replacement container, confirmed as a real, locatable structural dependency.
- `SectionReveal` wraps `ValueSection` at the page level: confirmed, `app/[locale]/(site)/start/page.tsx:32-34` (`<SectionReveal><ValueSection locale={locale} /></SectionReveal>`) and again for `PricingSection` (lines 36-38) — both are real mount points for the FR-008 per-child stagger extension.
- `HeroDashboardMockup` + `.animate-mockup-float`: confirmed, rendered at `components/site/Hero.tsx:57-59` inside a `div` carrying the `animate-mockup-float` class; the CSS keyframe itself confirmed at `app/globals.css:296` (`@keyframes mockup-float`) and `:330-331` (`.animate-mockup-float { animation: mockup-float 6s ease-in-out infinite; }`) — real, existing animation the new parallax must compose with, not override.
- Lenis scroll signal + null-fallback pattern: confirmed reusable, `lib/motion/use-scroll-progress.ts` (lines 59-70 Lenis-driven branch via `useLenis()`, lines 72-81 native `scroll` listener fallback) and `lib/motion/lenis-context.ts` (`useLenis()` returns `Lenis | null`) — the exact pattern FR-006 requires reusing already exists as a real, non-gallery-specific hook shape.
- `useIsDesktop` / `useMotionGate` breakpoint + reduced-motion gate: confirmed, `lib/motion/use-is-desktop.ts` (768px `md:` query) and `lib/motion/motion-gate-context.ts` (`MotionGateContext`, `useMotionGate()` exposing `{ prefersReducedMotion, isDesktop }`) — both real, already consumed by `ValueGalleryMotion`, `ScrollAwareNav`, `ScrollProgress`; directly reusable for FR-005's desktop-only + reduced-motion gating of hero parallax.
- `SectionReveal`'s non-replay guarantee: confirmed, `components/motion/SectionReveal.tsx` uses an `IntersectionObserver` that calls `observer.disconnect()` once `entry.isIntersecting` fires (lines 55-63) and tracks `isRevealed` state that is never reset — the existing single-trigger mechanism FR-009 must extend to (not duplicate).
- `.section-reveal` CSS: confirmed, `app/globals.css:613-623` (`opacity`/`translateY` transition, `[data-revealed="true"]` end state) — transform/opacity-only, zero-CLS pattern the new per-child stagger transitions (FR-008) must follow.
- `PricingSection` card structure: confirmed, `components/site/PricingSection.tsx` — Enterprise anchor card (`div.card-glass`, lines 36-68) and three self-service tier cards (`.map()` over `SELF_SERVICE`, lines 71-124) rendered in two separate grid containers (`lg:grid-cols-[1.1fr_2fr]`, line 34), not one flat row — the stagger implementation must account for this two-container split (e.g. stagger anchor-then-tiers, or tiers only) rather than assume four uniform siblings in one grid.
- Anchor targets / nav CTAs (`#contact`, `#pricing`) and locale cross-host reload behavior: already verified in spec 001's AC Dry-Run (lines 195-201 of `001-lenis-smooth-scroll.md`) — unaffected by this spec's changes, re-confirmed still applicable since no anchor/link code is touched here.

- **US-002-1a**: PASS — User scrolls the real start page (`app/[locale]/(site)/start/page.tsx`) on desktop into `ValueSection` (real component). Removal target is a real, located component (`ValueGalleryMotion.tsx`) and config (`value-gallery-shifts.ts`) — deleting/reducing them per FR-001/FR-002 is a concrete, unambiguous change, not an invented one. Post-removal, cards render inside `SectionReveal` only (already real, `start/page.tsx:32-34`).
- **US-002-1b**: PASS — Same real `ValueSection` entry point on a mobile viewport (<768px). Since `ValueGalleryMotion` is deleted outright (not just re-gated), there is no viewport-conditional code path left to diverge between desktop/mobile for this specific effect — verifiably universal removal.
- **US-002-2a**: PASS — User scrolls past the real `Hero` section (`components/site/Hero.tsx`) on desktop. NEW: a hero-parallax mechanism (e.g. a `HeroParallax` client wrapper around `HeroDashboardMockup`, reading `useLenis()`/native-scroll fallback per the real, existing pattern in `use-scroll-progress.ts`, gated by the real `useIsDesktop()`/`useMotionGate()`) must be created — no such wrapper exists yet, but every building block it composes (Lenis context, motion gate, the target DOM node, the existing float animation to coexist with) is real and located.
- **US-002-2b**: PASS — User has real `prefers-reduced-motion: reduce` set, verified via the real `useReducedMotion()`/`useMotionGate()` gate already wired into `MotionGateProvider` (`app/[locale]/(site)/layout.tsx:35`). NEW parallax component (same as US-002-2a) must honor this real, existing gate rather than introduce a separate/duplicate reduced-motion check.
- **US-002-3a**: PASS — User scrolls to the real `ValueSection`, already wrapped by the real `SectionReveal` (`start/page.tsx:32-34`). NEW: per-child stagger capability (e.g. a `staggerIndex` prop or CSS `transition-delay` applied per card, extending `SectionReveal` or a new thin wrapper composed with it) must be created — `SectionReveal` currently reveals its whole children block as one unit (confirmed, `SectionReveal.tsx:76-78` wraps `children` in one `<div className="section-reveal">`), so per-card staggering is a real, scoped extension of a real, located component, not an invented mechanism.
- **US-002-3b**: PASS — User scrolls to the real `PricingSection` (`start/page.tsx:36-38`), also already wrapped by `SectionReveal`. Same NEW stagger capability as US-002-3a applies; concrete card targets confirmed real (Enterprise anchor `PricingSection.tsx:36-68`, self-service tiers `:71-124`), with the two-container split noted above as a real structural detail the implementation must handle (not ambiguous — both containers and their card counts are fully enumerable from the source).
- **US-002-4a**: PASS — User has real `prefers-reduced-motion: reduce` set (same real gate as US-002-2b), scrolls the real `ValueSection`/`PricingSection`. The existing real `SectionReveal` reduced-motion branch (`SectionReveal.tsx:71-73`, returns plain `<div>{children}</div>` with no reveal class at all when `prefersReducedMotion` is true) already produces the required "appear immediately, no stagger" behavior structurally — the NEW per-child stagger extension (US-002-3a/3b) must preserve this existing real branch rather than bypass it.

**Verdict: 7 PASS / 0 FAIL.**