# Preset: draft

Profile: `draft` (registry lookup: `registry.profiles.draft`). Resolution 1K, 10–20 variants, cheapest/fastest path. Default profile when none is specified (FR-006).

Purpose: explore composition and mood before committing to a final asset. Optimize for range, not polish — the goal is a set of genuinely different directions to choose from, not 15 near-duplicates.

## Composition guidance

Draw on the `imagegen-frontend-web` skill's hero/composition vocabulary for the exploration set — it exists specifically to break the reflexive "text-left / image-right" default and to keep a brand world consistent across variants. Use it as a menu, not a script:

- Vary the **Composition Anchor** across the batch: centered statement, bottom-left over image, off-grid editorial offset, image-as-canvas, stacked center, right-third caption. Do not generate the same anchor 10–20 times — that defeats the point of drafting.
- Vary the **Background Mode**: full-bleed image with tonal overlay, editorial side-image, duotone-treated image, soft radial vignette + product crop, flat color block + detail crop. Cover at least 3–4 distinct modes across the variant set.
- Vary **Hero Scale** across a handful of variants (Giant Statement vs. Mid Editorial vs. Mini Minimalist) so the reviewer sees genuinely different levels of restraint, not just crops of the same idea.
- Keep palette, material vocabulary, and tonal grade **consistent** across all variants in one draft run — only composition and scale should vary, not the brand world itself. Pull palette and material cues from the target project's design tokens (e.g. Maison Muelhens: `#1D1D1B`/`#131313` dark grounds, `#C5A55A` gold accent, 0px corner radius, no pure black) — see the target project's `CLAUDE.md` / `DESIGN.md` for the authoritative palette before drafting.

## Prompt construction

1. State the subject and brand context in one or two sentences (what the image is for, which project/slot it fills).
2. State the fixed brand constraints (palette, mood, material language, what must NOT appear — e.g. no visible logos/text baked into the image unless explicitly required, no people unless the brief calls for it).
3. State the per-variant composition anchor and background mode explicitly, one combination per variant, drawn from the list above.
4. Keep prompts short and concrete. Avoid vague mood language ("epic", "stunning") — describe light, material, framing, and negative space instead.
5. Apply the confidentiality rule from `SKILL.md` before submitting any prompt: never include confidential client material (e.g. pitch-deck contents, unreleased campaign names, internal strategy wording) in the prompt text.

## Output handling

- Write all variants to `.imagegen/drafts/` in the target project (gitignored, never deployed) per `SKILL.md`.
- Label each variant with its composition anchor and background mode in the accompanying note/filename so the reviewer can compare choices at a glance, not just images.
- Drafts are for internal alignment only — never promote a draft-profile image directly to `public/assets/generated/`. A selected composition gets regenerated at final quality via the `hero` or `photoreal` preset.
