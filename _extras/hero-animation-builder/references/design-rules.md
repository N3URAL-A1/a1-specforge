# Design Rules — Anti-AI-Slop Gate

Check every hero plan against this list before implementation. If a rule is violated, revise the plan.

## Banned (the "AI fingerprint")

- Purple/indigo/violet gradients, especially on dark backgrounds
- Inter, Roboto, Arial, or Space Grotesk as the display font
- Centered hero + three rounded feature cards below
- Hover-scale on every interactive element
- Stagger animations on everything that is a list
- Emoji as icons in a "premium" design
- Glassmorphism cards as a default (only when the concept demands it)

## Required

- **Typography with identity**: an expressive display face (serif like Fraunces/Canela-alikes, or a characterful grotesque like Söhne/General Sans-alikes from Google Fonts: e.g. Fraunces, Instrument Serif, Bricolage Grotesque, Clash-like via Fontshare). Body font may be neutral.
- **Type scale**: H1 is dominant — clamp(3rem, 8vw, 7rem) territory for a hero. Tight leading (0.95–1.05) on display sizes, generous on body.
- **Spacing system**: one base unit (8px), consistent multiples. No arbitrary values.
- **Color discipline**: one dominant background tone, one accent, neutrals. High contrast between H1 and background (WCAG AA minimum, aim AAA).
- **Composition**: deliberate dead space. The 3D/motion element must not fight the copy — it anchors one region (right half, background layer at reduced opacity, or below the fold line).

## Motion principles

- Every animation has one job: guide attention, communicate state, or express brand. If it does none — delete it.
- Entrance choreography: one timeline, elements arrive in reading order, total ≤ 1.5s.
- Ambient motion (the 3D scene) must be slow enough not to compete with reading: rotation < 0.5 rad/s, oscillation periods > 4s.
- `prefers-reduced-motion` fallback is a deliverable, not an afterthought.
