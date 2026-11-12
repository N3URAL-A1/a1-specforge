# Step 8 — Tweaks panel and token export

Goal: let the user fine-tune font, size, accent colour and motion weight on a
dev copy of the result page, then write the chosen values into the spec as one
design-token block. Optional step (P3); it runs after step 4 (result page
exists) and before step 6 (handoff). Chat with the user in German; every file
is written in English.

The panel exists only in `result/result.dev.html`. `result/result.html` is the
page that gets gated and handed off; it never holds panel markup or script.

## 1. Build the dev copy

```bash
node <skill-dir>/scripts/tweaks/tweaks.cjs build --run-dir <run-dir>
```

| Exit | Action |
|------|--------|
| 0 | Prints `result/result.dev.html`. Go to 2. |
| 1 | `result/result.html` is missing, or it already contains `data-a1-tweaks`. Build the result first (step 4) or remove the panel from it; never ship a result with the panel. |
| 2 | Bad `--run-dir`. Fix the path, rerun. |
| 3 | Internal error. Report the reason line and stop. |

## 2. The user tweaks

Open the dev copy for the user (`playwright-cli`, as in
[05-gate.md](05-gate.md) section 1; a `file://` URL needs
`PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true` and `--browser=chromium`).
The panel has a font list, a size slider, an accent colour, a motion weight
slider, **Reset** and **Compare to original** (hold the original look while
active). The panel shows the current values as one JSON line. Ask the user in
German for that line, or read it from the page.

Fonts offered in the panel are the families of
`scripts/gate/font-allowlist.json` (the build step writes the list into the
dev copy). `export-tokens` refuses any other font with exit 1.

## 3. Export the tokens

Only on a yes from the user. The decision line `UX/<screen>:` must already be
in the spec (step 6 writes it; run this step after that, or write the line
first).

```bash
node <skill-dir>/scripts/tweaks/tweaks.cjs export-tokens \
  --spec <spec-file> --screen <screen-slug> \
  --values '{"font":"Inter","size":18,"accent":"#aa3355","motion":0.5}'
```

The script writes one `a1-ux-tokens` block after the decision entry Clarify
wrote (`- **YYYY-MM-DD** — UX/<screen>: ...` and its indented continuation
lines such as `  Run: ...`), never inside it. A second export for the same
screen replaces that block. It never touches the frontmatter.

| Exit | Action |
|------|--------|
| 0 | Block written. Tell the user in German. |
| 1 | The spec has no `UX/<screen>:` decision entry (outside the frontmatter), a damaged token block, or the font is not on the allowlist. Nothing was written; fix the spec or the value, rerun. |
| 2 | Hostile or malformed input: unknown key, accent not `#rrggbb`, font with other characters than letters, digits and spaces, size outside 8–96, motion outside 0–2, bad screen slug. Fix the value, rerun. |
| 3 | Internal error. Report the reason line and stop. |

If the user changes the tokens after the result page was gated, the page
itself must be updated and gated again (step 5): the export writes values
into the spec only, not into `result.html`.

## Done when

- `result/result.html` contains no `data-a1-tweaks` (`grep -c` prints 0) and
  was not modified by this step.
- After an export, the spec holds exactly one token block for the screen,
  right after its `UX/<screen>:` decision entry (after the entry's indented lines).
