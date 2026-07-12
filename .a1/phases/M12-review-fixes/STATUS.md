# STATUS — M12 Review Fixes

Executed 2026-07-12 in one session (direct orchestration by the main session —
analysis was already complete from the external review; wave checkpoints were
delegated by Robert's blanket "setze die angesprochenen Punkte um").

## Wave 1 — CLI wiring + hygiene · DONE

| Task | Status | Commit |
|---|---|---|
| 1.1 check-reservations wired into Gate 4.5 | ✓ DONE | e912e18 |
| 1.2 pack validate wired into evolve Collect + packs/README.md | ✓ DONE | e912e18 |
| 1.3 projectsPath() traversal guard (15 sites, 7 modules) | ✓ DONE | 4ca0700 |
| 1.4 English CLI human output (check/checklist/phantom) | ✓ DONE | e8efdf9 |

Deviation: Task 1.1 was originally planned as "delete check-reservations"
based on an Explore-agent finding; verification showed code-scope *extends*
it (same registry, scalar vs path-list claims) — wired instead of deleted.

## Wave 2 — Skill-text consistency · DONE

| Task | Status | Commit |
|---|---|---|
| 2.1 allowed-tools + prose → `Agent` (canonical name) | ✓ DONE | c540a18 |
| 2.2 German output-rule hardcodes removed (phantom, pr-review) | ✓ DONE | e8efdf9 |
| 2.3 _shared/retro-template.md + 14 retro blocks centralized | ✓ DONE | c540a18 |
| 2.4 21 agent descriptions → block scalar | ✓ DONE | c540a18 |

## Wave 3 — Decision-doc execution · DONE

| Task | Status | Commit |
|---|---|---|
| 3.1 check ⊂ checklist merge (check #9, deprecated alias) | ✓ DONE | 4e1fd23 |
| 3.2 Reinhard Phase 5 → security triage (4 escalation classes) | ✓ DONE | 23d045b |
| 3.3 agent-lessons.md + Pablo pilot + evolve apply rule | ✓ DONE | 23d045b |
| 3.4 Diana wired into new-feature Phase 6 Step 5.5 | ✓ DONE | 23d045b |
| 3.5 hero-animation-builder → _extras/ (symlink re-pointed) | ✓ DONE | 23d045b |
| 3.6 CONTRIBUTING.md Versions-as-opt-in | ✓ DONE | 23d045b |
| 3.7 four decision docs → status: decided | ✓ DONE | 23d045b |

## Wave 4 — Size triage fast path · DONE

| Task | Status | Commit |
|---|---|---|
| 4.1 S/M/L triage + S fast path + `spec set-size` CLI + fixture | ✓ DONE | 7107a2b |

## Wave 5 — Global sync + verification · DONE

| Task | Status | Commit |
|---|---|---|
| 5.1 ~/.claude/rules/common/a1-framework.md synced (store canonical, a1-check deprecated) | ✓ DONE | (outside repo) |
| 5.2 Full verification green (23 suites + parser + syntax + sync + clean-HOME install) | ✓ DONE | — |
| 5.3 Phase artifacts | ✓ DONE | (this commit) |
| 5.4 Push | ✓ DONE | — |
