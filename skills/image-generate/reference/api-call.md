# API Call Recipe — image-generate

Ad-hoc call recipe the invoking agent follows per run. There is no persistent
program code for this skill (see architecture decision in the wave plan) —
this document is the exact recipe an agent writes as throwaway code for a
single run, every time, from scratch.

**No model ID literal appears in this document outside of illustrative
`registry.*` lookup notation.** Every model string used in an actual call
MUST be read from `model-registry.json` at run time — never copied from this
file. Where this document needs to *show* a concrete value for illustration
(e.g. in the "what the resolved value looks like" notes), it is explicitly
labeled as such, never presented as something to paste into a call.

---

## 1. Resolve the model from the registry (never hardcode)

Before any API call, load `model-registry.json` and resolve the model id via
the profile the run's pre-run confirmation selected:

- `registry.profiles.draft.model_id`
- `registry.profiles.hero.model_id`
- `registry.profiles.photoreal.model_id` (same value as `hero`, per FR-005 — the
  distinction is the prompt preset applied on top, not the model)

From the resolved entry (`registry.entries[]` matching that `model_id`), read:

- `entry.requesty_model` — the exact string to send to Requesty (primary path)
- `entry.vertex_model` — the exact string to send to Vertex AI (fallback path only)
- `entry.capabilities.aspect_ratios` / `entry.capabilities.resolution_tiers` —
  validate the requested `image_config` against these *before* calling out;
  reject locally with a clear message if the request asks for an unsupported
  combination (e.g. hero profile at 1K, or draft profile at 21:9).

Also check `entry.retirement_date` against the current date at load time; warn
if within 30 days of retirement or already past it (instruction-level check,
no automated tooling — see SKILL.md).

---

## 2. Primary path — Requesty

### 2.1 Auth

- Read the API key **only** from the environment variable `REQUESTY_IMAGEGEN_API_KEY`.
- This key is dedicated to image generation — never reuse another AI-spend key, never fall back to a different env var if this one is unset.
- **Never** log, echo, print, or write this key's value anywhere (not to stdout, not to a sidecar, not to a commit, not to an error message). If the key is missing, fail with a message that names the missing env var, not its (absent) value.
- **Never** commit the key in any file, including scratch scripts. Ad-hoc call scripts read `process.env.REQUESTY_IMAGEGEN_API_KEY` (or shell `$REQUESTY_IMAGEGEN_API_KEY`) at run time and are not committed themselves.

### 2.2 Request shape

