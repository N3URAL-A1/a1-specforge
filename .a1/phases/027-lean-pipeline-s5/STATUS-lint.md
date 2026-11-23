# STATUS lint lane (Waves 1-2), phase 027-lean-pipeline-s5

Pre-wave HEAD: 599d1ad

## Wave 1 - Counting function and `workflow budget` module
| Task | Status | Commit | Notes |
|---|---|---|---|
| T1.1 workflow-lint-budget.cjs, workflow-budget.cjs, BG1-BG15 | DONE | b93b837 | |

RED-proof T1.1 (a) countLines as split('\n').length -> BG2 red (rc=1)
RED-proof T1.1 (b) trailer check skipped -> BG9 red (rc=1)
RED-proof T1.1 (c) malformed header treated as conditional -> BG8 red (rc=1)
RED-proof T1.1 (d) budget_unknown_skill dropped -> BG6 red (rc=1)
RED-proof T1.1 (e) scope also on budget file alone -> BG13 red (rc=1)
RED-proof T1.1 (f) lines >= budget -> BG14 red (rc=1)
RED-proof T1.1 (g) scope test removed from the CLI path -> BG15a red (rc=1)

Gates: a1-workflow-lint 97 passed 0 failed; a1-cli-output 33 passed; check-assert-deletions deleted=0; test-fidelity clean; realpath-check PASS.
verify run --affected --no-cache (head b93b837): verdict pass, selected 59 of 63; it ran ~30 min because three lanes queued on the verify lock; no lock_timeout.

## Wave 2 - Reading-path rule module
| Task | Status | Commit | Notes |
|---|---|---|---|
| T2.1 workflow-lint-read.cjs, RD1-RD9 FB1-FB6 SP1-SP5 | DONE | 9f5dc58 | |

RED-proof T2.1 (a) section boundary ignored -> RD4 red (rc=1)
RED-proof T2.1 (b) allow marker ignored -> FB4 red (rc=1)
RED-proof T2.1 (c) only fenced lines scanned -> FB6 red (rc=1; FB1-FB3 also red, they are prose-style lines)
RED-proof T2.1 (d) PER_WAVE_FILES loses 02-execute.md -> SP1 red (rc=1)
RED-proof T2.1 (e) references inside conditional files checked -> RD5 red (rc=1)
RED-proof T2.1 (f) substring counts instead of anchored regexes -> SP5 red (rc=1)
RED-proof T2.1 (g) headings detected inside fences -> RD8 red (rc=1)
RED-proof T2.1 (h) fail-closed guard removed -> RD9 red (rc=1)

Gates: a1-workflow-lint 117 passed 0 failed; a1-cli-output 33 passed; check-assert-deletions deleted=0; test-fidelity clean; realpath-check PASS.
Measured on the real tree at 599d1ad with the module (informational, the hook lands in Task 11.1): findings = 1 sync_per_wave (02-execute.md), 9 forbidden_command (a1-quick x2, a1-pr-review x2, a1-new-feature x2, a1-fix x2, a1-execute x1), budget_file_missing. All are fixed by later waves. Anchored counts match D11 (1/1 in 04-audit and 03-verify, cost run 1 in each closing file).

### Deferred pins
None. Both waves touch only new files plus run-tests.sh (owned).

### Deviations
None. Notes: `finding.rule` for the ratchet is `budget_raised:<skill>`; `raised` in the CLI JSON lists every skill whose entry grew against the base (findings only for those without the trailer); a base budget file that is not valid schema 1 exits 2 `base_budget_invalid`.

### Wave 2 verify
`verify run --affected --no-cache` on head 46964fb (code commit 9f5dc58): verdict pass, 0 flaky, 0 pre-existing red. Two earlier attempts and a third with A1_VERIFY_LOCK_WAIT_MS=900000 first ended `lock_timeout` (exit 2, lock held by another lane's verify, retro lane PID 654705): host busy, not red. The pass came on the fourth start, after ~35 min. (A1_VERIFY_LOCK_WAIT_MS accepts at most 900000.)
