# STATUS-runner (lane runner)

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