Requesty exposes an OpenAI-compatible `chat/completions` endpoint. Image
generation parameters are passed via `extra_body.image_config`, per
[Requesty's image-generation docs](https://docs.requesty.ai/features/image-generation).

Illustrative shape (fill `model` from `entry.requesty_model`, never a literal):

```jsonc
POST https://router.requesty.ai/v1/chat/completions
Authorization: Bearer $REQUESTY_IMAGEGEN_API_KEY
Content-Type: application/json

{
  "model": "<entry.requesty_model — resolved from registry, do not hardcode>",
  "messages": [
    { "role": "user", "content": "<the constructed prompt — see presets/>" }
  ],
  "extra_body": {
    "image_config": {
      "aspect_ratio": "<requested aspect ratio, e.g. from entry.capabilities.aspect_ratios>",
      "image_size": "<requested resolution tier, e.g. from entry.capabilities.resolution_tiers>"
    }
  }
}
```

> **Field-verified pitfall (2026-07-25, first production draft run):** the
> draft model IGNORES `image_config.aspect_ratio` when the prompt text itself
> contains no framing language — 16/17 images came back 16:9 despite a correct
> `"aspect_ratio": "21:9"`. Reproducible. Fix: state the ratio textually at the
> START of every prompt (e.g. "Ultrawide 21:9 cinematic panoramic
> photograph.") IN ADDITION to `image_config`. With that prefix, 17/17 were
> honored. `image_config` alone is NOT sufficient — always pair both, and let
> the Step-6 dimension check catch any drift.

### 2.3 Response shape and payload extraction

Requesty returns an OpenAI-compatible chat completion. The generated image is
returned as part of the response message content — treat the response as
untrusted external data and validate its shape before use (do not assume keys
exist):

- Expect `response.choices[0].message` to contain either:
  - an `images` array with base64-encoded or URL-referenced image data, or
  - inline content parts of type `image_url` / `image_base64` (exact key names
    depend on the Requesty response version in use at call time — inspect the
    actual response object first with a throwaway `console.log` /
    `JSON.stringify` before assuming a shape, since this is unverified,
    ad-hoc code per run).
- If the expected image payload is missing, empty, or malformed: **treat this
  as a generation failure**, not a partial success. Do not promote a
  half-decoded or placeholder-shaped result. Fall through to the fallback/error
  handling in section 4.
- Also capture whatever response metadata Requesty provides about the applied
  `image_config` (e.g. a metadata block echoing the resolved size/aspect) for
  step 3 — some providers echo the applied config, others require inspecting
  the decoded image itself.

### 2.4 Verify image_config was honored (mandatory — FR-014)

Never silently accept whatever comes back. After decoding the returned image
bytes:

1. Decode the image and read its actual pixel dimensions (e.g. via `sharp`'s
   `.metadata()` — the same toolchain used for the WebP/AVIF derivative step,
   see the target project's skill instructions from Wave 2).
2. Compute the actual aspect ratio from `width/height` and compare it against
   the requested `aspect_ratio` (allow only the tolerance introduced by
   integer pixel rounding — e.g. 21:9 at 2×K widths, not an arbitrary
   near-match).
3. Compare the longer edge (or total pixel budget, depending on how the
   resolution tier maps to pixels for the resolved model) against what the
   requested `image_size` tier implies.
4. Record the outcome as `image_config.honored: true|false` in the sidecar
   (see `templates/sidecar.schema.json`).
5. If dimensions/ratio do **not** match what was requested: treat the run as
   **failed**, do not promote the asset to `public/assets/generated/`, and
   surface a clear, specific error naming the requested vs. actual values
   (e.g. "requested 21:9 @2K, Requesty returned an image measuring 1920x1080
   (16:9) — image_config was not honored"). Do not retry silently with a
   different config and present it as if it were what was asked for.

This check is what SC-002 verifies during the Wave 3 E2E run.

---

## 3. Fallback path — direct Vertex AI

Used only when the Requesty primary path is unavailable or errors (FR-008,
polished in Wave 5; graceful-failure-only demonstration in Wave 4).

- Region: `europe-west3` (fixed, not configurable per run).
- Auth: Application Default Credentials (ADC). Obtain a short-lived access
  token via:
  ```bash
  gcloud auth application-default print-access-token
  ```
  Do not use a service-account JSON key file unless ADC is unavailable in the
  execution environment; prefer ADC per the spec's stated auth method.
- Model: read `entry.vertex_model` from the same resolved registry entry used
  for the Requesty attempt — the model identity does not change between
  paths, only the invocation route.
- Request shape: matches the Vertex AI `generateContent`-style REST call for
  the resolved model, with the equivalent `image_config`-style generation
  parameters (aspect ratio, resolution tier) mapped to Vertex's parameter
  names for that endpoint — verify the exact parameter names against current
  Vertex AI documentation at call time, since this is unverified ad-hoc code
  per run, not a maintained SDK integration.
- The same `image_config` verification step (section 2.4) applies to the
  Vertex response — the honored-check is provider-agnostic and must run
  regardless of which path served the generation.

---

## 4. Error handling

At every stage, fail with a clear, actionable message — never a silent
no-op and never a generic "something went wrong":

| Failure | Message MUST state |
|---|---|
| `REQUESTY_IMAGEGEN_API_KEY` unset | which env var is missing and that the primary path cannot be attempted |
| Requesty HTTP error / timeout | the HTTP status/error, and that the system is falling back to Vertex (or, if Vertex is also unavailable/disabled, that both paths failed — see FR-013) |
| Requesty response missing/malformed image payload | that the payload was malformed, not just "failed" |
| `image_config` not honored | requested vs. actual values (section 2.4) |
| Vertex ADC token fetch fails | that ADC is unavailable/expired and how it was invoked |
| Vertex request error | the HTTP status/error from Vertex |
| Both Requesty and Vertex unavailable/disabled | explicit statement that both paths failed, that the affected slot continues to render its existing fallback asset, and that no asset was promoted (FR-013, verified in Wave 4 as SC-003) |

In every failure case: do not promote anything to
`public/assets/generated/`, do not write a sidecar for a failed run, and do
not touch the existing fallback asset for the slot.

---

## 5. Related

- Model/profile resolution: `../model-registry.json`
- Sidecar to write on success: `../templates/sidecar.schema.json`, `../templates/sidecar.example.json`
- Prompt construction per profile: `../presets/draft.md`, `../presets/hero.md`, `../presets/photoreal.md` (owned by Uwe)
- Confidential-material prompt rule: enforced at prompt-construction time, see SKILL.md (owned by Uwe) — this document assumes the prompt has already passed that check before step 2.2
