# a1-ux-studio family catalog

Built-in list of the 11 style families (spec 024, FR-025, US-024-10). The
studio orchestrates existing style skills and design systems; it does not
duplicate them. `run.cjs families` returns these families when the project
has no design system and the taste vault is missing or empty.

The script reads the same data from `../scripts/run/families.json`. Keep
both files in step: ids, skills and contexts here must equal the JSON.

## Families

| id | name | descriptor | style skills | contexts |
|----|------|------------|--------------|----------|
| `print-tech-paper` | Print tech paper | Warm paper tones, fine rules, technical-manual typography | `minimalist-ui`, `wada-farben` | brand, product |
| `dither-mono` | Dither mono | Monochrome, dithered textures, raw grid | `industrial-brutalist-ui` | brand, product |
| `vast-quiet-cinematic` | Vast quiet cinematic | Wide space, slow pacing, large imagery | `design-taste-frontend`, `frontend-design` | brand, product, trade |
| `technical-systems` | Technical systems | Dense, legible, tool-like interfaces | `industrial-brutalist-ui`, `ui-ux-pro-max` | product |
| `product-led-minimalism` | Product-led minimalism | The product is the hero, chrome stays quiet | `minimalist-ui`, `ui-ux-pro-max` | product |
| `luminous-futurism` | Luminous futurism | Glow, gradients, forward-looking surfaces | `design-taste-frontend`, `frontend-design` | brand, trade |
| `monumental-editorial` | Monumental editorial | Oversized type, magazine rhythm | `design-taste-frontend`, `frontend-design` | brand |
| `classical-remix` | Classical remix | Serif heritage with a modern twist | `frontend-design`, `wada-farben` | brand, product |
| `warm-craft-workshop` | Warm craft workshop | Lime and linen tones, terracotta accent, rounded friendly sans, big call button | `frontend-design`, `wada-farben` | trade |
| `colour-consult-craft` | Colour consult craft | Light and calm, a fan of muted wall colours as the signature, colour advice up front | `frontend-design`, `wada-farben` | trade |
| `regional-trust-craft` | Regional trust craft | Grounded and local, clear facts, family business and master craftsman to the fore | `minimalist-ui`, `wada-farben` | trade |

## Design systems

| skill | fonts | applies when |
|-------|-------|--------------|
| `n3urala1-design` | Inter | The target project's `CLAUDE.md` names it |
| `vf-brand` | Inter | The target project's `CLAUDE.md` names it |

## Rules

- `id` matches `^[a-z0-9][a-z0-9-]{0,63}$` and is the tile's `data-family`.
- `style skills` is in load order. The first entry is the skill to load for
  the family; later entries are companions it may consult (e.g.
  `wada-farben` for the palette).
- Every skill is one of: `design-taste-frontend`, `minimalist-ui`,
  `industrial-brutalist-ui`, `ui-ux-pro-max`, `frontend-design`,
  `n3urala1-design`, `vf-brand`, `wada-farben`.
- `contexts` matches the brief's `Context`. The script orders families
  written for the context first.
- `product` context: `run.cjs families --context product` drops every
  family whose skills include `design-taste-frontend` (FR-017), even when
  its `contexts` lists `product` (`vast-quiet-cinematic`). Product
  candidates therefore: `print-tech-paper`, `dither-mono`,
  `technical-systems`, `product-led-minimalism`, `classical-remix`.
- `trade` context (craft or trade business): `run.cjs families --context trade`
  offers only families that list `trade`: `vast-quiet-cinematic`,
  `luminous-futurism`, `warm-craft-workshop`, `colour-consult-craft`,
  `regional-trust-craft`. Editorial and technical families
  (`monumental-editorial`, `print-tech-paper`, `dither-mono`) never appear
  for a trade business. A family listed for `trade` only is never offered
  for `brand` or `product`. Every trade variant keeps the phone in the first
  screen and a sticky call bar on mobile. Evidence: maler-brungs run
  2026-11-23 (catalog board rejected as magazine/technical; the craft set
  was accepted).
- Design system (FR-016): every candidate loads only that design system;
  its tokens and fonts win over the family and over a conflicting
  Guardrail, and the script warns about the conflict. The family then
  shapes voice, rhythm and imagery only.
