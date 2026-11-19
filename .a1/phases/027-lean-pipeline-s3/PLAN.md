---
phase: 027-lean-pipeline-s3
goal: Ship delivery slice 3 of spec 027-lean-pipeline as one independently mergeable PR. `pr merge-check` runs the base side lazily (head first; base only for commands red on head or with a counting reporter). On the long path it runs the suites in parallel through a runner taken from the base sha, with its groups file read from the runner's own tree. It reads only a validated per-suite JSON result, retries serially after the base comparison, and maps a hang to `timeout`. Every local `verify run` waits on a CLI lock instead of the hand-run quiet-host poll. All FR-012 protections and existing asserts stay unchanged.
spec: /home/rob/N3URAL-Vault/project/a1-specforge/spec/027-lean-pipeline.md (slice 3 only - US-027-3, US-027-4, FR-011..FR-018, SC-003, Acceptance Scenarios US-027-3/US-027-4, Edge Cases "runner edited / set differs / hang / lock held / snapshot runs", Delivery Slices item 3); RESEARCH.md Decision 1 answer (a), owner 2026-11-18
waves: 9
lanes:
  - id: verify
    waves: [1, 2]
    owns:
      - "_shared/lib/verify-run.cjs"
      - "_shared/lib/verify-lock.cjs"
      - "_shared/lib/pr-merge-check.cjs"
      - "_test-fixtures/a1-verify/**"
      - "_test-fixtures/a1-pr-merge-check/**"
    agent: a1-erik-executor
  - id: runner
    waves: [3, 4]
    owns:
      - "bin/run-suites.sh"
      - "bin/run-suites-proc.sh"
      - "bin/run-suites-report.sh"
      - "_test-fixtures/a1-suite-runner/**"
    agent: a1-erik-executor
  - id: lint
    waves: [5]
    owns:
      - "skills/a1-pr-review/workflows/05-merge.md"
      - "skills/a1-new-feature/workflows/06-verify.md"
      - "skills/a1-new-feature/workflows/05-implement.md"
      - "skills/a1-execute/workflows/02-execute.md"
      - "skills/a1-execute/workflows/03-verify.md"
      - "_shared/lib/workflow-lint.cjs"
      - "_shared/lib/workflow-lint-verify.cjs"
      - "_test-fixtures/a1-workflow-lint/**"
    agent: a1-erik-executor
sequential_after_lanes: [6, 7, 8, 9]
status: revised
created: 2026-11-18
revised: 2026-11-18
phase_kind: code
---

## Depth Pass

### 1 What a top professional would do
A build-and-test-infrastructure engineer from the remote-execution school (Bazel/Buildbarn executors, sharded CI test runners) would treat this slice as three separate problems:
- **The scheduler change.** Lazy base and the parallel runner may change only *when* things run, never the verdict. They would prove this per command against the one verdict function (`vb.settle`). They would also look for every existing assert that pins today's eager behaviour before choosing where the new order applies. This plan found two binding pins on the no-cache CLI path: `a1-verify` VD2 (`cases-durations.sh:17`, `--base main --no-cache`, integer `duration_ms.base` on a green head) and `a1-metrics` PT0 (`parts/06-phase-time.sh:130`, CLI `--base --no-cache`). So the lazy order is scoped to `pr merge-check` (D1). K1/K1b/K2/K3/K3b/K6 run with the cache and would stay eager under D1's `noCache` condition anyway, so they are not the reason.
- **The runner contract.** The runner is a separate executable with a versioned wire contract: a handshake line, a strict JSON schema, a set equality between requested and returned ids, and fail-closed on any deviation. The executable and its configuration come from the trusted side (base), never from the code under test. Logs are diagnostics and never evidence.
- **The lock.** It reuses the proven design next door (`rs_lock_*`: atomic mkdir, PID-reuse proof by command line, takeover under a guard). It measures who nests (six suites execute `verify run`/`merge-check`, not the four the spec lists) and it makes sure fixture runs can never block on a developer's real lock. It also decides how a wait surfaces: a held runner lock is part of the measured `lock_wait_ms` and its timeout is `lock_timeout` (D18), and a busy host is never reported as a red gate (D19).

Before claiming SC-003 they would measure the long path on the baseline host, not estimate it. They would also make every new check executable red once.

### 2 Rawest material
- Source on `main` @ `bc47b07`, read for this plan:
  - `_shared/lib/verify-run.cjs` 561 lines: `runCommand` 268, `commandReason` 288, `runBaseSide` 343, `runHeadSide` 356, `runVerify` 496-557, `SUITE_ENV_DROP` 38, `spawnGroup` 262, `groupRunnerMain` 243.
  - `verify-base.cjs`: `settle` 213, `isRetryable` 201 (not exported), `NEVER_PRE_EXISTING` 28, `RETRYABLE` 32, `withSnapshot` 111.
  - `pr-merge-check.cjs`: `mergeCheck` 232-264, with `runVerify` at 240 and `ciDecision` before it.
  - The runner: `bin/run-suites.sh` 756 lines (`rs_load_groups` 163, `rs_discover` 185, `rs_on_suite_done` 447, `rs_*_post` 550-645, `rs_main` 647). `bin/run-suites-proc.sh` 456 (`rs_spawn_worker` 63, `rs_reap` 127, `rs_wait_any` 151, `RS_LOCK_RUNNER_NAME` 212, `rs_lock_takeover` 367, `rs_lock_acquire` 409). `bin/run-suites-report.sh` 140 (`rs_load_nocount` 39 also reads `$RS_ROOT/_test-fixtures/suite-groups.json`).
  - `workflow-lint-verify.cjs` and `workflow-lint.cjs` 404-418.
  - `skills/a1-pr-review/workflows/05-merge.md` 63-74 (the only non-bash fence of the file) and `skills/a1-new-feature/workflows/06-verify.md` 78.
- Pinning asserts, read in full:
  - `a1-verify` K1-K6 (`run-tests.sh:383-408`) and VD1/VD2 (`cases-durations.sh:12-20`).
  - `a1-metrics` PT0 (`parts/06-phase-time.sh:129-131`).
  - `a1-pr-merge-check` F1 (`run-tests.sh:286-287`, `cache` `off|off`), CE helpers `ci_pr`/`ce`/`mcp` (`run-tests.sh:520-533`).
  - `a1-pr-review` `run-tests.sh:326-333`: 05-merge.md must keep at least one non-bash fence, and none of them may hold `exit` or `gh pr merge`.
  - `a1-suite-runner` part 03 (env asserts are per variable) and part 06 (lock helpers).
- Measured caller list for FR-018 (`grep` of executed calls, not text). These suites execute `verify run` or `pr merge-check`: `a1-verify`, `a1-pr-merge-check`, `a1-disposition` (`run-tests.sh:224`), `a1-exit2-audit` (`:54-101`), `a1-metrics` (`parts/06-phase-time.sh:129-130`) and `a1-probe` (`parts/03-merge-guard.sh:26`). The spec's list of 2026-11-12 is missing the last two.
- `BASELINE.json` (slice 1, aiserver, 24 cpus): long-path merge-check, serial: `total_ms 2990052` (49.8 min), `head_ms 1506026`, `base_ms 1483995`. `suite-groups.json` timings: 62 suites, sum 1268 s, max 285 s.
- Red probes executed on 2026-11-18 against `bc47b07` (scratchpad), quoted in Verification:
  - A green head under `runVerify({base, noCache, lazyBase: true})` still spawned the base side (`spawns=2 base_spawns=1`).
  - Each of the five new runner options exits 2 with `unknown argument`.
  - `verify-lock.cjs` is missing.
  - `skills/` holds 2 `pgrep` lines, and `workflow lint` exits 0 with 0 findings.
  - A planted assert deletion shows `deleted=1` in `--numstat`.
  - `verify-base.cjs` does not export `isRetryable`.
- Measured during revision 1 (2026-11-18, scratchpad):
  - `bash -c 'sleep 3' run-suites.sh &` shows `sleep 3` in `ps -o command=` (bash 5.3.9 execs a single command), so a fake runner holder of that shape loses the runner name. `bash -c 'sleep 3 & wait' run-suites.sh` keeps it, and a `trap ... TERM` form ends its child on TERM (D21).
  - The numstat probe `awk '{d+=$2} END {exit d+0}'` gave rc=0 on a planted repo with 256 deleted lines; the corrected probe gave `deleted=256 rc=1`.
  - `skills/a1-execute/workflows/02-execute.md:151` and `skills/a1-new-feature/workflows/05-implement.md:273` print `STOP: gate-1-build red (verdict fail or no test command)` for every non-zero exit; `lock_timeout` occurs 0 times in 02-execute.md, 03-verify.md, 05-implement.md and 06-verify.md.
  - The D19 STOP line applied to both files on a `git archive` copy: `check-wave11-callsites.cjs` `calls=15` rc 0, `workflow lint --root` rc 0, `a1-workflow-lint` 29 passed, `a1-gates-lint` 90 passed.

### 3 Methods and tools
- **Equivalence argument per command** (D1): `settle` reads `baseIds` only when the first run failed, and `applySkipIncrease` only for counting reporters. So running base exactly for "red on head" plus "counting reporter" yields the identical settled record. Fixtures LZ1-LZ7 pin it, plus a control that the CLI path stays eager.
- **Spawn-count seam** `A1_VERIFY_SPAWN_LOG`: one line per spawned command, with a side label. It is used for "zero base commands" and "exactly one", and for the head, base and retry ordering.
- **Base-sourced runner**: `git archive <base> <4 runner files>` into a private temp dir, a `--contract` handshake, `--groups-file` from that tree, and `--root` on the head or base `git archive` snapshot.
- **Fake base runner**: the planted base commit carries a scripted runner that honours the contract and writes a canned JSON. It is used for set mismatch, leak note, exit 2, log-claims-pass and hostile JSON. A marker-file edit in the head proves the head runner never runs, with a control that the edited script does create the marker when run directly.
- **Strict JSON validation**: `lstat` (no symlink), a 1 MiB cap, a per-field type check, unique ids, set equality, and the consistency rules of D7.
- **Lock**: atomic `mkdir`, an owner file written by tmp+rename, liveness checked with `kill(pid,0)` plus an exact `ps -o command=` match recorded at acquire time, takeover under a `mkdir` guard by rename-away, a synchronous sleep through `Atomics.wait`, and release only while the token matches.
- **Bash 3.2-safe watchdog and lock wait**: the watchdog on `SECONDS` (up to 1 s late, documented in D10), the lock-wait deadline in ms from `node` `Date.now()` (D21), and `sleep 0.5`/`0.1` polling. No `timeout(1)`, no `wait -n`, no `date +%N`.
- **Process checks**: `lane-split check`, `plan depth-check`, `bash -n`, the `wc -l` caps, a `git diff --numstat` deletion check (new `bin/check-assert-deletions.sh`), `workflow lint`, `gates lint`, and RED-proof mutations on `git archive` scratch copies.
- **Measured rehearsal** of the runner long path on aiserver in a scratch clone whose base already carries this slice's runner, with `host_load` recorded.

### 4 External evidence of correctness
- The fixture suites through `bash bin/run-suites.sh` and through GitHub Actions on GNU/Linux. New: `a1-verify` `cases-lazy.sh`, `cases-lock.sh`, `cases-runner-contract.sh`, `cases-runner-path.sh`, `cases-runner-retry.sh`, `cases-assert-deletions.sh`; `a1-pr-merge-check` `cases-lazy.sh`, `cases-lock.sh`, `cases-runner.sh`; `a1-suite-runner` parts 17-20; `a1-workflow-lint` `cases-quiet-host.sh`. Existing and unchanged in every assert: `a1-verify`, `a1-pr-merge-check`, `a1-suite-runner`, `a1-pr-review`, `a1-metrics`, `a1-disposition`, `a1-exit2-audit`, `a1-probe`, `a1-workflow-lint`, `a1-gates-lint`.
- `bin/check-assert-deletions.sh --base origin/main` exits 0 (zero deleted lines in `_test-fixtures/a1-pr-merge-check` and `_test-fixtures/a1-verify`).
- The measured long-path rehearsal (`LONG-PATH-REHEARSAL.json`, aiserver) at or below 900000 ms, against the measured 2990052 ms in `BASELINE.json`.
- `a1-samuel-security` (hard merge dependency) and `a1-reinhard-reviewer` on the final diff. Then this PR's own `pr merge-check` (installed plugin, serial path) green.

### Rewritten brief
Plan one PR for spec 027 slice 3 (FR-011..FR-018), in this order:
- lazy base;
- runner contract (`--contract`, `--json-out`, `--groups-file`, `--lock-wait`, `--suite-timeout-ms`);
- base-sourced runner path;
- serial retry after the base comparison, watchdog and environment equality;
- the CLI lock, which replaces the quiet-host poll.

**Lazy base (FR-011).** It applies where the spec's scenario applies: `pr merge-check`, through `runVerify({lazyBase: true, noCache: true})`. The `verify run --base` CLI stays eager, because VD2 and PT0 pin a base run on a green head under `--base --no-cache` and FR-012 forbids changing them (D1). The order is head first, then base only for commands red on head or with a counting reporter, then settle with the retry. A spawn seam counts it.

**Runner path (FR-013..FR-016).** It runs only from merge-check, only for an eligible plan (every command `bash <_test-fixtures id>`, reporter `none`, no `requires_host`, one timeout), and only when the base sha holds a runner that answers the contract handshake. Otherwise the run falls back to the lazy sequential path, and the record says why. Rules:
- The runner and its groups file come from the base sha.
- Evidence is only the validated JSON in a verify-owned temp dir. The id set must match, and a leak note fails the command.
- Runner exit 2 maps to merge-check exit 2 with the reason passed through; a runner lock held past the wait bound is `lock_timeout` (D18), anything else `suite_runner_failed`.
- Red wins over any log.
- Skipped snapshot checks are named.
- Retries run once, serially, after the base comparison.
- A hang is `timeout`, never pre-existing.
- Both sides run with one identical environment object.

**Lock (FR-017/FR-018).** It covers every local `verify run`:
- A per-uid lock dir with seams and a 15-minute ceiling: exit 2 `lock_timeout`, and `lock_wait_ms` in the record.
- On the long path the runner's own lock wait counts toward the same ceiling and the same `lock_wait_ms` (D18).
- The workflow gate blocks report exit 2 `lock_timeout` as "host busy, re-run", never as a red gate, and per-lane gates run one after another (D19).
- Re-entrancy by token. The runner keeps the token, and when no token is present it gives each worker a private lock dir, so fixture runs never block on a real lock.
- No lock on the CI-evidence path.
- The pgrep/WAIT poll text leaves 05-merge.md and 06-verify.md. The load-record line and the re-run-on-quiet-host rule stay (owner decision 2026-11-18).
- A `workflow lint` rule flags any fenced `pgrep` under `skills/`.

**Hard constraints:**
- No existing assert changes. New cases go into new `cases-*.sh` files or new runner parts. A numstat script proves zero deleted lines in the two merge-check suites.
- `.a1/verify.json` and `_test-fixtures/suite-groups.json` stay byte-identical, so there is no config disposition.
- No new runner file.
- Lib modules stay at or below 800 lines, and so does `bin/run-suites.sh` (at most 775 after Wave 3; the option helpers live in `bin/run-suites-proc.sh`, D20).
- No Codex (repo `external_review: denied`).
- Samuel and Reinhard review before merge.
- One serial merge-check (~50 min) after the review fixes.

