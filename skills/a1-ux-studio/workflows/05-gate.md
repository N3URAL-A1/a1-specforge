# Step 5 — Gate: screenshots and the Impeccable gate

Goal: take a screenshot of every board and the result at 1280 px and 390 px
into `<run-dir>/screenshots/`, list the paths in `run.md ## Screenshots`, then
run the gate on `result/result.html` and show the findings to the user.

Input: `<run-dir>` from step 4 with `result/result.html`. Chat with the user
in German; every file is written in English. This step decides nothing on
its own: the gate script and Robert decide.

## 1. Check playwright-cli (web-testing rule)

```bash
npm view @playwright/cli version
playwright-cli --version
```

`playwright-cli --version` can print an update banner first; the version is
its last line. Compare the two version strings.

| Result | Action |
|--------|--------|
| Same version | Go to 2. |
| Installed version is older | Tell the user in German, name both versions, offer the update (below). Yes: run it, check again, go to 2. No: take no screenshots; say that handoff stays blocked (step 6 needs every screenshot). |
| `playwright-cli` not found | Tell the user in German that the boards are unverified and handoff stays blocked. Offer the install (below). No: stop here. |
| `npm view` fails (offline, registry unreachable) | Report it. Ask the user whether to continue with the installed version; record the answer as a line under `run.md ## Screenshots` (`version check: registry unreachable, continued with <version>`). |

Update or install (only after the user says yes):

```bash
npm i -g @playwright/cli@latest
playwright-cli install-browser chromium
```

The studio always opens the bundled Chromium (`--browser=chromium`), so
Google Chrome is not needed. Do not add `--with-deps`: it needs sudo. If
`open` later fails with `... is not found`, run
`playwright-cli install-browser chromium` once, then retry. Never use another
screenshot tool to work around a missing `playwright-cli`.

## 2. Offer the one-time Impeccable skill install

Read `<skill-dir>/scripts/gate/impeccable.json`.

- `install_scope` is `null`: skip this section.
- Otherwise offer once, in German, the exact `install_command` from the file
  (user scope, Claude provider only). Run it only after the user says yes,
  with `$HOME` as the working directory, never inside the target repo.
- The gate does not need this install; detection runs through `npx` with a
  pinned version. Never run `/impeccable init` and never a project-scope
  install (hard rule 2).

## 3. Screenshot each board and the result

Targets: every file that exists among `boards/diverge.html`,
`boards/converge.html` and `result/result.html`. Each target gets two files:

| Target | 1280 px | 390 px |
|--------|---------|--------|
| `boards/diverge.html` | `screenshots/diverge-1280.png` | `screenshots/diverge-390.png` |
| `boards/converge.html` | `screenshots/converge-1280.png` | `screenshots/converge-390.png` |
| `result/result.html` | `screenshots/result-1280.png` | `screenshots/result-390.png` |

Work in `<run-dir>` (`--filename` is relative to it; helper folders stay
out of the target repo). Open each target as an absolute `file://` URL, no
server. playwright-cli blocks `file:` unless
`PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true` is set on every call
(`open`, `resize`, `screenshot`); without it the screenshot is blank. Run each
block as one shell call so the `export` covers every line. Per target:

```bash
cd <run-dir>
export PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true
mkdir -p screenshots
playwright-cli -s=ux-studio open --browser=chromium "file://<run-dir>/boards/diverge.html"
playwright-cli -s=ux-studio resize 1280 800
playwright-cli -s=ux-studio screenshot --full-page --filename screenshots/diverge-1280.png
playwright-cli -s=ux-studio resize 390 844
playwright-cli -s=ux-studio screenshot --full-page --filename screenshots/diverge-390.png
playwright-cli -s=ux-studio close
```

Repeat for `converge` and `result` (open `file://<run-dir>/result/result.html`).
Then list the folder:

```bash
ls -l <run-dir>/screenshots/
```

Every expected file must exist and be a PNG exactly as wide as its name says
(1280 or 390 px, or twice that at deviceScaleFactor 2); take a missing,
empty or wrongly sized file again. Look at each 390 px image: a board must be readable
at 390 px; the result follows the brief's `Viewport` (`desktop-first` or
`mobile parity`), and you tell the user in German which one applies.

## 4. List the paths in run.md

Write one line per file under `## Screenshots` in `<run-dir>/run.md`, with
paths relative to the run folder. Replace earlier screenshot lines; never add
a second `## Screenshots` heading and never touch the text between the
gate-record markers (only `ux-gate.cjs` writes there).

```
- screenshots/diverge-1280.png
- screenshots/diverge-390.png
- screenshots/converge-1280.png
- screenshots/converge-390.png
- screenshots/result-1280.png
- screenshots/result-390.png
```

## 5. Run the gate

```bash
node <skill-dir>/scripts/gate/ux-gate.cjs run --run-dir <run-dir> --target <run-dir>/result/result.html
```

