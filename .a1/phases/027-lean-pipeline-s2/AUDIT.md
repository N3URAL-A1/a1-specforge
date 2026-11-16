---
plan: /home/rob/claude-projects/a1-specforge/.a1/phases/027-lean-pipeline-s2/PLAN.md
verdict: FAIL
blockers: 1
majors: 1
minors: 4
lanes_audited: 3
lane_split_check: PASS
generated: 2026-11-16
round: 2
---

# Plan Audit (round 2 of 2)

## Round 1 findings → resolution (measured on `main` @ `45ee7f1`, not taken from the Revision Notes)

| R1 | Resolution | Evidence |
|---|---|---|
| B1 `scope_missing` vs BC1 | **Resolved** | D2c / Task 2.1 action 3 puts `run.scope !== undefined && run.scope !== 'full'` directly before the final `return` of `checkVerification` (`verify-check.cjs:80`). The BC1 record (`cases-host.sh:150`) has no `scope` key, so it stays accepted. Every earlier reason (E1, E2, E4) returns first, so the single reasons are unchanged. RED-proof 2.1(d) proves the conflict. |
| B2 live sample always full | **Resolved** | Measured with a scratch repo: `git clone <linked worktree>` checks out the worktree's branch (`feat`), and the clone's `origin/main` is the source's `main`. After `update-ref refs/remotes/origin/main HEAD`, `origin/main` = HEAD. The `test` line then guards the one-file change set. `skills/a1-fix/SKILL.md` exists. |
| M1 reuse never hits | **Resolved** | D8 + RU13-RU16. The shared helper is equivalent: `changedOutsideA1(dir, head_sha, 'HEAD')` returns `diffNames` filtered by `A1_PREFIX`, and null when git fails. `late = outside.filter(p => p !== self)` gives the same set as today's line 78. E2 (`head_sha_unknown` on null), E3/E3b/E3c, E4 (`changed_after_run` 1) and E5 (the `self` exclusion) keep their exact results. All three Verify sites call `verify run` without `--base` (`03-verify.md:30`, `06-verify.md:74`, `a1-victor-verifier.md:85`), so the D7 copy exists for the Verify sha. |
| M2 narrowing probe cannot go red | **Resolved** | D17 commits the script and `NARROWING.json`, fixes the range, sets a pass line that exits 1 and runs a red case with a config that has no map. `BASELINE.json` is tracked and has exactly the 62 current suite ids (0 missing, 0 extra, 1510.99 s summed), so `baseline_missing` cannot fire. Commit profile of the 25 commits: 8 touch a HARD_FULL path or `.github/`, which matches the plan's "17 narrowed, 8 full". See m2 for the margin. |
| M3 +5 min allowance | **Resolved in wording** (owner Clarification applied, no tolerance). The design does not meet the bound robustly. See new **M1**. |
| M4 Task 8.2 tested the wrong function | **Resolved** | The `decide()` call in Task 8.2 matches the real signature (`pr-ci-evidence.cjs:89-113`). `listChecks: () => []` reaches `judge()` → `check_missing`, so the CU8 control and RED-proof (a) are correct. |
| M5 per-wave reds | **Resolved** | "Per-wave gate reds" lists the accepted ids, the precondition on `main`, a STOP for any other id, and leaves `.a1/verify.json` untouched. See m4. |
| m1-m9 | **Resolved** | Each item appears where the Revision Notes say it does: D7, D11, D7/D8, D6/AU11, D6, action 1 of Wave 10, counts, PR text, action 5 of Wave 9. |

Deterministic checks (`--phase 027-lean-pipeline-s2`): `lane-split check` exit 0 (3 lanes, 8 lane waves, `sequential_after_lanes [9, 10]`, 0 findings). `plan depth-check` verdict pass (4/4 checks).

## Verdict: FAIL

One new blocker. It is a small, mechanical fix (an amendment of two lines; see B1) and needs no owner input. The second open item (M1) is an owner decision. Ask for it before Wave 8, not after a CI round.

## Findings

### BLOCKERS (must fix before execution)

