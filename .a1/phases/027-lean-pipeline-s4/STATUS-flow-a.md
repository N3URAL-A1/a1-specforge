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
