# image-generate

Design-time-only Claude Code skill for generating on-brand hero and editorial
imagery. See `SKILL.md` for the full run procedure; this file covers
environment setup, the derivative toolchain, and why the cost-control model
is a confirmation dialog rather than a numeric cap.

## Environment variables

### `REQUESTY_IMAGEGEN_API_KEY` (primary path)

- The Requesty API key used for all image-generation calls made by this
  skill. **Dedicated to image generation** — do not reuse another AI-spend
  key for this variable, and do not point this skill at a shared/general key.
  Cost separation is the reason this key is dedicated: image-generation spend
  must be attributable on its own, not blended into other Requesty usage.
- Provided by Robert; set only in the shell environment (or your local
  secrets manager) — **never** committed to any repo, never written into a
  `.env` file that gets committed, never logged, never echoed in an error
  message.
- If unset when a run starts: the primary path cannot be attempted. The skill
  reports this by name (which env var is missing) and — if Vertex fallback is
  configured — falls through to that path; if neither is available, the run
  fails gracefully per `SKILL.md` Step 12 / FR-013.

### Vertex AI fallback (no dedicated env var — uses ADC)

- Region is fixed: `europe-west3`.
- Auth is Application Default Credentials (ADC), not a key file:
  ```bash
  gcloud auth application-default login   # one-time setup
  gcloud auth application-default print-access-token   # per-call token fetch
  ```
- Used only when the Requesty primary path is unavailable or errors (FR-008).
  In the P1 milestone this path is demonstrated as a graceful-failure case
  (both paths disabled); active Vertex fallback usage is P2 polish.

## Derivative toolchain (WebP + AVIF)

The spec leaves the concrete tool open (implementation decision, not a
spec-level commitment). **Recommended: `sharp` via `npx`.**

```bash
npx --yes sharp-cli --input <raw-image> --output <slot>-<date>-<hash>.webp --format webp
npx --yes sharp-cli --input <raw-image> --output <slot>-<date>-<hash>.avif --format avif
```

(Or an equivalent ad-hoc Node one-liner using the `sharp` package directly,
since target projects like maison-muelhens are already Next.js/Node
projects — no new system dependency is required.)

**Alternative, if `sharp`/Node tooling is unavailable in the execution
environment:** `cwebp` and `avifenc` as standalone system binaries:

```bash
cwebp -q 80 <raw-image> -o <slot>-<date>-<hash>.webp
avifenc <raw-image> <slot>-<date>-<hash>.avif
```

Either toolchain must produce both formats for every promoted asset — WebP
and AVIF are both required (FR-009), not "one or the other."

## Draft vs. final: why a confirmation dialog instead of a numeric budget cap

The spec's discovery phase originally considered a numeric per-run budget
cap. It was replaced with a mandatory pre-run confirmation dialog (FR-012,
`SKILL.md` Step 1) because Robert prefers an explicit, conscious decision
before every run over an automated euro-amount threshold:

- **Draft** (small model, 1K, cheap) is for alignment — exploring composition
  directions before anything is committed to. It is also the documented
  default profile when no profile is explicitly requested (FR-006), but that
  default status does not exempt a run from the confirmation — the agent
  still asks, every time.
- **Final** (large model, up to 4K) is for production assets that ship on the
  web presence. It costs more per image and should never be triggered as a
  side effect of an ambiguous or unconfirmed request.

The confirmation dialog is the entire cost-control mechanism for this skill.
There is no automated spend cap, no rate limiter, no budget tracker — the
discipline lives entirely in `SKILL.md` Step 1 being non-optional. This is a
deliberate trade-off of the skill-only architecture (no persistent, tested
code exists to enforce a numeric cap reliably) — see `SKILL.md`'s framing of
checklist steps as non-optional rather than left to agent judgment.

## Related

- `SKILL.md` — full 12-step run procedure.
- `model-registry.json` — model/profile resolution (Aik).
- `reference/api-call.md` — exact Requesty/Vertex call recipe (Aik).
- `presets/` — composition and prompt-construction guidance per profile (Uwe).
