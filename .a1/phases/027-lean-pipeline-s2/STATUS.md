# STATUS — 027-lean-pipeline-s2

Consolidated from STATUS-verify.md (waves 1-4), STATUS-lint.md (waves 5-6) and STATUS-runner.md (waves 7-8) after all three lanes merged into feature/027-lean-pipeline-s2. Waves 9-10 run sequentially on this branch.


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

## Wave 5 — Help text, call sites, P2, registry (lane lint)
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 5.1 Document and wire --affected and verify reuse | DONE | c528949 | all action-8 checks exit 0 |

### Deviations
- Plan action 8 says `gates lint --phase ...`; the subcommand rejects --phase (exit 2). Ran `gates lint` without it: exit 0, no findings.

## Wave 6 — Workflow-lint rules (lane lint)
Completed: 2026-11-16

| Task | Status | Commit | Notes |
|---|---|---|---|
| 6.1 Rules verify-scope and verify-reuse-ban | DONE | 04aff23 | workflow-lint suite 29/0; real tree verify_scope_checked 5, reuse_ban_checked 2 |

RED-proof: (a) PER_WAVE group dropped -> VS2 red; (b) substring --affected -> VS8 red; (c) agents/ presence condition dropped -> W11 red (+VS4); (d) REUSE_RE without verify-reuse -> VS5b red.
Full run-suites: a1-intent 12 failed (subset of accepted set); no other failure seen in the tail. run-tests.sh diff: 3 added, 0 deleted.

Wave 6 fix: GNU-only sed -i removed from cases-verify-scope.sh (vault-fallback L1b) — 0328d5a. workflow-lint 29/0, vault-fallback 24/0.

RED-proof 7.1 revert-glob -> a1-vault-cockpit (H_LOCKS unbound) red (rc=1)
✓ Task 7.1 — b676728 — 15:13
RED-proof 7.2 (a) export guard removed -> L2b red (rc=1)
RED-proof 7.2 (b) extra-job call accepted without --locale-native -> E4 red (rc=1)
RED-proof 7.2 (c) .git refusal removed -> E11a red (rc=1)
RED-proof 7.2 (d) needs: check removed -> E9 red (rc=1)
RED-proof 7.2 (e) "rest" ignores other jobs' explicit ids -> E10b red (rc=1)
RED-proof 7.2 (f) exactly-once check removed -> E16a/b/c red (rc=1)
RED-proof 7.2 (g) A1_XPROV_ONLY ban removed -> E17a/b red (rc=1)
RED-proof 7.2 (h) ci_job_workers ignored -> E18a red (rc=1)
✓ Task 7.2 — e67e1e2 — 15:25
RED-proof 7.3 (a) 05 in XP_SHARD_B and XP_SHARD_C -> harness overlap check red (rc=1)
RED-proof 7.3 (b) run-tests-d.sh added -> runner-file assert red (rc=1)
RED-proof 7.3 (c) run-tests-c.sh calls --shard b -> exact-call-line check red (rc=1)
✓ Task 7.3 — 37879dd — 15:45

## Wave 7 — Harness glob and runner options (lane runner)
Tasks 7.1 b676728, 7.2 e67e1e2, 7.3 37879dd. xprov shards measured with `--workers 3` (load ~2): a 210 s, b 214 s, c 209 s; 35 parts, each once.
Full suite: only a1-intent (subset of accepted set) and a1-suite-runner red. vault-cockpit green (860, both locales).
BLOCKER: a1-suite-runner D3a (parts/01-discovery.sh:45) asserts suite-groups.json has exactly keys ci_jobs,no_count,serial,timings. ci_job_workers (7.3) makes it red; Wave 8 adds ci_extra_jobs, snapshot_incompatible. No-assert-change rule forbids the edit -> needs orchestrator/owner decision.
RED-proof 7.3-D3a ci_job_workers removed from the real suite-groups.json (scratch) -> D3a red
✓ D3a exact-key-set assert updated (owner exception) — 7507e11 — a1-suite-runner isolated: 569 passed, 0 failed (K5a was a flake)
Wave 7 COMPLETE. Wave 8 must extend D3a with ci_extra_jobs,snapshot_incompatible.

