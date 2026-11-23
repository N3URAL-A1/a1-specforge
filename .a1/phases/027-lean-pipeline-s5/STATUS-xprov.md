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
- New-case first red runs (before the code): part 39 HT1-HT9 red (rc=2 on every topic, `a1-tools --help` without the topics); part 40 OL1, OL3, OL7, OL9, OL10, OL11 red.

### Deviations
- [Rule 3] The a1-xprov harness hook blocks shell heredocs that contain the literal terminal-only owner command names. The topic text, part 41 and the 04b template were therefore written with the Write tool; no behaviour change.
- The `optin-logs.cjs` file is excluded from the reader scan itself (it is the allowlist definition); stated in the script header and in `check-optin-readers.cjs`.
- `MENTIONS_ALLOWED` currently lists today's lines of the a1-plan SKILL.md (49, 81) and of 04b (115, 342) as the plan allows; Task 6.1 re-measures them.

### Deferred pins
- none

## Wave 6 — 04-audit trigger step and 04b at most 80 lines
Completed: 2026-11-23

| Task | Status | Commit | Notes |
|---|---|---|---|
| T6.1 permit-check step, 04b cut, Phase 4b mentions | DONE | b9d318b (+ fix commits 165242f, 41aca21) | PR1-PR6 green |

### Measurements
- 04b: 80 lines, 8944 bytes, no line over 300 characters (default `awk` and `LC_ALL=C awk`). Was 358 lines, 26802 bytes.
- Files touched: `skills/a1-plan/workflows/04-audit.md`, `04b-xprov-review.md`, `skills/a1-plan/SKILL.md`, `skills/a1-execute/workflows/01-load.md`, `_shared/lib/optin-logs.cjs` (MENTIONS_ALLOWED re-measured), `_shared/lib/help-xprov-topics.cjs` (routing topic gained the design-file secret-hit sentence moved out of 04b Step 1b).
- `bin/check-optin-readers.cjs --name PLAN-REVIEW-LOG.md` exit 0 on the real tree; `--name .last-run.json` exit 1, readers include 04b and 01-load.
- Suites run after the edits: a1-xprov all shards 4338/0 (before the T10 fix) and shard b 1793/0 after it; a1-dashboard 423/0; a1-retro-validate 67/0; a1-workflow-lint 76/0; a1-metrics 476/0; a1-intent 1128/0; roadmap-gate 14/0; run-wave13 10/0; run-wave14 50/0; check-wave11-callsites calls=15; `gates lint` findings []; `workflow lint` findings []; verify-install-sync PASS.
- Gates: `check-assert-deletions --base 599d1ad` deleted=0; `test-fidelity --diff-base 564f981` not_applicable (no source file in the diff); `realpath-check` PASS.
- Per-wave verify (`verify run --affected --no-cache`, 63 commands): verdict pass. Three earlier attempts: two `lock_timeout` (host busy: other lanes hold the one verify lock, 900000 ms wait cap), one red `a1-xprov/run-tests-b.sh` (T10 RED, see deviations); re-run on the fixed head passed with lock_wait_ms 11.

### RED proofs
- RED run of the new cases before the change: part 41 against the old 04b and old 04-audit: PR1 (4 lines), PR2 (4 lines), PR3, PR3, PR4, PR5 red; PR6 was already green (denied repo accepts without `xreview/`, an existing behaviour that the new reading path relies on).
- RED-proof 6.1 (a) 04b with 81 lines -> PR1 red
- RED-proof 6.1 (b) permit-check fence after the first 04b line -> PR3 red
- RED-proof 6.1 (c) RQ_SENTENCE dropped -> PR2 and RQ8 (part 19) red
- RED-proof 6.1 (d) 01-load.md keeps `04b-xprov-review.md` -> PR5 red
- RED-proof 6.1 (e) the `exit 2; fi` line of 04b step 1b rewritten to `break; fi` -> T10 red

### Deviations
- [Rule 1] My first 04b draft replaced the prose `only exit 2 stops` in Step 1b. The existing case T10 RED (`sed 's/exit 2; fi/break; fi/'`, expects `exit2:1 break:1`) needs a second `exit 2` literal in that section, so it went red in `run-tests-b.sh` (T10 RED: `got=...exit2:0 break:1`). Fixed by restoring the prose in 41aca21; no assert edited. The PLAN RED-proof (e) is therefore run as the `break; fi` rewrite (the form T10 itself uses), not as `exit 1; fi`.
- [Rule 3] Two skill pointers that the plan did not list word for word were adapted: `01-load.md` line 47 reads `(a1-plan Phase 4b, \`xprov --help routing\`)` and line 92 reads `Phase 4b Step 5 (\`xprov --help waiver\`)`; a1-plan `SKILL.md` lines 49, 65, 81 and 110 follow the plan.
- 04b keeps item 4 of Step 1.0 (never run a terminal-only owner command, never write `.a1/xprov.json`) as one sentence next to the intent-run sentence, in addition to the moved `consent` topic.
- 04b Step 2 merges the two `fail` rows into one `warning` / `blocking` row and Step 4 / Step 5 share one heading, to stay at 80 lines; Step 5 text lives in the `waiver` and `edge-cases` topics. The Step 1b retro line, the pass/fail bullets and the `not_applicable` line stay.

### Deferred pins
- none
