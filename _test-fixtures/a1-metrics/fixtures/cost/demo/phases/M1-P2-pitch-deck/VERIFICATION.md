---
plan: .a1/phases/M1-P2-pitch-deck/PLAN.md
goal: Ein reproduzierbares python-pptx-Build-Skript im Repo erzeugt aus STORY.md und ZAHLEN-REGISTER.md auf Basis von Master_Neuro_VF.pptx das Deck AI-Net_Pitch_v<N>.pptx mit 19 Folien (Titel, Folien 1–8, Backup B1–B9, Schluss), jede Zahl wörtlich als Deck-String, geprüft durch deterministische Checks und einen LibreOffice-Render.
verdict: PASS
passed: 13
gaps: 0
findings: 4
verified: 2026-10-09
---

# Verification: M1-P2-pitch-deck

## Verdict: PASS
**Cost:** Cost: 34129128 tokens (in 1554, out 87097, cache 34040477) (cost run over ~/.claude/projects/-Users-rob-claude-projects-ai-net since 2026-10-09T00:00Z; covers the whole session, not only this phase)

Every acceptance criterion was checked in the worktree `a1-worktrees/m1-p2-pitch-deck` (HEAD f61ac50, tree clean). The checks ran again from scratch. STATUS.md was not used as evidence. There are no blocking gaps. Four minor findings are listed below. None of them blocks a release.

## Gate-1-Build (phase_kind: code), measured again

| Step | Full draft (rebuilt now) | v1 (`docs/pitch/deck/AI-Net_Pitch_v1.pptx`) |
|---|---|---|
| `build_deck.py --draft full --only full` | `template sha256 unchanged: 828aa01b…891c6`, `written: …draft-full.pptx slides=19`, exit 0 | — (release artefact) |
| `render.sh` | `pages=19`, exit 0 | `pages=19`, exit 0; 19 PNGs `AI-Net_Pitch_v1-01…19.png` |
| `check_content.py --expect full` | `content checks: 0 failed`, exit 0 | `content checks: 0 failed`, exit 0 |
| `check_layout.py --expect full` | `layout checks: 0 failed`, exit 0 | `layout checks: 0 failed`, exit 0 |
| `check_render.py --expect full` | `render checks: 0 failed`, exit 0 | `render checks: 0 failed`, exit 0 |
| `diff <(pdftotext -layout draft-full.pdf -) <(pdftotext -layout v1.pdf -)` | no output → `pdftotext identical` (the rebuilt draft has the same text as v1, so the build is reproducible) | |

## Acceptance Criteria Results

Spec = GOAL.md (scope) plus PLAN SC-1…SC-8. GOAL.md diverges from the plan; see Deviations.

