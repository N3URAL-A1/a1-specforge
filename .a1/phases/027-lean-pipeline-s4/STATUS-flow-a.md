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
