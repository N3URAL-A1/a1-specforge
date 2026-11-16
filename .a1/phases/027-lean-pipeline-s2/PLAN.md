---
phase: 027-lean-pipeline-s2
goal: Ship delivery slice 2 "Fewer suite runs" of spec 027-lean-pipeline as one independently mergeable PR. Per-wave gates run `verify run --affected` (a measured path-to-suite map plus a smoke set, full set on anything unmapped), every report says `scope`, `verify check` refuses an affected report, a full green Verify report is reused as the local pre-push run when every later commit touches only `.a1/`, parallel CI jobs run every suite from a `git archive` snapshot under a non-C locale without adding wall-clock, `timeout_ms` follows the measured suite timings, and the a1-vault-cockpit harness sorts its parts glob (owner decision 2026-11-16, no assert changed).
spec: /home/rob/N3URAL-Vault/project/a1-specforge/spec/027-lean-pipeline.md (slice 2 only: US-027-2, FR-006..FR-010, SC-002, edge cases "affected-map gaps", "snapshot runs have no .git", "LC_ALL=C opt-out"; Clarifications 2026-11-16 x3); plus RESEARCH.md Decision 1 answer (a), owner 2026-11-16
waves: 10
lanes:
  - id: verify
    waves: [1, 2, 3, 4]
    owns:
      - "_shared/lib/verify-affected.cjs"
      - "_shared/lib/verify-affected-map.cjs"
      - "_shared/lib/verify-reuse.cjs"
      - "_shared/lib/verify-run.cjs"
      - "_shared/lib/verify-cli.cjs"
      - "_shared/lib/verify-check.cjs"
      - "bin/affected-trace.sh"
      - "_test-fixtures/a1-verify/**"
    agent: a1-erik-executor
  - id: lint
    waves: [5, 6]
    owns:
      - "_shared/lib/help-verify.cjs"
      - "_shared/lib/workflow-lint.cjs"
      - "_shared/lib/workflow-lint-verify.cjs"
      - "skills/a1-execute/workflows/02-execute.md"
      - "skills/a1-new-feature/workflows/05-implement.md"
      - "_shared/push-cadence.md"
      - "_shared/gates-registry.md"
      - "_test-fixtures/a1-gates-lint/check-wave11-callsites.cjs"
      - "_test-fixtures/a1-workflow-lint/**"
    agent: a1-erik-executor
  - id: runner
    waves: [7, 8]
    owns:
      - "bin/run-suites.sh"
      - "_test-fixtures/suite-groups.json"
      - ".github/workflows/test.yml"
      - "_test-fixtures/a1-suite-runner/**"
      - "_test-fixtures/a1-vault-cockpit/run-tests.sh"
      - "_test-fixtures/a1-pr-merge-check/run-tests.sh"
      - "_test-fixtures/a1-pr-merge-check/cases-unchanged.sh"
      - "_test-fixtures/a1-xprov/run-tests.sh"
      - "_test-fixtures/a1-xprov/run-tests-c.sh"
      - "README.md"
      - "CONTRIBUTING.md"
    agent: a1-erik-executor
sequential_after_lanes: [9, 10]
status: revised
created: 2026-11-16
phase_kind: code
---

## Depth Pass

### 1 What a top professional would do
A test-impact-analysis engineer (the Bazel/Nx "affected" and coverage-based test selection school) would never derive a path-to-suite map from file names or greps. They would measure what every suite actually touches, select from that data, fail closed on anything the data does not cover, and keep the full run as the backstop: here that is Verify plus CI. They would size the gain by replaying real historic diffs against real per-suite durations, commit the replay so anyone can re-run it, and set a pass line the replay can miss, instead of assuming a hit rate. They would treat staleness as the main risk and close the cheapest class mechanically: a literal `require` edge added after the measurement gets followed at selection time. For the CI coverage they would size the shards from the per-suite times CI already logs, measure the one thing the logs cannot show (does a runner get faster when it no longer shares the machine), and bound every new job by the longest existing fixture job of the same run. They would assert the property each job claims (the locale exists, collation is not C, there is no `.git`) instead of trusting an environment variable, so a job cannot pass vacuously. For the reuse file they would treat a file under `.git/` that code under test can write as untrusted input: validate its content, bind it to a sha plus the `verify check` rule for later commits, require the directory and file modes the writer sets, and keep it out of merge-check structurally. And before planning any edit they would find every existing assert that pins today's shape. This plan found five:
- `a1-xprov` R5j2/R5j3/R5j4 force every `--job` caller into `enforcement.needs`.
- `a1-workflow-lint` W11 lints a skills-only copy.
- `a1-verify` E2 pins the reason precedence of `verify check`.
- `a1-verify` BC1/BC2 (`cases-host.sh:147-153`) accept a pre-028 record without `scope` (found by the audit, revision 1).
- `check-callsite-flags.cjs` derives allowed flags from the real `--help`.

### 2 Rawest material
- Source on `main` @ `45ee7f1`. I read `verify-run.cjs` (`resolveCommands` 200, `changeSet` 330, `runHeadSide` 355-376, `runVerify` 495-547, the `applyEnvRed` call at 532), `verify-host.cjs` `applyEnvRed` 128, `verify-cli.cjs` (`KNOWN_FLAGS` 19, the bool skip at 31), `verify-check.cjs` `checkVerification` 62-81 (the `.a1/`-only rule at 78-79, `A1_PREFIX` 22, exports 98), `verify-base.cjs` (`dirtyPaths` 122, `ensureCacheExcluded` 159, `configChange` 250), `pr-ci-evidence.cjs` (`decide` 89-113: the `unchanged` check at 101 sits after `rawEvidence`/`baseEvidence` and `verify_config_changed`), `workflow-lint.cjs`, `bin/run-suites.sh` (`rs_select_job` 156-165, `rs_check_groups` 167-243, `rs_main` 504-597, `export LC_ALL=C` 545), `.github/workflows/test.yml`, `suite-groups.json` (`ci_jobs` holds explicit id lists), `.a1/verify.json` and `.a1/xprov.json` (`external_review: denied`).
- The pinning fixtures, read in full:
  - `a1-xprov/parts/07-enforcement.sh` R5j-R5j4 (measured: one more `--job` job gives `missing: fixtures-snapshot-locale`; the same job calling `--extra-job` gives `ok`).
  - `a1-xprov/parts/20-run-binding.sh` GL5 (finds the first step named exactly `Fixtures`; new step names must differ).
  - `a1-workflow-lint` W11, `a1-verify` E1-E6, HR2, BC1/BC2, `a1-disposition` F1, `a1-gates-lint/check-callsite-flags.cjs` and `check-wave11-callsites.cjs`, `a1-suite-runner/parts/08-subset.sh` U8 and `11-check-groups.sh`, `a1-pr-merge-check` CE8, CE8b, CE39.
- Per-suite syscall traces recorded on 2026-11-16: all 62 suites under `strace -f -y -e trace=%file` in a `git archive HEAD` snapshot of `45ee7f1`, and 31 suites traced again with per-pid cwd tracking (32 runs; a1-probe twice). Plan-time map from these traces: 208 candidate keys, `skills/a1-fix/` kept with 11 of 62 suites.
- `BASELINE.json` (slice 1): per-command durations of a serial head-only `verify run`, 1511 s summed.
- GitHub Actions job timings of the last 5 `main` runs (`gh run view --json jobs`): fixtures-xprov 593/652/716/721/776 s, fixtures-rest 581/614/649/657/732 s. The longest fixture job alternates between the two. Per-suite CI seconds from the run 43832982336 logs: `a1-xprov/run-tests.sh` 768 s and `run-tests-b.sh` 723 s (sharing one 4-vCPU job, `workers: 2`); fixtures-rest: `a1-intent` 392 s, `a1-ux-studio` 258 s, the other 58 suites 542 s summed.
- Per-runner CI seconds of the last 5 `main` runs (`gh run view --log`): `a1-xprov/run-tests.sh` 768/644/706/585/712 s, `run-tests-b.sh` 723/592/653/530/672 s, `a1-intent` 392/488/377/445/451 s, `a1-ux-studio` 258/265/256/262/261 s.
- `_test-fixtures/a1-xprov/run-tests.sh:409-488`: the official two-shard logic (`XP_SHARD_B` 425, usage 428-430, exactly two runner files 431-435, `xp_in_shard` 436-439, NN check 440-443, parts self-check 463-468), and lines 483-486, which fail any run with `A1_XPROV_ONLY` set under `$CI`. Measured on aiserver (`taskset` to 4 cores): `run-tests.sh` 319 s alone, 295 s sharing the cores with shard b, so a shard is not faster alone; per-part `time` lines give shard a 324 s and shard b 329 s summed, which size the three new shards.
- `bin/run-suites.sh:21,521-523`: default workers = online cores - 2 (2 on a 4-vCPU runner), `A1_SUITE_WORKERS` and `--workers` override. `README.md:184` ("61 fixture runners", pinned by `a1-gates-lint` N1) and `CONTRIBUTING.md:75` (two-runner text).
- The diffs of the 25 first-parent commits of `main` ending at `45ee7f1`.

### 3 Methods and tools
- **Tracing.** `strace -f -qq -y -e trace=%file,fchdir`. Paths come from the `-y` fd annotations, and a pid's cwd comes from its latest `AT_FDCWD<...>` annotation plus `chdir`. ENOENT probes count as reads. A directory open counts as a listing of that directory (new direct children only).
- **Selection.** A union per path prefix plus the smoke set. Unmapped, deleted, runner or config paths select the full set. Literal `require` edges from every tracked `*.cjs`/`*.js` file are followed at selection time. `git diff --name-only -z --no-renames` gives both sides of a rename.
- **Narrowing evidence.** A committed replay script over a fixed commit range, run through the production `selectAffected`, with a pass line that exits 1 when missed and an executed red run against a config without a map.
- **Report copy and reuse.** `lstat` refuses symlinks, the copy is written with tmp+rename under mode 0600 in a 0700 directory, `git rev-parse --git-common-dir` locates it, `verify check`'s own `.a1/`-only rule (shared helper, not a copy) decides whether later commits may differ, and `vb.dirtyPaths` decides whether the tree is clean.
- **CI shards.** Shard lists in `suite-groups.json`, sized from the CI per-suite seconds, checked by `--check-groups` for exactly-once coverage, and accepted by a `gh run view --json jobs` comparison against the longest existing fixture job of the same run.
- **Runner and CI checks.** Line-based checks extend `rs_check_groups` (no YAML dependency, no single quotes inside the heredoc). Each CI job asserts `locale -a` and runs a collation probe (`printf 'B\na\n' | sort`).
- **Fixtures.** Planted trees use `mk_workdir`, each guard gets one RED-proof mutation on a `git archive` scratch copy, and every new subcommand or flag gets a hostile-input case.
- **Process checks.** `lane-split check`, `plan depth-check`, `--check-groups`, `gates lint`, `workflow lint`, the `wc -l` caps, a `git diff --numstat` scan for deleted assert lines and a key-by-key `node` comparison of `.a1/verify.json`.

### 4 External evidence of correctness
- The fixture suites through `bash bin/run-suites.sh` and GitHub Actions on GNU/Linux. New: `a1-verify` `cases-affected-unit.sh`, `cases-affected-cli.sh`, `cases-reuse.sh`, `cases-affected-map.sh`, `cases-timeout.sh`, `cases-mapreal.sh`; `a1-workflow-lint` `cases-verify-scope.sh`; `a1-suite-runner` parts 15 and 16; `a1-pr-merge-check` `cases-unchanged.sh`. Existing and unchanged in their asserts: `a1-xprov` (both shards), `a1-gates-lint` (all three runners), `a1-pr-merge-check`, `a1-verify` (including BC1/BC2), `a1-disposition`, `a1-exit2-audit`, `a1-cli-output`, `a1-vault-cockpit`.
- The first GitHub Actions run of the five `fixtures-snapshot-locale-*` jobs and the re-loaded fixtures-xprov job on the PR head: their own steps prove the locale and the missing `.git`, and the job timings of the same run decide the wall-clock bound.
- The committed replay `replay-narrowing.cjs` against `BASELINE.json` durations (exit 1 below the pass line), plus one live `verify run --affected` in a scratch clone whose change set is asserted to be one file.
- `a1-samuel-security` (hard merge dependency, spawned explicitly) and `a1-reinhard-reviewer` on the final diff.

### Rewritten brief
Plan one PR for spec 027 slice 2 (FR-006..FR-010) plus the owner-approved sorted glob in the a1-vault-cockpit harness.

**Selection (FR-006).** `verify run --affected` selects the commands from a measured `affected` prefix map in `.a1/verify.json` plus `smoke`. A committed tracer and generator produce the map; nobody writes it by hand. Selection fails closed. A committed replay over a fixed commit range states how much it narrows, against a pass line that can go red, and one live sample confirms a real subset run.

**Scope marker (FR-007).** Every new report carries `scope`. An affected run can never become Verify evidence, and four layers enforce that:
- `runVerify` rejects `--affected` with `--base`.
- The CLI rejects `--affected` with `--out`.
- `verify check` refuses a present `scope` other than `"full"`, evaluated after every existing reason. A record without `scope` comes from an older CLI that cannot run `--affected`, so it stays accepted (BC1).
- A workflow-lint rule covers the two per-wave sites and the three Verify sites, Victor included.

**Report copy and reuse (FR-008, Clarification 2026-11-16).** Every run without `--base` writes its report under `<git-common-dir>/a1-verify-reports/`. `verify reuse` accepts the newest full report among the last 50 commits when every commit after it touches only `.a1/` (the `verify check` rule, one shared helper). It serves only `_shared/push-cadence.md` P2, and a lint rule bans it from `05-merge.md` and `pr-merge-check.cjs`.

**CI jobs (FR-009, Clarifications 2026-11-16).** a1-xprov gets a third runner file (shard c; harness only, owner decision), the three shards balanced by measured part times. Five parallel jobs `fixtures-snapshot-locale-{xprov-a,xprov-b,xprov-c,heavy,rest}` together run every suite once from a snapshot under the native locale. The new runner joins `ci_jobs.fixtures-xprov`, which gets three workers through a new optional `ci_job_workers` key, so its call line and `needs` stay byte-identical and its wall-clock drops. Each calls `bin/run-suites.sh --locale-native --extra-job <name>`, so `enforcement` and its `needs` stay byte-identical. `--check-groups` validates `ci_extra_jobs` separately, including exactly-once coverage. Each job's wall-clock stays at or below the longest existing fixture job of the same run; a miss is never accepted (re-balance the shard lists, then STOP to the owner).

