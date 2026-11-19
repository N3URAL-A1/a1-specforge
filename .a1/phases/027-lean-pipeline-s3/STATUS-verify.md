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
