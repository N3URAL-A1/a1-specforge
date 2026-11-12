# Step 9 — Remix: controlled variations of a picked direction

Goal: produce 3 new variants of an existing pick with a stated distance from
the original, optionally drawing on taste-vault entries as anchors. Optional
step (P3); it runs on request ("remix", "mach Varianten davon", "ähnlich, aber
anders") after step 3 or later. Chat with the user in German; every file is
written in English.

Input: a run folder whose `run.md ## Picks` holds a converge pick (or a
diverge pick). The remix reuses the same run folder; nothing is written
into the target repo.

## 1. Ask two things

1. **Amplitude** — how far from the original:

   | Amplitude | Distance |
   |-----------|----------|
   | `low` | same structure; change type scale, colour accents and spacing only |
   | `mid` | same family tokens; three new layouts and a new rhythm of sections |
   | `high` | same family feeling; new layouts, new imagery direction, a new hero idea |

2. **Anchors** (optional) — zero to five taste-vault entry ids whose look
   the variants may borrow from. List the available ids first:
   `node <skill-dir>/scripts/run/run.cjs families --vault-root "$A1_VAULT_ROOT" --context <brand|product>`
   shows `vault_entries` per family. No answer means no anchors.

## 2. Plan

```bash
node <skill-dir>/scripts/remix/remix.cjs plan --run-dir <run-dir> \
  --amplitude <low|mid|high> [--anchors <id>,<id>]
```

The plan is printed as one JSON object and written to `run.md ## Remix`
(a second plan replaces the first).

| Exit | Action |
|------|--------|
| 0 | Plan recorded. Go to 3. |
| 1 | No pick in `run.md` (pick first, step 2 or 3), an anchor id that is not in the vault (or exists in two families, or is damaged: run `taste.cjs lint`). Read the reason line, tell the user in German, fix, rerun. Nothing was written. |
| 2 | Usage or hostile input: amplitude not `low`, `mid` or `high`; anchor id not lowercase letters, digits and hyphens; duplicate id; more than five; `A1_VAULT_ROOT` unset while anchors are given; bad run dir. |
| 3 | Internal error. Report the reason line and stop. |

Family rule: with **no anchors** the planned `family` equals
`original_family`, and every variant stays inside it. With anchors the
planned `family` is the first anchor's family; say so to the user in one
line when it differs from the original.

## 3. Render 3 variants

Follow [03-converge.md](03-converge.md) sections 2–5 with these changes:

- The tiles' `data-family` is the plan's `family`.
- The 3 layouts respect the plan's `distance` sentence. Keep the original's
  tokens in `low` and `mid`; do not exceed the distance.
- Each anchor's `keywords` (printed in the plan and under `## Remix`) steer
  type, colour and rhythm vocabulary of the variants. Never copy an anchor's
  screenshot or source page; match the feeling. Boards never reference
  `pattern/taste-vault` (`board-check` refuses it).
- Run `board-check --kind converge` as usual. A remix counts as a new
  converge round: its pick goes through `run.cjs pick --board converge`; the
  one re-roll rule of step 3 applies to the remix round on its own.

## 4. Gate as usual

Continue with step 4 (assets), step 5 (gate) and step 6 (handoff) for the
picked remix variant. The gate does not know about remix: the result page
is gated exactly like any other.

## Done when

- `run.md ## Remix` holds one plan (amplitude, family, original family,
  anchors, distance, one line per anchor with its keywords).
- With zero anchors that plan's family equals the original's.
- `boards/converge.html` holds 3 tiles of the planned family and
  `board-check --kind converge` exits 0.