- **[B1]** MR1 goes red in every git-less snapshot: in Wave 10 action 5 (the `rest` shard) and in the CI job `fixtures-snapshot-locale-rest`. — *Task 9.1 action 8 (MR1), Task 10.1 action 5, SC-8, SC-9*
  - Why it is red:
    - `cases-mapreal.sh` is sourced by `a1-verify/run-tests.sh`, and `a1-verify` runs in the `rest` shard.
    - MR1 runs `verify affected-map --check --project "$REPO_ROOT"`. D5 builds the candidate keys "from `git ls-files`", and D6 defines a dead key as "no tracked file under it". So `--check` depends on git.
    - The snapshot has no `.git`, and no ancestor directory has one. In CI it is `$RUNNER_TEMP/snap` = `/home/runner/work/_temp/snap`, and the checkout lives in `/home/runner/work/<repo>/<repo>`. On aiserver it is `$S2=$(mktemp -d)` under `/tmp`.
    - So `git ls-files` fails. Either the command errors out, or every key is reported `dead_key`. Both turn MR1 red.
  - The stated results "each shard green except a1-intent" (action 5) and "the four jobs have conclusion success" (V13) therefore fail every time.
  - `--list-ids` is not affected: `expandEach` falls back to a disk glob (`verify-run.cjs:117`).
  - MR2 passes vacuously in the snapshot when it goes through `planAffected`: there is no HEAD, so it returns `no_diff_base`, which is full, and full contains everything.
  > Fix (write into Task 4.1 and Task 9.1, no owner input needed): `cmdAffectedMap --check` probes `git -C <project> rev-parse --is-inside-work-tree`. When that fails, it builds `trackedFiles` from a disk walk of the project that skips `.git` and prints `tracked_source: "disk"` (`"git"` otherwise). Add AM5b: `--check` on a planted copy without `.git` gives the same findings as AM5. MR2 calls the pure `selectAffected` with a planted `changed` list, `exists: () => true` and `requirers: new Map()`, not `planAffected`, so it asserts the same thing with or without git. A named skip line (`ok "MR1 skipped: no git work tree"`) is the weaker alternative, because the snapshot job would then not check the map.

### MAJOR (high risk of failure)

- **[M1]** `fixtures-snapshot-locale-xprov-a` meets the binding D14 bound only by runner noise, and the one allowed lever (`XP_SHARD_B`) cannot create margin in the runs that matter. — *D14, Task 8.1, SC-4, SC-9, V13*
  - **Measured** (`gh run view --json jobs`, last 5 `main` runs):

    | Job | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 |
    |---|---|---|---|---|---|
    | fixtures-xprov | 776 | 652 | 716 | 593 | 721 |
    | fixtures-rest | 614 | 732 | 581 | 649 | 657 |
    | enforcement | 9 | 12 | 8 | 8 | 16 |

    Shard a is the longest suite of fixtures-xprov in all 5 runs, and that job takes shard a + 8-10 s.
  - **Model.** In the 3 of 5 runs where fixtures-xprov is the longest job, `xprov-a − bound = (shard a on the new runner − shard a on the fixtures-xprov runner) + (o2 − o1)`. `o2 − o1 > 0`: the job adds a locale step and `git archive`, plus `sudo locale-gen` if the image lacks `en_US.UTF-8`, which RESEARCH measurement 8 could not confirm. The plan's own local measurement shows that a shard is not faster alone. So a pass in those runs is a coin flip that is slightly against the job. That is roughly a 1/3 miss rate per run overall.
  - **The lever cannot work.** `XP_SHARD_B` cannot fix this: whichever shard is longer *is* the fixtures-xprov workload. Moving parts from a to b shrinks the bound by the same amount, or makes `xprov-b` the tied job. The step "On a miss" 2 therefore costs one CI round and always ends at step 3 (STOP).
  - **V13 is a single sample.** It can pass by noise, and the property can still fail on about a third of later `main` runs.
  - **Inconsistency.** If the rebalance is used, SC-4 ("`_test-fixtures/a1-xprov/` is unchanged") and Wave 10 action 7 (deleted-line sum 0, `--name-only` count 0) contradict the D14 allowance of "exactly that one line".
  > Fix: take the owner decision now, before Wave 8. Data for the owner:
  > - (a) A third a1-xprov runner file. This changes the harness asserts at `run-tests.sh:431-433` (exactly two runner files, the exact b-runner line), so it needs an owner-approved assert change. Each shard would run about 470 s, a margin of more than 150 s.
  > - (b) Read "no added wall-clock" as the workflow critical path, max(fixture job) + enforcement. That is only 8-16 s more slack, so it is still a coin flip.
  > - (c) Accept the measured miss rate as a named deviation.
  >
  > Delete step 2 of "On a miss", or restrict it to runs where fixtures-rest is the longest job (in those runs `xprov-a` already has 64-88 s margin, so the step is never needed). Make SC-4 and Wave 10 action 7 agree with whatever D14 allows. In the PR text, state that V13 is one sample.

### MINOR (execution proceeds, but note)

