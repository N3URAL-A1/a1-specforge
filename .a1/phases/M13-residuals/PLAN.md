# PLAN — M13 Residuals (everything except launch)

**Created:** 2026-07-12 · **Trigger:** Robert: "Ich setze noch alles um, bis
auf dieses Launchen." — execute every deliberately-deferred M12 residual;
launch itself stays Robert's.

**Goal:** Zero known open technical items before launch. Collapse the
a1-check deprecation window (no external consumers exist yet — shipping 1.0
without a deprecated skill beats shipping one), finish format axis B, resolve
the two open verifications (lifecycle-gates, Ludwig), extend the lessons
pilot to Erik.

## Wave 1 — Gate switchover (complete the a1-check retirement)

| # | Task | Done when |
|---|---|---|
| 1.1 | checklist Check #10 `plan_spec_path_link` — completes the third a1-check invariant (M12's #9 covered coverage+phantoms only) | gate-fail-wrong-link fixture red→green via checklist |
| 1.2 | `checklist run --only <ids>` subset mode, exact 0/1/2 contract (full run can't serve Gate 4.5: check #1 expects `clarified`, spec is `planned` there) | --only 9,10 replicates the retired contract incl. ERROR path |
| 1.3 | Switch `04.5-consistency-gate.md` to the checklist invocation; fix-path table reads `checks[]` | no `check run` callers left |
| 1.4 | Remove a1-check skill dir (16 skills), migrate its retro history to a1-checklist/_learning.md, delete `check run` CLI + human report (keep primitives), port fixture scenarios as gate-* cases, rewire all active references, README/install counts | full suite + install-sync green at 16 |

## Wave 2 — Format axis B

| # | Task | Done when |
|---|---|---|
| 2.1 | 9 core-pipeline agents: structural XML tags → Markdown H1 headings (verified first: nothing parses the tags; H1 because inner ##/### hierarchy already exists; placeholder tokens like story `<role>` untouched) + the two stragglers (rene digit-named phase tags, alex `<principles>`) | zero structural tags in agents/; 21/21 frontmatter parse OK |

## Wave 3 — Open verifications + lessons extension

| # | Task | Done when |
|---|---|---|
| 3.1 | Erik lessons: green-mocks and const-sweep incident stories → `_shared/agent-lessons.md` anchors; rules stay verbatim | pointers in 3c-bis/3c-quater |
| 3.2 | Lifecycle-gates duplication analysis (Explore agent, textual comparison across new-feature/fix/execute/modernize) → extract ONLY on evidence of copy-paste, else documented verdict | verdict + action recorded in phase artifacts |
| 3.3 | Ludwig vs. `legal` plugin: structural comparison → keep/drop verdict doc | docs/analysis/2026-07-12-ludwig-vs-legal-plugin.md |

## Wave 4 — Verification + ship

| # | Task | Done when |
|---|---|---|
| 4.1 | Full suite + install-sync + node --check + clean-HOME install smoke; STATUS/VERIFICATION/observations/retro; push; CI green | all green |

## Non-goals

Launch (posts, demo GIF, community) — Robert's explicitly. The empirical
Ludwig A/B on a live legal input — deferred to the first real compliance task.
