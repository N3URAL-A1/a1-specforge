# Step 6 — Handoff: the only way out

Goal: confirm with `handoff-check` that nothing blocks, then hand the chosen
direction to the caller as one decision line plus the run-folder link.

Input: `<run-dir>` after step 5. Chat with the user in German; every file is
written in English. `handoff-check` exit 0 is the only way out of the studio.

## 1. Run the check

```bash
node <skill-dir>/scripts/gate/ux-gate.cjs handoff-check --run-dir <run-dir>
```

| Exit | Action |
|------|--------|
| 0 | Handoff allowed. Go to 3. |
| 1 | Blocked. Go to 2. Write no decision line. |
| 2 | Usage error (bad `--run-dir`, no `run.md`). Read the `ux-gate:` line on stderr, fix the path, run again. |

The script reads the status only from `gate-record.json`, never from
`run.md`. Do not reason around it: a `pass` in chat or in `run.md` does not
replace exit 0.

## 2. Blocked: list each blocker and stop

The script prints one reason per line. Show every line to the user in
German, unshortened, then stop. Typical reasons and the way back:

| Blocker | Way back |
|---------|----------|
| Missing `gate-record.json` | Step 5, section 5 (run the gate). |
| Gate status `error` | Step 5: fix the cause, run the gate again. An `error` record is never accepted. |
| Record older than `result/result.html`, or hash mismatch | The result changed after the gate run: step 5, retake the `result-*` screenshots and run the gate again. |
| Open primary finding `<id>` | Fix it (step 5, section 6) or let Robert accept it. |
| Open font failure `font:<family>` | Fix the font (self-hosted, allowlisted) or let Robert accept it. |
| Missing `screenshots/<board>-1280.png` or `-390.png` (also when `playwright-cli` is missing) | Step 5, sections 1–4. |

To accept, Robert runs the command himself at his own terminal; `accept`
refuses to run inside Claude Code. Hand him the exact command, one per open
item, with his written reason inserted verbatim:

```bash
node <skill-dir>/scripts/gate/ux-gate.cjs accept --run-dir <run-dir> --finding <id> --reason "<text>"
```

Never write a reason for him, never run `accept`, never edit
`gate-record.json` or the gate-record block in `run.md` by hand.

Tell the user: **a new gate run resets all acceptances.** If anything is
fixed and the gate runs again, Robert accepts the remaining open items
again. After his commands, run section 1 again.

Advisories never block. If the only lines left are advisories, the script
already exits 0.

## 3. Allowed: write the handoff

Read the converge pick (or its `Default adopted:` line) from
`run.md ## Picks` and the brief from `run.md ## Brief`.

Output for the caller, in this exact shape:

```
UX/<screen-name>: Variant <X> chosen. Reason: <1-sentence>.
```

- `<screen-name>`: the screen slug from `run.md` frontmatter `screen`.
- `<X>`: the picked layout id with its family, for example
  `card-grid (product-led-minimalism)`.
- `<1-sentence>`: one sentence from the user's own words when picking; for a
  `Default adopted:` pick, say that the default was adopted.

Below the line, give the link to `<run-dir>/run.md` and a brief summary in
3 to 5 bullets: aesthetic, context (`brand` or `product`), viewport, gate
status, and every accepted item with Robert's reason.

| Caller | Who writes what |
|--------|-----------------|
| a1-new-feature Clarify Step 2b | The calling session writes the decision line and the link under the spec's `## Clarifications`. This skill does not edit the spec. |
| Standalone run | End in chat with the line, the link and the gate status. |

Write nothing into the target repo. Approved assets reach the repo only later,
through the wave plan.

## Done when

- `handoff-check --run-dir <run-dir>` exited 0 in this step.
- The caller has the decision line, the run-folder link and the brief summary.
