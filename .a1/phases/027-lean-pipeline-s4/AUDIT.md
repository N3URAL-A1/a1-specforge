---
plan: /home/rob/claude-projects/a1-specforge/.a1/phases/027-lean-pipeline-s4/PLAN.md
verdict: PASS
blockers: 0
majors: 0
minors: 6
lanes_audited: 2
lane_split_check: PASS
generated: 2026-11-20
round: 3
---

# Plan Audit (round 3, final)

## Verdict: PASS

No BLOCKER and no MAJOR. Both round-2 MAJORs are resolved, and I measured the fixes against the code. Six MINORs remain. Each one can be fixed inside its task during execution, without another plan revision. Each MINOR below names the task and the exact change.

Measured for this audit on `main` @ `54836f2`. All scratch copies were under the session scratchpad and are deleted.
- `lane-split check` exits 0 with and without `--imports .`: PASS, 2 lanes, 4 waves in lanes, waves 5-10 sequential, `imports_checked: true`, 0 findings. `plan depth-check --plan` gives verdict `pass`, with every check passing.
- **Phase-start block (Task 3.3 (1a)), extracted verbatim from PLAN.md lines 778-792.** Placeholders were replaced with node `split/join`. The test used a planted repo with a linked worktree, run from a third cwd, with `HOME`/`GIT_CONFIG_GLOBAL` isolated.
  - Result: rc 0, `status --porcelain --untracked-files=all` printed 0 lines, and HEAD = `chore(ph): event stores`. The first GOAL.md line is exactly `# Goal: it's a "goal" with $(touch PWNED)`, and no PWNED file exists. `<common-dir>/info/attributes` holds the two union lines once.
  - A second run: rc 0, and the commit count stays at 2.
- **Lane merge with the union attribute.** Branches `la`/`lb` each append one line to `observations.jsonl` and one ISO row to GOAL.md. `git merge la` and then `lb` both exit 0, and both lines and both rows are kept.
- **Recovery path (new finding m1).** First run with a failing `pre-commit` hook: `STOP: event-store commit exit=1`, rc 1. Re-run without the hook: rc 0, `event stores ready`, but no commit. Status shows `A  .a1/phases/ph/GOAL.md` and `A  .a1/phases/ph/observations.jsonl`, and `git worktree remove` refuses (rc 128).
- **kritis pin changes (Task 9.1 action 3, 02-specify/03-clarify part).** This ran on a `git archive` copy. I inserted the two action-2a lines verbatim at their anchors (each anchor occurs exactly once).
  - Without pin changes: `217 passed, 4 failed`, which is `P 02-specify.md`, `P 03-clarify.md`, `D …/02-specify.md: removed=0 added=1` and `D …/03-clarify.md: removed=0 added=38`.
  - With the listed changes applied: `221 passed, 0 failed`. The changes were the two `insert-after`+`line` pairs (the 03-clarify pair goes before the existing 03-clarify rows), `37`→`38`, and a new 02-specify `elif` that compares the added lines with the allowed-diff rows in order. `P-mut 02-specify` still passes, as the plan says, so K4 is needed.
  - a1-ux-studio on the same copy: `381 passed, 0 failed`.
- **SKILL.md delete anchor.** `loud when triaging.` occurs exactly once in `golden/prompts/SKILL.md` and once in `skills/a1-new-feature/SKILL.md`. The 12 lines after it match byte for byte in both files: blank, `**What shrinks…**`, blank, header, separator, 6 rows, blank.
- **Plan-time red claims.** `01-discover.md` contains `may be combined` once. The 04-plan `**Size-S fast path` paragraph contains `instruct`. No suite other than a1-quick (01-discover Step 2b anchors) and the gates-lint corpus reads 01-discover.md or 04-plan.md (grep over `_test-fixtures/*/run-tests.sh`, `parts/`, `cases*`).
- **RR_POS** (`a1-pr-review/run-tests.sh:262`): `w = /^\d\. \`a1-worktree\` exit \`discard\`/m`. If F becomes item 3 and the old item-3 line keeps every byte after its digit, the regex still matches as item 4, and `r < b < w` still holds.
- No PR-diff-vs-`code_scope` gate exists in `_shared/lib` (`code-scope.cjs` runs no diff). So the committed `.a1/phases/<spec-id>/` stores in a1-new-feature PRs trip no scope check.