## Wave 8 (lane runner)
Task 8.1 92c6752 (suite-groups.json ci_extra_jobs + snapshot_incompatible, 5 CI jobs, D3a now exact seven-key set), Task 8.2 eb81847.
check-groups: ok, 63 suites in 2 ci jobs. test.yml diff: 0 removed lines; 5 --extra-job calls; a1-xprov 1056/0; a1-suite-runner 569/0; a1-pr-merge-check 242/0 (CU0-CU15 pass); pr-ci-evidence.cjs diff empty.
Shard selections: xprov-a [a1-xprov/run-tests.sh], xprov-b [run-tests-b.sh], xprov-c [run-tests-c.sh], heavy [a1-intent, a1-ux-studio], rest = "rest".
RED-proof 8.2 (a) unchanged line removed from decide (scratch) -> CU1..CU7 red
RED-proof 8.2 (b) pathsChanged false for prefix-entry lists (scratch) -> CU1..CU7 and CU9 red
Full suite: only a1-intent red (13 fails first run incl. T7, load 9); isolated rerun 12 fails, all within ACCEPTED-RED.
Wave 8 COMPLETE.

## Lane merges (orchestrator)

| Lane | Merge commit | Base check after merge |
|---|---|---|
| lint (waves 5-6) | 08cb31d | verify run: red only a1-intent + a1-vault-cockpit (accepted); a1-intent 1107/12, outside [] |
| runner (waves 7-8) | a4184f2 | verify run: red only a1-intent; a1-vault-cockpit green; a1-intent 1107/12, outside [] |
| verify (waves 1-4) | f5591fd | verify run: red only a1-intent; a1-vault-cockpit green; a1-intent 1109/10, outside [] |

Load flakes (a1-intent, outside ACCEPTED-RED, all green on a quiet-host rerun): T19 (wave 1; wave 8 twice at load 7.5/8.3, green at load 1.0), T13 and B9 (wave 3), T7 and B9 (wave 4). Load came from other sessions on the host. ACCEPTED-RED.md unchanged.

## Wave 9 — Trace, generate, config, real-tree fixtures
Completed: 2026-11-17

Step 1 (owner-approved deviation, GOAL.md Decisions 2026-11-17): `bin/affected-trace.sh` ends a trace at the suite's own exit (wrapper writes a marker file; strace gets TERM and detaches, leaked tracees of our own strace are killed by PID), `--suite-timeout` (default 1800 s) reports a suite over the limit as status 124 + `timeout:` line + exit 1 (never mapped; generator gives `trace_red`), `--only <id,...>` for single-suite re-traces. Commit b1ad796, follow-up (portable bounded run in AM9, AM7/AM9 skip when the suite is itself traced, `--only` cases AM7d/AM7e) in the next commit.
RED-proof 9.0 wait change reverted (scratch) -> AM9 red (rc=124), AM9c red
Trace: 63 suites, `--jobs 8`, 2393 s wall-clock (incl. serial re-runs of red ids), load5 before 0.26, after 1.60. No leaked `a1-tools-as.cjs` watcher survives (checked after the runs: none).
Reds after serial re-run: a1-intent (known env-red, 13 fails, allow-red), a1-suite-runner (X3/X4 SIGINT within 10 s, deterministic under strace; allow-red, OWNER QUESTION), a1-vault-fallback (L1b: my own `timeout` use in AM9, fixed, re-traced green), a1-verify (AM7/AM9 cannot run under strace + TO4/MR* needed the config; fixed by skip-when-traced, re-traced alone after the interim config, green).
Generator: rc=0 with `--allow-red a1-intent,a1-suite-runner`. keys_total 208, kept 207 (omitted: `_test-fixtures/`, full set), always_selected: a1-intent, a1-probe, a1-suite-runner, a1-ux-studio. Empty-set keys (no non-always suite reads them): 0.
`.a1/verify.json`: affected (207 keys), smoke (3), timeout_ms 427500, ci_evidence.checks (9). Key-by-key check ok:true (exit 0), red run on the unedited copy ok:false (changed []) exit 1. check-timeout.cjs exit 0. `verify affected-map --check` exit 0.
Task 9.1 commit 797475b. a1-verify suite: 380 passed, 0 failed.
RED-proof 9.1 (a) timeout_ms 7200000 -> TO4 red
RED-proof 9.1 (a2) timeout_ms 474000 -> TO4 red
RED-proof 9.1 (b) dead key added -> MR1 red
RED-proof 9.1 (c) MR2 asserts subset for _shared/a1-tools.cjs -> MR2 red

