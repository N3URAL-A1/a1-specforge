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

### Orchestrator gate note, wave 1 (realpath-check)
- `realpath-check run --diff-base 808fb8e` exits 1: "detected surfaces needing proof: sql", evidence file missing.
- Cause: SQL-shaped fixture text in `_test-fixtures/a1-lib-units/cases/reuse-hash.cjs` (planted fix-class-sweep repo files with `INSERT INTO api.` / `SELECT api.insert_` lines, diff lines ~728-734). This is the false-positive class the gate documents under KNOWN LIMITS ("SQL text inside a test assertion").
- a1-specforge has no database backend, so no real-execution evidence exists to record. No evidence file was written (a fabricated "real run" section would defeat the gate). Recorded as a false positive, gate verdict fail / caught false.

## Wave 2 — Review recorder and wave next-check
Completed: 2026-11-20

- [x] T2.1 `_shared/lib/pr-review-record.cjs` `PROMPT_RECORDERS` `pr review-record` `pr review-evidence` `caller_spec_id` `_test-fixtures/a1-gates-lint/cases-pr-reinhard.sh` `_test-fixtures/a1-pr-review/cases-review-record.sh`
- [x] T2.2 `_shared/lib/wave.cjs` `_shared/lib/wave-next-check.cjs` `wave next-check` `nextCheck` `_test-fixtures/a1-lib-units/cases/wave-next-check.cjs`

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 | DONE | 4cebf11 | |
| 2.2 | DONE | fa5731d | |

Caps: `a1-tools.cjs` 786, `pr-review-record.cjs` 98 (200), `wave.cjs` 15 (60), `wave-next-check.cjs` 156 (320), `gates-lint.cjs` 200 (230).

RED-proof 2.1 (a) PROMPT_RECORDERS check removed -> PR1, PR3, PR5, G3, W11f red; `gates lint` rc=1
RED-proof 2.1 (b) exception keyed on id only (`!== undefined`) -> PR2 red
RED-proof 2.1 (c) lastVerdictFor takes the first record -> RR5b red (RR5 alone stayed green: one record per sha there; RR5b/RR5c added)
RED-proof 2.1 (d) head comparison removed -> RR6, RR6b red
RED-proof 2.1 (e) phase_required check removed -> RR7 red
RED-proof 2.1 (f) 2.3a call line deleted from the real 02-review.md -> PR1, PR3, G3, W11f red (unwired; PR4 plants the same deletion on a copy and expects the finding)
RED-proof 2.1 (g) 2.3a written with --head "$HEAD_SHA" -> RV1 red
RED-proof 2.1 (h) 2.1b trigger dropped from 2.3d prose -> RV3 red
RED-proof 2.1 (i) P3 commit sentence dropped from 2.3d prose -> RV6 red
RED-proof 2.2 (a) `ts >= since` filter removed -> NC4 red (NC3 stays green by design: per-gate last verdict is the later pass either way)
RED-proof 2.2 (b) absent gate log treated as no event -> NC5 red
RED-proof 2.2 (c) non-JSON observations line skipped -> NC10 red
RED-proof 2.2 (d) date comparison `>` -> NC11, NC11b red
RED-proof 2.2 (e) lane lookup returns named -> NC14 red
RED-proof 2.2 (f) flag ignored -> NC18 red
RED-proof 2.2 (g) absent observations.jsonl as no event -> NC23, NC23b red
RED-proof 2.2 (h) absent GOAL.md as no event -> NC24, NC24b red
RED-proof 2.2 (i) string compare instead of Date.parse -> NC28 red (first version of NC28 stayed green: both paths stop; case now has a second gate with a later pass)
RED-proof 2.2 (j) wave-0 rule removed -> NC29 red
RED-proof 2.2 (k) default-path PLAN without lanes treated as wave-plan -> NC31a red

Suites (green): gates-lint 95/0, wave13 10/0, wave14 50/0, a1-pr-review 68/0, a1-lib-units 610/0, a1-cli-output 33/0, a1-workflow-lint 36/0, a1-lane-split 10/0; `gates lint` exit 0. R3b untouched; the two runner diffs against origin/main are one source line each (plus a blank line).

### Deviations
- Added RR5b/RR5c and tightened NC28 (see RED proofs c and i): the plan's cases did not turn red under the named mutations.
- PR5: a1-pr-review names `retro validate --gate-log` only in prose, so the case asserts `call_without_phase` is absent (plan's second branch).
- `wave-next-check.cjs` also imports `parseWaves` from lane-split.cjs (already exported) to find the `## Wave N+1` section.

### Wave 2 verify
- `verify run --project <worktree> --affected --phase 027-lean-pipeline-s4` at head bbe8cae: verdict pass, exit 0 (1st attempt `lock_timeout` exit 2 behind flow-a's run, re-run; 2nd attempt head side 1700 s, lock wait 149 s).
