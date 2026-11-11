# Step 2 — Diverge: 5 families side by side

Goal: render one offline HTML page with exactly 5 style-family tiles built
from the saved brief, open it, and record the user's pick in `run.md`.

Input: `<run-dir>` from step 1 with a complete `## Brief`. Template:
[../templates/board.html](../templates/board.html). Chat with the user in
German; every file is written in English.

The self-rendered board is the only required path.
Claude Code `/design` is optional and never required; without it nothing changes.

## 1. Choose 5 families

<!-- W5-HOOK: family selection rules (design system, brand/product filter,
taste vault, built-in fallback via `run.cjs families`) replace this section. -->

Until the selection rules land, use the built-in list and take the first 5,
unless the brief's Guardrails exclude one (then take the next):

| Family id | Descriptor |
|-----------|------------|
| `print-tech-paper` | Paper tones, technical print grid, mono captions |
| `dither-mono` | One ink colour, dithered imagery, hard edges |
| `vast-quiet-cinematic` | Large calm surfaces, wide spacing, one strong image |
| `technical-systems` | Dense data grid, rules and labels, instrument feel |
| `product-led-minimalism` | Product first, neutral surfaces, few accents |
| `luminous-futurism` | Dark ground, glow accents, soft gradients |
| `monumental-editorial` | Huge display type, magazine rhythm |
| `classical-remix` | Classical serif and proportions, modern twist |

## 2. Render the board

1. Create `<run-dir>/boards/` and write `<run-dir>/boards/diverge.html`
   from the template. Replace each placeholder (`{{title}}`, `{{heading}}`,
   `{{instruction}}`, `{{font_faces}}`, `{{tiles}}`) exactly once; the
   template's header comment documents them.
2. `{{tiles}}`: one tile per family, using the template's tile markup:

   ```html
   <section data-a1-tile data-option-id="print-tech-paper" data-family="print-tech-paper" data-layout="<layout-slug>">
   ```

   - The option id is the family id, so 5 tiles carry 5 different
     `data-family` values.
   - Each tile shows the same screen from the brief's Intent (real headline,
     body copy and primary action in the family's voice), not lorem ipsum.
   - Keep the template's pick hint (`pick <option-id>`) in every tile footer.
   - Respect every Guardrail in every tile.
3. Fonts: choose each family's typefaces from the font directories under
   `<skill-dir>/templates/fonts/` (only allowlisted OFL families ship there).
   Copy each used directory as a whole:

   ```bash
   mkdir -p <run-dir>/boards/fonts
   cp -R <skill-dir>/templates/fonts/<font-id> <run-dir>/boards/fonts/
   ```

   `{{font_faces}}` holds one `@font-face` block per font and weight
   (400, 700), each `src` a relative
   `fonts/<font-id>/<font-id>-latin-<weight>-normal.woff2` reference.
   Never a font CDN, never an OS font name as the design font.
4. No `http(s)://` resource of any kind: no CDN, no remote image, no remote
   script. Images not yet generated are labeled placeholder blocks (assets
   come in step 4).

## 3. Check the board

```bash
node <skill-dir>/scripts/run/run.cjs board-check --kind diverge --run-dir <run-dir>
```

| Result | Action |
|--------|--------|
| Exit 0 | Go to 4. |
| Exit non-zero | Read each reason line (tile count, remote resource, missing font file). Fix the board, rerun. Never show a failing board. |

## 4. Show it and ask

Open the page (`open <run-dir>/boards/diverge.html` on macOS,
`xdg-open` on Linux). Ask in German, one question:

> "Welche Richtung trifft es? Nenne die Family, oder sag 'mach einfach'."

Then record the answer:

| Answer | Command |
|--------|---------|
| One family, e.g. `dither-mono` | `node <skill-dir>/scripts/run/run.cjs pick --board diverge --option dither-mono --run-dir <run-dir>` |
| "mach einfach" / "just do it" / no preference | Adopt the first tile on the board, e.g. `node <skill-dir>/scripts/run/run.cjs pick --board diverge --default-adopted print-tech-paper --run-dir <run-dir>`. Tell the user which family was adopted. |
| None fits | Re-roll rule (6). |
| Brings an own reference | Variant 0 rule (5). |

Repeating the same pick is safe; `run.md ## Picks` keeps one line.

## 5. Variant 0 rule

If the user brings an own reference (URL or image) and wants it on the board,
add it as a sixth tile with option id `variant0`:

```html
<section data-a1-tile data-variant0 data-option-id="variant0" data-family="<closest-family-id>" data-layout="<layout-slug>">
```

The tile interprets the reference's feeling in the brief's screen; it does
not copy the reference (match the feeling, do not copy; no embedded
remote image). Keep the 5
family tiles. Rerun `board-check` (it accepts 5 tiles plus one
`data-variant0`, nothing else), reopen and ask again.

## 6. Re-roll rule

If the user rejects all 5 families:

1. Ask what was wrong. Turn the answer into changed Guardrails or a new
   Aesthetic hint; say the change back in German.
2. Run `node <skill-dir>/scripts/run/run.cjs reroll --board diverge --run-dir <run-dir>`.
   Exit 0: choose 5 families again with the changed input, render a new
   board (sections 2–4), ask again.
3. Exit 1 means the one re-roll is used up. Stop rendering. Ask the user how
   to continue (adopt a default, sharpen the brief in step 1, or end the run).
   Never render a third board on your own.

## 7. Gate before leaving

```bash
node <skill-dir>/scripts/run/run.cjs require-pick --board diverge --run-dir <run-dir>
```

Exit 0: go to step 3. Exit 1: no pick is recorded — go back to 4. Step 3
never starts without exit 0 here.

## Done when

- `boards/diverge.html` has exactly 5 `data-a1-tile` sections (plus at most
  one `data-variant0`), and `board-check --kind diverge` exits 0.
- Every font the board references exists under `boards/fonts/`.
- `run.md ## Picks` holds the diverge pick (or `Default adopted:`), and
  `require-pick --board diverge` exits 0.
