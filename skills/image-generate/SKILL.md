---
name: image-generate
description: >
  Design-time-only image generation capability for on-brand hero and editorial
  imagery (n3ural-platform, maison-muelhens, and future customer projects).
  Three data-driven profiles resolved via `model-registry.json` — draft
  (10-20 cheap 1K composition variants), hero (final 2K/4K, 16:9/21:9
  production asset), photoreal (hero model + photorealism prompt preset). No
  model ID is ever hardcoded in this skill — every model resolves through
  `model-registry.json`. MUST trigger when the user or an invoking agent
  (typically Uwe) says: "generate a hero image" (alias: "Hero-Bild
  generieren"), "generate an editorial image", "image.generate", "draft some
  hero compositions", "final hero asset for <project>", or any design-time
  request to produce on-brand photographic/editorial imagery for a specific
  project slot. Design-time only — invocable only by a design-time
  agent/tooling flow (e.g. Uwe) with Bash access; NEVER triggers from a
  frontend/runtime request path, and no persistent CLI or program code is
  created by this skill — the invoking agent writes the API-call code ad-hoc
  per run, following `reference/api-call.md`. Do NOT activate for video
  generation (out of scope), for runtime/user-facing generation of any kind,
  or for pure art-direction/composition guidance without an actual generation
  run (use `imagegen-frontend-web` for that).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# image-generate — On-Brand Hero & Editorial Imagery (design-time only)

Language: English-first; German trigger aliases supported.

This skill is **checklist-only, not tested code**. There is no persistent
program code for this capability — no CLI, no server, no database. The
invoking agent (typically Uwe) writes the actual API-call code ad-hoc, once
per run, following `reference/api-call.md`. Because that code is never
tested, this SKILL.md is the enforcement mechanism: every step below is
**non-optional**. Skipping a step is a defect in the run, not a shortcut.

**No model ID literal appears anywhere in this file.** Every model reference
below is written as a `registry.*` lookup instruction. If you find yourself
about to write out any provider model string directly into a prompt, a
commit message, or a log — stop and look it up in `model-registry.json`
instead. This is FR-002; it is verified by grepping this file for the
provider's model-name prefix and finding only lookup notation, never a
literal.

## Files in this skill

| File | Owner | Purpose |
|---|---|---|
| `model-registry.json` | Aik | Single source of truth for model IDs, providers, capabilities, retirement dates, profile → model mapping |
| `templates/sidecar.schema.json` | Aik | JSON Schema for the mandatory provenance sidecar |
| `templates/sidecar.example.json` | Aik | Filled example sidecar (slot `mm-hero`) |
| `reference/api-call.md` | Aik | Exact Requesty request/response recipe, auth, `image_config` verification procedure, Vertex-direct fallback |
| `presets/draft.md`, `presets/hero.md`, `presets/photoreal.md` | Uwe | Composition guidance + prompt-construction steps per profile |
| `assets/placeholder.svg` | Uwe | Branded placeholder for a slot with no pre-existing fallback (FR-016) |
| `README.md` | Aik | Env-var docs, derivative toolchain, draft/final cost-control rationale |

## The run procedure (12 steps, in order, none optional)

### Step 1 — Pre-run confirmation (draft vs. final) — MANDATORY, blocks everything below

Before any API call, ask the user (Robert) explicitly:

> "Is this a **draft** run (small model, 1K, for alignment) or a **final** run (large model, up to 4K, for the web presence)?"

- No API call may be made before this question is asked and explicitly
  answered. There is no silent default — even though `draft` is the
  documented default profile (Step 3), that default does not exempt a run
  from this confirmation (FR-012).
- If the user does not answer, or declines: the run does not proceed. This is
  not a failure to report — it is simply "no run happened."
- Record the answer; it determines which profile Step 3 resolves to. A
  **final** answer branches once more in Step 3: standard `hero`, or
  `photoreal` if the user asked for photorealistic output — both count as
  "final" for this confirmation.

### Step 2 — Load the registry + retirement check

Load `model-registry.json`. For every entry, compare `retirement_date`
against the current date:

- `retirement_date` is `null` → no warning.
- `retirement_date` is within 30 days (before or after today) → warn the user
  by name of the model id and the date, before proceeding.
- `retirement_date` is in the past → warn loudly; if the profile about to be
  used resolves to that entry, stop and ask the user how to proceed rather
  than silently generating with a retired model.

This is an instruction-level check only — no automated tooling, per the
spec's accepted trade-off for this skill-only architecture.

### Step 3 — Resolve the profile via the registry — no literals

Resolve the confirmed choice from Step 1 to one of exactly three profiles,
strictly via lookup:

- `registry.profiles.draft` — model `registry.profiles.draft.model_id`, default resolution `registry.profiles.draft.default_resolution` (1K). This is `is_default_profile: true` — used whenever a run does not explicitly request `hero` or `photoreal` (FR-006).
- `registry.profiles.hero` — model `registry.profiles.hero.model_id`, resolution 2K or 4K, aspect ratio 16:9 or 21:9 (`registry.profiles.hero.supported_resolutions` / `.supported_aspect_ratios`).
- `registry.profiles.photoreal` — same `model_id` as `hero`, plus `presets/photoreal.md` applied on top (`registry.profiles.photoreal.preset_ref`).

Never write a model ID literal here or in any downstream artifact except as
the *resolved value* recorded in a sidecar's `model_id` field (that is
provenance data, not an instruction — see `templates/sidecar.schema.json`).

