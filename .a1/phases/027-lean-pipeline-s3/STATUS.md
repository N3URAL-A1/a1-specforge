# STATUS — 027-lean-pipeline-s3

Consolidated from STATUS-verify.md (waves 1-2), STATUS-runner.md (waves 3-4) and STATUS-lint.md (wave 5) after all three lanes merged into feature/027-lean-pipeline-s3 (lint 0d390e9, runner cda670d, verify 1afec81). Waves 6-9 run sequentially on this branch.


## Wave 1 - Lazy base under merge-check
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 Head-first lazy base, spawn seam, merge-check opt-in | DONE | 594f0a9 | a1-verify 414 passed, a1-pr-merge-check 251 passed |

RED-proof 1.1 (a) lazy forced false -> LZ1, LZ1b red (rc=1)
RED-proof 1.1 (b) need = all base commands -> LZ1, LZ1b red (rc=1)
RED-proof 1.1 (c) need without kind term -> LZ4b, LZ5 red (rc=1)
RED-proof 1.1 (d) lazyBase removed from pr-merge-check.cjs -> ML1b red (rc=1)
RED-proof 1.1 (e) retry before base run -> LZ2c red (rc=1)

Numstat deletion check: deleted=0 rc=0. verify-run.cjs: 609 lines.

### Deviations
- Record cache.base is 'off' (not 'none') on the lazy path even when no base ran, because F1 pins `off|off` for merge-check.
- New case files export A1_VERIFY_LOCK_DIR per case already (lock module arrives in Wave 2); the real-lock leak assert is deferred to Wave 2 because no lock exists yet.

## Wave 2 - CLI lock
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 verify-lock.cjs, runVerify hook, token export, merge-check field | DONE | a11d057 | a1-verify 436 passed, a1-pr-merge-check 259 passed; a1-disposition, a1-exit2-audit, a1-metrics, a1-probe green |

RED-proof 2.1 (a) token not in runEnv -> LK8, LK11, LK11b red (rc=1)
RED-proof 2.1 (b) nested branch removed -> LK4, LK11, LK11b red (rc=1)
RED-proof 2.1 (c) dead-PID takeover removed (+ default ceiling 3 s) -> A1..M3 red because a stale dead-owner lock is no longer taken over (rc=124 at the 170 s bound; first run without the shortened ceiling hung on it)
RED-proof 2.1 (d) cmd comparison removed -> LK6 red (rc=1)
RED-proof 2.1 (e) wait loop returns at once -> A1, A1b, A2, A4b, A5, A6 .. red (contended real lock, no wait) (rc=1)
RED-proof 2.1 (f) lock acquired at top of mergeCheck -> hang (self-deadlock on the held lock), killed at the 400 s bound = red (rc=124); MLK1 itself not reached
RED-proof 2.1 (g) lock before resolveCommands -> hang/killed at bound = red (rc=124); LK12 not reached in time

Numstat deletion check: deleted=0 rc=0. verify-run.cjs 620 lines, verify-lock.cjs 186 lines.

### Deviations
- Real-lock leak assert lives in new `_test-fixtures/a1-verify/leak-assert.sh` (sourced by every new case file, both suites; lk_leak_start/lk_leak_end) and was added to Wave 1's cases-lazy.sh files too (no existing assert touched).
- RED-proof (c), (f), (g): the mutation hangs (900 s default ceiling) so the case is killed at the bound; counted red per the plan rule, case-level attribution only for (a), (b), (d). Killing left one dead-owner real lock dir, which was removed after its owner PID was confirmed dead.
- Full run-suites.sh gate not run in this lane wave (D12 per-worker lock dir lands in the runner lane, Wave 4); instead all six suites that execute verify run/merge-check were run individually and are green.

### Wave 2 follow-up: attributed RED-proofs (narrowed harness, only cases-lock.sh sourced, git-archive copy)
Fixture fix (new lines only): every lock case now runs with A1_VERIFY_LOCK_WAIT_MS=5000 by default (vl_env), LK2 with 3000, so a mutation turns into lock_timeout instead of a 900 s hang. Controls without mutation: a1-verify narrowed 20 passed, a1-pr-merge-check narrowed 6 passed.
RED-proof 2.1 (c) dead-PID takeover removed -> LK2, LK2b, LK6 red (rc=1)
RED-proof 2.1 (f) lock acquired at top of mergeCheck -> MLK1, MLK2, MLK3 red (rc=1)
RED-proof 2.1 (g) lock before resolveCommands -> LK12, LK12b red (plus LK1-LK11 self-deadlock red) (rc=1)
Six suites rerun: a1-verify 436, a1-pr-merge-check 259, a1-disposition 128, a1-exit2-audit 36, a1-metrics 476, a1-probe 894, all 0 failed. Real lock dir absent afterwards.

