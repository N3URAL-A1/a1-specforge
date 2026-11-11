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
