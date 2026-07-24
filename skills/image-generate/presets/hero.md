# Preset: hero

Profile: `hero` (registry lookup: `registry.profiles.hero`). Resolution 2K or 4K, aspect ratio 16:9 or 21:9. Final, production-ready asset — not an exploration variant.

Purpose: generate the one image that ships. By the time this preset runs, a composition has already been selected during a `draft`-profile pass (or the target slot's brand/composition intent is otherwise unambiguous). This preset is not for exploring options — see `presets/draft.md` for that.

## Composition guidance

- Commit to a **single, specific composition** — do not hedge between two ideas in one prompt. If the composition was chosen from a `draft` run, describe that exact composition (anchor, background mode, framing) rather than a looser variant of it.
- Prefer restraint over spectacle. Reference the `imagegen-frontend-web` skill's Hero Minimalism Rules for the underlying discipline (clean first viewport, short powerful visual statement, generous negative space, no clutter, no generic AI blobs/glow/gradient-as-shortcut) — apply that discipline to a single photographic/editorial image, not a full UI comp.
- Leave deliberate negative space for text/wordmark overlay where the target component composites text on top of the image (check the target component's layout before writing the prompt — e.g. `components/mm/hero.tsx` centers a wordmark and headline, so the image needs a calm zone behind or beside that content, not visual noise across the whole frame).
- Palette and material language MUST match the target project's design tokens exactly — pull hex values and mood descriptors from the project's `CLAUDE.md` / `DESIGN.md` (e.g. Maison Muelhens: near-black grounds `#1D1D1B`/`#131313`/`#1B1B1B`, gold accent `#C5A55A` used sparingly, no pure `#000000`, quiet luxury/heritage/restraint mood, no visible logos or text baked into the image, no people unless the brief explicitly calls for it).
- Aspect ratio and resolution are run parameters, not creative choices — confirm both explicitly with the invoking step (per `SKILL.md`'s `image_config` verification requirement) rather than assuming a default.

## Prompt construction

1. Name the exact project, slot, and component the image is for (e.g. "Editorial hero photograph for Maison Muelhens, slot `mm-hero`, `components/mm/hero.tsx`").
2. Describe the single committed composition in concrete visual terms: subject, lighting, material, camera framing, negative-space placement.
3. State the brand palette and mood explicitly, with hex values where available.
4. State what must NOT appear: no baked-in text/logos/wordmarks (those are composited in code), no people unless required, no competing focal points.
5. Apply the confidentiality rule from `SKILL.md`: never include confidential client material in the prompt.

## Output handling

- Generate via the model resolved from `registry.profiles.hero.model_id` — never a literal model ID.
- After generation, run the mandatory `image_config` verification step from `SKILL.md` before treating the run as successful — an honored-but-unconfirmed aspect ratio/resolution is a failure, not a pass.
- Convert to WebP + AVIF and promote to `public/assets/generated/<slot>-<YYYYMMDD>-<shorthash>.webp`/`.avif` per `SKILL.md`'s promotion + concurrency-check steps. Never overwrite a prior version — it remains as fallback.
- Write the mandatory sidecar JSON per `templates/sidecar.schema.json` alongside the promoted asset.
