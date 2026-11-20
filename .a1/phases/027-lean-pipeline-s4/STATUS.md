# STATUS — 027-lean-pipeline-s4 (PR A, consolidated after lane merge)

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

# STATUS flow-a (lane flow-a, PR A, Waves 3-4)

## Wave 3 — Workflow text for FR-019, FR-021, FR-022
Completed: 2026-11-20

- [x] T3.1 `skills/a1-new-feature/workflows/06-verify.md` `caller_spec_id` — 522871a
- [x] T3.2 `skills/a1-pr-review/workflows/03-draft.md` `skills/a1-pr-review/workflows/04-submit.md` — d28caf5
- [x] T3.3 `wave next-check` `<!-- a1:stop -->` `Phase start` `Step 1b` `A1_GOAL_EOF` `merge=union` `skills/a1-execute/workflows/02-execute.md` `skills/a1-new-feature/workflows/05-implement.md` `skills/a1-execute/SKILL.md` — 23a2716

| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 | DONE | 522871a | 0 hits of a1-reinhard-reviewer; SKILL.md untouched |
| 3.2 | DONE | d28caf5 | |
| 3.3 | DONE | 23a2716 | audit m1, m5, m6 applied |

### RED-proof
- Tasks 3.1-3.3: deferred to Wave 4 (cases FL3-FL17), as the plan states. No new test in Wave 3.
- Manual behaviour run of the Phase-start block (planted repo + linked worktree, quoted goal with `$(touch PWNED)`): first run with a failing pre-commit hook exits 1 with STOP and leaves the files staged; re-run without the hook exits 0, status empty, 1 commit; third run no new commit; goal line verbatim, no PWNED, `git worktree remove` succeeds (m1 recovery path holds). FL12b becomes a Wave 4 case.

### Audit minors
- m1 applied in the Phase-start block (commit decided by `git status --porcelain -- <both files>`, `CHANGED` removed) and in Step 1b (copy). FL12b + RED-proof (old CHANGED guard turns FL12b red) -> Wave 4.
- m5 applied: a1-execute SKILL.md multi-lane step 2 "branches off the phase branch, after Phase start".
- m6 applied: append-commit blocks carry `RC=$?` + `STOP: store commit exit=$RC`; STOP texts; note on `info/attributes` union lines and removal in both stores blocks; Victor's lines noted as riding in the phase's closing commit with VERIFICATION.md (text in 02-execute decision paragraph). The field-owner table lives in PLAN.md (not editable by me): row "Victor's observation lines -> closing commit with VERIFICATION.md (pre-existing gap)" to be added by the orchestrator/planner. The PR A text must carry the attribute sentence.

### Deviations
- [Rule 3 spirit] a1-execute SKILL.md: besides frontmatter and "Checkpoint per lane", also changed the "Checkpoint protocol" section, routing item 4 and the hard rule "Never skip the checkpoint" so the file does not contradict the new behaviour. No suite pins this text (grepped).
- 05-implement.md Step 3 stop block keeps the old proposal quote; the "Step 2 Size-S" text unchanged.

## Wave 4 — Lint module for FR-019/021/022
Completed: 2026-11-20

- [x] T4.1 `_shared/lib/workflow-lint-flow.cjs` `checkWaveCheckpoint` `checkPrConfirmation` `checkEarlyReview` `_test-fixtures/a1-workflow-lint/cases-flow.sh` — ef1a9ad

| Task | Status | Commit | Notes |
|---|---|---|---|
| 4.1 | DONE | ef1a9ad | module 108 lines; 54 pass in a1-workflow-lint (18 new: FL1-FL17 + FL12b); a1-cli-output 33 pass |

