# STATUS — 024-ux-studio

Spec: `project/a1-specforge/spec/024-ux-studio.md` · Plan: `project/a1-specforge/plans/024-ux-studio-wave-plan.md`
Branch: `feature/ux-studio` · Worktree (aiserver): `/home/rob/claude-projects/a1-worktrees/ux-studio`

## History

- 2026-11-09 (Mac): W1 `fb333da`, W2+W3 `14862a1`, security fixes W2/W3 `da5ad0e`, W4 left uncommitted.
- 2026-11-11: W4 work-in-progress committed on the Mac as `01e1d58`, branch fetched over ssh and pushed from aiserver; work continues on aiserver. `origin/main` taken in as `b0fee3b`.

## Wave 4 — Diverge and converge boards (gates, 2026-11-11)

gate0: run.cjs exposes pick, require-pick, reroll, board-check → skills/a1-ux-studio/scripts/run/run.cjs:234
gate0: B1–B8 cases exist and pass → a1-ux-studio suite exit 0 (159 passed, 0 failed)
gate0: realpath-check "sql" on wave diff da5ad0e..HEAD → false positive of the pre-#73 gate; main's realpath-check exit 0 ("no real-path surfaces")
gate0: test-fidelity --diff-base da5ad0e → exit 0 (0 findings)
gate0: verify-install-sync → PASS; gates lint → exit 0; workflow lint → exit 0
gate0: board layout (playwright, fixture boards with fonts) → 1280 px: scrollWidth 1280, 3 columns; 390 px: scrollWidth 390, 1 column; each tile renders its own family
gate0: FINDING pick instruction `pick <id>` unescaped → rendered as "pick ." (browser parsed `<id>` as a tag); fixed: render-fixtures.cjs escapes it, boards regenerated (1 line each), escape rule added to workflows/02-diverge.md step 2.1 and 03-converge.md step 3.1; rendered text now "Say which tile you want: pick <id>."
gate3: FR-004-AC1 PASS @wave4 2026-11-11 (real run folder: board-check --kind diverge exit 0, 5 tiles, 0 remote refs, fonts present)
gate3: FR-005-AC1 PASS @wave4 2026-11-11 (lora pick: real converge board exit 0; colour-only board exit 1 "must differ in element structure"; wrong family exit 1)
gate3: FR-006-AC1 PASS @wave4 2026-11-11 (require-pick exit 1 before pick; pick twice → one line `diverge: family=… variant=… date=…`; require-pick exit 0 after)
gate3: FR-007-AC1 PASS @wave4 2026-11-11 (pick --default-adopted split → `Default adopted: split` in run.md, exit 0)
gate3: FR-022-AC1 PASS @wave4 2026-11-11 (only /design mentions: 02-diverge.md:11, 03-converge.md:9, both "optional and never required")
gate0: reroll limit → first exit 0, second exit 1 "the one re-roll for diverge is used"
gate2: SKIPPED preview deploy (no web app; boards are local offline HTML, measured with playwright instead)
gate1: verify run (58 suites, head b0fee3b) → exit 1; red: a1-intent, a1-xprov, a1-vault-cockpit; all other suites incl. a1-ux-studio exit 0
gate1: a1-intent red is environmental → same 13 failing ids on main a2d136e without this branch (process/signal cases, e.g. X11 "no claude on PATH", B22 SIGTERM); 1106 passed both runs
gate1: a1-xprov red is environmental → CA10 compares a `sort` output without LC_ALL=C; aiserver has LC_COLLATE=en_US.UTF-8, so xprov.cjs sorts before xprov-hit-cover.cjs (same 4 files, other order); 4217 passed, 1 failed
gate1: a1-vault-cockpit red follows from the two above → its I1 case re-runs every suite under a sentinel vault
gate1: branch does not touch the failing suites → git diff origin/main -- _test-fixtures/a1-xprov _test-fixtures/a1-vault-cockpit _test-fixtures/a1-intent _shared/lib is empty
gate1: verdict for wave 4 → PASS with documented environmental exceptions (GitHub CI on the PR is the binding run)

