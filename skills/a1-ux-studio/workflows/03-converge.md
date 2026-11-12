# Step 3 — Converge: 3 layout variants of the picked family

Goal: render one offline HTML page with exactly 3 variants of the family
picked in step 2. The variants differ in layout and body structure, not in
colour. Record the user's pick in `run.md`.

Template: [../templates/board.html](../templates/board.html). Chat with the
user in German; every file is written in English. The self-rendered board is
the documented path; Claude Code `/design` is optional and never required.

## 1. Gate on the diverge pick

```bash
node <skill-dir>/scripts/run/run.cjs require-pick --board diverge --run-dir <run-dir>
```

Exit 1: stop, go back to step 2. Render nothing here without exit 0.

Read the picked family id from `run.md ## Picks` (or the `Default adopted:`
line). If the pick was Variant 0 (`variant0`), use its `data-family` and keep the
reference's feeling as the guide.

## 2. Plan three structures

Choose 3 layouts that change the element structure of the page body. Each
gets a distinct `data-layout` slug. Examples:

| Layout slug | Body structure |
|-------------|----------------|
| `split-hero` | Two columns: copy and action left, image right |
| `stacked-editorial` | Full-width headline, image band, text columns below |
| `card-grid` | Short intro, grid of cards, action row |
| `sidebar-panel` | Side navigation, main panel with header and list |
| `centered-focus` | One centered column, single action, quiet footer |

For `product` context prefer app structures (`sidebar-panel`, lists,
forms); for `brand` prefer page structures. The brief's Viewport decides
whether the desktop or the mobile arrangement leads.

Hard rule: two tiles with the same element sequence (only colour, font size
or copy changed) are one variant, not two. `board-check --kind converge`
compares the tag-name sequence per tile and fails such a board.

## 3. Render the board

1. Write `<run-dir>/boards/converge.html` from the template, replacing each
   placeholder exactly once and HTML-escape every inserted text value
   (rules in `02-diverge.md`, "Render the board", step 1).
2. `{{tiles}}`: 3 tiles with the template's tile markup:

   ```html
   <section data-a1-tile data-option-id="split-hero" data-family="<picked-family-id>" data-layout="split-hero">
   ```

   - The option id is the layout slug; all three carry the picked family id.
   - Same family tokens (type, colour, spacing) in all three; the same
     screen content from the brief's Intent, laid out differently.
   - Keep the template's pick hint (`pick <option-id>`) in every tile footer.
3. Fonts: reuse `<run-dir>/boards/fonts/` from step 2 and the same
   `{{font_faces}}` blocks. If a variant needs another face, copy its
   directory from `<skill-dir>/templates/fonts/` the same way. Relative
   `fonts/<font-id>/<font-id>-latin-<weight>-normal.woff2` URLs only.
4. No `http(s)://` resource of any kind; missing images are labeled
   placeholder blocks.

## 4. Check the board

```bash
node <skill-dir>/scripts/run/run.cjs board-check --kind converge --run-dir <run-dir>
```

| Result | Action |
|--------|--------|
| Exit 0 | Go to 5. |
| Exit non-zero | Read the reason lines (tile count, same structure, duplicate `data-layout`, remote resource, missing font). Change the structure, not the colours, and rerun. |

## 5. Show it and ask

Open `<run-dir>/boards/converge.html` (`open` on macOS, `xdg-open` on Linux)
and ask in German:

> "Welches Layout nehmen wir? Nenne es, oder sag 'mach einfach'."

| Answer | Command |
|--------|---------|
| One layout, e.g. `card-grid` | `node <skill-dir>/scripts/run/run.cjs pick --board converge --option card-grid --run-dir <run-dir>` |
| "mach einfach" / "just do it" | Adopt the first tile, e.g. `node <skill-dir>/scripts/run/run.cjs pick --board converge --default-adopted split-hero --run-dir <run-dir>`; name the adopted layout to the user. |
| None fits | Ask what is wrong with the structure, then `node <skill-dir>/scripts/run/run.cjs reroll --board converge --run-dir <run-dir>`. Exit 0: re-plan (sections 2–4) and ask again. Exit 1: the one re-roll is used; stop and ask how to continue. |

Repeating the same pick is safe; `run.md ## Picks` keeps one line.

## 6. Gate before leaving

```bash
node <skill-dir>/scripts/run/run.cjs require-pick --board converge --run-dir <run-dir>
```

Exit 0: go to step 4 (assets). Exit 1: back to 5.

## Done when

- `boards/converge.html` has exactly 3 tiles of the picked family with 3
  distinct `data-layout` values and different element structures, and
  `board-check --kind converge` exits 0.
- `run.md ## Picks` holds the converge pick (or `Default adopted:`), and
  `require-pick --board converge` exits 0.