### Wave 2 defect: gate-1-build stall of a1-verify under an outer verify run
Reproduced nested with an outer process that takes the real lock like `verify run` and exports the token (scratchpad outer.cjs): a1-verify stalled after `LZ6`, i.e. at case LZ7.
Cause: `lz_run` (cases-lazy.sh) ran `unset A1_VERIFY_LOCK_TOKEN` in the suite shell, so LZ7 (CLI `vrun --base --no-cache`, no own lock dir) no longer matched the outer owner and waited on the real lock held by the outer run. Same pattern in `ml_run` (a1-pr-merge-check cases-lazy.sh), `vl_env`/`vl_clear` and `mlk_env`/`mlk_clear`.
Fix (new lines only): leak-assert.sh keeps the outer token (`lk_token_reset` restores it); the four helpers call it instead of `unset`.
New assert (`<label> outer A1_VERIFY_LOCK_TOKEN kept in the suite shell`, in lk_leak_end, with a sentinel token when no outer one exists, so it also bites standalone).
RED-proof: `vl_clear` reverted to `unset ... A1_VERIFY_LOCK_TOKEN` -> `LK a case dropped or changed the outer A1_VERIFY_LOCK_TOKEN` red (rc=1, 20 passed 1 failed).
Nested (outer holds real lock + token), all six suites green: a1-verify 438 (134 s), a1-pr-merge-check 261, a1-disposition 128, a1-exit2-audit 36, a1-metrics 476, a1-probe 894.
Gate `verify run --affected --phase 027-lean-pipeline-s3`: verdict pass, 33 commands, red none, lock held, lock_wait_ms 12, total 1592320 ms. Numstat deleted=0.


## Wave 3 — Runner contract
| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 --contract, --json-out, --groups-file, check states | DONE | c7a508e | bin/run-suites.sh 767 lines (cap 775) |

RED-proof 3.1 a (contract text) -> J1a red (rc=1)
RED-proof 3.1 b (leak not passed) -> J2e red (rc=1)
RED-proof 3.1 c (rs_load_groups back to RS_ROOT) -> G1a red (rc=1)
RED-proof 3.1 d (rs_load_nocount back to RS_ROOT) -> G2a/G2b red (rc=1)
RED-proof 3.1 e (existing-file check removed) -> J3a/J3b/J5 red (rc=1)

### Deviations
- [Rule 3] The contract line is printed via `printf '%s-contract 1\n' "a1-suite-runner"` instead of one literal: part 06 K2b (unchanged assert) counts code lines containing `a1-suite-runner-` across bin/run-suites*.sh and requires exactly 1.
- [Rule 1] Part 17 used GNU `stat -c`; a1-vault-fallback L1/L1b (portability lint) went red in the full run. Replaced by a node mode read, commit db2524c.
- Full regression gate: `bash bin/run-suites.sh` after the fix: only a1-vault-fallback was red, rerun alone 24 passed, 0 failed.

## Wave 4 — Lock wait, watchdog, per-worker verify lock dir
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 4.1 --lock-wait, --suite-timeout-ms, D12 | DONE | f5ebfeb | run-suites.sh 771 (cap 800), run-suites-proc.sh 569 (cap 600) |

RED-proof 4.1 a (wait branch skipped) -> W1a/W1c/W1d red (rc=1)
RED-proof 4.1 b (deadline never reached) -> W3a/W3b/W3d red (rc=1)
RED-proof 4.1 c (rs_watchdog not called) -> WD1a/WD1b/WD1c red (rc=1)
RED-proof 4.1 d (KILL escalation removed) -> WD2a/WD2b red (rc=1)
RED-proof 4.1 e (D12 unconditional) -> WD5d red (rc=1)

### Deviations
- none. rs_parse_ms takes an optional 4th arg (divisor) so the ceil-seconds conversion stays on one call line.
- Full regression gate: bash bin/run-suites.sh, rc=0, no red suite.