### Wave 9 follow-up (owner decisions 2026-11-17)
- Task F1 89097f6: a1-suite-runner X3/X4 skip only while the suite is itself traced (`lk_traced`, TracerPid detection as in AM7/AM9). Plain run 569/0 with all 6 X3/X4 cases executed; traced run (strace -f -e trace=%file) 569/0, X4 skipped, X3 passed.
- Task F2: re-trace with `bin/affected-trace.sh --only` of a1-suite-runner (status 0, green) and a1-intent (status 1, X11 only, trace ended normally; no leaked watcher). Merged into the full set; generator rc=0 with `--allow-red a1-intent` only.
- Map delta: `.a1/verify.json` byte-identical to before (keys_total 208, kept 207, key-by-key ok, `verify affected-map --check` 0, check-timeout ok 427500, a1-verify 380/0). AFFECTED-MAP.json metadata updated (allow_red now a1-intent only).
- Always-selected set did NOT change: a1-intent (allow-red), a1-probe, a1-suite-runner, a1-ux-studio. a1-suite-runner stays because its trace has one unresolvable relative path (`? statx`), the generator's second always-select rule (same for a1-probe, a1-ux-studio). Not changed (generator out of scope); owner decision needed.
- Selection cost (sequential sum of suite timings, total 1268 s for 63 suites): always set 4 suites = 426 s (335 s without a1-suite-runner at 91 s, if it were freed). skills/a1-fix/SKILL.md 22 suites 938 s; _shared/lib/verify-affected.cjs 25 / 1188 s; bin/affected-trace.sh 20 / 1179 s; agents/*.md 14 / 682 s; _shared/a1-tools.cjs full set.
- After runs: no `a1-tools-as.cjs` process.

## Wave 10 — Integration gate, rehearsal, narrowing evidence
Completed: 2026-11-17 (Task 10.1 PARTIAL: narrowing pass line missed, STOP to owner per D17)

| Step | Result |
|---|---|
| 2 carry-over | RESEARCH, MAP, PLAN, AUDIT already tracked in the worktree and byte-identical (`cmp -s`) to the primary checkout: nothing to copy, no commit |
| 3-4 `bash bin/run-suites.sh` (LANG=en_US.UTF-8, workers 6, 315 s wall) | a1-intent 1119/1 failed: X11 only (inside the narrowed list X11, B5). a1-suite-runner K5c red once under load; isolated rerun 569/0 (load flake, same family as K5a in Wave 7). a1-vault-cockpit green. No other red. No leftover `stub/a1-tools-as` process |
| 5 snapshot rehearsal (no `.git`, native locale header present in all) | xprov-a rc=0 215 s, xprov-b rc=0 222 s, xprov-c rc=0 212 s, heavy rc=1 278 s (a1-intent X11 only), rest rc=1 115 s (a1-suite-runner X3/X4 at load ~6.5; rerun alone in the snapshot 569/0). `A1_XPROV_ONLY` count 0, no `PARTIAL RUN` line in the xprov shards |
| 5b `LC_ALL= taskset -c 0-3 run-suites.sh --job fixtures-xprov` | workers: 3, rc=0, 235 s (plan-time single run-tests.sh: 319 s) |
| 6 checks | workflow lint 0, lane-split check 0, plan depth-check 0, `--check-groups` 0, verify-install-sync 0, `gates lint` 0 (without `--phase`; it takes none), `verify affected-map --check` 0 (without `--phase`; flag not accepted: rc=2 with it) |
| 7 deleted-assert scan | sum 2, not 0: `a1-suite-runner/parts/01-discovery.sh` 1 line (D3a key-set, owner exception 7507e11) and `parts/07-interrupt.sh` 1 line (X3/X4 traced-skip, owner decision 2026-11-17, 89097f6). a1-xprov diff names exactly `run-tests.sh` and `run-tests-c.sh`; every `run-tests.sh` hunk starts at old line 417-443 |
| 8 size caps | max `_shared/lib` file 560 lines (verify-run.cjs); bin/run-suites.sh 756 |
| 9 merge-check protection | diff of pr-merge-check, verify-base, pr-ci-evidence, verify-host is empty |

### Narrowing (D17) — PASS LINE MISSED, owner decision
`replay-narrowing.cjs` (82 lines) over the 25 first-parent commits ending 45ee7f1, 62 baseline ids:
- **narrowed 16/25** (line >= 12: met), **mean selected 1463.5 s of 1511 s** (line <= 1306: MISSED), pass=false, exit 1. Deterministic (second run byte-identical).
- Narrowed commits only: mean 1436.7 s (1364.8 .. 1510.9 s). All 16 select a1-xprov (622 s); with the always-selected a1-intent (289), a1-ux-studio (249), a1-suite-runner (91), a1-probe (51) the floor of a narrowed run is about 1300 s.
- Full fallbacks (9): runner_or_config_changed 7, unmapped_path 1 (CONVENTIONS.md), path_deleted 1.
- Plan-time estimate (V10): 17/25, mean 1244 s (with a1-intent always). Measured is worse by +219 s: a1-xprov is mapped to nearly every path class (docs/product, .a1/, release files), and a1-suite-runner stays always-selected (Wave 9 decision).
- Script note: selection plan ids = the 62 baseline ids plus the current `a1-xprov/run-tests*.sh` runners. With baseline ids only, `run-tests-c.sh` (a selector in the map) made 14 commits `selector_unknown` (2/25); seconds still count baseline ids only (D17 xprov rule). Thresholds, map and range were not edited.
- Red run (map-less config): narrowed 0/25, 1511 s, rc=1. Not committed.
- Live sample: P_KEY `skills/a1-fix/`; change set asserted exactly `skills/a1-fix/SKILL.md` (TEST_OK); `verify run --affected`: scope affected, `affected.selection` subset, reason mapped, selected 22 / total 63, 41 not run, `duration_ms.total` 1470092 (serial; only a1-intent X11 red).
- Commit: 21dc056 (`docs(027-s2): narrowing replay and measured result`).

### RED-proof census
Per task, lines in this file: 1.1 5, 2.1 6, 3.1 8, 4.1 5, 6.1 4 (one combined line, a-d), 7.1 1, 7.2 8, 7.3 3, 8.2 2, 9.1 4 = 46. Extra lines beyond the 46: 7.3-D3a, 9.0.
ACCEPTED-RED lines collected: lane merges (a1-intent 12/12/10 fails, subset), load flakes T19, T13, B9, T7, B9 (green on quiet rerun), Wave 8 a1-intent 12 fails within the set; from the 2026-11-17 narrowing: X11 only (+ B5 never seen in Wave 10).

### Deviations
- [Rule 4-adjacent] Narrowing pass line missed (see above): reported as STOP, not tuned.
- `gates lint` and `verify affected-map --check` run without `--phase` (the CLIs do not take it).
- Carry-over commit not created: the four artifacts were already tracked and identical.
- Deleted-assert sum 2 instead of 0 (two owner-sanctioned edits above).

### Owner steps
- Decide the narrowing miss (NARROWING.json): options are a smaller `a1-xprov` mapping (harness change, spec rules it out), freeing a1-suite-runner (generator change, slice 3), or a new pass line.
- Push, PR, Samuel + Reinhard review, CI V13 and the merge-check long path stay owner/orchestrator steps (nothing pushed here).

### Wave 10 orchestrator gates (2026-11-17)
- realpath-check and test-fidelity (`--diff-base b1338d8`): exit 0. No leftover node stub processes (`ps` shows none).
- `verify run` not repeated: Wave 10 changes only `NARROWING.json`, `replay-narrowing.cjs` and this file (no suite reads them); Erik's full `bin/run-suites.sh` on this tree had a1-intent X11 as its only red (inside the narrowed list).
- vault sync `--phases`: exit 0.
- Narrowing miss: decided in GOAL.md (2026-11-17, threshold kept, SC-6 not met, reduction to slice 3).
