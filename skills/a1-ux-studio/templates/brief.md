# UX brief: <screen>

Four parts, all in English. Intent is required; the other three may be short.
The brief is the only input the boards are built from, so write what a
designer would need, not what the code will do.

## 1. Aesthetic

The mood in a few words or a short sentence. Name feelings and materials,
not components.

- Good: "calm, editorial, warm paper, generous whitespace"
- Weak: "modern and clean" (says nothing a board can show)

## 2. Reference

One URL or one local image path that carries the mood. Optional.

match the feeling, do not copy

A reference informs tone, rhythm and density. It is never a layout or
pixel source. If the reference is empty, missing, unreachable or larger
than 20 MB, the run continues on the style family alone and a warning
names the reference.

## 3. Intent

What the screen must achieve for its user, in one or two sentences.
Required: an empty Intent stops the run before any board is rendered.

- Text: "<who does what on this screen, and what counts as success>"
- Context: brand | product
  - brand: marketing, landing, storytelling; the look leads.
  - product: app screen, dashboard, form; the task leads.
- Viewport: desktop-first | mobile parity
  - desktop-first: designed at 1280 px, 390 px must stay usable.
  - mobile parity: 390 px is designed with the same care as 1280 px.

## 4. Guardrails

Hard limits the boards must respect. Short, testable items.

Always:
- <e.g. "brand color #0B5FFF as the only accent">
- <e.g. "body text at least 16 px">

Never:
- <e.g. "stock photos of people">
- <e.g. "dark mode as default">

## JSON handed to run.cjs init

```json
{
  "aesthetic": "",
  "reference": "",
  "intent": { "text": "", "context": "brand", "viewport": "desktop-first" },
  "guardrails": { "always": [], "never": [] }
}
```
