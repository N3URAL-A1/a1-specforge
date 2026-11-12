# Step 1 — Brief and run folder

Goal: capture a four-part brief and create a fresh dated run folder in the
vault before any board exists. This step renders nothing.

Template: [../templates/brief.md](../templates/brief.md). Chat with the user
in German; every file is written in English.

## 1. Resolve the identifiers

- **Project slug:** the spec frontmatter `project:`, else the repo folder name.
- **Spec id:** the spec id when the studio runs from a1-new-feature Clarify;
  standalone runs pass `--topic <slug>` instead, and the script builds
  `adhoc-<YYYY-MM-DD>-<topic>`.
- **Screen slug:** ask the user for the screen if the spec does not name it.

All slugs must match `^[a-z0-9][a-z0-9-]{0,63}$`. Lowercase and hyphenate
before calling the script.

## 2. Ask the four parts, one at a time

Ask one question per turn, in this order. Wait for the answer before the
next question. Offer a short example from the template when the user hesitates.

1. **Aesthetic** — "Welche Stimmung soll der Screen haben?"
2. **Reference** — "Gibt es eine URL oder ein Bild, dessen Gefühl wir treffen
   sollen? (optional)". Say that the reference sets the mood only: match the
   feeling, do not copy. Never offer to rebuild a reference site; decline
   such a request and keep the reference as mood input.
3. **Intent** — the goal of the screen, then two choices:
   Context `brand` or `product`, Viewport `desktop-first` or `mobile parity`.
   Intent text is required.
4. **Guardrails** — what must always hold, what must never appear.

Translate the answers into English for the file. Keep the user's meaning;
do not add requirements they did not state. Read the brief back in German
in five lines and ask for a yes before writing.

## 3. Write the brief JSON

Write the JSON to a temporary file (outside the target repo), with exactly
these keys:

```json
{
  "aesthetic": "<text>",
  "reference": "<url, local image path, or empty string>",
  "intent": { "text": "<text>", "context": "brand|product", "viewport": "desktop-first|mobile parity" },
  "guardrails": { "always": ["<item>"], "never": ["<item>"] }
}
```

## 4. Create the run folder

From the spec:

```bash
node skills/a1-ux-studio/scripts/run/run.cjs init --project <slug> --spec <id> --screen <slug> --brief <json>
```

Standalone:

```bash
node skills/a1-ux-studio/scripts/run/run.cjs init --project <slug> --topic <slug> --screen <slug> --brief <json>
```

The script creates `$A1_VAULT_ROOT/project/<slug>/ux/<spec-id>/<YYYY-MM-DD>-<screen>[-<n>]/`
and writes `run.md` from [../templates/run.md](../templates/run.md). A re-run
for the same screen gets a `-<n>` suffix; older runs stay untouched.

## 5. Handle the result

| Result | Action |
|--------|--------|
| Exit 0 | Note the run folder path from the output as `<run-dir>`. Go to step 2. |
| Exit 0 with `reference unusable: <ref> (<cause>)` | Continue on the style family alone. Tell the user in German which reference failed and why. Do not ask for a new one unless the user offers it. |
| Exit 1 (empty Intent) | Ask the user for the Intent again, rewrite the JSON, rerun. Never render a board without a saved brief. |
| Exit 1 (`A1_VAULT_ROOT` unset or project folder missing) | Stop. Name the variable or the missing folder to the user. Write nothing anywhere, no repo fallback. |
| Exit 2 | A slug or enum is invalid. Fix the slug (pattern above) or the Context/Viewport value, rerun. Do not ask the user unless the screen or topic name itself is unclear. |

## Done when

- `<run-dir>/run.md` exists and its `## Brief` holds Aesthetic, Reference,
  Intent (with Context and Viewport) and Guardrails.
- No file exists under `<run-dir>/boards/`.
- Any reference warning has been told to the user.
