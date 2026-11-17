# STATUS-verify (lane verify)

## Wave 1 — Selection module
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 verify-affected.cjs + cases-affected-unit.sh | DONE | 00ea5a4 | 206 lines; a1-verify 260 passed, 0 failed; run-tests.sh diff 1/0 |

RED-proof 1.1 rule-6 check removed -> AU2, AU10b red (rc=1)
RED-proof 1.1 HARD_FULL_PATHS emptied -> AU3 (all 6) red (rc=1)
RED-proof 1.1 selectorMatches exact-only -> AU1, AU8, AU10, AU13 red (rc=1)
RED-proof 1.1 requirer step removed -> AU10, AU10b red (rc=1)
RED-proof 1.1 ls-files scan narrowed -> AU11 red (rc=1)

### Deviations
none

## Wave 2 — `--affected` and `scope` wiring
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 runVerify seam, CLI flag, verify check refusal, cases-affected-cli.sh | DONE | 5363ee7 | a1-verify 283 passed, 0 failed (BC1/BC2 PASS); verify-run.cjs 558 lines; run-tests.sh diff vs wave 1 is +1/-0 |

RED-proof 2.1 affected+base guard removed -> AC8b, AC9 red (rc=1)
RED-proof 2.1 --out accepted -> AC8a red (rc=1)
RED-proof 2.1 scope check removed -> AC12a, AC12c red (rc=1)
RED-proof 2.1 scope check refuses missing scope -> AC12b, BC1 red (rc=1)
RED-proof 2.1 applyEnvRed settled ids only -> AC10 red (rc=1)
RED-proof 2.1 runPlan unused for headCommands -> AC1, AC1b, AC10, AC11 red (rc=1)

### Deviations
none (probe files of the AC fixtures live outside the project dir, next to it as `$P.probe`, so the tree stays clean and AC11 sees a cache miss rather than `dirty`)

## Wave 3 — Report copy and `verify reuse`
Completed: 2026-11-17

| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 verify-reuse.cjs, tree_clean, changedOutsideA1, CLI route, cases-reuse.sh | DONE | 6dc69a5 | a1-verify 329 passed, 0 failed (E3b/E3c, BC1/BC2 PASS); verify-reuse.cjs 188 lines, verify-run.cjs 560; full bin/run-suites.sh 61/62 green, a1-intent red only on accepted ids (X11 B22 B23 B6d B19g-i B24 B25 T5 T10 T21 T22 SM4, subset of ACCEPTED-RED); a1-vault-cockpit green; gates lint and workflow lint clean |

RED-proof 3.1 (a) checkReuse scope check removed -> RU4b red (rc=1)
RED-proof 3.1 (b) tree check removed -> RU6a, RU15 red (rc=1)
RED-proof 3.1 (c) statSync instead of lstatSync -> RU8 red (rc=1)
RED-proof 3.1 (d) copy written with --base too -> RU10 red (rc=1)
RED-proof 3.1 (e) prune keeps everything -> RU9 red (rc=1)
RED-proof 3.1 (f) findCandidate HEAD only -> RU4a, RU13, RU14, RU15, RU15b red (rc=1)
RED-proof 3.1 (g) changedOutsideA1 check skipped -> RU4a, RU14 red (rc=1)
RED-proof 3.1 (h) directory mode check removed -> RU17b red (rc=1)

### Deviations
- `verify reuse` is not a registered gate, so the facade does not strip `--phase`; the fixture helper calls it without `--phase` (the plan's gate-call rule does not apply to it).
- No observation written (no Rule 1-4 deviation).

## Wave 4 — Tracer and map generator
Completed: 2026-11-17

| Task | Status | Commit | Notes |
|---|---|---|---|
| 4.1 verify-affected-map.cjs, bin/affected-trace.sh, CLI route, cases-affected-map.sh | DONE | 5b21154 | a1-verify 366 passed, 0 failed (AM1-AM8 incl. AM5b no-.git and AM7 real strace run; BC1/BC2, E3b/E3c PASS); verify-affected-map.cjs 344 lines; affected-trace.sh 92 lines; `verify affected-map --list-ids` = 62 = 61 run*.sh + 1 parser runner; gates lint and workflow lint clean |

RED-proof 4.1 (a) cwd tracking dropped (state.get(pid) removed) -> AM1c, AM1h red (rc=1)
RED-proof 4.1 (b) listing rule widened (listedJoins always true) -> AM3, AM3b, AM3e, AM3f red (rc=1)
RED-proof 4.1 (c) --traces accepts a red trace -> AM4b red (rc=1)
RED-proof 4.1 (d) checkMap skips selectors -> AM5, AM5b red (rc=1)
RED-proof 4.1 (e) --check without the disk fallback -> AM5b, AM5c red (rc=1)

Full bin/run-suites.sh: 60/62 green on the first run. a1-vault-fallback L2b was mine (bare mktemp in affected-trace.sh), fixed with explicit templates, suite 24/0. a1-intent red: accepted ids plus T7 (full run, load 2-3) and B9 (isolated rerun, load 1.8); T7 passed and B9 passed in the other run, neither touches lane files. a1-vault-cockpit green.

### Deviations
- Empty-set keys (a key no suite reads) are omitted from the map (D4 forbids an empty selector list), so such a path selects the full set. Wave 9 may decide to map them to smoke.
- `--traces` takes alwaysIds from the red ids named in --allow-red; trace logs (<id>.log) are written next to the .paths files.
- The tracer takes its tools from the repo that holds bin/affected-trace.sh and traces --root (needed for the planted AM7 project).
- No observation written (no Rule 1-4 deviation).