| Criterion (quoted verbatim) | Status | Evidence |
|---|---|---|
| GOAL: "8-Folien-Deck auf Master_Neuro_VF.pptx (TK-Template, Gate G1-3) bauen." | ✓ PASS (superset) | 8 main slides F1–F8 plus T, B1–B9, E = 19; layouts come from the template (`Title Slide`, `Title and Content`, `1_Title Only`); template SHA256 `828aa01b…891c6` unchanged |
| GOAL: "Folien nach SCQA/Minto: Answer, Situation, Complication, Proof, Benchmark, Modell, Ask, 90-Tage-Plan" | ✓ PASS | 17 STORY rows `1 Answer … 8 90-Tage-Plan, B1…B9`; every F title matches STORY verbatim (independent python-pptx check, `title_ok` F1–F8) |
| GOAL: "Use-Case-Folien visuell: NOA AI, OSS-Datenexport, AI-Business-Analyse" | ⚠ PASS (deviation accepted) | Built as the backup slide B9 (card grid with 3 use cases × 4 columns, PNG 18). Not built as its own visual main slide. This was Robert's decision of 2026-10-09 (PLAN feature ownership, B9 exception). See Finding 1 |
| GOAL: "Vodafone-Konvention: Template nutzen, Versionen hochzählen, nie überschreiben" | ✓ PASS | `build_deck.py:115` `open(target, "xb")`, `:138` `git status --porcelain` → Exit 4; only `AI-Net_Pitch_v1.pptx` exists |
| SC-1: Release with the next free number, only with a clean tree, `'xb'`, template read-only, VERSIONS.md next to the target with the full hash. "Am Ende der Phase existiert genau `AI-Net_Pitch_v1.pptx`." | ✓ PASS | `ls …v*.pptx` → only v1; `grep -c '^| v'` = 1; `hash-ok`; hash `f652164d64d8119fdea2f08b9e5c70c061fd610f` = commit "feat(deck): final draft passes visual check", `merge-base --is-ancestor` ok; template sha in the row = `828aa01b…891c6` = plan constant. No deck source changed between f652164 and HEAD (`git diff --name-only f652164 HEAD` lists only v1.pptx, VERSIONS.md and .a1 files) |
| SC-2: 19 slides T, F1–F8, B1–B9, E, 12192000 × 6858000, layout per table, titles verbatim | ✓ PASS | V5: `slides 19 12192000 6858000`; T/E `Title Slide`, F1/F7 `Title and Content`, rest `1_Title Only`; all 17 titles verbatim from STORY, T `AI//Net`, E `Danke.` |
| SC-3: deck strings verbatim in text boxes, no `Z-…` visible, IDs in notes, no `€` on F1, B9 without € and % | ✓ PASS | V6 (incl. EXTRA_IDS): `ids checked 53, missing visible 0, missing notes 0`; V5 asserts: no Z-ID / no `[Z-` visible, no € on F1 (visible text + notes), notes on all 19; B9 `€ or %: False`; STORY key-figure texts (without `[Z-…]`) verbatim on F1–F8 |
| SC-4: digits only in deck strings/exceptions; chart labels allowed | ✓ PASS | C11/C13 in check_content 0 failed; V8: `folie3 ['4', '0']`, `folie8 ['Baseline in 30 Tagen', 'Go/No-Go nach 90 Tagen', '90 Tage']` (folie6 removed per review) |
| SC-5: only Vodafone SemiBold/Book, minimum sizes, no placeholders, nothing below 7.0″, content ≤ 6.05″, logo only on T/E | ✓ PASS | Fonts `{'Vodafone Book','Vodafone SemiBold'}`, 0 runs < 14 pt; 0 placeholders; V5 geometry asserts green; pictures: `pic_logo` only on T and E; check_layout 0 failed |
| SC-6: PDF 19 pages, PNG per page, visual check before release, PDF text draft = v1 | ✓ PASS | `pdfinfo` Pages 19; 19 PNGs; pdftotext diff empty; visual check of the draft is recorded in STATUS (19 lines, Wave 8, before the release commit) |
| SC-7: "`docs/pitch/STORY.md` hat genau eine neue Zeile (B9), sonst keine Änderung; `docs/product/` unverändert; kein Remote." | ✓ PASS | `1	0	docs/pitch/STORY.md`; only `+| B9 | Use Cases im 90-Tage-Plan: … | Z-A03 |`; `git remote -v` empty; `docs/product/` vs branch base 08bf55b unchanged (see Finding 3) |
| SC-8: README describes the rebuild; review feedback verbatim; every row has a status | ✓ PASS | README contains draft/check/render/release commands, version rule (Exit 4, `git status --porcelain`, VERSIONS.md); V11: `0` rows without status, `ok` source; 11 rows (Robert via orchestrator) |
| V10 file size ≤ 400 lines | ✓ PASS | `wc -l … awk '$1>400'` empty (1543 lines total) |

### Phantom BLOCKERs
none. `phantom check` → `"status": "clean"`, `total_completed: 0`. The result does not prove anything because PLAN.md has no done markers. The goal-backward checks above replace it.

### Verify manually (weak phantom matches)
none

## Visual check V9 on v1 (Read tool, substitute font)

