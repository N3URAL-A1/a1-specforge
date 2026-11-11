# Step 2 — Diverge: 5 families side by side

Goal: render one offline HTML page with exactly 5 style-family tiles built
from the saved brief, open it, and record the user's pick in `run.md`.

Input: `<run-dir>` from step 1 with a complete `## Brief`. Template:
[../templates/board.html](../templates/board.html). Chat with the user in
German; every file is written in English.

The self-rendered board is the only required path.
Claude Code `/design` is optional and never required; without it nothing changes.

## 1. Choose 5 families

The script decides the candidates; do not pick families by hand. Built-in
list and skill mapping: [../templates/family-catalog.md](../templates/family-catalog.md).

1. Read the brief from `run.md ## Brief`: `Context` (`brand` or `product`)
   and the Guardrails. Write the Guardrails to a temp JSON file
   (`GR="$(mktemp)"`), e.g. `{"always":["dark mode"],"never":["Inter"]}`.
   Never into the target repo; delete it after the call.
2. Run:

   ```bash
   node <skill-dir>/scripts/run/run.cjs families \
     --context <brand|product> \
     --project-claude-md <target-repo>/CLAUDE.md \
     --vault-root "$A1_VAULT_ROOT" \
     --guardrails "$GR"
   ```

   Drop `--project-claude-md` only when there is no target repo (standalone
   run outside a project).
3. Read the JSON output: `candidates` (5 entries, each with `id`,
   `descriptor` and `skills`; the first entry of `skills` is the skill to
   load), `source`, `token_source` and `warnings`.

   | Source | Meaning |
   |--------|---------|
   | `design-system` | The project's `CLAUDE.md` names `n3urala1-design` or `vf-brand`. Every candidate's `skills` is that design system alone; all 5 tiles use its tokens and fonts. |
   | `vault` | Families from `pattern/taste-vault/`, topped up from the catalog if fewer than 5 fit. |
   | `builtin` | No design system and no or an empty vault: the 8 catalog families. |

   For `product`, the script drops every family that lists
   `design-taste-frontend`; no candidate loads it.
4. Tell the user every warning in German, one line each (e.g. a Guardrail
   that conflicts with the design system: the design system wins).
5. Source `design-system`: load the design-system skill now with the Skill
   tool (`n3urala1-design` or `vf-brand`), before rendering, so all tiles
   use its tokens.
6. Exit non-zero: read the reason line, fix the input (path, JSON), rerun.
   Never fall back to a hand-picked list.

The 5 candidates, in output order, become the 5 tiles. Each candidate's
`descriptor` is the tile's direction.

## 2. Render the board

1. Create `<run-dir>/boards/` and write `<run-dir>/boards/diverge.html`
   from the template. Replace each placeholder (`{{title}}`, `{{heading}}`,
   `{{instruction}}`, `{{font_faces}}`, `{{tiles}}`) exactly once; the
   template's header comment documents them.
   HTML-escape every text value you insert (`&` → `&amp;`, `<` → `&lt;`,
   `>` → `&gt;`, `"` → `&quot;` inside attributes), above all text taken
   from the brief: a raw `<id>` in the pick instruction is parsed as a tag
   and disappears from the page. Write it as `pick &lt;option-id&gt;`.
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
   Exit 0: rerun section 1 with the changed Guardrails, render a new
   board (sections 2–4), ask again.
3. Exit 1 means the one re-roll is used up. Stop rendering. Ask the user how
   to continue (adopt a default, sharpen the brief in step 1, or end the run).
   Never render a third board on your own.

## 7. Gate before leaving

```bash
node <skill-dir>/scripts/run/run.cjs require-pick --board diverge --run-dir <run-dir>
```

Exit 0: go to 8. Exit 1: no pick is recorded — go back to 4. Step 3
never starts without exit 0 here.

## 8. Load the chosen family's skill

1. Take the picked family id from `run.md ## Picks` (for `variant0`, its
   `data-family`). Its skill is the first entry of that candidate's
   `skills` in the section 1 output (catalog fallback:
   [../templates/family-catalog.md](../templates/family-catalog.md)).
2. Name it to the user in German, one line, e.g.
   "Family `dither-mono` → lade `industrial-brutalist-ui`."
3. Load it with the Skill tool. It guides steps 3 and 4 (layout, type,
   colour, imagery). A loaded design system still wins over it.
4. The skill is not installed: say so, continue with the catalog
   descriptor alone, and note `Skill missing: <skill>` to the user.

Then go to step 3.

## Done when

- `boards/diverge.html` has exactly 5 `data-a1-tile` sections (plus at most
  one `data-variant0`), and `board-check --kind diverge` exits 0.
- Every font the board references exists under `boards/fonts/`.
- `run.md ## Picks` holds the diverge pick (or `Default adopted:`), and
  `require-pick --board diverge` exits 0.
- The 5 tiles are the candidates from `run.cjs families`, and the chosen
  family's skill is named and loaded.