## Waves 5 + 6 (2026-11-11, aiserver; W5 1bd67a6, W6 9b77b8a)

Agents: W5 code Walter, W5 prose Simon, W6 code Walter, W6 prose Simon (parallel, no agent commits).
gate0: a1-ux-studio suite → 258 passed, 0 failed (23 accept/pty cases SKIP under Claude Code; they run with python pty in CI, CI=true turns a SKIP into FAIL)
gate0: mutation re-run by the main session: MAX_SLOTS=9 → F6 red; target_sha256 check commented out → H8, H8b red; files restored byte-identical
gate0: test-fidelity 6946d15.. and 1bd67a6.. → exit 0 but scanned 0 files (the gate does not recognise the repo's bash test parts) — effectively SKIPPED, replaced by the mutation re-runs above
gate0: realpath-check 6946d15.. → PASS (no real-path surfaces)
gate0: verify-install-sync PASS; gates lint exit 0; workflow lint exit 0 (76 files, 0 findings); skill allowed-tools carry no Agent
gate0: W6 prose bug found by measurement: playwright-cli blocks file: URLs (blank screenshot) and needs --browser=chromium without Google Chrome → 05-gate.md fixed (PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true per call, --browser=chromium, install-browser chromium); playwright-cli updated 0.1.22 → 0.1.24
gate3: FR-016-AC1 PASS @wave5 2026-11-11 (CLAUDE.md naming n3urala1-design → source design-system; plain CLAUDE.md / missing vault → builtin 8-family pool)
gate3: FR-017-AC1 PASS @wave5 2026-11-11 (--context product: no candidate with design-taste-frontend; --context brand: vast-quiet-cinematic, luminous-futurism, monumental-editorial returned)
gate3: FR-008-AC1 PASS @wave5 2026-11-11 (failure path with the REAL imagegen skill: exit 1, labeled placeholder in result.html, slot + missing line in run.md; cap 8 / 9th needs --approved proven by suite F6 and its mutation)
gate0: imagegen call shape matches generate.py (--prompt/--out/--slug/--n, dry-run exit 0); the real failure was REQUESTY_IMAGEGEN_API_KEY missing on aiserver → real image generation SKIPPED (no key here, paid API)
gate0: SKIPPED real-project design-system detection (no project on aiserver names n3urala1-design or vf-brand; covered by suite F2 fixtures)
gate3: FR-025-AC1 PASS @wave5 2026-11-11 (family-catalog.md 8 rows equal families.json; 02-diverge.md section 8 loads the picked family's first skill)
gate3: FR-014-AC1 PASS @wave6 2026-11-11 (real run folder: 05-gate.md screenshot commands produced 6 PNGs 8–92 KB; handoff-check exit 1 for each missing screenshot before, exit 0 "handoff allowed" after)
gate3: FR-013-AC1 PASS @wave6 2026-11-11 (real impeccable 4.8.1 on linux: low-contrast result → run exit 1, handoff-check "blocked: open: finding low-contrast-1"; result edited after gate → blocked by mtime and sha mismatch; accept outside a TTY → exit 2 with the exact command for Robert)
gate2: SKIPPED preview deploy (local offline HTML, no web app)

## Waves 1–3 (Mac, 2026-11-09)

gate0: marked done on 2026-11-11 from committed code (fb333da, 14862a1, security fixes da5ad0e) and their green suite parts 01–03 in every run since; the Mac session left no gate0/gate3 lines, so per-AC smoke evidence for FR of W1–W3 is re-run in Phase 6

## Wave 10 (2026-11-12, aiserver) — tweaks panel and token export
gate0: a1-ux-studio suite → 307 passed, 0 failed (cases TW0, TW1, TW1b, TW2–TW6)
gate0: mutation re-run, one per RED case, each turned the named case red and was restored: TW1 (dev written to result.html), TW1b (panel-in-result refusal removed), TW2 (block spliced one line late), TW3 (append instead of replace), TW4 (no-UX-line refusal removed), TW4b (frontmatter searched), TW5 (accent regex dropped), TW5b (font regex dropped), TW6 (`</script` added to panel template). First TW6 version survived its mutation (the escape it guarded was dead code) → escape removed, test changed to assert the template holds no closing script tag
gate0: workflow lint exit 0 (76 files, 0 findings); verify-install-sync PASS
gate3: FR-026-AC1 PASS @wave10 2026-11-12 (real playwright-cli chromium: result.dev.html → 1 panel, controls font,size,accent,motion,reset,compare,values; result.html → 0 data-a1-tweaks)
gate3: FR-027-AC1 PASS @wave10 2026-11-12 (suite TW2/TW3 on a copy of the real spec 024 frontmatter: block directly under UX/login-screen, second export replaces)

## Wave 11 (2026-11-12, aiserver) — remix mode
gate0: a1-ux-studio suite → 315 passed, 0 failed (cases RM0–RM7)
gate0: mutation re-run, each turned the named case red and was restored: RM1 (amplitude refusal removed; RM1b `in` operator instead of hasOwnProperty also red, proto name `constructor`), RM2 (unknown-anchor refusal removed), RM3 (family not the original's), RM4 (keywords dropped from run.md), RM5 (old Remix section not replaced), RM6 (no-pick refusal removed), RM7 (anchor id regex removed), RM7b (duplicate check removed)
gate0: workflow lint findings [] ; verify-install-sync PASS
gate3: FR-028-AC1 PASS @wave11 2026-11-12 (suite on a temp vault: unknown amplitude exit 2, unknown anchor exit 1, zero anchors → family equals original, one anchor → its 3 keywords in JSON and run.md; plan recorded under run.md ## Remix between Picks and Assets)
gate0: design note: with anchors the planned family is the first anchor's family (spec FR-028 only fixes the zero-anchor case); stated to the user in 09-remix.md

## Wave 12 (2026-11-12, aiserver) — motion templates
gate0: a1-ux-studio suite → 298 passed, 0 failed, 23 SKIP (the G10–G12/H3 accept/pty cases skip when the shell has a claude-code ancestor; the W10 and W11 runs started detached and ran them: 307 and 315 passed, 0 failed; 315 + 6 new MO cases = 321 = 298 + 23)
gate0: mutation re-run, each turned the named case red and was restored: MO1 (one template removed → 2), MO2 (reduced-motion block removed from scroll-fade), MO3 (mobile still hidden in ambient-loop), MO4 (keyframe `left` in hero-reveal; transition on `width` in scroll-fade), MO5 (remote stylesheet link), MO6 (checker's animation/transition test weakened)
gate0: workflow lint findings [] ; verify-install-sync PASS
gate3: FR-029-AC1 PASS @wave12 2026-11-12 (real playwright-cli 0.1.24, chromium, set-reduced-motion reduce, counting elements with animation-name != none or transition-duration > 0: hero-reveal normal 4 → reduced 0; scroll-fade normal 2 → reduced 0; ambient-loop normal 2 → reduced 0. Mobile: .a1-motion-still display block at 390 px and none at 1280 px in all three)

## Wave 8 fix (2026-11-12, aiserver) — parseEntry reads the vault-indexer frontmatter
gate0: a1-ux-studio suite → 299 passed, 0 failed (exit 0, A1_VAULT_ROOT unset, LC_ALL=C); new case T7 RED on the old parser (298 passed, 1 failed: T7 lint "missing field keywords"), green after the fix
gate0: mutation re-run, each turned T7 red and was restored: block-list branch disabled (lint fails), continuation-line fold removed (folded image_prompt truncated), '' unescape removed
gate0: real vault `taste.cjs lint --root $HOME/N3URAL-Vault/pattern/taste-vault --min-entries 23 --families 8` → ok (23 entries, 8 families)

## Wave 9 (2026-11-12, aiserver; vault only, no repo code)

Agents: Uwe (research + screenshots, two rounds: 32 + 12 candidates). Curation: Robert, family by family via chat (screens opened on his Mac).
gate0: Robert's approval: round 1 kept 23 of 32 (dropped commit-mono, practical-typography, dither-it, posthog, clickhouse, flighty, wallpaper, paris-review, monocle); round 2 kept 8 of 12 (dropped klim, resend, national-gallery, analogue). Dropped entries moved out of the vault.
gate0: FINDING real vault indexer rewrites entry frontmatter (block lists, folded lines, permalink) → lint read 0 keywords; fixed in 02915f6 (parseEntry, case T7 with byte copies of real entries, RED proven)
gate3: FR-023-AC1 PASS @wave9 2026-11-12 (taste.cjs lint --root $A1_VAULT_ROOT/pattern/taste-vault --min-entries 30 --families 8 → "ok (31 entries, 8 families)", exit 0; per family 3-4 entries)
gate3: FR-023 pool PASS @wave9 2026-11-12 (run.cjs families --vault-root ~/N3URAL-Vault → source vault, 5 candidates, warnings [])

## PR review fix round (2026-11-12, aiserver)

RED proofs: every new or changed case was run on the unfixed code first (suite on the tree before any production edit, `gate-store.cjs` absent): 309 passed, 59 failed, all 59 in the new or rewritten cases below; green after the fixes.

BLOCKER gate-record forgery (handoff trusted gate-record.json)
- RED on old code: S1 (pass record with findings removed → exit 0 instead of 1), S1b (finding demoted to advisory), S1c (hand-written pass record, no run in the store), S2 (accepted by hand, no store line), S2b (stored reason differs), S2d (font failures accepted by hand), S2e (acceptance of an older run), S3/S3b-S3i (tampered chain, wrong prev, truncated, dropped line, group-writable dir and file, symlinked dir and file; `run` must refuse with exit 3), S4 (digest line written by `run`), S6 (hook: Write/Edit/MultiEdit of gate-record.json and of the store allowed), H11d (forged id line now yields a second blocker).
- Green: store `<passwd home>/.a1-ux-studio/gate-store.jsonl` (`scripts/gate/gate-store.cjs`; dir 0700; symlink, foreign owner, group/world-writable refused; O_NOFOLLOW; hash chain; lock via `xprov-audit.withLock`; passwd home via `xprov-owner-home.cjs`); `ux-gate run` writes the run digest, `accept` writes the acceptance line and refuses a record that does not match the stored run; `handoff-check` verifies digest, chain and every accepted item. Hook: `guardedPath` in `_shared/lib/xprov-hook-paths.cjs` denies `**/gate-record.json` and the store dir (string, realpath and inode forms), the deny text names `ux-gate.cjs`; hooks.json wiring unchanged (Edit|Write|NotebookEdit|MultiEdit already routes to the hook), description extended.
- Test seam: no environment variable. The gate parts run the gate from a tree COPY whose `xprov-owner-home.cjs` is swapped for `fake/xprov-owner-home.cjs` (run-tests.sh, same pattern as the a1-xprov suite). The real module's location is asserted (S4: `storeDir()` equals the passwd home plus `/.a1-ux-studio`).
- Existing cases that hand-edited a record to `accepted` (H1b, H1e, H2b, H2c, H12) now also seed the store line through the real `recordAccept`; H1e and H2 build their findings and font failures through the real gate (two real findings from the captured detector JSON with its entry duplicated; Lora remote link plus Comic Neue) instead of hand-written ones.
- Mutations (one run, each turned its named cases red, all restored): acceptance check removed (S2, S2b, S2d, S2e, S3e), chain test removed (S3b, S3c), dir and file mode checks removed (S3f, S3g), width test removed (S7, S7b, S7c, S7f), `local(` test and file-name test removed (G14 x4, S9, S9b), font allowlist lookup removed (TW7), gate-record.json basename guard removed (S6 x5), vault sha scan removed (S8d, S8e).
- Residual risk documented in `workflows/05-gate.md` section 7 (raw Bash can still forge; same tier-0 as the xprov consent store, record 2026-10-14-a1-autonomy-chat-consent).

MAJOR guard (requireTerminal bypass via `env -i ... script -qc` double fork): code left as is. The shared guard also protects the xprov owner step and has its own bug report; no cheap robust hardening exists that keeps the pty cases green (a controlling-tty or session-leader test is exactly what the double fork fakes). 05-gate.md section 7 says the store and the hook are the control. No RED case required.

MAJOR tweaks decision line: RED TW2 (block spliced one line late: inside the continuation), TW2b, TW3, TW7b on the old code (the new fixture has the Clarify bullet format, so the old `startsWith('UX/<screen>:')` found nothing, exit 1). Green: `findDecision` accepts `- **YYYY-MM-DD** — UX/<screen>:` (bare line kept), block goes after the indented continuation lines, replaced on a second export; a mid-sentence `UX/<screen>:` is not a decision line (TW4b). Fixture rebuilt from three verbatim lines of the real spec lomberg-duesseldorf/001-foundation.md around one entry in the 03-clarify.md format (fixtures/SOURCES.txt).

MAJOR font list: RED TW7 (Georgia and Papyrus exported with exit 0), TW8 (panel list not the allowlist). Green: build() writes the 23 allowlist families into the panel (placeholder `/*A1_FONTS*/[]`), export-tokens exits 1 for any font off the allowlist.

MAJOR font-check `font:` shorthand: RED G6e keyword (small, smaller, xx-large with style/weight/line-height), var(), var()/var() with spaces around the slash, calc(); the old regex needed a digit size and even returned wrong family names (`xx-large/1.2 Papyrus`, `+ 2px)/1.5 Papyrus`). Green: tokenizer with parentheses depth, size = keyword | length | var()/calc()/clamp()/min()/max()/env(), optional `/ line-height`, family list = the tokens after it; controls: allowlisted family after a keyword size, system font keyword `caption`.

MINOR
- `src: local(...)` and file names under `fonts/<family-id>/` (boards and results share `checkFonts`): RED G14 x4 (local, other family's file name, other family's folder, file outside fonts/), S9, S9b (board-check); G6n control for a multi-word id (`source-sans-3`, `../boards/fonts/` path). New reasons `local_src`, `font_file_mismatch`.
- PNG width: RED S7, S7b, S7c, S7f. handoff-check reads the IHDR width and requires N or 2N; the cases generate their PNGs with `fixtures/handoff/make-png.cjs` (zlib, no blob); S7d/S7e control 2x and mixed shots.
- Taste vault in the result: RED S8b, S8c, S8d, S8e, S8f. `ux-gate run` exits 2 when result.html names a `pattern/taste-vault` path (also behind character references) or, with `$A1_VAULT_ROOT` present, when a non-HTML file under result/ or a data: image equals a vault PNG by sha256 (S8g control: other PNG passes).
- detectorEnv drops `npm_config_*` / `NPM_CONFIG_*` and npx gets `--registry=https://registry.npmjs.org` (RED G7, G11b, G15); dead `DO_NOT_TRACK` clause removed (DO_NOT_TRACK still passes through, G15 DNT=1).
- tweaks-panel motion: RED TW9 (DOM stub harness `fixtures/tweaks/panel-harness.cjs`: override attribute set unconditionally). Green: `data-a1-motion-on` only while the motion control differs from its default; reset and compare switch it off.
- assets.cjs:88: NOT CHANGED. Line 88 in this tree is `const kept = withoutMissing(parts.section, name);`, which is used (the failure branch and the success branch both spread `kept`); a scan for unused declarations in the file finds none, and the cap behaviour is untouched. Needs the reviewer's exact finding text if a different line was meant.