## Findings

### BLOCKERS (must fix before execution)

None.

### MAJOR (high risk of failure)

None.

### MINOR (execution proceeds, but note)

- **[m1] The Phase-start block decides to commit on `CHANGED`, not on the git state, so its own recovery path recreates round-2 M1.** If the first run's commit fails (for example, a project `pre-commit` hook, a lint-staged rewrite, or an index lock), the block correctly prints `STOP`. But the natural fix is to re-run the block, and that run finds both files present, so `CHANGED=0`. It prints `event stores ready`, exits 0 and commits nothing. Measured: the files stay staged (`A `), and `git worktree remove` refuses. The commit-landed gate then fires after Wave 1 and blames the executor. — *Task 3.3 (1a)/(2b); FL13; D21*
  > Fix (in Task 3.3, same block): replace the `if [ "$CHANGED" -eq 1 ]` guard with `if [ -n "$(git -C "$WORK_PATH" status --porcelain -- "$P/observations.jsonl" "$P/GOAL.md")" ]`. Keep `CHANGED` only for the `## Decisions` append if wanted. FL13 (no second commit) still holds. Add FL12b: a run with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=<dir with failing pre-commit>` exits non-zero, a re-run without it exits 0, and status is empty. Add one RED-proof line: the old `CHANGED` guard turns FL12b red.

- **[m2] The S-plan writer (resumed Rene) contradicts Rene's own agent definition, and that file is not in the claim.** `agents/a1-rene-requirement-engineer.md:20` says "You write into this ONE file across all three phases — never create parallel documents". Its Not-in-scope table (line 100) routes "Wave planning / task decomposition from the spec" to Pablo or Phase 4. The file is a kritis golden (`golden/prompts/a1-rene-requirement-engineer.md`), so editing it would need its own pin change. The 04-plan fallback triggers only on "no agent id", not on a Rene that declines or hands back. This is not a MAJOR: FR-025 names no plan writer, Gate 4.5 and `wave next-check` read the file whoever writes it, and a same-format session fallback already exists. — *Task 9.1 action 2a (04-plan.md), action 1 (SKILL.md text), D15 `resume`*
  > Fix (in Task 9.1, text only): change the 04-plan fallback to "When the resume is not possible (no agent id) or Rene declines or hands back, the session writes the plan itself in the same format". Use the same wording in the SKILL.md insert. SP1 and SP5 stay green. Do not edit the Rene agent file in this slice. Name the tension in the PR B text so a later slice can move the S plan to the session for good.

- **[m3] The 03-clarify S line covers only 2 of the 4 "back to Step 2" paths.** The inserted line says "skip Step 2 … Gate C's 3.5-1 dispatch and any 3.5-2 loop-back resume that Rene". The file has two more returns to Step 2:
  - Step 3 (`:229` "If not, repeat Step 2") — the ordinary path when markers remain;
  - the kritis blocks (`:221` simulate-check, `:324` threat-model "loop back to Step 2").

  On S with a marker left, a session that follows the text meets "repeat Step 2" while the S line says to skip Step 2. It either loops without a resolver or spawns the second Rene that SP3 forbids. — *Task 9.1 action 2a (03-clarify.md); SP3; kritis allowed-diff row*
  > Fix (in Task 9.1): word the line so that it covers every return. Example: "On S the one Rene spawn of `01-discover.md` Step 3b already ran this 3-category scan: skip the Step 2 spawn; every return to Step 2 (Step 3, 3.5-2, the kritis loop-backs) and Gate C's 3.5-1 dispatch resume that Rene via `SendMessage` (spec 027 FR-025)." It still contains `skip Step 2` and `SendMessage` (SP3). Update the `prompts.allowed-diff` `line` row with the same text in the same commit, because D compares it verbatim.

- **[m4] SKILL.md D branch: do not pin blank-line counts that depend on the diff tool.** Task 9.1 action 3 says "the executor measures the exact numbers on the new tree with `diff` and pins them". The deleted block and the inserted block both start and end with a blank line, so whether `diff` pairs those blanks as common lines depends on the implementation. The harness comment at `08-wiring.sh:150-153` says GNU and Apple diff differ in the same way. A count pinned on the aiserver can go red on the Mac. — *Task 9.1 action 3, D SKILL.md branch*
  > Fix: compare the removed and added **non-blank** lines in order, as the 03-clarify branch does, and either derive the blank expectation from `prompts.allowed-diff` or do not assert blank counts in this branch.

- **[m5] The lane base is stated only in the new prose.** D21's lane rule needs lane worktrees to branch off the phase branch after Phase start. The multi-lane section of `skills/a1-execute/SKILL.md` (step 2: "branch `feature/<phase-slug>-<lane-id>`") does not name the base. If a lane is cut from `origin/main`, its stores are missing and `wave next-check` stops in every lane. This fails closed, but the stop is owner-visible. — *Task 3.3 (a1-execute SKILL.md is already in that task)*
  > Fix: add "off the phase branch, after Phase start" to SKILL.md multi-lane step 2 in Task 3.3.

- **[m6] Two writers outside the field-owner table, and an unhandled commit failure.**
  - Victor's `observations.jsonl` lines (a1-execute 03-verify) now modify a tracked file, and no row names their committer. This is a pre-existing gap: VERIFICATION.md is not committed by 03-verify either, and both ride in the same end-of-phase commit.
  - The append commits in 02-execute (g) and 05-implement (f)/(g) have no failure text. A held index lock gives a non-zero exit and a silently uncommitted row.

  Note on the `info/attributes` union lines: they are persistent, local and repo-wide. They apply to every checkout's merges, rebases and cherry-picks of those two paths, they are never removed, and on GOAL.md they would silently keep both sides of a conflicting non-append edit (for example, the goal heading). That is acceptable for append-only stores, but the help/PR A text should say so and name how to remove the lines. — *field owners; Task 3.3 (g), (2f), (2g); D21*
  > Fix: add a Victor row, either "rides in the phase's closing commit with VERIFICATION.md" or "out of scope, pre-existing". Give each append-commit command the same `RC=$?; [ "$RC" -ne 0 ] && echo "STOP: store commit exit=$RC"` tail as the Phase-start block. Add one sentence on the attribute to the D21 prose and the PR A text.

## Round-2 findings: confirmation

| Finding | Status | Evidence |
|---|---|---|
| M1 event stores have no committer | Resolved (recovery-path gap: m1) | D21 chooses commit and gives three reasons (the exclude side effect is measured). The Phase-start block, run verbatim, gives rc 0, empty status, one commit, a no-op second run, and a lane merge with union rc 0 that keeps both sides. Field-owner rows exist for creation, appends, Erik and the attribute. FL12-FL17, plus 4 RED-proof lines. The commit-landed gate and `worktree remove` no longer meet an untracked store on the normal path. |
| M2 S path contradicts phase workflows | Resolved (m2, m3 are text gaps) | 01-discover, 02-specify, 03-clarify and 04-plan are in the PR B claim and in Task 9.1 action 2a. SP1-SP5 are red today as claimed (`instruct`, `may be combined`, no `Step 1 below is skipped`). The kritis pin changes are listed and measured here: 217/4 → 221/0, ux-studio 381/0. The S plan writer is named, with a fallback. |
| m1 blank `delete-after` anchor | Resolved | `loud when triaging.` occurs once in both copies, and the 12 following lines are identical in golden and current (measured). |
| m2 RR_POS on 05-merge item 3 | Resolved | The regex is checked against the D17/Task 9.2 wording: the old item-3 line keeps `` `a1-worktree` exit `discard` `` right after its digit, and the condition goes at the end. DCMGRP and the block count are covered by Task 9.2's listed pin. |
| m3 quoting of goal/title | Resolved | The quoted heredoc `<<'A1_GOAL_EOF'` was measured verbatim with `it's a "goal" with $(touch PWNED)`, and no PWNED file appeared. FL12/FL14, plus RED-proof (j). |
| m4 2.3d dirties `.a1/reservations.json` | Resolved | D5, the Task 2.1 (d) prose sentence, the field-owner row, RV6 and RED-proof (i). The stub run RV5 is unchanged because the sentence sits outside the fence. |
| m5 PLAN without `lanes:` | Resolved | D7 check 6 splits on `--plan` presence. NC31 covers both directions, and the help names both rules. RED-proof (k). |
| m6 help paragraph joins `wave next-check` block | Resolved | Task 1.1 action 6 requires the empty line, the help-lean case asserts it, and RED-proof (l) is listed. |