### Step 4 — Construct the prompt (confidentiality rule + composition guidance)

Follow the composition and prompt-construction guidance in the matching
preset file (`presets/draft.md`, `presets/hero.md`, or `presets/photoreal.md`,
owned by Uwe). During draft exploration, also consult the `imagegen-frontend-web`
skill as the composition/prompt-direction guide (non-overlapping art-direction
skill — it does not itself generate images).

**Confidentiality rule (FR-015, hard rule, no exceptions):** A prompt MUST
NEVER contain confidential client material — e.g. confidential pitch-deck
contents, unreleased campaign names, internal strategy wording not meant for
a third-party API. Before constructing or submitting any prompt:

1. Check the prompt draft against this rule explicitly, as a distinct step —
   not as an assumption that "I wouldn't do that."
2. If the source brief for this run originates from a confidential document
   (e.g. a pitch deck), extract only the generic visual/brand description
   needed for the image — never quote or paraphrase confidential business
   content, figures, or strategy language into the prompt.
3. If in doubt whether something is confidential: treat it as confidential
   and ask the user before including it, or omit it.

No prompt that fails this check may be submitted to Requesty or Vertex AI —
this blocks Step 5 entirely for that prompt.

### Step 5 — API call

Follow `reference/api-call.md` exactly: resolve the request shape from the
Step 3 registry lookup, call Requesty (primary path) with the resolved model
and the requested `image_config`, using the API key from
`REQUESTY_IMAGEGEN_API_KEY` (see README.md — never log or commit this key).

### Step 6 — Verify `image_config` was honored — MANDATORY, silent mismatch = failure

Per `reference/api-call.md` section 2.4: decode the returned image, read its
actual pixel dimensions, and compare against the requested aspect ratio and
resolution tier. Record the result as `image_config.honored: true|false`
(this becomes part of the sidecar in Step 10).

- `honored: true` → proceed to Step 7.
- `honored: false` or the check could not be performed → **treat the run as
  failed** (FR-014). Do not promote anything. Do not write a sidecar for a
  failed run. Report the requested vs. actual values to the user. Do not
  silently accept whatever came back.

### Step 7 — Draft variants go to `.imagegen/drafts/` (never deployed)

