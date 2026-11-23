# STATUS — lane xprov (phase 027-lean-pipeline-s5)

## Wave 5 — xprov help topics, opt-in log, reader check
Completed: 2026-11-23

| Task | Status | Commit | Notes |
|---|---|---|---|
| T5.1 `xprov --help <topic>` | DONE | 2e9dcf9 | HT1-HT10 green |
| T5.2 opt-in PLAN-REVIEW-LOG.md, reader check, `recovery` field | DONE | 7be1446 | OL1-OL11 green |

### Measurements
- HT10 longest prose line: 120 characters (limit 140); longest command line: 144 (limit 150).
- Line counts: help-xprov.cjs 541 (cap 620), help-xprov-consent.cjs 219 (cap 260), help-xprov-topics.cjs 107 (cap 220), xprov.cjs 451 (cap 460), xprov-observe.cjs 208 (cap 210), xprov-gate.cjs 736 (cap 740), xprov-run.cjs 918 (cap 918, unchanged), optin-logs.cjs 40 (cap 80).
- a1-xprov all shards: 4325 passed; the only 12 reds were the new part 41 (Task 6.1 RED run, kept out of the commit); part 29 OB1-OB9 unchanged.
- Gates: `bin/check-assert-deletions.sh --base 599d1ad` deleted=0; `test-fidelity` clean; `realpath-check` PASS; a1-cli-output 33/0; a1-lib-units 804/0.
- Per-wave verify (`verify run --affected --no-cache`): verdict pass, rc=0, lock held 282 s (busy host, no `lock_timeout`).

### RED proofs
- RED-proof 5.1 (a) topic branch catches `--help` without a topic -> HT6 red
- RED-proof 5.1 (b) waiver topic mixed with consent text -> HT2 red
- RED-proof 5.1 (c) topics not interpolated into XPROV_HELP -> HT7 red (4 lines)
- RED-proof 5.1 (d) self-recovery sentence moved verbatim from 04b -> HT8 red
- RED-proof 5.1 (e) lines 324-325 of help-xprov.cjs unchanged -> HT9 red (2 lines)
- RED-proof 5.1 (f) one routing line re-joined past 140 characters -> HT10 red
- RED-proof 5.2 (a) xprov-gate appendLog check removed -> OL1 red
- RED-proof 5.2 (b) keepReviewLogs accepts any non-empty value -> OL3 red
- RED-proof 5.2 (c) harness export removed -> R2c (part 06) red
- RED-proof 5.2 (d) MENTIONS_ALLOWED gains an agents/ entry -> OL5 red (2 lines)
- RED-proof 5.2 (e) runFields without recovery -> OL7 red
- RED-proof 5.2 (f) whole-file allowlist match -> OL8 red (2 lines)
- RED-proof 5.2 (g) action enum check removed -> OL9 red
- RED-proof 5.2 (h) compactRecovery passes unknown actions -> OL10 red
- RED-proof 5.2 (i) compactRecovery drops fallback -> OL11 red
- New-case first red run (before the code): 16 reds in part 39 (HT1-HT9), 31-25 reds in part 40 (OL1, OL3, OL7, OL9-OL11 on the code side).

### Deviations
- [Rule 3] The a1-xprov harness hook blocks shell heredocs that contain the literal terminal-only owner command names. The topic text, part 41 and the 04b template were therefore written with the Write tool; no behaviour change.
- The `optin-logs.cjs` file is excluded from the reader scan itself (it is the allowlist definition); stated in the script header and in `check-optin-readers.cjs`.
- `MENTIONS_ALLOWED` currently lists today's lines of the a1-plan SKILL.md (49, 81) and of 04b (115, 342) as the plan allows; Task 6.1 re-measures them.

### Deferred pins
- none