## New risks from round 2 (requested checks)

- **D21 store commit and `merge=union` in `<git-common-dir>/info/attributes`.** The design is sound and measured on a linked worktree (the attribute in the common dir applies there). The effect on other checkouts is limited to the merge driver for two append-only paths. It does not change diffs, archives or GitHub server-side merges (the squash merge ignores local attributes), and it does nothing on hosts where Phase start never ran. Residual risks are m1 (recovery) and m6 (persistence and the note on the attribute). No pattern problem: `*` does not cross `/`, and the pattern is anchored at the root in `info/attributes`.
- **Commit-on-append while an executor works.** The rule "after COMPLETE and the commit-landed gate, before `wave next-check`, ISO token = decision time" is consistent with the D7 `--since` semantics: a row about a decision taken mid-wave still stops that wave's check, and it does not repeat on the next wave. In 05-implement, parallel agents are dispatched in one assistant turn, and the turn returns only when all of them are done, so "the agent has returned" holds. Lane worktrees have separate index files, so there is no cross-lane lock. The open point is failure handling (m6).
- **Rene resumed via `SendMessage` for the S plan.** The mechanism already exists (`01-discover.md:125` question relay, spawn-policy S1), and the opus tier carries over with the resumed agent. A lost agent id (for example, `/clear` between phases as `token-optimization.md` asks) falls back to the session. The open point is the conflict with Rene's agent contract (m2), plus the 03-clarify loop-backs (m3).
- **kritis pin changes.** Measured green for 02-specify/03-clarify (221/0). The SKILL.md part needs the new `delete-after` op, which `apply-prompts-allowed.cjs` does not have yet, as planned. The anchor and the 12 `gone` rows are confirmed. K1-K4 cover the new op and the P-mut guard. Only the D blank-count pin is fragile (m4).

