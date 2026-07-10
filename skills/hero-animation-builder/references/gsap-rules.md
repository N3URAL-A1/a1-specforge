# GSAP Rules

## React integration

- Always `useGSAP()` from `@gsap/react` instead of `useEffect` — auto-cleanup on unmount. Register once: `gsap.registerPlugin(useGSAP, ScrollTrigger)`.
- Scope selectors to the component: `useGSAP(() => { gsap.to('.box', ...) }, { scope: containerRef })`.
- Animations triggered by events after mount must be wrapped in `contextSafe(() => ...)`.
- Store timelines in `useRef`, never in state.

## Properties

- Only GPU-accelerated aliases: `x`, `y`, `xPercent`, `yPercent`, `scale`, `rotation`, `autoAlpha`.
- `autoAlpha` instead of `opacity` — sets `visibility: hidden` at 0 so invisible elements don't intercept clicks.
- Never animate `top/left/width/height/margin` — layout thrashing.

## Hero entrance pattern (text reveal)

```js
const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 1 } });
tl.from('.hero-eyebrow', { autoAlpha: 0, y: 20 })
  .from('.hero-h1 .line', { yPercent: 110, stagger: 0.12 }, '-=0.6') // masked lines
  .from('.hero-sub',  { autoAlpha: 0, y: 16 }, '-=0.5')
  .from('.hero-cta',  { autoAlpha: 0, y: 12 }, '-=0.6');
```
Masked line reveal: wrap each line in an `overflow: hidden` parent, animate the inner span with `yPercent`.

## ScrollTrigger

- One trigger per section, `scrub: true` for scroll-linked, plain `toggleActions` for enter animations.
- Kill/refresh on route change in SPAs (`ScrollTrigger.refresh()` after layout shifts, e.g. images loaded).

## Responsive & accessibility

- `gsap.matchMedia()` for breakpoint-specific animations AND for `(prefers-reduced-motion: reduce)` — in the reduced branch, `gsap.set` elements to their end state instead of animating.

## Restraint

- Entrance timeline total ≤ ~1.5s. Stagger 0.08–0.15s. Nothing should still be animating when the user starts reading.
