# Preset: photoreal

Profile: `photoreal` (registry lookup: `registry.profiles.photoreal`). Same model and `image_config` surface as `hero` (2K/4K, 16:9/21:9) — this preset does not change the model or resolution logic, only the prompt.

Status: P2 (deferred polish per spec Out of Scope / Priority). The preset is documented and usable now; further refinement is expected once real photoreal runs produce feedback.

Purpose: apply everything in `presets/hero.md` first, then layer photorealism-specific prompt language on top. Do not treat this as a separate composition process — read `presets/hero.md` before using this preset; this file only adds the delta.

## What changes vs. hero

Everything in `presets/hero.md` still applies: single committed composition, target-project palette/tokens, negative-space discipline for text overlay, no baked-in text/logos, confidentiality rule, `image_config` verification, promotion/sidecar steps.

On top of that, add a photorealism layer to the prompt:

- Explicitly request photographic realism: real camera optics behavior (natural depth of field, realistic lens compression for the stated focal length, believable film/sensor grain at a subtle level — not stylized noise), physically plausible lighting falloff and shadow softness for the stated light source.
- Name a concrete lighting setup rather than a mood word alone (e.g. "single soft key light from camera-left, 45°, low fill" instead of just "dramatic lighting").
- Name real materials with their expected physical behavior (glass refraction and specular highlights on a bottle, brushed metal anisotropic reflections, matte paper diffuse response) rather than generic "luxury materials."
- Avoid illustrative/painterly/3D-render language entirely — no "digital art," "concept art," "render," or "illustration" framing anywhere in the prompt; every descriptor should read as a photography brief a human photographer could execute.
- If a product is present, treat it as if photographed for a real editorial/campaign shoot: plausible studio or location setup, no impossible framing, no physically inconsistent reflections or shadows.

## When to prefer photoreal over hero

Use `photoreal` when the target slot's brand direction calls for documentary/editorial photographic credibility (e.g. a product held to campaign-photography standards) rather than a more stylized or graphic-illustrative treatment. If the brief is silent, default to `hero` — `photoreal` is an explicit choice, not a fallback.

## Output handling

Identical to `presets/hero.md`: resolve the model via `registry.profiles.photoreal.model_id`, run the `image_config` verification step, promote via the same `<slot>-<YYYYMMDD>-<shorthash>.webp`/`.avif` convention, write the mandatory sidecar JSON. The sidecar's `profile` field MUST record `"photoreal"` (not `"hero"`) so provenance correctly distinguishes which prompt layer produced the asset.