## Readiness for a1-execute

Ready. The lane split and depth check pass. Every success criterion still maps to a task, a V-line and a red run. The two round-2 MAJORs are closed in the contract and in measured behavior. All six MINORs are local text or guard edits inside Tasks 3.3 and 9.1, plus one field-owner row. Erik can apply them in place, and Victor should check them in VERIFICATION.md. None changes a wave, a lane or a PR boundary.

## Lane audit

`lane-split check` exits 0 with `--imports .` (`imports_checked: true`). Round 2 adds no new lane write: the four phase workflows and the kritis files are written in sequential Wave 9 (PR B), not inside a lane. No wave touches a shared production resource. The stated yield is unchanged and honest.

## Depth Pass

Present, and `plan depth-check` passes. Answer 2 stays rawer than the handed inputs: it carries new raw measurements (the planted-worktree block run, the union-merge rc, kritis 217/4 → 221/0). Answer 4 still names external oracles: CI on GNU/Linux, the long-path merge-check, and the first real feature run. No finding.

## What's Good

- The D21 decision is argued with a measured counter-case: an `info/exclude` silently drops GOAL.md from a directory add. The exact block was run, not paraphrased, and it survived my independent re-run byte for byte.
- The M2 fix goes to the real source of drift, the four phase workflows. It pins them with text cases (SP1-SP4) and a CLI-vs-text agreement case (SP5), and every kritis pin change is listed with a measured red run and a measured green run.
- Every round-2 minor is closed with a named case and a RED-proof line, and the V16 count was recomputed (98 + 1).