Three lanes (verify, runner, lint), then four sequential waves.

# Plan: 027-lean-pipeline-s3

## Goal
Ship delivery slice 3 of spec 027-lean-pipeline as one independently mergeable PR. `pr merge-check` runs the base side lazily (head first; base only for commands red on head or with a counting reporter). On the long path it runs the suites in parallel through a runner taken from the base sha, with its groups file read from the runner's own tree. It reads only a validated per-suite JSON result, retries serially after the base comparison, and maps a hang to `timeout`. Every local `verify run` waits on a CLI lock instead of the hand-run quiet-host poll. All FR-012 protections and existing asserts stay unchanged.

## Execution location (read first)
- All work runs in the a1-worktree `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s3/` on its own feature branch, created by a1-execute through `a1-specforge:a1-worktree` (never a raw `git worktree add`). Lanes get their own worktrees from a1-execute.
- The primary checkout `/home/rob/claude-projects/a1-specforge` is on `main`. Its only untracked content is this phase folder. Nothing in this plan writes there.
- Every command and every Done-when probe runs with cwd = the worktree root and uses repo-relative paths. Every `a1-tools.cjs` gate call passes `--phase 027-lean-pipeline-s3`.
- `origin/main` means the remote main after `git fetch origin main`. Run that fetch once at the start of Waves 8 and 9.
- Shell state does not carry across waves or agents. Every wave defines its own temp variables before use.
- **Per-wave gate.** It runs the installed plugin's `verify run --affected --phase 027-lean-pipeline-s3` (plugin 1.17.0 has `--affected`; it takes no lock and has no runner path). Every wave that edits `bin/` selects the full set (`runner_or_config_changed`); that is expected.
- **Per-wave reds.** Memory and PR #103 (2026-11-18) say aiserver has no env-red suite left, so any red id is suspect:
  1. Re-run that suite alone once on a quiet host.
  2. Still red: run it once on `main` in an a1-worktree `027-s3-main-compare` (`worktree prepare ... --base main`, `enter`, run, `exit --mode discard`).
  3. The same failing case names on `main` mean the red is not this slice's. Record them in `STATUS-<lane>.md` and continue.
  4. Anything else is a STOP.
- **Fixture isolation, mandatory in every new case file.** Every case that runs `verify run`, `runVerify` or `pr merge-check` exports:
  - `A1_VERIFY_LOCK_DIR="$WORK/vl-<case>/lock"` (parent created first);
  - `A1_SUITE_LOCK_DIR="$WORK/rl-<case>"` whenever a real or fake runner can start;
  - and runs `unset A1_VERIFY_LOCK_TOKEN` unless the case tests the token.

  Each new case file ends with the **real-lock leak assert** on the real locks (`$(node -p 'require("os").tmpdir()')/a1-verify-lock-$(id -u)` and `/tmp/a1-suite-runner-$(id -u)`). At file start it records whether each lock is present. At file end it is red only when:
  1. the lock is present and its owner PID is this suite's shell or a descendant of it (walk `ps -o ppid=` up to PID 1), or
  2. the lock was absent at start and is now present with a dead owner PID.

  A lock held by any other live process (another session's real `verify run` starting or ending meanwhile) is not red (audit m13).
- **Numstat deletion check.** Done-when lines name it until `bin/check-assert-deletions.sh` exists (Wave 9). Run it after the task's commit:
  ```bash
  git diff --numstat origin/main...HEAD -- _test-fixtures/a1-verify _test-fixtures/a1-pr-merge-check | awk '{d+=($2=="-"?1:$2)} END {print "deleted="d+0; exit (d>0)}'
  ```
  Red when: any line in the two directories was deleted or edited. Red run (2026-11-18, planted scratch repo, 256 deleted lines): `deleted=256 rc=1`; on the base side of the same repo `deleted=0 rc=0`. The earlier form `awk '{d+=$2} END {exit d+0}'` gave rc=0 for those 256 lines (the exit status wraps mod 256, audit m2).

## RED-proof rule (applies to every task)
Each task lists RED-proof mutations. Apply each one once on a scratch copy after the task's own commit:
```bash
S=$(mktemp -d); git archive HEAD | tar -x -C "$S"
git -C "$S" init -q && git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm snap
```
Then apply the one mutation with Edit, run the named suite there and watch the named case go red. Log one line per mutation in `STATUS-<lane>.md` (sequential waves: `STATUS.md`): `RED-proof <task> <mutation> -> <case> red (rc=<n>)`. A mutation that does not turn its case red is a fixture defect: fix the fixture, never drop the line. A case that would hang on its mutation runs under a background kill after the stated bound and counts as red when killed.

**No-assert-change rule.** No existing `ok`/`bad`/`check`/`check_rc`/`expect`/`assert_*`/`pass_case`/`fail_case` line in any suite is deleted or edited. New cases go into new files. The only edits to existing fixture files are one appended `. "$(dirname "${BASH_SOURCE[0]}")/cases-<name>.sh"` line per new case file, placed after the last existing source line of that runner. Runner parts are picked up by the parts glob and need no edit.

**Fixture-repo rule.** Every planted git repo uses the suite's own `g` helper (per-repo identity, `commit.gpgsign=false`), holds its temp dir from `mk_workdir` (or the suite's `$WORK`), and sets or unsets `A1_VAULT_ROOT` explicitly.

## Lane decision
Three lanes. Write sets come from the task actions below. `lane-split check` exit 0 is required.
- **verify** (Waves 1-2): lazy base and spawn seam, then the lock module and its hook, both merge-check report fields, and the a1-verify and a1-pr-merge-check cases.
- **runner** (Waves 3-4): the runner contract options, then lock wait, the watchdog and the per-worker verify lock dir, with a1-suite-runner parts 17-20.
- **lint** (Wave 5): the FR-017 text in 05-merge.md and 06-verify.md, the `quiet-host-poll` rule and its cases, and the D19 exit-2 routing of the workflow gate blocks (02-execute.md, 05-implement.md, 03-verify.md, 06-verify.md).

Lanes only read each other's files. The runner lane writes the JSON contract and the lock-dir variable that the verify side reads, and this plan fixes both byte for byte (D7, D12), so no lane depends on another lane's code at build time. Waves 6-9 run after the lanes because the runner path (6-8) needs the contract (lane runner), the lock (lane verify) and `verify-run.cjs` (lane verify). Wave 9 is integration.

Realistic yield: 5 lane waves, longest lane chain 2, so the three lanes finish in about the time of two waves. Waves 6-9 (about two thirds of the code risk) stay serial. Every wave also pays the per-wave gate run of the installed plugin (full set whenever `bin/` changed: about 25-30 min serial on aiserver, BASELINE.json).

## Decisions (made in this plan, each tested)
- **D1 Lazy base is scoped to merge-check.** `runVerify` takes the lazy order only when `opts.lazyBase === true && opts.noCache === true && sel.compareBase`. `mergeCheck` passes `lazyBase: true` (it already passes `noCache: true`). The `verify run --base` CLI keeps the eager order and stays byte-for-byte in behaviour.
  - **Why (revised, audit m1).** The binding pins are the two no-cache CLI asserts: `a1-verify` VD2 (`cases-durations.sh:17`, `--base main --no-cache`, "base_duration_ms integers, duration_ms.base integer") and `a1-metrics` PT0 (`parts/06-phase-time.sh:130`, CLI `--base --no-cache`, `Number.isInteger(j.duration_ms.base)`). Both run a green head with reporter `none`. A lazy CLI would make `duration_ms.base` null there and turn them red, and FR-012 plus Out of Scope ("asserts of existing suites") forbid changing them. K1/K1b/K2/K3/K3b/K6 (`run-tests.sh:383-408`) run `--base main` **with** the cache, so under D1's own `noCache === true` condition they would stay eager even with a lazy CLI; they are not the reason. FR-011's own fixture and acceptance scenario are merge-check ("When merge-check runs with `--base`").
  - The PR text names the scoping as the reconciliation of FR-011 with FR-012 and flags it as an FR-011 narrowing ("merge-check only") for the owner's separate spec reconcile. This phase does not run `a1-reconcile` and does not edit the spec.
  - **Requiring `noCache`** keeps the cache out of the lazy path entirely. A partial base result is never written under a full command hash.
- **D2 What the lazy path runs on base.** The base-plan commands whose head first run has `reason !== null`, plus every base-plan command with `kind !== 'none'` (counting reporter: skip-increase needs the base count). The base snapshot is extracted only when that list is non-empty. A head command that is not in the base plan (a new suite) settles against an empty set, exactly as today (`ctx.baseIds.get(c.id) || new Set()`).
  - **Equivalence argument:**
    - For a green first run, `settle` returns `reason: null` and no flaky or pre-existing ids whatever `baseIds` holds (`verify-base.cjs:213-227`).
    - For a red first run, base ran.
    - `applySkipIncrease` judges only numeric `skipped` on both sides, which only counting reporters produce.
    - The record gains `base_run: {mode: "lazy", ran: [ids], of: <base plan size>}`. `duration_ms.base` is null when nothing ran on base. `cache` stays `{head: "off", base: "off"}` (F1 pin).
- **D3 Spawn seam.** When `A1_VERIFY_SPAWN_LOG` is set to an absolute path, `runCommand` appends `<label>\t<id>\n` before it spawns (`h<i>` head first run, `b<i>` base, `r<i>` retry). The runner path appends `runner:<side>\t<id>\n` once per requested id per runner call (`side` = `head|base|retry`). A relative or empty value is ignored. It is a test seam only, set only by fixtures; the help text does not advertise it.
- **D4 Runner path, when.** `runVerify` takes it only when `opts.runner === true` (only `mergeCheck` passes it) **and** the lazy path applies (D1) **and** the plan is eligible. Eligible means:
  - `plan.source === 'verify.json'` and `plan.skipped` is empty;
  - every base-plan and head command has `kind === 'none'` and no `requiresHost`;
  - its argv is exactly `['bash', id]`;
  - its id matches `^_test-fixtures/[A-Za-z0-9._/-]+$` without a `..` segment;
  - all commands share one `timeoutMs`.

  A plan that is not eligible takes the lazy sequential path with `runner_source: "none"`, `runner.fallback: "not_eligible"` and `runner.why` = the first failing rule.
- **D5 Runner source.** Only the base sha, never the installed a1-tools; FR-014 allows either, and base is the stricter choice. `prepareRunner`:
  1. `git -C <project> archive --format=tar <baseSha> bin/run-suites.sh bin/run-suites-proc.sh bin/run-suites-report.sh _test-fixtures/suite-groups.json`, extracted into `fs.mkdtempSync(<os.tmpdir()>/a1-verify-runner-)`. The file name `run-suites.sh` stays, because the runner lock's liveness test (`RS_LOCK_RUNNER_NAME`) needs it. A failed archive (any file missing at base) gives fallback `base_copy_missing`.
  2. `bash <dir>/bin/run-suites.sh --contract` (cwd `<dir>`, the runner env of D9, 30 s timeout): stdout trimmed must equal `a1-suite-runner-contract 1`, else fallback `no_contract`. This is what main before this slice answers (`unknown argument`, exit 2), so the slice's own merge-check falls back.

  The fallback is the lazy sequential path (FR-014 "falls back to the sequential `runVerify`"). `ci_evidence.used=false` and `noCache` are unchanged because both are decided before `runVerify`.
- **D6 Groups file from the runner's tree.** New runner option `--groups-file <abs path>`. `rs_load_groups` and `rs_load_nocount` read it instead of `$RS_ROOT/_test-fixtures/suite-groups.json`; the default is unchanged. The long path always passes `<runner dir>/_test-fixtures/suite-groups.json`. `--groups-file` with `--check-groups` exits 2.
- **D7 The JSON contract.** Single writer: `rs_write_json_out` in `bin/run-suites-report.sh`. Single reader: `readRunnerResult` in `_shared/lib/verify-runner-path.cjs`. Exact shape:
  ```json
  {"contract":1,"root":"<RS_ROOT>","subset":true,"workers":3,
   "lock_wait_ms":0,
   "results":[{"id":"a1-x/run-tests.sh","exit_code":0,"signal":null,"timed_out":false,"seconds":12,"leak_note":"","summary_note":""}],
   "checks":{"reconcile":"not_selected","learnings":"skipped_nogit","phases":"skipped_nogit"}}
  ```
  - `exit_code` is the suite's status when it is 128 or below, else `null`.
  - `signal` is `"SIG" + $(kill -l <rc-128>)` when the status is above 128, else `null`.
  - `leak_note` is `"wrote into its sentinel vault"` or `""`.
  - `summary_note` is `"no assert summary"` or `""`.
  - `timed_out` is true when the watchdog ended it.
  - `lock_wait_ms` (top level) is the runner's measured wait for its own lock in ms, 0 without a wait (D18, D21).
  - Each check state is one of `not_selected|skipped_nogit|skipped_dirty|ok|failed`.
  - The writer creates `<file>.tmp.<pid>` with flag `wx` and mode 0600, then renames it onto `<file>`.

  Reader rules (any miss: VerifyError `runner_result_invalid`, exit 2):
  - `lstat` gives a regular file, not a symlink, at most 1 MiB;
  - JSON with exactly those key types; `contract === 1`; ids unique;
  - `seconds` and `lock_wait_ms` non-negative integers; `exit_code` an integer or null; `signal` null or `^SIG[A-Z0-9]+$`;
  - check states from the list.

  Then, in order:
  1. A requested-vs-returned set difference gives `runner_result_mismatch`, exit 2. The message names up to 5 missing and 5 extra ids.
  2. Runner exit 1 while no result fails (exit_code, signal, timed_out, leak_note), no `summary_note` is set and no check is `failed` gives `runner_result_invalid`.
  3. Runner exit 0 with a failing result is **not** an error: red wins (FR-016).

  The runner's stdout and stderr go to files in the verify temp dir. Stdout is never read. Stderr is read only for the exit-2 message (D16).
- **D8 Mapping a runner result to a command record.** `{id, argv: ['bash', id], exit_code, signal, timed_out, spawn_error: false, passed: null, failed: null, skipped: null, failed_ids: [], duration_ms: seconds * 1000}`, plus `leak_note` when non-empty. It then goes through the unchanged `finishCommand` → `commandReason`. `commandReason` gains one branch after the exit/signal block: `if (typeof r.leak_note === 'string' && r.leak_note !== '') return 'leak_note';`. Serial records never carry `leak_note`, so their behaviour is unchanged.
  - The new reason `leak_note` is not in `RETRYABLE`, so there is no retry.
  - It is not added to `NEVER_PRE_EXISTING` (FR-012 keeps that constant): a leak on base and head is pre-existing red and still blocks merge-check without `--bug`.
  - `summary_note` does not enter the verdict, for parity with the serial path, where a reporter-`none` command passes on exit 0. It is listed under `runner.sides.<side>.summary_notes`.
  - A signal without counts maps to `implausible_crash`, exactly as a serial `spawnGroup` kill does.