| Exit | Meaning | Action |
|------|---------|--------|
| 0 | `pass` | Show advisories (if any) as information. Go to step 6. |
| 1 | Blocking findings (primary findings or font failures) | Go to 6. |
| 2 | Usage or hostile input (bad path, waiver marker in the target, no `run.md`) | Read the `ux-gate:` line on stderr, fix the input, run again. No record is written; an older `gate-record.json` may remain and does not count for this result. |
| 3 | Gate error (detector exit 1, `npx` missing, download blocked, target changed during the scan) | Report the cause in German. It is never a pass. Fix the cause and run again; while the record says `error`, step 6 stays blocked. |

## 6. Show the findings

Read `<run-dir>/gate-record.json` (never the `run.md` block). List in German:

- each finding with `severity: primary` and `state: open`: `id`, `rule`, `location`;
- each font failure with `state: open`: `font` and `reason` (`remote_url`, `not_allowlisted`, `local_src`, `data_src` or `font_file_mismatch`);
- advisories as information only. They never block.

For each blocking item the user picks one of two paths:

1. **Fix.** Change `result/result.html` (for fonts: a self-hosted,
   allowlisted family, no remote URL), take the two `result-*` screenshots
   again (section 3) and run section 5 again. A changed result needs a new
   gate run: step 6 blocks a record that is older than the result or whose
   hash no longer matches it.
2. **Accept.** Only Robert accepts, and only with his own written reason.
   `accept` works only at a real terminal outside Claude Code, so never run
   it yourself. Ask for the reason in German, then hand Robert this exact
   command with his reason inserted verbatim:

   ```bash
   node <skill-dir>/scripts/gate/ux-gate.cjs accept --run-dir <run-dir> --finding <id> --reason "<text>"
   ```

   Font failures use the id `font:<family>`, for example `--finding "font:Inter"`.
   An empty reason exits 2 and accepts nothing.

Say this before every new gate run: **a new gate run resets all earlier
acceptances**; Robert must accept again whatever is still open afterwards.

## 7. What protects the record (and what does not)

`gate-record.json` is not trusted on its own. Two facts live outside the run
folder, in a per-user store `<passwd home>/.a1-ux-studio/gate-store.jsonl`
(directory mode 0700; a symlink, a foreign owner or a group- or
world-writable directory or file is refused; append-only by convention, not
enforced by the file system: the code only appends, but the same OS user can
rewrite the file; each line carries the sha256 of the line before it):

- `ux-gate.cjs run` writes a digest of its result (target sha256, status,
  findings, font failures). `handoff-check` recomputes the digest of the
  record and compares it with the latest `run` line of the run folder. A
  hand-written `pass`, a removed finding or a demoted severity is blocked
  with "does not match the recorded gate run".
- `ux-gate.cjs accept` (real terminal only) writes one line per acceptance
  (run folder, target sha256, finding id, reason). Every `accepted` item of
  the record needs a stored line of the latest run with the same reason; a
  new `run` makes older lines void. A broken chain, a file cut inside a line, an
  oversized file (more than 8 MiB) or a store directory that fails the
  checks above blocks the handoff, and a `run` or `accept` then exits 3
  without writing a record. The store module also refuses `recordAccept`
  for any caller that is not a real terminal outside Claude Code, so a script
  cannot call it directly.

The plugin hook (`hooks/hooks.json`, the same hook as the xprov consent)
denies Edit, Write and MultiEdit of every `gate-record.json` and of the
store.

**Residual risk (tier 0).** An agent with raw Bash can still write the store
and its chain, or call the store module directly. This is the same residual
risk as the xprov consent store (decision record
`2026-10-14-a1-autonomy-chat-consent`): the same OS user can always do it.
The controls stop accidental and tool-level self-acceptance, not a
determined shell. A file truncated exactly at a line boundary leaves a valid chain
and simply loses the newest lines (for example an acceptance, or a newer run
that voids it); this is not detected and stays a tier-0 residual risk. The
terminal guard of `accept` (a pty plus no Claude Code ancestor) can be fooled
by a double-forked, detached pseudo-terminal. That guard is shared with the
xprov owner step; until it is fixed (bug report in the vault,
`project/a1-specforge/fixes/2026-11-12-terminal-guard-detached-pty-bypass.md`)
there is currently no protection against that bypass: neither the store nor
the hook stops it. Never write the store,
`gate-record.json` or a `gate-record` marker block by hand, and never run
`accept` yourself.

**When the store blocks every gate (owner recovery).** An oversized file or a
damaged chain makes every `run`, `accept` and `handoff-check` fail with
"gate store is not trustworthy ... Ask the owner, do not delete the store".
Do not delete, truncate or edit the store and do not work around it. Tell
Robert. He recovers it at his own terminal: move the file aside under a dated
name (`mv ~/.a1-ux-studio/gate-store.jsonl ~/.a1-ux-studio/gate-store.jsonl.2026-11-12.bak`, using
the passwd home), then run the gate again and re-accept whatever is still
open. Moving the file aside voids all earlier runs and acceptances; no
rotation is needed.

## Done when

- `screenshots/` holds `<board>-1280.png` and `<board>-390.png` for every
  existing board plus `result-1280.png` and `result-390.png`, all listed
  under `run.md ## Screenshots`.
- `gate-record.json` comes from a run on the current `result/result.html`,
  and the user has seen every open primary finding and font failure in German.
