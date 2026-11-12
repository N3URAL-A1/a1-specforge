# Step 4 — Assets: result page, then images for the chosen variant

Goal: build `<run-dir>/result/result.html` from the picked variant, then
generate the images it needs (at most 8 per run) with their `.json`
sidecars in `<run-dir>/assets/`. A failed or declined image becomes a
labeled placeholder in the page and a line in `run.md ## Assets`.

Chat with the user in German; every file is written in English. The
self-rendered result page is the path; Claude Code `/design` is optional
and never required. All slot counting, generation and placeholder swaps
run through `run.cjs`; never call `imagegen` directly in this step.

## 1. Gate on the converge pick

```bash
node <skill-dir>/scripts/run/run.cjs require-pick --board converge --run-dir <run-dir>
```

Exit 1: stop, go back to step 3. Build and generate nothing without exit 0.

## 2. Plan the images

1. Read the picked layout from `run.md ## Picks` and the picked tile in
   `boards/converge.html`. List every image slot (hero, section image,
   card image). Name each with a slug (`^[a-z0-9][a-z0-9-]{0,63}$`),
   e.g. `hero`, `feature-1`.
2. Keep the list at 8 or fewer. One strong image beats five weak ones.
3. Write one English prompt per slot from the brief and the family skill
   loaded in step 2: mood, light, palette, composition. The `imagegen`
   rules apply: no real named persons, no third-party logos, no rendered
   text (describe a calm empty area where copy goes). Match the feeling of
   the reference, do not copy it.

## 3. Build the result page first

1. Create `<run-dir>/result/` and write `result/result.html`: the picked
   variant as one full page (not a tile), with the tokens, fonts and
   structure of its converge tile and real copy from the brief's Intent.
2. Each image slot is one tag:

   ```html
   <img src="../assets/<name>.png" data-a1-asset="<name>" alt="<short description>">
   ```

   `run.cjs` finds the slot by `data-a1-asset` and swaps in a labeled
   placeholder when the image is missing. Give the slot its size and ratio
   in CSS so a placeholder keeps the layout.
3. Fonts: reuse `<run-dir>/boards/fonts/`; each `@font-face` `src` is a
   relative `../boards/fonts/<font-id>/<font-id>-latin-<weight>-normal.woff2`.
4. No `http(s)://` resource of any kind. HTML-escape every inserted text
   value (rules in `02-diverge.md`, "Render the board", step 1).
5. Respect every Guardrail and the loaded design system.

## 4. Generate, one slot at a time

For each planned slot, in order:

```bash
node <skill-dir>/scripts/run/run.cjs asset-slot --run-dir <run-dir> --name <name> --prompt "<english prompt>"
```

The script counts the slot in `run.md ## Assets`, calls
`~/.claude/skills/imagegen/scripts/generate.py` for exactly one image and
checks that `assets/<name>.png` and `assets/<name>.json` exist. A failed
attempt still counts toward the cap; each name gets one slot only.

| Result | Action |
|--------|--------|
| Exit 0, line `- slot <n>: <name> generated …` | Next slot. |
| Exit 1, stderr starts with `error: missing:` | Generation failed. The script already recorded it and put the placeholder in the page. Tell the user in German, no retry loop, next slot. |
| Exit 1, stderr starts with `error: question:` | The cap of 8 is reached. Go to 5. |
| Exit 1, `already has a slot` | Choose another name; never reuse one. |
| Exit 2 | Usage or hostile input (name, prompt, path). Fix the input, rerun. |

If imagegen reports a missing API key: stop generating, never search for a
key, tell the user.

## 5. The 9th image needs approval

At the cap, ask in German, one question (use the script's question):

> "Das Limit von 8 Bildern ist erreicht. Soll ich ein weiteres Bild (`<name>`) erzeugen?"

| Answer | Action |
|--------|--------|
| Explicit yes | Rerun the same `asset-slot` call with `--approved` added. Each further image needs its own yes. |
| No / no answer | `node <skill-dir>/scripts/run/run.cjs asset-missing --run-dir <run-dir> --name <name> --reason "declined at the cap"` — records the gap and swaps in the placeholder. |

Never pass `--approved` without the user's explicit yes in this run.

## 6. Missing list and review

1. List what is missing:

   ```bash
   node <skill-dir>/scripts/run/run.cjs asset-missing --run-dir <run-dir>
   ```

   One name per line, empty when complete. Never edit `run.md ## Assets`
   by hand.
2. Tell the user in German which assets are missing and why.
3. Check that every missing name shows a labeled placeholder in
   `result/result.html` (its `data-a1-asset-placeholder="<name>"` block).
4. Open the page (`open` on macOS, `xdg-open` on Linux) and show it. No
   pick here; step 5 gates it.

## Done when

- `result/result.html` exists, has one `data-a1-asset` tag per planned
  slot, and loads no remote resource.
- Every generated image sits in `<run-dir>/assets/` with its `.json` sidecar.
- More than 8 images only with `--approved` after an explicit yes.
- Every missing image is a labeled placeholder in the page and a line in
  `run.md ## Assets`; `asset-missing --run-dir <run-dir>` lists exactly those.
  Go to step 5.