- **D9 One environment object, one runner, serial retry.** `runVerify` builds `runEnv = suiteEnv({...process.env, A1_VERIFY_LOCK_TOKEN: <token>})` once. It passes that same object to the base runner, the head runner, the retry runner and (serial path) every `spawnGroup`. Runner order:
  1. Head: all head ids, default workers.
  2. Base: only the D2 ids whose file exists at the base sha (`git cat-file -e <baseSha>:<id>`; a missing file is `{absent: true}` as today), in a `vb.withSnapshot(project, baseSha, ..., 'base')` root.
  3. Retry: every head command for which the newly exported `vb.isRetryable(finished, baseIds)` is true, in one runner call with `--workers 1` on the same head snapshot.

  `settle` is then called unchanged, with a `retry` closure that returns the prefetched record. It calls the closure exactly when `isRetryable` is true, so the prefetched set covers every call.
- **D10 Watchdog.** New runner option `--suite-timeout-ms <ms>` (1..86400000). Limit = `ceil(ms/1000)` s per suite, checked in every `rs_wait_any` tick: SIGTERM to the group at the limit and SIGKILL at limit + 5 s. `RS_SLOT_TIMED` marks the slot; `rs_on_suite_done` adds the note `timed out after <n>s` and passes `timed_out = 1` to the result. The long path passes the plan's single `timeoutMs` (D4). Then `commandReason` gives `timeout`, which `NEVER_PRE_EXISTING` keeps out of pre-existing red, so a hang is red even with a red base. Granularity: `SECONDS` ticks at wall-clock second boundaries, so a suite can run up to 1 s past its limit before SIGTERM. The watchdog fixtures use bounds of 20 s and more; only the lock wait needs ms precision (D21).
- **D11 Lock (`_shared/lib/verify-lock.cjs`, NEW).**
  - **Path.** `A1_VERIFY_LOCK_DIR` (must be absolute, parent must exist, else `lock_unusable`) or `path.join(os.tmpdir(), 'a1-verify-lock-' + process.getuid())`.
  - **Ceiling.** `A1_VERIFY_LOCK_WAIT_MS` (integer 0..900000; anything else is `lock_unusable`), default 900000.
  - **Acquire.**
    - `mkdirSync(dir, {mode: 0o700})`.
    - Then write `owner.json` = `{pid, token, cmd, started_at}` through `owner.json.<pid>.tmp` (flag `wx`) plus rename. `token` = 32 hex from `crypto.randomBytes(16)`; `cmd` = trimmed `ps -o command= -p <own pid>`, or `""` when `ps` fails.
    - A symlink at the path, a dir not owned by `process.getuid()`, or foreign entries (anything but `owner.json` and `owner.json.*.tmp`) give `lock_unusable`.
  - **Liveness.** `process.kill(pid, 0)` succeeds or throws `EPERM`, **and** (when the owner's `cmd` is non-empty) the current `ps -o command= -p <pid>` equals the owner's `cmd`. This is the PID-reuse proof, mirroring `rs_lock_is_runner`.
  - **Not live.** Take over under a guard `<dir>.takeover` (`mkdirSync`; a guard older than 30 s by mtime is removed first). Re-read the owner; still not live means rename the dir to `<dir>.stale-<8 hex>`, `rmSync` it, `mkdir` anew and write.
  - **Owner unreadable.** Younger than 10 s by dir mtime counts as "being written" (wait); older is stale.
  - **Waiting.** Poll every 250 ms (`Atomics.wait` on a `SharedArrayBuffer`). At the ceiling, throw `LockError('lock_timeout', 'verify lock <dir> held by PID <p> for more than <ms> ms')`.
  - **Re-entrancy.** If `env.A1_VERIFY_LOCK_TOKEN` matches `^[0-9a-f]{32}$` and equals the token of a **live** owner, return `{mode: 'nested', waitedMs: 0, token, release: noop}`. No wait, no lock taken. A wrong token waits like no token.
  - **Release.** Re-read the owner; delete the dir only while its token is ours. Also registered on `process.on('exit')` (idempotent).
  - **Exports.** `acquireVerifyLock({env, now, sleepMs, psCommand})`, `lockCeilingMs(env)`, `LockError`, `lockDirPath(env)`. JSDoc `@returns {{mode: 'held'|'nested', token: string, waitedMs: number, release: () => void}}`.
  - **Where it is taken.** In `runVerify` after the plan, env-missing and affected checks and before the temp dir, so `bad_config` and `env_missing` still exit 2 at once. It is released in the `finally`. The record gets `lock: "held"|"nested"` and `lock_wait_ms`.
  - **CI-evidence path.** `mergeCheck` calls `runVerify` only when CI evidence is not used, so that path takes no lock (FR-017). `suites.lock_wait_ms` is `null` there.
  - **Not a security boundary.** A forged token only skips the wait; the lock serialises load and is not authorization. This goes into the help text and the Samuel brief.
- **D12 Per-worker verify lock dir in the runner.** `rs_spawn_worker` adds `A1_VERIFY_LOCK_DIR="<worker dir>/vlock"` to the worker env **only when `${A1_VERIFY_LOCK_TOKEN:-}` is empty**. The worker dir is `$d`, the parent of `$d/home`, which already exists; `vlock` is not created. With a token (a runner started by `verify run`), the env stays as inherited, so nested runs find the outer owner and skip by token.
  - **Why.** Six suites execute `verify run`/`merge-check` (Depth Pass 2). Under a bare `bash bin/run-suites.sh` or CI, without this they would take the real per-uid lock and wait up to 15 min on a developer's merge-check.
  - The runner keeps `A1_VERIFY_LOCK_TOKEN` (no `-u`), and `SUITE_ENV_DROP` never lists it (LK9).
- **D13 FR-017 text.**
  - 05-merge.md loses the "Start it only on a quiet host" sentence, the `WAIT`/15-minute re-check sentence, the "The lines below ... print `WAIT`" sentence and both `pgrep` lines.
  - It keeps one `sh` fence with the load-record line. The `a1-pr-review` assert at `run-tests.sh:326-333` needs at least one non-bash fence without `exit` or `gh pr merge`, and owner decision (a) keeps the `host_busy`/`load5` record and the re-run-on-quiet-host rule.
  - 06-verify.md:78 points to the lock and to 05-merge §5.3.
  - The lint rule `quiet-host-poll` scans every `*.md` under `skills/` (recursive, symlinks skipped) and flags a line **inside any fence** (```` ``` ```` or `~~~`, any info string) that matches `/(^|[\s;&|(`$])pgrep(\s|$)/`. Prose is not scanned, so a sentence that names the old poll stays legal.
- **D14 Scope guards.**
  - No new runner file (the `ci_evidence.unchanged` list names exactly three).
  - No edit to `.a1/verify.json` (no `verify_config_changed` on this PR's merge-check, the FR-010 agreement fixture untouched), to `_test-fixtures/suite-groups.json`, or to `.github/`.
  - Caps: `verify-run.cjs` ≤ 800 lines, `verify-runner-path.cjs` ≤ 450, `verify-lock.cjs` ≤ 300, `bin/run-suites.sh` ≤ 800, `bin/run-suites-proc.sh` ≤ 600, `bin/run-suites-report.sh` ≤ 300, `workflow-lint-verify.cjs` ≤ 250.
- **D15 TOCTOU unchanged.** No new post-run head re-read. FR-012 keeps the existing protections (`head_moved` on the CI path, HEAD == PR head on a clean tree, `--match-head-commit`) and adds none.
- **D16 New exit-2 reasons.** All are `VerifyError`; `cmdPrMergeCheck` already maps `VerifyError` to `fail2` and the verify CLI to `fail`, and none is ever red or green.
  - `suite_runner_failed` (renamed from `runner_failed`, which `_shared/lib/xprov.cjs:80` already uses with another meaning; audit m9): runner exit not in {0, 1}, killed or timed out, except the D18 lock case. The message is `runner exit <n>: <last 500 chars of runner stderr, control chars replaced by ?>`.
  - `runner_result_mismatch`.
  - `runner_result_invalid`.
  - `lock_timeout`: the verify lock (D11) or, on the long path, the runner lock (D18) held past the ceiling.
  - `lock_unusable`.
- **D17 Runner process ceiling.** `spawnGroup` timeout for one runner call = remaining lock wait + Σ `timeoutMs` of the requested ids + 60000 ms. Each suite is bounded by D10, so this only catches a stuck runner. `spawnGroup` gains two optional trailing parameters, `env` (passed as the `spawnSync` env of the group runner) and `stderrFile` (the group runner opens it for the child's stderr instead of `ignore`). Without them the behaviour is identical.
  - **Cap (audit m7).** The ceiling is `Math.min(<sum above>, 2147483647 - KILL_GRACE_MS)`. Node's `setTimeout` in `groupRunnerMain` overflows above 2^31-1 ms to 1 ms, and `spawnGroup` adds `KILL_GRACE_MS` (10000, `verify-run.cjs:35`) on top. The function is `runnerCeilingMs(remainingWaitMs, timeoutsMs)` in `verify-runner-path.cjs` (RC9).
- **D18 Runner lock under the long path: measured wait and `lock_timeout` (audit M2; orchestrator decision 2026-11-18: follow the spec wording, no `a1-reconcile`).** US-027-4 AC 2 reads "Given a held **runner** lock When `verify run` starts Then it waits, records `lock_wait_ms`, runs when free; and given a permanent lock Then it exits 2 `lock_timeout`". This plan applies it to both locks a local `verify run` can wait on:
  - the CLI verify lock (D11): LK1 (held, then released: waits, `lock_wait_ms` ≥ 1000) and LK3 (permanent: `lock_timeout`);
  - the runner lock on the long path: RR5 (held, then released) and RR6/MR3b (permanent).

  Mechanism:
  - The runner measures its own lock wait in ms (D21) and writes it as top-level `lock_wait_ms` into the D7 JSON.
  - `runSide` returns it. The record keeps it per side as `runner.sides.<side>.lock_wait_ms`. The top-level record `lock_wait_ms` = verify lock wait + Σ runner side waits, and `suites.lock_wait_ms` in the merge-check report is that total.
  - One ceiling for everything: each runner call gets `--lock-wait` = `max(0, lockCeilingMs(env) − lock_wait_ms so far)`.
  - A runner exit 2 whose first non-empty stderr line matches `/^run-suites: lock wait of \d+ ms exceeded/` becomes `VerifyError('lock_timeout', 'runner lock: ' + <sanitised stderr tail as in D16>)`, so the runner's text is passed through (FR-016). Any other runner exit 2 stays `suite_runner_failed`.
  - Both outcomes are exit 2 and never red or green. The stderr match decides only the reason name, so a forged line cannot change a verdict (Samuel brief point 8).
- **D19 A busy host is never a red gate (audit M3).** The lock keeps its purpose (one heavy local run per host) and its 15-minute ceiling. The mechanism is routing text plus one branch, not a shorter wait:
  - The per-wave gate blocks in `skills/a1-execute/workflows/02-execute.md` (~151) and `skills/a1-new-feature/workflows/05-implement.md` (~273) replace their single STOP line with exactly:
    ```
    if [ $RC -eq 2 ]; then echo "STOP: gate-1-build not run (exit 2: error lock_timeout = another local verify run held the CLI lock past 15 min, host busy, re-run, not red; any other error = usage or config)"; elif [ $RC -ne 0 ]; then echo "STOP: gate-1-build red (verdict fail, exit $RC)"; fi
    ```
    The call line and its `RC=$?` stay byte-identical (W11 pins them).
  - 02-execute.md's "Multi-lane:" sentence: run the block per lane **one lane after another, never concurrently**. The CLI lock serialises local runs anyway, and a concurrent start only spends its 15-minute wait (a full-set run is about 25-30 min).
  - The exit-2 prose in `skills/a1-execute/workflows/03-verify.md` (~38-40) and `skills/a1-new-feature/workflows/06-verify.md` (~80) gains one sentence: exit 2 with `error` `lock_timeout` is not a FAIL and not a config error; re-run when the host is free.
  - Measured 2026-11-18 on a `git archive` copy with the new STOP line in both files: `check-wave11-callsites.cjs` `calls=15` rc 0, `workflow lint --root` rc 0, `a1-workflow-lint` 29 passed, `a1-gates-lint` 90 passed.
  - The PR text and help-verify name the consequence: local `verify run` calls on one host serialise, so parallel lanes no longer overlap their gate runs.
- **D20 Runner option helpers live in `bin/run-suites-proc.sh` (audit M1).** `bin/run-suites.sh` has 44 lines of headroom (756/800).
  - It gets only the case arms, one call line per helper and the header lines.
  - `bin/run-suites-proc.sh` (456/600) gets `rs_check_json_out <path>`, `rs_check_groups_file <path>`, `rs_parse_ms <value> <min> <max>` (prints the value or returns 1; reuses `rs_is_ms`), `rs_set_check <recon|learn|phases> <state>` with the three check-state defaults, `rs_now_ms`, `rs_watchdog` and the lock-wait code. Each helper prints its own `run-suites:` error to stderr and returns 1; the caller turns that into exit 2.
  - Wave 3 leaves `bin/run-suites.sh` at 775 lines or fewer, so Wave 4 keeps room.
- **D21 Timing seams that cannot race (audit M4).**
  - (a) The runner's lock-wait deadline is in ms: `rs_now_ms` = `node -e 'process.stdout.write(String(Date.now()))'`. The start ms is taken once before the first acquire attempt; deadline = start + `RS_LOCK_WAIT_MS`, checked every tick; `RS_LOCK_WAITED_MS` = acquire ms − start ms (0 without a wait). W3 measures elapsed with the same clock and asserts ≥ 1000 ms.
  - (b) Holder readiness: every fixture holder polls `ps -o command= -p <pid>` in 0.05 s steps for at most 2 s until the command line holds its marker (`a1-tools-fx-holder` for the verify lock, `run-suites.sh` for the runner lock). Only then does it write the owner file. A holder that never shows its marker fails the case (`bad`), never a silent takeover.
  - (c) A fake live runner is `bash -c 'trap "kill \$c 2>/dev/null; exit 0" TERM; sleep <n> & c=$!; wait' run-suites.sh &`. A plain `bash -c 'sleep <n>' run-suites.sh` execs `sleep` and loses the runner name (Depth Pass 2), so `rs_lock_is_runner` would take it over. TERM to the holder's own PID also ends its `sleep` (measured); no `pkill` pattern is used.

## Field owners (Step 3 #10)
| Field / marker | Single writer | Readers | Fixed in |
|---|---|---|---|
| Runner JSON (`--json-out` file) | `bin/run-suites-report.sh` `rs_write_json_out` (lane runner, W3; `timed_out` W4) | `verify-runner-path.cjs` `readRunnerResult` (W6) | D7 |
| Contract line `a1-suite-runner-contract 1` | `bin/run-suites.sh` `--contract` (W3) | `prepareRunner` (W6) | D5 |
| `A1_VERIFY_LOCK_TOKEN` | `runVerify` via `verify-lock.cjs` (W2) | nested `verify-lock`, kept by runner (W4) and `SUITE_ENV_DROP` | D11, D12 |
| `A1_VERIFY_LOCK_DIR` per worker | `rs_spawn_worker` (W4, only without token); fixtures | `verify-lock.cjs` | D12 |
| Record `base_run`, `lock`, `lock_wait_ms` | `runVerify` (W1, W2) | `pr-merge-check.cjs` report (W2, W8) | D2, D11 |
| Record `runner_source`, `runner` | `runVerify` + `verify-runner-path.cjs` (W6-W7) | `pr-merge-check.cjs` report (W8) | D4, D5, D7 |
| Reason `leak_note` | `commandReason` (W6) | `settle`, `suiteReasons` (unchanged) | D8 |
| Runner JSON `lock_wait_ms`, record `runner.sides.<side>.lock_wait_ms` | `rs_lock_acquire` measures, `rs_write_json_out` writes (W3 field, W4 value) | `readRunnerResult` (W6), `runnerSides` sum into `lock_wait_ms` (W7) | D18, D21 |
| Exit-2 routing text of the workflow gate blocks | Task 5.1 (lane lint) | the orchestrator running a1-execute / a1-new-feature | D19 |
| Command `kind` (counting reporter) | `resolveCommands` (unchanged, writer verified at `verify-run.cjs:125,135`) | D2 selection | D2 |

## Success Criteria
- [ ] SC-1 (FR-011): under `pr merge-check` a green head with reporter `none` starts zero base commands (spawn seam: no `b` line), and a head red on exactly one command starts exactly that command's base run. A counting-reporter command still runs on base. The `verify run --base` CLI stays eager (K1-K6 and VD2 unchanged).
- [ ] SC-2 (FR-012): the full `a1-verify` and `a1-pr-merge-check` suites pass on the final head, and `bin/check-assert-deletions.sh --base origin/main` exits 0 (zero deleted lines in both directories). `NEVER_PRE_EXISTING`, `RETRYABLE`, `settle` and `mergeCheck`'s guard order are unchanged in content (`git diff` review lines named in Task 9.1).
- [ ] SC-3 (FR-013): the runner writes the D7 JSON through `--json-out`. A differing id set exits 2 `runner_result_mismatch`, a leak note fails the command (`leak_note`), and a matching green set passes.
- [ ] SC-4 (FR-014): a PR that edits `bin/run-suites.sh` to write a marker never creates it, and the record says `runner_source: "base"`. An invalid head `suite-groups.json` does not affect the run. A base without the runner falls back (`base_copy_missing`), and so does a base runner without the contract (`no_contract`).
- [ ] SC-5 (FR-015): a hanging head suite is red with reason `timeout` even when base is red. A flaky suite is retried once in a `--workers 1` runner call that starts after the base call. A base-red suite is pre-existing. The base and head env dumps are equal.
- [ ] SC-6 (FR-016): a runner exit 2 gives merge-check exit 2 with the runner's reason text. The record names the snapshot-skipped checks. A runner log claiming pass with a red JSON is red.
- [ ] SC-7 (FR-017): no `pgrep` poll in `skills/`. `workflow lint` flags a planted fenced `pgrep` and is green on the real tree. With green CI evidence, merge-check takes no lock (a held lock does not delay it).
- [ ] SC-8 (FR-018, US-027-4 AC 2 read per D18): proves both locks.
  - Verify lock: a lock that is released is waited for, then the run goes on with `lock_wait_ms` ≥ 1000 (LK1); a dead PID is taken over (LK2); a permanent lock exits 2 `lock_timeout` (LK3); a matching token does not wait (LK4); a wrong token waits (LK5).
  - Runner lock: the runner with `--lock-wait` waits, then runs, and writes its wait into the JSON (W1). Under `verify run` a held runner lock that is released gives `runner.sides.head.lock_wait_ms` ≥ 1000 inside a top-level `lock_wait_ms` (RR5). A permanent runner lock gives exit 2 `lock_timeout` with the runner's text (RR6, MR3b).
  - The workflow gate blocks route exit 2 `lock_timeout` as "host busy, re-run", not red (D19, QH7).
- [ ] SC-9 (SC-003, measured pre-merge): the runner long path on aiserver finishes at or below 900000 ms in `LONG-PATH-REHEARSAL.json` (baseline 2990052 ms).
- [ ] SC-10: the caps of D14 hold; `.a1/verify.json`, `_test-fixtures/suite-groups.json` and `.github/` have no diff against `origin/main`; Samuel and Reinhard findings (BLOCKER/MAJOR) are fixed before the single merge-check.

---

## Wave 1 — Lazy base under merge-check (lane verify)

### Task 1.1: Head-first lazy base, spawn seam, merge-check opt-in
**Goal:** `runVerify` with `{lazyBase: true, noCache: true, base}` runs head first and the base side only for D2 commands; merge-check opts in.
**Actions:**
1. `_shared/lib/verify-run.cjs`:
   - (a) Add `const SPAWN_LOG_ENV = 'A1_VERIFY_SPAWN_LOG';` and a function `noteSpawn(label, id)`: when `process.env[SPAWN_LOG_ENV]` is an absolute path, `fs.appendFileSync(file, `${label}\t${id}\n`)`. Call it in `runCommand` right before `spawnGroup`.
   - (b) New function `lazyHeadSide(project, basePlan, headPlan, baseSha, ctx)`, where `ctx = {tmp, touches, cwd, flakyBase}`, exactly as D2:
     - first runs `h<i>` for every head command (`runCommand`);
     - `finished = finishCommand(raw, ctx.touches)`;
     - `red` = ids with `reason !== null`;
     - `need = basePlan.commands.filter((c) => red.has(c.id) || c.kind !== 'none')`;
     - `base = need.length > 0 ? runBaseSide(project, {...basePlan, commands: need}, baseSha, null, ctx.touches, ctx.tmp, true) : null`, timed into `baseMs`;
     - settle each head command with `baseIds = base ? (base.ids.get(c.id) || new Set()) : new Set()` and the retry closure `runCommand(c, ctx.cwd, ctx.tmp, 'r' + i)`;
     - keep the `duration_ms`/`retry_duration_ms` shape of `runHeadSide`;
     - return `{settled, cache: 'off', base, baseMs, baseRan: need.map((c) => c.id)}`.
   - (c) In `runVerify`, `const lazy = opts.lazyBase === true && opts.noCache === true && sel.compareBase;`. When `lazy`:
     - `side = vb.withSnapshot(project, head, (cwd) => lazyHeadSide(project, timed, headTimed, baseSha, {tmp, touches, cwd, flakyBase}), 'head')`;
     - `base = side.base`, `baseMs = side.base ? side.baseMs : null`, `headMs = msSince(tHead) - (baseMs || 0)`;
     - the record gets `base_run: {mode: 'lazy', ran: side.baseRan, of: timed.commands.length}` and `cache: {head: 'off', base: 'off'}`.
   - The eager branch keeps its current behaviour. `runVerify` is already 62 lines on `bc47b07` (audit m8), so move the eager block into `eagerSides(project, timed, headTimed, baseSha, ctx)` now, without changing its statements. The lazy branch calls `lazyHeadSide`. K1-K6, VD1/VD2 and PT0 prove the move.
   - (d) Extend the `runVerify` JSDoc `@param` with `lazyBase?: boolean (merge-check only; needs noCache and base, spec 027 FR-011)`.
2. `_shared/lib/pr-merge-check.cjs:240`: `runVerify({ project: opts.project, base: baseRef, noCache: true, lazyBase: true })`.
3. Create `_test-fixtures/a1-verify/cases-lazy.sh`, header like `cases-durations.sh` (sourced, not named `run*.sh`). Helper `lz_run <project>` = `node -e` that requires `$REPO_ROOT/_shared/lib/verify-run.cjs` and prints `JSON.stringify(runVerify({project, base: 'main', noCache: true, lazyBase: true}))`, with `A1_VERIFY_SPAWN_LOG="$WORK/lz-<case>.log"`. `bspawn` counts lines starting with `b`. Cases:
   - LZ1: 2 commands, both `exit 0`, head changes `src/app.js`. Expect verdict pass, 0 `b` lines, 2 `h` lines, `base_run.ran` `[]`, `duration_ms.base` null, `cache` `off/off`.
   - LZ2: 3 commands; `c2` exits 1 on head only (stub content differs per branch). Expect exactly 1 `b` line with id `c2`; spawn-log line order is `h0 h1 h2 b<k> r1` (all `h` before `b`, `b` before `r`); verdict fail `command_failed`; `pre_existing_red` empty.
   - LZ3: `c1` red on head and base. Expect 1 `b` line, `pre_existing_red` names `c1`, verdict pass.
   - LZ4: one `node --test t.test.js` command (reporter `node-test`, real trivial passing test file) plus one `bash` command, both green. Expect exactly 1 `b` line, for the node-test id.
   - LZ5 skip increase: a node-test file whose head version skips 2 more tests than base. Expect reason `skip_increase` (proves the counting base still runs).
   - LZ6: head command `exec sleep 30` with `timeout_ms` 700, base command `exit 1`. Expect reason `timeout`, `pre_existing_red` empty.
   - LZ7 control: the same project as LZ1 through the CLI `vrun "$P" --base main --no-cache`. Expect 1 `b` line (the CLI stays eager, D1).
4. Create `_test-fixtures/a1-pr-merge-check/cases-lazy.sh`. It uses `new_pr`, `mc`, `js`, `reasons` and `A1_VERIFY_SPAWN_LOG`:
   - ML1: `new_pr ml1 0 0; mc`. Expect exit 0, 0 `b` lines, `suites.verdict` pass.
   - ML2: `new_pr ml2 0 1`. Expect exit 1, exactly 1 `b` line, reasons include `suite_red_on_head`.
   - ML3: `new_pr ml3 1 1`. Expect exit 1, 1 `b` line, reasons `base_red_unreported`.
5. Append one source line for each new file to `_test-fixtures/a1-verify/run-tests.sh` and `_test-fixtures/a1-pr-merge-check/run-tests.sh` (after the last existing source line).
6. Run `bash _test-fixtures/a1-verify/run-tests.sh` and `bash _test-fixtures/a1-pr-merge-check/run-tests.sh`.

RED-proof:
- (a) `lazy` forced to `false` → LZ1 red.
- (b) `need` = all base commands → LZ1 and ML1 red.
- (c) `need` without the `kind !== 'none'` term → LZ4 and LZ5 red.
- (d) `lazyBase: true` removed from `pr-merge-check.cjs` → ML1 red.
- (e) The retry closure moved before the base run (settle inline as in `runHeadSide`) → LZ2 order red.

**Done when:**
- Both suites exit 0, and every pre-existing case name still prints `ok`/`PASS`.
- The numstat deletion check (Execution location) prints `deleted=0` and exits 0.
- `wc -l < _shared/lib/verify-run.cjs` ≤ 800.
- 5 RED-proof lines are logged.

**Covers:** SC-1, SC-2

---

## Wave 2 — CLI lock (lane verify)
**Depends on:** Wave 1

### Task 2.1: `verify-lock.cjs`, hook in `runVerify`, token export, merge-check field
**Goal:** Every local `verify run` takes the D11 lock (or nests by token); the token reaches every started command; the CI-evidence path takes none.
**Actions:**
1. Create `_shared/lib/verify-lock.cjs` exactly as D11 (exports, constants `DEFAULT_WAIT_MS = 900000`, `POLL_MS = 250`, `INIT_BOUND_MS = 10000`, `GUARD_STALE_MS = 30000`, `MAX_OWNER_BYTES = 4096`). Each function stays under 50 lines. Top-of-file comment: purpose, the not-a-security-boundary note, the seams.
2. `_shared/lib/verify-run.cjs`:
   - (a) `spawnGroup(argv, cwd, stdoutFile, timeoutMs, env, stderrFile)`: pass `env` (when given) as the `spawnSync` env, and add `stderrFile` to the JSON spec. In `groupRunnerMain`, open `spec.stderrFile` for the child's stderr when present, else `'ignore'` (D17).
   - (b) `runCommand(cmd, cwd, tmp, label, env)` forwards `env`.
   - (c) Thread `env` into `runBaseSide` (new last parameter), `runHeadSide` (`ctx.env`) and `lazyHeadSide` (`ctx.env`).
   - (d) In `runVerify`, after the `missing` env check and before `fs.mkdtempSync`: `let lock; try { lock = lockLib.acquireVerifyLock({env: process.env}); } catch (e) { if (e instanceof lockLib.LockError) throw new VerifyError(e.reason, e.message); throw e; }`. Then `const runEnv = {...process.env, A1_VERIFY_LOCK_TOKEN: lock.token};`, passed to every side. Call `lock.release()` in the `finally` after the temp removal. The record adds `lock: lock.mode, lock_wait_ms: lock.waitedMs`.
   - (e) `SUITE_ENV_DROP` stays exactly `['A1_VAULT_ROOT', 'A1_VAULT_WRITER_HOST', 'A1_HOST_ID']`. Add a one-line comment that `A1_VERIFY_LOCK_TOKEN` must never join it (FR-018).
3. `_shared/lib/pr-merge-check.cjs` report `suites`: add `lock_wait_ms: typeof record.lock_wait_ms === 'number' ? record.lock_wait_ms : null` (the CI path record has none, so `null`).
4. Create `_test-fixtures/a1-verify/cases-lock.sh`. Helpers:
   - `vl_holder <dir> <seconds> [release]` starts `node -e '<keep alive N s; if release: rm dir after N s>' a1-tools-fx-holder &`. It then polls `ps -o command= -p $!` in 0.05 s steps for at most 2 s until the output contains `a1-tools-fx-holder` (D21 b; never reached: `bad`, and the case stops). Only then does it write `<dir>/owner.json` with `pid=$!`, `token=<32 hex>` and `cmd` = that polled command line.
   - `vl_dead <dir>` writes an owner whose pid is that of a finished `sleep 0` (wait for it first).

   Every case sets `A1_VERIFY_LOCK_DIR="$WORK/vl-<case>/lock"` (mkdir the parent) and runs `vrun` on a one-command green project. Cases:
   - LK1 held, released after 1.5 s: exit 0, `lock` held, `lock_wait_ms` ≥ 1000.
   - LK2 dead PID: exit 0, `lock_wait_ms` < 1000; the dir is gone after the run.
   - LK3 permanent holder (60 s), `A1_VERIFY_LOCK_WAIT_MS=1500`: exit 2, `error` `lock_timeout`, wall time ≥ 1.5 s; kill the holder afterwards (own PID only).
   - LK4 permanent holder + `A1_VERIFY_LOCK_TOKEN=<its token>`: exit 0, `lock` nested, `lock_wait_ms` 0; the holder's `owner.json` byte-identical afterwards.
   - LK5 permanent holder + a wrong 32-hex token + wait 1500: exit 2 `lock_timeout`.
   - LK6 live PID whose current `ps` command differs from the owner `cmd` (holder started, owner `cmd` written as `"other"`): taken over, exit 0.
   - LK7 symlink at the lock path: exit 2 `lock_unusable`.
   - LK8: a stub writes `$A1_VERIFY_LOCK_TOKEN` and the token from `$A1_VERIFY_LOCK_DIR/owner.json` to files during the run. Both are equal and 32 hex.
   - LK9 (node): `SUITE_ENV_DROP` read from the source text does not contain `A1_VERIFY_LOCK_TOKEN`.
   - LK10: `A1_VERIFY_LOCK_WAIT_MS=abc` gives exit 2 `lock_unusable`; a relative `A1_VERIFY_LOCK_DIR` gives exit 2 `lock_unusable`.
   - LK11 real nesting: the outer project's command runs `node "$TOOLS" verify run --project <inner project>` and exits with its status; `A1_VERIFY_LOCK_WAIT_MS=2000`. Outer exit 0, and the inner report (written to a file by the stub) has `lock` nested.
   - LK12: `bad_config` (`{not json`) with a permanent holder and `A1_VERIFY_LOCK_WAIT_MS=3000`: exit 2 `bad_config` in under 1.5 s (the lock comes after config resolution). Under RED-proof (g) it turns red as exit 2 `lock_timeout` after about 3 s, not after 900 s (audit m4).
   - The real-lock leak assert (Execution location).
5. Create `_test-fixtures/a1-pr-merge-check/cases-lock.sh`:
   - MLK1: `ci_pr mlk1`; permanent holder on `A1_VERIFY_LOCK_DIR`, `A1_VERIFY_LOCK_WAIT_MS=1500`; `ce "$WORK/ci-green.json"`. Expect exit 0, `ci_evidence.used` true, `suites.lock_wait_ms` null, the holder `owner.json` unchanged.
   - MLK2 control: the same with `--no-ci-evidence`. Expect exit 2, stdout `error` `lock_timeout`.
   - MLK3: `new_pr mlk3 0 0; mc` without a holder. Expect `suites.lock_wait_ms` an integer ≥ 0.
6. Append the two source lines; run both suites.

RED-proof:
- (a) The token not put into `runEnv` → LK8 and LK11 red.
- (b) Nested branch removed → LK4 red.
- (c) Dead-PID takeover removed → LK2 red (bound 10 s).
- (d) `cmd` comparison removed → LK6 red.
- (e) The wait loop returns at once → LK1 red.
- (f) The lock acquired at the top of `mergeCheck` → MLK1 red.
- (g) The lock taken before `resolveCommands` → LK12 red.

**Done when:**
- Both suites exit 0.
- `node -e 'require("./_shared/lib/verify-lock.cjs")'` exits 0.
- `wc -l` caps hold (D14).
- The numstat deletion check (Execution location) exits 0.
- 7 RED-proof lines are logged.

**Covers:** SC-7, SC-8, SC-2

---

## Wave 3 — Runner contract (lane runner)

### Task 3.1: `--contract`, `--json-out`, `--groups-file`, check states
**Goal:** The runner answers the handshake, reads its groups from a named file, and writes the D7 JSON.
**Actions:**
1. `bin/run-suites.sh`:
   - (a) Option parsing in `rs_main`:
     - `--contract` prints `a1-suite-runner-contract 1` and exits 0 (handled in the loop, before any other check);
     - `--json-out <path>` / `--json-out=<path>` → `RS_JSON_OUT`;
     - `--groups-file <path>` / `=` → `RS_GROUPS_FILE`.
   - (b) After parsing, one call line per check (D20): `rs_check_json_out "$RS_JSON_OUT"` and `rs_check_groups_file "$RS_GROUPS_FILE"`, each followed by `|| exit 2` (the helper has printed its error). The rules live in the helpers (action 3a):
     - `--json-out` must be absolute, must not exist (`[ ! -e ] && [ ! -L ]`), and its parent must be a directory owned by the user and not group- or world-writable (same `find -perm` test as `rs_make_logdir`).
     - `--groups-file` must be absolute, a regular file, not a symlink.
     - `--groups-file` with `--check-groups` → `rs_die "--groups-file cannot be combined with --check-groups"`.
     - Default `RS_GROUPS_FILE="$RS_ROOT/_test-fixtures/suite-groups.json"` (set after `RS_ROOT` is resolved).
   - (c) `rs_load_groups` uses `$RS_GROUPS_FILE`.
   - (d) Check states: `RS_CHECK_RECON`, `RS_CHECK_LEARN`, `RS_CHECK_PHASES` default `not_selected` (defaults defined in `bin/run-suites-proc.sh`, D20). Each `rs_*_post` branch calls `rs_set_check <recon|learn|phases> <state>` with `skipped_nogit`, `skipped_dirty` (reconcile only), `ok` or `failed`, one line per branch.
   - (e) After `rs_print_failures` and before the final status: `if [ -n "$RS_JSON_OUT" ]; then rs_write_json_out "$workers" || RS_FAILED=1; fi`.
   - (f) Header: document the three options in at most 6 added lines, and change `sed -n '2,28p'` to the new last header line.
2. `bin/run-suites-report.sh`:
   - (a) New arrays `RS_RES_LEAK`, `RS_RES_TIMED`, `RS_RES_SUMNOTE`. `rs_record_result` takes optional args 7 (leak note), 8 (timed 0/1) and 9 (summary note), defaulting to `""`, `0`, `""`; the combined note (arg 5) and the table stay as they are.
   - (b) `rs_load_nocount` reads `${RS_GROUPS_FILE:-${RS_ROOT:-.}/_test-fixtures/suite-groups.json}`.
   - (c) New `rs_write_json_out <workers>`: write one TSV line per result (`id`, `rc`, `sec`, `timed`, `leak`, `sumnote`) to `$RS_TMP/results.tsv`. Then `node -e` builds the D7 object, with top-level `lock_wait_ms` from `${RS_LOCK_WAITED_MS:-0}` (Wave 4 sets the value). The signal name comes from a bash-computed column via `kill -l`, done in bash before the TSV so node gets `SIG<name>` or empty. Node writes `<out>.tmp.<pid>` with `{flag: 'wx', mode: 0o600}` and renames it. On any failure it returns non-zero and prints `run-suites: cannot write --json-out <file>` to stderr.
3. `bin/run-suites.sh` `rs_on_suite_done`: build `leak` (the sentinel-vault note text) and `sumnote` (the `rs_summary_note` output) as separate variables while still composing `note` exactly as today. Pass them as args 7 and 9 (8 stays `0` until Wave 4).
3a. `bin/run-suites-proc.sh` (D20): add `rs_check_json_out`, `rs_check_groups_file`, `rs_set_check` and the three check-state defaults. Each helper stays under 25 lines, prints `run-suites: <reason>` to stderr and returns 1 on a failed check.
4. Create `_test-fixtures/a1-suite-runner/parts/17-json-out.sh`. Cases run through `rs_run` with a planted tree (`mk_tree`, `plant_suite`):
   - J1: `--contract` stdout is exactly `a1-suite-runner-contract 1`, rc 0, and no log dir is created.
   - J2: tree with `ok/run-tests.sh` (summary line, exit 0), `red/run-tests.sh` (exit 3), `leak/run-tests.sh` (writes into `$A1_VAULT_ROOT`) and `nosum/run-tests.sh` (exit 0, no summary), with `--json-out $T/out.json`. JSON per id:
     - ok `0/null/false/""/""`;
     - red `exit_code 3`;
     - leak `leak_note` "wrote into its sentinel vault";
     - nosum `summary_note` "no assert summary";
     - `contract` 1, `lock_wait_ms` 0, `results` length 4, mode 600, runner rc 1.
   - J3: `--json-out` pointing at an existing file: rc 2, no suite started (no log dir), file unchanged.
   - J4: relative path: rc 2.
   - J5: symlink at the path: rc 2.
   - J6: the J2 tree (no `.git`) gives checks `learnings`/`phases` `skipped_nogit`; a planted tree with `git init` + commit gives `ok`.
   - J7: two selectors give `subset` true and exactly those two ids.
   - J8: a suite doing `kill -KILL $$` gives `exit_code` null, `signal` `SIGKILL`.
5. Create `_test-fixtures/a1-suite-runner/parts/18-groups-file.sh`:
   - G1: the tree's own `suite-groups.json` is `{not json` and a valid `--groups-file` is given: rc 0. Without the option: rc 2 (control).
   - G2: a summary-less suite listed in `no_count` only in the `--groups-file`: PASS, `summary_note` "". Listed only in the tree's file while `--groups-file` omits it: `summary_note` "no assert summary".
   - G3: `--groups-file` + `--check-groups`: rc 2.
   - G4: relative `--groups-file`: rc 2; symlinked one: rc 2.
6. Run `bash -n bin/run-suites*.sh` and `bash _test-fixtures/a1-suite-runner/run-tests.sh`.

RED-proof:
- (a) Contract line text changed → J1 red.
- (b) `leak` not passed to `rs_record_result` → J2 red.
- (c) `rs_load_groups` back to `$RS_ROOT/...` → G1 red.
- (d) `rs_load_nocount` back to `$RS_ROOT/...` → G2 red.
- (e) Existing-file check removed → J3 red.

**Done when:**
- The suite exits 0 (all pre-existing parts unchanged and green).
- `wc -l` caps hold, and `[ "$(wc -l < bin/run-suites.sh)" -le 775 ]` exits 0 (D20). Red when: Wave 3 used more than 19 of the 44 free lines. Red run: the same test with 700 gave rc=1 on `bc47b07` (756 lines).
- 5 RED-proof lines are logged.

**Covers:** SC-3, SC-4, SC-6

---

## Wave 4 — Lock wait, watchdog, per-worker verify lock dir (lane runner)
**Depends on:** Wave 3

### Task 4.1: `--lock-wait`, `--suite-timeout-ms`, D12
**Goal:** The runner waits for a held runner lock up to a ceiling, ends a hung suite with `timed_out`, and gives workers a private verify lock dir when no token is present.
**Actions:**
1. `bin/run-suites-proc.sh`:
   - (a) `rs_is_ms <v> <max>`: decimal 0..max, at most 8 digits. `rs_parse_ms <v> <min> <max>` on top of it (D20). `rs_now_ms` (D21 a).
   - (b) `rs_lock_takeover`: in the "another run holds the lock" branch, return 3 instead of 2. The message is still printed only when no wait is configured; the caller handles that.
   - (c) `rs_lock_acquire`:
     - when `RS_LOCK_WAIT_MS > 0`: `RS_LOCK_T0=$(rs_now_ms)` once before the first attempt, and `RS_LOCK_DEADLINE=$(( RS_LOCK_T0 + RS_LOCK_WAIT_MS ))` (D21 a; ms, never `SECONDS`);
     - in the live-holder branch (and for rc 3 from takeover): when `$(rs_now_ms)` is below `RS_LOCK_DEADLINE`, print `lock: waiting up to <ms> ms for holder PID <p>` once to stdout, `sleep 0.5` and continue without counting an attempt;
     - when the deadline passed, print to stderr `run-suites: lock wait of <ms> ms exceeded; another run holds the lock <lock> (holder PID <p>, run <r>); no suite started` and return 2;
     - without a wait, the existing message and return 2 are unchanged;
     - on success `RS_LOCK_WAITED_MS=$(( $(rs_now_ms) - RS_LOCK_T0 ))`, or 0 without a wait; `rs_write_json_out` writes it (D18).
   - (d) Watchdog:
     - `RS_SLOT_TIMED=()`, reset in `rs_slots_reset`;
     - `rs_watchdog` (no-op when `RS_SUITE_TIMEOUT_S` is empty): for each slot with a pid, at `SECONDS - start >= limit` set `RS_SLOT_TIMED[i]=1` and `kill -TERM -- -<pid>`; at `>= limit + 5`, `kill -KILL -- -<pid>`;
     - called first in `rs_wait_any`.
   - (e) `rs_spawn_worker`: when `[ -z "${A1_VERIFY_LOCK_TOKEN:-}" ]`, add `A1_VERIFY_LOCK_DIR="${home%/home}/vlock"` to the `env` assignment list, else nothing (D12).
2. `bin/run-suites.sh`:
   - parse `--lock-wait <ms>` (0..3600000) into `RS_LOCK_WAIT_MS` (default 0) and `--suite-timeout-ms <ms>` (1..86400000) into `RS_SUITE_TIMEOUT_S` = ceil, each through one `rs_parse_ms` call line (D20);
   - invalid values → `rs_die`;
   - `rs_on_suite_done` reads `RS_SLOT_TIMED[$slot]`: when 1, `note="${note:+$note; }timed out after ${elapsed}s"` and arg 8 = 1; clear the flag;
   - header lines for both options.
3. Create `_test-fixtures/a1-suite-runner/parts/19-lock-wait.sh`. Reuse the `lk_*` helpers of part 06. A fake live runner is the D21 (c) holder, polled until `ps -o command=` shows `run-suites.sh` (D21 b); its pid is then written into a planted lock dir like part 06 does. For a timed release the case removes the dir after N s and sends TERM to the holder's own PID.
   - W1: holder for 3 s, then the dir removed; the runner with `--lock-wait 10000 --json-out <file>` gives rc 0, a `lock: waiting` line, the suite ran, and JSON `lock_wait_ms` ≥ 1000.
   - W2: the same without `--lock-wait`: rc 2 with the existing message (control).
   - W3: holder 30 s, `--lock-wait 1000`: rc 2, stderr `lock wait of 1000 ms exceeded`, elapsed ≥ 1000 ms measured with `node` `Date.now()` before and after (D21 a), no log dir; TERM the holder.
   - W4: `--lock-wait -1`, `abc`, `3600001`: rc 2 each.
4. Create `_test-fixtures/a1-suite-runner/parts/20-watchdog.sh`. Each runner start runs in the background with a 40 s kill bound:
   - WD1: suite `sleep 60` with `--suite-timeout-ms 2000 --json-out`: runner rc 1 within 20 s; JSON `timed_out` true, `exit_code` null, `signal` `SIGTERM` or `SIGKILL`.
   - WD2: suite `trap '' TERM; sleep 60` gives `timed_out` true, ends within 20 s (the KILL step).
   - WD3: a fast green suite in the same run gives `timed_out` false.
   - WD4: a hung suite's background grandchild (pid file) is gone after the run.
   - WD5: a probe suite prints `${A1_VERIFY_LOCK_DIR-UNSET}`. Without a token it gets a path ending `/vlock` under the runner work dir (not the outer value). With `A1_VERIFY_LOCK_TOKEN=x A1_VERIFY_LOCK_DIR=/outer` it gets `/outer`.
   - WD6: `--suite-timeout-ms 0` gives rc 2.
5. Run `bash -n` and the suite.

RED-proof:
- (a) Wait branch skipped (fail fast) → W1 red.
- (b) Deadline never reached (no expiry) → W3 red (killed at 40 s).
- (c) `rs_watchdog` not called → WD1 red (bound).
- (d) KILL escalation removed → WD2 red.
- (e) D12 made unconditional → WD5 token case red.

**Done when:**
- The suite exits 0.
- Caps hold (`bin/run-suites.sh` ≤ 800, `bin/run-suites-proc.sh` ≤ 600).
- 5 RED-proof lines are logged.

**Covers:** SC-5, SC-8

---

## Wave 5 — Quiet-host poll text, lint rule, gate exit-2 routing (lane lint)

### Task 5.1: FR-017 text, the `quiet-host-poll` rule and the D19 routing
**Goal:** No pgrep/WAIT poll is left in the workflows, the load record and the re-run rule stay, a lint rule keeps polls out of `skills/`, and no gate block reports a `lock_timeout` as red. (One task: the D19 regression case QH7 shares `cases-quiet-host.sh` and the `run-tests.sh` source line with the lint cases.)
**Actions:**
1. `skills/a1-pr-review/workflows/05-merge.md` §5.3 (lines 63-74 on `bc47b07`): delete the "Start it only on a quiet host ..." sentence, the "If a `WAIT` line persists ..." sentence, the "A red `reasons[]` entry from a run that started above that bar ..." sentence, the "The lines below (an `sh` block ...)" sentence, and the whole `sh` block. Insert in their place exactly:
   ```
   No quiet-host poll: `pr merge-check` decides `ci_evidence` first and starts nothing locally when it is used. A local run waits on the CLI lock of `verify run` (at most 15 minutes; `suites.lock_wait_ms` in the report; after the ceiling exit 2 `lock_timeout`). Record the host load next to the result with the `sh` line below (`host_busy` is true when `load5` is at or above the CPU count). A red `reasons[]` entry from a run that started with `host_busy=true` (timeout, `spawn_failed`, a timing test green in CI) is re-run once on a quiet host before it counts; write the host and both load values next to any red claim. The `sh` line is not a gate block and does not stop the run.
   ```
   followed by
   ````
   ```sh
   node -e 'const os=require("os");const l=os.loadavg()[1],n=os.cpus().length;console.log(`load5=${l.toFixed(2)} cpus=${n} host_busy=${l>=n}`)'
   ```
   ````
2. `skills/a1-new-feature/workflows/06-verify.md:78`: replace the sentence with exactly: ``` `verify run` waits on its CLI lock (at most 15 minutes, `lock_wait_ms` in the record, exit 2 `lock_timeout` after the ceiling). Record the host load and treat a red from a busy host as `a1-pr-review` `workflows/05-merge.md` §5.3 says (owner of that rule). ```
   In the same file (~80), insert after `re-run.` in the line "Exit 1 or 2 stops Phase 6: fix the failing command (or `.a1/verify.json`), re-run." exactly: ``` Exit 2 with `error` `lock_timeout` is neither: another local `verify run` held the CLI lock past 15 minutes (host busy); re-run when it is free. ``` (D19).
2a. D19 routing in the other three files. Change no call line and no `RC=$?`:
   - `skills/a1-execute/workflows/02-execute.md` (~151) and `skills/a1-new-feature/workflows/05-implement.md` (~273): replace the line `if [ $RC -ne 0 ]; then echo "STOP: gate-1-build red (verdict fail or no test command)"; fi` with the D19 line, byte for byte.
   - 02-execute.md: the sentence "Multi-lane: run the block per lane with the lane's own `$WORK_PATH` and `$PRE_WAVE_HEAD`." becomes exactly: ``` Multi-lane: run the block per lane with the lane's own `$WORK_PATH` and `$PRE_WAVE_HEAD`, one lane after another, never concurrently: the CLI lock of `verify run` serialises local runs on one host, and a concurrent start only spends its 15-minute wait. Exit 2 with `error` `lock_timeout` means another run (another lane or session) held the lock: re-run, it is not red. ```
   - `skills/a1-execute/workflows/03-verify.md` (~38-40): insert after "is a stop: fix the project's `.a1/verify.json`, then re-run." exactly: ``` Exit 2 with `error` `lock_timeout` is not a FAIL and not a config error: another local `verify run` held the CLI lock past 15 minutes (host busy); re-run when it is free. ```
3. `_shared/lib/workflow-lint-verify.cjs`:
   - `POLL_RE = /(^|[\s;&|(`$])pgrep(\s|$)/`;
   - `fencedLines(content)` handles any ```` ``` ```` or `~~~` opener (any info string) and closes on the same marker;
   - `listSkillMarkdown(root)` walks `skills/` recursively, skipping symlinks;
   - `checkQuietHostPoll(root, isSkillsTree)` returns `{checked, findings}`, a finding being `{file, rule: 'quiet-host-poll', reason: 'pgrep-based quiet-host poll in a fenced block (spec 027 FR-017: the verify run CLI lock replaces it)'}`;
   - export it and `POLL_RE`. Header comment line for the rule.
4. `_shared/lib/workflow-lint.cjs` (~404-418): call `checkQuietHostPoll(root, isSkillsTree)`, concat its findings, and add `quiet_host_checked` to `out`.
5. Create `_test-fixtures/a1-workflow-lint/cases-quiet-host.sh` (uses `copySkills`, `ok`, `bad`, `TOOLS`):
   - QH1: copy of the real tree: exit 0, 0 `quiet-host-poll` findings, `quiet_host_checked` ≥ 20.
   - QH2: the copy's 05-merge.md gets an `sh` fence holding `pgrep -f 'x' >/dev/null && echo WAIT`: exit 1, one finding naming `05-merge.md`.
   - QH3: a `bash` fence with `pgrep x` in a nested file `skills/a1-fix/workflows/sub/x.md`: finding.
   - QH4: prose line "No `pgrep` poll here." outside any fence: no finding.
   - QH5: `pgrep` inside a `~~~` fence: finding.
   - QH6: fenced `xpgrep a` and `pgrep-like`: no finding.
   - QH7 (D19 regression guard, real tree under `$REPO_ROOT`): in 02-execute.md and 05-implement.md the line starting `if [ $RC -eq 2 ]` exists inside a fence and contains `lock_timeout` and `not red`; 03-verify.md and 06-verify.md each contain `lock_timeout`. Red run: `grep -c lock_timeout` gave 0 for all four files on `bc47b07`.

   Append the source line to `_test-fixtures/a1-workflow-lint/run-tests.sh`.
6. Run `bash _test-fixtures/a1-workflow-lint/run-tests.sh`, `bash _test-fixtures/a1-pr-review/run-tests.sh` (the non-bash-fence assert must stay green), `bash _test-fixtures/a1-gates-lint/run-tests.sh` (W11 pins the call lines of the D19 files), `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` (prints `calls=15`), `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s3` (exit 0) and `grep -rn pgrep skills/` (no output).

RED-proof:
- (a) The rule not wired in `workflow-lint.cjs` → QH2 red.
- (b) `fencedLines` restricted to `bash` → QH2 red.
- (c) The `sh` load fence deleted from 05-merge.md → the `a1-pr-review` "non-bash fences" case red (proves D13's reason).
- (d) The `if [ $RC -eq 2 ]` branch removed from 02-execute.md (old STOP line restored) → QH7 red.

**Done when:**
- `a1-workflow-lint`, `a1-pr-review` and `a1-gates-lint` exit 0.
- `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` prints `calls=15` and exits 0. Red when: a gate call line was touched. Red run (2026-11-18, `git archive` copy, ` --x` appended to the 02-execute.md `verify run` call): `02-execute.md:149 verify run: unknown flag --x`, rc=1.
- `grep -rn pgrep skills/` prints nothing.
- `workflow lint` exits 0 on the real tree.
- 4 RED-proof lines are logged.

**Covers:** SC-7, SC-8

---

## Wave 6 — Runner-path module: preparation and result reading (sequential after lanes)
**Depends on:** Wave 2, Wave 4, Wave 5

### Task 6.1: `_shared/lib/verify-runner-path.cjs` (prepare, eligibility, run one side, read result)
**Goal:** A tested module that prepares the base runner, decides eligibility, runs one side through the runner and returns validated records.
**Actions:**
1. Create `_shared/lib/verify-runner-path.cjs` (no require of `verify-run.cjs`; helpers come in as `deps` to avoid a cycle). Every error it throws is `vb.VerifyError` from `require('./verify-base.cjs')`, the class `verify-run.cjs:24` re-exports. A second class would fail `instanceof VerifyError` in `cmdPrMergeCheck` (`pr-merge-check.cjs:273`) and turn the exit-2 reason into `internal` (audit m5). Exports:
   - `RUNNER_FILES`, `CONTRACT_LINE`, `MAX_RESULT_BYTES = 1024 * 1024`;
   - `eligibility(basePlan, headCommands)` returns `{ok: true} | {ok: false, why}` (D4 rules, `why` such as `command <id>: reporter node-test`);
   - `prepareRunner(project, baseSha, env)` returns `{ok: true, dir, release} | {ok: false, why: 'base_copy_missing'|'no_contract'}` (D5; the dir is registered with `vb.cleanupOnExit`);
   - `identity(id)` = id without the `_test-fixtures/` prefix;
   - `runSide({runnerDir, root, ids, side, workers, env, tmp, timeoutMs, lockWaitMs, deps})`. It spawns through `deps.spawnGroup` with argv `['bash', <runnerDir>/bin/run-suites.sh, '--root', root, '--groups-file', <runnerDir>/_test-fixtures/suite-groups.json, '--json-out', <tmp>/runner-<side>.json, '--suite-timeout-ms', String(timeoutMs), '--lock-wait', String(lockWaitMs), ...(workers ? ['--workers', String(workers)] : []), ...ids.map(identity)]`, with cwd `root`, stdout `<tmp>/runner-<side>.out`, stderr `<tmp>/runner-<side>.err` and the D17 ceiling. It notes the spawn-log lines (D3) and maps exit codes per D16 and D18: exit 2 with the lock-wait stderr line gives `lock_timeout`, any other exit outside {0, 1} gives `suite_runner_failed`. It returns `{records: Map<id, raw>, exit, ms, lockWaitMs, checksSkipped: [...], summaryNotes: [...]}`;
   - `runnerCeilingMs(remainingWaitMs, timeoutsMs)` per D17, including the cap;
   - `readRunnerResult(file, requestedIds, runnerExit)` applies the D7 rules and returns validated results or throws `VerifyError`;
   - `toRaw(result, id)` follows D8.

   JSDoc `@returns` blocks name every field of each object return (Step 3 #9).
2. `_shared/lib/verify-base.cjs`: add `isRetryable` to `module.exports` (no other change).
3. Create `_test-fixtures/a1-verify/cases-runner-contract.sh`. Unit level through `node -e` on planted files and repos:
   - RC1 eligibility: `each` plan → ok; one `node-test` command → `not_eligible` naming it; argv `['bash', '-c', 'x']` → not ok; id `../x` → not ok; two timeouts → not ok; `requires_host` → not ok.
   - RC2 `prepareRunner` on a planted repo whose `main` holds copies of the real `$REPO_ROOT/bin/run-suites*.sh` plus a minimal `_test-fixtures/suite-groups.json` (`{"serial":[],"no_count":[],"ci_jobs":{},"timings":{}}`) → ok; the dir holds the 4 files.
   - RC3: a base without `bin/run-suites.sh` → `base_copy_missing`.
   - RC4: a base runner that is a stub `exit 2` → `no_contract`.
   - RC4b: a base runner stub that prints `a1-suite-runner-contract 1x` and exits 0 → `no_contract` (exact match, not a prefix).
   - RC5 `readRunnerResult` on planted JSON files: valid → ok; an id missing → `runner_result_mismatch` naming it; an extra id → mismatch; a duplicate id → invalid; `exit_code: "0"` → invalid; `signal: "KILL"` → invalid; `contract: 2` → invalid; `lock_wait_ms: -1` → invalid; every thrown error `instanceof` the `VerifyError` that `verify-run.cjs` exports; size 1 MiB + 1 → invalid; a symlink to a valid file → invalid; an unknown check state → invalid.
   - RC6 consistency: runner exit 1 with all green, no notes and no failed check → `runner_result_invalid`; runner exit 0 with one `exit_code: 1` result → valid (red wins later).
   - RC7 `toRaw`: a leak note result carries `leak_note`; signal 137 maps per D8.
   - RC8 (node): `require('verify-base.cjs').isRetryable` is a function and `RETRYABLE`/`NEVER_PRE_EXISTING` equal their `bc47b07` values (literal arrays in the case).
   - RC9 `runnerCeilingMs`: `(1000, [2000])` → 63000; `(0, 25 × 86400000)` → `2147483647 - 10000` (audit m7).
4. Append the source line to `_test-fixtures/a1-verify/run-tests.sh`; run the suite.

RED-proof:
- (a) The set comparison removed → RC5 mismatch red.
- (b) The `lstat` symlink check removed → RC5 symlink red.
- (c) The exit-1 consistency rule removed → RC6 red.
- (d) The contract line compare loosened to `startsWith`/`includes` → RC4b red.
- (e) The cap in `runnerCeilingMs` removed → RC9 red.

**Done when:**
- The suite exits 0.
- `wc -l < _shared/lib/verify-runner-path.cjs` ≤ 450.
- The numstat deletion check (Execution location) exits 0.
- 5 RED-proof lines are logged.

**Covers:** SC-3, SC-4, SC-6

---

## Wave 7 — Runner path inside `runVerify` (sequential after lanes)
**Depends on:** Wave 6

### Task 7.1: Head, lazy base and serial retry through the base runner
**Goal:** With `opts.runner === true`, the lazy path runs both sides and the retry through the base runner, falls back when it must, and records `runner_source`/`runner`.
**Actions:**
1. `_shared/lib/verify-run.cjs`:
   - (a) `commandReason`: add the D8 `leak_note` branch.
   - (b) New `runnerSides(project, basePlan, headPlan, baseSha, ctx, rp)`, with `ctx = {tmp, touches, cwd, flakyBase, env, lockWaitMs}` and `rp` = the prepared runner:
     1. head `runSide` over every head id (default workers);
     2. finish every record;
     3. `need` per D2, minus ids absent at base (`git cat-file -e`);
     4. when `need` is non-empty, `vb.withSnapshot(project, baseSha, (dir) => runSide({root: dir, side: 'base', ...}), 'base')`, building `base.ids` (via `vb.idSet(finishCommand(...))`), `base.skipped` (empty Map) and `base.durations`;
     5. the retry candidates by `vb.isRetryable`; when there are any, one `runSide({root: ctx.cwd, side: 'retry', workers: 1, ...})`;
     6. `settle` each with the prefetched retry.

     It returns the same shape as `lazyHeadSide` plus `runnerWaitMs` (Σ side waits) and `runner: {fallback: null, why: null, contract: 1, sides: {head, base, retry}}`, where each side is `{requested, exit, ms, lock_wait_ms, checks_skipped, summary_notes}` or `null`. Before each runner call the remaining wait is recomputed per D18: `max(0, lockCeilingMs(env) − lock.waitedMs − runnerWaitMs so far)`.
   - (c) In the lazy branch of `runVerify`:
     - when `opts.runner === true`, compute `eligibility`; if ok, `prepareRunner(project, baseSha, runEnvSuite)`; if ok, take `runnerSides`, else `lazyHeadSide`;
     - the record gets `runner_source: 'base'|'none'` and `runner` (with `fallback`/`why` set on the `none` path) only when `opts.runner === true`;
     - `runEnvSuite = suiteEnv(runEnv)` is built once and used for every runner call and `prepareRunner` (D9);
     - the remaining wait per D18 (recomputed before each runner call), and the record's `lock_wait_ms` = `lock.waitedMs + runnerWaitMs` (`lock.waitedMs` alone on every other path);
     - `deps = {spawnGroup, noteSpawn}`.
   - (d) Keep `runVerify` within 50 lines by moving side selection into `selectSides(...)`. `selectSides` calls `rp.release()` on the prepared runner in a `finally`, so the `a1-verify-runner-*` dir is gone when `runVerify` returns, not only at process exit (audit m6).
2. Create `_test-fixtures/a1-verify/cases-runner-path.sh`. Helpers:
   - `rp_repo <label> [base-hook] [head-hook]` builds a git repo: `_test-fixtures/s1/run-tests.sh` and `_test-fixtures/s2/run-tests.sh` (each prints `s: 1 passed, 0 failed` and exits per a variable), `.a1/verify.json` `{"each":"_test-fixtures/*/run*.sh","argv_prefix":["bash"],"timeout_ms":60000}`, copies of the real runner files, the minimal groups file, `src/app.js`; base on `main`, head on `feat` with a source change.
   - `rp_run` = `node -e` calling `runVerify({project, base: 'main', noCache: true, lazyBase: true, runner: true})`. It prints the record JSON, or `{"error": <reason>, "message": ...}` on `VerifyError`.
   - A fake base runner `$WORK/fake-runner.sh`, copied into a base commit when a case asks for it. It answers `--contract`, parses `--json-out` and the selectors, prints `PASS all` to stdout, writes `$A1_FX_RUNNER_JSON` (a template whose `@IDS@` it can expand or not, per `A1_FX_RUNNER_MODE`: `mirror`, `drop-one`, `extra`, `leak-first`, `red-first`, `symlink`, `exit2`), prints `$A1_FX_RUNNER_ERR` to stderr in mode `exit2`, and exits per `A1_FX_RUNNER_RC`.

   Cases:
   - RP1: both green. `runner_source` base, verdict pass, `base_run.ran` `[]`, no `runner:base` spawn line, `runner.sides.head.checks_skipped` includes `learnings` and `phases`, `runner.sides.base` null.
   - RP2 marker: the head edits `bin/run-suites.sh` to start with `touch "$A1_FX_MARK"`. The marker is absent after `rp_run`, `runner_source` base. Control in the same case: `bash <head checkout>/bin/run-suites.sh --contract` creates the marker.
   - RP3: head `_test-fixtures/suite-groups.json` = `{not json`. Verdict pass, `runner_source` base.
   - RP4: base without `bin/run-suites*.sh` (the head adds them). `runner_source` none, `runner.fallback` `base_copy_missing`, verdict pass, spawn log has `h` lines (sequential lazy path).
   - RP5: base runner = `exit 2` stub. Fallback `no_contract`.
   - RP6: fake runner `drop-one`. Error `runner_result_mismatch`.
   - RP7: fake runner `leak-first`. The first id's `reason` is `leak_note`, verdict fail.
   - RP8: fake runner `exit2` with stderr `run-suites: lock wait of 5 ms exceeded; another run holds the lock` and rc 2. Error `lock_timeout` (D18), message contains `lock wait of 5 ms exceeded`.
   - RP8b: fake runner `exit2` with stderr `run-suites: unknown argument: --x` and rc 2. Error `suite_runner_failed`, message contains `unknown argument: --x`.
   - RP9: fake runner `red-first` with rc 0 and stdout `PASS all`. Verdict fail (red wins); the first id's reason `command_failed`.
   - RP10: plan with a `node-test` command. `runner.fallback` `not_eligible`.
   - RP11: s2 red on head, green on base (real runner). Exactly one `runner:base` spawn line, for `_test-fixtures/s2/run-tests.sh`, verdict fail.
   - RP12: fake runner `symlink`. Error `runner_result_invalid`.
   - RP13: s1 leaks into its sentinel vault on head (real runner). `leak_note` reason, verdict fail.
   - RP14: env token: `runner.sides.head` ran with the verify lock held. An s1 probe writes `$A1_VERIFY_LOCK_TOKEN` and `${A1_VERIFY_LOCK_DIR}` to `$A1_FX_OUT`: the token is 32 hex and the dir is the case's lock dir (D12 off under a token).
   - RP15 release: with `TMPDIR="$WORK/rp15-tmp"` (created first; the case's `A1_VERIFY_LOCK_DIR` is set as always), after a green `rp_run` no `a1-verify-runner-*` dir is left under `$WORK/rp15-tmp`.
   - The real-lock leak assert.
3. Append the source line; run `bash _test-fixtures/a1-verify/run-tests.sh` and `bash _test-fixtures/a1-pr-merge-check/run-tests.sh` (merge-check does not pass `runner` yet, so it is unchanged).

RED-proof:
- (a) `prepareRunner` replaced by the head snapshot's `bin/` → RP2 red.
- (b) `--groups-file` dropped from the argv → RP3 red.
- (c) The fallback throws instead → RP4 red.
- (d) The `leak_note` branch removed → RP7 and RP13 red.
- (e) The runner exit used as the verdict (exit 0 → all pass) → RP9 red.
- (f) Base `need` = all ids → RP11 red.
- (g) The D18 stderr mapping removed (every exit 2 is `suite_runner_failed`) → RP8 red.
- (h) `rp.release()` removed from `selectSides` → RP15 red.

**Done when:**
- Both suites exit 0.
- Caps hold.
- The numstat deletion check (Execution location) exits 0.
- 8 RED-proof lines are logged.

**Covers:** SC-3, SC-4, SC-6, SC-1

---

## Wave 8 — Retry order, watchdog, env equality, lock wait; merge-check wiring and docs (sequential after lanes)
**Depends on:** Wave 7

### Task 8.1: FR-015 proofs, merge-check `runner: true`, help and registry
**Goal:** Merge-check uses the runner path. Hang, flaky, base-red, env equality and lock-wait passthrough are proven end to end, and the docs name every new field and reason.
**Actions:**
1. `_shared/lib/pr-merge-check.cjs`:
   - the `runVerify` call adds `runner: true`;
   - the report `suites` adds `runner_source: record.runner_source || null`, `runner: record.runner || null`, `base_run: record.base_run || null`.
2. Create `_test-fixtures/a1-verify/cases-runner-retry.sh` (helpers from `cases-runner-path.sh` are in scope because they are sourced earlier; reuse `rp_repo`/`rp_run`). Each `rp_run` runs in the background with a 120 s kill bound:
   - RR1: head s1 `sleep 600`, base s1 `exit 1`, `timeout_ms` 3000. Reason `timeout`, `pre_existing_red` empty, verdict fail, `duration_ms.total` < 60000.
   - RR2 flaky: s1 uses a counter file (`$A1_FX_CTR`): first call exit 1, then 0; `flaky_base: ["_test-fixtures/s1/run-tests.sh"]` committed on base and head. Verdict pass, `retried` true, `flaky` names s1; spawn-log order `runner:head` lines, then `runner:base`, then `runner:retry`; `runner.sides.retry.requested` 1.
   - RR3: s1 red on head and base. `pre_existing_red` names s1, verdict pass.
   - RR4 env equality: s1 red on both sides writes `env | LC_ALL=C sort | grep -v -E '^(HOME|A1_VAULT_ROOT|PWD|OLDPWD|_|SHLVL)='` to `$A1_FX_ENVDIR/<base|head>.env` (side from `case "$PWD" in *a1-fx-verify-base-*) ...`). `diff` of the two files is empty and both are non-empty.
   - RR5 (D18): a fake live runner (D21 b/c) holds `A1_SUITE_LOCK_DIR` for 5 s from its start; then the case removes the dir and sends TERM to the holder's own PID. Verdict pass; `runner.sides.head.lock_wait_ms` ≥ 1000; top-level `lock_wait_ms` ≥ `runner.sides.head.lock_wait_ms`; and `lock_wait_ms` − (head + base + retry side waits) < 1000 (the verify lock was free).
   - RR6 (D18): the same holder for 60 s with `A1_VERIFY_LOCK_WAIT_MS=2000`. Error `lock_timeout`, message contains `lock wait of`, wall time ≥ 1500 ms and < 30 s; TERM the holder by its own PID.
   - The real-lock leak assert.
3. Create `_test-fixtures/a1-pr-merge-check/cases-runner.sh`. Planted repo as in `rp_repo` (define a local copy of the helper here; the suites are separate processes), merge-check through `mc` (gh stub, so the local path):
   - MR1: green. Exit 0, `suites.runner_source` base, `suites.lock_wait_ms` an integer, `suites.base_run.ran` `[]`.
   - MR2: fake runner `drop-one`. Exit 2, stdout `error` `runner_result_mismatch`.
   - MR3: fake runner `exit2` with `A1_FX_RUNNER_ERR='run-suites: unknown argument: --x'`. Exit 2, `error` `suite_runner_failed`, message contains the stub's text.
   - MR3b: the same with `A1_FX_RUNNER_ERR='run-suites: lock wait of 5 ms exceeded; another run holds the lock'`. Exit 2, `error` `lock_timeout`, message contains `lock wait of 5 ms`.
   - MR4: hanging head s1 with red base. Exit 1, reasons contain `suite_red_on_head` with cause `timeout`, and no `base_red_unreported`.
4. `_shared/lib/help-verify.cjs`: one added paragraph (keep the template's style). It covers:
   - the lazy order (merge-check only, D1);
   - the runner path (when, `runner_source`, `runner.fallback` values, `base_run`);
   - the lock (`lock`, `lock_wait_ms`, the seams `A1_VERIFY_LOCK_DIR`/`A1_VERIFY_LOCK_WAIT_MS`, 15 min, `lock_timeout`, `lock_unusable`, token re-entrancy, "the token only skips the wait; it is not authorization");
   - the new exit-2 reasons (D16) and reason `leak_note`;
   - that on the long path the runner's lock wait counts toward the same 15 minutes and the same `lock_wait_ms`, with `lock_timeout` past it (D18);
   - that local `verify run` calls on one host serialise, so parallel lanes run their gates one after another, and exit 2 `lock_timeout` means "host busy, re-run", not red (D19);
   - that the verify lock path follows `TMPDIR` (`os.tmpdir()`) while the runner lock is fixed under `/tmp`, so two sessions with different `TMPDIR` do not serialise on the verify lock (audit m10).
5. `_shared/lib/help-merge-check.cjs`: the same facts for merge-check in two to four lines (lazy base, base-sourced runner, no lock on the CI-evidence path, new report fields).
6. `_shared/gates-registry.md`:
   - the `pr-merge-check` row description gets one sentence: lazy base; the long path through the base sha's runner with JSON evidence, id-set check, serial retry and watchdog; the lock; the new exit-2 reasons; `leak_note`;
   - the `gate-1-build` row gets one sentence: every local `verify run` takes the CLI lock;
   - the `workflow-pipeline-exit` row gets one sentence: the `quiet-host-poll` rule;
   - no new gate id, no invoke change.
7. Run `bash _test-fixtures/a1-verify/run-tests.sh`, `bash _test-fixtures/a1-pr-merge-check/run-tests.sh`, `bash _test-fixtures/a1-cli-output/run-tests.sh`, `bash _test-fixtures/a1-gates-lint/run-tests.sh`, `node _shared/a1-tools.cjs gates lint --phase 027-lean-pipeline-s3`.

RED-proof:
- (a) The retry runner call moved before the base call → RR2 order red.
- (b) `--suite-timeout-ms` dropped from the argv → RR1 red (bound).
- (c) The base side given `{...runEnvSuite, A1_FX_SIDE: 'b'}` → RR4 red.
- (d) `runner: true` removed from `mergeCheck` → MR1 red.
- (e) `--lock-wait` passed as `0` → RR5 red.
- (f) The runner side waits not added to the top-level `lock_wait_ms` → RR5 red.

**Done when:**
- The five commands exit 0.
- Caps hold.
- The numstat deletion check (Execution location) exits 0.
- 6 RED-proof lines are logged.

**Covers:** SC-5, SC-6, SC-8, SC-1

---

## Wave 9 — FR-012 deletion check, integration, measured rehearsal (sequential after lanes)
**Depends on:** Wave 8

### Task 9.1: `bin/check-assert-deletions.sh`, full run, SC-003 rehearsal
**Goal:** FR-012 has its script, the whole tree is green, and the long path is measured on aiserver.
**Actions:**
1. Create `bin/check-assert-deletions.sh` (bash 3.2, `set -u`):
   - usage `--base <ref> [dir...]`, default dirs `_test-fixtures/a1-pr-merge-check _test-fixtures/a1-verify`;
   - `git rev-parse --verify "<ref>^{commit}"` fails → stderr usage line, exit 2;
   - otherwise `git diff --numstat "<ref>...HEAD" -- <dirs>`: sum column 2, where a binary `-` counts as 1;
   - print `deleted=<n>` plus one `<file> <n>` line per file with deletions;
   - exit 0 when 0, 1 otherwise.
2. Create `_test-fixtures/a1-verify/cases-assert-deletions.sh` (planted repos):
   - AD1: add-only change → 0, `deleted=0`.
   - AD2: one deleted line in `_test-fixtures/a1-verify/run-tests.sh` → 1, names the file.
   - AD3: one edited line → 1.
   - AD4: `--base nope` → 2.
   - AD5: a deletion outside the two dirs → 0.

   Append the source line.
3. Run, recording output in `STATUS.md`:
   - `bash bin/check-assert-deletions.sh --base origin/main` → 0;
   - `git diff --quiet origin/main -- .a1/verify.json _test-fixtures/suite-groups.json .github/` → 0;
   - `wc -l` of every D14 file;
   - `bash -n bin/*.sh`;
   - `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s3` → 0;
   - `node _shared/a1-tools.cjs gates lint --phase 027-lean-pipeline-s3` → 0;
   - `bash bin/run-suites.sh --check-groups` → 0;
   - `git diff origin/main -- _shared/lib/verify-base.cjs` shows only the `isRetryable` export line;
   - `git diff origin/main -- _shared/lib/pr-merge-check.cjs` shows only the `runVerify` options and the four `suites` fields.
4. Full suite run: `bash bin/run-suites.sh` → exit 0. A red id follows the per-wave red rule of Execution location.
5. **Rehearsal (SC-9).** Quiet host (the `sh` load line of 05-merge.md; at `host_busy=true` wait and retry once):
   ```bash
   R="$(git rev-parse --show-toplevel)"; S="$(mktemp -d)"; git clone -q --no-local "$R" "$S/c"; B="$(git -C "$S/c" rev-parse HEAD)"
   printf '\nrehearsal\n' >> "$S/c/docs/roadmap.md"; git -C "$S/c" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qam rehearsal
   node -e 'const os=require("os");console.log(JSON.stringify({load5_start:os.loadavg()[1],cpus:os.cpus().length}))' > "$S/load-start.json"
   (cd "$S/c" && unset A1_VAULT_ROOT && node -e 'const v=require("./_shared/lib/verify-run.cjs");const r=v.runVerify({project:".",base:process.argv[1],noCache:true,lazyBase:true,runner:true});process.stdout.write(JSON.stringify(r))' "$B") > "$S/rehearsal.json"; echo "rc=$?"
   node -e 'const os=require("os");console.log(JSON.stringify({load5_end:os.loadavg()[1]}))' > "$S/load-end.json"
   ```
   Write `.a1/phases/027-lean-pipeline-s3/LONG-PATH-REHEARSAL.json` with:
   - `{host, date, base_sha, head_sha, node, verdict, runner_source, base_run, duration_ms, lock_wait_ms, workers, host_load: {load5_start, load5_end, cpus, host_busy}, baseline_total_ms: 2990052}`;
   - `runner.sides.head.ms`, `runner.sides.base`, and `runner.sides.head.checks_skipped`.

   Pass: verdict `pass`, `runner_source` `base`, `base_run.ran` `[]`, `duration_ms.total` ≤ 900000. Anything else is a STOP with the file kept.
6. Commit `LONG-PATH-REHEARSAL.json` on the branch.

RED-proof:
- (a) The script sums column 1 (additions) instead of column 2 → AD1 red (an add-only change reports deletions).
- (b) The default dirs dropped (no dirs means the whole repo) → AD5 red.

**Done when:**
- Every command of actions 3-4 exits as stated.
- `LONG-PATH-REHEARSAL.json` exists with the pass values.
- 2 RED-proof lines are logged.

**Covers:** SC-2, SC-9, SC-10

**Follow-up, not in this phase (audit m11).** `bin/check-assert-deletions.sh` runs only in Task 9.1 and V5. It is not wired into CI or into 05-merge.md, because `.github/` is frozen by D14 and FR-012 needs it only for this slice. A later phase wires it into CI (or 05-merge §5.3) so the script does not sit unused. The PR text names this.

---

## Verification
After all waves, against the final branch head, cwd = worktree root. The red runs were executed on `main` @ `bc47b07` on 2026-11-18 (scratchpad) unless noted.
- [ ] V1 Lazy base under merge-check: in a planted repo, `runVerify({base: "main", noCache: true, lazyBase: true})` with a green head writes no `b` line to `A1_VERIFY_SPAWN_LOG` (LZ1, ML1).
  - Red when: base runs for a green head.
  - Red run: the same call on `bc47b07` (the option ignored, with a cwd-logging stub) printed `pass true off` and `spawns=2 base_spawns=1`.
- [ ] V2 `bash bin/run-suites.sh --contract` prints exactly `a1-suite-runner-contract 1` with exit 0. `--json-out`, `--groups-file`, `--lock-wait` and `--suite-timeout-ms` are accepted (parts 17-20).
  - Red when: any option is unknown.
  - Red run: each of the five gave `rc=2 run-suites: unknown argument: <option>`.
- [ ] V3 `node -e 'require("./_shared/lib/verify-lock.cjs")'` exits 0, and LK1-LK12, RR5, RR6 and MR3b pass (D18 reading of US-027-4 AC 2).
  - Red when: the module is missing or a lock case fails.
  - Red run: `node:internal/modules/cjs/loader` MODULE_NOT_FOUND.
- [ ] V4 `grep -rn pgrep skills/` prints nothing; `workflow lint` exits 0 with a `quiet_host_checked` key; QH2 exits 1.
  - Red when: poll text remains, or the rule is missing.
  - Red run: `grep` counted 2 lines; `workflow lint` exited 0 with keys `root,scanned,vault_sync_checked,verify_scope_checked,reuse_ban_checked,findings` and 0 findings (the poll passes).
- [ ] V5 `bash bin/check-assert-deletions.sh --base origin/main` exits 0.
  - Red when: any line in the two suite directories was deleted or edited.
  - Red run: in a planted repo, one deleted `check` line gave `git diff --numstat ... | awk` → `deleted=1`. On the real history, slice 2 (`3a6d00c`) gives `deleted=0`, so the check is not vacuous only because of the planted red.
- [ ] V6 `git diff --quiet origin/main -- .a1/verify.json _test-fixtures/suite-groups.json .github/` exits 0.
  - Red when: a config file was edited.
  - Red run: `git diff --quiet 3a6d00c~1 3a6d00c -- .a1/verify.json _test-fixtures/suite-groups.json` gave `rc=1`.
- [ ] V7 `node -e 'console.log(typeof require("./_shared/lib/verify-base.cjs").isRetryable)'` prints `function`, and RC8 pins `RETRYABLE`/`NEVER_PRE_EXISTING`.
  - Red when: the export is missing or a constant changed.
  - Red run: `Object.keys(...).includes("isRetryable")` printed `false`.
- [ ] V8 SC-9: `LONG-PATH-REHEARSAL.json` has `duration_ms.total` ≤ 900000, `runner_source` `base`, verdict `pass`.
  - Red when: the parallel path is slower than 15 min or fell back.
  - Red run: `BASELINE.json` `merge_check_long_path` measured `total_ms 2990052` (serial path, the value this criterion compares against) > 900000.
- [ ] V9 The caps of D14 hold:
  ```bash
  F=0; for p in "_shared/lib/verify-run.cjs 800" "_shared/lib/verify-runner-path.cjs 450" "_shared/lib/verify-lock.cjs 300" "bin/run-suites.sh 800" "bin/run-suites-proc.sh 600" "bin/run-suites-report.sh 300" "_shared/lib/workflow-lint-verify.cjs 250"; do set -- $p; if [ ! -e "$1" ] || [ "$(wc -l < "$1")" -gt "$2" ]; then echo "cap: $1"; F=1; fi; done; echo "rc=$F"
  ```
  - Red when: a file is missing or exceeds its cap (prints `cap: <file>`, `rc=1`).
  - Red run (2026-11-18, `bc47b07`, audit m3): the same loop with `"bin/run-suites.sh 700"` printed `cap exceeded: bin/run-suites.sh 756 > 700` and `rc=1`.
- [ ] V10 `bash bin/run-suites.sh` exits 0 on the final head.
  - Red when: any suite fails.
  - Red run: the 47 RED-proof mutations (W1 5, W2 7, W3 5, W4 5, W5 4, W6 5, W7 8, W8 6, W9 2), each applied once on a scratch copy and logged.
- [ ] V11 (D19) `grep -c lock_timeout` is at least 1 in each of `skills/a1-execute/workflows/02-execute.md`, `skills/a1-execute/workflows/03-verify.md`, `skills/a1-new-feature/workflows/05-implement.md` and `skills/a1-new-feature/workflows/06-verify.md`; QH7 passes; `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` prints `calls=15`.
  - Red when: a gate block still reports exit 2 as red, or a gate call line changed.
  - Red run: on `bc47b07` the grep counted 0 in all four files; a ` --x` flag appended to the 02-execute.md call on a `git archive` copy made the W11 check exit 1.

Post-merge (reported by a1-progress, not a merge condition): the first real long-path merge-check after this slice (base carries the contract) records `suites.runner_source: "base"` and its `duration_ms` per the FR-004 run record. SC-003 is confirmed from that measurement next to the rehearsal.

## Review and merge (merge dependency)
- Review path in this repo: `a1-specforge:a1-samuel-security` plus `a1-specforge:a1-reinhard-reviewer` only. `.a1/xprov.json` is `external_review: denied`: no Codex review; nobody asks for or waives a permit.
- **Samuel must be spawned explicitly** (spec Dependencies: slices 1-3; hard merge dependency). He reviews the full PR diff. Brief points:
  1. D5/D6: the runner and its groups file come only from the base sha (4-file `git archive`, contract handshake, fallback reasons). Can head-controlled content reach the runner script, its sourced files or its groups file?
  2. D7/D16: the JSON evidence path. It lives in a verify-owned `mkdtemp` dir outside both snapshots; `lstat`, size cap, strict schema, set equality, consistency rules, red wins, stdout never read. Residual: same-user code under test that escapes its process group could in principle write the file. That is the F-032 class, out of scope, and is named in the PR text.
  3. D8: `leak_note` is not retryable and not in `NEVER_PRE_EXISTING` (constant unchanged); `summary_note` stays out of the verdict for parity with the serial path.
  4. D9/D10: one env object; retry only for `isRetryable` ids, after base; the watchdog maps a hang to `timeout`, never pre-existing.
  5. D11/D12: the lock design, PID-reuse proof, takeover guard, the not-a-security-boundary token, the per-worker lock dir only without a token, and the lock after config resolution.
  6. D1: lazy order scoped to merge-check (CLI stays eager), and D2's equivalence argument.
  7. D3: the `A1_VERIFY_SPAWN_LOG` test seam (append-only, absolute path, env-controlled by the caller only).
  8. D18: the stderr-line match maps a runner exit 2 to `lock_timeout` instead of `suite_runner_failed`. Both are exit 2, so a forged line changes only the reason name, never a verdict. D19: the gate blocks treat `lock_timeout` as "re-run"; can that hide a real red?
- `a1-specforge:a1-reinhard-reviewer` reviews the full diff once (via a1-pr-review).
- Every BLOCKER and MAJOR of both is fixed before `pr merge-check`. After fixes, re-run the touched suites and Task 9.1 actions 3-4. Re-run action 5 only when a fix touches `verify-run.cjs`, `verify-runner-path.cjs` or `bin/run-suites*.sh`.
- **CI.** All jobs of `test` green on the PR head. CI evidence is not used for this PR: `bin/run-suites*.sh` are `ci_evidence.unchanged` paths (`protected_path_changed`).
- **Merge check, once.** Start it only after all review fixes are pushed. Run it per 05-merge.md 5.3 with the installed plugin (1.17.0, which has no lazy base and no runner path). Expect the eager serial path: about 50 min (BASELINE.json 49.8 min), `ci_evidence.why` `protected_path_changed`, no `verify_config_changed` (D14).
  - If `<repo>` resolves to this branch's own tree instead, expect the lazy sequential path with `runner_source: "none"`, `runner.fallback: "no_contract"` (base = `main` has no contract) and about 25-30 min.
  - Never start it twice for the same head. A second run happens only after a red reason was fixed with a new commit.
  - Record the `sh` load line next to the result.
- **PR text.** It names:
  - D1, lazy scoped to merge-check, with the two binding pins VD2 and PT0 (K1-K6 are cache runs); named as an FR-011 narrowing ("merge-check only") for the owner's separate spec reconcile;
  - D5, base-only runner source and the slice's own merge-check falling back;
  - D7, the contract and the residual of review point 2;
  - D8 `leak_note`/`summary_note`;
  - D12, the per-worker lock dir and the six measured nesting suites. The spec's FR-018 nesting list (four suites, measured 2026-11-12) is stale; this phase leaves the spec unchanged and the owner reconciles it separately (audit m12);
  - D16 the reason `suite_runner_failed` (not `runner_failed`, which xprov uses);
  - D18, the runner lock wait inside `lock_wait_ms` and `lock_timeout` for a runner lock held past the bound;
  - D19, the gate exit-2 routing and the consequence that local `verify run` calls on one host serialise (parallel lanes run their gates one after another);
  - the follow-up for `bin/check-assert-deletions.sh` (audit m11);
  - D13, why one `sh` fence stays;
  - the rehearsal numbers next to BASELINE.json, with `host_load`.
- After the merge (orchestrator, not Erik): `claude plugin update a1-specforge` on both hosts. Remove the untracked copy of this phase folder from the primary checkout only after `git diff --quiet origin/main -- .a1/phases/027-lean-pipeline-s3` holds.

## Revision Notes
Revision 1, 2026-11-18. The audit verdict was PASS (0 BLOCKER). Before the cross-provider review binds the PLAN.md sha, the orchestrator ordered fixes for M1-M4, m1-m11 and m13. All passing tasks keep their structure; the lane split (verify, runner, lint; sequential 6-9) is unchanged except that lane lint now also owns three workflow files.

| Finding | Change |
|---|---|
| M1 run-suites.sh cap | New D20: option checks, `rs_parse_ms`, `rs_set_check`, `rs_now_ms` and the watchdog live in `bin/run-suites-proc.sh`; `bin/run-suites.sh` keeps only case arms, call lines and header. Task 3.1 actions 1(b), 1(d), new 3a; Wave 3 Done-when `run-suites.sh` ≤ 775 with a red run; Task 4.1 parse via `rs_parse_ms`. |
| M2 runner lock reading | New D18 (orchestrator decision: follow the spec wording, no `a1-reconcile`): the runner's measured wait goes into the D7 JSON (`lock_wait_ms`), per side into the record and into the top-level `lock_wait_ms`; a runner exit 2 with the lock-wait line is `lock_timeout`. One ceiling for all calls. SC-8 rewritten to state the reading; RR5/RR6, RP8 now assert D18; new RP8b, MR3b; RED-proofs W7 (g), W8 (f). |
| M3 a1-execute lane gate | New D19 (mechanism: routing text plus one rc-2 branch, ceiling unchanged): the STOP line of the per-wave gate blocks in 02-execute.md and 05-implement.md splits exit 2; 02-execute.md runs per-lane gates one after another; 03-verify.md and 06-verify.md name `lock_timeout` as "re-run, not FAIL". Lane lint owns the three extra files; Task 5.1 action 2a, case QH7, RED-proof (d), W11 Done-when with a red run; V11; help-verify and PR text name the serialisation. Measured lint-safe on a `git archive` copy. |
| M4 timing races | New D21: lock-wait deadline in ms from `node` `Date.now()`; holders poll `ps` for their marker before writing the owner; the fake runner holder is `bash -c 'trap ...; sleep N & c=$!; wait' run-suites.sh` (measured: plain `bash -c 'sleep N'` execs `sleep` and loses the runner name, an extra defect the audit did not name). Tasks 2.1 (`vl_holder`), 4.1 (deadline, W1, W3), 8.1 (RR5/RR6). |
| m1 | D1 "Why", Depth Pass 1 and the Rewritten brief name VD2 and PT0 as the binding pins; K1-K6 are cache runs. The FR-011 narrowing goes into the PR text for the owner's separate spec reconcile (no `a1-reconcile` here, by orchestrator decision). |
| m2 | One numstat deletion probe defined in Execution location (three-dot, `-` counted, `exit (d>0)`), with a red run; every Done-when references it. |
| m3 | V9 is an executable loop with a measured red run. |
| m4 | LK12 sets `A1_VERIFY_LOCK_WAIT_MS=3000`. |
| m5 | Task 6.1 requires `vb.VerifyError`; RC5 asserts `instanceof`. |
| m6 | Task 7.1(d) releases the runner dir in `selectSides`' `finally`; RP15 and RED-proof (h). |
| m7 | D17 cap `2147483647 - KILL_GRACE_MS` via `runnerCeilingMs`; RC9 and RED-proof W6 (e). |
| m8 | Task 1.1 extracts `eagerSides` in Wave 1. |
| m9 | Reason renamed to `suite_runner_failed` (D16 and all cases). |
| m10 | help-verify names the `TMPDIR` dependency of the verify lock path (Task 8.1). |
| m11 | Follow-up note after Task 9.1 and in the PR text. |
| m12 | Not changed in the spec (orchestrator decision); the PR text names the stale FR-018 nesting list. |
| m13 | The real-lock state assert became the real-lock leak assert (Execution location): red only for a lock held by this suite's own process tree or a newly leaked dead-PID lock. |

The Depth Pass keeps its five sections. Answers 1, 2, 3 and the Rewritten brief were updated (m1 pins, the D18/D19 lock surfacing, the revision measurements, the ms clock). RED-proof total: 42 → 47.
