# STATUS-verify (lane verify)

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