- **[m1]** RU13/RU14 do not say to seed `VERIFICATION.md` with `---\nverdict: PASS\n---` before `verify run --out`. `writeOut` (`verify-cli.cjs:43-48`) writes no `verdict`. Without it, `verify check` returns exit 0 with "file does not claim PASS": RU13's agreement check passes vacuously and RU14's expected `code_changed_after_run` goes red. The existing E3/E5 cases seed the file first (`run-tests.sh:264`, `:279`). Name the seed step in RU13. Separately, RU5/RU17 need a live red run on the same sha: a clean tree returns the cached green result (`runHeadSide` reads the cache only when the tree is clean). Change the stub in the working tree (a dirty tree, not cached) or pass `--no-cache`.
- **[m2]** The D17 margin is thin, and it is unclear whether the plan-time estimate already used the m4 requirer closure (all tracked `*.cjs`/`*.js`, transitive). Three of the 17 "narrowed" commits change JS: `fix(merge-check)` 1 file, `fix(gates) realpath` 2 files, `fix(fidelity)` 6 files. If those flip to `unmapped_path` through a requirer whose key is omitted, the mean rises by about 3 × (1511 − ~900) / 25 ≈ 70 s, which is above 1306 s, and the run STOPs. The STOP is the correct reaction. State in V10 whether the estimate included the closure, so a STOP is not a surprise.
- **[m3]** Gate calls in the plan use phantom phases: `gates lint --phase w5`, `workflow lint --phase w6`, `--phase w10`, `verify run ... --phase w10-probe`. Those firings land in `.a1/phases/w5/` and similar gitignored logs, outside this phase, so `metrics phase-time` and a1-progress do not count them. Use `--phase 027-lean-pipeline-s2` for every gate call, as the `lane-split`/`depth-check` calls in Wave 10 already do.
- **[m4]** The precondition in "Per-wave gate reds" runs the `main` side once per lane. That side does not depend on the lane, so three parallel runs triple the cost (a1-intent takes about 5-7 min). They can also collide on the compare worktree slug, which the rule does not name, and they load the host the a1-intent signal cases react to. Run the `main` comparison once (slug `027-s2-main-compare`), record the failing case list in a shared place, and let each lane compare against it. Also say what happens when a1-intent's failing case set varies with load (for example, accept a subset of the recorded list), so a load-dependent case cannot cause a false STOP.

## Requested focus points

- **`changedOutsideA1` refactor vs E1-E6/BC1:** equivalent. The checks run in the same order, the null path still returns `head_sha_unknown`, the `self` exclusion is kept in `checkVerification`, and `changed_after_run`/`sample` still come from `late`. Fresh records gain `scope: "full"` and `tree_clean`. I found no fixture that asserts the exact key set of the verify record or of the `verify run` stdout.
- **4 CI jobs vs `rs_check_groups` and the a1-xprov R5j checks:** no break.
  - The existing call regex `run-suites\.sh\b.*?--job(?:=|\s+)` and the R5j2 `needs07` regex `run-suites\.sh.*--job` both need a literal `--job`. `--extra-job` contains `a-job`, so neither matches.
  - R5j3/R5j4 edit only `^    needs:` lines, and the new jobs have none.
  - R5j/GL5 find the first step named exactly `Fixtures`. The new step is `Fixtures (snapshot, native locale)` and sits after fixtures-xprov.
  - `quality-invariants.json` step checks are scoped to the jobs `checks` and `enforcement`.
  - The README runner count (N1) is unchanged, because no new `run*.sh` is added.
  - Planted `a1-workflow-lint` trees: W15/W16 (`skills/a1-fake` only) are outside `isSkillsTree`. W12-W14 copy all of `skills/`, where the per-wave and Verify files are present and `agents/` and `_shared/lib/` are absent, so they add no new finding.
  - `REUSE_RE` gives 0 hits on today's `05-merge.md` and `pr-merge-check.cjs`.
- **Replay threshold:** reproducible. The range, the script, the config and the baseline are all committed, and the baseline ids match exactly. It can go red through its own pass line and through the executed map-less red run. Margin: m2.
- **`xprov-a` at the bound:** M1.

## Lane audit

- `lane-split check` exit 0, 0 findings. I found no undeclared writes. Task 2.1 and Task 3.1 both write `verify-check.cjs` in the verify lane, one after the other. The source line in `a1-pr-merge-check/run-tests.sh` is added by the runner lane only. `.a1/verify.json` has one writer, Wave 9.
- Cutover: none. The `test.yml` jobs take effect on the PR push only.
- Yield: stated honestly.

## What's Good

- Revision 1b withdrew the `A1_XPROV_ONLY` split after reading `run-tests.sh:465` and `:483-486`. D14 now tells the owner plainly that `xprov-a` sits at the bound instead of hiding it.
- The `.a1/`-only reuse rule is one helper shared with `verify check`, and RU13/RU14 assert that both commands give the same answer. One rule cannot drift into two.
- Every probe that round 1 named now has an executed red run or a RED-proof mutation (39 counted). The key-by-key `verify.json` check and the one-file live-sample guard turn two eyeballed checks into exit codes.