| Page | Slide | Finding |
|---|---|---|
| 01 | T | "AI//Net" on the left, subtitle, line "Networks · Hirschburg" (no date, per Robert's review), logo bottom right, "C2 General" small. OK |
| 02 | F1 | Three-line title, brain on the left, "3 FTE" in teal, two accent cards (Baseline, Go/No-Go), no €. OK |
| 04 | F3 | Bar chart 4 / 0, red only on the zero, card "vier Anfragen" on one line. OK |
| 07 | F6 | No chart (Robert's review), two cards side by side, assumption text below. OK, but there is a large empty area below the text (optical, not a defect) |
| 08 | F7 | Bust, "3 FTE", one mandate card with three bullets. OK |
| 09 | F8 | Timeline with three markers, "90 Tage" bracket, three cards. OK |
| 13 | B4 | 9 rows, status coloured, ends well before 5.75″. OK |
| 17 | B8 | Three-line title, correction footnote on two lines above the source line. OK |
| 18 | B9 | Column headers, three row cards, footer line, no €/%. **Finding:** the cell "OSS-Datenexport und Analyse" breaks onto three lines, and the third line runs over the bottom edge of the card (Finding 2) |
| 19 | E | "Danke.", subtitle, logo. OK |

## Gaps
No blocking gaps. Minor findings, all non-blocking:

### Finding 1: GOAL.md is out of date compared with the phase result (spec vs plan)
- **Criterion affected:** GOAL "8-Folien-Deck", "Use-Case-Folien visuell"
- **What was expected:** 8-slide deck, use-case slides as visuals.
- **What exists:** 19 slides. The use cases appear only as the text grid B9 in the backup. GOAL.md still says `Status: planned — run a1-plan`. RESEARCH.md Z. 88–110 had already noted the conflict. The plan resolved it with Robert's decision (B9). GOAL.md was never updated.
- **Fix:** Orchestrator/M1-P3: update GOAL.md to match the 19-slide result. If Robert wants a real visual use-case slide in the main part, it goes to M1-P3 as a new version.

### Finding 2: B9 cell overflows the card in the render
- **Criterion affected:** V9 ("kein Text abgeschnitten oder überlappt"), SC-5 indirectly
- **What exists:** The row-2 label "OSS-Datenexport und Analyse" (SemiBold, 16 pt, column 2.1″) breaks onto three lines in the LibreOffice render (substitute font) and touches the bottom edge of the card or runs past it. C14 (fit formula) is green. STATUS documents this as an open point for M1-P3.
- **Fix:** Check in M1-P3 with the real Vodafone fonts. If the overflow stays: in `slides_backup.py`, size the row-2 height with more headroom or widen the first column (`B9_COLS`). Do not change the text.

### Finding 3: Plan check V7 uses the wrong base for `docs/product/`
- **What exists:** `git diff --stat 0ff9c06 -- docs/product/` shows 3 files. They come from orchestrator commit 08bf55b on main ("claim code scope"), before the branch started. Against the branch base 08bf55b the diff is empty. This is a flaw in the plan, not in the phase.
- **Fix:** none for this phase; plan quality observation.

### Finding 4: Exit code of the overwrite test differs from the plan
- **What exists:** `write_versioned` on an existing file → Exit 3 (README documents "Exit 3"). The plan, Task 8.1 b, expected Exit 1. The file v1 stays unchanged. STATUS lists this as a deviation. The test log shows an empty `exit ` line for test b (the exit code was not captured).
- **Fix:** none needed; the behaviour is safe and documented.

## Build / Test Status
- Build (`build_deck.py --draft full`): ✓ exit 0, 19 slides
- Render: ✓ pages=19 (draft and v1)
- check_content / check_layout / check_render: ✓ 0 failed each, on draft and v1
- Independent python-pptx checks (V5, V6, titles, layouts, fonts): ✓
- TypeScript/npm: not applicable (Python project)

## Deviations from Plan
- F6: chart removed per Robert's review (REVIEW-FEEDBACK row 2). The STORY "Visual" column for slide 6 still says "matplotlib-Bandbreitendiagramm". STORY may not be changed in this phase, so the drift between STORY and the deck goes to M1-P3/M1-P1.
- T: date line without a date ("Networks · Hirschburg"), per Robert's review row 6.
- F5 title 28 → 24 pt (fallback rule, documented in STATUS).
- Additional module `check_common.py` (shared CLI for the checks), within the plan's limits.
- Overwrite test Exit 3 instead of 1 (Finding 4).
- Spec vs plan: GOAL.md (8 slides, visual use-case slides) vs PLAN goal (19 slides, B9 grid). Plan follows Robert's decision; spec not updated (Finding 1).
