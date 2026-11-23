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
- verify run --affected --phase 027-lean-pipeline-s4 (primary CLI, head b6b9f66): verdict pass, rc 0, 63 commands, total 1705532 ms (head 1705468), lock held, lock_wait_ms 13, no failed ids

## Review fix round 1 (PR #108, findings of Reinhard on head 7572000)

Commits: 9ed268a (B1, m1, n1), 19ea91a (M1), 9580443 (M2, m4, m5), 9552aa1 (m3), ba9d892 (m6, n2). Not fixed by order: m2, m7, m8.
Every fixture was run RED on the unfixed code first (output: lib-units 16 FAIL lines, pr-review 6 FAIL, workflow-lint 3 FAIL), then GREEN after the fix.

| Finding | Fix | RED proof (on the unfixed code) | GREEN |
|---|---|---|---|
| B1 untracked files | `treeClean` runs `git status --porcelain --untracked-files=all` (gate log is excluded by gate-log.cjs) | RH20 (lane-split --imports, untracked `src/new.mjs` importing a foreign lane file) reused, rc 0; RH23 (class-sweep --verify, untracked `lib/new-site.ts` with `INSERT INTO api.invoices`) reused, rc 0 | RH20, RH23 pass; the RH7/RH13/RH14/RH15 baselines still reuse |
| M1 findings bound to head | 2.4 writes `"head_sha": "<head_sha>"`; 2.1b prints `findings_head=match|stale-or-missing`, skip only on `match` | RV7, RV8a-d (stub run of the real 2.1b block, 4 findings states), RV9 red (RV8 first red was a placeholder slip, `<n>` unreplaced; re-proved with the old 02-review.md restored: RV7, RV8a-d, RV9 red) | RV7-RV9 pass |
| M2 agent shapes | `namesAgent` in wave-next-check.cjs: heading with optional colon plus `- <name>` / `- **<name>**`, or inline `Suggested agent(s): <name>` (also bold). checklist.cjs untouched | NC32 (two real stripped plans, ai-harness/008 and my-smart-home/004, in `_test-fixtures/a1-lib-units/real/`) and NC34 stop:agent_unnamed | NC32-NC35 pass (NC33, NC35 keep the empty-name stop) |
| m1 closure | unbounded walk with visited set, double-quoted requires accepted | RH21 (depth-3 `status-constants.cjs` edit) and RH22 (double-quoted require) reused | pass |
| m3 error records | `lastVerdictFor` only counts pass/fail | RR14b pass then a usage error: evidence exit 1 | RR14a-c pass |
| m4 `wave` field | integer, digits-only string, or absent; anything else on a deviation/blocker stops | NC36a (null), NC36b ("x"), NC36c (1.5) continue | NC36a-f pass |
| m5 decision rows | any non-blank line under `## Decisions` that is not `- <token>` stops | NC37a-d (plain, `*`, `1.`, `-2026`) continue | NC37a-e pass |
| m6 grep guard | `grep -qE '^##[[:space:]]+Decisions[[:space:]]*$'` in 02-execute.md and 05-implement.md | FL18, FL18b (`## Decisions needed` only) no heading appended | pass |
| n1 silent catch | stderr `reuse check failed: <msg>` for errors that are not ReuseMiss/ENOENT | RH24 (tree copy whose `findProjectRoadmap` throws) no stderr line | pass |
| n2 removal command | `{ grep -vxF -e '<l1>' -e '<l2>' "$A" \|\| :; } > "$A.new" && mv ...` (also works when only the two lines exist) | FL19 (unrelated `*.bin merge=union` line was dropped) | pass |

Pins changed: none. No existing assertion removed. checklist.cjs unchanged (`git diff origin/main` clean). Line counts: reuse-hash.cjs 225, wave-next-check.cjs 193, pr-review-record.cjs 99, a1-tools.cjs 786.

Suites: a1-lib-units 640/0, a1-pr-review 74/0, a1-workflow-lint 60/0, a1-gates-lint run-tests 95/0, run-wave13 10/0, run-wave14 50/0, a1-fix-class-sweep 92/0, a1-lane-split 10/0, a1-kritis-profile 221/0, a1-intent 1125/0.