**Timeout (FR-010).** `timeout_ms` = `ceil(max(timings.seconds) * 1500)` from the updated `timings` (expected 427500 with a1-intent's 285 s as the new maximum), checked against `timings` by a fixture.

**Hard constraints:**
- No existing assert is deleted or changed, with two named exceptions: the `check-wave11-callsites.cjs` flag list, and the a1-xprov harness shard block (`run-tests.sh` 417-443, owner Clarification 2026-11-16). No a1-xprov part file changes.
- `pr merge-check` behaviour is unchanged: no new key is read on its path.
- Every lib module stays at or below 800 lines.
- `.a1/verify.json` is edited in exactly one wave, the last code wave.
- No Codex: the repo denied external review.
- Samuel and Reinhard review before merge.

Split into three lanes (verify, lint, runner) and two sequential waves (map measurement plus config, then integration).

# Plan: 027-lean-pipeline-s2

## Goal
Ship delivery slice 2 "Fewer suite runs" of spec 027-lean-pipeline as one independently mergeable PR. Per-wave gates run `verify run --affected` (a measured path-to-suite map plus a smoke set, full set on anything unmapped), every report says `scope`, `verify check` refuses an affected report, a full green Verify report is reused as the local pre-push run when every later commit touches only `.a1/`, parallel CI jobs run every suite from a `git archive` snapshot under a non-C locale without adding wall-clock, `timeout_ms` follows the measured suite timings, and the a1-vault-cockpit harness sorts its parts glob.

## Execution location (read first)
- All work runs in the a1-worktree `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s2/` on its own feature branch, created by a1-execute through `a1-specforge:a1-worktree` (never a raw `git worktree add`). Lanes get their own worktrees from a1-execute; everything below applies to each of them.
- The primary checkout `/home/rob/claude-projects/a1-specforge` is on `main`. Its only untracked content is this phase folder. Nothing in this plan writes there. Wave 10 action 2 **reads** the phase artifacts from it.
- Every command and every Done-when probe runs with cwd = the worktree root and uses repo-relative paths. Every `a1-tools.cjs` gate call passes `--phase 027-lean-pipeline-s2` (audit round 2 m3), so its firing lands in this phase's gate log. Where an absolute repo path is needed, use `"$(git rev-parse --show-toplevel)"`.
- `origin/main` means the remote main after `git fetch origin main` (run once at the start of Waves 9 and 10).
- Shell state does not carry across waves or agents. Every wave defines its own temp variables (`R`, `S`, `S2`) before use.
- The per-wave gate of this execution still runs the installed plugin's `verify run` without `--affected` (the plugin is updated only after merge), so every wave pays one full serial run (about 25-30 min on aiserver, BASELINE.json). That is the cost this slice removes; do not work around it.

### Per-wave gate reds (accepted list, audit M5)
The per-wave `gate-1-build` runs every suite in the login locale (`LANG=en_US.UTF-8` on aiserver). Two reds are certain and are handled by this rule, the same in every lane:
1. **Accepted ids.**
   - `_test-fixtures/a1-intent/run-tests.sh`, in every wave (aiserver signal/process cases, record `2026-11-11-intent-suite-signal-cases-aiserver`).
   - `_test-fixtures/a1-vault-cockpit/run-tests.sh`, only in waves whose worktree does not contain the Task 7.1 commit: Waves 1-6 (lanes verify and lint). From Wave 7 on (runner lane) and in Waves 9-10 it must be green.
2. **Precondition, once for the whole phase (audit round 2 m4), before any lane worktree is created.** The orchestrator runs each accepted suite once on `main` in one clean a1-worktree with the slug `027-s2-main-compare` (`node <repo>/_shared/a1-tools.cjs worktree prepare /home/rob/claude-projects/a1-specforge 027-s2-main-compare --base main`, `worktree enter <id>`, run the two suites serially on a quiet host, `worktree exit <id> --mode discard`), in the login locale (record `env | grep -E '^(LANG|LC_ALL)='`). It writes the failing case names of each suite (`grep -E '^(FAIL|not ok|  FAIL)'`) to `.a1/phases/027-lean-pipeline-s2/ACCEPTED-RED.md` and commits that file on the feature branch before the lanes fork, so every lane reads the same list. No lane runs its own `main` comparison.
3. **Per wave.** The wave report names the accepted ids that were red and lists their failing cases. Accepted: the failing case set is a subset of the recorded set (a1-intent's signal cases vary with host load, so fewer failures are fine). A failing case outside the recorded set: re-run that suite alone once on a quiet host; still outside → STOP. Any other red id is a STOP.
4. This rule does not touch `.a1/verify.json` (no `env_red` entry): that file has one writer wave (Wave 9).

## RED-proof rule (applies to every task)
Each task that lists "RED-proof" mutations applies each mutation once on a scratch copy after the task's own commit:
```bash
S=$(mktemp -d); git archive HEAD | tar -x -C "$S"
git -C "$S" init -q && git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm snap
```
Then apply the one mutation with Edit, run the named suite (or case file through its runner) there and see the named case go red. Log one line per mutation in `STATUS-<lane>.md`: `RED-proof <task> <mutation> -> <case> red (rc=<n>)`. A mutation that does not turn its case red is a defect of the fixture: fix the fixture, never drop the line.

**Fixture-repo rule.** Every new fixture that builds its own git repo holds its temp dir from `mk_workdir` and commits with a per-repo identity (`git -C "$T" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm <msg>`, or the `g` helper of `a1-verify`). No fixture relies on a global git identity. Every store-touching case sets or unsets `A1_VAULT_ROOT` explicitly.

**No-assert-change rule.** No existing `ok`/`bad`/`check`/`check_rc`/`expect`/`assert_*` line in any suite is deleted or edited. New cases go into new files that existing runners source with one added line. The only edits to existing fixture files are those added source lines, the `FLAGS['verify run']` entry in `check-wave11-callsites.cjs` (Task 5.1), the harness glob in `a1-vault-cockpit/run-tests.sh` (Task 7.1) and the shard block of `a1-xprov/run-tests.sh` lines 417-443 (Task 7.3, owner Clarification 2026-11-16: the runner-file assert and the shard lists change, no part file and no part assert). `a1-xprov/run-tests-b.sh` stays byte-identical.

## Lane decision
Three lanes. Their write sets come from the task actions below, and `lane-split check` exit 0 is required:
- **verify**: waves 1-4, 4 tasks. It covers the selection module, the `--affected`/`scope` wiring, the report copy plus `verify reuse` (including the shared `.a1/`-only helper in `verify-check.cjs`), and the tracer plus map generator.
- **lint**: waves 5-6, 2 tasks. It covers the help text, the two per-wave call sites, P2, the registry text, the call-site flag list and the workflow-lint rules.
- **runner**: waves 7-8, 5 tasks. It covers the vault-cockpit glob, the runner flags, the a1-xprov third shard, the groups keys, the five CI jobs and the unchanged-path cases.

Lanes only read each other's files. The lint lane's help text documents the verify lane's flags, and the plan fixes the exact strings in both tasks. Waves 9 (map measurement plus `.a1/verify.json`) and 10 (integration) run after the lanes: the map must be measured on the final code, and `.a1/verify.json` has a single writer wave.

Realistic yield: the lint lane (2 waves) and the runner lane (2 waves) run beside the verify chain (4 waves), so 4 of 8 lane waves overlap. Waves 9-10 stay serial: the trace run takes about 15 min wall-clock with 8 parallel tracers, then the full suite run, the native-locale snapshot rehearsal and the checks follow. Every wave also carries the full per-wave `verify run` of the installed plugin (see Execution location).

## Decisions (made in this plan, each tested)
- **D1 Scope semantics.** `scope: "affected"` whenever `--affected` was passed, including when the selection fell back to the full set. Without the flag it is `scope: "full"`. Only an `--affected` run adds `affected: {selection: "subset"|"full", reason, paths, changed, selected, total, not_run}`:
  - `paths`: at most 5 changed paths that decided a fallback.
  - `not_run`: the ids that were not run.

  This keeps spec SC-002 countable: every per-wave report says affected.
- **D2 Four layers keep an affected run out of Verify evidence.**
  - (a) `runVerify` throws `VerifyError('usage', '--affected cannot be combined with --base')`, exit 2. Merge-check calls `runVerify` directly (`pr-merge-check.cjs:240`), so the guard sits in the function, not only in the CLI.
  - (b) `verify run` rejects `--affected` with `--out`, exit 2, and writes no file.
  - (c) `verify check` refuses a record whose `scope` is **present and not `"full"`** (`scope_not_full`), exit 1. A record **without** `scope` is accepted as a legacy full run (audit B1, option a). Reason: only a CLI that writes `scope` can run `--affected`, so a missing key cannot come from an affected run, and `a1-verify` BC1 (`cases-host.sh:147-153`, "a pre-028 verify_run record ... is accepted by verify check", "stays valid and is never rewritten") pins exactly that acceptance. Spec FR-007 asks only to refuse `scope: "affected"`. The check runs **after** every existing check, just before the success return, so E1/E2/E4 keep their exact single reasons. Considered and rejected: refusing a missing `scope` only when the record carries another new field (`tree_clean`); whoever hand-edits a record can delete both keys, so it adds a reason without adding protection.
  - (d) The workflow-lint rules of Task 6.1.

  No compatibility re-run is needed: existing VERIFICATION.md files keep passing.
- **D3 Selection rules.** These live in `selectAffected`, a pure function in `_shared/lib/verify-affected.cjs`. The first rule that fires decides:
  1. no `affected` object or no `smoke` array in the config → full, `no_affected_map`;
  2. no HEAD, no resolvable merge-base, or `git diff` failed → full, `no_diff_base`;
  3. the change list is empty → full, `empty_change_set`. The change list is the committed diff `--no-renames` against the merge-base that `verify run` already resolves, plus `git status` paths with both sides of a rename;
  4. a changed path is absent from the working tree (deleted, or the old side of a rename) → full, `path_deleted`;
  5. a changed path is in `HARD_FULL_PATHS` (`bin/run-suites.sh`, `bin/run-suites-proc.sh`, `bin/run-suites-report.sh`, `_test-fixtures/suite-groups.json`, `.a1/verify.json`, `_shared/a1-tools.cjs`) or matches an entry of the same config's `ci_evidence.unchanged` (a trailing `/` matches as a prefix) → full, `runner_or_config_changed`;
  6. a changed path matches no `affected` key → full, `unmapped_path`. This also fires when a JS file that literally requires a changed JS file (transitively, the facade excluded) matches no key;
  7. the union of the selectors of every matching key, for every changed path and every literal requirer, plus `smoke`, contains a selector that matches no plan command → full, `selector_unknown`;
  8. otherwise → subset, `mapped`.

  `plan.skipped` and `plan.envRed` stay the full plan's. `applyEnvRed` gets the union of settled, plan and skipped ids, so an unselected `env_red` id never warns `env_red_stale` and the `--base` path keeps its exact id set.
- **D4 Map format and validation.**
  - `affected` is `{ "<path prefix>": ["<selector>", ...] }`.
  - `smoke` is `["<selector>", ...]`.
  - A selector is an exact command id or a command-id prefix that ends in `/`. A prefix selects every command under it, so `_test-fixtures/a1-gates-lint/` selects all three runners.

  Validation runs only on the `--affected` path and in `verify affected-map --check`. `resolveCommands` and the merge-check path read neither key. Rules:
  - `affected` is a plain object with at most 2000 keys.
  - A key is 1..300 chars, has no leading `/`, no `..` segment and no NUL.
  - A value is a non-empty array of at most 500 selectors.
  - A selector matches `^[A-Za-z0-9._/-]{1,300}$` and has no `..` segment.
  - `smoke` is a non-empty array of selectors.

  A violation is `bad_config`, exit 2. Unknown selectors are not a config error: they fall back to full at run time (D3 rule 7) and are a finding of `--check`.
- **D5 The map is measured.** The single writer of `affected` is `verify affected-map --traces <dir>`. Its input comes from `bin/affected-trace.sh`, which runs every plan command under `strace` with the runner's isolation environment and tracks cwd per pid.
  - **Candidate keys**, built from `git ls-files`:
    - `_test-fixtures/<dir>/`;
    - `_shared/lib/<family>`, where the family is the file name up to and including its first `-`, or the whole name when it has no `-`;
    - each other `_shared/` file, or `_shared/<subdir>/`;
    - `skills/<name>/`;
    - each `agents/` file;
    - `docs/<subdir>/` or each `docs/` file;
    - `.a1/phases/`;
    - each top-level file;
    - `<top-level dir>/` for the rest.
  - **A suite is in a key** when either holds:
    - it touched a path that starts with the key;
    - it listed the key's parent directory (direct children only) or, for a `/` key, any directory inside it.
  - **Always-selected suites.** A suite traced red that is named with `--allow-red <id>` joins every key, and so does a suite with an unresolvable relative path.
  - **What is kept.** A key is kept only when its suite set is not the full set. The rest are omitted, and an omitted key means full. Values are compressed to `_test-fixtures/<dir>/` when every runner in that directory is in the set.
- **D6 Map staleness.** Two classes are handled:
  - **Literal `require` edges** added after the measurement are followed at selection time (D3 rules 6-7), so they need no regeneration. The scan covers every tracked `*.cjs`/`*.js` file (297 on `45ee7f1`), including `hooks/` (`xprov-consent-hook.cjs:9` requires `_shared/lib/xprov-hook-rules.cjs` through `path.join(__dirname, '..', ...)`), `.claude/hooks/` and `skills/a1-ux-studio/scripts/**` (audit m4).
  - **Everything else is caught at Verify and CI, never escaped.** That covers the measured-only reads:
    - bash `source` and Markdown reads;
    - the 5 dynamic `require` sites in 4 files: `intent-cli.cjs:138`, `xprov.cjs:420`, `xprov-normalize.cjs:203` and `:415`, `xprov-scope.cjs:86`;
    - git-object reads (`git cat-file`/`git show <ref>:path`, e.g. `a1-ux-studio/parts/07-integration.sh:126-137`): strace sees only `.git/objects`, so such a read is invisible to the map. Harmless today (it reads a fixed ref, not the working tree), named here so the class is on record (audit m5).

  `verify affected-map --check` (exit 0/1) fails on two things:
  - a dead key (no tracked file under it);
  - a selector in `affected` or `smoke` that matches no plan command.

  `cases-mapreal.sh` runs it against the real tree in CI. Refresh: re-run the tracer and generator. The help text says when, namely after a Verify or CI red that the per-wave `--affected` run did not catch.
- **D7 Report copy.** `verify run` without `--base` writes the record (the object that `--out` would write) to `<git-common-dir>/a1-verify-reports/<head_sha>-<scope>.json`. Owner: `writeReportCopy` in `verify-reuse.cjs`, called from `verify-cli.cjs` only.
  - **Not written** without a 40-hex `head_sha`, or in an intent child.
  - **Directory:** mode 0700, created if missing. A symlinked directory is refused.
  - **File:** a symlinked target is refused. The temp file is created with flag `wx` and mode 0600 and then renamed.
  - **Pruning:** keep the newest 100 files that match `^[0-9a-f]{40}-(full|affected)\.json$`. Nothing else is deleted.
  - **Write failure:** when the directory is not a symlink, try once to unlink the target `<sha>-<scope>.json` (errors ignored), so a planted pass file does not survive a failed write wherever the directory still allows it (audit m3 ii). stdout carries `report_copy: {path: null, error}` and the exit code is unchanged. Success is `report_copy: {path}`.
  - **Merge-check** never goes through the CLI, so it writes and reads nothing new.
  - **Spec deviation, named (audit m1).** FR-008 says "Every `verify run` writes"; this plan writes only without `--base`. That keeps merge-check out structurally; the PR text and the Samuel brief name it.
- **D8 `verify reuse --head <sha> [--project <dir>]`** (owner Clarification 2026-11-16: the report sha may differ from HEAD when every commit in between touches only `.a1/`). It is read-only.
  - **Head binding.** `<sha>` must equal `git rev-parse HEAD` of the project, else `head_moved`.
  - **Finding the report.** Walk `git rev-list --max-count=50 HEAD` (HEAD first). The first commit R for which `<common>/a1-verify-reports/<R>-full.json` exists (lstat, any file type) is the candidate. None → `no_report`. Only the newest candidate is judged; an older report is never tried after a newer one fails.
  - **Later commits.** `changedOutsideA1(project, R, 'HEAD')` must return `[]`. That function is new in `verify-check.cjs` and `checkVerification` uses it too, so both commands apply one rule (paths starting with `.a1/` do not count). Non-empty → `code_changed_after_run`; null (git cannot tell) → `report_sha_unknown`.
  - **The file.** All of these hold, else the named reason:
    - the reports directory is a real directory (not a symlink), mode `& 0o777 === 0o700`, owned by `process.getuid()` where that exists → else `report_invalid`;
    - the file is a regular file (not a symlink), mode `& 0o777 === 0o600`, owned by the same uid, at most 2 MiB → else `report_invalid`;
    - it parses → else `report_invalid`;
    - `head_sha === R` → else `report_sha_mismatch`;
    - `scope === "full"` → else `scope_not_full`;
    - `verdict === "pass"` → else `verdict_not_pass`;
    - `commands` is a non-empty array → else `no_commands`;
    - `skipped_on_host` is empty → else `commands_skipped`; `env_red` absent or empty → else `env_red_excused`;
    - `tree_clean === true` → else `run_tree_dirty`;
    - the current tree is clean (`vb.dirtyPaths(statusPaths)` is empty; `.a1/` never counts) → else `tree_dirty`.
  - **Exit 0** prints `{ok: true, reason: null, head_sha, report_sha: R, report_path, a1_only_commits: <count of commits R..HEAD>}`. **Exit 1** carries one reason from the list above or `not_a_git_repo`. **Exit 2** is a usage error: a missing or non-40-hex `--head`, an unknown flag, or a value over 4096 chars or with NUL.
  - **Order.** `not_a_git_repo`, `head_moved`, `no_report`, `code_changed_after_run`/`report_sha_unknown`, then the file checks in the order listed.

  It is not a registered gate. It blocks nothing; it only lets P2 skip a run, and CI plus merge-check still run. **Trust limit (audit m3, named in the PR text and the Samuel brief):** the file sits in `.git/`, which code of the same uid can write. (i) The suites of an `--affected` run can plant `<HEAD>-full.json` with the right modes; that run overwrites only `-affected.json`. (ii) A suite that chmods the reports directory makes the next write fail; the unlink attempt and the 0700 mode check on reuse close the case where the mode was changed, not the case where a valid planted file sits in an untouched directory. (iii) `bin/run-suites.sh` runs the same suites in the checkout. All three need code under test that acts against the developer, and the only consumer is a local pre-push convenience.
- **D9 `tree_clean`.** `runVerify` adds `tree_clean: boolean|null`: true when `vb.dirtyPaths(statusPaths(project))` is empty both before the first command and after the last, and null without a HEAD. `statusPaths` is added to the `verify-run.cjs` exports.
- **D10 Runner options.**
  - **`--locale-native`** skips the `export LC_ALL=C` line and nothing else. The line and its FR-027 comment stay. With the flag, the runner prints one header line `locale: native (LANG=<v|unset>, LC_ALL=<v|unset>)`. Without the flag the output is byte-identical to today's.
  - **`--extra-job <name>`** runs the suites of `ci_extra_jobs.<name>.suites`: an explicit id list, or the string `"rest"`, which means every discovered suite that is in no other job of the same kind and not in `snapshot_incompatible`. Explicit ids that are in `snapshot_incompatible` are not run either.
  - **Refusals** (exit 2, before the lock, nothing started):
    - `--extra-job` combined with `--job` or a selector;
    - an unknown name;
    - an explicit id that is no discovered suite;
    - an extra job of kind `snapshot-locale` without `--locale-native`;
    - an extra job of kind `snapshot-locale` with a `.git` present at the root.
  - **Skipped names.** Every `snapshot-locale` job prints, per `snapshot_incompatible` id, `snapshot-incompatible (not run in any snapshot-locale job): <id> - <reason>`.
- **D11 `--extra-job` instead of `--job` for the new CI jobs.**
  - **Why.** `a1-xprov` R5j2 requires `enforcement.needs` to list every job that has a `run-suites.sh ... --job` line, and R5j3/R5j4 pin the exact `missing:` strings. Measured: one more `--job` job gives `missing: fixtures-snapshot-locale`. FR-009 forbids changing `enforcement` and asks for the jobs in parallel. This holds for each of the new jobs.
  - **What it costs.** A red snapshot-locale job does not stop `enforcement`. All of them are listed in `ci_evidence.checks`, so a red result blocks CI evidence when merge-check reaches `judge()` (`ci_check_red`). **Limit (audit m2):** on every merge-check fallback path (`protected_path_changed`, `verify_config_changed`, `base_config_differs`, a counting reporter, `--no-ci-evidence`), and for this PR itself, the snapshot-locale results are not read, and the local run covers neither the snapshot class nor the forced non-C class. The PR text says so.
  - **Review.** Named for Samuel and Reinhard as a reviewed point.
- **D12 Groups keys.** All three are optional, so every planted tree of `11-check-groups.sh` stays valid, and the "ok, N suites in M ci jobs" line of `--check-groups` stays byte-identical.
  - **`ci_extra_jobs`** is `{ "<name>": { "kind": "<kind>", "suites": [<ids>] | "rest" } }`. The only kind is `snapshot-locale`. The name matches `[A-Za-z0-9_-]+` and may not also be a `ci_jobs` name. At most one job per kind uses `"rest"`. An explicit list is non-empty. No other keys.
  - **`snapshot_incompatible`** is `{ "<suite id>": "<non-empty reason>" }`. The committed value is `{}`: in the research snapshot run, 0 suites failed because `.git` was missing (RESEARCH.md measurement 3).
  - **`ci_job_workers`** is `{ "<ci_jobs name>": <integer 1..6> }`. It applies only to a `--job <name>` run without `--workers` and without `A1_SUITE_WORKERS` (precedence: `--workers` > `A1_SUITE_WORKERS` > `ci_job_workers` > default). The committed value is `{ "fixtures-xprov": 3 }` (D14). A name that is no `ci_jobs` name, or a value outside 1..6, is a config error (exit 2).
  - **`--check-groups` findings:**
    - per extra job: called by no workflow line, or by more than one; the call line misses `--locale-native`; the call cannot gate (`echo`/`printf`, `|| true`, `set +e`, `if:`, `continue-on-error`, the same rules as `--job`); the job block lacks a `git archive` line, a `test ! -e` line naming `.git`, or a `locale -a` line; the job block has `needs:`; the job block sets `A1_XPROV_ONLY` anywhere (the harness fails it under `$CI`, `run-tests.sh:483-486`);
    - a call names an unknown extra job;
    - an explicit id or a `snapshot_incompatible` id is no discovered suite;
    - **exactly-once per kind:** a discovered suite that is in two jobs of the kind, in a job and in `snapshot_incompatible`, or (when no job uses `"rest"`) in neither.
- **D13 Timeout.** `timeout_ms` = `ceil(max(timings.seconds) * 1000 * 1.5)`, computed in Wave 9 from `suite-groups.json` after Task 7.3 replaced the two a1-xprov timings with three measured shard timings. Today's maximum (316 s, `a1-xprov/run-tests-b.sh`) disappears with the split; each new shard is about 218 s of parts on aiserver, so the expected maximum is `a1-intent/run-tests.sh` 285 s → 427500. The value is never typed by hand: Wave 9 writes what the formula gives, and `check-timeout.cjs` asserts agreement. The check is a fixture (`cases-timeout.sh`). It runs on planted pairs and on the real files. `a1-ux-studio/run-tests.sh` (249 s in BASELINE.json) has no `timings` entry; it is below the max, so no entry is added. The effect starts with the next PR, because merge-check uses the base config. Headroom note: a1-intent took 289 s in BASELINE.json, so 427.5 s is 1.48x of it on a quiet host; `--timeout-ms` stays the override on a loaded host.
- **D14 CI shards and the wall-clock bound** (owner Clarifications 2026-11-16: "no added wall-clock" is binding, as many parallel jobs as needed, no allowance, no relaxing fallback; a1-xprov gets a third runner file and each snapshot/locale xprov job runs one shard. Orchestrator decision: never `A1_XPROV_ONLY`, which `run-tests.sh:483-486` fails under `$CI`).
  - **Bound.** For every run, each `fixtures-snapshot-locale-*` job's wall-clock (`completedAt - startedAt`) is at most the longest existing fixture job of the same run, `max(fixtures-xprov, fixtures-rest)`, no tolerance. Additionally the existing critical path must not grow: fixtures-xprov after the change must not be longer than before.
  - **Three shards, balanced by measured part time** (aiserver part times, both runners side by side on 4 cores; dependency groups {04, 21} and {08, 10, 18} kept together, `run-tests.sh:423-424`; greedy longest-first into three bins):

    | Shard | Runner file | Parts (NN) | Part seconds |
    |---|---|---|---|
    | a | `run-tests.sh` | every part not in B or C: `01 06 07 11 17 20 22 29 30 32 38` | 218 |
    | b | `run-tests-b.sh` (unchanged file) | `XP_SHARD_B="02 03 08 09 10 16 18 23 27 34 35 36 37"` | 218 |
    | c | `run-tests-c.sh` (new) | `XP_SHARD_C="04 05 12 14 15 19 21 24 25 26 33"` | 217 |

    Today: shard a 324 s, shard b 329 s. A new part still lands in shard a by default.
  - **Where the new runner goes, and why.** FR-009 forbids changing the existing jobs, and `--check-groups` requires every runner in exactly one `ci_jobs` entry.
    - `fixtures-rest` would carry about 450 s more work over its 2 workers (+about 225 s): added wall-clock. Rejected.
    - `fixtures-xprov` with its default 2 workers would run three shards as 2 + 1 (about 2 x 470 s): added wall-clock. Rejected.
    - **Chosen:** `fixtures-xprov` lists all three runners, and `ci_job_workers {"fixtures-xprov": 3}` (D12) gives it three workers. Its call line `bash bin/run-suites.sh --job fixtures-xprov`, its steps and `needs` stay byte-identical; only its load changes, as the owner's third-runner decision implies. Three serial runners on 4 vCPUs: the plan-time measurement shows no slowdown for two serial runners on 4 cores (295 s shared vs 319 s alone); three is an extrapolation, measured in Wave 10 action 5b with `taskset -c 0-3` and decided on CI (V13).
  - **Estimate from CI timings** (`gh run view --json jobs` and the runner's per-suite `PASS <s>` lines, last 5 `main` runs; a shard's CI time ≈ one third of shard a + shard b, since the part sums are balanced; job ≈ longest suite + about 10 s, snapshot jobs about 15 s):

    | Run | fixtures-xprov today | fixtures-rest | shard a + b | CI shard ≈ (a+b)/3 | fixtures-xprov after (shard + 10) | Bound after | snapshot xprov job (shard + 15) | margin | heavy job (intent + 15) |
    |---|---|---|---|---|---|---|---|---|---|
    | 43832982336 | 776 | 614 | 1491 | 497 | 507 | 614 | 512 | 102 | 407 |
    | 43695874023 | 652 | 732 | 1236 | 412 | 422 | 732 | 427 | 305 | 503 |
    | 43694596359 | 716 | 581 | 1359 | 453 | 463 | 581 | 468 | 113 | 392 |
    | 43616167043 | 593 | 649 | 1115 | 372 | 382 | 649 | 387 | 262 | 460 |
    | 43578477845 | 721 | 657 | 1384 | 461 | 471 | 657 | 476 | 181 | 466 |

    - The bound becomes fixtures-rest in every run, because fixtures-xprov drops by 150-270 s. The workflow's critical path shrinks; nothing adds wall-clock.
    - Margin of the xprov snapshot jobs: 102-305 s with balanced shards; with a 10 % imbalance between shards the worst case is about 52 s (run 1). heavy: at least 189 s. rest (58 suites, 542 s over two workers): about 280-300 s, at least 280 s under the bound.
    - V13 on the PR head is one sample; the PR text says so, next to this table.
  - **Acceptance on the PR head.** The V13 command prints `ok: true` (five snapshot jobs exist and each meets the bound; fixtures-xprov is not longer than the median of the five pre-change runs, 716 s) and all jobs are green.
  - **On a miss** (never accepted, never relaxed):
    1. An xprov snapshot job over the bound: move parts between the three shard lists (`XP_SHARD_B`, `XP_SHARD_C`; shard a is the rest) toward the shorter shards, keeping the dependency groups, and push. The harness's own NN check catches a typo; the lists are part of the owner-approved shard block. heavy or rest over the bound: move its longest suite into a new job `fixtures-snapshot-locale-<n>` (a `test.yml` block, a `ci_extra_jobs` entry, a `ci_evidence.checks` entry; the last is a new `.a1/verify.json` edit, so Wave 9 actions 4-5 and the disposition are redone). At most two rounds.
    2. Still over, or fixtures-xprov slower than before with three workers: STOP and report the job timings of every run to the owner. The PR does not merge before the owner decides; the bound is not changed. `A1_XPROV_ONLY` is never a lever.
  - It is never claimed green from aiserver.
- **D15 No Codex.** `.a1/xprov.json` is `external_review: denied` (owner, 2026-11-11). Neither `plan-review-xprov` nor `design-review-xprov` runs. No task asks for, records or waives a permit. No file under `docs/adr/**` or `docs/architecture/**` is edited.
- **D16 vault-cockpit harness.** Replace the glob array at `run-tests.sh:100-102` with a C-sorted list built without `mapfile`, so it stays bash-3.2 compatible:
  ```bash
  parts=()
  while IFS= read -r p; do [[ -n "$p" ]] && parts[${#parts[@]}]="$p"; done < <(printf '%s\n' "$SUITE"/parts/*.sh | LC_ALL=C sort)
  ```
  This sits inside the existing `nullglob` on/off lines. No part file changes and no assert changes. Other suites with `parts/*.sh` globs are out of scope: only a1-vault-cockpit has a measured order dependency (RESEARCH.md measurement 4).
- **D17 Narrowing evidence (audit M2).** The replay is a committed script, `.a1/phases/027-lean-pipeline-s2/replay-narrowing.cjs`, and its full output is committed as `NARROWING.json` next to it.
  - **Range.** Fixed: the 25 first-parent commits ending at `45ee7f1` (`git rev-list --first-parent --max-count=25 45ee7f1`), the same range the plan-time estimate used, so the result does not drift with `main`.
  - **Pass line.** `narrowed >= 12` of 25 **and** mean selected seconds `<= 1306` (the plan-time estimate of 1244 s with a1-intent always selected, plus 5 %). The script exits 1 when either is missed.
  - **A miss is a STOP** that goes to the owner with `NARROWING.json`. It is never reported as a pass, and the thresholds are not edited to fit.
  - **Red run.** The same script with `--config` pointing at a copy of `.a1/verify.json` without `affected` must exit 1 (0/25, 1511 s). It runs once in Wave 10 and is logged.
  - **Plan ids for the replay.** The 62 ids of `BASELINE.json` (the suite set at `45ee7f1`, the range end), not the current `--list-ids` (63 with `run-tests-c.sh`). An a1-xprov baseline id counts as selected when any current `_test-fixtures/a1-xprov/` runner is selected, and then both baseline xprov ids count (622 s): conservative, it can only raise the mean.
  - **The plan-time numbers** (V10) came from a session-local scratch builder that is not committed. They are an estimate and are not reproducible; the committed replay is the evidence. **That builder did not apply the literal-requirer closure** (audit round 2 m2): its selection unions the matching keys of the changed paths only. With the closure over every tracked JS file, the three JS-changing commits among the 17 narrowed (`fix(merge-check)` 1 file, `fix(gates)` realpath 2 files, `fix(fidelity)` 6 files) can flip to full when a requirer has no kept key, about +70 s on the mean, above 1306 s. The threshold stays; if the replay misses it, the STOP with `NARROWING.json` is the expected, correct outcome and goes to the owner.

## Field owners (Step 3 #10)
| Field / list | Only writer | Readers |
|---|---|---|
| `scope`, `affected`, `tree_clean` in the verify record | `runVerify` (`verify-run.cjs`) | `verify check`, `verify reuse`, SC-002 count |
| `affected`, `smoke` in `.a1/verify.json` | `verify affected-map --traces` output, merged in Wave 9 (this slice) | `verify-affected.cjs` (selection, `--check`), `replay-narrowing.cjs` |
| `ci_jobs.fixtures-xprov` list, `ci_job_workers`, `timings.seconds` of the three a1-xprov runners in `suite-groups.json` | Task 7.3 | `rs_select_job`, `rs_main` workers, `rs_check_groups`, `check-timeout.cjs`, Wave 9 |
| `XP_SHARD_B`, `XP_SHARD_C` in `a1-xprov/run-tests.sh` | Task 7.3 | the a1-xprov harness |
| `timeout_ms` in `.a1/verify.json` | Wave 9, value derived from `timings` | `verify-run.cjs`; `check-timeout.cjs` asserts agreement |
| `ci_evidence.checks` in `.a1/verify.json` | Wave 9 (adds the five `fixtures-snapshot-locale-*` names) | `pr-ci-evidence.cjs` |
| `ci_evidence.unchanged` | unchanged (not shortened) | `pr-ci-evidence.cjs`, `selectAffected` (D3 rule 5) |
| `ci_extra_jobs`, `snapshot_incompatible` in `suite-groups.json` | Task 8.1 | `rs_read_groups`, `rs_select_extra_job`, `rs_check_groups` |
| `<git-common-dir>/a1-verify-reports/*.json` | `writeReportCopy` (`verify-reuse.cjs`, via `verify-cli.cjs`) | `verify reuse` only |
| the `.a1/`-only rule for commits after a run | `changedOutsideA1` (`verify-check.cjs`) | `checkVerification`, `checkReuse` |
| `duration_ms` fields (slice 1) | slice 1 code, unchanged here | read only |
| runner `--json-out`, `--lock-wait`, merge-check lazy base (slice 3) | not touched here; slice 3 must not write `scope`/`affected`/`smoke` | n/a |

Source: the spec named above (status clarified, Clarifications up to 2026-11-16), RESEARCH.md and MAP.md of this phase (2026-11-16), AUDIT.md of this phase (2026-11-16), and the PLAN.md + VERIFICATION.md of neighbour 027-lean-pipeline-s1 (merged as #90, read 2026-11-16).

## Success Criteria
- [ ] SC-1 (FR-006): `verify run --affected` selects the D3 subset on a mapped change and the full set on each fallback (unmapped, deleted, runner/config, `ci_evidence.unchanged`, no diff base, empty change set, unknown selector, no map, unmapped literal requirer). The record carries D1 fields. Fixtures `cases-affected-unit.sh`, `cases-affected-cli.sh`.
- [ ] SC-2 (FR-007): every new record carries `scope`. `verify check` refuses a present non-full `scope` (`scope_not_full`, exit 1), accepts a record without `scope` (BC1 and AC12b), and E1-E6 stay unchanged. `--affected` with `--base` or `--out` exits 2. The two per-wave blocks call `verify run --affected`, and the three Verify calls (03-verify, 06-verify, Victor) do not. `workflow lint` flags each violation on a planted tree, and the real tree passes. Fixtures `cases-affected-cli.sh`, `cases-verify-scope.sh`.
- [ ] SC-3 (FR-008 + Clarification 2026-11-16): each `verify run` without `--base` writes the D7 copy. `verify reuse` exits 0 for the same sha and for a report followed only by `.a1/` commits (Verify, commit VERIFICATION.md, reuse), and exits 1 for a later code commit, an affected-only report, a red report, a dirty tree, a dirty run, a skipped command, a symlinked file and a reports directory with the wrong mode. P2 in `push-cadence.md` calls it. `workflow lint` fails when `verify reuse` appears in `05-merge.md` or `pr-merge-check.cjs`. Fixtures `cases-reuse.sh`, `cases-verify-scope.sh`.
- [ ] SC-4 (FR-009): `test.yml` has the five jobs `fixtures-snapshot-locale-{xprov-a,xprov-b,xprov-c,heavy,rest}` (each: no `needs:`, locale assert, snapshot step, `test ! -e .git`, one `--locale-native --extra-job <own name>` call). The four existing jobs are byte-identical. `suite-groups.json` has `ci_extra_jobs` with the D14 shards, `snapshot_incompatible: {}`, `ci_jobs.fixtures-xprov` with the three a1-xprov runners, `ci_job_workers {"fixtures-xprov": 3}` and timings for the three runners. `--check-groups` validates them per D12, including exactly-once suite coverage and the `A1_XPROV_ONLY` ban. In `_test-fixtures/a1-xprov/` only `run-tests.sh` (shard block 417-443) and the new `run-tests-c.sh` change; no part file, `run-tests-b.sh` byte-identical, and every a1-xprov part runs in exactly one shard (the harness self-check, all three shards green). `ci_evidence.checks` lists all five, and `ci_evidence.unchanged` keeps its 7 entries. For each `unchanged` entry, a planted diff makes `decide()` return `used: false, why: "protected_path_changed"`. Fixtures: suite-runner parts 15/16, `cases-unchanged.sh`, `a1-xprov` R5j-R5j4 unchanged and green.
- [ ] SC-5 (FR-010): `.a1/verify.json` `timeout_ms` equals `ceil(max(timings.seconds) * 1500)` of the updated `timings` (expected 427500), and `cases-timeout.sh` passes on agreement and fails on a planted mismatch and on a planted new slowest suite.
- [ ] SC-6 (narrowing, owner priority): the committed `affected` map comes from a trace run of the final code. `verify affected-map --check` exits 0 on the real tree. `replay-narrowing.cjs` exits 0 against the D17 pass line (narrowed >= 12/25, mean selected <= 1306 s), its red run with a map-less config exits 1, and both it and `NARROWING.json` are committed. The live sample in a scratch clone, whose change set is asserted to be exactly one file under a kept key, reports `affected.selection` `subset`.
- [ ] SC-7 (owner decision): `LC_ALL=en_US.UTF-8 bash _test-fixtures/a1-vault-cockpit/run-tests.sh` and `LC_ALL=C bash ...` both exit 0. `git diff origin/main...HEAD -- _test-fixtures/a1-vault-cockpit` touches only `run-tests.sh` lines 100-102, and no `ok`/`bad`/`assert_*` line.
- [ ] SC-8 (protect): `bash bin/run-suites.sh` is green, except `a1-intent` only when equally red on `main` in a clean a1-worktree on aiserver; a1-vault-cockpit must be green. The local snapshot rehearsal of all five extra jobs (Wave 10) is green except the same `a1-intent` env-red. The `git diff --numstat` deleted-line sum over `_test-fixtures/a1-xprov/parts`, `a1-verify`, `a1-pr-merge-check`, `a1-suite-runner`, `a1-workflow-lint`, `a1-gates-lint/run*.sh` is 0. Every touched or new `_shared/lib/*.cjs` is at most 800 lines. `gates lint`, `workflow lint` and `--check-groups` exit 0.
- [ ] SC-9 (review, merge dependency): `a1-samuel-security` (spawned explicitly; `xprov scope` does not flag `verify-run.cjs`) and `a1-reinhard-reviewer` report no open BLOCKER or MAJOR on the final diff. The first CI run of the five snapshot-locale jobs and of fixtures-xprov is green and meets the D14 bound (V13 prints `ok: true`).
- Spec SC-002 is measured after merge, on the next feature's reports (see Verification, post-merge).

---

## Wave 1 — Selection module (lane verify)

### Task 1.1: `_shared/lib/verify-affected.cjs` and its unit cases
**Goal:** A pure, tested selection module per D3/D4. Nothing calls it yet.
**Actions:**
1. Create `_shared/lib/verify-affected.cjs` (at most 300 lines, `'use strict'`, requires only `fs`, `path`, `./verify-check.cjs` (`gitRaw`, `splitNul`) and `./verify-base.cjs` (`VerifyError`)). Exports, each with a JSDoc `@returns` block that names every field:
   - `HARD_FULL_PATHS` (frozen array, the six paths of D3 rule 5).
   - `validateAffectedConfig(cfg)` → `null` when `cfg.affected` or `cfg.smoke` is absent; else `{ keys: Array<[prefix, string[]]>, smoke: string[] }` (keys sorted); throws `VerifyError('bad_config', <message naming the key>)` on every D4 violation.
   - `selectorMatches(selector, id)` → boolean (exact, or `selector.endsWith('/') && id.startsWith(selector)`).
   - `affectedChanges(project, baseSha, statusPaths)` → `string[]|null`: `null` when `baseSha` is null or `gitRaw(project, ['diff','--name-only','-z','--no-renames', baseSha, 'HEAD', '--'])` returns null; else the de-duplicated union with `statusPaths` (caller passes the array).
   - `literalRequirers(project, files)` → `Map<file, Set<requirer>>`. It parses **every** tracked `*.cjs`/`*.js` file (from `git ls-files -z -- '*.cjs' '*.js'`; D6, audit m4). Two require forms count: `require('./x')`/`require('../x')` and `require(path.join(__dirname, '<lit>', ...))` with string literals only. Targets are resolved relative to the requirer and kept only when repo-internal. The function returns the transitive requirers of each file in `files`; `_shared/a1-tools.cjs` is never a requirer.
   - `selectAffected({ changed, exists, cfg, planIds, requirers })` → `{ selection: 'subset'|'full', reason, ids: string[], paths: string[] }`, pure, D3 rules 1 and 3-8 in that order (rule 2 is the caller's: it passes `changed: null`). `ids` is sorted; for `full` it is `planIds`. `paths` holds at most 5 deciding paths.
   - `planAffected(project, plan, head, baseSha, cfg, statusPathsFn)` → `{ selection, reason, ids, paths, changed }`. It is the thin caller used by `runVerify`: it reads `cfg`, calls `validateAffectedConfig`, `affectedChanges` and `literalRequirers` (only for changed `.cjs`/`.js` files), checks existence with `fs.existsSync(path.join(project, p))` and calls `selectAffected`. It is the only function with IO besides `affectedChanges`/`literalRequirers`.
2. Create `_test-fixtures/a1-verify/cases-affected-unit.sh` (header comment like `cases-envred.sh`: "Not named run*.sh on purpose"). Add `. "$(dirname "${BASH_SOURCE[0]}")/cases-affected-unit.sh"` after the `cases-envred.sh` line of `run-tests.sh` (the only edit there). The cases call the module through `node -e` with planted inputs and assert the JSON with `check`/`js` (set `OUT`, `RC` the way `vrun` does):
   - AU1 mapped path `src/a.js` with `affected {"src/":["_test-fixtures/s1/"]}`, `smoke ["_test-fixtures/smk/"]`, planIds `[_test-fixtures/s1/run-tests.sh, _test-fixtures/s2/run-tests.sh, _test-fixtures/smk/run-tests.sh]` → `subset/mapped`, ids `s1,smk`.
   - AU2 unmapped `README.md` → `full/unmapped_path`, `paths` contains `README.md`.
   - AU3 each of the 6 `HARD_FULL_PATHS` → `full/runner_or_config_changed` (6 asserts).
   - AU4 `ci_evidence.unchanged: [".github/", "x/guard.sh"]`, changed `.github/w.yml` and then `x/guard.sh` → `full/runner_or_config_changed` (2 asserts).
   - AU5 `exists` false for a mapped path → `full/path_deleted`.
   - AU6 `changed: null` → `full/no_diff_base`; AU7 `changed: []` → `full/empty_change_set`.
   - AU8 selector `_test-fixtures/gone/` → `full/selector_unknown`.
   - AU9 `cfg` without `smoke` → `full/no_affected_map`.
   - AU10 requirer: changed `lib/b.cjs` mapped to s1; requirers map `{lib/b.cjs: {lib/a.cjs}}` with `lib/a.cjs` mapped to s2 → subset ids `s1,s2,smk`; the same with `lib/a.cjs` unmapped → `full/unmapped_path`.
   - AU11 `literalRequirers` on a planted git repo (fixture-repo rule) with `lib/a.cjs` requiring `./b.cjs`, `lib/c.cjs` requiring `path.join(__dirname, 'a.cjs')`, `hooks/h.cjs` requiring `path.join(__dirname, '..', 'lib', 'b.cjs')`, `_shared/a1-tools.cjs` requiring `./lib/b.cjs` → requirers of `lib/b.cjs` = `hooks/h.cjs, lib/a.cjs, lib/c.cjs` (transitive, a file outside `_shared/lib` and `_test-fixtures` included), facade absent.
   - AU12 validation, each `bad_config` (exit of the `node -e` wrapper 2 via `process.exit(e.reason==='bad_config'?2:1)`): `affected: []`; key `../etc`; key `/abs`; key of 10000 chars; value `[]`; selector `; rm -rf /`; selector with `..`; 2001 keys.
   - AU13 hostile changed path `$(touch $WORK/pwned)` (mapped key `$`) → treated as an inert string; `test ! -e "$WORK/pwned"`.

   RED-proof:
   - (a) The rule-6 check is removed (an unmapped path is skipped instead of falling back) → AU2 red.
   - (b) `HARD_FULL_PATHS` is emptied → AU3 red.
   - (c) `selectorMatches` is exact-only → AU1 red.
   - (d) The requirer step is removed → AU10 red.
   - (e) The `ls-files` scan is narrowed back to `_shared/lib/` and `_test-fixtures/` → AU11 red.
3. Run `bash _test-fixtures/a1-verify/run-tests.sh`: exit 0. Run `wc -l _shared/lib/verify-affected.cjs`: at most 300.
**Done when:** `bash _test-fixtures/a1-verify/run-tests.sh` exits 0 with every AU case PASS, `git diff --numstat "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-verify/run-tests.sh` shows `1	0`, and the 5 RED-proof lines are in STATUS-verify.md.
**Covers:** SC-1

---

## Wave 2 — `--affected` and `scope` wiring (lane verify)
**Depends on:** Wave 1

### Task 2.1: Seam in `runVerify`, CLI flag, `verify check` refusal
**Goal:** `verify run --affected` runs the D3 subset, every record carries `scope`, and an affected report can never pass `verify check` (D1, D2).
**Actions:**
1. `_shared/lib/verify-run.cjs` `runVerify`:
   - As the first statement after `project` is resolved, add `if (opts.affected === true && opts.base !== undefined) throw new VerifyError('usage', '--affected cannot be combined with --base');`.
   - After `plan` is resolved, add `const aff = opts.affected === true ? affectedLib.planAffected(project, plan, head, baseSha, <cfg read the way resolveCommands read it>, statusPaths) : null;`. Then derive `runPlan = aff && aff.selection === 'subset' ? { ...plan, commands: plan.commands.filter((c) => aff.ids.includes(c.id)) } : plan;` and use `runPlan` in place of `plan` for `timed` and `headCommands`. `plan.skipped`, `plan.envRed` and `plan.noTestsReason` stay.
   - Change the `knownIds` argument of `applyEnvRed` to the de-duplicated union of `settled` ids, `plan.commands` ids and `plan.skipped` ids.
   - Add to the returned record: `scope: opts.affected === true ? 'affected' : 'full'` and, only when `aff`, `affected: { selection, reason, paths, changed: aff.changed.length (0 when null), selected: runPlan.commands.length, total: plan.commands.length, not_run: plan ids minus run ids (sorted) }`.
   - Update the JSDoc of `runVerify` (`opts.affected`). Keep the file at or below 800 lines.
   - Read the config once. `resolveCommands` reads `.a1/verify.json` itself, so pass the same parsed object to `planAffected` by reading it through the existing `readJsonFile` helper. Do not change `resolveCommands`'s signature.
2. `_shared/lib/verify-cli.cjs`:
   - Add `affected: 'bool'` to `KNOWN_FLAGS`. Change the skip at line 31 to `k === 'no-cache' || k === 'affected'`. Return `affected: flags.affected === true`.
   - In `cmdVerifyRun`, after parsing: `if (opts.affected && opts.out) return fail('usage', '--affected cannot be combined with --out (an affected run is never Verify evidence)');`.
   - Update the router usage string with `[--affected]`.
3. `_shared/lib/verify-check.cjs`: directly before the final `return { exit: 0, reasons: [] };` add `if (run.scope !== undefined && run.scope !== 'full') return { exit: 1, reasons: ['scope_not_full'] };` (D2c: a missing `scope` is a legacy full record). Update the header comment list with "`verify_run.scope` is present and not `full` (an `--affected` record; a record without `scope` predates the field and is accepted)".
4. Create `_test-fixtures/a1-verify/cases-affected-cli.sh` and source it after `cases-affected-unit.sh`. Projects use `newproj`/`seal`, `each: "_test-fixtures/*/run*.sh"` and three planted suites `s1`, `s2`, `smk` that append to a probe file. They also carry `src/a.js`, `docs/x.md`, `bin/run-suites.sh`, and `affected {"src/":["_test-fixtures/s1/"],"docs/":["_test-fixtures/s2/run-tests.sh"]}`, `smoke ["_test-fixtures/smk/"]`. Each case changes files on branch `feat` and commits.
   - AC1 `src/a.js` changed: exit 0. Checks: `scope` is affected, `affected.selection` is subset, `affected.reason` is mapped; `commands` ids are `s1,smk`; `not_run` is `s2`; the s2 probe is absent.
   - AC2 `README.md` changed → full/unmapped_path, 3 commands ran, `scope` affected.
   - AC3 `bin/run-suites.sh` changed → full/runner_or_config_changed.
   - AC4 `git rm docs/x.md` → full/path_deleted.
   - AC5 seal only (no change) → full/empty_change_set.
   - AC6 repo on branch `work` only (no main/master/origin) → full/no_diff_base.
   - AC7 without `--affected` → `scope` full and no `affected` key.
   - AC8 `--affected --out "$P/.a1/V.md"` → exit 2 usage, `test ! -e "$P/.a1/V.md"`. Then `--affected --base main` → exit 2 usage.
   - AC9 `node -e` calls `require(<lib>/verify-run.cjs).runVerify({project, base:'main', affected:true})` and catches the error → `usage`. This is the merge-check path guard.
   - AC10 `env_red: [{id: s2 id, host: <this platform>, reason: x}]` with a subset run of s1 → no `warnings` entry `env_red_stale`.
   - AC11 a subset run, then a full run on the same sha → the full run has `cache.head` `miss` and all 3 commands have integer `duration_ms`. It is never served from the subset entry.
   - AC12 `verify check`:
     - a PASS file holding the AC1 record (written by `writeOut` via `node -e`, since the CLI refuses `--out`) → exit 1 `scope_not_full`;
     - the same file with `scope` deleted → exit 0 (control: a record without `scope` is a legacy full record, D2c, the BC1 rule);
     - the same file with `scope: "partial"` → exit 1 `scope_not_full`;
     - a fresh `verify run --out` → exit 0, and its record has `scope` `full`.
   - AC13 hostile: `--affected=1` → exit 2; `--affected --project "$(printf 'x%.0s' $(seq 1 5000))"` → exit 2.

   RED-proof:
   - (a) The `affected`+`base` guard is removed → AC8b and AC9 red.
   - (b) `--out` is accepted → AC8a red.
   - (c) The scope check in `verify-check.cjs` is removed → AC12a and AC12c red.
   - (d) The scope check refuses a missing `scope` too → AC12b red and `a1-verify` BC1 red (this mutation proves the BC1 conflict the audit found is closed; log both cases).
   - (e) `applyEnvRed` gets the settled ids only → AC10 red.
   - (f) `runPlan` is not used for `headCommands` (all commands run) → AC1 red.
5. Run `bash _test-fixtures/a1-verify/run-tests.sh`: exit 0. E1-E6, HR2, VD6 and BC1/BC2 (`cases-host.sh`) stay PASS unchanged.
**Done when:** `bash _test-fixtures/a1-verify/run-tests.sh` exits 0 with BC1 and BC2 PASS, `git diff "$(git merge-base origin/main HEAD)" -- _shared/lib/pr-merge-check.cjs _shared/lib/verify-base.cjs _shared/lib/pr-ci-evidence.cjs _test-fixtures/a1-verify/cases-host.sh` is empty, `wc -l < _shared/lib/verify-run.cjs` is at most 800, and the 6 RED-proof lines are logged.
**Covers:** SC-1, SC-2

---

## Wave 3 — Report copy and `verify reuse` (lane verify)
**Depends on:** Wave 2

### Task 3.1: `_shared/lib/verify-reuse.cjs`, `tree_clean`, shared `.a1/` rule, CLI route
**Goal:** Every `verify run` without `--base` leaves the D7 copy, and `verify reuse` decides per D8, with the same `.a1/`-only rule as `verify check`.
**Actions:**
1. `verify-run.cjs`:
   - Compute `const cleanBefore = head !== null && vb.dirtyPaths(statusPaths(project)).length === 0;` before the first command and `cleanAfter` the same way after the head side.
   - Add `tree_clean: head === null ? null : (cleanBefore && cleanAfter)` to the record.
   - Add `statusPaths` to `module.exports`.
2. `verify-check.cjs`:
   - Add `changedOutsideA1(cwd, from, to)` → `string[]|null` with a `@returns` block: `diffNames(cwd, from, to)` filtered by `!p.startsWith(A1_PREFIX)`, null when `diffNames` is null.
   - In `checkVerification`, replace the two lines that compute `changed` and `late` with `const outside = changedOutsideA1(dir, run.head_sha, 'HEAD'); if (outside === null) return { exit: 1, reasons: ['head_sha_unknown'] };` and `const late = outside.filter((p) => p !== self);`. The reasons and their order stay identical (E3b/E3c pin them).
   - Export `changedOutsideA1` and `A1_PREFIX`.
3. Create `_shared/lib/verify-reuse.cjs` (at most 280 lines; requires `fs`, `path`, `./verify-check.cjs`, `./verify-base.cjs`, `./verify-run.cjs` (`statusPaths`), `./io.cjs` (`parseFlags`), `./emit-exit.cjs`). Exports, each with a `@returns` block that names every field:
   - `REPORTS_DIR = 'a1-verify-reports'`, `NAME_RE = /^[0-9a-f]{40}-(full|affected)\.json$/`, `KEEP = 100`, `MAX_REPORT_BYTES = 2 * 1024 * 1024`, `REUSE_WINDOW = 50`.
   - `reportsDir(project)` → absolute path or null (from `git rev-parse --git-common-dir`, resolved against `project`).
   - `writeReportCopy(project, record)` → `{ path: string|null, error?: string }` per D7, including the unlink attempt on failure (no write in an intent child; reuse `inIntentChild` the way `verify-base.cjs` does, by requiring the same helper).
   - `findCandidate(project, head)` → `{ sha: string|null, path: string|null, a1_only_commits: number }`: walks `git rev-list --max-count=REUSE_WINDOW <head>` per D8.
   - `checkReuse(project, sha)` → `{ exit: 0|1, reason: string|null, report_sha: string|null, report_path: string|null, a1_only_commits: number }` per D8, in the D8 order.
   - `cmdVerifyReuse(args)`: parses `{head: 'string', project: 'string'}`, applies the D8 exit-2 rules, prints one JSON line `{ok, reason, head_sha, report_sha, report_path, a1_only_commits}`, and ends through `emitExit` only (`a1-cli-output` G1 guard).
4. `verify-cli.cjs`:
   - In `cmdVerifyRun`, after `record = runVerify(opts)` and before building `text`: `const copy = opts.base === undefined ? writeReportCopy(opts.project, record) : null;`. Add `report_copy: copy` to the stdout object. It does not go into the record written by `--out`.
   - Route `if (sub === 'reuse') return cmdVerifyReuse(rest);` and add `verify reuse --head <sha> [--project <dir>]` to the usage string.
5. Create `_test-fixtures/a1-verify/cases-reuse.sh` and source it after `cases-affected-cli.sh`. File modes are read with `node -e 'console.log((fs.statSync(p).mode & 0o777).toString(8))'` (no GNU/BSD `stat` split).
   - RU1 green full run on a clean committed tree: `report_copy.path` exists under `$(git -C "$P" rev-parse --git-common-dir)/a1-verify-reports/<sha>-full.json`, its mode is 600, the directory mode is 700, and its content equals the stdout record without `ok`, `out` and `report_copy`.
   - RU2 `verify reuse --head <sha>` → exit 0, `report_sha` = `<sha>`, `a1_only_commits` 0.
   - RU3 `verify reuse --head <old sha>` after a new commit → exit 1 `head_moved`.
   - RU4 `--affected` run on a new code commit: the copy is `<sha>-affected.json`; reuse with that sha → exit 1 `code_changed_after_run` (the nearest `-full.json` is the RU1 report and the new commit touches code). Plant a `-full.json` for the new sha whose content says `scope: "affected"` (mode 600) → `scope_not_full`.
   - RU5 red run: commit a stub change that exits 1 (a new sha, so the head cache cannot serve the earlier green result) → copy written for the new sha, reuse → `verdict_not_pass`.
   - RU6 green run, then an untracked `src/new.js` → `tree_dirty`. A run started with an untracked file present → `tree_clean: false`; after removing the file, reuse → `run_tree_dirty`.
   - RU7 planted reports (mode 600) with `skipped_on_host: [{...}]` → `commands_skipped`; with `env_red: [{...}]` → `env_red_excused`; with `commands: []` → `no_commands`; with `head_sha` of another sha → `report_sha_mismatch`; truncated JSON → `report_invalid`; a valid report with mode 644 → `report_invalid`.
   - RU8 the `<sha>-full.json` replaced by a symlink to a valid report elsewhere → exit 1 `report_invalid`. Then the reports directory itself replaced by a symlink → `verify run` stdout `report_copy.path` is null with an `error`, the exit code is unchanged (0), and nothing is written through the link.
   - RU9 pruning: plant 101 valid-named files with old mtimes plus `keep.txt`; one run → 100 named files remain (the oldest is gone) and `keep.txt` stays.
   - RU10 `--base main` run → no new file in the reports directory.
   - RU11 hostile: `--head ../../etc/passwd`, `--head "$(printf 'a%.0s' $(seq 1 10000))"`, `--head 'abc;rm -rf /'`, `--head` missing, `--bogus` → exit 2 each, and `test ! -e` of any planted canary.
   - RU12 not a git repo (`mk_workdir` plain dir) → exit 1 `not_a_git_repo`.
   - RU13 **(Clarification 2026-11-16, the Verify-then-push flow):** seed `.a1/phases/x/VERIFICATION.md` with `printf -- '---\nverdict: PASS\n---\n'` first (as E3/E5 do at `run-tests.sh:264`/`:279`; `writeOut` writes no `verdict`, so without the seed `verify check` answers "file does not claim PASS"), then green `verify run --out .a1/phases/x/VERIFICATION.md` on a clean tree at sha R, then `git add .a1 && commit` (VERIFICATION.md), then a second commit touching only `.a1/phases/x/STATUS.md` → `verify reuse --head "$(git rev-parse HEAD)"` exits 0 with `report_sha` = R and `a1_only_commits` 2, and `verify check .a1/phases/x/VERIFICATION.md` also exits 0 with an empty `reasons` and no `note` (both commands agree, and the check is not the vacuous "does not claim PASS" path).
   - RU14 after RU13, a commit touching `src/a.js` → reuse exit 1 `code_changed_after_run`, and `verify check` of the same VERIFICATION.md exits 1 `code_changed_after_run` (same rule, same answer).
   - RU15 after RU13, an untracked `src/b.js` → `tree_dirty`; an untracked `.a1/x.md` instead → exit 0.
   - RU16 window: a full green report at R, then 51 commits touching only `.a1/` → `no_report` (R is outside `REUSE_WINDOW`).
   - RU17 the stub reads a flag file outside the repo (`[ -e "$WORK/red" ] && exit 1; exit 0`). Green run with a valid report, then chmod 0500 on the reports directory, `touch "$WORK/red"`, and a red run on the same sha with `--no-cache` (a clean tree would otherwise get the cached green result) → `report_copy.error` is set and the exit code is the red run's; then reuse → `report_invalid` (directory mode is not 0700). Restore 0700 before cleanup. Skipped with a named `ok "RU17 skipped: running as root"` line only when `id -u` is 0.

   RED-proof:
   - (a) `checkReuse` skips the `scope` check → RU4b red.
   - (b) It skips the tree check → RU6 red.
   - (c) It follows symlinks (`statSync` instead of `lstatSync`) → RU8 red.
   - (d) `writeReportCopy` is called with `--base` too → RU10 red.
   - (e) The prune keeps everything → RU9 red.
   - (f) `findCandidate` looks only at HEAD (exact sha, the pre-Clarification rule) → RU13 red.
   - (g) `checkReuse` skips `changedOutsideA1` (any later commit accepted) → RU14 red.
   - (h) The directory mode check is removed → RU17 red.
6. Run `bash _test-fixtures/a1-verify/run-tests.sh`: exit 0, with E3b/E3c unchanged and PASS.
**Done when:** the suite exits 0, `node _shared/a1-tools.cjs verify reuse --head 0000000000000000000000000000000000000000; echo $?` prints a JSON line and `1` (`head_moved`) from the worktree root, `wc -l` of `verify-reuse.cjs` is at most 280 and of `verify-run.cjs` at most 800, and the 8 RED-proof lines are logged.
**Covers:** SC-3

---

## Wave 4 — Tracer and map generator (lane verify)
**Depends on:** Wave 3

### Task 4.1: `bin/affected-trace.sh`, `_shared/lib/verify-affected-map.cjs`, `verify affected-map`
**Goal:** The D5 map can be produced from a measurement with one command pair, and `--check` detects D6 staleness.
**Actions:**
1. Create `_shared/lib/verify-affected-map.cjs` (at most 400 lines). Exports, each with a `@returns` block:
   - `parseTraceLine(line, state, root)` → `{ rel, kind: 'F'|'D' } | { unresolved: syscall } | null`. It is pure apart from `state` (a `Map` pid→cwd), and its rules are those of Depth Pass answer 3:
     - for a successful `open*`, the path comes from the `= N<path>` annotation;
     - otherwise an absolute argument is taken as it is, or the argument is joined with the dirfd annotation, or with the pid's cwd taken from the latest `AT_FDCWD<...>` and successful `chdir`/`fchdir(N<path>)`;
     - when none of that resolves, the result is `unresolved`;
     - `D` marks `O_DIRECTORY`, and only paths under `root` count.
   - A `require.main` entry `node verify-affected-map.cjs --parse-trace <root>` reads strace lines on stdin and writes `<rel>\t<F|D>` or `?\t<syscall>` lines (sorted, de-duplicated). It ends through `emitExit`.
   - `candidateKeys(trackedFiles)` → sorted keys per D5.
   - `buildMap({ readSets, planIds, trackedFiles, alwaysIds })` → `{ affected, stats: { suites, keys_total, keys_kept, always_selected } }` per D5. A suite is always selected when `readSets[id].unresolved > 0` or the id is in `alwaysIds`.
   - `checkMap(project, cfg, planIds, trackedFiles)` → `{ findings: Array<{rule: 'dead_key'|'unknown_selector', key?, selector?}> }`.
   - `cmdAffectedMap(args)` takes flags `traces` (string), `check` (bool), `list-ids` (bool), `allow-red` (string, repeatable through a comma list) and `project` (string), with exactly one of `--traces`/`--check`/`--list-ids`:
     - `--traces <dir>` reads `<dir>/<id with / replaced by __>.paths` plus `<dir>/_status.tsv` (lines `<id>\t<rc>`). Every plan id needs a `.paths` file and a status line, else exit 1 `trace_missing:<id>`. A red id not named in `--allow-red` gives exit 1 `trace_red:<id>`. On success it prints `{ok:true, affected, stats}` and writes nothing.
     - `--check` prints `{ok, findings, tracked_source}` and exits 0 when there are none, else 1. `trackedFiles` comes from `git -C <project> ls-files -z` when `git -C <project> rev-parse --is-inside-work-tree` succeeds (`tracked_source: "git"`), else from a recursive disk walk of the project that skips every `.git` entry and follows no symlink (`tracked_source: "disk"`, audit round 2 B1: the snapshot CI jobs and the Wave 10 rehearsal have no `.git`). The plan ids come from `resolveCommands`, whose `each` already falls back to a disk glob (`verify-run.cjs:117`).
     - `--list-ids` prints the resolved plan ids, one per line, from `resolveCommands` on the project.
     - Usage errors exit 2.
2. Create `bin/affected-trace.sh` (bash 3.2 compatible, at most 120 lines):
   - Usage: `bash bin/affected-trace.sh --out <dir> [--jobs N] [--root <repo>]`.
   - Exits 2 unless `uname` is Linux and `strace` is on PATH.
   - Resolves the plan ids with `node _shared/a1-tools.cjs verify affected-map --list-ids`.
   - Runs each id with `cwd = <root>` under `env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST A1_HOST_ID=leak HOME="$(mktemp -d)" LC_ALL=C strace -f -qq -y -e trace=%file,fchdir -s 4096 -o "|node <root>/_shared/lib/verify-affected-map.cjs --parse-trace <root> > <out>/<name>.paths" <argv of the command>`. It runs `--jobs` (default 6) at a time, longest first by `suite-groups.json` timings.
   - Re-runs every red id once, serially, after the pool.
   - Writes `<out>/_status.tsv`.
   - Prints `traced <n> suites, red: <ids or none>`. Exit 0 when every run ended, also with red ones (the generator decides).
   - Cleans up only its own temp dirs and kills only its own PIDs (`$!`).
3. `verify-cli.cjs`: route `if (sub === 'affected-map') return require('./verify-affected-map.cjs').cmdAffectedMap(rest);` and extend the usage string.
4. Create `_test-fixtures/a1-verify/cases-affected-map.sh` (source it after `cases-reuse.sh`).
   - AM1 `parseTraceLine` on lines copied from the real strace output of 2026-11-16, kept verbatim as here-doc fixtures:
     - a successful `openat(AT_FDCWD</r>, "x", ...) = 3</r/x>`;
     - an ENOENT `statx(AT_FDCWD</r/sub>, "y", ...) = -1 ENOENT`;
     - a non-at `mkdir("z", 0700)` after an annotation that fixes the pid cwd;
     - the same `mkdir` for an unknown pid → unresolved;
     - an `O_DIRECTORY` open → `D`;
     - a path outside root → null.
   - AM2 `candidateKeys` on a planted list → the expected keys: `_shared/lib/xprov-` for `xprov-scope.cjs`, `_shared/lib/io.cjs` for `io.cjs`, `skills/a1-fix/`, `agents/a1-x.md`, `.a1/phases/`, and no key for `_shared/a1-tools.cjs`.
   - AM3 `buildMap`:
     - a key read by all suites is omitted;
     - a key read by s1 only gives `["_test-fixtures/s1/"]`;
     - a suite that listed `skills/a1-fix` joins `skills/a1-fix/`;
     - a suite that listed only `.` does not join `skills/a1-fix/` but does join the top-level file keys;
     - a suite with `unresolved` joins every key;
     - `alwaysIds` joins every key.
   - AM4 `--traces` on a planted dir: a missing `.paths` file → exit 1 `trace_missing`; a red status → exit 1 `trace_red`; the same with `--allow-red <id>` → exit 0, the id is in `stats.always_selected`, and stdout `affected` deep-equals the expected planted map.
   - AM5 `--check` on a planted project: a key with no tracked file → `dead_key`; a selector without a command → `unknown_selector`; exit 1; the clean config → exit 0. `tracked_source` is `git`.
   - AM5b the same planted project copied with `git archive | tar -x` into a fresh dir under `mk_workdir` (no `.git` there or above): the same findings and exit codes as AM5, `tracked_source` is `disk`; a file under a planted `.git/` dir in that copy does not keep a key alive.
   - AM6 hostile: `--traces ../../etc`, `--traces "$(printf 'a%.0s' $(seq 1 10000))"`, two mode flags at once, no mode flag → exit 2.
   - AM7 `bin/affected-trace.sh` on a planted 2-suite project (skipped with `ok "AM7 skipped: no strace"` only when `strace` is missing or the host is not Linux, and the skip line names the reason): 2 `.paths` files and `_status.tsv`, and the suite that reads `docs/a.md` has that path in its `.paths`.

   RED-proof:
   - (a) The cwd tracking is dropped (non-at relative → unresolved) → AM1c red.
   - (b) The listing rule widened to every path under the listed dir → AM3d red.
   - (c) `--traces` accepts a red trace → AM4b red.
   - (d) `checkMap` skips selectors → AM5 (unknown_selector) red.
   - (e) `--check` uses `git ls-files` only (no disk fallback) → AM5b red.
5. Run `bash _test-fixtures/a1-verify/run-tests.sh` (exit 0) and `bash -n bin/affected-trace.sh`.
**Done when:** the suite exits 0 including AM7 (aiserver has strace; measured `strace -- version 6.19`), `node _shared/a1-tools.cjs verify affected-map --list-ids | wc -l` equals `ls _test-fixtures/*/run*.sh | wc -l` plus 1 (the nested parser runner) from the worktree root, `wc -l` of `verify-affected-map.cjs` is at most 400, and the 5 RED-proof lines are logged.
**Covers:** SC-6

---

## Wave 5 — Help text, call sites, P2, registry (lane lint)

### Task 5.1: Document and wire `--affected` and `verify reuse`
**Goal:** The two per-wave blocks call `verify run --affected`, the three Verify calls stay full, P2 calls `verify reuse`, and every flag passes both call-site checks.
**Actions:**
1. Edit `_shared/lib/help-verify.cjs`. Keep both existing headings byte-identical (`a1-exit2-audit` B4) except the first usage line, which gains `[--affected]` at its end.
   - Append one paragraph to the `verify run` block: "--affected (spec 027 FR-006/FR-007): runs only the commands that the `affected` map of .a1/verify.json selects for the branch's changed paths (committed diff against the merge-base plus git status, both sides of a rename) plus `smoke`; any unmapped, deleted, runner or config path, an empty change set, no merge-base, no map or an unknown selector runs the full set. The record carries scope "affected" and an affected object {selection, reason, paths, changed, selected, total, not_run}; without --affected scope is "full". Never with --base or --out (exit 2): an affected report is never Verify evidence. Every run without --base also writes its record to <git-common-dir>/a1-verify-reports/<head_sha>-<scope>.json (directory 0700, file 0600, newest 100 kept); stdout names it under report_copy. tree_clean says whether the tree was clean before and after the run."
   - Add two blocks before `verify check`:
     - `  a1-tools verify reuse --head <sha> [--project <dir>]` with the D8 contract: "<sha> must be HEAD. Uses the newest full report among the last 50 commits when every commit after it touches only .a1/ (the verify check rule), the report is a full green run on a clean tree with nothing skipped, and the tree is clean now." Exit codes (0 / 1 with reason / 2 usage), plus "used only by _shared/push-cadence.md P2; pr merge-check never calls it".
     - `  a1-tools verify affected-map (--traces <dir> [--allow-red <id,...>] | --check | --list-ids) [--project <dir>]` with the D5/D6 contract, the refresh rule ("re-run bin/affected-trace.sh and --traces after a Verify or CI red that the per-wave --affected run did not catch") and exit codes.
   - Extend the `verify check` sentence: "... or verify_run.scope is present and not full (scope_not_full; a record without scope predates the field and is accepted)".
2. `skills/a1-execute/workflows/02-execute.md` line ~149: the fenced call becomes `node <repo>/_shared/a1-tools.cjs verify run --project "$WORK_PATH" --affected --phase <phase_name>; RC=$?`. After the "Reading the `verify run` record" paragraph, add one paragraph: "`--affected` runs the suites the `affected` map in `.a1/verify.json` selects for the branch's changed paths plus `smoke`; anything unmapped runs the full set. The record says `scope: "affected"` and is never Verify evidence: 03-verify.md runs the full set once. Name `affected.selection` and `affected.reason` in the wave report." Leave the existing paragraphs byte-identical (`a1-pr-merge-check` MH9, `a1-xprov` R7j/T10).
3. `skills/a1-new-feature/workflows/05-implement.md` line ~271: same change with `--project <dir> --affected --phase <spec-id>`, and the same paragraph with "06-verify.md".
4. Do not edit `skills/a1-execute/workflows/03-verify.md`, `skills/a1-new-feature/workflows/06-verify.md` or `agents/a1-victor-verifier.md`.
5. `_test-fixtures/a1-gates-lint/check-wave11-callsites.cjs` line 14: `'verify run': ['project', 'base', 'out', 'timeout-ms', 'affected', 'phase'],`. That is the only edit; it is the named fixture-data change.
6. `_shared/push-cadence.md` P2: after the "The suite means..." list (before the bullet list), add:

   ````markdown
   **Reuse of the Verify run (spec 027 FR-008).** When the project has
   `.a1/verify.json`, run this first:

   ```bash
   node <repo>/_shared/a1-tools.cjs verify reuse --head "$(git rev-parse HEAD)"; REUSE_RC=$?
   ```

   Exit 0: a full, green `verify run` on a clean tree exists for this commit,
   or for an earlier commit when every commit since touches only `.a1/` (for
   example the committed VERIFICATION.md and STATUS.md) — skip the suite run
   below. Exit 1 (any reason) or 2: run the suite. Only P2 uses
   `verify reuse`; `pr merge-check` never does (its own rule: CI evidence,
   else a fresh run).
   ````
7. `_shared/gates-registry.md` row `gate-1-build` (line 38): append to the description cell: " Per wave the call is `verify run --affected` (spec 027 FR-006): the measured `affected` map plus `smoke`, full set on any unmapped, deleted, runner or config path; the record says `scope: \"affected\"`, `verify check` refuses it, and Verify runs the full set (`scope: \"full\"`)." Do not change any other cell or row.
8. Run:
   - `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs "$(git rev-parse --show-toplevel)"` and `node _test-fixtures/a1-gates-lint/check-callsite-flags.cjs "$(git rev-parse --show-toplevel)"`: exit 0 each;
   - `node _shared/a1-tools.cjs gates lint --phase 027-lean-pipeline-s2`: exit 0;
   - `bash _test-fixtures/a1-gates-lint/run-tests.sh`, `run-wave13.sh`, `run-wave14.sh`: exit 0 each;
   - `bash _test-fixtures/a1-exit2-audit/run-tests.sh`, `bash _test-fixtures/a1-pr-merge-check/run-tests.sh`: exit 0.

   In this lane `--affected` exists in the help only; the CLI flag lands in the verify lane, and integration is Wave 10.
**Done when:** every command of action 8 exits 0, `grep -c -- '--affected' skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md` is at least 1 each, the same grep on 03-verify.md, 06-verify.md and `agents/a1-victor-verifier.md` prints 0 each, `grep -c 'touches only `.a1/`' _shared/push-cadence.md` is at least 1, and `git diff --numstat "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs` is `1	1`.
**Covers:** SC-2, SC-3

---

## Wave 6 — Workflow-lint rules (lane lint)
**Depends on:** Wave 5

### Task 6.1: Rules `verify-scope` and `verify-reuse-ban`
**Goal:** `workflow lint` fails on a per-wave `verify run` without `--affected`, on a Verify-step `verify run` with it, and on `verify reuse` in the merge path (FR-007, FR-008).
**Actions:**
1. Create `_shared/lib/workflow-lint-verify.cjs` (at most 200 lines). It does not require `workflow-lint.cjs` (no cycle): the helpers come in as a parameter.
   - `PER_WAVE_FILES = ['skills/a1-execute/workflows/02-execute.md', 'skills/a1-new-feature/workflows/05-implement.md']`.
   - `VERIFY_FILES = ['skills/a1-execute/workflows/03-verify.md', 'skills/a1-new-feature/workflows/06-verify.md', 'agents/a1-victor-verifier.md']`.
   - `REUSE_BAN_FILES = ['skills/a1-pr-review/workflows/05-merge.md', '_shared/lib/pr-merge-check.cjs']`.
   - `VERIFY_RUN_RE = /(?:a1-tools\.cjs|\$\{?A1_TOOLS\}?"?)\s+verify\s+run(?=\s|;|$)/` and `REUSE_RE = /verify['",\s]+reuse|verify-reuse/`.
   - `checkVerifyScope(root, isSkillsTree, helpers)` → `{ checked, findings }`. `helpers = { extractBashFenceLines, joinContinuations }`.
     - **Scope.** It applies only when `isSkillsTree(root)`.
     - **When a named file counts.** A file under `skills/` is required. A file under `agents/` or `_shared/lib/` is required only when that top directory exists under `root`. This keeps W11's skills-only copy green.
     - **Reading.** Fenced lines are read through `joinContinuations(extractBashFenceLines(text))`, ignoring lines that start with `#`, `echo` or `printf`.
     - **Flag detection.** `--affected` counts only as a whole token (`/(?:^|\s)--affected(?=\s|;|$)/`).
     - **Findings:** a required file missing → `file missing or unreadable`; zero fenced `verify run` calls → `no fenced verify run call`; a call without `--affected` in a per-wave file → `per-wave verify run without --affected`; a call with `--affected` in a Verify file → `Verify-step verify run with --affected`.
   - `checkReuseBan(root, isSkillsTree)` → `{ checked, findings }`. It uses the same scope and presence rule. For `.md` every line counts (prose included); for `.cjs` every line counts. A line matching `REUSE_RE` → `verify reuse is banned here (merge-check stays CI evidence or a fresh run)`.
   - Every finding has the shape `{ file, rule: 'verify-scope'|'verify-reuse-ban', reason }`.
2. `_shared/lib/workflow-lint.cjs` `cmdWorkflowLint`: after `checkVaultSyncSteps`, call both functions with `isSkillsTree` and `{ extractBashFenceLines, joinContinuations }`, concat the findings, and add `verify_scope_checked` and `reuse_ban_checked` to the output object, after `vault_sync_checked`. Keep the file at or below 800 lines.
3. Create `_test-fixtures/a1-workflow-lint/cases-verify-scope.sh` with case functions. Source it in `run-tests.sh` before the final `caseW1; ...` call lines, and add one call line `caseVS1; caseVS2; ...` after `caseW16`. Planted trees use `copySkills` plus, where named, copies of `agents/` and `_shared/lib/pr-merge-check.cjs`.
   - VS1 a full copy (`skills`, `agents`, `_shared/lib/pr-merge-check.cjs`) of the real tree → exit 0, `verify_scope_checked` 5, `reuse_ban_checked` 2.
   - VS2 `--affected` removed from 02-execute.md → exit 1, exactly one `verify-scope` finding naming 02-execute.md. The same for 05-implement.md.
   - VS3 `--affected` added to the 03-verify.md call → one finding. The same for 06-verify.md and for the Victor call.
   - VS4 the Victor file deleted while `agents/` exists → `file missing` finding. A skills-only copy → no `verify-scope` finding for Victor. This is W11's scope.
   - VS5 `verify reuse --head x` added as prose to 05-merge.md → `verify-reuse-ban` finding. `require('./verify-reuse.cjs')` added to the copied pr-merge-check.cjs → finding.
   - VS6 the per-wave fence replaced by prose only → `no fenced verify run call`.
   - VS7 control: a `# verify run` comment line inside a fence is not a call.
   - VS8 the 02-execute.md call with `--affected-x` instead of `--affected` → `per-wave verify run without --affected`.

   RED-proof:
   - (a) The rule only checks VERIFY_FILES → VS2 red.
   - (b) `--affected` detection by substring (so `--affected-x` counts) → VS8 red.
   - (c) The presence rule drops the `agents/` exists condition → W11 red.
   - (d) `REUSE_RE` loses the `verify-reuse` alternative → VS5b red.
4. Run `bash _test-fixtures/a1-workflow-lint/run-tests.sh` (exit 0; W1-W16 unchanged and PASS) and `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s2` on the real tree (exit 0).
**Done when:** both commands exit 0, the real-tree JSON has `verify_scope_checked` 5 and `reuse_ban_checked` 2, `git diff --numstat "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-workflow-lint/run-tests.sh` shows 0 deleted lines, and the 4 RED-proof lines are logged.
**Covers:** SC-2, SC-3

---

## Wave 7 — Harness glob and runner options (lane runner)

### Task 7.1: Sorted parts glob in a1-vault-cockpit
**Goal:** a1-vault-cockpit is green under any locale (owner decision 2026-11-16, D16).
**Actions:**
1. In `_test-fixtures/a1-vault-cockpit/run-tests.sh`, replace the single line `parts=("$SUITE"/parts/*.sh)` (between `shopt -s nullglob` and `shopt -u nullglob`) with the two D16 lines. Change nothing else.
2. Run `(unset A1_VAULT_ROOT; LC_ALL=en_US.UTF-8 bash _test-fixtures/a1-vault-cockpit/run-tests.sh; echo rc=$?)` and the same with `LC_ALL=C`: `rc=0` both, and the summary counts are equal (860 passed per RESEARCH.md measurement 5).
3. RED-proof: on the scratch copy, revert the line and run with `LC_ALL=en_US.UTF-8` → rc=1 with `H_LOCKS: unbound variable` (measured on `main`: rc=1, same message).
**Done when:** action 2 prints `rc=0` twice with equal pass counts, `git diff "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-vault-cockpit` touches only that line block, and the RED-proof line is logged.
**Covers:** SC-7

### Task 7.2: `--locale-native`, `--extra-job`, groups keys, `--check-groups`
**Goal:** The runner implements D10 and D12, proven on planted trees.
**Actions:**
1. `bin/run-suites.sh`:
   - New globals `RS_LOCALE_NATIVE=0`, `RS_EXTRA_JOB=""`, `RS_EXTRA_LINES=""`, `RS_SNAPINC_LINES=""`.
   - In `rs_main`'s option loop, add `--locale-native`, `--extra-job <name>` and `--extra-job=<name>`.
   - `ci_job_workers` (D12): `rs_read_groups` validates it (name is a `ci_jobs` name, integer 1..6, else exit 2) and prints `W\t<job>\t<n>` lines. In `rs_main`, the workers chain at lines 521-523 becomes `--workers` > `A1_SUITE_WORKERS` > the `W` value of `RS_JOB` (only when `--job` was given) > `rs_default_workers`. The `workers:` header line is unchanged in format.
   - `rs_read_groups` validates the D12 keys when present: `ci_extra_jobs` is an object of name → `{kind: "snapshot-locale", suites: non-empty array of ids | "rest"}` with no other keys; a name may not also be a `ci_jobs` name; at most one `"rest"` per kind; `snapshot_incompatible` is an object of id → non-empty string. It prints `X\t<name>\t<kind>\t<id or *rest*>` lines (one per explicit id, one `*rest*` line for a rest job) and `I\t<id>\t<reason>` lines, which `rs_load_groups` collects into `RS_EXTRA_LINES` and `RS_SNAPINC_LINES`.
   - New `rs_select_extra_job`, called next to `rs_select_job`. It applies the D10 refusals with `rs_die`, then sets the selectors: the explicit ids minus `I` ids, or for `*rest*` every discovered suite minus the explicit ids of the other jobs of that kind minus `I` ids. It records the `I` ids for the header.
   - Guard the export: `if [ "$RS_LOCALE_NATIVE" -eq 0 ]; then export LC_ALL=C; fi`, keeping the FR-027 comment and adding "--locale-native (spec 027 FR-009) skips it".
   - After `workers:`, print the `locale: native ...` line (flag set only)and, for a `snapshot-locale` job, one `snapshot-incompatible (not run in any snapshot-locale job): <id> - <reason>` line per `I` id.
   - Extend `rs_check_groups`' node program (no single quote inside; use `\x27`) with the D12 findings, including the exactly-once-per-kind finding and the `A1_XPROV_ONLY` ban inside an extra job block. The extra-job call regex is `/run-suites\.sh\b.*?--extra-job(?:=|\s+)["\x27]?([A-Za-z0-9_-]+)/`, and the allowlist is `^bash bin\/run-suites\.sh( --[a-z-]+( [^ ]+)?)* --extra-job[= ]"?[A-Za-z0-9_-]+"?$`. Reuse the `why` logic. Each extra job must have exactly one valid call, and its job block must pass the D12 content checks. Keep the final ok line byte-identical.
   - Header: document both options and the two keys within the comment block, then widen `sed -n '2,24p'` to the new last header line. Check it: `bash bin/run-suites.sh -h | tail -n 1` equals the `# Portability:` line.
   - Keep the file at or below 800 lines.
2. Create `_test-fixtures/a1-suite-runner/parts/15-locale-native.sh`, using the `08-subset.sh` U8 probe shape:
   - L1 default run with `RS_ENV_EXTRA="LC_ALL= LANG=en_US.UTF-8"` → the worker sees `LC_ALL=C`, and no `locale: native` line is printed.
   - L2 `--locale-native` with `RS_ENV_EXTRA="LC_ALL=en_US.UTF-8"` → the worker sees `LC_ALL=en_US.UTF-8`, and the header has `locale: native (LANG=` and `LC_ALL=en_US.UTF-8)`.
   - L3 `--locale-native` with `LC_ALL=` → the worker sees an empty `LC_ALL`.
   - L4 `--locale-native` combined with `--check-groups` → exit 0 (nothing started).

   No glob-order assert (platform collation differs; U8 keeps the C-order assert).
3. Create `_test-fixtures/a1-suite-runner/parts/16-extra-jobs.sh` with the `cg_tree`/`cg_wf` helpers of part 11 (sourced before it, so they exist). Add a writer `cg_wf_extra <tree> <job> <line> [<extra job-block lines>]` that appends one extra job block. Planted trees have three suites `a`, `b`, `c`. Each case asserts the exit code and the named finding:
   - E1 consistent tree with `ci_extra_jobs {"x-one": {"kind":"snapshot-locale","suites":["a/run-tests.sh"]}, "x-rest": {"kind":"snapshot-locale","suites":"rest"}}` and `snapshot_incompatible {"b/run-tests.sh":"needs .git (fixture)"}`, both jobs called → exit 0 and the ok line unchanged.
   - E2 the `x-rest` job called by no line → finding.
   - E3 a call naming `ghost` → finding.
   - E4 the call without `--locale-native` → finding.
   - E5a/E5b/E5c the call behind `|| true`, in a `set +e` step, in a step with `if:` → finding each.
   - E6 `x-one` also under `ci_jobs` → exit 2 (config).
   - E7 a `snapshot_incompatible` id that does not exist → finding; an explicit id that does not exist → finding.
   - E8a/E8b/E8c the job block without `git archive`, without `test ! -e ... .git`, without `locale -a` → finding each.
   - E9 the job block with `needs: [j1]` → finding.
   - E10 `--locale-native --extra-job x-rest` run → exit 0, `c` ran, `a` and `b` did not (probe), the header names `b/run-tests.sh - needs .git (fixture)`. `--locale-native --extra-job x-one` → only `a` ran.
   - E11 the same with `mkdir "$T/.git"` → exit 2, nothing started.
   - E12 `--extra-job x-one` without `--locale-native` → exit 2.
   - E13 `--extra-job x-one --job j1`, `--extra-job x-one a/run-tests.sh`, `--extra-job nope` → exit 2 each.
   - E14 `ci_extra_jobs: []` / kind `other` / empty reason / `suites: []` / two `"rest"` jobs of one kind → exit 2 each.
   - E15 two call lines for `x-one` → finding.
   - E16 exactly-once: `a/run-tests.sh` listed in both `x-one` and a second explicit job → finding; `b/run-tests.sh` listed in `x-one` while in `snapshot_incompatible` → finding; no `"rest"` job and `c` in no job → finding.
   - E17 an extra job block with `env: A1_XPROV_ONLY: "01"` (or `A1_XPROV_ONLY=01` in its run step) → finding.
   - E18 `ci_job_workers {"j1": 3}`: `--job j1` (with `A1_SUITE_WORKERS` unset) prints `workers: 3`; `--job j1 --workers 1` prints `workers: 1`; `A1_SUITE_WORKERS=2 --job j1` prints `workers: 2`; a selector run without `--job` prints the default.
   - E19 `ci_job_workers {"nope": 3}`, `{"j1": 0}`, `{"j1": 7}`, `{"j1": "3"}` → exit 2 each, nothing started.

   Q0-Q7 of part 11 stay as they are.

   RED-proof:
   - (a) The export guard is removed (always export) → L2 red.
   - (b) The extra-job call is accepted without `--locale-native` → E4 red.
   - (c) The `.git` refusal is removed → E11 red.
   - (d) The `needs:` check is removed → E9 red.
   - (e) `"rest"` ignores the other jobs' explicit ids (`a` runs in `x-rest`) → E10 red.
   - (f) The exactly-once check is removed → E16 red.
   - (g) The `A1_XPROV_ONLY` ban is removed → E17 red.
   - (h) `ci_job_workers` is ignored (default workers always) → E18a red.
4. Run `bash _test-fixtures/a1-suite-runner/run-tests.sh` (exit 0; U8 and Q0-Q7 PASS) and `bash bin/run-suites.sh --check-groups` (exit 0 on the real tree once Task 7.3 is in the same worktree; no extra job is declared yet).
**Done when:** both commands exit 0, `bash bin/run-suites.sh -h | tail -n 1` prints the `# Portability:` line, `wc -l < bin/run-suites.sh` is at most 800, a plain `bash bin/run-suites.sh a1-lane-split` prints no `locale:` line, and the 8 RED-proof lines are logged.
**Covers:** SC-4

### Task 7.3: Third a1-xprov shard (owner Clarification 2026-11-16)
**Goal:** a1-xprov runs as three balanced shards from three runner files, harness only, and `fixtures-xprov` lists all three with three workers (D14).
**Actions:**
1. `_test-fixtures/a1-xprov/run-tests.sh`, shard block only (lines 417-443 on `45ee7f1`; no other line):
   - Comment lines 417-424: describe three runner files (`run-tests.sh` shard a = every part in neither list, `run-tests-b.sh` shard b = `XP_SHARD_B`, `run-tests-c.sh` shard c = `XP_SHARD_C`, `--shard all`), keep the dependency note and the "argument only, never the environment" rule.
   - `XP_SHARD_B="02 03 08 09 10 16 18 23 27 34 35 36 37"` and a new line `XP_SHARD_C="04 05 12 14 15 19 21 24 25 26 33"` (D14 table).
   - Usage and `case` accept `a|b|c|all` (both messages name `c`).
   - Runner-file assert: `xp_runners` must equal `run-tests-b.sh run-tests-c.sh run-tests.sh ` (the same order under C and en_US collation: `-` sorts before `.` in C, and en_US compares `runtestsb`/`runtestsc` before `runtestssh`), message "want exactly run-tests-b.sh, run-tests-c.sh and run-tests.sh". The exact-call-line check of `run-tests-b.sh` stays; add the same check for `run-tests-c.sh` with `--shard c`.
   - `xp_in_shard`: B → `b`, C → `c`, else `a`.
   - NN check: the existing loop runs over `$XP_SHARD_B $XP_SHARD_C`, and one added check: no NN in both lists (`bad "harness: <NN> is in XP_SHARD_B and XP_SHARD_C"`).
   - Lines 444-488 (timing loop, self-check 463-468, `A1_XPROV_ONLY` guard 483-486) stay byte-identical.
2. Create `_test-fixtures/a1-xprov/run-tests-c.sh`, mode 755, copied from `run-tests-b.sh` with `b` → `c` in the comment and the one call line `exec bash "$(dirname "$0")/run-tests.sh" --shard c`. `run-tests-b.sh` stays byte-identical.
3. `_test-fixtures/suite-groups.json`: add `"a1-xprov/run-tests-c.sh"` to `ci_jobs.fixtures-xprov` (sorted position); add `"ci_job_workers": { "fixtures-xprov": 3 }` after `ci_jobs`; measure the three shards on a quiet aiserver host with `bash bin/run-suites.sh --workers 3 a1-xprov/run-tests.sh a1-xprov/run-tests-b.sh a1-xprov/run-tests-c.sh` and replace the two a1-xprov `timings.seconds` entries by three entries with the measured `PASS <s>` values (`measured` keeps its date; the PR text names the re-measured entries). This task does not touch `ci_extra_jobs` (Task 8.1, next wave).
4. `README.md:184`: `61 fixture runners` → `62 fixture runners` (`a1-gates-lint` N1 compares it with `ls _test-fixtures/*/run*.sh | wc -l`). `CONTRIBUTING.md:75`: the two-runner sentence names three runner files and `XP_SHARD_C`.
5. Run:
   - `bash _test-fixtures/a1-xprov/run-tests.sh; bash _test-fixtures/a1-xprov/run-tests-b.sh; bash _test-fixtures/a1-xprov/run-tests-c.sh`: each exits 0 and prints `shard: a|b|c`; the `time <part>` lines of the three logs together name every `parts/*.sh` exactly once (`sort | uniq -d` empty, count 35).
   - `bash _test-fixtures/a1-xprov/run-tests.sh --shard all`: exit 0.
   - `bash bin/run-suites.sh --check-groups`: exit 0, ok line `63 suites in 2 ci jobs`.
   - `bash _test-fixtures/a1-gates-lint/run-tests.sh`: exit 0 (N1).
   - `git diff "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-xprov/parts _test-fixtures/a1-xprov/run-tests-b.sh` is empty, and every hunk header of `git diff -U0 "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-xprov/run-tests.sh` starts inside old lines 417-443.
6. RED-proof:
   - (a) `05` added to `XP_SHARD_B` while it stays in `XP_SHARD_C` → the new overlap check red.
   - (b) A fourth file `run-tests-d.sh` added → the runner-file assert red.
   - (c) `run-tests-c.sh` calls `--shard b` → the exact-call-line check red.
**Done when:** every command of action 5 meets its result, the three measured shard times are in STATUS-runner.md and `suite-groups.json`, and the 3 RED-proof lines are logged.
**Covers:** SC-4, SC-5

---

## Wave 8 — Real groups, CI jobs, unchanged-path cases (lane runner)
**Depends on:** Wave 7

### Task 8.1: `suite-groups.json` extra-job keys and the five `fixtures-snapshot-locale-*` jobs
**Goal:** The real tree declares the D14 shards and CI runs them in parallel (FR-009, D11, D14).
**Actions:**
1. `_test-fixtures/suite-groups.json`: add after `ci_jobs`:
   ```json
   "ci_extra_jobs": {
     "fixtures-snapshot-locale-xprov-a": { "kind": "snapshot-locale", "suites": ["a1-xprov/run-tests.sh"] },
     "fixtures-snapshot-locale-xprov-b": { "kind": "snapshot-locale", "suites": ["a1-xprov/run-tests-b.sh"] },
     "fixtures-snapshot-locale-xprov-c": { "kind": "snapshot-locale", "suites": ["a1-xprov/run-tests-c.sh"] },
     "fixtures-snapshot-locale-heavy": { "kind": "snapshot-locale", "suites": ["a1-intent/run-tests.sh", "a1-ux-studio/run-tests.sh"] },
     "fixtures-snapshot-locale-rest": { "kind": "snapshot-locale", "suites": "rest" }
   },
   "snapshot_incompatible": {},
   ```
   Nothing else changes (`ci_jobs`, `ci_job_workers` and `timings` are Task 7.3's).
2. `.github/workflows/test.yml`: insert five jobs after `fixtures-rest` and before the `# Spec 009 FR-005, case R5j` comment of `enforcement`. Do not change one byte of the four existing jobs. One comment block precedes the first job:

   ```yaml
     # Spec 027 FR-009: every fixture suite once, from a git archive snapshot (no .git), under a non-C locale,
     # split into five shards (ci_extra_jobs in _test-fixtures/suite-groups.json) so that no shard runs longer
     # than the longest existing fixture job. Parallel (no needs:, no job needs them). Called with --extra-job,
     # never --job, so the enforcement job and its needs stay unchanged.
   ```

   Then five job blocks that differ only in `<NAME>` (`fixtures-snapshot-locale-xprov-a`, `fixtures-snapshot-locale-xprov-b`, `fixtures-snapshot-locale-xprov-c`, `fixtures-snapshot-locale-heavy`, `fixtures-snapshot-locale-rest`), written out in full (no matrix: `--check-groups` reads literal call lines):

   ```yaml
     <NAME>:
       runs-on: ubuntu-latest
       env:
         LANG: en_US.UTF-8
       steps:
         - uses: actions/checkout@v4
           with:
             persist-credentials: false

         - uses: actions/setup-node@v4
           with:
             node-version: '20'

         - name: Install gitleaks (pinned, checksum-checked)
           env:
             GITLEAKS_VERSION: 8.30.1
             GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
           run: |
             set -e
             bash bin/ci-install-gitleaks.sh "$GITLEAKS_VERSION" "$GITLEAKS_SHA256" "$RUNNER_TEMP/gitleaks-bin"
             echo "$RUNNER_TEMP/gitleaks-bin" >> "$GITHUB_PATH"

         - name: Native locale (asserted, never assumed)
           run: |
             set -e
             if ! locale -a | grep -Eqix 'en_US\.utf-?8'; then sudo locale-gen en_US.UTF-8; fi
             locale -a | grep -Eqix 'en_US\.utf-?8'
             test -z "${LC_ALL:-}"
             test "$(printf 'B\na\n' | sort | head -n 1)" = "a"
             test "$(printf 'B\na\n' | LC_ALL=C sort | head -n 1)" = "B"

         - name: Snapshot without .git
           run: |
             set -e
             mkdir "$RUNNER_TEMP/snap"
             git archive HEAD | tar -x -C "$RUNNER_TEMP/snap"
             test ! -e "$RUNNER_TEMP/snap/.git"

         - name: Fixtures (snapshot, native locale)
           working-directory: ${{ runner.temp }}/snap
           run: |
             set -e
             echo "glob count: $(ls _test-fixtures/*/run*.sh | wc -l)"
             bash bin/run-suites.sh --locale-native --extra-job <NAME>
   ```

   No `--workers` flag: the runner default (2 on a 4-vCPU runner) is what the existing jobs use, and the D14 estimates assume it. No job sets `A1_XPROV_ONLY`: the harness fails such a run under `$CI` (`run-tests.sh:483-486`), and `--check-groups` reports it (D12). The step name is not exactly `Fixtures`, so GL5 keeps finding the existing step.
3. Run:
   - `bash bin/run-suites.sh --check-groups`: exit 0 and the ok line `check-groups: ok, 63 suites in 2 ci jobs`;
   - `git diff "$(git merge-base origin/main HEAD)" -- .github/workflows/test.yml | grep '^-' | grep -v '^---' | wc -l`: 0, i.e. only added lines;
   - `grep -c -- '--extra-job fixtures-snapshot-locale-' .github/workflows/test.yml`: 5;
   - `bash _test-fixtures/a1-xprov/run-tests.sh`: exit 0 (R5j-R5j4, GL5 green without edits).
4. Coverage of the shards is proven by `--check-groups` itself: its exactly-once-per-kind finding (D12, red-proven by E16) runs over the real discovered set and the a1-xprov parts stay covered by the harness's own self-check (465), so action 3's exit 0 means every suite runs in exactly one snapshot job. Also print each shard's selection once without running it: `bash bin/run-suites.sh --check-groups` output plus `node -e` over `suite-groups.json` listing the explicit ids per job, recorded in STATUS-runner.md.
**Done when:** the results of action 3 hold, and `grep -c 'fixtures-snapshot-locale-' _test-fixtures/suite-groups.json` prints at least 5.
**Covers:** SC-4

### Task 8.2: One planted diff per `ci_evidence.unchanged` entry, through `decide()`
**Goal:** Each of the 7 real `unchanged` entries makes `decide()` return `used: false, why: "protected_path_changed"` (FR-009 last sentence, audit M4).
**Actions:**
1. Create `_test-fixtures/a1-pr-merge-check/cases-unchanged.sh` and source it after `cases-envred.sh` in `run-tests.sh` (the only edit there).
   - It reads the real `$REPO_ROOT/.a1/verify.json` with `node -e`, takes `cfg.ci_evidence`, and asserts `unchanged.length === 7` (`CU0`).
   - For each entry, it builds a planted repo with the fixture-repo rule. On `main`: a copy of the real `.a1/verify.json` and the entry's file (for a `/` entry, a file `<entry>x.yml` inside it). On branch `feat`: only the entry's file changes; `.a1/verify.json` stays byte-identical.
   - Per entry (`CU1..CU7`), `node -e`:
     ```js
     const ev = require('<lib>/pr-ci-evidence.cjs');
     const cfg = JSON.parse(fs.readFileSync(P + '/.a1/verify.json', 'utf8'));
     const r = ev.decide({ project: P, baseSha: <merge-base>, evidence: ev.parseCiEvidence(cfg),
       rawEvidence: cfg.ci_evidence, baseEvidence: cfg.ci_evidence, baseUnreadable: false,
       disabled: false, override: false, hasCountingReporter: () => false, listChecks: () => [] });
     ```
     asserts `r.used === false && r.why === 'protected_path_changed'`.
   - `CU8` control: the same call with a change only outside every entry (`docs/x.md`) → `r.why === 'check_missing'` (`decide` got past the `unchanged` check and reached `judge()` with no checks).
   - `CU9..CU15` (kept from the first plan, extra): `ev.pathsChanged(P, <merge-base>, [entry])` → `true` per entry.
2. RED-proof:
   - (a) The `unchanged` line is removed from `decide` (scratch copy) → CU1..CU7 red (`why` becomes `check_missing`).
   - (b) `pathsChanged` returns false for prefix entries → the `.github/` cases of CU1..CU7 and CU9..CU15 red.

   Log both lines.
3. Run `bash _test-fixtures/a1-pr-merge-check/run-tests.sh`: exit 0 (CE8, CE8b, CE39 unchanged).
**Done when:** the suite exits 0 with CU0-CU15 PASS, `git diff "$(git merge-base origin/main HEAD)" -- _shared/lib/pr-ci-evidence.cjs` is empty, and the 2 RED-proof lines are logged.
**Covers:** SC-4

---

## Wave 9 — Measure the map and freeze `.a1/verify.json` (sequential after lanes)
**Depends on:** Wave 4, 6, 8

### Task 9.1: Trace, generate, write the config, add the real-tree fixtures
**Goal:** The committed `affected` map is measured on the final code, and `.a1/verify.json` changes exactly once (FR-006, FR-009, FR-010).
**Actions:**
1. Preconditions (STOP if any fails):
   - cwd is the integration worktree root;
   - `git rev-parse --abbrev-ref HEAD` is not `main`;
   - `git status --porcelain` is empty;
   - all three lanes are merged in (`git log --oneline` names the Wave 4, 6 and 8 commits);
   - `git fetch origin main`.
2. `R=$(mktemp -d)`. Run `bash bin/affected-trace.sh --out "$R/traces" --jobs 8` on a host that passed the 05-merge.md 5.3 quiet-host check (anchored `pgrep` plus load5 below the CPU count). Record load5 before and after in STATUS.md.
3. Run `node _shared/a1-tools.cjs verify affected-map --traces "$R/traces" > "$R/map.json"; echo rc=$?`.
   - `rc=0`: continue.
   - `trace_red:<id>`: STOP unless the id is `_test-fixtures/a1-intent/run-tests.sh` and its traced log shows only the known signal/process cases (the aiserver env-red; compare against `main` the way Wave 10 action 4 does). Then re-run with `--allow-red _test-fixtures/a1-intent/run-tests.sh`. That suite is then always selected; record that in STATUS.md, because it costs about 289 s per selected wave.
   - Any other red id: re-run `bin/affected-trace.sh` once on a quieter host. A second red is a STOP.
4. Write `.a1/verify.json` with one `node -e` (read, set, write with 2-space JSON and a trailing newline):
   - `affected` = `map.json` `.affected`;
   - `smoke` = `["_test-fixtures/a1-gates-lint/", "_test-fixtures/a1-lib-units/", "_test-fixtures/a1-cli-output/"]`;
   - `timeout_ms` = `Math.ceil(Math.max(...Object.values(groups.timings.seconds)) * 1500)` read from `_test-fixtures/suite-groups.json` in the same `node -e` (expected 427500; record the value in STATUS.md);
   - `ci_evidence.checks` = `["checks", "fixtures-xprov", "fixtures-rest", "enforcement", "fixtures-snapshot-locale-xprov-a", "fixtures-snapshot-locale-xprov-b", "fixtures-snapshot-locale-xprov-c", "fixtures-snapshot-locale-heavy", "fixtures-snapshot-locale-rest"]`;
   - every other key and the 7 `unchanged` entries stay identical.
5. Key-by-key check (audit m9). Run this `node -e` and see exit 0:
   ```js
   const cp = require('child_process'), fs = require('fs');
   const base = JSON.parse(cp.execFileSync('git', ['show', 'origin/main:.a1/verify.json'], { encoding: 'utf8' }));
   const head = JSON.parse(fs.readFileSync('.a1/verify.json', 'utf8'));
   const canon = (v) => JSON.stringify(v);
   const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
   const changed = keys.filter((k) => canon(base[k]) !== canon(head[k]));
   const evDiff = Object.keys(head.ci_evidence).filter((k) => canon(base.ci_evidence[k]) !== canon(head.ci_evidence[k]));
   const ok = canon(changed) === canon(['affected', 'ci_evidence', 'smoke', 'timeout_ms'])
     && canon(evDiff) === canon(['checks'])
     && canon(head.ci_evidence.checks.slice(0, 4)) === canon(base.ci_evidence.checks)
     && head.ci_evidence.unchanged.length === 7;
   console.log(JSON.stringify({ changed, evDiff, ok })); process.exit(ok ? 0 : 1);
   ```
   Red run (once, logged): the same program on an unedited copy prints `ok:false` (changed is `[]`) and exits 1.
6. Create `_test-fixtures/a1-verify/check-timeout.cjs` (`node check-timeout.cjs <verify.json> <suite-groups.json>` → exit 0 when `timeout_ms === Math.ceil(max(timings.seconds) * 1000 * 1.5)`, else exit 1 printing both numbers; exit 2 on unreadable input).
7. Create `_test-fixtures/a1-verify/cases-timeout.sh` and source it after `cases-affected-map.sh`.
   - TO1 planted agreement (max 316 → 474000; a planted pair, independent of the real value) → exit 0.
   - TO2 planted mismatch (7200000) → exit 1.
   - TO3 planted new slowest suite (400 s) with the old value → exit 1.
   - TO4 the real `$REPO_ROOT/.a1/verify.json` and `$REPO_ROOT/_test-fixtures/suite-groups.json` → exit 0.
   - TO5 unreadable file → exit 2.
8. Create `_test-fixtures/a1-verify/cases-mapreal.sh` and source it after `cases-timeout.sh`.
   - MR1 `node "$TOOLS" verify affected-map --check --project "$REPO_ROOT"` → exit 0.
   - MR2 the pure `selectAffected` (audit round 2 B1: not `planAffected`, which needs a HEAD and would return `no_diff_base` = full in a snapshot, passing vacuously), called with the real `.a1/verify.json` as `cfg`, `planIds` from `verify affected-map --list-ids --project "$REPO_ROOT"`, `exists: () => true`, `requirers: new Map()`: `changed: ["_shared/lib/verify-run.cjs"]` → `selection` `subset` and `ids` contain `_test-fixtures/a1-verify/run-tests.sh` and every smoke runner; `changed: ["bin/run-suites.sh"]` → `full`/`runner_or_config_changed`. Same answer with and without `.git`.
9. RED-proof:
   - (a) `timeout_ms` set back to 7200000 → TO4 red.
   - (a2) `timeout_ms` left at 474000 (the pre-split value) → TO4 red, proving the formula follows the re-measured timings.
   - (b) A dead key added to the real map → MR1 red.
   - (c) MR2 asserts a key that the real map omits (e.g. `subset` for a facade change) → MR2 red; logged to prove MR2 is not vacuous.
10. Run `bash _test-fixtures/a1-verify/run-tests.sh`: exit 0.
11. Save the generator `stats` and the trace host context as `.a1/phases/027-lean-pipeline-s2/AFFECTED-MAP.json`: `{measured_sha, date, load5_before, load5_after, stats, allow_red}`. Commit `.a1/verify.json`, the three fixture files and `AFFECTED-MAP.json` as `feat(027-s2): measured affected map, timeout 474000, snapshot-locale checks`.
**Done when:**
- the commit exists;
- `node _shared/a1-tools.cjs verify affected-map --check --phase 027-lean-pipeline-s2` exits 0;
- `node _test-fixtures/a1-verify/check-timeout.cjs .a1/verify.json _test-fixtures/suite-groups.json` exits 0;
- `bash _test-fixtures/a1-verify/run-tests.sh` exits 0;
- the action 5 program exits 0 and its red run is logged;
- the 4 RED-proof lines are logged.

`.a1/verify.json` is frozen from here; a later edit invalidates the merge-time `config_change` disposition.
**Covers:** SC-1, SC-4, SC-5, SC-6

---

## Wave 10 — Carry-over, integration gate, narrowing evidence (sequential after lanes)
**Depends on:** Wave 9

### Task 10.1: Full-tree checks, rehearsal, measured narrowing
**Goal:** The combined tree is green and inside every limit, the CI shards are rehearsed locally, and the narrowing is measured, committed and judged against the D17 pass line.
**Actions:**
1. Preconditions: as in Task 9.1 action 1, plus `git fetch origin main`. Then `R=$(mktemp -d)` (audit m6: Wave 9's `R` does not exist here).
2. Carry-over (read the primary checkout, write only the worktree). For each of `.a1/phases/027-lean-pipeline-s2/RESEARCH.md`, `MAP.md`, `PLAN.md` and `AUDIT.md`:
   - absent in the worktree → `cp` it from `/home/rob/claude-projects/a1-specforge/<path>`;
   - present and byte-identical (`cmp -s`) → nothing;
   - present and different → STOP and report.

   Commit as `docs(027-s2): slice-2 phase artifacts`.
3. `bash bin/run-suites.sh` (all suites).
4. A red `a1-intent` is judged against `.a1/phases/027-lean-pipeline-s2/ACCEPTED-RED.md` with the subset rule of "Per-wave gate reds" (no new `main` run). Any other red suite: compare it once against `main` in a clean a1-worktree with the slug `027-s2-main-compare-w10` (`worktree prepare ... --base main`, `enter`, run the suite, `exit --mode discard`); only `a1-intent` is ever accepted. a1-vault-cockpit must be green now (SC-7). Record both results.
5. Rehearse the five CI shards in one snapshot (B1: `a1-verify`'s MR1/MR2 run here without `.git` and must be green):
   ```bash
   S2=$(mktemp -d); git archive HEAD | tar -x -C "$S2"; test ! -e "$S2/.git"
   for J in xprov-a xprov-b xprov-c heavy rest; do
     (cd "$S2" && env -u LC_ALL LANG=en_US.UTF-8 bash bin/run-suites.sh --locale-native --extra-job "fixtures-snapshot-locale-$J"); echo "shard $J rc=$?"
   done
   ```
   - Each shard green, except `a1-intent` per action 4.
   - A red `a1-suite-runner` X3/X4 (SIGINT within 10 s) is re-run alone once in `$S2` before it counts (RESEARCH.md measurement 1: a load flake).
   - The two xprov shard logs carry no `PARTIAL RUN` line (no `A1_XPROV_ONLY` in the environment; `env | grep -c '^A1_XPROV_ONLY='` is 0 before the loop).
   - Record each shard's `total wall-clock` and `locale: native` header line.
   - (5b) The re-loaded existing job, on 4 cores: `(cd "$S2" && LC_ALL= taskset -c 0-3 bash bin/run-suites.sh --job fixtures-xprov)` (no `--workers`, `A1_SUITE_WORKERS` unset) prints `workers: 3`, is green, and its `total wall-clock` is recorded next to the plan-time `run-tests.sh` 319 s; it must be below that number (three serial shards in parallel on 4 cores). Above it is a STOP before the push (D14 "On a miss" 2). The aiserver times are not the CI bound (D14); they only show the shards run.
6. Run each with exit 0:
   - `node _shared/a1-tools.cjs gates lint --phase 027-lean-pipeline-s2`;
   - `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s2`;
   - `bash bin/run-suites.sh --check-groups`;
   - `bash bin/verify-install-sync.sh`;
   - `node _shared/a1-tools.cjs lane-split check --plan .a1/phases/027-lean-pipeline-s2/PLAN.md --phase 027-lean-pipeline-s2`;
   - `node _shared/a1-tools.cjs plan depth-check --plan .a1/phases/027-lean-pipeline-s2/PLAN.md --phase 027-lean-pipeline-s2`;
   - `node _shared/a1-tools.cjs verify affected-map --check --phase 027-lean-pipeline-s2`.
7. Deleted-assert scan: `git diff --numstat origin/main...HEAD -- _test-fixtures/a1-xprov/parts _test-fixtures/a1-xprov/run-tests-b.sh _test-fixtures/a1-verify _test-fixtures/a1-pr-merge-check _test-fixtures/a1-suite-runner _test-fixtures/a1-workflow-lint _test-fixtures/a1-gates-lint/run-tests.sh _test-fixtures/a1-gates-lint/run-wave13.sh _test-fixtures/a1-gates-lint/run-wave14.sh | awk '{d+=$2} END{print d+0}'` = 0. a1-xprov (audit round 2 M1, owner Clarification): `git diff --name-only origin/main...HEAD -- _test-fixtures/a1-xprov` prints exactly `_test-fixtures/a1-xprov/run-tests-c.sh` and `_test-fixtures/a1-xprov/run-tests.sh`, and every hunk of `git diff -U0 origin/main...HEAD -- _test-fixtures/a1-xprov/run-tests.sh` starts inside old lines 417-443 (the shard block).
8. Size caps: `wc -l` at most 800 for every `_shared/lib/*.cjs` in `git diff --name-only origin/main...HEAD` and for `bin/run-suites.sh`.
9. Merge-check protection: `git diff origin/main...HEAD -- _shared/lib/pr-merge-check.cjs _shared/lib/verify-base.cjs _shared/lib/pr-ci-evidence.cjs _shared/lib/verify-host.cjs` is empty.
10. Narrowing, measured (D17):
    - (a) **Replay script.** Create `.a1/phases/027-lean-pipeline-s2/replay-narrowing.cjs` with the Write tool (at most 150 lines, `'use strict'`, Node stdlib plus the worktree's `_shared/lib/verify-affected.cjs`). Usage: `node .a1/phases/027-lean-pipeline-s2/replay-narrowing.cjs [--config <verify.json>] [--out <file>]`. Constants at the top: `END = '45ee7f1'`, `COUNT = 25`, `BASELINE = '.a1/phases/027-lean-pipeline/BASELINE.json'`, `MIN_NARROWED = 12`, `MAX_MEAN_S = 1306`. Behaviour:
      - commits: `git rev-list --first-parent --max-count=25 45ee7f1`;
      - per commit C: `changed` = `git diff --name-only -z --no-renames C^ C`; `exists(p)` = `p` is in `git ls-tree -r --name-only C`; `requirers` from `literalRequirers` on the worktree for the changed `.cjs`/`.js` files; `planIds` = the 62 ids of `BASELINE.json` with the a1-xprov rule of D17 (any current a1-xprov runner selected → both baseline xprov ids count); result = `selectAffected({changed, exists, cfg, planIds, requirers})` with `cfg` from `--config` (default `.a1/verify.json`);
      - seconds per commit: sum of `BASELINE.json` `verify_head_only.commands[].duration_ms / 1000` over the selected ids (all ids when full). A plan id without a baseline duration → exit 2 `baseline_missing:<id>`;
      - output JSON: `{ range: {end, count}, config, thresholds: {min_narrowed, max_mean_s}, commits: [{sha, subject, selection, reason, paths, selected: [ids], seconds}], totals: {narrowed, mean_selected_s, full_s: 1511}, pass }`, written to `--out` when given, else stdout; one summary line `narrowed <n>/25, mean selected <s> s of 1511 s, pass=<bool>` on stderr;
      - exit 0 when `narrowed >= 12 && mean_selected_s <= 1306`, else 1; usage errors 2.
    - (b) **Run.** `node .a1/phases/027-lean-pipeline-s2/replay-narrowing.cjs --out .a1/phases/027-lean-pipeline-s2/NARROWING.json; echo rc=$?`. rc=0 continues. **rc=1 is a STOP:** report `NARROWING.json` to the owner; do not change the thresholds, the map or the range to make it pass.
    - (c) **Red run** (logged, not committed): `node -e` writes `"$R/nomap.json"` = `.a1/verify.json` without `affected`; `node .a1/phases/027-lean-pipeline-s2/replay-narrowing.cjs --config "$R/nomap.json"; echo rc=$?` must print `narrowed 0/25` and `rc=1`.
    - (d) **Live sample** (audit B2). Pick the probe file first: `P_KEY=skills/a1-fix/` when `node -e` finds that key in `.a1/verify.json` `affected`; otherwise the first key in sorted order that starts with `skills/` and has a tracked `SKILL.md` under it. STOP when there is none. Then:
      ```bash
      git clone -q "$(git rev-parse --show-toplevel)" "$R/clone"
      git -C "$R/clone" checkout -q -b probe
      git -C "$R/clone" update-ref refs/remotes/origin/main HEAD
      printf '\n<!-- probe -->\n' >> "$R/clone/${P_KEY}SKILL.md"
      git -C "$R/clone" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qam probe
      test "$(git -C "$R/clone" diff --name-only origin/main...probe)" = "${P_KEY}SKILL.md"
      node _shared/a1-tools.cjs verify run --project "$R/clone" --affected --phase 027-lean-pipeline-s2 > "$R/live.json"; echo rc=$?
      ```
      The `test` line must pass before the run (a clone maps the source's local `main` to `origin/main`, so without `update-ref` the change set is the whole slice diff and D3 rule 5 forces full). Record `affected.selection` (must be `subset`), `affected.reason`, `selected/total` and `duration_ms.total` from `$R/live.json`.

    Both results go into STATUS.md next to the plan-time estimate (V10) and later into the PR text.
11. Commit `replay-narrowing.cjs` and `NARROWING.json` as `docs(027-s2): narrowing replay and measured result`.
12. Collect the RED-proof lines of all lanes into STATUS.md and check the count: Task 1.1 (5), 2.1 (6), 3.1 (8), 4.1 (5), 6.1 (4), 7.1 (1), 7.2 (8), 7.3 (3), 8.2 (2), 9.1 (4) = 46 lines. Also collect the `ACCEPTED-RED` lines of each lane.
13. Commit STATUS.md as `docs(027-s2): wave 10 integration status`. This is the final commit before review; `git status --porcelain` is empty afterwards.
**Done when:**
- every command in actions 3-12 meets its stated result;
- the carry-over commit lists exactly the 4 paths;
- `replay-narrowing.cjs` exited 0, its red run exited 1, and both files are committed;
- the live sample's `test` line passed and its selection is `subset`;
- STATUS.md has the 46 RED-proof lines, the `ACCEPTED-RED` lines, the five shard wall-clocks, the 5b fixtures-xprov wall-clock and both narrowing results;
- the tree is clean.
**Covers:** SC-6, SC-7, SC-8, SC-1..SC-5 (integration)

---

## Verification
After all waves, against the final branch head, cwd = worktree root. The red runs were executed on `main` @ `45ee7f1` on 2026-11-16 unless noted.
- [ ] V1 `verify run --affected` on a planted project exits 0 with `scope: "affected"`.
  - Red when: the flag is unknown.
  - Red run: planted one-command project in the scratchpad: exit 2, `unexpected argument "--affected"`.
- [ ] V2 `verify reuse --head <sha>` exits 0 after a green full run on a clean tree, still exits 0 after a commit that touches only `.a1/`, and exits 1 after a code commit (RU2, RU13, RU14).
  - Red when: the subcommand is not routed, or only the exact sha is accepted.
  - Red run: exit 2, the usage line lists only `run | check`. The exact-sha variant is RED-proof 3.1(f).
- [ ] V3 `verify check` on a PASS file whose `verify_run` has `scope: "affected"` exits 1 `scope_not_full`; the same file without `scope` exits 0 (legacy, BC1).
  - Red when: the refusal is missing, or a missing `scope` is refused (BC1 red).
  - Red run: the planted file (`.a1/phases/x/VERIFICATION.md`, `verdict: PASS`, record with `"scope":"affected"`) gave exit 0 `{"ok":true,"reasons":[]}`. The missing-scope side is RED-proof 2.1(d).
- [ ] V4 `bash bin/run-suites.sh --locale-native --check-groups` exits 0.
  - Red when: the option is unknown.
  - Red run: exit 2, `run-suites: unknown argument: --locale-native`.
- [ ] V5 `LC_ALL=en_US.UTF-8 bash _test-fixtures/a1-vault-cockpit/run-tests.sh` exits 0.
  - Red when: the harness globs in locale order.
  - Red run: rc=1, `parts/05b-writer.sh: line 247: H_LOCKS: unbound variable`. The en_US glob order is `05b-writer.sh 05c-writer-cmd.sh 05-hosts.sh`; the C order is `05-hosts.sh 05b-writer.sh 05c-writer-cmd.sh`.
- [ ] V6 `node _test-fixtures/a1-verify/check-timeout.cjs .a1/verify.json _test-fixtures/suite-groups.json` exits 0.
  - Red when: `timeout_ms` disagrees with `timings`.
  - Red run: the inline equivalent printed `timeout_ms 7200000 want 474000 DISAGREE`.
- [ ] V7 `grep -c 'fixtures-snapshot-locale-'` is at least 5 in `.github/workflows/test.yml`, `_test-fixtures/suite-groups.json` and `.a1/verify.json`.
  - Red when: a job, a groups entry or an evidence check is missing.
  - Red run: `0`, `0`, `0`.
- [ ] V8 `workflow lint` on the real tree exits 0 with `verify_scope_checked` 5. On a copy with `--affected` removed from 02-execute.md it exits 1.
  - Red when: the rule is missing.
  - Red run: the real tree has the per-wave call without `--affected`, and `workflow lint` exits 0 with keys `root,scanned,vault_sync_checked,findings` and 0 findings, so the defect passes.
- [ ] V9 `a1-xprov` R5j2 stays `ok` with the new jobs.
  - Red when: a job calls `--job` (the enforcement `needs` would have to change).
  - Red run: the R5j2 `needs07` program copied verbatim into the scratchpad, on a `test.yml` with one job inserted: `--job` → `missing: fixtures-snapshot-locale`, `--extra-job` → `ok`.
- [ ] V10 Narrowing (SC-6, D17): `node .a1/phases/027-lean-pipeline-s2/replay-narrowing.cjs` exits 0 (narrowed >= 12/25 **and** mean selected <= 1306 s), and the live sample in the clone has `affected.selection` `subset` after the one-file change set assertion passed.
  - Red when: fewer than 12 of 25 commits narrow, or the mean selected time exceeds 1306 s, or the live change set is more than the probe file.
  - Red run: on `main` there is no `affected` key, so every selection is full: 0/25 narrowed, 1511 s mean, and the replay exits 1. Wave 10 action 10c re-runs that red case with the committed script (`--config` without `affected`). For the live sample, the auditor measured that a plain clone gives `origin/main` = the source's local `main` (`45ee7f1`), so without `update-ref` the change set includes `.a1/verify.json` and the run is full.
  - Plan-time estimate (2026-11-16, aiserver; **not reproducible**, scratch builder not committed). Basis: all 62 suites traced on `45ee7f1`; 31 of them re-traced with cwd tracking; 0 unresolved paths except 1 in a1-probe (always selected). The replay of the same 25 commits gave:
    - Narrowing: 17 of 25 commits narrowed. 8 fall back to full: facade, runner, `suite-groups.json`, `.a1/verify.json`, `.github/`.
    - Mean selected time without an always-selected a1-intent: 1047 s of 1511 s (-31 %).
    - Mean selected time with a1-intent always selected (the aiserver env-red case of Wave 9 action 3): 1244 s of 1511 s (-18 %). The D17 pass line is this value plus 5 %.
    - **Not included in these numbers** (audit round 2 m2): the literal-requirer closure over every tracked JS file. Three JS-changing narrowed commits can flip to full with it (about +70 s on the mean, above the 1306 s line); a STOP from the committed replay is then the expected outcome, see D17.
    - Floor of a narrowed run: 641 s for a 2-file release commit (8 of 62 suites), 674 s for a typical phase close-out (18 suites).
    - Structural limit, measured. Both `a1-xprov` shards (622 s) and `a1-ux-studio` (249 s) list the repo root and read top-level files. `a1-ux-studio` also copies `_shared/lib`. So 0 of 66 `_shared/lib` families leave out all four big suites. Narrowing beyond this needs changes to those suites' harnesses, which spec 027 rules out ("no test content or assert changes").
    - `skills/a1-fix/` is a kept key in the plan-time map (11 of 62 suites), so the live sample's default probe is expected to be a subset.
- [ ] V11 `git diff origin/main...HEAD` of `pr-merge-check.cjs`, `verify-base.cjs`, `pr-ci-evidence.cjs` and `verify-host.cjs` is empty.
  - Red when: the merge-check path was edited.
  - Red run: `eyeball` of the Wave 10 action 9 output.
- [ ] V12 `bash bin/run-suites.sh` is green apart from `a1-intent` (within the recorded `ACCEPTED-RED.md` case set).
  - Red when: any other suite fails.
  - Red run: the 46 RED-proof mutations, each applied once on a scratch copy and logged (Task 10.1 action 12).
- [ ] V13 CI wall-clock bound (D14), on the first CI run of the PR head (`<run>` from `gh run list --branch <branch> --workflow test --limit 1`):
  ```bash
  gh run view <run> --json jobs --jq '[.jobs[]|{n:.name,d:((.completedAt|fromdate)-(.startedAt|fromdate))}] as $j | ([$j[]|select(.n=="fixtures-xprov" or .n=="fixtures-rest").d]|max) as $b | [$j[]|select(.n|startswith("fixtures-snapshot-locale-"))] | {bound:$b, jobs:map({n,d}), xprov:([$j[]|select(.n=="fixtures-xprov").d][0]), ok:(length==5 and all(.d <= $b) and ([$j[]|select(.n=="fixtures-xprov").d][0] <= 716))}'
  ```
  prints `ok: true` (five snapshot jobs, each within the bound; fixtures-xprov not longer than the pre-change median of 716 s), and all jobs have conclusion `success`. This is one sample (audit round 2 M1); the PR text says so and shows the D14 table next to it.
  - Red when: a snapshot job is missing, one runs longer than the longest existing fixture job of the same run, or fixtures-xprov got slower.
  - Red run: on run 43832982336 (`45ee7f1`) the command printed `{"bound":776,"n":0,"ok":false}` (no snapshot jobs). The comparison itself goes red when the bound is lower than the job: the same expression with fixtures-xprov as the job and fixtures-rest as the bound printed `{"bound":614,"ok":false}`.

Post-merge (spec SC that needs the next feature run, reported by a1-progress):
- Spec SC-002: on the next feature with the CI-evidence path, count the `verify_run` records: per-wave records all carry `scope: "affected"`, and at most one local `scope: "full"` record exists (Verify). Source: the wave reports and the `<git-common-dir>/a1-verify-reports/` files of that run. With the Clarification, P2 should report `verify reuse` exit 0 after Verify; record its `a1_only_commits`.

## Review and merge (merge dependency)
- Review path in this repo: `a1-specforge:a1-samuel-security` plus `a1-specforge:a1-reinhard-reviewer` only. `.a1/xprov.json` is `external_review: denied`: no Codex review, and nobody asks for or waives a permit.
- **Samuel must be spawned explicitly.** `xprov scope` reported `security_surface: false` for `verify-run.cjs` in slice 1, so `02-review.md` does not trigger him. He reviews the full PR diff before merge; this is a hard merge dependency (spec Dependencies: slices 1-3). Brief points:
  1. The four D2 layers and their order. `runVerify` throws on `affected`+`base` before any IO, and `verify check` evaluates scope last. A record without `scope` is accepted (D2c reasoning).
  2. The D3 fail-closed list, including `ci_evidence.unchanged` reuse and literal-requirer closure over every tracked JS file. Is any path class able to select a subset that misses a suite reading it? The D6 residual classes (bash `source`, Markdown, dynamic `require`, git-object reads).
  3. The `.git/a1-verify-reports` write path (D7): symlink refusal, 0600/0700, `wx`, prune regex, unlink on failure, no write with `--base`, no write in an intent child; the FR-008 "every run" deviation (m1).
  4. `verify reuse` (D8): the `.a1/`-only window (one shared helper with `verify check`), the 50-commit window, the mode/owner checks, and the trust limit (i)-(iii). It is consumed only by P2, never by merge-check or CI, and the ban lint covers `05-merge.md` and `pr-merge-check.cjs`.
  5. D11: `--extra-job` keeps `enforcement` unchanged. A red snapshot-locale job blocks CI evidence through `ci_evidence.checks` only when merge-check reaches `judge()` (m2).
  6. `bin/affected-trace.sh`: runs only the resolved plan ids, kills only its own PIDs, uses an isolated HOME, strips vault variables.
  7. Hostile-input cases AU12/AU13, AC13, RU11, AM6.
- `a1-specforge:a1-reinhard-reviewer` reviews the full diff once (via a1-pr-review).
- Every BLOCKER and MAJOR of both is fixed before `pr merge-check`. If a fix touches code read by the map, re-run Wave 9 actions 2-5 and Wave 10 action 10. A changed map means a changed `.a1/verify.json`, and the disposition below must then be redone.
- **CI.** After the first push (04-submit), the five `fixtures-snapshot-locale-*` jobs and fixtures-xprov must be green and V13 must print `ok: true` on the PR head; on a miss, follow D14 "On a miss" (re-shard, at most two rounds, then STOP to the owner; the bound is never relaxed). Record the five job times next to fixtures-xprov's and fixtures-rest's in the PR text. CI evidence is not used for this PR: `.github/`, the runner files and `suite-groups.json` changed (`protected_path_changed`), and so did `.a1/verify.json` (`verify_config_changed`).
- **Merge check.** It takes the long local path (about 50 min serial per BASELINE.json, quiet host per 05-merge.md 5.3). Expect `verify_config_changed` for `.a1/verify.json`. Add the `config_change` disposition for `suites.config_changed.fingerprint` per 05-merge.md 5.3, have Reinhard review it in the same round (not self-reviewed), commit, push and run once more. Expect the known aiserver `a1-intent` env-red to be handled the way 05-merge.md prescribes for host-specific reds. Never merge around a red reason.
- **PR text.** It names:
  - D2c: a record without `scope` stays accepted (legacy), and why;
  - the FR-008 deviation: the copy is written only without `--base` (m1);
  - the D8 rule (`.a1/`-only commits after the run, owner Clarification 2026-11-16) and the trust limit (i)-(iii) (m3);
  - the D11 rationale and its limit on merge-check fallback paths (m2);
  - the measured narrowing (`NARROWING.json` summary and the live sample) next to the plan-time estimate;
  - the five CI job times against the bound, the new fixtures-xprov time against the five pre-change runs, and that V13 is one sample;
  - the third a1-xprov runner file (owner Clarification 2026-11-16): the harness shard block and `ci_job_workers {"fixtures-xprov": 3}`, with the reason (D14 "Where the new runner goes"), and the re-measured a1-xprov `timings` entries;
  - the derived `timeout_ms` (expected 427500, was 474000 in the round-1 plan and 7200000 on `main`) and the a1-intent headroom note (D13);
  - that per-wave runs now miss changes the map does not cover until Verify/CI (D6);
  - follow-up (m8): the a1-disposition F1 guard ("no check CLI has a skip/ignore flag") scans a fixed list of 13 modules that does not include `verify-affected.cjs`, `verify-reuse.cjs` and `verify-affected-map.cjs`; extending it is an assert change and is left for a later item.
- After the merge (orchestrator, not Erik): `claude plugin update a1-specforge` on both hosts so the per-wave blocks pick up `--affected`, then remove the untracked copy of this phase folder from the primary checkout only after `git diff --quiet origin/main -- .a1/phases/027-lean-pipeline-s2` holds.

## Revision Notes
Revision 1 (2026-11-16), answering AUDIT.md (FAIL: 2 BLOCKER, 5 MAJOR, 9 MINOR) and the three owner Clarifications of 2026-11-16.

| Finding | Change |
|---|---|
| B1 `scope_missing` breaks BC1 | D2(c) now refuses only a present non-full `scope`; a missing `scope` is legacy full (auditor option a; the `tree_clean`-marker variant was considered and rejected in D2c). Task 2.1 action 3, AC12b (now an exit-0 control), AC12c, RED-proof 2.1(d) (proves BC1 goes red if the old rule came back), Done-when names BC1/BC2 and pins `cases-host.sh` unchanged. V3, SC-2, help text and PR text updated; the compatibility re-run note is gone. Depth Pass answer 1 lists BC1/BC2 as the fifth pinning assert. |
| B2 live sample always full | Task 10.1 action 10d: `update-ref refs/remotes/origin/main HEAD` in the clone, a `test` that the change set is exactly the probe file before the run, and a probe-key rule (`skills/a1-fix/`, kept in the plan-time map with 11/62 suites, else the first kept `skills/` key with a `SKILL.md`). |
| M1 reuse never hits | Owner Clarification applied: D8 walks the last 50 commits for the newest full report and accepts it when every later commit touches only `.a1/`, through `changedOutsideA1`, a new helper in `verify-check.cjs` that `checkVerification` also uses (one rule, E3b/E3c pin it). New cases RU13-RU16 (Verify then commit VERIFICATION.md then reuse exits 0; code commit exits 1; both commands agree; window limit), RED-proofs 3.1(f)/(g). P2 text, help text, SC-3, V2 updated. |
| M2 narrowing probe cannot go red | New D17: committed `replay-narrowing.cjs` plus `NARROWING.json`, fixed range ending at `45ee7f1`, pass line narrowed >= 12/25 and mean <= 1306 s (exit 1 otherwise, STOP to owner), executed red run with a map-less config; plan-time estimate labelled not reproducible. V10, SC-6 updated. |
| M3 +5 min allowance | Owner Clarification applied: D14 rewritten. Measured first: an xprov runner is not faster alone (319 s alone vs 295 s shared on 4 cores), so one-runner shards would meet the bound only by noise. Four jobs: `xprov-1`/`xprov-2` split both xprov runners by part through the harness's existing `A1_XPROV_ONLY` filter (sets sized from measured part times, dependencies kept together, about 410 s CI estimate), `heavy` (a1-intent, a1-ux-studio) and `rest`. Bound = longest existing fixture job of the same run (649-776 s on the last 5 runs), no allowance; a miss is re-sharded (at most two rounds), then a STOP that does not relax the bound. `ci_extra_jobs` takes per-job suite lists and `parts`, `part_splits` names the variable, and `--check-groups` checks exactly-once suite coverage and complete, disjoint part coverage (D10, D12, Task 7.2 E1/E10/E14/E16-E20, Task 8.1). `ci_evidence.checks` lists all four. New V13 (`gh run view` comparison, red run executed). The `--workers 4`/`--workers 3` iteration is gone. |
| M4 Task 8.2 tested `pathsChanged` only | Task 8.2 now calls `decide()` per entry with real `ci_evidence` and asserts `used:false, why:"protected_path_changed"`, with a `check_missing` control (CU8) and a RED-proof that removes the `unchanged` line from `decide`. The `pathsChanged` asserts stay as extra cases. |
| M5 certain per-wave reds | Execution location gains "Per-wave gate reds": accepted ids `a1-intent` (all waves) and `a1-vault-cockpit` (Waves 1-6 only), each after one recorded red-on-`main` comparison per lane with matching case names; anything else is a STOP. |
| m1 FR-008 "every run" | Named as a deviation in D7, the Samuel brief and the PR text. |
| m2 D11 limit | Stated in D11, the Samuel brief and the PR text. |
| m3 trust limit wider | D7 unlinks the target on write failure; D8 checks directory 0700 and file 0600 plus owner; trust limit (i)-(iii) named in D8, Samuel brief and PR text; RU7 (mode 644), RU17 (chmod 0500 then red run), RED-proof 3.1(h). |
| m4 requirer scan scope | `literalRequirers` scans every tracked `*.cjs`/`*.js` (D6, Task 1.1, AU11 with a `hooks/` file, RED-proof 1.1(e)). |
| m5 git-object reads | Added to the D6 residual list. |
| m6 `$R` in Wave 10 | Task 10.1 action 1 defines `R`; Execution location states that shell state does not carry across waves. |
| m7 counts | 31 suites re-traced (32 runs) in the Depth Pass and V10; "5 dynamic `require` sites in 4 files" in D6. |
| m8 F1 guard list | Named as a follow-up in the PR text (an assert change, out of scope here). |
| m9 eyeballed `verify.json` diff | Task 9.1 action 5: key-by-key `node -e` with exit code and a logged red run. |

Also changed: the RED-proof total is 39 (was 31); VS8 replaces the old RED-proof 6.1(b) wording so that mutation has a case that goes red; file-mode reads in `cases-reuse.sh` use `node` instead of `stat` (GNU/BSD split).

Revision 1b (2026-11-16, orchestrator decision before re-audit): the `A1_XPROV_ONLY` part split from the M3 row above is withdrawn. `run-tests.sh:483-486` fails any run with `A1_XPROV_ONLY` under `$CI`, and line 465 switches off the parts self-check under the filter; the first plan revision missed both. D14 now uses one job per official a1-xprov shard file (`xprov-a`, `xprov-b`), plus `heavy` and `rest`, harness unchanged. `part_splits`/`parts` are gone from D10, D12, Task 7.2 (E17-E20 replaced by one E17 ban case, RED-proofs back to 7) and Task 8.1; `--check-groups` now reports `A1_XPROV_ONLY` in an extra job block. The per-job estimate comes from the CI timings of the last 5 runs and says openly that `xprov-a` sits at the bound whenever fixtures-xprov is the longest job. The only allowed rebalance is `XP_SHARD_B`, with its measured limit; after that, STOP to the owner. RED-proof total 39.

Revision 2 (2026-11-16, after audit round 2 FAIL; final planner round, owner Clarification "third runner file"):

| Finding | Resolution in PLAN.md |
|---|---|
| B1 `--check` and MR2 need `.git` | Task 4.1 action 1 (`--check` falls back to a disk walk that skips `.git`, prints `tracked_source`), new AM5b and RED-proof 4.1(e); Task 9.1 action 8 MR2 calls the pure `selectAffected` with planted `changed`, `exists: () => true`, `requirers: new Map()`, RED-proof 9.1(c); Task 10.1 action 5 names MR1/MR2 in the snapshot rehearsal. |
| M1 `xprov-a` at the bound | Owner decision applied: D14 rewritten (three shards balanced by measured part times, 218/218/217 s, dependency groups kept; the new runner joins `ci_jobs.fixtures-xprov` with `ci_job_workers {"fixtures-xprov": 3}` so the existing call line and `needs` stay byte-identical and fixtures-xprov gets shorter; rejected placements stated; CI-based estimate table, margin 102-305 s, worst case about 52 s at 10 % imbalance). D12 adds `ci_job_workers`; Task 7.2 implements it (E18, E19, RED-proof (h)); new Task 7.3 (harness shard block 417-443, `run-tests-c.sh`, `suite-groups.json` `ci_jobs`/`ci_job_workers`/`timings`, README N1 count, CONTRIBUTING); Task 8.1 five jobs; Task 9.1 five `ci_evidence.checks` names; D13/SC-5/Task 9.1 action 4 derive `timeout_ms` from the re-measured timings (expected 427500); D17 replay keeps the 62 baseline ids with a conservative a1-xprov rule. The `XP_SHARD_B`-only rebalance and its contradiction are gone: SC-4, the no-assert-change rule, the Rewritten brief and Task 10.1 action 7 now allow exactly the shard block plus `run-tests-c.sh`; D14 "On a miss" moves parts between the three lists. V13 checks five jobs and that fixtures-xprov did not get slower, and is labelled one sample; Task 10.1 action 5b rehearses the three-worker job on 4 cores. Runner lane `owns` adds the two a1-xprov runner files, `README.md`, `CONTRIBUTING.md`. Checked: R5j-R5j4 and GL5 read `test.yml` lines that do not change; `rs_check_groups` needs the new runner in exactly one `ci_jobs` entry and in `timings` (Task 7.3 action 3); `verify.json` `each` picks it up automatically (63 plan ids; Task 4.1 Done-when no longer hard-codes 62). |
| m1 RU13/RU14 vacuous, cached red | Task 3.1 RU13 seeds `verdict: PASS` and asserts no `note`; RU5 commits the red stub (new sha); RU17 uses a flag-file stub and `--no-cache`. |
| m2 threshold vs closure | D17 and V10 state that the plan-time estimate excluded the requirer closure and that a STOP is the expected outcome if it pushes the mean over 1306 s; threshold unchanged. |
| m3 phantom phases | All gate calls use `--phase 027-lean-pipeline-s2` (Tasks 5.1, 6.1, 9.1, 10.1, live sample); rule added to Execution location. |
| m4 per-lane main runs | "Per-wave gate reds" point 2: one `main` comparison for the phase (slug `027-s2-main-compare`), recorded in a committed `ACCEPTED-RED.md` before the lanes fork; point 3: subset rule plus one quiet re-run for a1-intent's load-dependent cases; Task 10.1 action 4 reuses it (other reds: slug `027-s2-main-compare-w10`). |

RED-proof total: 46.
