---
name: hero-animation-builder
description: Builds production-grade web animations — hero sections, 3D scenes, scroll choreography, entrance reveals, micro-interactions. MUST trigger on ANY web animation request - "hero animation" (alias "Hero-Animation"), "3D hero", "animated landing page" (alias "animierte Landingpage"), "hero space", "cinematic intro", "scroll animation" (alias "Scroll-Animation"), "WebGL", "animate this section" (alias "animiere diese Section"), "web animation" (alias "Web-Animation"), "motion design for the site", or upgrading static UI with motion. Covers Three.js/R3F, GSAP, Framer Motion and CSS-only approaches.
---

# Hero Animation Builder

Builds high-end animated hero sections. Works in four strict phases — never skip a phase, never write code before Phase 3.

## Phase 1 — Clarify & Layout

Before anything else, establish (ask the user if unknown):

1. **Stack**: Vanilla HTML/JS, React/Next.js, Vue, or other? This decides the library integration pattern.
2. **Layout & dead space**: Where does the copy (H1, subline, CTA) live, and where does the visual weight go? Classic splits: text-left / 3D-right, centered text over full-bleed background scene, or text overlaying a dimmed scene. The H1 placement drives everything else.
3. **Motion concept**: One clear idea, not five. Examples: a slowly rotating geometric object with mouse parallax; a particle field that reacts to the cursor; a scroll-driven camera move; a shader gradient blob. Every animation must have a purpose.
4. **Brand constraints**: Fonts, colors, existing design tokens. If none exist, propose a palette — never default to purple/indigo gradients and Inter (see anti-slop rules).

## Phase 2 — Design Plan (Anti-AI-Slop Gate)

Write a short plan (5–10 lines) and check it against `references/design-rules.md` before coding. Hard rules:

- No purple/indigo gradients, no Inter/Roboto/Arial as display font, no "three rounded cards" pattern.
- Expressive display typography (e.g. a serif like Fraunces, or a characterful grotesque), strict spacing system, high contrast.
- Motion restraint: no hover-scale on everything, no stagger spam, no undamped springs on utility elements.
- Pick the lightest tech that delivers the concept: CSS only < GSAP < Three.js. Real 3D only when the concept needs actual geometry/lighting.

## Phase 3 — Implementation (Performance-First)

Load the matching reference before writing code:

- Three.js / React Three Fiber → `references/threejs-rules.md`
- GSAP → `references/gsap-rules.md`
- Framer Motion / Motion.dev → `references/motion-rules.md`

Non-negotiable rules for every implementation:

- **GPU-only properties**: animate `transform` (x/y/scale/rotate) and `opacity` only. Never top/left/width/height.
- **`prefers-reduced-motion`**: always ship a static or minimal-motion fallback.
- **Frame-rate independence**: multiply per-frame movement by delta time.
- **No allocations in render loops**: create vectors, geometries, materials once, mutate them per frame.
- **Load budget**: hero must be interactive fast — lazy-init heavy scenes, `poster`/static fallback first paint, videos < 5 MB WebM.
- **Mobile**: test the layout mentally at 390px width; cap devicePixelRatio at 2; reduce particle counts on small screens.

## Phase 4 — Verify (Screenshot Loop)

Claude cannot see its own rendered output — always close the loop visually:

1. Serve the project (`python3 -m http.server` or `npm run dev`).
2. Run `scripts/screenshot.mjs` (Playwright) to capture the hero at desktop (1440×900) and mobile (390×844) — it captures two frames ~1.5s apart so motion is visible as a diff.
3. Read the screenshots. Audit against the Phase 2 plan: typography hierarchy, spacing, contrast, composition, is the animation actually visible?
4. Fix issues, re-screenshot. Two to three rounds are normal. Show the final screenshot to the user.

## Output

Deliver: the working code, a one-paragraph explanation of the motion concept, and the final screenshots. Mention the reduced-motion fallback explicitly.