### Deviations
- [Rule 3] FL19 uses `eval` on the removal command text extracted from 02-execute.md (test only, the text is the repo's own).
- The new reuse stderr line (n1) is the only behaviour change visible on the CLI beside the fixes; the facade is untouched.

### Verification (review fix round 1)
- verify run --affected --phase 027-lean-pipeline-s4 (primary CLI, "head_sha":"ba9d8927f91f20dc3557b0950c7a608cd8f4ca6a"): verdict pass, rc 0, selection full (runner_or_config_changed: _shared/a1-tools.cjs), 63 of 63 selected, not_run []. A concurrent second invocation got lock_timeout (exit 2) while the first held the lock; the first run finished and is the verdict above.

## Review fix round 2 (PR #108, Samuel SEC-1..5 and Reinhard m2, m8 on head 7572000)

Commits: 7d4fdd8 (SEC-1, SEC-2), a43d12f (SEC-1 addendum), dbd966e (SEC-4, SEC-5), fcc9af3 (SEC-3, m7), 660847d (m2), 4f5ae2e (m8).
Each fixture was run RED on the unfixed code first, then GREEN.

| Finding | Fix | RED proof (unfixed code) | GREEN |
|---|---|---|---|
| SEC-1 tracked log authorises a skip | new `gate-log.cjs` `readTrustedChain(root, scope)`: rejects a log that `git ls-files --error-unmatch` reports tracked (or on any git error other than "untracked"), symlinked path, non-regular file, over 8 MiB, broken chain. Used by `lookupPass` (reuse), `pr review-evidence` (`untrusted_log`) and `wave next-check` (`stop:gate_red`). Head-bound reuse also needs the head repo to equal the log repo (`root_mismatch`). | new case file `a1-lib-units/cases/trusted-log.cjs`: TL1 (lane-split, tracked forged pass for a real owns-overlap FAIL: reused, rc 0), TL4 (evidence rc 0), TL7 (`continue`) | TL0-TL7 pass; baselines (the same forged log untracked) still reuse/continue, so the fixtures are sensitive |
| SEC-1 addendum findings.json | 2.1b block: `FH` is read only when `findings.json` is not a symlink and `git ls-files --error-unmatch` says untracked | RV8e (tracked, matching head_sha) and RV8f (symlink) printed `findings_head=match` | RV8e, RV8f pass |
| SEC-2 read containment | same reader: `assertContained` + `lstat` regular file + size cap | TL2 (symlinked phase dir with forged log) and TL3 (symlinked log file) reused, rc 0; TL5 (evidence via symlink) rc 0 | pass; TL6b names the size cap (`why: too_large`), TL6c missing log is `no_log` |
| SEC-3 ADR | new section "Trust model of the gate log as evidence" in `docs/adr/2026-10-14-gate-invoke-and-log.md` incl. m7; same-user forgery is a named residual risk, "pending owner acceptance", not marked accepted | doc | - |
| SEC-4 shell injection | both blocks: value in single quotes plus `case` guard (CORRECTED in round 3: single quotes did NOT keep `$(...)` from running before the guard, see SEC-7 below) (`STOP: bad phase name` / `bad spec id`, exit 2); prose mandates newline stripping and the regex `^[A-Za-z0-9_][A-Za-z0-9._-]*$` | FL20 (six bad names), FL20b (four bad ids) ran the block, created files and (for `$(...)`) created PWNED; FL20c prose missing | FL20, FL20b, FL20c pass; FL12-FL19 unchanged and green |
| SEC-5 union doc | effect (foreign-branch merges also union GOAL.md rows and observations lines) stated next to the removal note in 02-execute.md and 05-implement.md | doc | - |
| m2 spec_path | `assertSpecIsHashed` in reuse-hash.cjs (uses `resolveSpecFile`, now exported from spec-coherence.cjs): a roadmap `spec_path` that resolves to a file other than the hashed spec is a miss | RH25: identical second call with a spec_path to `other.md` was reused | RH25 (baseline spec_path = hashed spec still reuses; edit of the other file runs) |
| m8 prompt patterns / block size | `workflow-lint-flow.cjs`: `CHECKPOINT_PATTERNS` (`/\?\s*\[(y\|yes)/i`, `/\bproceed\b.*\?/i`) outside stop blocks (a line already hit by a marker counts once), stop blocks over 25 lines flagged | FC4, FC5, FC6 exit 0 | FC1-FC6 pass. Real tree: stop blocks have 1, 11 and 22 lines (02-execute: 1, 11; 05-implement: 22); none longer than 25, nothing shortened; FC1 real copy exit 0 |

SEC-1 probe (scratchpad `sec108/r3-victim` clone, tracked forged `gate-log.jsonl`, lane-split without `--imports`, a real owns-overlap FAIL): the old forged hash no longer matches any tree (the gate code changed), so the log was re-forged per tree in `sec108/r4-victim`. Old tree (`git archive 624ae13`): `reused: lane-split`, exit 0. Fixed tree: gate runs, `"status": "FAIL"`, exit 1.

Pins changed: none. No assertion removed. checklist.cjs unchanged. Line counts: a1-tools.cjs 786, gate-log.cjs 515, reuse-hash.cjs 249, wave-next-check.cjs, pr-review-record.cjs smaller.

### Deviations
- [Rule 3] `resolveSpecFile` is now exported from spec-coherence.cjs (needed by m2, no behaviour change).
- [Rule 3] `fs` import dropped from pr-review-record.cjs (unused after SEC-1).
- The size cap of SEC-2 cannot be proven with a valid chain in a fixture (a valid 8 MiB chain is impractical); TL6 pads a log (chain broken anyway) and TL6b asserts the `too_large` reason directly on `readTrustedChain`.
- SEC-4: `<dir>`/`WORK_PATH` and `<phase_goal>` stay orchestrator-owned; newline stripping of the goal is an instruction only (the shell cannot detect a goal that already closed the heredoc).

## Review fix round 3 (PR #108, Samuel SEC-6..9 and Reinhard R-m1, R-n1 on head 98b4b5a)

Commits: c60b707 (SEC-6, SEC-9), b47a197 (SEC-8, R-n1), fc893a2 (SEC-7), dababf2 (R-m1). Each fixture was run RED on the unfixed code first, then GREEN.

Correction: the round 2 claim "$(...) never runs before the guard" (STATUS SEC-4 row and the FL20 comment) was wrong for a name that holds a single quote: `x'$(touch PWNED)'` gives `PHASE='x'$(touch PWNED)''`, the substitution runs at the assignment. The FL20 comment now says so.

| Finding | Fix | RED proof (unfixed code) | GREEN |
|---|---|---|---|
| SEC-6 in-repo path tricks (MAJOR) | `gate-log.cjs` `evidencePathProblem`: `.a1`, `.a1/phases`, `.a1/phases/<scope>` real directories (lstat), `git rev-parse --show-toplevel` of the phase dir realpath-equal to root, realpath(log) equals `<realroot>/.a1/phases/<scope>/gate-log.jsonl`, positive `git ls-files -o -z` hit, `git ls-files --error-unmatch -- ':(icase)<rel>'` must exit 1. ADR sentence rewritten to the real behaviour | new `trusted-log-paths.cjs`: attacks C, C2, D, D2, E (GATE-LOG.jsonl + ignorecase), E2 (.A1/Phases + ignorecase) x reuse (TP1), `pr review-evidence` (TP2), `wave next-check` (TP3): 18 of 18 FAIL (reused / rc 0 / continue) | 20 of 20 pass |
| SEC-9 TOCTOU | `readCapped`: open `O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK`, `fstat` the descriptor (regular, size cap), read from the fd, text goes to new `verifyChainText` (`verifyChain(file)` stays for the other callers) | structural (a swap between lstat and read cannot be staged in a fixture); TL1-TL7 unchanged green | pass |
| SEC-8 findings.json | 2.1b block: `.a1-review` real dir (not symlink), file real, `git ls-files -o` lists it, `:(icase)` error-unmatch fails | RV8g (tracked symlink .a1-review), RV8h (untracked symlink dir), RV8i (tracked FINDINGS.json + ignorecase), RV8j (submodule at .a1-review): 4 of 4 FAIL | RV8a-RV8j pass |
| R-n1 | covered by SEC-8 (`[ ! -L .a1-review ]`) | RV8h | pass |
| SEC-7 | both blocks read the value with `IFS= read -r X <<'A1_PHASE_EOF'` / `A1_SPEC_EOF`; prose says single quotes are not enough and the orchestrator strips newlines of the name too | FL20 and FL20b with `x'$(touch PWNED)'` and `` x'`touch PWNED`' ``: 4 of 4 FAIL (PWNED created, rc 0) | FL20 (8 names), FL20b (6 ids), FL20c pass |
| R-m1 bare agent line | `wave-next-check.cjs` `namesAgent`: the first non-blank non-bullet line under the heading counts when its first token is bold (`**x**`) or hyphenated and not TBD/TBA/TODO/none/n/a. Prose ("TBD later") still stops | NC37 (real copies of a1-office 001 wave 1+2 and 002 wave 1+2): 2 of 2 FAIL | NC37, NC38, NC38b, NC38c, NC33 pass |

Probe `scratchpad/sec108/r5-probe.cjs` against the new code: A untracked forged log still reused (named same-user residual, unchanged); B, C, C2, D, D2, E, E2, F (both flags), H: rc 1 without `reused`; G (hardlink to a tracked file, local only): still reused (same-user, same class as A).

Pins changed: none. No assertion removed. checklist.cjs unchanged. Line counts: a1-tools.cjs 786 (untouched), gate-log.cjs 574, wave-next-check.cjs 205.

### Deviations
- [Rule 3] `verifyChainText` exported from gate-log.cjs (needed by SEC-9, `verifyChain` keeps its signature).
- NC33 (a colon heading whose body is "TBD later") stays: R-m1's "first non-blank line" rule is narrowed to bold or hyphenated names so that it still stops.
- Out of scope, not changed: `skills/a1-pr-review/workflows/05-merge.md` still has `PHASE='<phase_name>'` (single quotes, run record block, not part of this PR's diff); about 200 real vault waves use the singular `**Suggested agent:**` which `namesAgent` does not accept (checklist check 3 behaviour not compared).

## Review fix round 4 (PR #108, minors only)

| Finding | Fix | RED proof | After |
|---|---|---|---|
| R3-m1 / SEC-12 | `02-review.md` 2.3d reads `caller_spec_id` with `IFS= read -r PHASE <<'A1_PHASE_EOF'`; `none` / unreplaced `<...>` SKIP decided first, then `[!A-Za-z0-9_]*\|*[!A-Za-z0-9._-]*` is `STOP: bad spec id`, exit 2; prose names heredoc, newline strip and regex. `05-merge.md` untouched | new FL21 (`x'$(touch PWNED)'`, backtick variant, `a b`, `../x`, `a;b`, `-lead`, `$(...)` + `none` / `<caller_spec_id>`): 7 of 7 invalid ids FAIL (rc 0, PWNED created) | FL21 pass, workflow-lint 67/67 |
| R3-m2 / SEC-10 | new `_shared/lib/git-env.cjs` (`GIT_ENV_DROP`, `envWithoutGitRedirects`); `xprov-common.cjs` requires it (same list, same export); `gate-log.cjs` `gitIn` spawns git with the stripped env; 2.1b git calls prefixed `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE` | TL8a (absolute GIT_DIR, legit log reused) FAIL rc=1, TL8b (GIT_INDEX_FILE empty index, tracked log) FAIL (reused), RV10 (GIT_DIR of another repo in 2.1b) FAIL | TL8a-c, RV10 pass, a1-xprov run-tests / -b / -c 1056 / 1793 / 1422 pass |
| R3-m3 | `readCapped` reads exactly `st.size` bytes, growth after fstat is ignored; a shrink during the read is still refused (`changed while reading`); optional `afterStat` test seam, `readCapped` exported | old code measured: growth after fstat returns `{why:"changed while reading"}` | TL9a (prefix ok), TL9b (cap: over 8 MiB is `too_large`), TL9c (truncate refused) pass |

Line counts: a1-tools.cjs 786 (untouched), gate-log.cjs 578, xprov-common.cjs 366, git-env.cjs 26. No assertion removed.

### Deviations
- [Rule 3] `readCapped` exported and given an `afterStat` callback (test seam), needed to stage growth after fstat.

## PR B / Wave 6 — `wave checks`, `feature plan-steps`, PR B help
Completed: 2026-11-22

| Task | Status | Commit | Notes |
|---|---|---|---|
| 6.1 `wave checks` | ✓ DONE | 7a5a58c | `wave-checks.cjs` 91 lines; WC1-WC7 (28 checks) in `a1-lib-units/cases/wave-checks.cjs` |
| 6.2 `feature plan-steps`, `feature` group, PR B help | ✓ DONE | d2780b8 | `feature.cjs` 15, `feature-plan-steps.cjs` 74, `help-lean.cjs` 65 lines; facade 786 -> 787; PS0-PS13 (22 checks) |

### RED proofs (each: one edit, `a1-lib-units/run-tests.sh`, file restored)
T6.1:
- (a) stop after the first failing child -> WC2 `test-fidelity still ran` and WC4 `all three reported` red.
- (b) exit from the last child only -> WC2 exit 1 and WC4 exit 1 red (rc 0).
- (c) `--phase` not passed to children -> WC1 and WC4 log-line cases red (`untrusted:no_log`, lines went to `_unscoped`).
- (d) children without `cwd` -> WC4 `gate-0.6-schema line in the project log` red (line landed in the cwd's repo).

T6.2:
- (a) `vincente-wave-plan` sizes ALL -> PS1 counts and PS2 red.
- (b) merged Rene model `sonnet` -> PS3 red.
- (c) `gate-c-ac-dryrun` removed from S -> PS4 (both) red.
- (d) gate id typo `scope-claims` -> PS7 red.
- (e) `tobi-audit` sizes ALL -> PS2 and PS12 red.
- (f) `feature close` blocks removed from `LEAN_HELP` -> help-lean H2 (two lines) and H3 red.

### Results
- `a1-lib-units` 735/0, `a1-exit2-audit` 36/0, `a1-cli-output` 33/0, `a1-gates-lint` run-wave13 10/0 and run-wave14 50/0.
- Pins changed: none (no fenced `a1-tools.cjs` call was added in this wave, so the a1-intent H7a allowlists and the kritis golden inventory stay for Waves 7 and 9). No assertion removed. `checklist.cjs` unchanged. Caps: `a1-tools.cjs` 787 (limit 787), all new modules under their D18 caps.

### Deviations
- WC3 plants a synthetic skipped test (`it.skip`), not a copy of a real one: the real postmortem test in `a1-test-fidelity/real` carries SQL and RLS shapes, which turns realpath-check red too and breaks the expected "realpath green". The SQL for WC2 and WC4 is a copy of the real `a1-schema-check/fail-no-rls` migration.
- No `.a1/fidelity.json` was copied (the plan names one under `a1-test-fidelity/`, none exists there): the default test globs scan `tests/*.test.ts`, so WC3 needs none.
- `wave.cjs` usage text now lists `wave checks` beside `wave next-check`; `wave checks` reports `timedOut` per child in addition to the D11 fields.
- `realpath-check` SQL-shaped fixture text false positive: not hit in this wave (planted SQL is meant to be detected).

`verify run --affected --no-cache --phase 027-lean-pipeline-s4` on head d2780b8: verdict pass, selection full (`runner_or_config_changed`, because the facade changed), 63 of 63 commands, 0 timed out, flaky [] and pre_existing_red []. Wall time about 29 minutes on the aiserver.

### Orchestrator gate note, wave 6 (realpath-check)
- `realpath-check run --diff-base 987c9f6` exits 1 (rls, sql): planted migration fixtures in `_test-fixtures/a1-lib-units/cases/wave-checks.cjs` (WC2/WC4 copy `a1-schema-check/fail-no-rls`). Same documented false-positive class as wave 1; repo has no DB backend, no evidence file written.

## PR B / Wave 7 — `wave checks` wiring and parallel groups
Completed: 2026-11-23

| Task | Status | Commit | Notes |
|---|---|---|---|
| 7.1 workflows call `wave checks`, `BUNDLES`, W11 pins, BU1-BU4 | ✓ DONE | b1d58b3 | `workflow-lint-parallel.cjs` (T7.2's module) also landed in this commit |
| 7.2 research-map group, background vault mirror, parallel lint, PG1-PG7 | ✓ DONE | 84948d6 | `workflow-lint.cjs` 443 (cap 445), `workflow-lint-parallel.cjs` 184 (cap 250), `gates-lint.cjs` 204 (cap 230), facade 787 |

### RED proofs (each: one edit, suite run, file restored)
T7.1:
- (a) `BUNDLES` lookup removed from `findCalls` -> G3, W11f, PR3, BU1, BU3 red (5 fails).
- (b) bundle list without `test-fidelity` -> G3, W11f, PR3, BU1, BU3, BU4 red. BU2 stays green: with test-fidelity out of the list, "removed line gives unwired for all three" is true either way; BU1 and BU4 carry the proof (plan said BU2, measured otherwise).
- (c) W11a: old pin `calls=15` on the new tree -> red (`calls=11`).
- (c) W11b, W11c, W11e: the old mutations (test-fidelity forms) on the new tree -> red (all print `calls=11`, no match). The new mutations are green and flag `missing --phase <spec-id>`, `unknown flag --base`, `02-execute.md: wave checks expected 1 call(s), found 0`.
- a1-kritis-profile inventory: first run on the new tree red (`re-grepped 28 subcommands, expected 30`, set-equality red) -> pin updated.
- a1-intent H7a, H7c: first run on the new tree red (`unclassified: wave checks` in new-feature, continue-feature, execute) -> exclusion added.

T7.2:
- (a) single-member check removed -> PG2 red.
- (b) dependent check removed -> PG3 red.
- (c) `&` test removed -> PG4 red.
- (extra) join=yes check removed -> PG5 red; orphan-join check removed -> PG6 red.
- (d) dashboard pin: inner `dashboard build` line swapped one line down in 04-audit.md -> a1-dashboard 05.26 red (`bad sync=3 ws=false wd=false ...`).

### Pin changes (each with the red run above)
- `check-wave11-callsites.cjs`: FLAGS/`CMD_RE`/FILES for `wave checks`. W11a 15 -> 11, W11b/c/e re-aimed at the `wave checks` line, W11d/W11f byte-unchanged. Measured-red comment block extended.
- a1-intent H7a/H7c: `_shared/lib/intent-sandbox.cjs` gets `WAVE_CHECKS` exclusion (new-feature, continue-feature, execute). Call classified as a WRITE (one gate-log line per child) that spawns node children, so it is excluded like `verify run` (SEC-5, owner-side). `05b-child-seal.sh` needed no edit (floor counts only, H7c control still names `fix: worktree gc`).
- a1-kritis-profile: `golden/inventory.txt` drops `realpath-check run`, `schema-check run`, `test-fidelity --diff-base`, adds `wave checks` (excluded); `parts/01-golden.sh` 30 -> 28 subcommands, excluded 12 -> 10 (label `11+10`). No assertion removed.
- `gates lint`: `wave checks` line counts as a call of its three gates (`call_without_phase` applies).
- No change to `08-wiring.sh`.

### Results
`a1-gates-lint` run-tests 99/0 (BU1-BU4 incl.), run-wave13 10/0, run-wave14 50/0, `check-wave11-callsites` `calls=11`, `gates lint` exit 0, `a1-workflow-lint` 74/0 (PG1-PG7), `workflow lint --phase 027-lean-pipeline-s4` exit 0 (`parallel_checked` 2, `background_checked` 1), `a1-kritis-profile` 221/0, `a1-intent` 1125/0, `a1-dashboard`, `a1-retro-validate`, `a1-xprov` (shard a incl. part 06, shard b incl. part 36), `a1-lib-units`, `a1-pr-merge-check`, `product-schema-v11`, `install-sync` all rc 0. `grep -c RESEARCH.md 02-map.md` = 0; `a1:parallel group=research-map` sums to 2.

### Deviations
- Intent child cannot run `wave checks` (spawn guard, exit 77). 02-execute.md and 05-implement.md carry a one-line note: record "wave checks: deferred to owner". Effect: an intent execute child no longer runs the realpath/schema/fidelity gates itself; the owner must run `wave checks` before merge. The plan named no sandbox change: decision for the orchestrator/Pablo whether to allowlist `wave checks` after a measured spawn-guard check.
- BU2 does not go red under RED-proof (b) (see above).
- Prose in 01-research.md/02-map.md avoids the literal marker string and `RESEARCH.md` so the plan's done-when greps hold (2 markers, 0 RESEARCH.md in 02-map.md).

`verify run --affected --no-cache --phase 027-lean-pipeline-s4` on head 0486c48: verdict pass, selection full (`runner_or_config_changed`, facade in the diff), 63 of 63 commands, 0 timed out, flaky [] and pre_existing_red [], skipped_on_host []. Wall time about 28 minutes.

## PR B / Wave 8 — Background verify and `feature close`
Completed: 2026-11-23

| Task | Status | Commit | Notes |
|---|---|---|---|
| 8.1 background `verify run` in both Verify workflows, Victor wait rule, VS3 pin, W11 `calls=13`, VB1-VB2, BV0-BV5 | ✓ DONE | 0d1a43c | |
| 8.2 `feature close` (`feature-close.cjs`, 285 lines), FC1-FC17 | ✓ DONE | 91422cf | `feature.cjs` 16 lines, facade still 787 |

### RED proofs (each: one edit on a `git archive HEAD` scratch copy, suite or case file run, file restored)
T8.1:
- (a) `--affected` on the background line with the OLD VS3 address -> 2 verify-scope findings (VB1 expects exactly 1 on the new address, which gives 1) -> red as planned.
- (b) join marker removed -> `workflow lint` finding `background-start@03-verify.md`.
- (c) `RC=$?` removed from the background line -> `check-wave11-callsites.cjs` prints `03-verify.md:27 verify run: exit code not captured`.
- (d) BV1 with `--no-cache` on the foreground run -> BV1 red (`cache` `off`).
- (e) `--path-format=absolute` dropped from the start fence -> BV1b, BV2b, BV4, BV5 red (marker dir `.git/a1-verify-bg/fx` is relative, lands in the cwd repo).
- (f) old VS3 on the new tree -> `VS3 03-verify.md ... sum='5 2 2 0 ...'` and the same for 06-verify.md (2 findings each).
- (g) new VS3 address with the foreground `--out` line removed -> 0 verify-scope findings (red).
- (h) old W11a pin `calls=11` on the new tree -> the checker prints `calls=13`.
- (j) extra: both pid liveness lines removed from the join fence -> BV4 red (join runs into its bound, no `died`). With only the `kill -0` line removed BV4 stays green, because the `comm` check also reports a dead pid: the two checks cover each other.
T8.2 (mutations in `feature-close.cjs`, `cases/feature-close.cjs` run):
- (a) MERGED check removed -> FC3 red. (b) delete-all candidates -> FC6, FC7, FC8 red. (c) tip comparison removed -> FC8 red. (d) worktree exit moved after stages/release/spec -> FC5 red. (e) `--force-discard` on the exit call -> FC5 red. (f) checked-out exclusion removed -> FC6 red (git refuses to delete that branch, exit 1; FC9's own asserts stay green because the branch survives). (g) spec-done skip removed -> FC2 red. (h) `recordRuns` limited to `pr-<n>` and the spec id -> FC16 red. (i) `pendingSharedState` removed -> FC17 red.

### Pin changes
- `check-wave11-callsites.cjs` FILES: `03-verify.md` and `06-verify.md` `{ 'verify run': 2, 'verify check': 1 }`; W11a `calls=11` -> `calls=13` (comment block extended).
- `cases-verify-scope.sh` VS3 rows for 03-verify.md and 06-verify.md: sed address `/a1-tools.cjs verify run/` -> `/a1-tools.cjs verify run.*--out/` (exactly those two lines); the Victor row is unchanged.
- `cases-parallel.sh` PG1-PG7: expected `background_checked` count 1 -> 3 (the two new `verify-bg` markers), PG5 2 -> 4. Not in the plan's pin table: these are this slice's own wave 7 cases and the count is the only change.
- a1-intent H7a/H7c, `05b-child-seal.sh`, a1-kritis-profile inventory and counts: NO red in this wave. The new fenced call is `verify run`, a command both allowlists already classify (write, excluded), and `feature close` is not named in any skill text yet (Task 9.2). They turn red in Wave 9; the classification for `feature close` is a WRITE (deletes branches, exits worktrees, edits registry, reservations and spec).

### Results
a1-verify 562/0, a1-workflow-lint 76/0, a1-gates-lint run-tests 99/0, run-wave13 and run-wave14 rc 0, a1-pr-review, a1-probe, a1-retro-validate, a1-dashboard, a1-intent (1125), a1-kritis-profile 221/0 rc 0 (run before 8.2 for intent), a1-lib-units 766/0, a1-code-scope 123/0, a1-worktree 166/0, a1-exit2-audit 36/0, a1-cli-output 33/0. Caps: facade 787, `feature-close.cjs` 285 (cap 420), `grep -c "shell: true\|execSync(\|git commit"` = 0.

### Security notes (`feature close`, `verify-bg`; for the Samuel review of PR B)
- `feature close` deletes only after step 2 proves the PR MERGED and step 3 proves the remote branch gone. Branch sweep: all verdicts first, deletions after, any gh failure deletes nothing. Rule (a) needs a merged PR entry whose `headRefOid` equals the local tip; rule (b) needs an empty `origin/<base>...<branch>` diff. Everything else goes to `kept[]`.
- Never a candidate: the current branch, the base, any branch checked out in a worktree. Branch names are checked with `git check-ref-format --branch`; refs are passed qualified (`refs/heads/...`).
- The registry entry must be of this repository, its branch must equal the merged PR head, and its path must not be the primary checkout (`worktree_mismatch`). Exit is `--mode discard`, never `--force-discard`.
- Every child runs without shell. git and CLI children get `envWithoutGitRedirects()`; `--by`, `--pr`, `--worktree` are validated before any child runs; gh comes from `A1_GH_BIN` (named on stderr).
- Background verify: marker dir under the git common dir (outside the work tree), mode 700, symlinked marker root refused, name validated against the scope regex; the pid is trusted only while `kill -0` works, the process belongs to the current user and its command is a shell or node (the recorded pid is the subshell that runs the node child, so the plan's "node process" check reads `bash`/`sh` here). Nothing in the workflow kills a pid.

### Deviations
- The plan's join and Victor wait loop test only `[ -f rc ]`; added the pid liveness check (user + command + `kill -0`) the lead asked for, so a dead background run costs seconds, not the 60-minute bound. The Victor fence also validates `verify_rc` (absolute, `a1-verify-bg` path, no `..`).
- Start fences read `<phase_name>`/`<spec-id>`/`<dir>` through quoted heredocs with the scope-regex guard; the `--phase <placeholder>` on the call line stays a raw placeholder because `check-wave11-callsites.cjs` requires that literal (the guard validated the same value).
- 06-verify.md: the start and the join sit next to each other in Step 0.6 (there is no agent spawn before the foreground run in that file), so the overlap there is small; 03-verify.md overlaps the whole Victor run.
- `feature close` runs git through `gitSafe` with `env: envWithoutGitRedirects()` (gitSafe passes opts to execFileSync). The kept reason `pr_not_merged` of D16 is unused in the sweep (it queries only `--state merged`); a closed PR's branch is reported `unmerged_commits`.
- FC fixtures use real `worktree prepare/enter` and real `phantom check --phase` gate logs instead of a hand-written registry entry (more faithful than the plan's "copied entry").

`verify run --affected --no-cache --phase 027-lean-pipeline-s4` on head c2db3b3: verdict pass, 63 of 63 commands, 0 timed out, flaky [] and pre_existing_red [], skipped_on_host []. Wall time about 29 minutes.

## PR B / Wave 9 — S path in SKILL.md and the phase workflows, `feature close` in the skill text
Completed: 2026-11-23

| Task | Status | Commit | Notes |
|---|---|---|---|
| 9.1 SKILL.md S path from `plan-steps`, 01-04 workflows, kritis `delete-after`, K1-K4, SP1-SP5 | ✓ DONE | 2b39106 | |
| 9.2 05-merge F block + heredoc PHASE, 06-verify pointer, DCMGRFP, CB1-CB2e, FLR | ✓ DONE | a259369 | |

### RED proofs (each: one edit on a scratch copy of the working tree, suite or case file run)
T9.1:
- (a) old `prompts.allowed-diff` on the new tree -> `P SKILL.md`, `P 02-specify.md`, `P 03-clarify.md` red (plus P-allowed and both D rows, 6 fails).
- (b) old `08-wiring.sh` (old D SKILL.md branch, old 03-clarify count, no 02-specify branch) on the new tree -> `D skills/a1-new-feature/SKILL.md: removed=10 added=24` red (and D 02-specify, D 03-clarify, I intent allowlist).
- (c) `gone`-row comparison removed from `delete-after` -> K1 red (`exit 0, expected 3`).
- (d) S-table row restored in SKILL.md -> `P SKILL.md` and `D SKILL.md` red.
- (e) old D 03-clarify count `37` -> `D .../03-clarify.md: removed=0 added=38` red.
- (f) D without the 02-specify branch -> `D .../02-specify.md: removed=0 added=1` red.
- (g) 02-specify inserted line reworded -> `P 02-specify.md` and `D .../02-specify.md` red.
- (h) 03-clarify inserted line deleted -> `P 03-clarify.md` and `D .../03-clarify.md: added=37` red.
- (i) old `**Size-S fast path:**` paragraph restored in 04-plan.md -> SP1 (2 asserts) and SP5 red.
- (j) `resume` dropped from `rene-discover-specify-clarify` -> SP5 (resume list) and PS3 red.
- (k) `apply-prompts-allowed.cjs` writes the current text as the applied golden -> K4 red.
- (extra) intent: `feature close` exclusion removed -> `5b-H7m` red (the only fail in the 5b-only run).
- (extra) kritis inventory: the first run on the new tree was red (`re-grepped 29 subcommands, expected 28`, set equality names `feature plan-steps`); intent: 5b-P/5b-Pn red for `feature plan-steps` until its probe args were added (first with a vault-relative path: exit 2 ENOENT, then `docs/PLAN.md`).
T9.2:
- (a) final `exit "$RC"` of the F block removed -> CB1 red (CB1 first only looked for `exit "$RC"` anywhere in the block and stayed green; tightened to the STOP line of the `feature close` call, then red).
- (b) F before G -> order case `DCMFGRP` red (+ 3 further pins on `b[3]`).
- (c) old pin (HEAD `run-tests.sh`) on the new tree -> `fenced bash blocks: 7 (want 6)`, `block order is 'DCMGR?P'`, and the old RR-guard third assert red.
- (d) new pin with the F block removed -> `fenced bash blocks: 6 (want 7)`, `block order is 'DCMGRP' (want DCMGRFP)`, CB1/CB2 red.
- (e) `"<"*` arm removed from the F `case` -> CB1 and CB2a red (the placeholder run ends `STOP: bad spec id`).
- (f) run record block back to `PHASE='<phase_name>'` -> FLR red (PWNED file written, rc 0).

### Pin changes
- kritis: `apply-prompts-allowed.cjs` new op `delete-after` + `gone`; `prompts.allowed-diff` (SKILL.md delete + two inserts, 02-specify pair, 03-clarify pair before the first existing row); `01-golden.sh` P-allowed simulation (sed range delete, `r FILE` inserts written out literally); `08-wiring.sh` D SKILL.md branch (non-blank removed and added lines compared in order, blank lines NOT pinned: GNU diff measured 10 removed / 24 added, Apple differs; audit m4), D 03-clarify `37`->`38`, new D 02-specify branch, I intent allowlist 29->30; `09-allowed-delete.sh` K1-K4.
- kritis `inventory.txt` + `01-golden.sh` counts: +`feature plan-steps` (excluded; 29, 11+11), then -`code-scope release` (06-verify.md no longer names it; 28, 10+11). The inventory never names `a1-tools.cjs feature close` in skills/a1-new-feature (the SKILL.md and 06-verify text name it without the prefix), so `feature close` needs no inventory row.
- a1-intent: `feature plan-steps` on `NEW_FEATURE_ALLOW` (reads the spec frontmatter, no write, no child); `feature close` is a WRITE and sits in the exclusions of new-feature, continue-feature and execute (`FEATURE_CLOSE`), never on an allowlist; `05b-child-seal.sh` gets the `feature plan-steps` probe args and `PEXPECT`, `5b-Pn` counts 29->30 and 95->97, new `5b-H7m`.
- a1-pr-review `run-tests.sh`: block count 6->7, classifier `F`, `DCMGRP`->`DCMGRFP`, case titles; `b[3]`, MH9a and RR_POS untouched.
- **RR-guard third assert (not in the plan's pin table):** `PHASE='<phase_name>'` in the run record block became `IFS= read -r PHASE <<'A1_PHASE_EOF'` plus the scope-regex guard (lead's carry-over). A hostile value such as `$(touch PWNED)` is now refused (`STOP: bad phase name`, exit 2, the first call already ran) instead of being passed on literally, so the old assert (2 log lines) cannot hold. Its premise "not executed, no PWNED file" is kept; it now expects rc 2, 1 log line and the STOP text. Old assert on the new tree is red (RED (c)). New `FLR` runs `x'$(touch PWNED)'` -> STOP, no file.

### Results
a1-kritis-profile 225/0, a1-lib-units 782/0, a1-pr-review 88/0, a1-probe 894/0, a1-intent (5b part alone 218/0 after the fixes; the full run before them had only the three `feature plan-steps` probe fails). Other suites and the verify run: see the end of this section.

### Deviations
- Rule 3: the 05b probe harness, the kritis intent-allowlist count and the kritis inventory needed deliberate pin updates for `feature plan-steps` (not in the plan's pin table; the plan listed only `feature close`, which no skill text names with `a1-tools.cjs`).
- The kritis inventory lost `code-scope release` (06-verify.md items 4-5 now point to `feature close`); counts 11+11 -> 10+11, total 28.
- 06-verify.md keeps the headings `3. **Merge**`, `4. **Origin cleanup**` and `5. **Done**` (a1-probe D1 pins step 3 and step 4 positions around the probe block); items 4 and 5 are one-line pointers to the single `feature close` call.
- The F block reads the PR head branch in-block (`gh pr view <n> --json headRefName`) and checks it with `git check-ref-format --branch` instead of substituting a `<branch>` placeholder into double quotes (a branch name may hold `$(...)` without spaces). The plan text named `<branch>`.
- m2 (round 3): the 04-plan fallback reads "no agent id or Rene declines". m3: the 03-clarify S line names the Step 3 marker loop, 3.5-1, 3.5-2 and the kritis jumps; the allowed-diff row moved in the same commit. m4: the D branch pins no blank-line count.
- m6 note (field owners, PLAN.md rows stay as written): the row "`observations.jsonl` deviation/blocker lines" names a1-erik-executor and the session; Victor's observation lines (his `observations.jsonl` writes during verify) are not in that row. Pablo/Wave 10 should add Victor as a writer of observation lines, or state that Victor writes none.

`verify run --affected --no-cache --phase 027-lean-pipeline-s4` on head a259369: verdict pass, selection full (`runner_or_config_changed`, facade in the diff), 63 of 63 commands, 0 timed out, flaky [] and pre_existing_red [], skipped_on_host []. Wall time about 29 minutes (02:17 to 02:46). That run covers a1-intent (full), a1-ux-studio, a1-workflow-lint, a1-gates-lint, a1-pr-merge-check, a1-lib-units, a1-verify and the others on the final tree.
Caps: facade 787/800; no module added.

## PR B / Wave 10 (T10.1)
Pre-wave HEAD 39c96b3, host load before: `0.42 0.87 0.82` (run 1 start `0.39 0.86 0.82`), after run 2: `1.33 2.69 2.11`.

ADR `docs/adr/2026-10-14-gate-invoke-and-log.md`: section `## 2026-11-23 — Bundle alias (spec 027 FR-024)` appended. The trust-model section and its "not accepted, pending owner decision" text are untouched.

| Command | Exit |
|---|---|
| `gates lint` | 0 (findings []) |
| `workflow lint --phase 027-lean-pipeline-s4` | 0 (flow 5, parallel 2, background 3, findings []) |
| `check-wave11-callsites.cjs .` | 0, `calls=13` |
| `run-wave13.sh` | 0 (10 passed, 0 failed) |
| `run-wave14.sh` | 0 (50 passed, 0 failed) |
| V14 caps loop (A + B caps) | **rc=1**: `cap: _shared/lib/gate-log.cjs` (578 lines, cap 480); every other file within cap, `checklist.cjs` unchanged |
| frozen-files diff (`.a1/verify.json`, `suite-groups.json`, `.github/`) vs origin/main | 0 |
| `checklist.cjs` diff vs origin/main | 0 |
| `run-suites.sh --check-groups` | 0 |
| `run-suites.sh` run 1 | rc=1: all 63 suites PASS (358 s); `phases check FAILED`: my own concurrent `phantom check` / `workflow lint` wrote `gate-log.jsonl` lines under `.a1/phases` during the run (self-inflicted) |
| `run-suites.sh` run 2 (nothing else running) | **0**: 63 of 63 PASS, 357 s, `phases check: .a1/phases unchanged` |

Cap finding: `gate-log.cjs` is 578 lines on this branch and on origin/main alike (`git diff origin/main` empty, so PR B did not change it). The V14 cap 480 (and the 475 recorded in Wave 5 caps) predates the R3 review-fix rounds that grew the file in PR A (e7fdac6). Not a PR B regression; the plan's cap needs a decision (raise the cap in the plan or split the module). Left open for the orchestrator/planner.

Status boxes T6.1-T9.2: all `[x]` (0 open). `phantom check .a1/phases/027-lean-pipeline-s4/PLAN.md --since origin/main`: 15 of 16 clean, 1 phantom = T3.2 (03-draft.md/04-submit.md), a PR A task already merged into origin/main, so it has no diff in the PR B range. With a wider range (`--since 39c96b3~30`) the result is `clean`, 16 checked, no phantoms. No phantom for T6.1-T9.2.

### Open owner/planner item (AUDIT m6, from Wave 9)
The field-owner row "`observations.jsonl` deviation/blocker lines" names a1-erik-executor and the session. Victor's observation lines (his `observations.jsonl` writes during verify) have no row. Pablo/Wave 10 should add Victor as a writer of observation lines, or state that Victor writes none. PLAN.md rows stay as written.
