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
| verify (waves 1-4) | f5591fd | pending |

Load flakes (a1-intent, outside ACCEPTED-RED, all green on a quiet-host rerun): T19 (wave 1; wave 8 twice at load 7.5/8.3, green at load 1.0), T13 and B9 (wave 3), T7 and B9 (wave 4). Load came from other sessions on the host. ACCEPTED-RED.md unchanged.
