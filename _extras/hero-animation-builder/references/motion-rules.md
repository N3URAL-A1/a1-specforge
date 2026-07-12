# Framer Motion / Motion.dev Rules

## Bundle size

- `<LazyMotion features={domAnimation}>` + `m.div` instead of `motion.div` — cuts the bundle dramatically. Import `domMax` only if layout animations/drag are needed.

## SSR (Next.js)

- `initial={false}` on components whose server-rendered state should not re-animate on hydration (prevents flash/mismatch).

## Springs

- Physical UI elements (menus, draggables, toggles): `transition={{ type: 'spring', stiffness, damping, mass }}` — tune, don't default. Text/opacity entrances: tween with `easeOut`, springs on text look wobbly.

## Scroll

- `whileInView` + `viewport={{ once: true, margin: '-10%' }}` for section reveals.
- `useScroll` + `useTransform` for scroll-linked values (parallax, progress bars) — these run off the main React render.

## Variants pattern for hero entrance

```jsx
const container = { show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } };
const item = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } } };
// <m.div variants={container} initial="hidden" animate="show"> ... <m.h1 variants={item}>
```

## Accessibility

- Wrap the app in `<MotionConfig reducedMotion="user">` — automatically disables transform/layout animations for users with `prefers-reduced-motion`, keeps opacity.

## Restraint

- Framer Motion is for micro-interactions and orchestrated entrances. Heavy scroll choreography or WebGL coupling → use GSAP instead.