## Wave 5 — Quiet-host poll text, lint rule, gate exit-2 routing (lane lint)
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 5.1 FR-017 text, quiet-host-poll rule, D19 routing | DONE | see git log (feat(027-lean-pipeline-s3): wave 5) | a1-workflow-lint 36/0, a1-pr-review 59/0, a1-gates-lint 90/0, calls=15, workflow lint rc 0, no pgrep in skills/, full bin/run-suites.sh rc 0 |

RED-proof: (a) rule unwired -> QH2 red; (b) fence restricted to bash -> QH2 red; (c) sh load fence deleted -> a1-pr-review "non-bash fences" red; (d) D19 branch removed from 02-execute.md -> QH7 red. All restored.

### Deviations
None.

## Lane merges (orchestrator)

| Lane | Merge commit | Check after merge |
|---|---|---|
| lint (wave 5) | 0d390e9 | tree identical to the lint lane (gate-1-build pass, 60 suites) |
| runner (waves 3-4) | cda670d | full `verify run`: pass, 63 commands, red none |
| verify (waves 1-2) | 1afec81 | full `verify run`: pass, 63 commands, lock held, lock_wait_ms 12; `bin/run-suites.sh`: rc 0, 325 s |

Orchestrator gate finding, wave 2: gate-1-build red (a1-verify SIGKILL at 427 s under an outer lock holder, 113 s standalone). Root cause LZ7 + five helpers unset the outer A1_VERIFY_LOCK_TOKEN; fixed in 70c5299 with a guard assert (RED-proved). Deletions vs slice base a40a85f in both FR-012 suite dirs: 0.

## Wave 6 — Runner-path module: preparation and result reading
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 6.1 verify-runner-path.cjs, isRetryable export, RC1-RC10 | DONE | 4afc91c | module 227 lines (cap 450); 46 new asserts; deletions vs a40a85f in both FR-012 suite dirs: 0; full bin/run-suites.sh rc 0 (326 s) |

Tests: `_test-fixtures/a1-verify/cases-runner-contract.sh` (sourced from run-tests.sh) drives `check-runner-contract.cjs` (node, planted repos and JSON files). RC10 (runSide with a fake spawnGroup) is an addition to the plan's RC1-RC9.

RED-proof 6.1 a (set comparison removed) -> RC5b, RC5c, RC5i, RC10g red
RED-proof 6.1 b (lstat -> stat) -> RC5k red
RED-proof 6.1 c (exit-1 consistency rule removed) -> RC6a red
RED-proof 6.1 d (contract compare -> startsWith) -> RC4b red
RED-proof 6.1 e (cap removed from runnerCeilingMs) -> RC9b red

### Deviations
- None against rules 1-4. Choices: `readRunnerResult` returns `{results, lockWaitMs, checks}`; `runSide` additionally returns `checks`; top-level and result key sets are exact (the single writer emits exactly those). `commandReason` leak_note branch is left to Wave 7 (its task 7.x lists it); not wired into runVerify or merge-check.

## Wave 7 — Runner path inside `runVerify`
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 7.1 runnerSides, selectSides, leak_note, runner_source/runner, RP1-RP15 | DONE | d40ef87 | verify-run.cjs 691 lines (cap 800); a1-verify 509/0, a1-pr-merge-check 261/0; deletions vs a40a85f in both FR-012 suite dirs: 0 |

Tests: `_test-fixtures/a1-verify/cases-runner-path.sh` (sourced from run-tests.sh) plus `fake-runner.sh` (same dir; the fake base runner, modes mirror/drop-one/extra/leak-first/red-first/symlink/exit2, applies to the sides in `A1_FX_RUNNER_SIDES`, default head). Every run uses its own `A1_VERIFY_LOCK_DIR`, `A1_SUITE_LOCK_DIR`, `A1_VERIFY_LOCK_WAIT_MS=5000`; the outer token is dropped for the child only (`env -u`), the suite shell keeps it (lk_leak_end asserts it).

