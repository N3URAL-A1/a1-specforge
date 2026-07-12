# STATUS — M13 Residuals

Executed 2026-07-12, same session as M12 (direct orchestration; Robert's
instruction: "Ich setze noch alles um, bis auf dieses Launchen").

## Wave 1 — Gate switchover · DONE

| Task | Status | Commit |
|---|---|---|
| 1.1 Check #10 plan_spec_path_link (third invariant) | ✓ DONE | 7f9d6cf |
| 1.2 `checklist run --only <ids>` (0/1/2 contract) | ✓ DONE | 7f9d6cf |
| 1.3 Gate 4.5 switched to checklist invocation | ✓ DONE | 7f9d6cf |
| 1.4 a1-check removed (skill+CLI+fixture ported, 16 skills) | ✓ DONE | 7f9d6cf |

Deviations: (1) discovered mid-wave that M12's check #9 covered only 2 of 3
a1-check invariants — frontmatter_link was missing; added as #10 before the
switchover. (2) A help.cjs edit put backticks inside a template literal and
broke EVERY suite; caught by the full-suite run, fixed immediately. (3) The
install-sync fixture pinned the literal skill count in a regex; made
count-agnostic.

## Wave 2 — Format axis B · DONE

| Task | Status | Commit |
|---|---|---|
| 2.1 XML→Markdown headings (9 core agents + rene digit-tags + alex principles = 11 files) | ✓ DONE | 3288a54 |

Deviation: the decision doc's tag census missed rene's digit-named phase tags
(`<phase_1_discover>`) and alex's `<principles>` — the first conversion regex
(`[a-z_]+`) missed them too; a residual grep caught both.

## Wave 3 — Residual verifications · DONE

| Task | Status | Commit |
|---|---|---|
| 3.1 Erik lessons → agent-lessons.md (green-mocks, const-sweep) | ✓ DONE | 255b486 |
| 3.2 Lifecycle-gates analysis → verdict NO extraction; the one real 21-line duplicate (roadmap existence check) → `_shared/roadmap-gate-check.md` | ✓ DONE | 255b486 |
| 3.3 Ludwig vs legal plugin → KEEP (layered by design, his Hard Rule 4) | ✓ DONE | 255b486 |

## Wave 4 — Verification + ship · DONE

| Task | Status |
|---|---|
| 4.1 Full suite + parser + syntax + sync + clean-HOME install (a1-check absent, checklist linked) | ✓ GREEN |
| Artifacts + push + CI | ✓ (this commit) |
