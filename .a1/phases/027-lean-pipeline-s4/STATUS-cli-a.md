# STATUS cli-a (lane cli-a, Waves 1-2)

## Wave 1 — Reuse foundation, facade lines and PR A help
Completed: 2026-11-20

- [x] T1.1 `_shared/lib/reuse-hash.cjs` `currentScope` `checklistRunWithReuse` `toolClosure` `frontmatterOf` `_shared/lib/help-lean.cjs` `_test-fixtures/a1-lib-units/cases/reuse-hash.cjs` `_test-fixtures/a1-lib-units/cases/help-lean.cjs`

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 | DONE | 373d07b | |

Caps: `a1-tools.cjs` 786 (cap 786 expected, 800 hard), `reuse-hash.cjs` 219 (270), `help-lean.cjs` 38 (140), `gate-log.cjs` 475 (480), `help.cjs` 709 (800). `checklist.cjs` has no diff against origin/main.

RED-proof 1.1 (a) currentScope returns null -> RH2 red (rc=1)
RED-proof 1.1 (b) lookup takes the first record -> RH4, RH7 red (rc=1)
RED-proof 1.1 (c) `!chain.ok` check removed -> RH5 red (rc=1)
RED-proof 1.1 (d) wave-plan dropped from 4.5 inputs -> RH9 red (rc=1)
RED-proof 1.1 (e) `--only` set check removed -> RH11, RH12 red (rc=1)
RED-proof 1.1 (f) requireHead ignored -> RH7, RH14, RH15 red (rc=1)
RED-proof 1.1 (g) class-sweep hash not re-set after the run (pre-run only) -> RH13 red (rc=1)
RED-proof 1.1 (h) tool digest dropped from the key -> RH17, RH19 red (rc=1)
RED-proof 1.1 (i) roadmap dropped from 4.5 inputs -> RH18 red (rc=1)
RED-proof 1.1 (j) toolClosure returns only entry modules -> RH19 red (rc=1)
RED-proof 1.1 (k) `${LEAN_HELP}` removed from HELP -> help-lean H1, H3 red (rc=1)
RED-proof 1.1 (l) empty line before `  Input-hash reuse` removed -> help-lean H4 red (rc=1)

Suites run (all green): a1-lib-units 556/0, a1-lane-split 10/0, a1-fix-class-sweep 92/0, a1-checklist 53/0, a1-worktree 166/0, a1-exit2-audit 36/0, a1-cli-output 33/0, a1-gates-lint run-tests 90/0, run-wave13 10/0, run-wave14 50/0; `gates lint` exit 0.

### Deviations
- None. Facade routes `pr review-*` and `wave` to modules that Wave 2 creates (as planned); nothing calls them before then.
- Note: the lane-split reuse stdout always says `imports_checked: <--imports given>` (D6), also for a plan without lanes, where the real run says false.

### Wave 1 follow-up
- Commit 033c803: first `verify run --affected` (head 373d07b) was red on `a1-metrics` RR17a. Cause: the plan's usage-list edit (`"run", "wave", "probe"`) broke the pin `"metrics", "run", "probe"`. Fixed by placing `"wave"` before `"realpath-check"` (assert untouched). Re-run alone: a1-metrics 476/0.
- Final `verify run --project <worktree> --affected --phase 027-lean-pipeline-s4` at head 033c803: verdict pass, ok true, 63 commands, exit 0 (head side 1696 s; lock wait 632 s behind flow-a's run).
