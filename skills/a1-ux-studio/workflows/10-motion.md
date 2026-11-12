# Step 10 — Motion templates

Goal: add one reusable motion pattern to the result page without breaking
the house rules. Optional step (P3); it runs after the result page exists
(step 4) and before the gate (step 5). Chat with the user in German; every
file is written in English.

Templates (self-contained HTML/CSS, no remote resource), in
`<skill-dir>/templates/motion/`:

| Template | Pattern | Mechanism |
|----------|---------|-----------|
| `hero-reveal.html` | Headline, copy and action fade up in sequence | CSS animation, `transform` + `opacity` |
| `scroll-fade.html` | Blocks fade in once when they enter the viewport | transition + `IntersectionObserver`; visible without JavaScript |
| `ambient-loop.html` | Two soft shapes drift slowly behind the content | CSS animation loop, `transform` + `opacity` |

## House rules (every template, every adaptation)

1. Animate only `transform` and `opacity`. Never `top`, `left`, `width`,
   `height`, margins or box shadows.
2. `@media (prefers-reduced-motion: reduce)` stops all animation and
   transition and leaves the content visible and in place.
3. At `max-width: 640px` the animated parts are removed and the still image
   (`.a1-motion-still`) is shown instead.
4. No remote resource. The still is `../assets/<name>.png` with a
   `data-a1-asset` slot, so step 4 generates it or labels a placeholder.

## 1. Pick and ask

Offer the three patterns in one line each (German) and ask which one fits
the brief's Intent and the picked family. `low`-energy families
(`print-tech-paper`, `monumental-editorial`) suit `scroll-fade`; keep
`ambient-loop` for brand context. One pattern per page is the default.

## 2. Adapt

Copy the `<style>` block (and the script for `scroll-fade`) plus the marked
element into `result/result.html`. Rename selectors only if they clash;
keep all three house rules intact. Change timing, distance and colours to
the family tokens; do not add properties to the animation or transition.

Optional asset: an `image-to-video` clip for the still's slot. Generate it
as in [04-assets.md](04-assets.md); the still stays as the mobile image and
the clip's poster. Reduced motion and mobile must show the still, not the
clip.

## 3. Check with reduced motion emulated

Before the gate, with `playwright-cli` as in [05-gate.md](05-gate.md)
section 1 (`PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true`,
`--browser=chromium`):

```bash
playwright-cli -s=motion open --browser=chromium "file://<run-dir>/result/result.html"
playwright-cli -s=motion set-reduced-motion reduce
playwright-cli -s=motion eval "() => [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).animationName !== 'none').length"
playwright-cli -s=motion clear-reduced-motion
playwright-cli -s=motion close
```

The first count must be `0`. Run the same `eval` once more with
`clear-reduced-motion` active: a count above 0 proves the page does animate
otherwise (the counter-test). Then `resize 390 844` and check that
`.a1-motion-still` has `display: block`.

## Done when

- The page keeps rules 1–4 above; the suite part `12-motion.sh` holds for
  the templates it was adapted from.
- Reduced-motion emulation reports 0 animated elements, and a normal run
  reports more than 0.