### RED-proof (each: mutate, run a1-workflow-lint, observe FAIL, restore)
- (a) stop-block tracking removed (skip never true): FL1, FL3-FL11 red (incl. FL5).
- (b) `Are you sure` dropped from the D9 list: FL8 red.
- (c) 06-verify dropped from `checkEarlyReview`: FL3 red (also FL1, FL9 via checked 4).
- (d) `Spawn a1-reinhard-reviewer` restored in real 06-verify.md: FL1 and FL3 red (verify-early-review on the real file).
- (e) `yes / no / adjust draft` restored in real 03-draft.md: FL1 red (pr-confirmation).
- (f) `Wait for user input before starting next wave.` restored outside a stop block in real 02-execute.md: FL1 red (wave-checkpoint).
- (g) `Once the user confirms` dropped from the D8 list: FL11 red.
- (h) commit line removed from the 02-execute Phase-start block: FL12, FL12b, FL13 red (untracked files) and FL16 red (git exit 128, worktree remove refuses).
- (i) `merge=union` loop removed: FL15 red (second merge exit 1).
- (j) heredoc replaced by `printf '# Goal: %s...' '<phase_goal>'`: FL12, FL12b, FL13, FL16 red (rc=2, apostrophe breaks the quote).
- (k) commit command dropped from 05-implement Step 4 (g): FL17 red (05-g=1).
- FL12b: old `CHANGED` guard (commit only when this run created GOAL.md) restored in the 02-execute block: FL12b red (rc1=1, rc2=0, no new commit, files left staged).
All files restored after each proof (skills via git checkout, module from a copy); suite green again afterwards.

### Deviations
- None against the plan. FL17 regexes allow text after the path (`; RC=$?`). The `wave-checkpoint` rule is green on the Wave 3 text (stop blocks enclose the prompts), FL1 proves it.
- PLAN.md status boxes are not edited by the lane (PLAN.md is the planner's file); boxes are ticked here. workflow-lint.cjs untouched (hook line is Wave 5).
- Process slip: the first RED script run had an unset scratch variable, so restores failed and the mutations accumulated. Detected from the output, module and skill files restored, RED proofs re-run cleanly via the index. No mutation was committed (suite green, git diff of the commit reviewed by suite).

## Wave 5 — PR A integration (Task 5.1)
Completed: 2026-11-20

- [x] T5.1 `flow_checked` `a1-tools.cjs wave next-check` `_test-fixtures/a1-workflow-lint/cases-flow-cli.sh` ADR note PR A

Lane-split re-check (`--imports .`): 0 blockers, 0 findings, imports_checked true. PLAN.md boxes ticked for T1.1, T3.1-T3.3, T4.1, T5.1 (T2.x were already ticked).

### Verification
- gates lint rc 0; workflow lint --phase 027-lean-pipeline-s4 rc 0; check-wave11-callsites `calls=15`; run-wave13 rc 0; run-wave14 rc 0
- V14 caps loop rc 0; `git diff --quiet origin/main` for verify.json/suite-groups/.github rc 0, for checklist.cjs + new-feature SKILL.md rc 0; `run-suites.sh --check-groups` rc 0
- a1-workflow-lint 57 pass (FC1-FC3 new); a1-kritis-profile 221 pass; a1-intent 1125 pass

### RED-proof
- RED-proof 5.1 (a) hook lines removed from workflow-lint.cjs -> FC1, FC2 red (a1-workflow-lint 55 pass, 2 fail)
- RED-proof 5.1 (b) `--since` -> `--from` on the 02-execute next-check line -> check-callsite-flags.cjs red (rc=1, "wave next-check: flag --from is not accepted by the real command")
- RED-proof kritis inventory row removed -> "I inventory set equality" and "I inventory 11+12" red
- RED-proof `wave next-check` removed from NEW_FEATURE_ALLOW -> kritis "I intent allowlist" red (28 vs 29); the old pins were red on the new tree before the fix (H7a: unclassified `wave next-check`; kritis I count 30 vs 29)

### Deviations
- [Rule 1] `formatFinding` in workflow-lint.cjs printed every non-vault-sync finding as "pipeline exit status swallowed: undefined", so FC2 could not see `wave-checkpoint` (verify-scope findings had the same flaw). It now prints `<rule>: <reason>` for any finding with a rule; the vault-sync-step format is unchanged.
- [Rule 3, missing_wiring, not in the plan] The two fenced `wave next-check` calls made existing pins red. Fixes: `wave next-check` added to the new-feature/continue-feature/execute child allowlists (`_shared/lib/intent-sandbox.cjs`, read-only inside the project); a1-intent `05b-child-seal.sh` H7 probes for it (in/out/link), counts new-feature/continue-feature 29, execute 18, reached 95, and the `5b-Pg` git-user set; a1-kritis-profile `inventory.txt` row (excluded) plus pins 29->30, 11+11 -> 11+12 and intent allowlist 28->29. PR B adds more fenced calls to a1-new-feature files (wave checks, feature plan-steps, feature close): the planner should expect the same pins there.
- The 5.2 orchestrator task is not run.