RED-proof 7.1 a (prepareRunner replaced by the head snapshot's bin/) -> RP2b, RP3, RP4, RP4b, RP5 red
RED-proof 7.1 b (--groups-file points at the head root) -> RP3 red
RED-proof 7.1 c (fallback throws) -> RP4, RP4b, RP5 red
RED-proof 7.1 d (leak_note branch removed) -> RP7, RP13 red
RED-proof 7.1 e (runner exit 0 forces all green) -> RP9 red
RED-proof 7.1 f (base need = every id) -> RP1, RP1b, RP11b red
RED-proof 7.1 g (D18 stderr mapping removed) -> RP8 red
RED-proof 7.1 h (rp.release() removed) -> RP15 red (first attempt: green, because cleanupOnExit removes the dir before a shell-side check; the case now lists TMPDIR inside the node process right after runVerify returns)

### Deviations
- None against rules 1-4. Choices: `runVerify` stays long (side selection moved to `selectSides`, but the function is still over 50 lines as before; the 50-line aim was not reachable without reshaping unrelated code). `runner` is only recorded on the lazy path; with `opts.runner` but no lazy order the record has no `runner_source`. Fallback `runner` object is `{fallback, why, contract: null, sides: null}`. `runner.sides.<side>.requested` is the id count. `base_run.ran` on the runner path lists the ids actually run on base (ids absent at base are not run). A head plan with no commands falls back as `not_eligible` ("no commands") so the runner is never called without selectors. RP9 uses `A1_FX_RUNNER_SIDES="head retry"` (a green retry would make the result `new_flaky`).
- Left for Wave 8: merge-check passes `runner: true`; retry-order/watchdog/env-equality proofs; help and registry; the sides' `requested` is a count, not ids.

## Wave 8 — Retry order, watchdog, env equality, lock wait; merge-check wiring and docs
Completed: 2026-11-19

| Task | Status | Commit | Notes |
|---|---|---|---|
| 8.1 merge-check `runner: true`, RR1-RR6, MR1-MR4, help, registry | DONE | 1a6e18e | a1-verify 522/0, a1-pr-merge-check 269/0, a1-cli-output 33/0, a1-gates-lint 90/0, a1-workflow-lint 36/0; deletions vs a40a85f in both FR-012 suite dirs: 0; verify-run.cjs 691 (cap 800), verify-runner-path.cjs 227 (cap 450) |

Tests: `_test-fixtures/a1-verify/cases-runner-retry.sh` (sourced after cases-runner-path.sh; own `rr_run` with a portable 120 s kill bound, `rr_holder` = live fake runner owning A1_SUITE_LOCK_DIR) and `_test-fixtures/a1-pr-merge-check/cases-runner.sh` (own `mr_repo`/`mr_mc`). Every run has its own A1_VERIFY_LOCK_DIR, A1_SUITE_LOCK_DIR and a bounded wait; the token is dropped for the child only (`env -u`) or restored by `lk_token_reset`; both files end with the real-lock leak assert.

RED-proof 8.1 a (retry runner call placed before the base call) -> RR2b red (order runner:head,runner:retry,runner:base). First attempt hit the wrong `const tBase` (lazyHeadSide) and crashed the whole suite; redone against runnerSides.
RED-proof 8.1 b (--suite-timeout-ms dropped from the runner argv) -> RR1 red (hang runs to the 120 s kill bound)
RED-proof 8.1 c (base side given an extra env var) -> RR4b red
RED-proof 8.1 d (`runner: true` removed from mergeCheck) -> MR1, MR2, MR3, MR3b red
RED-proof 8.1 e (--lock-wait passed as 0) -> RR5, RR5b, RR6, RR6b red
RED-proof 8.1 f (runner side waits not added to the top-level lock_wait_ms) -> RR5 red

### Deviations
- [Plan text] `gates lint` has no `--phase` flag (exit 2 usage); ran `node _shared/a1-tools.cjs gates lint` (rc 0, 51 rows, no findings).
- None against rules 1-4. `runner.sides.<side>.requested` stays an id count; neither the merge-check report nor the proofs need ids. The merge-check report adds `runner_source`, `runner`, `base_run` (null when absent) under `suites`.
- Docs edits: help-verify.cjs (one paragraph), help-merge-check.cjs (4 lines), gates-registry.md (rows pr-merge-check, gate-1-build, workflow-pipeline-exit); no new gate id.

Wave 8 gates: `bash bin/run-suites.sh` rc 0 (366 s); `verify run --affected --phase 027-lean-pipeline-s3`: verdict pass, 63 commands, red none, lock held, lock_wait_ms 13, total 1706230 ms.