If this is a `draft`-profile run: write all 10-20 variants to
`.imagegen/drafts/` in the target project (gitignored — see README.md /
target project's `.gitignore`). Draft images are never promoted directly to
`public/assets/generated/`; a selected composition is regenerated at final
quality via the `hero` or `photoreal` profile (see `presets/draft.md`).

If this is a `hero` or `photoreal` run, skip to Step 8.

### Step 8 — Concurrency check before promotion

Before promoting a final asset for a slot, check whether a sidecar newer than
this run's start time already exists for the same `project_slot_ref.slot_id`
under `assets-meta/generated/`. If one does: **abort the promotion** with a
clear message naming the conflicting sidecar — do not overwrite, do not
silently proceed. There is no lockfile mechanism; this check is the entire
concurrency guarantee.

### Step 9 — Promote the final asset (WebP + AVIF)

Convert the raw generated image to WebP and AVIF derivatives (see README.md
for the recommended toolchain) and write them to
`public/assets/generated/<slot>-<YYYYMMDD>-<shorthash>.webp` /
`.avif` in the target project.

- Never overwrite a prior version for the same slot — the previous asset
  remains in place as the fallback (FR-010). Promotion is additive; the
  component/slot logic (owned by the target project's web agent) decides
  which promoted asset is current.
- This step only runs for `hero`/`photoreal` profiles that passed Step 6 with
  `honored: true`. Draft-profile runs never reach this step (see Step 7).

### Step 10 — Write the mandatory sidecar (provenance — FR-011)

Write a sidecar JSON to `assets-meta/generated/<same-basename-as-asset>.json`
(outside `public/`, since `public/` is served publicly by Vercel and prompts
may contain internal wording that must not be publicly reachable). Use
`templates/sidecar.schema.json` as the schema and
`templates/sidecar.example.json` as a filled reference. Required fields:
`prompt` (full text), `model_id` (resolved value, not a literal instruction),
`image_config` (including the `honored` result from Step 6), `generated_at`,
`project_slot_ref`, `profile`, `provider_path`, `skill_version`.

A successful run without a sidecar is not complete — do not report a run as
done until this file exists.

### Step 11 — Obsidian slot-note reference (P2)

Add a reference to the generated asset in the Obsidian note of the
corresponding image slot (e.g. the target project's project-hub note). This
step is P2 (deferred polish, not required for the P1 milestone) — perform it
when the target project's vault note convention is established; do not block
a P1 run on it.

### Step 12 — Fallback guarantee (always true, not a step to "do" so much as a property to verify)

No slot may ever render empty because of this skill:

- If Step 6 fails (image_config not honored): the slot keeps rendering
  whatever it was rendering before this run (FR-010).
- If Requesty and Vertex are both unavailable (see `reference/api-call.md`
  section 4): the run fails gracefully with a clear error, and the slot's
  existing asset (or, for a brand-new slot with no prior asset at all, the
  fallback state built into the target component) continues to render
  (FR-013).
- If a slot has no pre-existing fallback asset at all and generation fails:
  the branded placeholder (`assets/placeholder.svg`, owned by Uwe) is copied
  into the target project and used as the render source instead of leaving
  the slot empty or failing the build (FR-016).

Confirm this property held for the run before reporting it done — this is
not optional even though "nothing to write" is the expected outcome on a
graceful failure.

## Related skills

- `imagegen-frontend-web` — composition/prompt-direction guide for draft
  exploration (Step 4). Non-overlapping: it does not generate images itself.
- `imagegen-frontend-mobile` — same relationship, mobile-specific composition
  guidance.

## Hard rules

- Never write a model ID literal in this file or in any preset/reference file
  — always a `registry.*` lookup.
- Never skip Step 1 (pre-run confirmation) — no silent default, even for the
  draft profile.
- Never skip Step 6 (`image_config` verification) — a response that "looks
  right" without dimension inspection is not verified.
- Never submit a prompt that contains confidential client material (Step 4).
- Never overwrite a previously promoted asset for a slot (Step 9) — additive
  only, prior versions remain as fallback.
- Never promote or write a sidecar for a run that failed Step 6.
- Never log, print, or commit the value of `REQUESTY_IMAGEGEN_API_KEY`.
