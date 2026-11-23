---
phase: 027-lean-pipeline-s4
goal: Ship delivery slice 4 of spec 027-lean-pipeline ("Less waiting and double work") as two sequential PRs. PR A (FR-019..FR-022) gives pr-reinhard a record writer and one review per head sha, reuses three cheap consistency gates by input hash, lets waves continue on their own unless `wave next-check` names a stop reason, and drops the PR confirmation. PR B (FR-023..FR-026) starts Rico and Marco together, runs `verify run` in the background during Verify, bundles the per-wave checks in `wave checks`, adds the size-S step list and the idempotent `feature close`. Every keep-list gate stays load-bearing.
spec: /home/rob/N3URAL-Vault/project/a1-specforge/spec/027-lean-pipeline.md (slice 4 only - US-027-5..US-027-9, FR-019..FR-026, SC-004, SC-005, SC-007, SC-008, Acceptance Scenarios US-027-5..9, Edge Cases "reused passes / wave deviation after green gate / feature close after partial close", Quality Invariants, Delivery Slices item 4, Clarification 2026-11-20); RESEARCH.md Decisions (all four answered (a), 2026-11-20)
waves: 10
lanes:
  - id: cli-a
    waves: [1, 2]
    owns:
      - "_shared/a1-tools.cjs"
      - "_shared/lib/gate-log.cjs"
      - "_shared/lib/reuse-hash.cjs"
      - "_shared/lib/lane-split.cjs"
      - "_shared/lib/fix-class-sweep.cjs"
      - "_shared/lib/gates-lint.cjs"
      - "_shared/gates-registry.md"
      - "_shared/lib/pr-review-record.cjs"
      - "_shared/lib/wave.cjs"
      - "_shared/lib/wave-next-check.cjs"
      - "_shared/lib/help.cjs"
      - "_shared/lib/help-lean.cjs"
      - "skills/a1-pr-review/workflows/02-review.md"
      - "_test-fixtures/a1-lib-units/cases/reuse-hash.cjs"
      - "_test-fixtures/a1-lib-units/cases/pr-review-record.cjs"
      - "_test-fixtures/a1-lib-units/cases/wave-next-check.cjs"
      - "_test-fixtures/a1-lib-units/cases/help-lean.cjs"
      - "_test-fixtures/a1-gates-lint/run-tests.sh"
      - "_test-fixtures/a1-gates-lint/cases-pr-reinhard.sh"
      - "_test-fixtures/a1-pr-review/run-tests.sh"
      - "_test-fixtures/a1-pr-review/cases-review-record.sh"
    agent: a1-erik-executor
  - id: flow-a
    waves: [3, 4]
    owns:
      - "skills/a1-new-feature/workflows/06-verify.md"
      - "skills/a1-new-feature/workflows/05-implement.md"
      - "skills/a1-execute/workflows/02-execute.md"
      - "skills/a1-execute/SKILL.md"
      - "skills/a1-pr-review/workflows/03-draft.md"
      - "skills/a1-pr-review/workflows/04-submit.md"
      - "_shared/lib/workflow-lint-flow.cjs"
      - "_test-fixtures/a1-workflow-lint/run-tests.sh"
      - "_test-fixtures/a1-workflow-lint/cases-flow.sh"
    agent: a1-erik-executor
sequential_after_lanes: [5, 6, 7, 8, 9, 10]
status: revised
created: 2026-11-20
phase_kind: code
---

## Depth Pass

### 1 What a top professional would do
A build-infrastructure engineer from the content-addressed action-cache school (Bazel remote cache, Buildkite/GitHub Actions job reuse) plus a release engineer for destructive tooling would add four things the brief does not ask for:
- **Reuse is an action cache, so the key covers the tool too.** A pass may be reused only when every declared input, the call arguments and the gate's own implementation are byte-identical. A plugin update that changes `checklist.cjs` or one of its local requires must not reuse a verdict computed by the old code. So the input hash includes the sha256 of the gate module's local require closure (D6). Gates that read the code tree (`fix class-sweep --verify`, `lane-split check --imports`) also need the same head sha and a clean tracked tree; otherwise a code change slips through behind an unchanged bug report or plan.
- **Auto-continue is a state machine with named stops, each fed by one owned source that always exists.** The owner adopted "missing source = stop" (2026-11-20). The real data shows smooth executor runs write no `observations.jsonl` (agents/a1-erik-executor.md:107) and 8 of 8 a1-plan phases had no GOAL.md (02-execute.md:244). So the orchestrator creates both stores empty at phase start and commits them in the same step (an untracked store would stop the commit-landed gate and the worktree exit, D21); from then on a missing store really means something broke, and the literal rule stops only on that (D7).
- **Destructive close-out runs refusable steps before irreversible ones.** `feature close` records every gate-log scope and exits the worktree before it advances stages, releases the scope and closes the spec. A dirty worktree therefore refuses the call before anything has changed, and a second call resumes idempotently. It never commits on `main`; it names the tracked file the skill must commit (D16).
- **Every text pin is found before the text changes.** They would grep every suite that reads a touched skill file and every sweep that resolves fenced calls against the real CLI, and change each pin deliberately with a red run: the call-site flag sweep (W13c/W14e), `check-wave11-callsites.cjs` counts, W11a-W11e, VS3, the DCMGRP 6-block pin, R3b, the a1-kritis-profile golden pins on `skills/a1-new-feature/SKILL.md` (P, P-allowed, D), and the a1-dashboard 05.26 shape of the 04-audit vault block, which this plan keeps intact (measured, D14).

Finally they would check the lane split for import edges, not only path overlap. The 027-s1 run lost its lanes to exactly that (GOAL.md 2026-11-12: `lane-split check --imports` found 4 cross-lane imports). This plan moves the `workflow-lint.cjs` hook out of every lane because `gates-lint.cjs` imports it.

### 2 Rawest material
- Source on `main` @ `54836f2`, read for this plan:
  - `_shared/lib/gate-log.cjs`: `EXTRA_RULES` 47, `setRecordExtra` 86, `appendGateLine` 244, `verifyChain` 301, `matchInvoke` 335, `stripPhase` 348, `projectDirOf` 365, `installGateLog` 429 (the scope is the local `scope` at 444; there is no `currentScope`).
  - `gates-lint.cjs` `gradeRow` 110-125 (`prompt_names_command` 121), `checkSkills`, `findCalls` 75, `callRegex` 42, `require('./workflow-lint.cjs')` 31.
  - `lane-split.cjs`: `cmdLaneSplitCheck` 312, `IMPORT_RE` owner check 256-300, exports 483.
  - `fix-class-sweep.cjs`: `doVerify` 251 rewrites the bug file at 261, `parseArgs` 301, `cmdFixClassSweep` 326.
  - `checklist.cjs` 823 lines: `checklistPaths` 70, check 11 `evaluateSpecRoadmapCoherenceCheck` 545 (roadmap via `spec-coherence.cjs` `findProjectRoadmap`), `cmdChecklistRun` 662.
  - `code-scope.cjs` 190-260 (forward-only stages); `locks.cjs:20-22` (`reservationsFile` = `<cwd>/.a1/reservations.json`, tracked in this repo: `git ls-files` lists it).
  - `worktree.cjs` `refuseUnpreservedGateLogs` 310-335 and `worktree-gatelog.cjs` `listGateLogs` 20 (skips `_unscoped`, lists every other non-empty scope).
  - `verify-run.cjs` `runHeadSide` 371; `verify-base.cjs` 133.
  - `pr-merge-check.cjs` `runGh` 74 (`A1_GH_BIN`, not exported); `run-record.cjs`; `a1-tools.cjs` 784 lines.
  - `_test-fixtures/a1-gates-lint/check-callsite-flags.cjs` (W13c/W14e): a fenced call passes when its `<group> <sub>` has a `--help` usage block (or the sub exists in the group source); `--phase` passes only when the registry invoke map names the call or the help block lists `--phase`; a two-word block that lists its flags is strict.
- Real artifacts:
  - `.a1/phases/027-lean-pipeline-s3/gate-log.jsonl` last record shape (`ts` with milliseconds, `gate, verdict, exit, head_sha, scope, started_at, duration_ms, prev`).
  - `observations.jsonl` of s1/s2/s3: 6/6/5 lines; types `gap`, `plan_quality`, `deviation` (s1, s3) and `blocker` (s2); every line has `wave`, none malformed.
  - `GOAL.md` `## Decisions` rows of s1 (`- 2026-11-12 — ... — affects: ...`, date-only).
  - `.gitignore:8` `.a1/phases/*/gate-log.jsonl`: gate logs are per checkout.
- Pins read in full:
  - `check-wave11-callsites.cjs` (FILES/FLAGS/CMD_RE) and `a1-gates-lint/run-tests.sh` W11a-W11f (455-490), R2 (120-128), R3b (139-142); `run-wave13.sh` W13c/W13f/W13g; `run-wave14.sh` W14e;
  - `a1-pr-review/run-tests.sh` 166-176 (`merge-check` ban, 2.2 unconditional), 234 (no `xprov gate` in 05-implement/06-verify), 244-275 (DCMGRP, `b[3]`, RR_POS), 340-361 (RR-guard);
  - `a1-workflow-lint/cases-verify-scope.sh` VS1-VS3, `cases-quiet-host.sh` QH7, `run-tests.sh` 395-419;
  - `a1-retro-validate/run-tests.sh` V8 (480-495) and L12 (865-880); `a1-pr-merge-check/cases-host.sh` MH9/MH9a; `a1-xprov/parts/12-permit-states.sh` P13; `a1-dashboard/parts/05-wiring.sh` 70-101, 165-180;
  - `a1-kritis-profile/parts/01-golden.sh` P (190-249) and P-allowed (251-286), `parts/08-wiring.sh` D (136-183), `golden/apply-prompts-allowed.cjs` (only `insert-after` + `line`), `golden/prompts.allowed-diff`;
  - `a1-lib-units/run-tests.sh` globs `cases/*.cjs`; `a1-kritis-profile/run-tests.sh` globs `parts/*.sh`.
- Red probes run on 2026-11-20 against `54836f2` (scratchpad), quoted in Verification:
  - `pr review-record`/`review-evidence` exit 1 `unknown pr subcommand`; `wave` and `feature` exit 1 `unknown command group`; `typeof currentScope` is `undefined`.
  - A planted registry with the `pr review-record` invoke on `pr-reinhard` gives `gates lint` rc=1 `prompt_names_command:pr-reinhard,unwired:pr-reinhard`.
  - Planted fenced `wave next-check` (02-execute.md) and `pr review-evidence` (02-review.md) lines: `check-callsite-flags.cjs` rc=1 `command does not exist in the real CLI` for both; the same tree plus two help usage blocks (with `--phase` listed) and no code: rc=0.
  - A planted background `verify run` line in 03-verify.md: the VS3 sed (`/a1-tools.cjs verify run/`) yields 2 `verify-scope` findings (VS3 wants 1); the sed restricted to `/a1-tools.cjs verify run.*--out/` yields exactly 1.
  - One inserted line in `skills/a1-new-feature/SKILL.md`: `a1-kritis-profile` 219 passed, 2 failed (`P SKILL.md` and `D skills/a1-new-feature/SKILL.md: removed=0 added=7`).
  - `git -C <main checkout> rev-parse --git-common-dir` prints `.git`; with `--path-format=absolute` it prints `/home/rob/claude-projects/a1-specforge/.git` (git 2.53.0).
  - Two identical `lane-split check --phase rp` runs give 2 records, without `input_hash` and without a `reused` line.
  - `workflow lint` exits 0 while `Continue? [y`, `Do **not** dispatch automatically`, `a1-reinhard-reviewer` (06-verify.md), `yes / no / adjust draft` and `Are you sure`/`User aborts at confirm` are present.
  - `check-wave11-callsites.cjs .` prints `calls=15`; the 05-merge block order is `6 DCMGRP`; `02-map.md` names RESEARCH.md once; 0 parallel markers.
  - A planted 02-review.md without the `a1-reinhard-reviewer` anchor gives `gates lint` rc=1 `invariant_owner_lost:pr-reinhard`.
  - The background form of the 04-audit vault block (D14) passes the a1-dashboard `callsite_check` (`ok`).

### 3 Methods and tools
- **Content-addressed reuse** (D6). The input hash is sha256 over a canonical JSON of `{v, gate, tool closure digests, args, file digests}`. A hit is the LAST record of that gate with that hash in a log whose chain verifies (`verifyChain`), and it must be `pass`. Gates that read the code tree also need `head_sha` equal to HEAD and a clean tracked tree. The hook stays the only writer, and extras go in through `setRecordExtra`.
- **Child-process composition**: `wave checks` and `feature close` call existing commands as `spawnSync(process.execPath, [facade, ...argv], {cwd: <project or repo>})`. Those commands call `process.exit`/`emitExit`, and each child writes its own gate-log line into the project it ran in.
- **argv-only git and gh**: `git-safe.cjs` `gitSafe`, `git check-ref-format --branch`, and the `A1_GH_BIN` seam with a node fake-gh driven by a JSON state file.
- **Static lint modules**, each taking the fence helpers as a parameter (the `workflow-lint-verify.cjs` pattern, no require cycle). They are tested on planted skill trees and on the real tree.
- **Help with the first call**: every new command's `--help` usage block lands in the same wave as (or before) its first fenced call, so the call-site sweep never sees an unknown command.
- **New tests**: `_test-fixtures/a1-lib-units/cases/<module>.cjs` (globbed), `a1-kritis-profile/parts/09-*.sh` (globbed), or `cases-*.sh` sourced once from an existing runner.
- **Process checks**: `lane-split check --imports`, `plan depth-check`, `gates lint`, `workflow lint`, `check-wave11-callsites.cjs`, `check-callsite-flags.cjs` (via `run-wave13.sh`/`run-wave14.sh`); `wc -l` caps and `git diff --quiet origin/main -- <frozen>`; RED-proof mutations on `git archive` scratch copies; `bash bin/run-suites.sh`.
- **Measurement**: PR A's merge-check runs once with `--no-ci-evidence` (CI evidence would otherwise skip the local run, D20). Load lines and wall-clock ms go into `SC003-MERGE-CHECK.json`, which lands on `main` with the scope-release chore PR, next to `BASELINE.json` (`total_ms 2990052`).

### 4 External evidence of correctness
- The fixture suites through `bash bin/run-suites.sh` and GitHub Actions on GNU/Linux:
  - new: `a1-lib-units` cases `reuse-hash`, `pr-review-record`, `wave-next-check`, `wave-checks`, `feature-plan-steps`, `feature-close`, `help-lean`; `a1-gates-lint` `cases-pr-reinhard.sh`, `cases-bundle.sh`; `a1-workflow-lint` `cases-flow.sh`, `cases-flow-cli.sh`, `cases-parallel.sh`, `cases-verify-bg.sh`; `a1-verify` `cases-bgverify.sh`; `a1-pr-review` `cases-review-record.sh`, `cases-close-block.sh`; `a1-kritis-profile` `parts/09-allowed-delete.sh`;
  - existing and green: every suite that reads a touched file (`a1-pr-review`, `a1-dashboard`, `a1-probe`, `a1-kritis-profile`, `a1-code-scope`, `a1-retro-validate`, `a1-xprov`, `product-schema-v11`, `a1-ux-studio`, `a1-pr-merge-check`, `a1-verify`, `a1-gates-lint` incl. `run-wave13.sh`/`run-wave14.sh`).
- `gates lint` (keep-list invariants included) and `workflow lint` exit 0 on each PR head. CI runs both as their own steps.
- PR A's real merge-check on the long path (`--no-ci-evidence`, the repo's own CLI on `main`). Its measured `duration_ms` and `runner_source` set against `BASELINE.json` are the SC-003 evidence.
- `a1-reinhard-reviewer` per PR; `a1-samuel-security` on PR B (destructive branch deletion) and on PR A when `xprov scope` reports a surface.
- After both merges: the first real feature run's gate log (one `pr-reinhard` record per head sha, a record per keep-list id) and its wave transcript (zero owner stops) via `a1-progress` (SC-004, SC-005, SC-007).

### Rewritten brief
Plan spec 027 slice 4 as **two PRs in sequence**.

**PR A (FR-019..FR-022)** runs in two lanes, then one integration wave.
- **Lane cli-a**:
  - `currentScope()` in the gate-log hook; one `reuse-hash.cjs` used by `checklist run --only 9,10,11`, `lane-split check` and `fix class-sweep --verify`. The key is the gate id plus a hash over inputs (4.5: spec, wave-plan and roadmap), args and the tool's require closure; code-reading gates also need the same head sha and a clean tree.
  - The `--help` blocks of all three PR A commands, in Wave 1, before any fenced call.
  - `pr review-record`/`review-evidence` with the registry invoke, a single-row recorder exception in `gates lint` (R3b stays red), and 02-review.md calling both, with the head sha passed as a substituted placeholder. It records the `review`/`verify` stages after a pass, also on the same-head skip path.
  - `wave next-check` with fail-closed sources: gate log, plan, `observations.jsonl` and GOAL.md `## Decisions` are all required (missing = stop, the owner decision taken literally), because the workflows create the two event stores empty at phase start.
- **Lane flow-a**: workflow text without the early Reinhard, the wave prompts and the PR confirmation; the phase-start store creation; ISO-timestamped Decisions rows. New lint rules are tested at module level. The fenced `wave next-check` calls and the `workflow-lint.cjs` hook wait for the integration wave, because the flow-a tree has no `wave` group and `gates-lint.cjs` imports `workflow-lint.cjs`.
- **Integration wave**: fenced `wave next-check` blocks, the lint hook, ADR note, full suites, Reinhard review, one merge-check on the long path that measures SC-003, and the measurement file in the scope-release chore PR.

**PR B (FR-023..FR-026)** starts from `main` after A is merged and runs strictly sequentially:
- `wave checks`, `feature plan-steps` and the `--help` blocks of all three PR B commands;
- `wave checks` wiring with a `gates lint` bundle alias and deliberate W11 pins;
- parallel-group and background markers with their lint;
- background `verify run` with a file-marker join, Victor's report path and the deliberate VS3 pin change;
- `feature close` (precondition-first, idempotent, argv-only, records every scope, never commits, never deletes unmerged work);
- the 05-merge F block with the DCMGRP pin change, and SKILL.md reading `plan-steps` with the deliberate a1-kritis-profile golden pin change;
- integration with Reinhard plus an explicit Samuel review.

**Constraints**: no `checklist.cjs` edit, at most one facade line per group, no new suite directory, frozen files unchanged, every new test RED-proved, every existing pin change listed by ID with a red run.

# Plan: 027-lean-pipeline-s4

## Goal
Ship delivery slice 4 of spec 027-lean-pipeline ("Less waiting and double work") as two sequential PRs. PR A (FR-019..FR-022) gives pr-reinhard a record writer and one review per head sha, reuses three cheap consistency gates by input hash, lets waves continue on their own unless `wave next-check` names a stop reason, and drops the PR confirmation. PR B (FR-023..FR-026) starts Rico and Marco together, runs `verify run` in the background during Verify, bundles the per-wave checks in `wave checks`, adds the size-S step list and the idempotent `feature close`. Every keep-list gate stays load-bearing.

## PR boundary (read first)
| | PR A | PR B |
|---|---|---|
| FRs | FR-019, FR-020, FR-021, FR-022 | FR-023, FR-024, FR-025, FR-026 |
| Waves | 1-4 (lanes cli-a, flow-a), 5 (integration, review, merge) | 6-10 (sequential) |
| Starts from | `main` @ the commit of the pre-step chore PR (P0) | `main` after PR A is merged (`gh pr view <A> --json state` = `MERGED`) and the A scope is released |
| Worktree | `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s4a/` (+ lane worktrees from a1-execute) | `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s4b/` |
| Review | Reinhard (always); Samuel only when 2.2b `xprov scope` reports `security_surface: true` | Reinhard and Samuel (Samuel spawned explicitly: `feature close` deletes local branches and exits worktrees) |
| Merge-check | once, `--no-ci-evidence`, long path, SC-003 measurement (D20) | once, default (CI evidence when green) |

Gate-log scope (`--phase`) for every gate call in this phase: `027-lean-pipeline-s4`.

**code_scope paths (claim `--by 027-lean-pipeline`, one claim per PR):**
- PR A claim (P0, released by a chore PR after the A merge, precedent #106):
  `_shared/a1-tools.cjs`, `_shared/lib/gate-log.cjs`, `_shared/lib/reuse-hash.cjs`, `_shared/lib/lane-split.cjs`, `_shared/lib/fix-class-sweep.cjs`, `_shared/lib/gates-lint.cjs`, `_shared/gates-registry.md`, `_shared/lib/pr-review-record.cjs`, `_shared/lib/wave.cjs`, `_shared/lib/wave-next-check.cjs`, `_shared/lib/workflow-lint.cjs`, `_shared/lib/workflow-lint-flow.cjs`, `_shared/lib/help.cjs`, `_shared/lib/help-lean.cjs`, `docs/adr/2026-10-14-gate-invoke-and-log.md`, `skills/a1-pr-review/workflows/02-review.md`, `skills/a1-pr-review/workflows/03-draft.md`, `skills/a1-pr-review/workflows/04-submit.md`, `skills/a1-new-feature/workflows/06-verify.md`, `skills/a1-new-feature/workflows/05-implement.md`, `skills/a1-execute/workflows/02-execute.md`, `skills/a1-execute/SKILL.md`, `_test-fixtures/a1-lib-units/cases/**`, `_test-fixtures/a1-gates-lint/**`, `_test-fixtures/a1-workflow-lint/**`, `_test-fixtures/a1-pr-review/**`
- PR B claim (Task 6.0):
  `_shared/a1-tools.cjs`, `_shared/lib/wave.cjs`, `_shared/lib/wave-checks.cjs`, `_shared/lib/feature.cjs`, `_shared/lib/feature-plan-steps.cjs`, `_shared/lib/feature-close.cjs`, `_shared/lib/gates-lint.cjs`, `_shared/lib/workflow-lint.cjs`, `_shared/lib/workflow-lint-parallel.cjs`, `_shared/lib/help-lean.cjs`, `docs/adr/2026-10-14-gate-invoke-and-log.md`, `skills/a1-plan/SKILL.md`, `skills/a1-plan/workflows/01-research.md`, `skills/a1-plan/workflows/02-map.md`, `skills/a1-plan/workflows/04-audit.md`, `skills/a1-execute/workflows/02-execute.md`, `skills/a1-execute/workflows/03-verify.md`, `skills/a1-new-feature/workflows/05-implement.md`, `skills/a1-new-feature/workflows/06-verify.md`, `skills/a1-new-feature/SKILL.md`, `skills/a1-new-feature/workflows/01-discover.md`, `skills/a1-new-feature/workflows/02-specify.md`, `skills/a1-new-feature/workflows/03-clarify.md`, `skills/a1-new-feature/workflows/04-plan.md`, `skills/a1-pr-review/workflows/05-merge.md`, `agents/a1-victor-verifier.md`, `_test-fixtures/a1-lib-units/cases/**`, `_test-fixtures/a1-gates-lint/**`, `_test-fixtures/a1-workflow-lint/**`, `_test-fixtures/a1-pr-review/**`, `_test-fixtures/a1-verify/run-tests.sh`, `_test-fixtures/a1-verify/cases-bgverify.sh`, `_test-fixtures/a1-kritis-profile/golden/apply-prompts-allowed.cjs`, `_test-fixtures/a1-kritis-profile/golden/prompts.allowed-diff`, `_test-fixtures/a1-kritis-profile/parts/01-golden.sh`, `_test-fixtures/a1-kritis-profile/parts/08-wiring.sh`, `_test-fixtures/a1-kritis-profile/parts/09-allowed-delete.sh`

## Execution location (read first)
- **Pre-step P0 (orchestrator, before Wave 1, not a wave).**
  - Commit this phase folder plus the PR A scope claim on a chore branch and open a chore PR (precedent #104: the worktree preflight refuses a dirty primary checkout).
  - Merge it after Reinhard reads it. Only then let a1-execute prepare the PR A worktree.
- All PR A work runs in `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s4a/`, created through `a1-specforge:a1-worktree` (never a raw `git worktree add`). Lanes cli-a and flow-a get their own worktrees and branches from a1-execute (`feature/027-lean-pipeline-s4-cli-a`, `...-flow-a`). Both are merged into the PR A branch before Wave 5.
- All PR B work runs in `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s4b/`, prepared from `main` only after PR A is merged (Task 6.0).
- The primary checkout `/home/rob/claude-projects/a1-specforge` stays on `main`. Nothing in a wave writes there. The orchestrator steps that write shared state there (P0, Task 5.2 step 6, Task 6.0, Task 10.2 step 6) each commit on a chore branch and merge a chore PR (`_shared/push-cadence.md` P3, protected `main`).
- Every command and Done-when probe runs with cwd = the worktree root and repo-relative paths. Every gate call passes `--phase 027-lean-pipeline-s4`, except `gates lint`, which takes no `--phase` (slice 3 lesson).
- Shell state does not carry across waves, agents or Bash calls. Every wave defines its own variables.
- **Per-wave gate.** Run `node /home/rob/claude-projects/a1-specforge/_shared/a1-tools.cjs verify run --affected --project "$WORK_PATH" --phase 027-lean-pipeline-s4`, i.e. the primary checkout's CLI on `main`: it has the slice 3 lock; the installed plugin 1.17.0 does not.
- **Per-wave reds.** Since PR #103 aiserver has no env-red suite, so any red id is suspect:
  1. Re-run that suite alone once on a quiet host.
  2. Still red: run it on `main` in an a1-worktree `027-s4-main-compare` (`prepare --base main`, `enter`, run, `exit --mode discard`).
  3. The same failing case names on `main` mean the red is not this slice's: record them in `STATUS-<lane>.md` (`STATUS.md` for sequential waves) and continue. Anything else is a STOP.
- **Touched-file pin rule.** Before editing any skill or agent file F, run `grep -rln "$(basename F)" _test-fixtures | grep -v corpus/` and read every assert that names F. After the edit, run each listed suite. **Every** skill or agent file with a fenced `a1-tools.cjs` call is also read by the call-site sweep `check-callsite-flags.cjs` (W13c in `run-wave13.sh`, W14e in `run-wave14.sh`): a task that adds or changes a fenced call runs both runners. Known readers, measured 2026-11-20 on `54836f2`:

  | File | Suites and pins that read it |
  |---|---|
  | `skills/a1-new-feature/SKILL.md` | **a1-kritis-profile** P (`01-golden.sh` 190-249, byte compare with `golden/prompts/SKILL.md` + `prompts.allowed-diff`), P-allowed (251-286, literal simulated file), D (`08-wiring.sh` 148-161: exactly 0 removed, 6 added lines); a1-ux-studio `07-integration.sh` (`  - Skill`); a1-pr-review :338 (exclusion only). Any edit turns P and D red (measured): edited only in Task 9.1, with the listed pin change. |
  | `skills/a1-new-feature/workflows/02-specify.md`, `skills/a1-new-feature/workflows/03-clarify.md` | **a1-kritis-profile** B (2 blocks each), W (exact counts over the whole `skills/a1-new-feature/` scope: new text names no `a1-tools.cjs profile` command and no `subagent_type: "a1-samuel-security"`), C (`Blank slate for this run`), N (`not_implemented`), P (`01-golden.sh` caseP: golden + `prompts.allowed-diff`), P-mut 02-specify (296-306), D (`08-wiring.sh` 136-183: 02-specify falls into the generic branch, 0 removed / 0 added; 03-clarify branch 164-176, exactly 0 removed, 37 added, the added non-blank lines equal to the `03-clarify.md` `line` rows of `prompts.allowed-diff` in row order); a1-ux-studio I1-I5 (03-clarify 2b-2a and 2b-4). Measured 2026-11-20: one line inserted in each file gives `217 passed, 4 failed` (P and D of both); with the four listed pin changes applied, `221 passed, 0 failed`. Edited only in Task 9.1. |
  | `skills/a1-new-feature/workflows/01-discover.md` | a1-quick `run-tests.sh` 639-670 (`## Step 2b — XS eligibility check` before `## Step 3 — Spawn Rene with the Discovery brief`; `quick eligibility` named) |
  | `skills/a1-new-feature/workflows/04-plan.md` | none outside the gates-lint corpus (measured); W13c/W14e (its fenced calls stay unchanged) |
  | `skills/a1-plan/workflows/04-audit.md` | a1-dashboard 05.24-05.27, 05.45/05.46 (exactly one `--slug <slug>` paragraph naming `dashboard build`); a1-xprov 06-gate; a1-retro-validate L12 (one `retro validate` block); a1-workflow-lint W-vault-sync |
  | `skills/a1-plan/workflows/01-research.md`, `02-map.md` | none (measured) |
  | `skills/a1-execute/workflows/03-verify.md` | a1-workflow-lint VS1/VS3 (`cases-verify-scope.sh`), QH7 (`lock_timeout` present), W6/W13 (`run-tests.sh`); a1-retro-validate V8 + L12; a1-xprov P13 (`xprov_not_applicable`); a1-dashboard 05.24/05.28/05.45/05.46; a1-gates-lint W11 FILES, W13f (`VERIFICATION.md; CHECK_RC=$?` byte-exact), W13c/W14e |
  | `skills/a1-new-feature/workflows/06-verify.md` | a1-probe 06-wiring D1/D1b; a1-pr-review :234 (no `xprov gate`/`pr-diff-xprov`); a1-retro-validate V8 + L12; a1-workflow-lint VS1/VS3, QH7; a1-gates-lint W11d + W11 FILES, W13c/W14e |
  | `skills/a1-new-feature/workflows/05-implement.md` | a1-gates-lint W11b + W11 FILES, W13g (`checklist run <project-slug>/<###>-<feature-slug> --only 9,10,11 --format json` byte-exact), W13c/W14e; a1-workflow-lint VS2, QH7 (fenced `if [ $RC -eq 2 ]` + `lock_timeout` + `not red` line); a1-pr-review :234; a1-pr-merge-check MH9 (`all_commands_skipped_on_host`, `takes its id out of the verdict`) |
  | `skills/a1-execute/workflows/02-execute.md` | a1-xprov 06-gate, 19-review-quality, 36-design-targets; product-schema-v11; a1-dashboard 05.24/05.45/05.46; a1-gates-lint W11a/c/e + FILES, W13c/W14e; a1-workflow-lint VS2, QH7, `run-tests.sh`; a1-pr-merge-check MH9 |
  | `skills/a1-pr-review/workflows/05-merge.md` | a1-pr-review DCMGRP/`b[3]`/RR_POS/RR-guard; a1-pr-merge-check MH9/MH9a; a1-probe; a1-verify `cases-envred.sh`; a1-workflow-lint VS5/QH; a1-gates-lint W13d, W13c/W14e |
  | `skills/a1-pr-review/workflows/02-review.md` | a1-pr-review :166-176 (no token `merge-check`; `### 2.2 ` section holds no `if/when/only` line and no `security_surface`/`xprov`); a1-gates-lint W13c/W14e |
  | `skills/a1-pr-review/workflows/03-draft.md` | a1-pr-review (Samuel-section pin :197) |
  | `skills/a1-pr-review/workflows/04-submit.md` | none outside the gates-lint corpus (measured) |
  | `agents/a1-victor-verifier.md` | a1-probe 06-wiring; a1-gates-lint W11 FILES, W13c/W14e; a1-workflow-lint VS3/VS4 |
- **Fixture isolation, mandatory in every new test.**
  - a1-lib-units case files run with `HOME`, `TMPDIR` and cwd under a temp root; `A1_VAULT_ROOT` is unset by the runner. A case that needs a vault sets `A1_VAULT_ROOT` explicitly to its own temp dir, only in the child env it spawns.
  - A case that starts `verify run` exports `A1_VERIFY_LOCK_DIR="<own temp>/vl/lock"` (parent created first) and `A1_VERIFY_LOCK_WAIT_MS=20000`. It **never unsets the inherited `A1_VERIFY_LOCK_TOKEN`** (slice 3 lesson). Every lock wait in a test is bounded.
  - Any background timer in a bash case kills its own `sleep` child when it ends (`trap 'kill $SP 2>/dev/null' EXIT` around `sleep N & SP=$!; wait $SP`). Only own PIDs (`$!`) are ever killed, never a `pkill` pattern.
  - Every planted git repo uses a per-repo identity (`-c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`).
- **Exit discipline.** Every new module writes its stdout/stderr and leaves through `emitExit` (never `process.stdout.write` followed by `process.exit`). Every task that creates a module runs `bash _test-fixtures/a1-cli-output/run-tests.sh` (`exit-after-write-guard.cjs`).
- **Status boxes.** Each task carries one `- [ ] T<x.y> ...` status line with backticked artifact names. The executor sets it to `- [x]` when the task's Done-when holds, so `phantom check` has input (slice 3 lesson).

## RED-proof rule (applies to every task)
Each task lists RED-proof mutations. Apply each one once on a scratch copy after the task's own commit:
```bash
S=$(mktemp -d); git archive HEAD | tar -x -C "$S"
git -C "$S" init -q && git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm snap
```
Then:
1. Apply the one mutation with Edit and run the named suite or case file there.
2. Watch the named case go red.
3. Log one line in the lane or wave STATUS file: `RED-proof <task> <mutation> -> <case> red (rc=<n>)`.

A mutation that does not turn its case red is a fixture defect: fix the fixture, never drop the line. A case that would hang runs under a background kill after its stated bound and counts as red when killed.

**Existing-assert rule.** No existing assert line in any suite is deleted or edited, except the pins listed here by ID. Each listed pin change carries a red run: the old pin fails on the new tree, and the new pin fails on a mutation.

| Pin | Where | Changed in | Change |
|---|---|---|---|
| R3b | `a1-gates-lint/run-tests.sh` 139-142 | none | stays byte-unchanged (red) |
| W11a, W11b, W11c, W11e | `a1-gates-lint/run-tests.sh` 455-490 + `check-wave11-callsites.cjs` FILES/FLAGS/CMD_RE | Task 7.1, Task 8.1 | count and mutations for `wave checks` and the background `verify run` |
| VS3 (03-verify.md and 06-verify.md rows) | `a1-workflow-lint/cases-verify-scope.sh` 51-55 | Task 8.1 | sed address `/a1-tools.cjs verify run/` → `/a1-tools.cjs verify run.*--out/` (the foreground line); the Victor row stays |
| DCMGRP count and order | `a1-pr-review/run-tests.sh` 264-266 | Task 9.2 | `6`→`7`, `DCMGRP`→`DCMGRFP` |
| kritis P-allowed (SKILL.md simulation) | `a1-kritis-profile/parts/01-golden.sh` 251-286 | Task 9.1 | the simulated file gains the new insertions and the S-table deletion |
| kritis D (SKILL.md branch) | `a1-kritis-profile/parts/08-wiring.sh` 148-161 | Task 9.1 | removed/added counts and `want_d` lines for the new SKILL.md text |
| kritis apply op set | `a1-kritis-profile/golden/apply-prompts-allowed.cjs` | Task 9.1 | new op `delete-after` + `gone` rows (harness extension, the existing ops unchanged) |
| kritis P (02-specify.md, 03-clarify.md) | `a1-kritis-profile/golden/prompts.allowed-diff`, read by `01-golden.sh` caseP | Task 9.1 | one `insert-after` + `line` pair per file; the 03-clarify pair goes directly before the existing `03-clarify.md` rows (D compares the rows in row order against the diff in file order, and the new line sits above both existing insertions) |
| kritis D (03-clarify branch) | `a1-kritis-profile/parts/08-wiring.sh` 164-176 | Task 9.1 | `"$gt" == "37"` → `"38"`; the ok/bad texts name the spec 027 line |
| kritis D (02-specify branch) | `a1-kritis-profile/parts/08-wiring.sh` 136-183 (today the generic `else`: 0 removed, 0 added) | Task 9.1 | a new `elif` for `skills/a1-new-feature/workflows/02-specify.md` directly before the 03-clarify branch: 0 removed, added = the number of `02-specify.md` `line` rows of `prompts.allowed-diff`, the added lines equal to those rows in order; the generic `else` stays for the other files |
| P-mut 02-specify | `a1-kritis-profile/parts/01-golden.sh` 296-306 | none | byte-unchanged. After the 02-specify insertion it still passes, but no longer because of its mutation (the stripped file already differs from the raw golden); new case K4 carries that guard with the allowance applied |

New cases go into new files:
- a1-lib-units `cases/*.cjs` and a1-kritis-profile `parts/*.sh` need no runner edit;
- every other new `cases-*.sh` adds exactly one `. "$(dirname "${BASH_SOURCE[0]}")/cases-<name>.sh"` source line after the last existing source line (a1-pr-review: right before the final `echo ""` summary line), plus its case calls in the call list, where the suite has one (a1-workflow-lint).

## Lane decision
- **PR A: two lanes.** Write sets come from the task actions below. `lane-split check` (with and without `--imports .`) must exit 0.
  - **cli-a** (Waves 1-2): every new CLI module of PR A, the facade, the help text of all three PR A commands, the registry row, the gates-lint recorder exception, 02-review.md and the a1-pr-review cases on it. They belong together because `gates lint` on the real tree goes red unless the registry invoke and the 02-review.md call land together, and the call-site sweep goes red unless the help block lands no later than the fenced call.
  - **flow-a** (Waves 3-4): the Markdown of FR-019 (06-verify), FR-021 (02-execute, 05-implement, a1-execute SKILL.md: prose, stop blocks, phase-start stores) and FR-022 (03-draft, 04-submit). Also the lint module `workflow-lint-flow.cjs`, tested at module level.
  - **No fenced call to a cli-a command in flow-a.** The flow-a lane tree has no `wave` group and no `pr review-*` help, and `.a1/verify.json` `affected` maps `skills/a1-execute/` and `skills/a1-new-feature/` to the whole `_test-fixtures/a1-gates-lint/` directory, so the per-wave gate runs the sweep. Measured: a planted fenced `wave next-check` line on `54836f2` gives `command does not exist in the real CLI`. So flow-a names `wave next-check` and the 2.3d stage step in prose only; the fenced `wave next-check` blocks land in Task 5.1, after the lane merge (option (a) of audit B1).
  - **Import edge handled.** `gates-lint.cjs` (cli-a) does `require('./workflow-lint.cjs')` (line 31). So `workflow-lint.cjs` is owned by no lane, and its one-line hook for the new module lands in Wave 5. flow-a's tests call the module directly. Measured: `lane-split.cjs` 256-300 attributes only owned files.
- **PR B: sequential** (Waves 6-10 in `sequential_after_lanes`). B starts from `main` only after A merged, so no B wave may start while A's lanes run. The lane model has no "start after merge" slot, which is the blocking dependency chain.
- **Yield, stated honestly.** Waves 1-4 (about 40% of the code) run as two chains of 2 waves, so they finish in about the time of 2 waves. Task 5.1 now also carries the two fenced `wave next-check` blocks (a few lines). Waves 5-10 stay serial, and B is serial by construction. Every wave also pays the per-wave gate (`verify run --affected`, full set whenever a runner-adjacent path changes).

## Decisions (made in this plan, each tested)
- **D1 Two PRs, one release.** A then B as in the PR boundary table. No plugin release between them. After B merges, the orchestrator proposes the 1.18.0 release as a separate chore (not part of this phase).
  - Self-hosting: the installed plugin (1.17.0) carries none of this slice's workflow text. Where a task says a new step "runs for real", the orchestrator follows the named workflow file of the tree that carries the new CLI explicitly: for PR A the PR A worktree's `skills/a1-pr-review/workflows/02-review.md` with `<repo>` = the PR A worktree; for PR B the primary checkout's copy (on `main`, with A) with `<repo>` = `/home/rob/claude-projects/a1-specforge`.
- **D2 Scope of the `pr-reinhard` record.** FR-019 writes `--phase <spec-id>`. This plan reads `<spec-id>` as the scope placeholder and uses `--phase pr-<n>` in 02-review.md. Reasons:
  1. a1-pr-review on its own has no spec id (05-merge.md: `PHASE` may be `none`);
  2. `run record --scope pr-<n>` (05-merge.md item 2) persists that log, so SC-005 and SC-007 count it;
  3. it is the same log as `pr-security-surface` (02-review.md 2.2b).

  The CLI accepts any safe scope. The PR text names this as an FR-019 reading for the owner's reconcile; this phase does not edit the spec.
- **D3 Recorder exception in `gates lint`.** In `gates-lint.cjs` add `const PROMPT_RECORDERS = Object.freeze({ 'pr-reinhard': 'pr review-record' });`. `gradeRow` emits `prompt_names_command` unless `PROMPT_RECORDERS[row.id] === row.subcommand`. Every other prompt or human row with a command stays a finding, so R3b (`gate-c-ac-dryrun` + `check reservations`) stays red, byte-unchanged. The class stays `prompt` (quality-invariants `kind: prompt` unchanged).
- **D4 `pr review-record` / `pr review-evidence` contract** (`_shared/lib/pr-review-record.cjs`, `cmdPrReview(sub, rest)`):
  - **`review-record --head <sha> --verdict <pass|fail> --phase <scope>`.**
    - `--phase` is stripped by the hook (registry invoke); the module reads the scope from `gateLog.currentScope()`. A null scope exits 2 `phase_required`, so no record ever lands in `_unscoped`. (The hook still writes the exit-2 record into `_unscoped` with verdict `error`; the module prints the reason. Documented in help.)
    - `--head` must match `/^[0-9a-f]{40}$/` and equal `git rev-parse HEAD` of the cwd repo, else exit 2 `head_mismatch`.
    - The verdict is not `pass`/`fail`: exit 2. Otherwise stdout carries `{"ok":<bool>,"gate":"pr-reinhard","head_sha":...,"verdict":...,"scope":...}`, with exit 0 for `pass` and 1 for `fail`. The hook writes exactly one line with that verdict and `head_sha`.
  - **`review-evidence --head <sha> --phase <scope>`** (not an invoke, writes nothing). It parses `--phase` itself (`validateScope`) and reads `<git toplevel of cwd>/.a1/phases/<scope>/gate-log.jsonl`.
    - Missing log, or a log whose chain does not verify: exit 1 (`no_log` / `untrusted_log`).
    - Exit 0 only when the LAST record with `gate === 'pr-reinhard' && head_sha === <sha>` has verdict `pass`. Otherwise exit 1 `no_pass_for_head`. Usage errors exit 2.
  - Both accept only the flags named; anything else exits 2.
  - **Head sha across Bash calls.** 2.1b computes the sha and prints `head_sha=<40 hex>`. 2.3a carries the literal placeholder `<head_sha>`, which the orchestrator substitutes with the printed value (the existing `<BASE_SHA>` pattern of 2.2b). `review-record` still compares it with HEAD, so a moved head exits 2 and a pass is never recorded for a head Reinhard did not see.
- **D5 Lifecycle stages after FR-019.** The early Reinhard in 06-verify.md Step 0 goes away, so the `review` stage can no longer be set before Phase 6's `verify`, and `code-scope stage` is forward-only.
  - 02-review.md gets step **2.3d**: it runs after a 2.3a `pr review-record --verdict pass` that exits 0, **and** after a 2.1b `review-evidence` exit 0 (the same-head restart path, where 2.2/2.3a are skipped). Only when the caller handed over a `caller_spec_id` that holds a `code_scope` reservation, it advances `review` and then `verify`. Each target is skipped when the current stage is at or past it, so a fix round or a restart never tries a backward move.
  - 06-verify.md §5 items 1-2 become pointers to 2.3d. Phase 6 sets no stage before the hand-off; the walkthrough is all-green before the hand-off, so both conditions hold at 2.3d.
  - Without a reservation (a1-execute phase, a1-fix, a standalone review) 2.3d prints SKIP.
  - `code-scope stage` changes the tracked `.a1/reservations.json` in the primary checkout. 2.3d therefore commits it there at once when it ran a stage call (`_shared/push-cadence.md` P3: "committed immediately, so the tree is never dirty"; the push is batched with this session step). `feature close`'s `reservations_commit_pending` covers only its own later changes (audit round 2 m4).
  - `caller_spec_id` is declared in the 02-review.md Inputs list (lines 7-12) and handed over by a1-new-feature 06-verify.md (Task 3.1); PR B's 05-merge.md F block reads the same input (D17).
  - `skills/a1-new-feature/SKILL.md`'s Lifecycle table is not edited in PR A: its Review row ("code review (Reinhard or equivalent) confirmed") stays true, and any SKILL.md edit is a kritis golden pin change (Task 9.1 only).
- **D6 Input-hash reuse (FR-020)** in `_shared/lib/reuse-hash.cjs`.
  - **Key:** `input_hash = sha256(JSON.stringify({v:1, gate, tool:[[file, sha256]...], args:{...}, files:[[label, sha256(content)]...]}))`, with `tool` and `files` sorted by name.
  - **Tool closure per gate** (const `TOOLS` names the entry modules: `gate-4.5-fr-consistency` → `checklist.cjs`, `check.cjs`; `lane-split` → `lane-split.cjs`; `fix-class-sweep` → `fix-class-sweep.cjs`). The digest list is the entry modules plus their local requires two levels deep (`require('./x.cjs')` and `require(path.join(__dirname, 'x.cjs'))`, the regex of `check-callsite-flags.cjs` `localRequires`), deduplicated and sorted. So `segment-glob.cjs`, `io.cjs`, `spec-coherence.cjs` and the like count (audit m5). The help names the limit: requires deeper than two levels or computed paths are not in the key.
  - **Scope and log:** scope = `gateLog.currentScope()` (null: no reuse, the gate runs). Log root = `gateLog.gitContext(gateLog.projectDirOf(process.argv.slice(2))).root`, i.e. exactly the hook's own root. Log = `<root>/.a1/phases/<scope>/gate-log.jsonl`.
  - **Hit:** the log exists, `verifyChain(file).ok`, and the last record with `gate === <id> && input_hash === <hash>` has `verdict === 'pass'`. For `requireHead` gates, that record's `head_sha` must also equal HEAD and `git status --porcelain --untracked-files=no` in the project dir must be empty. Any read error is a miss.
  - **On a hit:** `setRecordExtra({input_hash, reused: true})`, stderr `reused: <gate> @ <hash>`, stdout one JSON line `{"ok":true,"reused":true,"gate":<id>,"input_hash":<hash>}`; lane-split adds `"imports_checked":<bool from args>`. Exit 0 without running the gate (via `emitExit`).
  - **On a miss:** the gate runs unchanged, and the hash goes in through `setRecordExtra({input_hash})`.
  - **Per gate:**
    - **gate-4.5** (`checklistRunWithReuse(rest, runner)` replaces the facade's direct `cmdChecklistRun(rest)` call, net 0 lines).
      - Reuse is considered only when `--only` parses to exactly the set {9,10,11}, `--format` is absent or `json`, `--save` and `--vault` are absent, and the target is `<slug>/<feature>` with `projectsPath(slug,'spec',feature+'.md')` existing as written.
      - Inputs: that spec file, `projectsPath(slug,'plans',feature+'-wave-plan.md')` (missing → no reuse), and the roadmap that check 11 reads: `require('./spec-coherence.cjs').findProjectRoadmap(slug, {vaultRoot, quiet: true})`; found → its file (label `roadmap`), none → the literal label `roadmap:none` in `args` (audit m6, stricter than FR-020's wording, never looser).
      - Owner amendment 2026-11-20: spec + wave-plan. `product validate --spec-status` at merge keeps covering check 11 as well (FR-020).
      - Per checkout: gate logs are gitignored per checkout (`.gitignore:8`), so a reuse hits only when both calls ran in the same checkout. The 04.5 workflow and the 05-implement precondition both run in the primary checkout (before the worktree exists), so the US-027-5 second scenario holds there. The help and the PR text say so (audit m7).
      - `checklist.cjs` is not edited (823 lines); the module does not require it, the runner comes in as a parameter.
    - **lane-split** (top of `cmdLaneSplitCheck`, after the plan exists).
      - Input: the `--plan` file.
      - Args: `{imports: realpath(--imports) or null}`. With `--imports` the gate reads code, so `requireHead` (with the imports root as project dir).
      - FR-020 names "spec file + PLAN.md", but lane-split reads no spec file, and the PLAN `spec:` field is free prose (027-s3 PLAN.md line 4). The PR text names this narrowing for the owner's reconcile.
    - **fix-class-sweep** (`--verify` only; `--record` never reuses).
      - Input: the bug file (it holds the sweep record fields).
      - Args: `{project: realpath, guards: sorted --guard values, diff_base: rev-parse of --diff-base or null}`. Always `requireHead`, because `--verify` reads the code tree; this is stricter than FR-020's wording, never looser.
      - Because `doVerify` rewrites the bug file (`fix-class-sweep.cjs:261`), the miss path computes the hash AFTER the run, from the file as written, and hands it to the setter in both the success and the refusal branch. The pre-run hash of the next identical call then equals it.
  - `currentScope()` (gate-log.cjs): a module-level `hookScope` set in `installGateLog` beside `hookInstalled` (`stripped.scope`, null without `--phase`). `currentScope()` returns `hookInstalled ? hookScope : null`. It is request-scoped by construction: one CLI process is one request, same pattern as `pendingExtra`.
  - Not in scope: `run-record.cjs` keeps counting reused records as runs; their durations are ~ms. The PR text names it as a follow-up.
- **D7 `wave next-check` contract** (`_shared/lib/wave-next-check.cjs`; group dispatcher `_shared/lib/wave.cjs`).
  - **Usage:** `wave next-check <slug> <wave> --since <ISO-8601 UTC> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]`.
    - `<slug>` passes `validateScope`. `<wave>` is an integer ≥ 0 (0 = before Wave 1, used by a1-new-feature). `--since` (required) is the wave start the orchestrator noted at dispatch.
    - `--project` defaults to cwd (git toplevel). `--plan` defaults to `<root>/.a1/phases/<slug>/PLAN.md`.
  - **Output:** stdout exactly `continue` (exit 0) or `stop:<reason>` (exit 1); stderr one line `wave next-check: <reason>: <detail>`. Exit 2 for usage.
  - **Time comparisons** use `Date.parse` on both sides (gate-log `ts` carries milliseconds, `--since` does not; a string compare would put a same-second record before `since`).
  - **Owner decision "missing source = stop" (adopted 2026-11-20), applied literally.** Every source is required: the gate log, the plan, `observations.jsonl` and GOAL.md with a `## Decisions` heading. The workflows create `observations.jsonl` (empty) and GOAL.md (`# Goal: <phase goal>` + `## Decisions`) at phase start and commit both (02-execute "Phase start", 05-implement Step 1b, Task 3.3, D21), so a missing store after that means the run broke, and the command stops.
  - **Checks in this order; the first stop wins:**
    1. `--checkpoint-each-wave` → `stop:owner_requested`.
    2. **Wave 0** (before Wave 1, a1-new-feature): only check 6 runs (the agent of Wave 1); then `continue`. No wave has run, so there is no wave gate log, no deviation and no decision yet. The preconditions (Gate 4.5, scope claim) run in the primary checkout before the worktree exists, their gate log is not visible from the worktree (gitignored per checkout), and each stops on its own exit code in 05-implement ("Do NOT start Wave 1 if the gate returns FAIL"; claim exit 1). Audit M2, second option.
    3. `gate_red`. The log `<root>/.a1/phases/<slug>/gate-log.jsonl` is missing, unreadable or fails `verifyChain`, or no record has `Date.parse(ts) >= Date.parse(since)` (the wave's gates did not log), or among records since then the last verdict of any gate is `fail` or `error`.
    4. `deviation`. `<root>/.a1/phases/<slug>/observations.jsonl` missing or unreadable → stop (`source_missing`). A line that is not JSON → stop. A line with `type` in {deviation, blocker} and (`wave` == `<wave>` or no `wave` field) → stop. `gap`/`plan_quality` lines do not stop (measured types).
    5. `scope_change`. `<root>/.a1/phases/<slug>/GOAL.md` missing or unreadable → stop (`source_missing`); no `## Decisions` heading → stop (`no_decisions_section`). Each row `- <token> — ...` under `## Decisions`:
       - token is an ISO-8601 UTC timestamp (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/`): stop when `Date.parse(token) >= Date.parse(since)`;
       - token is a bare date `YYYY-MM-DD` (legacy rows): stop when the date ≥ the UTC date of `--since`. This is fail-closed and repeats for every wave of that day; the stop-block text says so and tells the owner to rewrite the row with an ISO timestamp to clear it (audit M3);
       - any other first token → stop.
       New rows are written with an ISO timestamp (02-execute 2c, 05-implement Step 4; Task 3.3).
    6. `agent_unnamed`. The plan is missing or unreadable → stop. If there is no `## Wave <wave+1>` heading → `continue`: nothing follows, the caller goes to Verify.
       - Frontmatter has a `lanes:` key with value `none...`: the next wave runs on a1-erik-executor → named.
       - A lane block (`parseLanes(frontmatterOf(text))`): the lane whose `waves` holds wave+1 must have a non-empty `agent`; wave+1 in `sequential_after_lanes` → named (Erik).
       - No `lanes:` key and no `--plan` (the default `<root>/.a1/phases/<slug>/PLAN.md`, an a1-execute plan that predates the field; measured: 8 of the 12 `PLAN.md` files in this repo have no `lanes:` key): treated like `lanes: none`, so the next wave runs on a1-erik-executor → named (audit round 2 m5).
       - No `lanes:` key and `--plan` given (the a1-new-feature wave-plan): the `## Wave <wave+1>` section must hold a `### Suggested agent(s)` heading followed by at least one `- **<name>**` line. The help names both rules.
    7. Otherwise `continue`.
  - **Lane mode** (audit m17): the agent check reads the global `wave+1`. In 02-execute a lane's last wave hands over to the lane merge, not to Wave N+1; its `wave next-check` result counts only for checks 3-5 there (prose, Task 3.3).
  - `lane-split.cjs` adds `frontmatterOf` to its exports (1 line, lane cli-a).
- **D8 Stop blocks (FR-021 lint).** A prompt is allowed only between `<!-- a1:stop -->` and `<!-- /a1:stop -->` lines.
  - Rule `wave-checkpoint` (files `skills/a1-execute/workflows/02-execute.md`, `skills/a1-new-feature/workflows/05-implement.md`) flags, outside a stop block, any line containing: `Continue? [y`, `Wait for user input before starting next wave`, `Should I dispatch the agent like this`, `Wait for user confirmation`, `Do **not** dispatch automatically`, `Continue to next wave or stop`, `Once the user confirms` (05-implement.md:96, audit m11).
  - An unclosed stop block is a finding.
- **D9 PR-confirmation markers (FR-022 lint).** Rule `pr-confirmation` (files `skills/a1-pr-review/workflows/03-draft.md`, `04-submit.md`) flags any line containing: `Should I create the PR`, `yes / no / adjust draft`, `Are you sure`, `User must have confirmed`, `User aborts at confirm`.
  - The force-push asks (`ask the user before retrying with --force-with-lease`, `Ask user.`) are not markers and stay. The BLOCKER question in 02-review.md 2.6 stays (a review stop condition, FR-022).
- **D10 Early-review rule (FR-019 lint).** Rule `verify-early-review` flags the token `a1-reinhard-reviewer` anywhere in `skills/a1-new-feature/workflows/06-verify.md` (today: 1 hit, line 19). The output JSON gains `flow_checked` (number of files the three D8-D10 rules read: 5 on a skills tree, 0 otherwise).
- **D11 `wave checks` contract** (`_shared/lib/wave-checks.cjs`, PR B).
  - **Usage:** `wave checks <slug> <wave> --diff-base <ref> [--project <dir>] [--migrations <dir>] [--phase <slug>]`. `--phase`, when given, must equal `<slug>` (exit 2 otherwise); the workflows pass it so `gates lint` sees `--phase`.
  - **Children:** exported `CHILD_GATES = Object.freeze(['realpath-check run', 'schema-check run', 'test-fidelity'])` drives the order: `realpath-check run --diff-base <ref> --project <dir> --phase <slug>`, then `schema-check run --migrations <dir> --phase <slug>` (only with `--migrations`; else reported as `{gate:"gate-0.6-schema", skipped:"no_migrations"}`), then `test-fidelity --diff-base <ref> --project <dir> --phase <slug>`.
    - Each is a child `spawnSync(process.execPath, [facade, ...], {cwd: <project dir>})` with a 10-minute timeout, so each writes its own gate-log line into the project's log, also for `schema-check run`, which takes no `--project` (audit m13).
    - It runs all three regardless of earlier failures and prints one JSON object `{ok, slug, wave, checks:[{gate, argv, exit, stdout_tail, skipped?}]}`.
  - **Exit:** 2 if any child exited 2 or timed out, else 1 if any exited non-zero, else 0.
- **D12 Bundle alias in `gates lint`** (PR B). `const BUNDLES = Object.freeze({ 'wave checks': ['realpath-check run', 'schema-check run', 'test-fidelity'] });`.
  - `findCalls(files, sub)` also returns call lines of every bundle whose list contains `sub`. So W11f's wired list stays 6, and `call_without_phase` applies to the bundle line.
  - The list is a second copy of `CHILD_GATES`; case BU4 asserts both are equal (audit m15). `gates-lint.cjs` does not require `wave-checks.cjs` (no new import edge).
  - `check-wave11-callsites.cjs` learns `wave checks` (FLAGS `['diff-base','project','migrations','phase']`).
  - The ADR gets a dated note (Task 10.1).
- **D13 Background `verify run` (FR-024).**
  - **Start** (03-verify.md and 06-verify.md, before the Victor spawn):
    - Directory `VBG="$(git -C <project dir> rev-parse --path-format=absolute --git-common-dir)/a1-verify-bg/<phase>"` (absolute in a main checkout too; measured, git 2.53.0); created fresh, any old content removed first. It lies outside the tree, so nothing can be committed.
    - One line: `( node <repo>/_shared/a1-tools.cjs verify run --project <dir> --phase <phase> > "$VBG/report.json"; RC=$?; echo "$RC" > "$VBG/rc.tmp" && mv "$VBG/rc.tmp" "$VBG/rc" ) > /dev/null 2>"$VBG/stderr.txt" & echo "$!" > "$VBG/pid"`. It contains `RC=$?` for `check-wave11-callsites.cjs`, carries no `--affected` (`verify-scope` rule) and no `--out` (`writeOut` race with Victor). VS3's restricted address (`.*--out`) does not match it.
    - The fence carries `<!-- a1:background id=verify-bg join=yes -->`.
  - **Victor's brief** gets `verify_report: <VBG>/report.json` and `verify_rc: <VBG>/rc`. `agents/a1-victor-verifier.md` gets one rule: when the brief names `verify_rc`, wait until that file exists before your `verify run --out` (bounded: at most 240 checks, 15 s apart, plain `[ -f ]`). Then the call is a cache hit and waits on no lock.
  - **Join** (orchestrator, after Victor returns, fence with `<!-- a1:join id=verify-bg -->`): the same bounded file wait plus `kill -0 "$(cat "$VBG/pid")"`. A dead process without an rc file breaks the loop and reports `background verify died`. The existing foreground `verify run --out` then runs as today (a cache hit when the background run was green and the tree unchanged). The existing `verify check` follows unchanged, as do the `lock_timeout` routing text (QH7) and the one `retro validate` block (L12).
  - Never `pgrep` (`quiet-host-poll`), never a plain `wait $PID` (a later Bash call is not the parent shell).
- **D14 Parallel and background markers (FR-023/FR-024 lint)** (`_shared/lib/workflow-lint-parallel.cjs`, PR B).
  - Marker `<!-- a1:parallel group=<id> -->`, id `[a-z0-9-]{1,40}`, scanned in `skills/**/*.md` and `agents/*.md`. A member is the file holding the marker; its output is the first `**Output path:** <path>` line in that file; its inputs are the `- <path>` lines inside its `<files_to_read>` block.
    - Rule `parallel-group`: a group with fewer than 2 members, or a member whose inputs contain another member's output path (exact string after trimming a trailing ` (...)` note).
  - Markers `<!-- a1:background id=<id> join=<yes|no> -->` and `<!-- a1:join id=<id> -->`. Rule `background-start`: the next fenced bash block after a background marker must hold a line ending in `&` or containing `& echo "$!"`; `join=yes` needs a join marker with the same id later in the same file; a join marker without a matching background marker is a finding.
  - Output JSON keys: `parallel_checked`, `background_checked`.
  - **04-audit.md shape is fixed by the a1-dashboard pin.** The background form wraps the existing guard in `VMIRROR_LOG="$(mktemp)"` / `(` ... `) > "$VMIRROR_LOG" 2>&1 &` / `echo "vault mirror runs in the background, log: $VMIRROR_LOG"`, keeping every inner line byte-identical. Measured 2026-11-20: `callsite_check` prints `ok` for exactly this form, and the `vault-sync-step` regex still matches.
- **D15 `feature plan-steps` (FR-025)** (`_shared/lib/feature-plan-steps.cjs`, group dispatcher `_shared/lib/feature.cjs`).
  - One frozen table `STEPS`; each entry has `{id, kind: 'spawn'|'gate', agent|gate, model?, phase, sizes:[...], when?}`.
    - Fixed spawns: `rene-discover`/`rene-specify` (sonnet, M/L), `rene-clarify` (opus, M/L), `rene-discover-specify-clarify` (opus, S only, phase `1-4`, `resume: ['gate-c-ac-dryrun', 'wave-plan']`; owner decision 2026-11-20: reasoning tier). The `resume` list names the later dispatches that resume this same spawn via `SendMessage` instead of spawning: Gate C's dispatch (03-clarify 3.5-1, also a 3.5-2 loop-back) and the S single-wave plan (04-plan Step 1). So the S plan writer is this Rene spawn; when the resume is not possible, the session writes the plan in the same format, never a Vincente spawn (audit round 2 M2), `vincente-wave-plan` (M/L), `code-agents` (per wave plan, all sizes), `diana-docs-drift` (M/L), `pr-review-reinhard` (all sizes).
    - Conditional spawns (audit M10), each with a `when` value the phase workflow decides:
      - `uwe-ux` (agent `a1-uwe-ux-expert`, phase 3, all sizes, `when: {S: 'on_request', M: 'ui_surface', L: 'ui_surface'}`; 03-clarify.md 2b-3 and the S rule "mockups only on request");
      - `samuel-threat-model` (agent `a1-samuel-security`, phase 3, all sizes, `when: 'kritis_profile'`; 03-clarify.md 3.5-4);
      - `samuel-security-wave` (agent `a1-samuel-security`, phase 4/5, all sizes, `when: 'security_surface'`; 04-plan.md:128);
      - `tobi-audit` (agent `a1-tobi-tester`, phase 6, M/L only, `when: 'on_request'`; 06-verify.md "Optional — Tobi audit"; FR-025 "no QA agent" on S).
    - Gates (all sizes): `roadmap-gate`, `gate-c-ac-dryrun`, `gate-4.5-fr-consistency`, `scope-claim`, `isolation-gate`, `test-fidelity`, `gate-1-build`, `pr-merge-check`.
    - No pre-pr-review Reinhard step exists for any size after PR A.
  - `stepsFor(size)` resolves `when` to a string per size (an entry without `when` is unconditional).
  - Usage `feature plan-steps <spec-path>`; it reads `size` from the spec frontmatter (`SPEC_SIZES`).
  - stdout `{spec, size, steps:[...], spawns:<n>, gates:<n>}` (`spawns` counts unconditional spawns). A missing or invalid size exits 1 `no_size`; usage errors exit 2.
  - SKILL.md states: `steps[]` lists every fixed and every conditional step; a step with `when` runs when its phase workflow finds the condition true.
  - The S branches of `01-discover.md`, `02-specify.md`, `03-clarify.md` and `04-plan.md` match `steps[]` (Task 9.1 action 2a; cases SP1-SP5): one Rene spawn on S, no second Rene spawn in Phases 2-3, no Vincente spawn in Phase 4. FR-025 names "one Rene spawn for Discover+Specify+Clarify"; the plan extends the same spawn to the S plan by resume (no extra spawn). The PR text names this reading.
- **D16 `feature close` (FR-026)** (`_shared/lib/feature-close.cjs`, via `feature.cjs`).
  - **Usage:** `feature close --by <spec-id> --pr <n> [--repo <dir>] [--spec <path>] [--worktree <id>]` and `feature close --cleanup-only [--repo <dir>]`.
  - **Steps in order.** Every step is a child CLI process (`cwd: repo`) or argv-only git/gh. Each is skipped when already done, and each failure exits 1 `{ok:false, reason, step}` with nothing after it run.
    1. Repo = git toplevel of `--repo` (default cwd). A linked worktree (`--git-dir` ≠ `--git-common-dir`) → exit 1 `run_from_worktree`. Spec path resolved (see 9) and every argument checked here, before step 2.
    2. `gh pr view <n> --json state,headRefName,baseRefName,headRefOid` (bin `process.env.A1_GH_BIN || 'gh'`, override named on stderr). Not `MERGED` → `pr_not_merged`; gh failure → `gh_failed`.
    3. `git ls-remote --heads origin <headRefName>` is non-empty → `remote_branch_present`; failure → `git_failed`.
    4. Worktree entry: `--worktree <id>`, else the entry of `worktree list` whose `branch === headRefName` and repo matches. No entry, or status `cleaned` → skip steps 5-6.
    5. **Every gate-log scope of the worktree** (`require('./worktree-gatelog.cjs').listGateLogs(worktree_path)`, which already skips `_unscoped`): `run record --repo <worktree_path> --scope <scope> --pr <n>` per scope, so `refuseUnpreservedGateLogs` finds nothing unrecorded (audit M9). Exit 2 → `step_failed`; exit 1 → a `warnings[]` entry.
    6. `worktree exit <id> --mode discard` (never `--force-discard`); non-zero → `worktree_exit_refused`, stderr passed on (it names any scope still unrecorded).
    7. Stages: read the reservation from `code-scope list`; advance `merge` then `origin-cleanup`, each only when the current stage is before it. No reservation → skip.
    8. `code-scope release --by <spec-id>`.
    9. Spec: `--spec` or `<vault>/project/<repoProjectSlug(repo)>/spec/<spec-id>.md`. Missing → `spec_not_found` (checked in step 1). Status already `done` → skip, else `spec update-status <path> done`.
    10. `git fetch --prune origin`, then the branch sweep.
    11. **Shared state is never committed by this command** (`_shared/push-cadence.md` P3: the CLI mutates, the skill commits). When `.a1/reservations.json` is tracked (`git ls-files --error-unmatch`) and differs from HEAD (`git diff --quiet -- .a1/reservations.json` exits 1), the output carries `"reservations_commit_pending": ".a1/reservations.json"`, `warnings[]` names it, and stderr prints one line `feature close: commit .a1/reservations.json on main (push-cadence P3 finish step)`. Exit stays 0 (audit M8).
  - **Branch sweep** (also the whole of `--cleanup-only`):
    - Candidates are local branches (`for-each-ref refs/heads`) minus the current branch, the base (`baseRefName`, or `origin/HEAD`'s target, default `main`) and every branch checked out in any worktree (`worktree list --porcelain`).
    - A candidate is deleted with `git branch -D` only when (a) `gh pr list --state merged --head <b> --json headRefOid` holds an entry whose `headRefOid` equals the local tip, or (b) `git diff --quiet origin/<base>...<b>` exits 0 (FR-026's "empty diff against `origin/<base>`").
    - Rule (b) also deletes local branches that are not PR branches but whose tip is already contained in the base (for example an old release branch at an ancestor commit). No commit is lost; the help and the PR text say so (audit m16).
    - Every other candidate goes to `kept:[{branch, reason}]`: `unmerged_commits`, `tip_differs`, or `pr_not_merged`. Any gh failure in the sweep deletes nothing and exits 1 `gh_failed`.
    - Names must pass `git check-ref-format --branch`.
  - Output `{ok, mode, pr, spec, steps:[{step, result}], deleted:[], kept:[], warnings:[], reservations_commit_pending?}`. A second call changes no file and deletes nothing, and exits 0.
  - Usage errors and hostile values (`--by` not matching `SCOPE_RE`, `--pr` not `^[1-9][0-9]{0,6}$`) exit 2.
- **D17 05-merge.md switch (FR-026)** (Task 9.2). One new fenced block F after block R (run record) and before block P (probe run).
  - It sets `SPEC_ID='<caller_spec_id>'` (the input declared in 02-review.md: the spec id when the caller is a1-new-feature, else `none`).
  - The `case` skips on empty, `none` or an unreplaced placeholder (printing that items 3-4 apply). Otherwise it reads `gh pr view <n> --json state --jq .state`. When the state is `MERGED` and `git -C "<repo_root>" ls-remote --heads origin "<branch>"` is non-empty, it runs `git -C "<repo_root>" push origin --delete "<branch>"`, the merged-PR remote delete that a1-worktree 03-exit Step 4.5 already allows without asking. Then `(cd "<repo_root>" && node <repo>/_shared/a1-tools.cjs feature close --by "$SPEC_ID" --pr <n>); RC=$?`, with STOP on non-zero.
  - Prose after the block: when the output names `reservations_commit_pending`, commit that file on the primary checkout's `main` and push it as the finish step of `_shared/push-cadence.md` P3 (protected `main`: chore PR `chore/<spec-id>-finish`, then the reset/rebase rule there). `feature close` itself commits nothing.
  - F becomes item 3; the old items 3-4 become items 4-5 and stay the path for callers without a spec id. The old item-3 line keeps every byte after its number, so RR_POS (the regex `^\d\.` followed by the literal words a1-worktree exit discard, each in backticks) stays green; the condition is appended at the end of that item, never in front of the anchored words (audit round 2 m2). The block text names none of `run record`, `probe run`, `pr merge-check`, `disposition review`, `product validate`, `^gh pr merge `.
  - Pin change in `_test-fixtures/a1-pr-review/run-tests.sh`: block count `6`→`7`; the order classifier gains `/feature close/.test(x)?"F"` before the `"?"` fallback; the expected order `DCMGRP`→`DCMGRFP`. `b[3]` and its byte-exact pin are unchanged.
- **D18 Caps.**
  - Hard caps: `a1-tools.cjs` ≤ 800 (expected 786 after A, 787 after B); `checklist.cjs` byte-unchanged; `help.cjs` ≤ 800.
  - New modules: `reuse-hash.cjs` ≤ 270, `pr-review-record.cjs` ≤ 200, `wave.cjs` ≤ 60, `wave-next-check.cjs` ≤ 320, `wave-checks.cjs` ≤ 200, `feature.cjs` ≤ 60, `feature-plan-steps.cjs` ≤ 220, `feature-close.cjs` ≤ 420, `workflow-lint-flow.cjs` ≤ 250, `workflow-lint-parallel.cjs` ≤ 250, `help-lean.cjs` ≤ 140.
  - Existing files: `gate-log.cjs` ≤ 480, `gates-lint.cjs` ≤ 230, `workflow-lint.cjs` ≤ 445 (keep each hook to one `require` line plus one compact call line).
  - Functions < 50 lines.
- **D19 Frozen.** `.a1/verify.json`, `_test-fixtures/suite-groups.json` and `.github/` have no diff against `origin/main` in either PR. No new suite directory and no new `run*.sh`.
- **D20 SC-003 measurement at PR A's merge-check.** PR A touches no `ci_evidence.unchanged` path, so the default merge-check would take CI evidence and run nothing locally. The one merge-check of PR A therefore runs with `--no-ci-evidence`. It uses the repo's own CLI (`node /home/rob/claude-projects/a1-specforge/_shared/a1-tools.cjs` on `main`), so this is the first real long-path run (expected `runner_source: "base"`). It is both the merge evidence and the SC-003 measurement. The measurement file is written after the merge into the scope-release chore PR, never onto the PR A branch (a new commit would move the head pinned by `--match-head-commit`, audit M7) (Task 5.2).

- **D21 Event-store commits (audit round 2 M1, m3).** The approach is **commit**, not `info/exclude`. Reasons:
  1. a1-execute phase stores are tracked in this repo (`git ls-files` lists `observations.jsonl`/`GOAL.md` of s1-s3), and project repos already track `.a1/reservations.json`;
  2. an exclude lives in `<git-common-dir>/info/exclude`, so it hides new files of that name in every checkout of the repo. Measured 2026-11-20: with `.a1/phases/*/GOAL.md` excluded, `git add .a1/phases/x/` exits 0 and stages only `PLAN.md`, so a P0-style phase-folder commit would silently drop GOAL.md;
  3. committed observations survive the worktree exit and feed the retro and the learning loop; excluded ones would die with the worktree.

  Cost: a1-new-feature PRs carry two small bookkeeping files under `.a1/phases/<spec-id>/`. The PR A text names it.
  - **Creation commit.** The Phase-start block (02-execute) and Step 1b (05-implement) end with `git add` plus `git commit -- <both files>`, only when the block created or changed a file. A second run makes no commit.
  - **Append commits.** Each session-side append is committed in the same worktree right after it is written: 02-execute decision rows, 05-implement Step 4 (f) observation lines and (g) decision rows (`git -C <worktree> commit -m ... -- <store path>`; the file is tracked, so no `git add` is needed). Never while an executor works in that worktree (git index lock): such a row is written and committed after the wave's COMPLETE report and the commit-landed gate, before `wave next-check`; its ISO token is the time of the decision. Erik's own observation lines ride in Erik's task commit (existing rule; the commit-landed gate hands uncommitted work back to him).
  - **Lanes.** Phase start runs once in the phase worktree before the lane worktrees branch off, so the lanes inherit the tracked stores. Two lanes that append to the same store would conflict at the lane merge. So the block registers `.a1/phases/*/observations.jsonl merge=union` and `.a1/phases/*/GOAL.md merge=union` in `<git-common-dir>/info/attributes` (local, never committed; both files are append-only lists). Measured 2026-11-20: two branches that each append one line merge with rc 0 and keep both lines; without the attribute the second merge exits 1.
  - **Quoting (m3).** The goal or spec title enters through a quoted heredoc (`<<'A1_GOAL_EOF'`), so an apostrophe, `$(...)` or a backtick stays literal. Measured: the value `it's a "goal" with $(touch PWNED)` is written verbatim and no `PWNED` file appears.
  - Measured red: without the commit step, the planted worktree shows 2 untracked files and `git worktree remove` refuses (`contains modified or untracked files, use --force`).

## Field owners (Step 3 #10)
Neighbour 027-lean-pipeline-s3 — PLAN.md rev 1, merged as PR #105 (f4aa2a8), read 2026-11-20. It owns `verify run` lock/runner fields, the per-wave gate STOP text and the 05-merge `sh` load line; this phase reads them and changes none.

| Field / marker | Single writer | Readers | Fixed in |
|---|---|---|---|
| gate-log record (all fields) | facade hook `installGateLog`/`recordRun` (unchanged as only writer) | reuse-hash, review-evidence, wave next-check, run record | D4, D6 |
| record extras `input_hash`, `reused` | the running gate via `setRecordExtra` (reuse-hash on behalf of the 3 gates) | reuse-hash lookup | D6 |
| `currentScope()` value | `installGateLog` (W1) | reuse-hash, `pr review-record` | D6, D4 |
| `pr-reinhard` record | `pr review-record` exit code → hook (W2) | `pr review-evidence`, run record, SC-005 count | D2, D4 |
| `head_sha` hand-over 2.1b → 2.3a | 2.1b stdout `head_sha=` (W2), substituted by the orchestrator | 2.3a `<head_sha>` | D4 |
| `code_scope.stage` `review`/`verify` | 02-review.md 2.3d (W2) | `feature close` (reads), a1-progress | D5 |
| `caller_spec_id` input | a1-new-feature 06-verify.md hand-off (W3) | 02-review.md 2.3d (W2), 05-merge.md F block (W9) | D5, D17 |
| `code_scope.stage` `merge`/`origin-cleanup`, release, spec `done` | `feature close` (W8), called from 05-merge.md F block (W9) | a1-progress, roadmap | D16, D17 |
| commit of `.a1/reservations.json` after close | the skill (05-merge.md F-block prose, push-cadence P3 finish step), never `feature close` | `code-scope list` on other checkouts | D16, D17 |
| `observations.jsonl` (created empty) | 02-execute "Phase start" / 05-implement Step 1b (W3) | `wave next-check` | D7 |
| `observations.jsonl` deviation/blocker lines | a1-erik-executor (a1-execute); the session in 05-implement Step 4 (a1-new-feature, W3) | `wave next-check` | D7 |
| GOAL.md (created with `## Decisions`) | 02-execute "Phase start" / 05-implement Step 1b (W3) | `wave next-check`, Victor | D7 |
| GOAL.md `## Decisions` rows (ISO first token) | the orchestrating session: 02-execute 2c (a1-execute) and 05-implement Step 4 mid-run decision rule (a1-new-feature), both W3 | `wave next-check`, Victor | D7 |
| commit of the event stores at creation | the Phase-start block (02-execute) / Step 1b (05-implement) itself, only when it created or changed a file (W3) | the commit-landed gate, `worktree exit`, `feature close` (clean tree) | D21 |
| commit of session-side store appends | the session, right after each append, never while an executor runs in that worktree: 02-execute decision rows; 05-implement Step 4 (f) observations and (g) decision rows (W3) | the commit-landed gate, `worktree exit` | D21 |
| commit of Erik's observation lines | a1-erik-executor in his task commit (existing rule, unchanged) | the commit-landed gate | D21 |
| `merge=union` attribute for the two store paths | the Phase-start / Step 1b block, in `<git-common-dir>/info/attributes` (local, never committed) | `git merge` at the lane merge | D21 |
| commit of `.a1/reservations.json` after 2.3d | the a1-pr-review session, at once after 2.3d ran a stage call (push-cadence P3) | `code-scope list` on other checkouts | D5 |
| `--since` wave start | the orchestrator at dispatch (02-execute 2a, 05-implement Step 4; W3) | `wave next-check` | D7 |
| stop-block markers | 02-execute.md, 05-implement.md (W3) | `wave-checkpoint` rule (W4) | D8 |
| parallel/background/join markers | a1-plan 01/02/04 workflows, 03-verify, 06-verify (W7, W8) | `workflow-lint-parallel.cjs` (W7) | D13, D14 |
| `$VBG` files `report.json`, `rc`, `pid` | the background start line (W8) | Victor (brief), the join block | D13 |
| step table `STEPS` | `feature-plan-steps.cjs` (W6) | a1-new-feature SKILL.md (W9) | D15 |
| `PROMPT_RECORDERS`, `BUNDLES` | `gates-lint.cjs` (W2, W7) | `gates lint`, ADR note | D3, D12 |
| `CHILD_GATES` | `wave-checks.cjs` (W6) | `wave checks` children; BU4 equality with `BUNDLES` | D11, D12 |
| `LEAN_HELP` usage blocks | `help-lean.cjs` (W1 for PR A commands, W6 for PR B commands) | `--help`, `check-callsite-flags.cjs` | B1 |

## Success Criteria
- [ ] SC-1 (FR-019 record): `pr review-record` exits 0 for `pass` and 1 for `fail`, and writes exactly one `pr-reinhard` line per call with that verdict and the HEAD sha. A `--head` that is not HEAD exits 2, and so does a missing `--phase`. `gates lint` accepts the invoke on `pr-reinhard` only (R3b still red, byte-unchanged).
- [ ] SC-2 (FR-019 evidence + flow): `pr review-evidence` exits 0 after a pass at the same sha, and 1 for a new sha, after a fail at that sha, for a missing log and for a broken chain. 02-review.md skips the Reinhard spawn on exit 0, records the verdict after every spawn with the substituted `<head_sha>` (no `$HEAD_SHA` in 2.3a), and advances the stages at 2.3d after a pass and on the skip path, without a backward move. 06-verify.md holds no `a1-reinhard-reviewer`, and the `verify-early-review` rule flags a re-added one.
- [ ] SC-3 (FR-020): per gate (4.5, lane-split, class-sweep):
  - an unchanged input is reused (the `reused:` line, a record with `input_hash` and `reused: true`, the gate not run);
  - an edited input runs (for 4.5 also a wave-plan-only edit and a roadmap edit);
  - a planted fail record with the same hash runs; a corrupt log runs; a call without `--phase` runs and is not reused;
  - a changed gate module or a changed local require of it (tool closure) runs; class-sweep with a new HEAD runs;
  - a full `checklist run` without `--only` is never reused.
- [ ] SC-4 (FR-021): `wave next-check` prints `continue` for a green wave with empty stores and a named agent. Planted inputs give `stop:gate_red`, `stop:deviation`, `stop:scope_change`, `stop:agent_unnamed` and, with the flag, `stop:owner_requested`. Each missing or unreadable source (gate log, plan, `observations.jsonl`, GOAL.md, the `## Decisions` heading) stops; an ISO Decisions row before `--since` on the same day does not; wave 0 checks only the agent. 02-execute.md and 05-implement.md create both stores at phase start and commit them (after the extracted block, a planted worktree's `git status --porcelain` is empty, a second run makes no commit, a lane merge keeps both sides' lines, and `git worktree remove` succeeds; FL12-FL16), commit every session-side append (FL17), call `wave next-check` in a fenced block, and hold no prompt outside a stop block; the `wave-checkpoint` rule flags a planted one (spec SC-004 precondition).
- [ ] SC-5 (FR-022): 03-draft.md and 04-submit.md hold no confirmation marker; the `pr-confirmation` rule flags each planted marker, and the force-push asks stay (rule green with them present).
- [ ] SC-6 (PR A gate): on the PR A head:
  - `gates lint` (keep-list invariants included) and `workflow lint` exit 0; `run-wave13.sh` and `run-wave14.sh` exit 0; `bash bin/run-suites.sh` exits 0;
  - D18 caps and D19 frozen files hold;
  - Reinhard's (and, when triggered, Samuel's) BLOCKER/MAJOR findings are fixed;
  - the one merge-check is green; PR A merged;
  - `SC003-MERGE-CHECK.json` holds `runner_source`, `duration_ms`, host load and the baseline and is on `main` via the scope-release chore PR (spec SC-003 evidence, D20).
- [ ] SC-7 (FR-023): Rico's and Marco's workflows carry one parallel group `research-map`, and 02-map.md names no RESEARCH.md in `files_to_read` but passes goal and spec path. The 04-audit vault mirror runs in the background (dashboard pin 05.26 green). The `parallel-group` rule flags a single member and a dependent member, and the real tree passes.
- [ ] SC-8 (FR-024): `wave checks` runs all three checks and reports each. With one failing check it exits non-zero with all three reported; all green exits 0; each child writes its own gate-log line into the project's log. 02-execute.md and 05-implement.md call `wave checks` (W11a-W11f green with the deliberate pins). 03-verify.md and 06-verify.md start `verify run` in the background before the Victor spawn and join on it, with an absolute `$VBG`, and Victor gets the report path (VS3 green with the deliberate pin). The `background-start` rule flags a marker without `&` or without a join.
- [ ] SC-9 (FR-025, spec SC-008): for planted specs of size S, M and L, `feature plan-steps` gives:
  - S has strictly fewer unconditional spawns than M and none of Vincente, Diana, Tobi or a pre-pr-review Reinhard;
  - S has exactly one Rene spawn (phase `1-4`, model opus, resumed for Gate C's dispatch and the single-wave plan);
  - every M gate is in S, and every S step except the merged Rene spawn is in M;
  - M equals L; every conditional step carries a resolved `when` string.
  SKILL.md reads the list instead of embedding the S table, and the S branches of 01-discover, 02-specify, 03-clarify and 04-plan match it: no second Rene spawn, no Vincente spawn, the S plan written by the resumed Rene (SP1-SP5; a1-kritis-profile green with the deliberate pins).
- [ ] SC-10 (FR-026):
  - merged → all steps, exit 0; open PR → exit 1 `pr_not_merged`; branch still on remote → exit 1 `remote_branch_present`; second call → exit 0 with no file change;
  - a merged branch is deleted; an unmerged branch and a closed-unmerged PR branch are kept and reported;
  - every gate-log scope of the worktree is recorded before the exit; a tracked `.a1/reservations.json` is reported as `reservations_commit_pending`, never committed;
  - `--cleanup-only` in a second clone deletes the merged branch there and touches no scope or spec;
  - 05-merge.md calls `feature close` (DCMGRFP pin, the F-block stub run) and SKILL.md names it.
- [ ] SC-11 (PR B gate): the same as SC-6 for the PR B head, with Samuel spawned explicitly, the default merge-check green, and PR B merged.

---

## Wave 1 — Reuse foundation, facade lines and PR A help (lane cli-a, PR A)

### Task 1.1: `currentScope()`, `reuse-hash.cjs`, three reuse call sites, facade lines, PR A help
**Goal:** The three FR-020 gates reuse a pass by input hash (D6), the facade routes `pr review-*` and `wave`, and `--help` documents all three PR A commands before any fenced call names them.
**Actions:**
1. `_shared/lib/gate-log.cjs`:
   - add `let hookScope = null;` beside `hookInstalled`;
   - in `installGateLog` set `hookScope = stripped.scope;` right before `hookInstalled = true;`;
   - add a function `currentScope()` that returns `hookInstalled ? hookScope : null`, with JSDoc `@returns {string|null}`;
   - export `currentScope` and also `logPathFor` (existing function, l.~233), so readers do not rebuild the path.
2. Create `_shared/lib/reuse-hash.cjs` (`'use strict'`, header comment naming spec 027 FR-020 and D6). Exports, each with a JSDoc `@returns` naming every field:
   - `TOOLS` (frozen table of entry modules, D6) and `toolClosure(entries)` → `string[]` (sorted file names, local requires two levels deep);
   - `computeHash({gate, files:[{label, path}], args})` → `{hash}`, or throws `ReuseMiss('input_missing')` when a file is missing;
   - `lookupPass({root, scope, gate, hash, requireHead, projectDir})` → `{hit: boolean, reason: string}`;
   - `tryReuse({gate, files, args, requireHead, projectDir})` → `{reused: boolean, hash: string|null, reason: string}`. On a hit it does the D6 setter call and the stdout/stderr lines; on a miss it calls `setRecordExtra({input_hash})` when a hash exists;
   - `setPostRunHash({gate, files, args})` (class-sweep);
   - `checklistRunWithReuse(rest, runner)` (D6 gate-4.5 conditions incl. the roadmap input; calls `runner(rest)` on a miss).

   git calls go through `gitSafe` (argv only). File reads are capped at 2 MiB (bigger file = miss). Every exit goes through `emitExit`.
3. `_shared/lib/lane-split.cjs` `cmdLaneSplitCheck`, after the plan-exists check: `const r = require('./reuse-hash.cjs').tryReuse({gate: 'lane-split', files: [{label: 'plan', path: planPath}], args: {imports: flags.imports ? fs.realpathSync(flags.imports) : null}, requireHead: !!flags.imports, projectDir: flags.imports || process.cwd()}); if (r.reused) { process.exitCode = 0; return; }`. A non-directory `--imports` keeps today's error path (the realpath happens only when the path exists; otherwise `imports: 'missing'`, no reuse). Also add `frontmatterOf` to `module.exports` (for D7).
4. `_shared/lib/fix-class-sweep.cjs` `cmdFixClassSweep`, mode `verify` only:
   - before `doVerify`: `tryReuse({gate: 'fix-class-sweep', files: [{label: 'bug', path: bugPath}], args: {project: fs.realpathSync(o.project), guards: [...o.guards].sort(), diff_base: <rev-parse of o.diffBase or null>}, requireHead: true, projectDir: o.project})`. On a hit return (exit 0).
   - on a miss: after `doVerify` returns or throws a refusal, call `setPostRunHash` with the same args (D6: post-run hash).
   - `--record` is untouched.
5. `_shared/a1-tools.cjs` (net +2 lines, D18):
   - the `checklist run` branch line `cmdChecklistRun(rest);` → `require(path.join(__dirname, 'lib', 'reuse-hash.cjs')).checklistRunWithReuse(rest, cmdChecklistRun);`
   - in the `pr` chain, before `else usage(...)`: `else if (sub === 'review-record' || sub === 'review-evidence') { require(path.join(__dirname, 'lib', 'pr-review-record.cjs')).cmdPrReview(sub, rest); return; }`
   - after the `run` line: `} else if (group === 'wave') { require(path.join(__dirname, 'lib', 'wave.cjs')).cmdWave(sub, rest); return;`
   - the usage string: add `"wave"` to the group list and append `Spec 027 slice 4 adds: pr review-record, pr review-evidence, wave next-check`.
6. Create `_shared/lib/help-lean.cjs` (pattern `help-run.cjs`) exporting `LEAN_HELP` with three usage blocks, each starting with two spaces and `a1-tools`, flags listed explicitly (the sweep treats a two-word block as strict):
   - `  a1-tools pr review-record --head <sha> --verdict <pass|fail> --phase <scope>` (D4 semantics, exits, the `_unscoped` note);
   - `  a1-tools pr review-evidence --head <sha> --phase <scope>` (`--phase` listed, because it is not a registry invoke);
   - `  a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]` (the D7 source table, "missing source = stop", the wave-0 rule, the ISO rule for Decisions rows, the agent rule for a plan without `lanes:` with and without `--plan`).
   - The FR-020 reuse note: the existing `checklist run`/`lane-split check`/`fix class-sweep` help lines stay unchanged; `LEAN_HELP` carries a plain indented paragraph headed `  Input-hash reuse (spec 027 FR-020):` (no `a1-tools` prefix, so the sweep parses no usage block from it) naming the key fields, the tool closure depth 2, per-checkout logs and the three gates covered. One empty line precedes that heading (audit round 2 m6): `helpBlocks()` in `check-callsite-flags.cjs` ends a usage block only at a blank or non-indented line, so without it every flag the paragraph names (`--only`, `--imports`, `--verify` …) would count as accepted by `wave next-check`.
   - `_shared/lib/help.cjs`: one `require` line and `${LEAN_HELP}` in `HELP` (after `${RUN_HELP}`).
7. Create `_test-fixtures/a1-lib-units/cases/help-lean.cjs`: `HELP` includes `LEAN_HELP`; each of the three usage lines is present; `node a1-tools.cjs --help` (child) contains `wave next-check` and `pr review-evidence --head <sha> --phase <scope>`; the line right before `  Input-hash reuse (spec 027 FR-020):` in `LEAN_HELP` is empty.
8. Create `_test-fixtures/a1-lib-units/cases/reuse-hash.cjs` (helpers `check`, `eq`, `done` from `../lib.cjs`; spawns `node <lib>/../a1-tools.cjs` with explicit env).
   - **Fixtures:**
     - a planted git repo per gate under `process.argv[3]`;
     - for 4.5, a planted vault copied from a passing case of `_test-fixtures/a1-checklist/` (copy the real files, CONVENTIONS.md), with `A1_VAULT_ROOT` set only in the child env, plus a planted `project/<slug>/product/ROADMAP.md` listing the feature;
     - for class-sweep, a planted bug file and repo copied from `_test-fixtures/a1-fix-class-sweep/`.
     - Planted log records are written with `gateLog.appendGateLine` (valid chain).
   - **Cases:**
     - RH1 `currentScope()` is null outside the hook (direct require).
     - RH2 lane-split twice with `--phase rp`: the second run's stderr has `reused: lane-split @ <64 hex>`, its stdout JSON has `reused: true`, and its log record has `input_hash` (same as record 1) and `reused: true`.
     - RH3 a plan edit runs (no `reused`).
     - RH4 a planted fail record with the same hash after the pass runs.
     - RH5 a garbage line appended to the log runs.
     - RH6 without `--phase` runs, and the `_unscoped` record has no `reused`.
     - RH7 `--imports .` reuse holds at the same HEAD and runs after a new commit; the reused stdout says `imports_checked: true`.
     - RH8 4.5 `checklist run <slug>/<feature> --only 9,10,11 --phase p` twice: the second is reused.
     - RH9 a wave-plan-only edit runs.
     - RH10 a spec edit runs.
     - RH11 `--only 9,10` (different set) runs.
     - RH12 a full `checklist run <slug>/<feature> --phase p` (no `--only`) twice is never reused.
     - RH13 class-sweep `--verify` twice: the second is reused.
     - RH14 a new commit touching a tracked file runs.
     - RH15 an uncommitted tracked change runs.
     - RH16 a different `--guard` set runs.
     - RH17 tool digest: the same call through a scratch tree copy whose `lane-split.cjs` has one appended comment line runs.
     - RH18 a roadmap-only edit runs (4.5).
     - RH19 tool closure: the same call through a scratch tree copy whose `segment-glob.cjs` (a local require of `lane-split.cjs`; the executor confirms the edge with `grep -n "require" _shared/lib/lane-split.cjs` and picks another depth-1 require when it is absent) has one appended comment line runs.
9. Run `bash _test-fixtures/a1-lib-units/run-tests.sh`, `bash _test-fixtures/a1-lane-split/run-tests.sh`, `bash _test-fixtures/a1-fix-class-sweep/run-tests.sh`, `bash _test-fixtures/a1-checklist/run-tests.sh` (or its runner name in `suite-groups.json`), `bash _test-fixtures/a1-worktree/run-tests.sh` (gate-log hook cases), `bash _test-fixtures/a1-exit2-audit/run-tests.sh`, `bash _test-fixtures/a1-cli-output/run-tests.sh`, `bash _test-fixtures/a1-gates-lint/run-wave13.sh` and `bash _test-fixtures/a1-gates-lint/run-wave14.sh` (no fenced call changes yet; proves the help addition breaks no block parse).

RED-proof:
- (a) `currentScope` returns `null` always → RH2 red.
- (b) lookup takes the FIRST record with the hash instead of the last → RH4 red.
- (c) `verifyChain` check removed → RH5 red.
- (d) wave-plan dropped from the 4.5 inputs → RH9 red.
- (e) the `--only` set check removed → RH12 red.
- (f) `requireHead` ignored → RH14 and RH7 red.
- (g) class-sweep hash computed before `doVerify` (pre-run) → RH13 red.
- (h) `tool` digest dropped from the key → RH17 red.
- (i) roadmap dropped from the 4.5 inputs → RH18 red.
- (j) `toolClosure` returns only the entry modules → RH19 red.
- (k) `${LEAN_HELP}` removed from `HELP` → help-lean red.
- (l) the empty line before `  Input-hash reuse` removed → help-lean red.

**Done when:**
- All listed suites exit 0.
- `wc -l < _shared/a1-tools.cjs` ≤ 786, and `git diff --quiet origin/main -- _shared/lib/checklist.cjs` exits 0.
- D18 caps hold for the touched files.
- 12 RED-proof lines are logged.

**Status box:**
- [x] T1.1 `_shared/lib/reuse-hash.cjs` `currentScope` `checklistRunWithReuse` `toolClosure` `frontmatterOf` `_shared/lib/help-lean.cjs` `_test-fixtures/a1-lib-units/cases/reuse-hash.cjs` `_test-fixtures/a1-lib-units/cases/help-lean.cjs`

**Covers:** SC-3, SC-6

---

## Wave 2 — Review recorder and wave next-check (lane cli-a, PR A)
**Depends on:** Wave 1

### Task 2.1: `pr review-record` / `review-evidence`, registry, recorder exception, 02-review.md
**Goal:** FR-019's recorder and evidence commands exist, are wired, and 02-review.md uses them (D2-D5).
**Actions:**
1. Create `_shared/lib/pr-review-record.cjs` exactly as D4. Exports: `cmdPrReview(sub, rest)` and `lastVerdictFor(records, sha)` (JSDoc `@returns {'pass'|'fail'|'error'|null}`). It uses `gateLog.currentScope`, `verifyChain`, `validateScope`, `logPathFor` and `gitSafe`, and `emitExit` for every exit.
2. `_shared/gates-registry.md` row `pr-reinhard`: change the invoke cell `none` → `` `pr review-record` @ a1-pr-review ``. Append to its notes: `Spec 027 FR-019: recorder invoke on a prompt row (gates lint PROMPT_RECORDERS); one record per head sha; pr review-evidence skips a second spawn at the same sha.`
3. `_shared/lib/gates-lint.cjs`: add `PROMPT_RECORDERS` and the exception as D3.
4. `skills/a1-pr-review/workflows/02-review.md`:
   - (a) Inputs list (lines 7-12): add `- `caller_spec_id` (a1-new-feature hands over its spec id; any other caller: `none`). Read by 2.3d and by 05-merge.md.`
   - (b) New step **2.1b Review evidence** before 2.2, with one fenced block:
     `HEAD_SHA="$(git -C "<worktree_path>" rev-parse HEAD)"; RC=$?`, `if [ "$RC" -ne 0 ]; then echo "STOP: rev-parse exit=$RC"; exit "$RC"; fi`, `echo "head_sha=$HEAD_SHA"`, then `(cd "<worktree_path>" && node <repo>/_shared/a1-tools.cjs pr review-evidence --head "$HEAD_SHA" --phase pr-<n>); EV=$?`, then `echo "review-evidence exit=$EV"`.
     Prose: note the printed `head_sha` value as `<head_sha>` for 2.3a. Exit 0 **and** `<worktree_path>/.a1-review/findings.json` exists → skip 2.2 and 2.3a for this head, reuse the findings, and run 2.3d. 2.2b still runs; Samuel's spawn is not skipped by this. Exit 1 → go on to 2.2 as today. Exit 2 → STOP (usage).
   - (c) New step **2.3a Record the verdict**, right after 2.3 parses Reinhard's JSON: `(cd "<worktree_path>" && node <repo>/_shared/a1-tools.cjs pr review-record --head <head_sha> --verdict <pass|fail> --phase pr-<n>); RC=$?` plus `echo "review-record exit=$RC"`. `<head_sha>` is the value 2.1b printed (substituted by the orchestrator, like `<BASE_SHA>` in 2.2b); never a shell variable, because 2.1b ran in an earlier Bash call. Verdict `fail` when the parsed `blocker` array is non-empty, else `pass`. Exit 2 → STOP (head moved since 2.1b: re-run 2.1b and 2.2). Exit 1 is the recorded fail and does not stop (the BLOCKER flow of 2.6 applies).
   - (d) New step **2.3d Lifecycle stages** (D5), one fenced block:
     - `PHASE='<caller_spec_id>'`;
     - a `case` skipping `""|none|"<"*` with `echo "SKIP: lifecycle stages, no caller spec id"`;
     - else `SCOPES="$(cd "<repo_root>" && node <repo>/_shared/a1-tools.cjs code-scope list)"; RC=$?` (STOP on non-zero);
     - `NEED="$(node -e '<one-liner: read reservations, find by===PHASE; none → print "none"; i = stage index in [started,complete,review,verify,merge,origin-cleanup,done]; print the targets among review,verify whose index > i, space-separated, or "none">' "$SCOPES" "$PHASE")"`;
     - `for S in $NEED; do [ "$S" = none ] && break; (cd "<repo_root>" && node <repo>/_shared/a1-tools.cjs code-scope stage --by "$PHASE" --set "$S"); RC=$?; if [ "$RC" -ne 0 ]; then echo "STOP: code-scope stage $S exit=$RC"; exit "$RC"; fi; done`.

     Prose: runs after a 2.3a exit 0 (`pass`) **and** after a 2.1b exit 0 (same-head skip path). Never after a recorded `fail`. One more sentence after the block (prose, not in the fence, so RV5's stub run is unchanged): when the block ran a stage call and `.a1/reservations.json` is tracked and differs from HEAD, commit it on the primary checkout's `main` at once and push it with this session step (`_shared/push-cadence.md` P3, "committed immediately, so the tree is never dirty"); `feature close`'s `reservations_commit_pending` covers only its own later changes (audit round 2 m4).
   - (e) Keep the anchor `a1-reinhard-reviewer` (quality invariant), the 2.2 brief, 2.6 and 2.6b. In 2.6b add one sentence: a fix commit makes a new head, so 2.1b exits 1 and Reinhard runs again.
   - (f) Pin notes (audit m8): the `### 2.2 ` section itself stays free of any `if/when/only` line and of `security_surface`/`xprov` (pin `run-tests.sh:174-176`; the skip condition lives in 2.1b, which this plan names; the assert title "unconditionally" stays and now means "no condition inside 2.2"). The token `merge-check` must not appear anywhere in 02-review.md (pin `:170`). No pipe is tested via `$?` (workflow-lint pipeline rule).
5. Create `_test-fixtures/a1-gates-lint/cases-pr-reinhard.sh` (uses the suite's `keep_rows`, `plant`, `run_lint`, `check`):
   - PR1 a registry with only the real `pr-reinhard` row (invoke `pr review-record` @ a1-pr-review) and a base tree whose a1-pr-review 02-review.md has the call → no `prompt_names_command`;
   - PR2 the same row with the subcommand changed to `check reservations` → `prompt_names_command`;
   - PR3 the real tree → exit 0 and `wired` holds `pr-reinhard@a1-pr-review`;
   - PR4 the 2.3a call line removed from a copy → `unwired` naming `pr-reinhard`;
   - PR5 `--phase pr-<n>` removed from the record call in a copy → `call_without_phase` (only when a1-pr-review wires `retro validate --gate-log`; otherwise assert the finding is absent and name why in the case title; the executor measures which holds).

   Append one source line to `_test-fixtures/a1-gates-lint/run-tests.sh` before its summary `echo`.
6. Create `_test-fixtures/a1-pr-review/cases-review-record.sh` (uses `pass_case`, `fail_case`, `sec`, `$REV`, `mk_workdir` of the runner) and source it once from `_test-fixtures/a1-pr-review/run-tests.sh` right before the final `echo ""`:
   - RV1 the `### 2.3a` section's fenced block contains `pr review-record --head <head_sha>` and no `$HEAD_SHA` (audit M1);
   - RV2 the `### 2.1b` block echoes `head_sha=`, and its prose names `<head_sha>` and "skip 2.2";
   - RV3 the `### 2.3d` prose names both triggers (2.3a exit 0 and 2.1b exit 0);
   - RV4 the Inputs list names `caller_spec_id`;
   - RV6 the `### 2.3d` prose names `.a1/reservations.json` and `push-cadence` (the P3 commit, audit round 2 m4);
   - RV5 stub run of the 2.3d block (RR-guard pattern, `run-tests.sh:342-360`): a stub `a1-tools.cjs` that logs argv and prints `{"reservations":[{"by":"fx","stage":"complete"}]}` for `code-scope list`. Unreplaced `<caller_spec_id>` → `SKIP` and the stub never ran; `fx` → two stage calls in order `--set review`, `--set verify`; stage `verify` in the stub → no stage call; a `$(touch PWNED)` value → no PWNED file, passed literally (no matching reservation, no stage call).
7. Create `_test-fixtures/a1-lib-units/cases/pr-review-record.cjs` (planted repo, facade children, scope `pr-7`):
   - RR1 record pass → exit 0, exactly 1 new log line, `gate pr-reinhard`, `verdict pass`, `head_sha` = HEAD;
   - RR2 evidence at the same sha → 0;
   - RR3 after a new commit, evidence with the new sha → 1;
   - RR4 record fail → exit 1, log line verdict `fail`;
   - RR5 evidence for that sha → 1 (last record wins);
   - RR6 `--head` of the parent commit → exit 2, `head_mismatch`;
   - RR7 no `--phase` → exit 2, `phase_required`, and no line in `.a1/phases/pr-7/`;
   - RR8 evidence with a garbage line appended → 1, `untrusted_log`;
   - RR9 evidence with no log → 1;
   - RR10 `--verdict maybe` → 2;
   - RR11 `--head` not 40-hex (also an empty string) → 2;
   - RR12 an unknown flag → 2;
   - RR13 two record calls → exactly 2 lines (one per call).
8. Run `bash _test-fixtures/a1-gates-lint/run-tests.sh`, `bash _test-fixtures/a1-gates-lint/run-wave13.sh`, `bash _test-fixtures/a1-gates-lint/run-wave14.sh` (W13c/W14e: the two new fenced calls resolve against the Wave 1 help), `bash _test-fixtures/a1-pr-review/run-tests.sh`, `bash _test-fixtures/a1-lib-units/run-tests.sh`, `bash _test-fixtures/a1-cli-output/run-tests.sh`, `bash _test-fixtures/a1-workflow-lint/run-tests.sh` and `node _shared/a1-tools.cjs gates lint`.

RED-proof:
- (a) `PROMPT_RECORDERS` check removed (rule fires for all prompt rows) → PR3 red and `gates lint` exit 1.
- (b) the exception keyed on id only (any subcommand) → PR2 red.
- (c) `lastVerdictFor` takes the first record → RR5 red.
- (d) the head comparison removed → RR6 red.
- (e) the `currentScope` null check removed → RR7 red.
- (f) the 2.3a block deleted on a copy → PR4 red.
- (g) 2.3a written with `--head "$HEAD_SHA"` on a copy → RV1 red.
- (h) the 2.1b trigger dropped from the 2.3d prose on a copy → RV3 red.
- (i) the P3 commit sentence dropped from the 2.3d prose on a copy → RV6 red.

**Done when:**
- The listed suites and `gates lint` exit 0.
- R3b passes unchanged (`git diff origin/main -- _test-fixtures/a1-gates-lint/run-tests.sh` shows only the added source line; `git diff origin/main -- _test-fixtures/a1-pr-review/run-tests.sh` shows only the added source line).
- 9 RED-proof lines are logged.

**Status box:**
- [x] T2.1 `_shared/lib/pr-review-record.cjs` `PROMPT_RECORDERS` `pr review-record` `pr review-evidence` `caller_spec_id` `_test-fixtures/a1-gates-lint/cases-pr-reinhard.sh` `_test-fixtures/a1-pr-review/cases-review-record.sh`

**Covers:** SC-1, SC-2

### Task 2.2: `wave next-check`
**Goal:** FR-021's stop-reason command exists with the D7 contract.
**Actions:**
1. Create `_shared/lib/wave.cjs`: `cmdWave(sub, rest)` dispatches `next-check` → `require('./wave-next-check.cjs').cmdWaveNextCheck(rest)`. Any other sub → exit 2 with usage `a1-tools wave next-check <slug> <wave> --since <iso> [--project <dir>] [--plan <file>] [--checkpoint-each-wave]`. Task 6.1 adds `checks`.
2. Create `_shared/lib/wave-next-check.cjs` exactly as D7. Keep one function per reason (`gateRed`, `deviation`, `scopeChange`, `agentUnnamed`), each returning `null` or `{reason, detail}`, each < 50 lines; `Date.parse` for every time comparison; `emitExit` for every exit.
   - Exports: `cmdWaveNextCheck(rest)` and `nextCheck(opts)` (JSDoc `@returns {{result: 'continue'|'stop', reason: string|null, detail: string}}`).
   - Imports `verifyChain`, `validateScope`, `logPathFor` from gate-log.cjs and `parseLanes`, `frontmatterOf` from lane-split.cjs.
3. Create `_test-fixtures/a1-lib-units/cases/wave-next-check.cjs`. A planted repo per case with, unless the case says otherwise, an empty `observations.jsonl` and a GOAL.md holding `# Goal: x` and `## Decisions`. Gate-log records come through `gateLog.appendGateLine` with explicit `ts` values. Plans:
   - a Pablo PLAN with `lanes: none`;
   - a PLAN with a lane block where lane `x` has `agent:` and lane `y` lacks it;
   - an a1-new-feature wave-plan (outside the repo, passed with `--plan`) with and without `### Suggested agent(s)`.

   Cases:
   - NC1 green log after `--since`, empty stores, `lanes: none` → `continue`, exit 0.
   - NC2 the last verdict of `test-fidelity` since `--since` is `fail` → `stop:gate_red`, exit 1.
   - NC3 a fail before `--since`, then a pass after → `continue`.
   - NC4 no record with `ts >= since` → `stop:gate_red`.
   - NC5 no gate log → `stop:gate_red`.
   - NC6 a broken chain → `stop:gate_red`.
   - NC7 an observations line `{"type":"deviation","wave":2}` with wave 2 → `stop:deviation`.
   - NC8 the same line with wave 1 checked at wave 2 → `continue`.
   - NC9 `{"type":"gap","wave":2}` → `continue`.
   - NC10 a non-JSON observations line → `stop:deviation`.
   - NC11 a date-only Decisions row dated the `--since` day → `stop:scope_change` (detail names the same-day repeat).
   - NC12 a date-only row dated the day before → `continue`.
   - NC13 a row with the first token `soon` → `stop:scope_change`.
   - NC14 next wave in lane `y` without an agent → `stop:agent_unnamed`.
   - NC15 next wave in lane `x` → `continue`.
   - NC16 a wave-plan without Suggested agent for wave+1 → `stop:agent_unnamed`.
   - NC17 no plan file → `stop:agent_unnamed`.
   - NC18 `--checkpoint-each-wave` on NC1 → `stop:owner_requested`.
   - NC19 a missing `--since` → exit 2.
   - NC20 `<slug>` `../x` → exit 2.
   - NC21 wave 0 with a wave-plan naming an agent for Wave 1 and a green log → `continue`.
   - NC22 order: gate red plus deviation → `stop:gate_red`.
   - NC23 `observations.jsonl` absent → `stop:deviation` (`source_missing`).
   - NC24 GOAL.md absent → `stop:scope_change` (`source_missing`).
   - NC25 GOAL.md without a `## Decisions` heading → `stop:scope_change`.
   - NC26 an ISO row earlier the same day, before `--since` → `continue` (audit M3).
   - NC27 an ISO row after `--since` → `stop:scope_change`.
   - NC28 a gate record `ts` `...:59.034Z` (fail) with `--since ...:59Z` → `stop:gate_red` (counted as since; audit m2).
   - NC29 wave 0 with no gate log and no stores, agent named → `continue` (audit M2: wave 0 checks only the agent).
   - NC30 a1-new-feature layout: wave-plan via `--plan` outside the repo, GOAL.md ISO row written after `--since` → `stop:scope_change` (audit M5).
   - NC31 the default `<root>/.a1/phases/<slug>/PLAN.md` (no `--plan`) without a `lanes:` key and without any `### Suggested agent(s)` → `continue` (treated like `lanes: none`, audit round 2 m5); the same file passed with `--plan` → `stop:agent_unnamed`.
4. Run `bash _test-fixtures/a1-lib-units/run-tests.sh`, `bash _test-fixtures/a1-lane-split/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

RED-proof:
- (a) `ts >= since` filter removed → NC3 red.
- (b) absent gate log treated as no event → NC5 red.
- (c) a non-JSON observations line skipped → NC10 red.
- (d) the date comparison uses `>` → NC11 red.
- (e) the lane lookup returns "named" for every lane → NC14 red.
- (f) the flag ignored → NC18 red.
- (g) absent `observations.jsonl` treated as no event → NC23 red.
- (h) absent GOAL.md treated as no event → NC24 red.
- (i) string compare instead of `Date.parse` → NC28 red.
- (j) the wave-0 rule removed (wave 0 runs all checks) → NC29 red.
- (k) a default-path PLAN without `lanes:` treated like a wave-plan → NC31 red.

**Done when:**
- The suites exit 0.
- D18 caps hold for the touched files.
- 11 RED-proof lines are logged.

**Status box:**
- [x] T2.2 `_shared/lib/wave.cjs` `_shared/lib/wave-next-check.cjs` `wave next-check` `nextCheck` `_test-fixtures/a1-lib-units/cases/wave-next-check.cjs`

**Covers:** SC-4

---

## Wave 3 — Workflow text for FR-019, FR-021, FR-022 (lane flow-a, PR A)

### Task 3.1: 06-verify.md without the early Reinhard
**Goal:** a1-new-feature spawns no Reinhard before a1-pr-review, and the stage text points to 2.3d (D5).
**Actions:**
1. `skills/a1-new-feature/workflows/06-verify.md`:
   - Replace Step 0's body with a short **Step 0 — Code review happens once, in a1-pr-review**: the full-diff review runs in `a1-pr-review` `workflows/02-review.md`, once per head sha (`pr review-evidence`/`pr review-record`); a fix round makes a new head and runs it again.
   - Keep the reason in one sentence: the 2026-07 pro-orc catches came from a full-diff review, and that review still runs before any merge.
   - The text must not contain the token `a1-reinhard-reviewer` (D10), `xprov gate` or `pr-diff-xprov` (a1-pr-review :234).
2. Same file, §5 items 1-2: replace both blocks with one paragraph. **Review** and **Verify** are recorded by `a1-pr-review` `workflows/02-review.md` 2.3d after the `pr-reinhard` pass record (or on its same-head skip path), in that order. The walkthrough is all-green before the hand-off, so both conditions hold there. Phase 6 runs no `code-scope stage` call before the hand-off. The SKILL.md Lifecycle table stays as written (its Review row still holds).
   - Keep items 3-5 unchanged (Task 9.2 switches them).
   - Hand the spec id to a1-pr-review as `caller_spec_id` (one sentence in the hand-off paragraph near line 331).
3. Run `bash _test-fixtures/a1-probe/run-tests.sh` (or its runner per `suite-groups.json`), `bash _test-fixtures/a1-pr-review/run-tests.sh`, `bash _test-fixtures/a1-retro-validate/run-tests.sh` (V8, L12), `bash _test-fixtures/a1-workflow-lint/run-tests.sh` (VS, QH7), `bash _test-fixtures/a1-gates-lint/run-tests.sh`, `bash _test-fixtures/a1-gates-lint/run-wave13.sh`, `bash _test-fixtures/a1-gates-lint/run-wave14.sh`, `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` (`calls=15` unchanged) and `node _shared/a1-tools.cjs gates lint`.

RED-proof:
- (a) put the Step 0 spawn sentence back on a copy → Task 4.1 case FL3 red (logged in Task 4.1 once the case exists; here record "deferred to 4.1").

**Done when:**
- `grep -c a1-reinhard-reviewer skills/a1-new-feature/workflows/06-verify.md` prints 0.
- `git diff --quiet origin/main -- skills/a1-new-feature/SKILL.md` exits 0.
- The listed suites exit 0, and `calls=15`.

**Status box:**
- [x] T3.1 `skills/a1-new-feature/workflows/06-verify.md` `caller_spec_id`

**Covers:** SC-2

### Task 3.2: 03-draft.md and 04-submit.md without a PR confirmation
**Goal:** Draft and PR creation run without asking (D9).
**Actions:**
1. `skills/a1-pr-review/workflows/03-draft.md` 3.5: keep the draft excerpt shown to the user (an information line). Replace the question and the three answer bullets with one line: "Go to Phase 4 without asking (owner standing rule 2026-09-09, confirmed 2026-11-12; spec 027 FR-022). The review stops (BLOCKER, merge-check red) stay."
2. `skills/a1-pr-review/workflows/04-submit.md`:
   - Pre-flight: delete lines 8-9 (`User must have confirmed ...` and the `Are you sure` quote) and replace them with "Phase 3 hands over without a confirmation (FR-022)."
   - Failure modes: delete the `User aborts at confirm` bullet.
   - Keep 4.2's force-push ask and the "Push rejected: do not auto-force. Ask user." bullet.
3. Run `bash _test-fixtures/a1-pr-review/run-tests.sh` (the line-197 Samuel-section pin stays green).

RED-proof: deferred to Task 4.1 (cases FL7-FL9).

**Done when:**
- `grep -cE 'Should I create the PR|yes / no / adjust draft|Are you sure|User must have confirmed|User aborts at confirm' skills/a1-pr-review/workflows/03-draft.md skills/a1-pr-review/workflows/04-submit.md` prints `:0` for both files.
- `grep -c 'force-with-lease' skills/a1-pr-review/workflows/04-submit.md` ≥ 1.
- a1-pr-review exits 0.

**Status box:**
- [x] T3.2 `skills/a1-pr-review/workflows/03-draft.md` `skills/a1-pr-review/workflows/04-submit.md`

**Covers:** SC-5

### Task 3.3: Auto-continue text, phase-start stores and ISO decisions in 02-execute.md, 05-implement.md and a1-execute SKILL.md
**Goal:** Waves continue on `continue`; a prompt appears only inside a stop block; both event stores exist from phase start; decision rows carry ISO timestamps (D7, D8). **No fenced `a1-tools.cjs wave next-check` call in this task** (Lane decision): the command is named in prose; Task 5.1 adds the fenced blocks.
**Actions:**
1. `skills/a1-execute/workflows/02-execute.md`:
   - (a) New section **Phase start (once per phase worktree, before the per-wave loop)** with exactly this fenced block (no `a1-tools` call; D21). It creates the event stores when missing, registers the union merge for them and commits what it created or changed:
     ```bash
     P="$WORK_PATH/.a1/phases/<phase_name>"; mkdir -p "$P"; CHANGED=0
     if [ ! -e "$P/observations.jsonl" ]; then : > "$P/observations.jsonl"; CHANGED=1; fi
     if [ ! -e "$P/GOAL.md" ]; then
       cat > "$P/GOAL.md" <<'A1_GOAL_EOF'
     # Goal: <phase_goal>

     ## Decisions
     A1_GOAL_EOF
       CHANGED=1
     fi
     if ! grep -q '^## Decisions' "$P/GOAL.md"; then printf '\n## Decisions\n' >> "$P/GOAL.md"; CHANGED=1; fi
     A="$(git -C "$WORK_PATH" rev-parse --path-format=absolute --git-common-dir)/info/attributes"; mkdir -p "${A%/*}"
     for L in '.a1/phases/*/observations.jsonl merge=union' '.a1/phases/*/GOAL.md merge=union'; do grep -qxF "$L" "$A" 2>/dev/null || printf '%s\n' "$L" >> "$A"; done
     if [ "$CHANGED" -eq 1 ]; then git -C "$WORK_PATH" add -- "$P/observations.jsonl" "$P/GOAL.md" && git -C "$WORK_PATH" commit -q -m "chore(<phase_name>): event stores" -- "$P/observations.jsonl" "$P/GOAL.md"; RC=$?; if [ "$RC" -ne 0 ]; then echo "STOP: event-store commit exit=$RC"; exit "$RC"; fi; fi
     echo "event stores ready: $P"
     ```
     (In the workflow file the block is not indented; the heredoc body lines and `A1_GOAL_EOF` start at column 0.) `<phase_goal>` is substituted as one line inside the quoted heredoc, so quotes, `$(...)` and backticks stay literal (audit round 2 m3). This exact block was run on 2026-11-20 against a planted linked worktree from another cwd: rc 0, `git status --porcelain` empty, a second run made no commit, the apostrophe/`$(touch PWNED)` goal was written verbatim, and `git worktree remove` succeeded.
     Prose: `wave next-check` stops when either store is missing (owner decision 2026-11-20, "missing source = stop"); this step makes them exist and commits them, so neither the commit-landed gate nor the worktree exit meets an untracked store, and a missing store later means the run broke. Multi-lane: run it once in the phase worktree before the lane worktrees branch off; the lanes inherit the tracked stores, and the union attribute lets the lane merges keep both sides' appended lines.
   - (b) At wave dispatch (where `PRE_WAVE_HEAD` is recorded), add: run `date -u +%Y-%m-%dT%H:%M:%SZ` and keep the printed value as `<wave_start>` for this wave (shell state does not persist; it is substituted literally later).
   - (c) Wrap the PARTIAL question (line ~107) in `<!-- a1:stop -->` / `<!-- /a1:stop -->`.
   - (d) 2c: keep the summary block, but delete `Continue? [y to proceed / n to stop]` from it. Add the prose: "Run `wave next-check <phase_name> <N> --since <wave_start> --project "$WORK_PATH"` (block below; with `--checkpoint-each-wave` when the owner started the run with it)". Leave a one-line HTML comment `<!-- a1:next-check-block (Task 5.1) -->` where Task 5.1 puts the fence.
   - (e) Prose:
     - `continue` (exit 0) → start Wave N+1 at once, no question;
     - `stop:<reason>` (exit 1) → the stop block;
     - exit 2 → STOP, fix the call.
   - (f) The stop block (`<!-- a1:stop -->` … `<!-- /a1:stop -->`) holds the reason table (gate_red: fix and re-run the gate; deviation: read `observations.jsonl` (a missing file is itself the stop: recreate it per Phase start); scope_change: confirm the GOAL.md decision; a date-only row stops every wave of its day, rewrite it with an ISO timestamp to clear it; agent_unnamed: name the agent in PLAN.md; owner_requested) and the question `Continue? [y to proceed / n to stop]`.
   - (g) The mid-run-decision paragraph: GOAL.md path becomes `$WORK_PATH/.a1/phases/<phase_name>/GOAL.md` (where `wave next-check` reads it). The row format becomes `- <ISO-8601 UTC timestamp from date -u +%Y-%m-%dT%H:%M:%SZ> — <decision> — affects: <success criterion or task id>`. The create-on-demand sentence points to Phase start. After writing the row, commit it in that worktree at once: `git -C "$WORK_PATH" commit -q -m "chore(<phase_name>): decision" -- ".a1/phases/<phase_name>/GOAL.md"` (tracked since Phase start, so no `git add`). Never while an executor runs in that worktree (index lock): a decision taken during a wave is written and committed after the wave's COMPLETE report and the commit-landed gate, before `wave next-check`; its ISO token is the time of the decision (D21).
   - (h) Delete `Wait for user input before starting next wave.`
   - (i) Multi-lane: run `wave next-check` per lane with the lane's `$WORK_PATH`; a lane's last wave hands over to the lane merge, not to Wave N+1, and there only the gate/deviation/decision result counts (audit m17).
   - Keep byte-identical: the QH7 line (`if [ $RC -eq 2 ]` … `lock_timeout` … `not red`), the MH9 paragraph (`all_commands_skipped_on_host`, `takes its id out of the verdict`), the one `--slug <slug>` paragraph, every gate call line (`calls=15`).
2. `skills/a1-new-feature/workflows/05-implement.md`:
   - (a) Header lines 3-7: the skill dispatches the suggested agent; the owner can stop per wave with `--checkpoint-each-wave`.
   - (b) New **Step 1b — Event stores (every start)**: the fenced block of 02-execute (a) with one extra first line `WORK_PATH="<dir>"`, and `<spec-id>` / `<spec title>` in place of `<phase_name>` / `<phase_goal>`; every other line byte-identical (heredoc, union attribute, commit). `<dir>` is the feature worktree, the same `<dir>` the wave gates pass as `--project`. The stores ride in the feature PR (D21).
   - (c) Step 3: read `### Suggested agent(s)` for Wave N from the wave plan. Prose: before Wave 1 run `wave next-check <spec-id> 0 --since <precondition_start> --project <dir> --plan <wave-plan path>` (wave 0 checks only that Wave 1 names an agent; the preconditions above stop on their own exit codes); before Wave N+1 run it with `<N>` and `--since <wave_start>`. Leave `<!-- a1:next-check-block (Task 5.1) -->` where Task 5.1 puts the fence.
   - (d) The proposal quote and `Wait for user confirmation. Do **not** dispatch automatically.` move into a stop block used only on `stop:<reason>`.
   - (e) Line 96 `Once the user confirms (or names a different agent), spawn the agent ...` → `Spawn the suggested agent (or the agent the owner named in a stop block) via the Agent tool ...` (audit m11).
   - (f) Step 4: on dispatch, note `<wave_start>` as in 02-execute. When the agent's hand-back reports a deviation or "spec unstable", append one line `{"ts":...,"agent":"<agent>","skill":"a1-new-feature","phase":"<spec-id>","wave":<N>,"type":"deviation","severity":"major","msg":"<one sentence>"}` to `<dir>/.a1/phases/<spec-id>/observations.jsonl` (the a1-new-feature source of `deviation`, D7), then commit it at once (the agent has returned, so no executor runs): `git -C "<dir>" commit -q -m "chore(<spec-id>): observation wave <N>" -- ".a1/phases/<spec-id>/observations.jsonl"` (D21).
   - (g) Step 4, new **mid-run decision rule** (audit M5): when the owner changes a requirement during a wave, append `- <ISO-8601 UTC timestamp> — <decision> — affects: <FR or AC id>` under `## Decisions` in `<dir>/.a1/phases/<spec-id>/GOAL.md` before the next wave (the a1-new-feature source of `scope_change`), then commit it with `git -C "<dir>" commit -q -m "chore(<spec-id>): decision" -- ".a1/phases/<spec-id>/GOAL.md"`, never while the wave's agent still runs (D21); the spec's `## Clarifications` entry follows as today.
   - Keep byte-identical: line 25 (`checklist run <project-slug>/<###>-<feature-slug> --only 9,10,11 --format json --phase <spec-id>`, W13g), the QH7 line, the MH9 paragraph, every gate call line.
3. `skills/a1-execute/SKILL.md` frontmatter description: replace "with mandatory user-checkpoint between waves" with "waves continue on their own while `wave next-check` prints continue; a stop reason or `--checkpoint-each-wave` asks the owner". Line ~198 "Checkpoint per lane" → "`wave next-check` per lane".
4. Run:
   - `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` (`calls=15` unchanged);
   - `bash _test-fixtures/a1-gates-lint/run-tests.sh`, `run-wave13.sh` (W13c, W13g), `run-wave14.sh` (W14e);
   - `bash _test-fixtures/a1-workflow-lint/run-tests.sh` (no pipe tested via `$?`, VS2, QH7);
   - `bash _test-fixtures/a1-pr-merge-check/run-tests.sh` (MH9);
   - `bash _test-fixtures/a1-pr-review/run-tests.sh` (:234);
   - the a1-xprov runner(s) holding parts 06, 19 and 36;
   - `bash _test-fixtures/product-schema-v11/run.sh`;
   - `bash _test-fixtures/a1-dashboard/run-tests.sh`;
   - `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s4`.

RED-proof: deferred to Task 4.1 (cases FL4-FL6, FL11, FL12-FL17).

**Done when:**
- The listed commands exit as stated.
- `grep -c 'wave next-check' skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md` ≥ 1 each, and `grep -c 'a1-tools.cjs wave' skills/a1-execute/workflows/02-execute.md skills/a1-new-feature/workflows/05-implement.md` prints 0 each (no fenced call yet).
- `grep -c 'a1:next-check-block' ...` prints 1 for each of the two files.
- `grep -c "<<'A1_GOAL_EOF'"` and `grep -c 'merge=union'` print ≥ 1 for each of the two files, and `grep -c "printf '# Goal"` prints 0 for each (m3).

**Status box:**
- [x] T3.3 `wave next-check` `<!-- a1:stop -->` `Phase start` `Step 1b` `A1_GOAL_EOF` `merge=union` `skills/a1-execute/workflows/02-execute.md` `skills/a1-new-feature/workflows/05-implement.md` `skills/a1-execute/SKILL.md`

**Covers:** SC-4

---

## Wave 4 — Lint module for FR-019/021/022 (lane flow-a, PR A)
**Depends on:** Wave 3

### Task 4.1: `workflow-lint-flow.cjs` and module-level cases
**Goal:** The three D8-D10 rules exist and are green on the real tree and red on planted trees. The CLI hook comes in Wave 5 (import edge, Lane decision).
**Actions:**
1. Create `_shared/lib/workflow-lint-flow.cjs`, pattern `workflow-lint-verify.cjs`: no require of `workflow-lint.cjs`, fence helpers not needed (the rules read whole lines).
   - Exports `checkEarlyReview(root, isSkillsTree)`, `checkWaveCheckpoint(root, isSkillsTree)`, `checkPrConfirmation(root, isSkillsTree)`. Each returns `{checked, findings:[{file, rule, line, reason}]}`, with JSDoc `@returns` naming the fields.
   - Constants: the marker lists of D8 (incl. `Once the user confirms`) and D9, the file lists and the stop markers.
   - The `skills/` files are required when `isSkillsTree(root)`: a missing file is a finding `file missing or unreadable`, as in `checkVaultSyncSteps`.
2. Create `_test-fixtures/a1-workflow-lint/cases-flow.sh` (uses `ok`, `bad`, `REPO_ROOT`, `copySkills`; a helper `flRun <root> <isSkills>` runs `node -e` that requires `workflow-lint-flow.cjs` and passes `() => true` for a copied skills tree and `() => false` for a synthetic root (`isSkillsTree` is not exported), and prints `<checked> <rules,...>`). Cases:
   - FL1 real tree → 0 findings, checked 5.
   - FL2 a synthetic non-skills root → checked 0.
   - FL3 `Spawn a1-reinhard-reviewer` appended to 06-verify.md in a copy → `verify-early-review`.
   - FL4 `Continue? [y to proceed / n to stop]` appended outside a stop block to 02-execute.md → `wave-checkpoint`.
   - FL5 the same line inside a stop block → 0.
   - FL6 an unclosed `<!-- a1:stop -->` in 05-implement.md → `wave-checkpoint`.
   - FL7 `Should I create the PR now with gh (Phase 4)? (yes / no / adjust draft)` appended to 03-draft.md → `pr-confirmation`.
   - FL8 `> "Are you sure you want to create the PR now? (yes / no)"` appended to 04-submit.md → `pr-confirmation`.
   - FL9 the force-push lines present (real 04-submit.md) → 0, and `force-with-lease` is present (grep).
   - FL10 04-submit.md deleted in a copy → finding `file missing`.
   - FL11 `Once the user confirms (or names a different agent), spawn the agent` appended outside a stop block to 05-implement.md → `wave-checkpoint`.
   - **Event-store runs (D21, audit round 2 M1).** A helper `flStoreBlock <file> <heading-substring>` prints the first fenced bash block after the first line containing the heading substring (`Phase start` in 02-execute.md, `Step 1b` in 05-implement.md) of the **real** file; placeholders are replaced with node `split/join`, never `sed`. The planted repo has one commit on `main` and a linked worktree `wt` on branch `feat`. Every git call of the cases and of the block itself runs with `HOME` = a temp dir and `GIT_CONFIG_GLOBAL=<temp>/gitconfig` holding `user.name=fx`, `user.email=fx@example.invalid`, `commit.gpgsign=false`, `core.hooksPath=/dev/null`. The block runs with `bash` from a third temp dir as cwd.
   - FL12 02-execute block (`<phase_name>` = `ph`, `<phase_goal>` = `it's a "goal" with $(touch PWNED)`, `WORK_PATH` exported) → exit 0; `git -C wt status --porcelain --untracked-files=all` prints nothing; `git -C wt show --name-only --format= HEAD` lists `.a1/phases/ph/GOAL.md` and `.a1/phases/ph/observations.jsonl`; the first GOAL.md line equals `# Goal: it's a "goal" with $(touch PWNED)`; no `PWNED` file exists in the cwd, the worktree or the temp root.
   - FL13 the same block a second time → `git -C wt rev-list --count HEAD` unchanged, status still empty.
   - FL14 05-implement Step 1b block (`<dir>` = the worktree path, `<spec-id>` = `fx-spec`, `<spec title>` = `Rob's "title"`) → the FL12 assertions for `.a1/phases/fx-spec/`.
   - FL15 after FL12: branches `la` and `lb` from `feat` each append one different line to `observations.jsonl` and one different `- <ISO> — x — affects: y` row to GOAL.md and commit; `git merge --no-edit la` and then `lb` into `feat` both exit 0, and both lines and both rows are present.
   - FL16 after FL12: `git -C <repo> worktree remove <wt>` (no `--force`) exits 0.
   - FL17 text: the 02-execute mid-run-decision paragraph and the 05-implement Step 4 (f) and (g) paragraphs each hold a `git -C` … `commit` … `-- ` command naming the store file that paragraph appends to.
3. Append `. "$(dirname "${BASH_SOURCE[0]}")/cases-flow.sh"` after the existing source lines in `_test-fixtures/a1-workflow-lint/run-tests.sh`, and `caseFL1; ...; caseFL17` as a new call line after `caseQH...`.
4. Run `bash _test-fixtures/a1-workflow-lint/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

RED-proof:
- (a) the stop-block tracking removed (every marker flags) → FL5 red.
- (b) `Are you sure` dropped from the D9 list → FL8 red.
- (c) the 06-verify file dropped from `checkEarlyReview` → FL3 red.
- (d) the Task 3.1 deferred mutation: the Step 0 spawn sentence restored in 06-verify.md on a copy → FL3 red on that copy.
- (e) the Task 3.2 deferred mutation: `yes / no / adjust draft` restored → FL7-equivalent red on the real-file copy.
- (f) the Task 3.3 deferred mutation: `Wait for user input before starting next wave.` restored outside a stop block → FL4-equivalent red.
- (g) `Once the user confirms` dropped from the D8 list → FL11 red.
- (h) the commit line removed from the 02-execute Phase-start block on a copy → FL12 red (plan-time measurement: 2 untracked lines) and FL16 red (`contains modified or untracked files`).
- (i) the `merge=union` loop removed from the block on a copy → FL15 red (plan-time measurement: the second merge exits 1).
- (j) the heredoc replaced by `printf '# Goal: %s\n\n## Decisions\n' '<phase_goal>'` on a copy → FL12 red (the apostrophe ends the quote).
- (k) the commit command dropped from 05-implement Step 4 (g) on a copy → FL17 red.

**Done when:**
- a1-workflow-lint exits 0, and every pre-existing case prints PASS.
- `wc -l < _shared/lib/workflow-lint-flow.cjs` ≤ 250.
- 11 RED-proof lines are logged in `STATUS-flow-a.md`.

**Status box:**
- [x] T4.1 `_shared/lib/workflow-lint-flow.cjs` `checkWaveCheckpoint` `checkPrConfirmation` `checkEarlyReview` `_test-fixtures/a1-workflow-lint/cases-flow.sh`

**Covers:** SC-2, SC-4, SC-5

---

## Wave 5 — PR A integration, review, merge-check with SC-003 measurement, merge (sequential after lanes)
**Depends on:** Wave 2, Wave 4

### Task 5.1: Fenced `wave next-check` blocks, lint hook, ADR note, full run
**Goal:** PR A is complete and green in one tree.
**Actions:**
1. Merge lanes cli-a and flow-a into the PR A branch (a1-execute lane merge; no conflicts are possible by the write sets). Run `node _shared/a1-tools.cjs lane-split check --plan .a1/phases/027-lean-pipeline-s4/PLAN.md --imports . --phase 027-lean-pipeline-s4` once more and record the output.
2. Replace each `<!-- a1:next-check-block (Task 5.1) -->` comment with the fenced block (the merged tree now has the `wave` group and its help):
   - `skills/a1-execute/workflows/02-execute.md` 2c: `NEXT="$(node <repo>/_shared/a1-tools.cjs wave next-check <phase_name> <N> --since <wave_start> --project "$WORK_PATH")"; RC=$?` plus `echo "wave next-check: $NEXT (exit $RC)"`.
   - `skills/a1-new-feature/workflows/05-implement.md` Step 3: `NEXT="$(node <repo>/_shared/a1-tools.cjs wave next-check <spec-id> <N> --since <wave_start> --project <dir> --plan <wave-plan path>)"; RC=$?` plus the same echo (prose already says wave 0 uses `0` and `<precondition_start>`).
3. `_shared/lib/workflow-lint.cjs` `cmdWorkflowLint`:
   - after the `verifyLint` lines, add `const flowLint = require('./workflow-lint-flow.cjs');` and the three calls with `isSkillsTree` (one compact line);
   - concat their findings;
   - add `flow_checked: early.checked + checkpoint.checked + prConfirm.checked` to `out`.
4. Create `_test-fixtures/a1-workflow-lint/cases-flow-cli.sh`:
   - FC1 `workflow lint --root <real copy>` exits 0, and `flow_checked` is 5;
   - FC2 a planted `Continue? [y` in a copy exits 1 and names `wave-checkpoint` in stderr;
   - FC3 the JSON still carries `vault_sync_checked`, `verify_scope_checked`, `reuse_ban_checked`, `quiet_host_checked` (additive change).

   Source line and call line as in Task 4.1.
5. `docs/adr/2026-10-14-gate-invoke-and-log.md`: append a dated section `## 2026-11-20 — Recorder invoke on a prompt row (spec 027 FR-019)`: `pr-reinhard` keeps class `prompt` and gets the invoke `pr review-record`, `gates lint` exempts exactly that pair (`PROMPT_RECORDERS`), and the `reused`/`input_hash` extras are written by FR-020 reuse. Also amend the rule list sentence (line 21) with "`prompt_names_command` (except the rows in `PROMPT_RECORDERS`)".
   - The repo is `external_review: denied`, so `design-review-xprov` answers `not_applicable` (2b-d prints the info line and continues).
6. Run, recording outputs in `STATUS.md`:
   - `node _shared/a1-tools.cjs gates lint` → 0 (no `--phase`);
   - `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s4` → 0;
   - `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` → `calls=15` (`wave next-check` is not in its CMD_RE);
   - `bash _test-fixtures/a1-gates-lint/run-wave13.sh` and `run-wave14.sh` → 0 (W13c/W14e resolve the two new fenced calls);
   - the caps loop of V14;
   - `git diff --quiet origin/main -- .a1/verify.json _test-fixtures/suite-groups.json .github/` → 0;
   - `git diff --quiet origin/main -- _shared/lib/checklist.cjs skills/a1-new-feature/SKILL.md` → 0;
   - `bash bin/run-suites.sh --check-groups` → 0;
   - `bash bin/run-suites.sh` → 0 (reds per Execution location).

RED-proof:
- (a) the hook line removed → FC2 red.
- (b) `--since` renamed `--from` on the 02-execute next-check line on a copy → `check-callsite-flags.cjs` rc=1 `wave next-check: flag --from is not accepted`.

**Done when:**
- Every command of action 6 exits as stated.
- 2 RED-proof lines are logged.
- Every status box of Tasks 1.1-4.1 is `[x]`, and `node _shared/a1-tools.cjs phantom check .a1/phases/027-lean-pipeline-s4/PLAN.md` reports no phantom for them.

**Status box:**
- [x] T5.1 `flow_checked` `a1-tools.cjs wave next-check` `_test-fixtures/a1-workflow-lint/cases-flow-cli.sh` ADR note PR A

**Covers:** SC-4, SC-6

### Task 5.2: [ORCHESTRATOR] PR A review, merge-check (SC-003), merge, scope release with the measurement file
**Goal:** PR A is reviewed, measured and merged; the measurement lands on `main` with the scope release; B can start.
**Actions:**
1. Run `a1-specforge:a1-pr-review` on the PR A branch (first push per `_shared/push-cadence.md`).
   - For steps 2.1b/2.3a/2.3d follow the PR A worktree's `skills/a1-pr-review/workflows/02-review.md` explicitly with `<repo>` = the PR A worktree (D1 self-hosting: the installed 1.17.0 copy lacks them). Record the `pr review-record` exit in the PR text. `caller_spec_id` is `none` here (a1-execute phase), so 2.3d prints SKIP.
   - 2.2b `xprov scope` decides Samuel. When it is triggered, Samuel's brief names D6 (reuse can skip a gate: fail-closed rules, tool closure, head requirement) and D4 (recorder exit codes).
   - Reinhard's brief adds the same D6 points and D7's literal fail-closed sources with the phase-start stores.
2. Fix every BLOCKER and MAJOR (fix rounds per 02-review 2.6b). Re-run the touched suites and Task 5.1 action 6 after the fixes.
3. Wait for CI `test` green on the PR head.
4. **Merge-check, once, on the long path** (D20), from the PR A worktree on a clean tree at the pushed head. Raw outputs go to a directory outside every tree that survives the worktree exit:
   ```bash
   M="$(git rev-parse --path-format=absolute --git-common-dir)/a1-s4-sc003"; mkdir -p "$M"
   node -e 'const os=require("os");console.log(JSON.stringify({load5_start:os.loadavg()[1],cpus:os.cpus().length,t0:Date.now()}))' > "$M/start.json"
   node /home/rob/claude-projects/a1-specforge/_shared/a1-tools.cjs pr merge-check --pr <A> --no-ci-evidence --phase pr-<A> > "$M/mc.json"; RC=$?
   node -e 'const os=require("os");console.log(JSON.stringify({load5_end:os.loadavg()[1],t1:Date.now()}))' > "$M/end.json"; echo "merge-check rc=$RC dir=$M"
   ```
   - Nothing is committed on the PR A branch after this run: the merge pins `--match-head-commit <head_sha>` from this stdout.
   - rc≠0: fix the cause; then one more run, which is the only allowed second run (a new head).
   - SC-003 itself (≤ 15 min) is reported, not a merge condition for PR A. Over 15 min: name it in the PR text as an SC-003 finding for the owner, with the load values (`host_busy=true` → re-run once on a quiet host per 05-merge.md 5.3 before claiming).
5. Merge per 05-merge.md 5.4 (`gh pr merge <A> --squash --match-head-commit <head_sha>`), verify `gh pr view <A> --json state,mergedAt` = MERGED, sync `main` (push-cadence P3), close out per 05-merge items 1-4 (retros, run records, worktree exit, origin cleanup).
6. **Scope-release chore PR** (primary checkout, chore branch `chore/027-lean-pipeline-s4a-finish`, precedent #106), holding two changes:
   - `code-scope release --by 027-lean-pipeline` (`.a1/reservations.json`);
   - `.a1/phases/027-lean-pipeline-s4/SC003-MERGE-CHECK.json` written from `$M/*.json` with `{pr, head_sha, base_sha, date, host, node, rc, wall_ms: t1-t0, suites: {verdict, runner_source, duration_ms, lock_wait_ms, base_run}, ci_evidence_used, host_load: {load5_start, load5_end, cpus, host_busy}, baseline_total_ms: 2990052, target_ms: 900000}`. Copy each field from the real report; a field the report does not carry is written as `"absent"`, never guessed.

   Merge it, verify MERGED, sync `main` per P3.
7. **PR text of A names:**
   - D2 (scope `pr-<n>`, an FR-019 reading);
   - D5 (stages at 2.3d, also on the skip path);
   - D6 (the tool closure, the roadmap input, the head requirement for code-reading gates, the lane-split inputs as an FR-020 narrowing, per-checkout reuse, the run-record follow-up);
   - D7 (the owner decision applied literally, the phase-start stores, the wave-0 rule, ISO rows) and D21 (the stores are committed, so a1-new-feature PRs carry `.a1/phases/<spec-id>/GOAL.md` and `observations.jsonl`; the local `merge=union` attribute);
   - D8/D9 marker lists;
   - the import-edge lane decision and the fenced next-check blocks in Wave 5;
   - the SC-003 numbers next to BASELINE.json (they land with the release chore PR).

**Done when:**
- `gh pr view <A> --json state` prints `MERGED`.
- The release chore PR is merged; on `main`, `.a1/phases/027-lean-pipeline-s4/SC003-MERGE-CHECK.json` exists and `node _shared/a1-tools.cjs code-scope list` shows no `027-lean-pipeline` reservation.

**Status box:**
- [ ] T5.2 `SC003-MERGE-CHECK.json` `pr merge-check` `--no-ci-evidence` PR A merged release chore PR

**Covers:** SC-6

---

## Wave 6 — `wave checks`, `feature plan-steps` and PR B help (sequential, PR B)
**Depends on:** Wave 5

**Task 6.0 [ORCHESTRATOR] (before 6.1/6.2):** pull `main`.
1. Claim the PR B scope (`code-scope claim --by 027-lean-pipeline --scope <PR B paths>`) on a chore branch and merge it. Its merge commit is on `main`.
2. Prepare `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s4b/` from `main` via `a1-specforge:a1-worktree`.
3. Check `git -C <worktree> merge-base --is-ancestor <PR A squash sha> origin/main` exits 0 (audit m3).

### Task 6.1: `wave checks`
**Goal:** FR-024's bundled per-wave command exists (D11).
**Actions:**
1. Create `_shared/lib/wave-checks.cjs` as D11. Exports `CHILD_GATES`, `cmdWaveChecks(rest)` and `runChecks(opts)` (JSDoc `@returns {{ok: boolean, checks: Array<{gate: string, argv: string[], exit: number|null, skipped?: string}>}}`). It resolves the facade as `path.join(__dirname, '..', 'a1-tools.cjs')`, spawns each child with `cwd` = the project dir, passes `process.env` through unchanged (no token handling), and exits via `emitExit`.
2. `_shared/lib/wave.cjs`: `checks` → `require('./wave-checks.cjs').cmdWaveChecks(rest)`; extend the usage text.
3. Create `_test-fixtures/a1-lib-units/cases/wave-checks.cjs` (planted repo with a base commit and a wave commit; `.a1/fidelity.json` copied from `_test-fixtures/a1-test-fidelity/` where a test-like file is needed). The command runs with cwd = a different temp dir than the project. Cases:
   - WC1 all green (no SQL, no test change, `--migrations` absent) → exit 0, three entries, schema-check `skipped: no_migrations`, and two new log lines (`gate-0.7-realpath`, `test-fidelity`) with `scope` = slug in the **project's** log, none in the cwd's;
   - WC2 the wave adds a `.sql` file with `SELECT` and no `.a1/realpath-evidence.md` → exit 1, `gate-0.7-realpath` exit 1, `test-fidelity` still run (entry with an exit code);
   - WC3 the wave adds a skipped test (`it.skip`) → exit 1, realpath green, fidelity exit 1;
   - WC4 `--migrations <dir>` with a migration missing RLS → exit 1, schema-check exit 1, all three reported, and the `gate-0.6-schema` line is in the project's log;
   - WC5 `--phase other` with slug `s` → exit 2;
   - WC6 no `--diff-base` → exit 2;
   - WC7 `--diff-base nope` → exit 2 (a child exit 2 propagates), all three still reported.
4. Run `bash _test-fixtures/a1-lib-units/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

RED-proof:
- (a) stop after the first failing child → WC2 red (fidelity entry missing).
- (b) the exit computed from the last child only → WC2 red.
- (c) `--phase` not passed to children → WC1 red (log lines in `_unscoped`).
- (d) children spawned without `cwd` → WC4 red (schema line in the cwd's log).

**Done when:**
- The suites exit 0.
- `wc -l < _shared/lib/wave-checks.cjs` ≤ 200.
- 4 RED-proof lines are logged.

**Status box:**
- [x] T6.1 `_shared/lib/wave-checks.cjs` `wave checks` `runChecks` `CHILD_GATES` `_test-fixtures/a1-lib-units/cases/wave-checks.cjs`

**Covers:** SC-8

### Task 6.2: `feature plan-steps`, the `feature` group and the PR B help
**Goal:** FR-025's step list exists as data (D15), and `--help` documents all three PR B commands before Waves 7 and 9 add their fenced calls.
**Actions:**
1. Create `_shared/lib/feature.cjs`: `cmdFeature(sub, rest)` dispatches `plan-steps` → `require('./feature-plan-steps.cjs').cmdPlanSteps(rest)`. Any other sub → exit 2 with usage. Task 8.2 adds `close`.
2. Create `_shared/lib/feature-plan-steps.cjs` as D15 (incl. the four conditional spawns with `when`). Every `gate` value must be a registry id: at module load nothing is checked; the test checks it against `gate-ids.cjs` registry parsing. Exports `STEPS`, `stepsFor(size)`, `cmdPlanSteps(rest)` (JSDoc `@returns` on `stepsFor`: `Array<{id, kind, agent?, gate?, model?, phase, when?: string, resume?: string[]}>`). Exits via `emitExit`.
3. `_shared/a1-tools.cjs` (+1 line): `} else if (group === 'feature') { require(path.join(__dirname, 'lib', 'feature.cjs')).cmdFeature(sub, rest); return;`. Add `"feature"` to the usage list and `wave checks, feature plan-steps, feature close` to the slice 4 sentence.
4. `_shared/lib/help-lean.cjs`: add three usage blocks with explicit flags (B1, help ships before the first fenced call):
   - `  a1-tools wave checks <slug> <wave> --diff-base <ref> [--project <dir>] [--migrations <dir>] [--phase <slug>]` (D11: children, `cwd`, exits);
   - `  a1-tools feature plan-steps <spec-path>` (D15: fixed and conditional steps, `when`);
   - `  a1-tools feature close --by <spec-id> --pr <n> [--repo <dir>] [--spec <path>] [--worktree <id>]` and a second line `  a1-tools feature close --cleanup-only [--repo <dir>]` (D16: step order, every scope recorded, `reservations_commit_pending`, rule (b) scope, the `A1_GH_BIN` seam). The module arrives in Task 8.2; the first fenced call in Task 9.2.
   - Extend `cases/help-lean.cjs` with the four lines.
5. Create `_test-fixtures/a1-lib-units/cases/feature-plan-steps.cjs` (planted specs with `size: S|M|L`, one without size). Cases:
   - PS1 S unconditional spawns < M unconditional spawns;
   - PS2 S has no step with agent `a1-vincente-vibe-optimizer`, `a1-diana-docs` or `a1-tobi-tester`, and no Reinhard step whose phase is before `pr-review`;
   - PS3 S has exactly one Rene spawn, phase `1-4`, model `opus`, `resume` equal to `["gate-c-ac-dryrun","wave-plan"]` (audit round 2 M2: the S plan writer);
   - PS4 every M gate id is in S;
   - PS5 every S step id except `rene-discover-specify-clarify` is in M;
   - PS6 M list equals L list;
   - PS7 every `gate` value is a row id of the real `_shared/gates-registry.md`;
   - PS8 the spec without size → exit 1 `no_size`;
   - PS9 no argument → exit 2;
   - PS10 `pr-review-reinhard` is in S and M;
   - PS11 every step with `when` carries a string after `stepsFor` (S `uwe-ux` → `on_request`, M → `ui_surface`); both Samuel steps are in S (security keep-list);
   - PS12 `tobi-audit` is in M with `when: on_request`.
6. Run `bash _test-fixtures/a1-lib-units/run-tests.sh`, `bash _test-fixtures/a1-exit2-audit/run-tests.sh`, `bash _test-fixtures/a1-cli-output/run-tests.sh`, `bash _test-fixtures/a1-gates-lint/run-wave13.sh` and `run-wave14.sh`.

RED-proof:
- (a) `vincente-wave-plan` given `sizes` all → PS2 red.
- (b) the merged Rene model set to `sonnet` → PS3 red.
- (c) `gate-c-ac-dryrun` removed from S → PS4 red.
- (d) a gate id typo (`scope-claims`) → PS7 red.
- (e) `tobi-audit` given size S → PS2 red.
- (f) `feature close` removed from `LEAN_HELP` → help-lean red.

**Done when:**
- The suites exit 0.
- `wc -l < _shared/a1-tools.cjs` ≤ 787.
- 6 RED-proof lines are logged.

**Status box:**
- [x] T6.2 `_shared/lib/feature.cjs` `_shared/lib/feature-plan-steps.cjs` `feature plan-steps` `stepsFor` `help-lean.cjs` `_test-fixtures/a1-lib-units/cases/feature-plan-steps.cjs`

**Covers:** SC-9

---

## Wave 7 — `wave checks` wiring and parallel groups (sequential, PR B)
**Depends on:** Wave 6

### Task 7.1: Workflows call `wave checks`; bundle alias; W11 pins
**Goal:** The per-wave checks run in one call, and the wiring lints stay load-bearing (D11, D12).
**Actions:**
1. `skills/a1-execute/workflows/02-execute.md` 2b-g: replace the three fenced blocks (realpath-check, schema-check, test-fidelity) with ONE block:
   `node <repo>/_shared/a1-tools.cjs wave checks <phase_name> <N> --diff-base "$PRE_WAVE_HEAD" --project "$WORK_PATH" --phase <phase_name>; RC=$?`, then `echo "wave checks exit=$RC"` and `if [ $RC -ne 0 ]; then echo "STOP: wave checks red (checks[] above: gate, exit)"; fi`.
   - Prose: on a migration wave add `--migrations "$WORK_PATH/<migrations dir>"` before `--phase`.
   - Keep the test-fidelity exit-1 paragraph (disposition rule) and name the three registry ids it runs.
   - The `verify run` block, the QH7 line and the MH9 paragraph stay.
2. `skills/a1-new-feature/workflows/05-implement.md`: the same for Gates 0.6, 0.7 and 0.8 → one block **Gates 0.6-0.8 — `wave checks`** with `--diff-base <wave-start-ref> --project <dir> --phase <spec-id>`. Keep each gate's one-paragraph rationale (shortened, no block). Line 25 (W13g), the QH7 line and the MH9 paragraph stay byte-identical.
3. `_shared/lib/gates-lint.cjs`: `BUNDLES` and `findCalls` as D12.
4. `_test-fixtures/a1-gates-lint/check-wave11-callsites.cjs`:
   - FLAGS adds `'wave checks': ['diff-base','project','migrations','phase']`;
   - `CMD_RE` adds `wave\s+checks`;
   - FILES for `02-execute.md` and `05-implement.md` become `{ 'wave checks': 1, 'verify run': 1 }`.
5. `_test-fixtures/a1-gates-lint/run-tests.sh`, listed pin changes (each with its red run logged):
   - W11a `calls=15` → `calls=11` (red run: the old pin on the new tree prints `calls=11`);
   - W11b mutate `(wave checks [^\n]*) --phase <spec-id>` in 05-implement.md → expect `missing --phase <spec-id>`;
   - W11c mutate `--diff-base "$PRE_WAVE_HEAD"` → `--base "$PRE_WAVE_HEAD"` on the `wave checks` line of 02-execute.md → expect `unknown flag --base` (audit m1: the literal `wave checks --diff-base` does not occur in the planned line);
   - W11e remove the `wave checks` line in 02-execute.md → expect `02-execute.md: wave checks expected 1 call(s), found 0`.

   W11d and W11f stay byte-unchanged (W11f: the bundle keeps the 6 wired entries). Update the measured-red comment block above W11 with the date and the new mutations.
6. Create `_test-fixtures/a1-gates-lint/cases-bundle.sh`:
   - BU1 the real tree: `gates lint` `wired` holds `test-fidelity@a1-execute` via a `wave checks` line;
   - BU2 a copy with the `wave checks` line removed from 02-execute.md → `unwired` for `gate-0.7-realpath`, `gate-0.6-schema` and `test-fidelity` at a1-execute;
   - BU3 a copy with `--phase` removed from the `wave checks` line → `call_without_phase` for those gates when a1-execute wires `retro validate --gate-log` (assert the measured state, as in PR5);
   - BU4 `require('gates-lint.cjs').BUNDLES['wave checks']` (export `BUNDLES`) deep-equals `require('wave-checks.cjs').CHILD_GATES` (audit m15).

   Source line added.
7. Run `bash _test-fixtures/a1-gates-lint/run-tests.sh`, `run-wave13.sh`, `run-wave14.sh` (W13c/W14e resolve `wave checks` against the Wave 6 help), `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` (`calls=11`), `node _shared/a1-tools.cjs gates lint`, `bash _test-fixtures/a1-workflow-lint/run-tests.sh` (`verify-scope` still sees one per-wave `verify run` with `--affected`; QH7), `bash _test-fixtures/a1-pr-merge-check/run-tests.sh` (MH9), and the a1-xprov part-36 runner, `product-schema-v11`, `a1-dashboard`.

RED-proof:
- (a) `BUNDLES` lookup removed from `findCalls` → BU1 and W11f red.
- (b) the bundle list without `test-fidelity` → BU2 red for that id, and BU4 red.
- (c) each W11 pin's red run as named in action 5 (4 lines).

**Done when:**
- All listed commands exit 0 with `calls=11`.
- 6 RED-proof lines are logged.

**Status box:**
- [x] T7.1 `BUNDLES` `wave checks` `check-wave11-callsites.cjs` `_test-fixtures/a1-gates-lint/cases-bundle.sh`

**Covers:** SC-8

### Task 7.2: Parallel group Rico+Marco, background vault mirror, lint module
**Goal:** FR-023's markers, the 02-map input change and the lint (D14).
**Actions:**
1. `skills/a1-plan/workflows/01-research.md`:
   - add `<!-- a1:parallel group=research-map -->` above the prompt template;
   - add one paragraph: Rico and Marco form group `research-map`; spawn both Agent calls in the same turn; Marco's prompt is in `02-map.md`;
   - change "before Marco and Pablo run" to "before Pablo runs" (`_shared/agent-lessons.md#rico-decisions-needed` already says "before the planner is spawned"; no edit there).
2. `skills/a1-plan/workflows/02-map.md`:
   - add the same marker;
   - `files_to_read` becomes `- ./CLAUDE.md (if exists)` and `- <spec_path> (if provided by user)`; keep `**Task context:** <phase_goal>`;
   - note that Pablo still reads RESEARCH.md and MAP.md.
3. `skills/a1-plan/SKILL.md` routing line 93: `Run Phase 1 and 2 together (parallel group research-map, one turn), then 3 → 4 → 4b in sequence`. The table rows stay.
4. `skills/a1-plan/workflows/04-audit.md`: add the background form of D14 exactly as measured, with `<!-- a1:background id=vault-mirror join=no -->` above the fence. Prose: it runs in the background before 04b; 04b does not wait for it; its warnings appear in the log file named on stdout. The one `--slug <slug>` paragraph and the one `retro validate` block (L12) stay.
5. Create `_shared/lib/workflow-lint-parallel.cjs` (rules `parallel-group`, `background-start` per D14; exports `checkParallelGroups(root, isSkillsTree)`, `checkBackgroundMarkers(root, isSkillsTree)`, with JSDoc `@returns`).
   - Hook in `_shared/lib/workflow-lint.cjs`: one `require` line plus one compact call line; output keys `parallel_checked`, `background_checked`.
6. Create `_test-fixtures/a1-workflow-lint/cases-parallel.sh`:
   - PG1 real tree → 0 parallel findings, `parallel_checked` ≥ 2, `background_checked` ≥ 1;
   - PG2 the marker removed from 02-map.md in a copy → `parallel-group` (single member);
   - PG3 `- .a1/phases/<phase_name>/RESEARCH.md` re-added to 02-map.md's `files_to_read` → `parallel-group` (dependent member);
   - PG4 the 04-audit fence's trailing `&` removed → `background-start`;
   - PG5 a planted `join=yes` marker with no join → `background-start`;
   - PG6 a planted join marker without background → `background-start`;
   - PG7 a third member in another file with an independent input → 0 findings.

   Source and call lines added.
7. Run `bash _test-fixtures/a1-workflow-lint/run-tests.sh`, `bash _test-fixtures/a1-dashboard/run-tests.sh` (05.24-05.27, 05.45/05.46 green), `bash _test-fixtures/a1-retro-validate/run-tests.sh` (L12), the a1-xprov part-06 runner, and `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s4`.

RED-proof:
- (a) the single-member check removed → PG2 red.
- (b) the dependent check removed → PG3 red.
- (c) the `&` test removed → PG4 red.
- (d) the dashboard pin: the inner `dashboard build` line moved one line down on a copy → a1-dashboard 05.26 red (proves the form is pinned, not just tolerated).

**Done when:**
- The listed commands exit 0.
- `grep -c RESEARCH.md skills/a1-plan/workflows/02-map.md` prints 0.
- `grep -rc 'a1:parallel group=research-map' skills/a1-plan/workflows` sums to 2.
- 4 RED-proof lines are logged.

**Status box:**
- [x] T7.2 `a1:parallel group=research-map` `_shared/lib/workflow-lint-parallel.cjs` `parallel_checked` `_test-fixtures/a1-workflow-lint/cases-parallel.sh`

**Covers:** SC-7

---

## Wave 8 — Background verify and `feature close` (sequential, PR B)
**Depends on:** Wave 7

### Task 8.1: Background `verify run` in both Verify workflows; Victor's input; VS3 pin
**Goal:** `verify run` runs while Victor works, Victor gets its report path, the join is explicit, and the verify-scope pins stay load-bearing (D13).
**Actions:**
1. `skills/a1-execute/workflows/03-verify.md`: before the Victor spawn add **Step 0.2 — Start `verify run` in the background**: `<!-- a1:background id=verify-bg join=yes -->` plus a fence with the D13 directory setup (`--path-format=absolute`) and the start line, ending with `echo "verify_report=$VBG/report.json verify_rc=$VBG/rc"`.
   - Victor's brief: add `verify_report:` and `verify_rc:` lines.
   - In "After Victor returns": add `<!-- a1:join id=verify-bg -->` plus the join fence (D13), before the existing `verify run --out` block. That block, `verify check` (`VERIFICATION.md; CHECK_RC=$?`, W13f), the `lock_timeout` text (QH7), `xprov_not_applicable` (P13), the `--slug <slug>` paragraph and the `retro validate` block stay byte-unchanged.
2. `skills/a1-new-feature/workflows/06-verify.md`: the same in Step 0.6. The background start goes before the walkthrough and before any agent spawn (Diana, Victor if used); the join goes before the existing `verify run --out` line. The a1-probe D1/D1b lines, `lock_timeout` and the `retro validate` block stay.
3. `agents/a1-victor-verifier.md`: before its `verify run --out` block add the D13 wait rule as prose plus a fence:
   `i=0; while [ ! -f "<verify_rc>" ] && [ $i -lt 240 ]; do sleep 15; i=$((i+1)); done; [ -f "<verify_rc>" ] || echo "WARN: background verify not finished after 60 min, running verify run directly"`
   Only when the brief names `verify_rc`. The existing `verify run`/`verify check` lines stay byte-unchanged.
4. `check-wave11-callsites.cjs` FILES: `03-verify.md` and `06-verify.md` `{ 'verify run': 2, 'verify check': 1 }`. `run-tests.sh` W11a `calls=11` → `calls=13`, with a red run: the old pin on the new tree prints `calls=13`.
5. **VS3 pin change** (`_test-fixtures/a1-workflow-lint/cases-verify-scope.sh` lines 52-53, the 03-verify.md and 06-verify.md rows): the sed address `'/a1-tools.cjs verify run/s/verify run/verify run --affected/'` becomes `'/a1-tools.cjs verify run.*--out/s/verify run/verify run --affected/'` (it targets the foreground `--out` line, which both files keep). The Victor row (line 54) stays. Red runs to log:
   - the old VS3 on the new tree → `bad "VS3 03-verify.md ... sum='5 2 2 0 ...'"` (measured on a planted tree 2026-11-20: 2 findings);
   - the new VS3 with the foreground `--out` line removed on a copy → red (0 findings).
6. Create `_test-fixtures/a1-workflow-lint/cases-verify-bg.sh` (uses `vsOneFinding`, `copyFull` of `cases-verify-scope.sh`; source it after that file):
   - VB1 `vsOneFinding VB1 skills/a1-execute/workflows/03-verify.md '/a1-tools.cjs verify run.*VBG/s/verify run/verify run --affected/' 'Verify-step verify run with --affected'` (the background line is still under the rule);
   - VB2 the same for 06-verify.md.

   Source line and call line added.
7. Create `_test-fixtures/a1-verify/cases-bgverify.sh` (suite helpers `vrun`, `mk_workdir`; private lock per Execution location):
   - BV1 a one-command green project: run the D13 start line (copied byte-for-byte from 03-verify.md via `sed` extraction of the fence, placeholders replaced), then the join loop, then `verify run --out <tmp>/VERIFICATION.md` → exit 0, its stdout `cache` is `hit`, and the `$VBG/rc` file holds `0`;
   - BV2 a red project → the rc file holds `1`, and the `--out` run exits 1;
   - BV3 a `.a1/phases/x/VERIFICATION.md` written between the background run and `--out` (as Victor does) still gives `cache` `hit`;
   - BV4 the background process killed (own PID from `$VBG/pid`) before it writes `rc` → the join prints `background verify died` within 30 s (bounded);
   - BV5 the start fence run from a cwd outside the project (a different temp repo) → `$VBG` is absolute and inside the project's git common dir; `report.json`, `rc`, `pid` exist there and nothing under the cwd (audit M6).

   Source line added.
8. Run:
   - `bash _test-fixtures/a1-verify/run-tests.sh`;
   - `bash _test-fixtures/a1-workflow-lint/run-tests.sh` (VS1-VS3, VB1-VB2, `quiet-host-poll`, QH7, `background-start`);
   - `bash _test-fixtures/a1-gates-lint/run-tests.sh` (`calls=13`), `run-wave13.sh` (W13c, W13f), `run-wave14.sh`;
   - `bash _test-fixtures/a1-probe/run-tests.sh`, `bash _test-fixtures/a1-retro-validate/run-tests.sh` (V8, L12), `bash _test-fixtures/a1-pr-review/run-tests.sh` (:234), the a1-xprov part-12 runner (P13), `bash _test-fixtures/a1-dashboard/run-tests.sh`.

RED-proof:
- (a) `--affected` added to the background line on a copy → a1-workflow-lint VB1 red (2 findings or 1 with the wrong file).
- (b) the join marker removed → `background-start` red.
- (c) `RC=$?` removed from the background line → W11a red (`exit code not captured`).
- (d) BV1 with `--no-cache` on the foreground line → BV1 red (`cache` `off`).
- (e) `--path-format=absolute` dropped from the start fence → BV5 red.
- (f) VS3 old pin on the new tree (action 5).
- (g) VS3 new pin with the foreground line removed (action 5).
- (h) W11a `calls=11` on the new tree (action 4).

**Done when:**
- The listed suites exit 0, with `calls=13`.
- `git diff origin/main -- _test-fixtures/a1-workflow-lint/cases-verify-scope.sh` shows exactly the two sed-address changes.
- 8 RED-proof lines are logged.

**Status box:**
- [x] T8.1 `a1:background id=verify-bg` `a1:join id=verify-bg` `verify_rc` `agents/a1-victor-verifier.md` `_test-fixtures/a1-verify/cases-bgverify.sh` `_test-fixtures/a1-workflow-lint/cases-verify-bg.sh`

**Covers:** SC-8

### Task 8.2: `feature close`
**Goal:** FR-026's idempotent close command exists with the D16 safety rules.
**Actions:**
1. Create `_shared/lib/feature-close.cjs` as D16. One function per step (`checkPr`, `checkRemote`, `findWorktree`, `recordRuns`, `exitWorktree`, `advanceStages`, `releaseScope`, `closeSpec`, `sweepBranches`, `pendingSharedState`), each < 50 lines.
   - CLI children via `spawnSync(process.execPath, [facade, ...], {cwd: repo, encoding: 'utf8'})`; git via `gitSafe`; gh via `spawnSync(bin, args, {shell: false})`.
   - `recordRuns` iterates `listGateLogs(worktree_path)`.
   - Exports `cmdFeatureClose(rest)` and `closeFeature(opts)` (JSDoc `@returns {{ok, mode, steps, deleted, kept, warnings, reservations_commit_pending}}`). Exits via `emitExit`.
   - `spec_not_found` and every argument check run before step 2.
2. `_shared/lib/feature.cjs`: `close` → `require('./feature-close.cjs').cmdFeatureClose(rest)`.
3. Create `_test-fixtures/a1-lib-units/cases/feature-close.cjs`.
   - **Fixture builder:**
     - a bare `origin`, clone `A` (primary) with `main` and a feature branch pushed then merged (squash) on origin by the fixture;
     - a linked worktree for the branch registered in the isolated `HOME` registry (write the entry shape `worktree.cjs` reads, copied from a real `~/.a1-worktrees-registry.json` entry with paths replaced), holding non-empty gate logs for scopes `pr-7` and `<spec-id>`;
     - `.a1/reservations.json` with a `code_scope` entry at stage `verify` (untracked by default);
     - a temp vault with `project/<slug>/spec/<id>.md` (`status: implementing`) and `pattern/a1-learnings/`;
     - a fake gh (`node` script named by `A1_GH_BIN`) answering `pr view` and `pr list` from a JSON state file.
   - **Cases:**
     - FC1 merged, remote branch gone → exit 0: registry entry `cleaned`, worktree dir gone, reservation gone, spec `status: done`, the local feature branch deleted, `steps` lists every step `done`, no `reservations_commit_pending`.
     - FC2 a second call → exit 0; the bytes of `reservations.json`, the spec and the registry are equal before and after; `deleted: []`.
     - FC3 PR `OPEN` → exit 1 `pr_not_merged`; all files byte-equal.
     - FC4 the remote branch still present → exit 1 `remote_branch_present`; all files byte-equal.
     - FC5 a dirty worktree (untracked file) → exit 1 `worktree_exit_refused`; reservation and spec unchanged.
     - FC6 a local branch `wip` with a commit not on origin and no PR → kept, `unmerged_commits`.
     - FC7 a branch whose PR is `CLOSED` (not in the merged list) with a diff → kept.
     - FC8 a merged-PR branch whose local tip has one extra commit → kept, `tip_differs`.
     - FC9 the current branch and `main` are never candidates; a branch checked out in another worktree is never deleted.
     - FC10 `--cleanup-only` in a second clone `B` (no registry entry, no reservations file) → deletes B's local copy of the merged branch, creates no `.a1/reservations.json`, touches no spec.
     - FC11 run from inside the linked worktree → exit 1 `run_from_worktree`.
     - FC12 `--by ../x` → exit 2.
     - FC13 the fake gh exits 1 on `pr list` during the sweep → exit 1 `gh_failed`, no branch deleted.
     - FC14 a resumed partial close (reservation already released, spec still `implementing`) → exit 0, spec `done`.
     - FC15 spec file missing → exit 1 `spec_not_found` before any change (files byte-equal).
     - FC16 an extra non-empty gate log `.a1/phases/retro-x/gate-log.jsonl` in the worktree → exit 0, and the learning store's runs file holds a line for `retro-x` (audit M9; `_unscoped` is skipped by `listGateLogs`, measured).
     - FC17 `.a1/reservations.json` committed in clone A → exit 0, stdout `reservations_commit_pending: ".a1/reservations.json"`, `git -C A status --porcelain` lists exactly that file, and `git -C A log -1` is unchanged (nothing committed; audit M8).
4. Run `bash _test-fixtures/a1-lib-units/run-tests.sh`, `bash _test-fixtures/a1-code-scope/run-tests.sh`, `bash _test-fixtures/a1-worktree/run-tests.sh`, `bash _test-fixtures/a1-exit2-audit/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

RED-proof:
- (a) the MERGED check removed → FC3 red.
- (b) `kept` logic replaced by delete-all candidates → FC6 red.
- (c) the tip comparison removed → FC8 red.
- (d) worktree exit moved after the stage/release steps → FC5 red (reservation changed).
- (e) `--force-discard` added to the exit call → FC5 red (exit 0).
- (f) the worktree-checked-out exclusion removed → FC9 red.
- (g) the spec-done skip removed (re-runs `update-status`) → FC2 red (spec bytes change: `phase_history` grows).
- (h) `recordRuns` records only `pr-<n>` and `<spec-id>` → FC16 red (`worktree_exit_refused`).
- (i) `pendingSharedState` removed → FC17 red.

**Done when:**
- The listed suites exit 0.
- `wc -l < _shared/lib/feature-close.cjs` ≤ 420.
- `grep -c "shell: true\|execSync(\|git commit" _shared/lib/feature-close.cjs` prints 0.
- 9 RED-proof lines are logged.

**Status box:**
- [x] T8.2 `_shared/lib/feature-close.cjs` `feature close` `--cleanup-only` `closeFeature` `reservations_commit_pending` `_test-fixtures/a1-lib-units/cases/feature-close.cjs`

**Covers:** SC-10

---

## Wave 9 — S path in SKILL.md and the phase workflows, feature close in the skill text (sequential, PR B)
**Depends on:** Wave 8

### Task 9.1: SKILL.md and the four phase workflows follow `plan-steps`; SKILL.md names `feature close`; a1-kritis-profile golden pin changes
**Goal:** The S step list comes from the CLI, not from prose (D15); a session that follows the phase workflows on S spawns exactly what `steps[]` lists (one Rene spawn, no second Rene, no Vincente; audit round 2 M2); the kritis golden pins accept exactly these changes. The workflow edits share the kritis harness files with the SKILL.md edit, so they stay in this one task (no parallel writer in Wave 9).
**Actions:**
1. `skills/a1-new-feature/SKILL.md` "Size triage & fast path":
   - keep the S criteria, the override paragraph (ending in `loud when triaging.`) and the M/L paragraph byte-identical;
   - delete the 12 lines that follow `loud when triaging.`: blank, `**What shrinks on the S path:**`, blank, the table header, the separator, the six rows, and the trailing blank (measured: the same 12 lines follow the anchor in the golden copy and in the current file);
   - insert in their place, starting and ending with a blank line: at the end of triage (before Phase 1 for a clear S, else after Discover) run `node <repo>/_shared/a1-tools.cjs feature plan-steps <spec-path>` and follow its `steps[]`; `steps[]` lists every fixed step and every conditional step, and a step with `when` runs when its phase workflow finds that condition true; on S that is one Rene spawn on the reasoning tier (opus) for Discover+Specify+Clarify, resumed via `SendMessage` for Gate C's dispatch and for the single-wave plan (its `resume` list), no Vincente, no Diana, no Tobi; Gate C, Gate 4.5, Scope-Claim, Isolation and the pr-review Reinhard run at every size; when Rene's discovery shows the feature is not S, set `spec set-size` and re-run `plan-steps`.
   - No inserted non-blank line may equal a deleted non-blank line (so `diff` cannot anchor on a shared text line); blank lines are counted on their own in D.
2. Same file, Lifecycle Completion Gate: a pure insertion after the remote-branch gate paragraph (the table and the gate text stay byte-identical; the anchor is a golden line that occurs exactly once in the golden copy and in the current file, confirmed with `grep -cxF` on both): after the merge, `feature close --by <spec-id> --pr <n>` (called from `a1-pr-review` `workflows/05-merge.md`) checks MERGED and the remote branch, records every gate-log scope, exits the worktree, advances `merge` and `origin-cleanup`, releases the scope and sets the spec `done`; the skill then commits `.a1/reservations.json` when `feature close` names it (`reservations_commit_pending`, push-cadence P3). A second call is a no-op, and `feature close --cleanup-only` cleans branches in other clones.
2a. **S path in the phase workflows (audit round 2 M2).** Every new line obeys the kritis W/C/N rules for the whole `skills/a1-new-feature/` scope: it names no `a1-tools.cjs profile` command, no `subagent_type: "a1-samuel-security"`, no `Blank slate for this run` and no `not_implemented`. Run the touched-file pin rule for each file first.
   - `skills/a1-new-feature/workflows/01-discover.md` Step 3b: replace the 4-line paragraph that starts `**Size-S shortcut for Steps 3–4:**` with a paragraph headed `**Size-S path (one Rene spawn, spec 027 FR-025):**`. Content: on S, Step 3 spawns Rene once with `model: "opus"` (reasoning tier, owner decision 2026-11-20) and one combined brief: the Discovery brief; the Specify brief of `02-specify.md` Step 1 (mini-spec: 1-2 FRs with ACs; FR/AC formality is never dropped, Gate 4.5 and Gate C depend on it); and the Clarify work of `03-clarify.md` (the 3 sharpest categories of its Size-S fast path, its Step 2 approach and hard rules, at most 2 questions per turn, the question relay of Step 3 above). Keep this spawn's agent id: Gate C's dispatch (`03-clarify.md` 3.5-1), a 3.5-2 loop-back and the single-wave plan (`04-plan.md` Step 1) resume it via `SendMessage`, never a new spawn. The orchestrator still runs every non-spawn step unchanged: `02-specify.md`'s `spec set-size` block and its Steps 2-3, and `03-clarify.md` Steps 3, 3.5 (Gate C) and 4. Step 4 item 1's "(Size S: the compressed section set from Step 3b is acceptable)" stays, and so do the a1-quick anchors (the Step 2b heading before the Step 3 heading, `quick eligibility`).
   - `skills/a1-new-feature/workflows/02-specify.md`: insert exactly one line directly after the golden line `formality is never dropped.` (it occurs once in the golden copy and once in the current file; measured), no blank line, exactly this text (between the double backticks): `` On S, Step 1 below is skipped: the one Rene spawn of `01-discover.md` Step 3b already wrote the mini-spec; run the `spec set-size` block above and Steps 2-3 (spec 027 FR-025). ``
   - `skills/a1-new-feature/workflows/03-clarify.md`: insert exactly one line directly after the golden line `regardless of size.` (it occurs once in both copies; measured), no blank line, exactly this text (between the double backticks): `` On S the one Rene spawn of `01-discover.md` Step 3b already ran this 3-category scan: skip Step 2 (no second Rene spawn); Gate C's 3.5-1 dispatch and any 3.5-2 loop-back resume that Rene via `SendMessage` (spec 027 FR-025). ``
   - `skills/a1-new-feature/workflows/04-plan.md`:
     - replace the 5-line paragraph of Step 1 that starts `**Size-S fast path:**` with: `**Size-S fast path (no Vincente, spec 027 FR-025):**` on `size: S`, skip Step 2. The single-wave plan is written by the one Rene spawn of `01-discover.md` Step 3b, resumed via `SendMessage` with `<plan-path>` and this format: frontmatter with `code_scope`; the coverage matrix above the first wave heading; a `## Depth Pass` section (rules in `<repo>/_shared/depth-pass.md`); exactly one `## Wave 1` with one `**FRs covered:**` line naming every FR; a `### Suggested agent(s)` heading followed by one `- **<agent>**` line; no dependency graph. When the resume is not possible (no agent id), the session writes the plan itself in the same format. Step 3 (depth-check, scope dry-run, status update) and the hand-off checks run unchanged, so Gate 4.5 and `wave next-check` read it like a Vincente plan.
     - the header line `` **Sub-agent:** Vincente (`a1-vincente-vibe-optimizer`). `` gets the suffix "Size M/L only; on S see Step 1." (one space before it), and the first line of Step 2 (before "Use the **Agent** tool") becomes `Size M/L only (S: the Step 1 fast path).` followed by a blank line.
   - Create `_test-fixtures/a1-lib-units/cases/s-path-text.cjs` (globbed by the runner; repo root `path.resolve(__dirname, '../../..')`; a paragraph is the run of non-blank lines that starts at the named line):
     - SP1 `04-plan.md`: the `**Size-S fast path` paragraph names no `a1-vincente-vibe-optimizer` and no `instruct`, and names `SendMessage`, `code_scope`, `## Wave 1`, `### Suggested agent(s)` and `## Depth Pass`; the Step 2 section holds `Size M/L only`.
     - SP2 `01-discover.md`: the `**Size-S path` paragraph names `model: "opus"`, `02-specify.md`, `03-clarify.md`, `SendMessage` and `Gate C`, and the file no longer contains `may be combined`.
     - SP3 `03-clarify.md`: exactly one line contains both `skip Step 2` and `SendMessage`, and it directly follows `regardless of size.`.
     - SP4 `02-specify.md`: exactly one line contains `Step 1 below is skipped`, and it directly follows `formality is never dropped.`.
     - SP5 CLI and text agree: `feature plan-steps` (child process) on a planted spec with `size: S` lists exactly one step with agent `a1-rene-requirement-engineer`, whose `resume` equals `["gate-c-ac-dryrun","wave-plan"]`, and no step with agent `a1-vincente-vibe-optimizer`; SP1 (wave plan by resume) and SP3 (Gate C by resume) hold for the two `resume` targets.
     - Plan-time red (measured on `54836f2`): the `**Size-S fast path` paragraph of `04-plan.md` contains `instruct` once (SP1 red), `01-discover.md` contains `may be combined` (SP2 red), and `02-specify.md` holds no `Step 1 below is skipped` (SP4 red).
3. **a1-kritis-profile pin changes** (listed in the Existing-assert table):
   - `_test-fixtures/a1-kritis-profile/golden/apply-prompts-allowed.cjs`: new op `delete-after` (text = a golden anchor line that must occur exactly once, else exit 3) followed by `gone` rows; the golden lines right after the anchor must equal the `gone` rows in order (else exit 3: an allowance that no longer matches cannot pass silently), and they are removed from the golden before the compare. `insert-after`/`line` stay unchanged. Update the header comment.
   - `_test-fixtures/a1-kritis-profile/golden/prompts.allowed-diff`:
     - SKILL.md: one `delete-after` block with the anchor `loud when triaging.` (it occurs exactly once in the golden copy and in the current file; measured) and 12 `gone` rows: blank, `**What shrinks on the S path:**`, blank, the header, the separator, the six rows, blank; one `insert-after` block for the action-1 lines on the same anchor, so the insert lands where the deletion was; one `insert-after` block for the action-2 lines.
     - 02-specify.md: one `insert-after` row (`formality is never dropped.`) plus one `line` row with the action-2a line.
     - 03-clarify.md: one `insert-after` row (`regardless of size.`) plus one `line` row with the action-2a line, placed directly before the first existing `03-clarify.md` row (D compares the `line` rows in row order with the diff in file order, and this line sits above both existing insertions).
     - A dated comment naming spec 027 FR-025/FR-026 and audit round 2 M2.
   - `_test-fixtures/a1-kritis-profile/parts/01-golden.sh` P-allowed (251-286): the literal simulated file additionally deletes the 12 lines after `loud when triaging.` (a `sed` range on the copy) and inserts the action-1 and action-2 lines written out literally (not read from `prompts.allowed-diff`, as the existing comment requires).
   - `_test-fixtures/a1-kritis-profile/parts/08-wiring.sh` D:
     - SKILL.md branch (148-161): expected removed = the number of deleted non-blank lines, added = 6 + the number of new non-blank lines, and `want_d` gains the new non-blank lines in file order; the deleted non-blank lines are compared in order like the added ones; blank lines are counted on their own (the existing GNU/Apple diff note). The executor measures the exact numbers on the new tree with `diff` and pins them; the comment names spec 027.
     - 03-clarify branch (164-176): `"$gt" == "37"` → `"38"`; the ok/bad texts name the spec 027 line.
     - new `elif` for `skills/a1-new-feature/workflows/02-specify.md` directly before the 03-clarify branch: removed 0, added = the number of `02-specify.md` `line` rows of `prompts.allowed-diff`, the added lines (after stripping `> `) equal to those rows in order. The generic `else` stays for the other files. Plan-time check (2026-11-20, scratch copy): one line in each of 02-specify/03-clarify gave `217 passed, 4 failed`; with these 03-clarify/02-specify pin changes and the two allowed-diff pairs, `221 passed, 0 failed`.
   - Create `_test-fixtures/a1-kritis-profile/parts/09-allowed-delete.sh` (globbed by the runner):
     - K1 a `delete-after` whose `gone` row does not match the golden → `apply-prompts-allowed.cjs` exit 3;
     - K2 an anchor that occurs twice → exit 3;
     - K3 a correct delete plus insert on a planted golden pair → the applied golden equals the planted current byte for byte;
     - K4 (the P-mut guard with the allowance applied): a copy of the current `02-specify.md` with one stray line appended outside any block, stripped and run through `apply-prompts-allowed.cjs` with the real `prompts.allowed-diff`, does **not** compare equal with the applied golden.
4. Run `bash _test-fixtures/a1-kritis-profile/run-tests.sh` (P, P-allowed, P-prov, P-mut, B, W, C, N, D, K1-K4), `bash _test-fixtures/a1-ux-studio/run-tests.sh` (`  - Skill`, I1-I5), `bash _test-fixtures/a1-quick/run-tests.sh` (01-discover anchors), `bash _test-fixtures/a1-lib-units/run-tests.sh` (SP1-SP5, PS1-PS12), `bash _test-fixtures/a1-code-scope/run-tests.sh`, `bash _test-fixtures/a1-pr-review/run-tests.sh` (:338), `bash _test-fixtures/a1-gates-lint/run-wave13.sh` and `run-wave14.sh` (the new fenced `feature plan-steps` call), `node _shared/a1-tools.cjs gates lint` and `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s4`.

RED-proof:
- (a) the old `prompts.allowed-diff` (without the new rows) on the new tree → `P SKILL.md`, `P 02-specify.md` and `P 03-clarify.md` red.
- (b) the old D SKILL.md branch on the new tree → `D skills/a1-new-feature/SKILL.md` red.
- (c) the `gone`-row comparison removed from `delete-after` → K1 red.
- (d) one deleted S-table row restored in SKILL.md on a copy → `P SKILL.md` red.
- (e) the old D 03-clarify count `37` on the new tree → `D skills/a1-new-feature/workflows/03-clarify.md: removed=0 added=38` red (measured at plan time).
- (f) the old D without the 02-specify branch on the new tree → `D skills/a1-new-feature/workflows/02-specify.md: removed=0 added=1` red (measured at plan time).
- (g) the new D with the 02-specify inserted line reworded on a copy (allowed-diff unchanged) → `D .../02-specify.md` red.
- (h) the new D with the 03-clarify inserted line deleted on a copy → `D .../03-clarify.md` red (added=37).
- (i) the old `**Size-S fast path:**` paragraph restored in 04-plan.md on a copy → SP1 red.
- (j) `resume` dropped from `rene-discover-specify-clarify` → SP5 and PS3 red.
- (k) `apply-prompts-allowed.cjs` mutated to write the current text as the applied golden → K4 red.

**Done when:**
- The listed commands exit 0; a1-kritis-profile reports 0 failed.
- `grep -c 'feature plan-steps' skills/a1-new-feature/SKILL.md` ≥ 1, `grep -c 'feature close' skills/a1-new-feature/SKILL.md` ≥ 1, and `grep -c 'What shrinks on the S path' skills/a1-new-feature/SKILL.md` prints 0.
- `awk '/^\*\*Size-S fast path/,/^$/' skills/a1-new-feature/workflows/04-plan.md | grep -c 'a1-vincente-vibe-optimizer\|instruct'` prints 0.
- `git diff --quiet origin/main -- _test-fixtures/a1-kritis-profile/golden/prompts/ _test-fixtures/a1-kritis-profile/golden/provenance.sha256` exits 0 (the golden copies stay byte-unchanged).
- 11 RED-proof lines are logged.

**Status box:**
- [x] T9.1 `feature plan-steps` `skills/a1-new-feature/SKILL.md` `delete-after` `prompts.allowed-diff` `_test-fixtures/a1-kritis-profile/parts/09-allowed-delete.sh` `skills/a1-new-feature/workflows/01-discover.md` `skills/a1-new-feature/workflows/02-specify.md` `skills/a1-new-feature/workflows/03-clarify.md` `skills/a1-new-feature/workflows/04-plan.md` `_test-fixtures/a1-lib-units/cases/s-path-text.cjs`

**Covers:** SC-9, SC-10

### Task 9.2: 05-merge.md and 06-verify.md call `feature close`; DCMGRP pin; F-block stub run
**Goal:** The close-out comes from the CLI, not from prose (D17).
**Actions:**
1. `skills/a1-new-feature/workflows/06-verify.md` §5 items 3-5: item 3 keeps the Live-probes block (a1-probe pins). The `code-scope stage --set merge`/`origin-cleanup`, `code-scope release` and `spec update-status ... done` blocks are replaced by one pointer to the 05-merge.md F block (`feature close`). The `retro validate` block (L12) and `lock_timeout` stay.
2. `skills/a1-pr-review/workflows/05-merge.md`: add the F block of D17 after the run-record block (as a new numbered item between items 2 and 3), with the `reservations_commit_pending` prose after it and one intro sentence naming the `caller_spec_id` input of 02-review.md. F is item 3, so the old items 3-4 become 4-5. The old item-3 line keeps every byte after its leading digit (RR_POS anchors `^\d\.` followed by the a1-worktree exit discard words); append the condition at the end of that item's last line: "Only for callers without a spec id; with one, item 3 (`feature close`) already did this." The old item 4 becomes item 5: "The caller's remaining stages are done by `feature close` (item 3)." The MH9a line and `b[3]` stay byte-unchanged (audit round 2 m2).
3. `_test-fixtures/a1-pr-review/run-tests.sh` (listed pin changes, D17): `b.length` `6`→`7`, the classifier adds `/feature close/.test(x)?"F"`, the expected order `DCMGRP`→`DCMGRFP`, and the case titles name the F block.
   - Red runs to log: the old count pin on the new tree prints `7`; the new pin with the F block removed on a copy prints `6 DCMGRP`.
4. Create `_test-fixtures/a1-pr-review/cases-close-block.sh`, sourced once right before the final `echo ""` (after `cases-review-record.sh`):
   - CB1 the F block contains `feature close --by "$SPEC_ID" --pr <n>`, `RC=$?`, `exit "$RC"`, and a `case` that skips `none`;
   - CB2 stub run (RR-guard pattern, audit m10): extract the F block with `bj 'b.find(x=>/feature close/.test(x))'`, a stub `a1-tools.cjs` that logs argv, a stub `gh` on `PATH` printing `MERGED`, a stub `git` on `PATH` that logs argv and prints nothing for `ls-remote`. Three runs: unreplaced `<caller_spec_id>` → `SKIP` printed and the stub never ran; `fx-spec` → one stub line `feature close --by fx-spec --pr 7`; `$(touch PWNED)` → no PWNED file and the value passed literally.
5. Run `bash _test-fixtures/a1-pr-review/run-tests.sh`, `bash _test-fixtures/a1-pr-merge-check/run-tests.sh` (cases-host, MH9a), `bash _test-fixtures/a1-probe/run-tests.sh`, `bash _test-fixtures/a1-verify/run-tests.sh` (`cases-envred.sh`), `bash _test-fixtures/a1-retro-validate/run-tests.sh`, `bash _test-fixtures/a1-workflow-lint/run-tests.sh`, `bash _test-fixtures/a1-gates-lint/run-wave13.sh` (W13c, W13d) and `run-wave14.sh`, `node _shared/a1-tools.cjs gates lint`, and `node _shared/a1-tools.cjs workflow lint --phase 027-lean-pipeline-s4`.

RED-proof:
- (a) the F block's `exit "$RC"` removed → CB1 red.
- (b) the F block placed before block G on a copy → the order case red (`DCMFGRP`).
- (c) the old count pin on the new tree (action 3).
- (d) the new pin with the F block removed (action 3).
- (e) the `"<"*` arm removed from the F block's `case` → CB2 red (the placeholder run calls the stub).

**Done when:**
- The listed commands exit 0.
- `grep -c 'feature close' skills/a1-pr-review/workflows/05-merge.md` ≥ 1.
- 5 RED-proof lines are logged.

**Status box:**
- [x] T9.2 `feature close` `DCMGRFP` `skills/a1-pr-review/workflows/05-merge.md` `_test-fixtures/a1-pr-review/cases-close-block.sh`

**Covers:** SC-10

---

## Wave 10 — PR B integration, review (Reinhard + Samuel), merge (sequential, PR B)
**Depends on:** Wave 9

### Task 10.1: ADR note, full run
**Goal:** PR B is complete and green.
**Actions:**
1. ADR `docs/adr/2026-10-14-gate-invoke-and-log.md`: append `## 2026-11-2x — Bundle alias (spec 027 FR-024)`: `wave checks` counts as a call of the three bundled subcommands (`BUNDLES`, equal to `CHILD_GATES`), and each child writes its own record into the project's log.
2. Run, recording in `STATUS.md`:
   - `gates lint` → 0;
   - `workflow lint --phase 027-lean-pipeline-s4` → 0;
   - `check-wave11-callsites.cjs .` → `calls=13`;
   - `run-wave13.sh` and `run-wave14.sh` → 0;
   - the caps loop of V14;
   - the frozen-files diff → 0;
   - `checklist.cjs` diff → 0;
   - `bash bin/run-suites.sh --check-groups` → 0;
   - `bash bin/run-suites.sh` → 0.

RED-proof: none new (the help moved to Task 6.2; every PR B case is RED-proved in its own task).

**Done when:**
- Every command of action 2 exits as stated.
- Every status box of Tasks 6.1-9.2 is `[x]`, and `phantom check` reports no phantom for them.

**Status box:**
- [x] T10.1 `BUNDLES` ADR note PR B green

**Covers:** SC-11

### Task 10.2: [ORCHESTRATOR] PR B review and merge
**Goal:** PR B is reviewed by Reinhard and Samuel and merged.
**Actions:**
1. `a1-specforge:a1-pr-review` on the PR B branch. For 2.1b/2.3a/2.3d follow the primary checkout's `skills/a1-pr-review/workflows/02-review.md` (on `main`, with A) explicitly, `<repo>` = `/home/rob/claude-projects/a1-specforge` (D1). This is the first PR reviewed with A's recorder.
2. **Samuel spawned explicitly**, whatever 2.2b reports. Brief points:
   1. D16: the step order (refusable before irreversible), `run_from_worktree`, every scope recorded, never `--force-discard`, never `git commit`, the sweep exclusions (current, base, checked-out), deletion only on a tip-equal merged PR or an empty three-dot diff (and rule (b)'s reach), gh failure deletes nothing, `check-ref-format`, argv-only git/gh, the `A1_GH_BIN` override;
   2. D17: the remote delete in 05-merge only for a MERGED PR; the placeholder and `$(...)` handling (CB2);
   3. D13: the `$VBG` directory outside the tree (absolute path), the rc-file join, no `pgrep`.
3. Reinhard's brief adds D12 (bundle alias keeps wiring visible, BU4), D15 (conditional steps) and the kritis `delete-after` harness extension.
4. Fix every BLOCKER and MAJOR, re-run Task 10.1 action 2, wait for CI green.
5. Merge-check once, default path (CI evidence when green), per 05-merge.md 5.3 with the repo's own CLI. Record the `sh` load line.
6. Merge, verify MERGED, close out. 05-merge items 1-4 still apply here, because this PR's own close-out runs from the pre-B `main` workflows; the F block is used from the next feature on. Release the scope with a chore PR.
7. **PR text of B names:**
   - D11-D17;
   - the W11, VS3, DCMGRP and a1-kritis-profile pin changes with their red runs;
   - the reading "S path triage may happen before Discover" and the FR-025 extension: the one S Rene spawn is resumed for Gate C's dispatch and writes the single-wave plan (no Vincente spawn on S; the session writes the plan only when the resume is not possible);
   - rule (b) of the branch sweep (also non-PR branches contained in the base);
   - the release proposal (1.18.0 after A+B, `claude plugin update a1-specforge` on both hosts);
   - the follow-ups: run-record treatment of `reused` records; `wave checks` in a1-fix (not changed); the FR-019/FR-020 readings for the owner's reconcile.

**Done when:**
- `gh pr view <B> --json state` prints `MERGED`.
- No `027-lean-pipeline` reservation remains.

**Status box:**
- [ ] T10.2 PR B merged Samuel review `feature close` released scope

**Covers:** SC-11

---

## Verification
Run after each PR's last wave against its head, cwd = worktree root. The red runs were executed on `main` @ `54836f2` on 2026-11-20 (scratchpad) unless noted.
- [ ] V1 `pr review-record` and `pr review-evidence` exist (RR1-RR13 and RV1-RV5 pass).
  - Red when: the subcommands are missing, a case fails, or 2.3a reads `$HEAD_SHA`.
  - Red run: both gave `rc=1 usage error: unknown pr subcommand: review-record` (`review-evidence`).
- [ ] V2 `node _shared/a1-tools.cjs gates lint` exits 0 on the A head, with the `pr-reinhard` invoke `pr review-record` (PR1-PR5, R3b unchanged).
  - Red when: the recorder exception is missing or 02-review.md lacks the call.
  - Red run: a scratch tree whose registry carries the invoke → `gates-lint rc=1`, findings `prompt_names_command:pr-reinhard,unwired:pr-reinhard`.
- [ ] V3 FR-020 reuse: RH1-RH19 pass; a second identical `lane-split check --phase rp` prints `reused: lane-split @ <hex>`, and its record has `reused: true`.
  - Red when: no reuse or a stale reuse.
  - Red run: two runs gave `run1 rc=0 reused_lines=0`, `run2 rc=0 reused_lines=0`, log `2 lane-split:pass:false:false lane-split:pass:false:false` (no hash, no reused).
- [ ] V4 `node -e 'console.log(typeof require("./_shared/lib/gate-log.cjs").currentScope)'` prints `function`.
  - Red when: the export is missing.
  - Red run: printed `currentScope: undefined`.
- [ ] V5 `wave next-check` NC1-NC30 pass.
  - Red when: the group is missing, a reason is misread, or a missing source does not stop.
  - Red run: `rc3=1 usage error: unknown command group: wave`.
- [ ] V6 `workflow lint` exits 0 on the A head with `flow_checked` 5; FC2 and FL3-FL8, FL11 red-plant cases exit 1.
  - Red when: a prompt or confirmation stays, or a rule is missing.
  - Red run: `workflow lint rc=0` on `54836f2` while `Continue? [y`, `Do **not** dispatch automatically`, `a1-reinhard-reviewer` (06-verify), `yes / no / adjust draft`, `Are you sure` and `User aborts at confirm` each counted 1.
- [ ] V7 `grep -c a1-reinhard-reviewer skills/a1-new-feature/workflows/06-verify.md` prints 0, and `grep -c a1-reinhard-reviewer skills/a1-pr-review/workflows/02-review.md` ≥ 1 (keep-list anchor).
  - Red when: the early spawn stays or the anchor is lost.
  - Red run: 06-verify counted 1. A scratch 02-review.md without the anchor gave `gates lint rc=1 invariant_owner_lost:pr-reinhard`.
- [ ] V8 On `main` after the scope-release chore PR: `.a1/phases/027-lean-pipeline-s4/SC003-MERGE-CHECK.json` exists with `rc` 0, `suites.runner_source`, `wall_ms`, `host_load` and `baseline_total_ms` 2990052, and its `head_sha` equals the `headRefOid` of merged PR A (`gh pr view <A> --json headRefOid`). SC-003 holds when `suites.duration_ms` (total) ≤ 900000; otherwise reported as an SC-003 finding.
  - Red when: the file is missing, its `head_sha` differs from the merged head, or a measured field is guessed instead of copied or `"absent"`.
  - Red run: `BASELINE.json` (`.a1/phases/027-lean-pipeline/BASELINE.json`) serial long path `total_ms 2990052` > 900000.
- [ ] V9 B head: `grep -c RESEARCH.md skills/a1-plan/workflows/02-map.md` prints 0, the `research-map` markers sum to 2, PG1-PG7 pass, and a1-dashboard 05.24-05.27 pass.
  - Red when: Marco still reads RESEARCH.md, a group is single, or the dashboard shape broke.
  - Red run: `02-map.md` counted 1 `RESEARCH.md`; `parallel markers=0`. The background 04-audit form gave `callsite_check` `ok` (the shape is pinned, measured).
- [ ] V10 B head: `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` prints `calls=13`, and WC1-WC7 and BU1-BU4 pass.
  - Red when: a call line changed without its pin, `wave checks` stops early, or a child logs outside the project.
  - Red run: `calls=15` on `54836f2`; `wave checks` → `rc4=1` (unknown group).
- [ ] V11 B head: BV1-BV5 and VB1-VB2 pass, VS3 passes with the restricted address; 03-verify.md and 06-verify.md each hold one `a1:background id=verify-bg` and one `a1:join id=verify-bg`.
  - Red when: no background start, no join, no cache hit after it, a relative `$VBG`, or the old VS3 address on the new tree.
  - Red run: 0 markers on `54836f2` (`grep -rc "a1:background" skills` sums to 0); a planted background line gave the old VS3 address 2 findings and the restricted address 1.
- [ ] V12 B head: `feature plan-steps` PS1-PS12 and `feature close` FC1-FC17 pass.
  - Red when: S is not a strict reduction, a conditional spawn is missing, or close is unsafe, not idempotent, leaves a scope unrecorded or commits.
  - Red run: `rc5=1 usage error: unknown command group: feature`, `rc6=1`.
- [ ] V13 B head: the 05-merge.md block order is `7 DCMGRFP`, `b[3]` is byte-exact `gh pr merge <n> --squash --match-head-commit <head_sha>`, and CB1-CB2 pass.
  - Red when: the merge block moved, the F block is missing, or a placeholder runs `feature close`.
  - Red run: on `54836f2` the classifier printed `6 DCMGRP`.
- [ ] V14 Caps (D18):
  ```bash
  F=0; for p in "_shared/a1-tools.cjs 800" "_shared/lib/help.cjs 800" "_shared/lib/gate-log.cjs 480" "_shared/lib/gates-lint.cjs 230" "_shared/lib/workflow-lint.cjs 445" "_shared/lib/reuse-hash.cjs 270" "_shared/lib/pr-review-record.cjs 200" "_shared/lib/wave.cjs 60" "_shared/lib/wave-next-check.cjs 320" "_shared/lib/workflow-lint-flow.cjs 250" "_shared/lib/help-lean.cjs 140"; do set -- $p; if [ ! -e "$1" ] || [ "$(wc -l < "$1")" -gt "$2" ]; then echo "cap: $1"; F=1; fi; done; git diff --quiet origin/main -- _shared/lib/checklist.cjs || { echo "cap: checklist.cjs edited"; F=1; }; echo "rc=$F"
  ```
  The B head adds `"_shared/lib/wave-checks.cjs 200" "_shared/lib/feature.cjs 60" "_shared/lib/feature-plan-steps.cjs 220" "_shared/lib/feature-close.cjs 420" "_shared/lib/workflow-lint-parallel.cjs 250"`.
  - Red when: a file is missing or over its cap, or `checklist.cjs` changed.
  - Red run: on `54836f2` the loop prints `cap: _shared/lib/reuse-hash.cjs` (missing) and `rc=1`; `wc -l` of the facade is 784.
- [ ] V15 `git diff --quiet origin/main -- .a1/verify.json _test-fixtures/suite-groups.json .github/` exits 0 on each PR head.
  - Red when: a frozen file changed.
  - Red run: `git diff --quiet 3a6d00c~1 3a6d00c -- .a1/verify.json _test-fixtures/suite-groups.json` gave `rc=1`.
- [ ] V16 `bash bin/run-suites.sh` exits 0 on each PR head, and `bash _test-fixtures/a1-gates-lint/run-wave13.sh` / `run-wave14.sh` exit 0 (W13c/W14e).
  - Red when: any suite fails.
  - Red run: the 99 RED-proof lines (T1.1 12, T2.1 9, T2.2 11, T4.1 11 incl. the 3 deferred W3 lines, T5.1 2, T6.1 4, T6.2 6, T7.1 6, T7.2 4, T8.1 8, T8.2 9, T9.1 11, T9.2 5; sum 98, plus the planted-tree sweep run below = 99 logged lines), each applied once on a scratch copy and logged. Plan time: planted fenced `wave next-check` and `pr review-evidence` lines gave `check-callsite-flags.cjs` rc=1 (`command does not exist in the real CLI`); a planted SKILL.md insertion gave a1-kritis-profile `219 passed, 2 failed`.
- [ ] V17 `node _shared/a1-tools.cjs lane-split check --plan .a1/phases/027-lean-pipeline-s4/PLAN.md --phase 027-lean-pipeline-s4` and the same with `--imports .` exit 0 (at plan time and again in Task 5.1).
  - Red when: a lane owns a file another lane writes or imports.
  - Red run (plan time, 2026-11-20): a draft that gave lane flow-a `_shared/lib/workflow-lint.cjs` is a cross-lane import target of `gates-lint.cjs:31` (`require('./workflow-lint.cjs')`, cli-a). `lane-split.cjs` 256-300 reports such an owned target as `cross-lane-import`, which is why the file is in no lane.
- [ ] V18 A head: FL12-FL17 pass (the extracted Phase-start and Step 1b blocks leave a planted worktree with an empty `git status --porcelain`, make no second commit, merge two lanes' appends, and let `git worktree remove` succeed; every session-side append is committed). NC31 passes.
  - Red when: a block leaves an untracked or modified store, a second run commits again, a lane merge conflicts on a store, a goal with an apostrophe breaks the block, or a default-path PLAN without `lanes:` stops on `agent_unnamed`.
  - Red run (2026-11-20, scratchpad, planted repo + linked worktree): the block without its commit line left 2 untracked lines, and `git worktree remove` refused (`contains modified or untracked files, use --force`); without the `merge=union` attribute the second lane merge exited 1; the full block gave rc 0, 0 status lines, no second commit, both lane lines kept, the apostrophe/`$(touch PWNED)` goal verbatim with no PWNED file, and `worktree remove` rc 0.
- [ ] V19 B head: SP1-SP5 and K1-K4 pass, and `bash _test-fixtures/a1-kritis-profile/run-tests.sh` reports 0 failed with the listed P/D pin changes for SKILL.md, 02-specify.md and 03-clarify.md.
  - Red when: a phase workflow still spawns a second Rene or Vincente on S, the S plan has no named writer, or a kritis pin was changed without its listed row.
  - Red run (2026-11-20, scratch copy of `54836f2`): one line inserted in each of 02-specify.md and 03-clarify.md gave `217 passed, 4 failed` (`P 02-specify.md`, `P 03-clarify.md`, `D .../02-specify.md: removed=0 added=1`, `D .../03-clarify.md: removed=0 added=38`); with the two allowed-diff pairs, the 03-clarify count `38` and a 02-specify `elif` it gave `221 passed, 0 failed`. On `main` the 04-plan `**Size-S fast path` paragraph contains `instruct` once and 01-discover.md contains `may be combined`, so SP1 and SP2 are red today.

Post-merge (reported by a1-progress, not a merge condition):
- SC-004: the first 3-wave feature after both merges has zero owner stops between green waves and zero PR confirmations.
- SC-005: one `pr-reinhard` record per head sha and one Reinhard spawn per PR without a fix round.
- SC-007: every keep-list id has at least one gate-log record in that run.
- The first real `feature close` leaves no half-closed feature and its `reservations_commit_pending` is committed by the skill.

## Review and merge (merge dependency)
- Review path in this repo: `.a1/xprov.json` is `external_review: denied`. No Codex review, nobody asks for or waives a permit, and `design-review-xprov` on the ADR answers `not_applicable`.
- **PR A:** `a1-specforge:a1-reinhard-reviewer` via a1-pr-review on the full diff once. `a1-specforge:a1-samuel-security` only when 2.2b `xprov scope` reports `security_surface: true` (expected false: no forbidden-surface path). Brief points in Task 5.2.
- **PR B:** Reinhard plus Samuel, Samuel spawned explicitly (Task 10.2), because `feature close` deletes local branches, exits worktrees and releases scopes.
- Every BLOCKER and MAJOR of both is fixed before the PR's merge-check. Each PR runs its merge-check exactly once per head; a second run happens only after a red reason was fixed with a new commit. Nothing is committed to a PR branch after its merge-check.
- After B merges (orchestrator): propose the 1.18.0 release and `claude plugin update a1-specforge` on Mac and aiserver. Remove the untracked copy of this phase folder from the primary checkout only after `git diff --quiet origin/main -- .a1/phases/027-lean-pipeline-s4` holds.

## Revision Notes
Round 1 (2026-11-20), against AUDIT.md (2 BLOCKER, 10 MAJOR, 17 MINOR). Measurements for this round were run on `main` @ `54836f2` in the scratchpad.

| Finding | Disposition | What changed |
|---|---|---|
| B1 call-site sweep red mid-PR | Fixed | `help-lean.cjs`, `help.cjs` and `cases/help-lean.cjs` moved into cli-a; Task 1.1 ships the three PR A usage blocks (with `--phase` on `review-evidence`). flow-a writes no fenced `wave next-check` call (prose + `<!-- a1:next-check-block -->` placeholder); Task 5.1 adds the fenced blocks after the lane merge (option a). Task 6.2 ships the `wave checks`/`feature plan-steps`/`feature close` blocks before Waves 7/9. W13c/W14e added to the pin table; `run-wave13.sh`/`run-wave14.sh` run in Tasks 1.1, 2.1, 3.1, 3.3, 5.1, 6.2, 7.1, 8.1, 9.1, 9.2, 10.1. Lane decision text corrected. Measured: planted calls red, help blocks alone green. |
| B2 VS3 unlisted pin | Fixed | VS3 03/06 rows become a listed pin change in Task 8.1 (sed address `.*--out`), with two red runs (old pin: 2 findings, measured; new pin: 0 without the `--out` line). New VB1/VB2 keep the background line under the rule. Pin table completed for 03-verify, 06-verify and 05-implement (QH7, V8, L12, P13, :234, MH9, W13f, W13g). |
| P1 (found in this round) a1-kritis-profile golden pins on SKILL.md | Fixed | Measured: one inserted SKILL.md line gives kritis `P SKILL.md` and `D ...SKILL.md` red. PR A no longer edits SKILL.md (Task 3.1 dropped its Lifecycle-row edit; the Review row stays true). Task 9.1 (new split of old 9.1) carries the listed pin change: `delete-after`/`gone` op in `apply-prompts-allowed.cjs`, allowed-diff rows, P-allowed simulation, D SKILL.md branch, new `parts/09-allowed-delete.sh`. |
| M1 `$HEAD_SHA` across Bash calls; skip path without stages | Fixed | D4/Task 2.1: 2.1b prints `head_sha=`, 2.3a uses the substituted `<head_sha>`; 2.3d also runs after 2.1b exit 0. New `cases-review-record.sh` RV1-RV5 (RV1: no `$HEAD_SHA` in 2.3a; RV5: 2.3d stub run). |
| M2 wave-0 gate log in another checkout | Fixed | D7 wave-0 rule (second option): wave 0 checks only the agent; preconditions stop on their own exit codes. NC29. |
| M3 date-only rows repeat-stop | Fixed | New rows must start with an ISO-8601 UTC timestamp (02-execute 2c, 05-implement Step 4); date-only rows stay fail-closed and the stop-block text names the repeat. NC26/NC27. |
| M4 D7 departs from owner decision | Fixed | Owner decision taken literally: every source required. Stores created empty at phase start (02-execute "Phase start", 05-implement Step 1b). NC23-NC25. Depth Pass answer 1 updated accordingly. |
| M5 no `scope_change` writer in a1-new-feature | Fixed | 05-implement Step 4 mid-run decision rule writes ISO rows into `<dir>/.a1/phases/<spec-id>/GOAL.md`; field-owner row; NC30. |
| M6 relative `--git-common-dir` | Fixed | `--path-format=absolute` (measured on git 2.53.0); BV5 runs the start fence from another cwd. |
| M7 SC-003 file commit moves the PR head | Fixed | Raw outputs go to `<git-common-dir>/a1-s4-sc003/`; `SC003-MERGE-CHECK.json` is written in the scope-release chore PR (Task 5.2 step 6). V8 checks it on `main` and against the merged head. |
| M8 `feature close` dirties `main` | Fixed | D16 step 11: never commits; reports `reservations_commit_pending`; the F-block prose and SKILL.md route the commit through push-cadence P3 finish step. FC17. |
| M9 only two scopes recorded | Fixed | D16 step 5 records every scope `listGateLogs` reports (measured: it skips `_unscoped`, so the extra-scope case uses `retro-x`). FC16. |
| M10 plan-steps not the full M/L list | Fixed | D15 adds `uwe-ux`, `samuel-threat-model`, `samuel-security-wave`, `tobi-audit` with `when`; SKILL.md text says conditional steps apply. PS2 covers Tobi; PS11/PS12 new. |
| m1 W11c no-op mutation | Fixed | Mutation `--diff-base "$PRE_WAVE_HEAD"` → `--base "$PRE_WAVE_HEAD"`. |
| m2 ms vs no-ms timestamps | Fixed | `Date.parse` on both sides (D7); NC28. |
| m3 Task 6.0 ancestor check | Fixed | `git merge-base --is-ancestor <A squash sha> origin/main`. |
| m4 V16 count | Fixed | Recounted per task after this revision (84 mutations + 1 plan-time planted run = 85). |
| m5 tool digest not the closure | Fixed | Digest over the local require closure, depth 2; help names the limit; RH19. |
| m6 roadmap not in the 4.5 key | Fixed | Roadmap from `findProjectRoadmap` added to the 4.5 inputs (`roadmap:none` when absent); RH18. |
| m7 reuse per checkout | Fixed | D6 names that 04.5 and the 05-implement precondition both run in the primary checkout; help and PR text state the per-checkout limit. |
| m8 two a1-pr-review pins on 02-review.md | Fixed | Named in Task 2.1 (f) and the pin table: no `merge-check` token; `### 2.2 ` stays condition-free, skip lives in 2.1b; assert title left unchanged (no existing-assert edit). |
| m9 `caller_spec_id` undeclared | Fixed | Declared in the 02-review.md Inputs list (Task 2.1) and named in the 05-merge F-block intro (Task 9.2); a1-new-feature hands it over (Task 3.1). a1-pr-review SKILL.md not edited (the Inputs list is the phase contract). |
| m10 F block content case only | Fixed | `cases-close-block.sh` CB2 stub run with placeholder, real id and `$(touch PWNED)`. |
| m11 05-implement:96 confirm line | Fixed | Rewritten in Task 3.3 (2e); `Once the user confirms` added to the D8 list; FL11. |
| m12 self-hosting claim | Fixed | D1 and Tasks 5.2/10.2 name the exact workflow file and `<repo>` to follow. |
| m13 `wave checks` children without cwd | Fixed | Children spawn with `cwd` = project dir (D11); WC1/WC4 run from another cwd. |
| m14 exit after write | Fixed | Exit discipline in Execution location; `a1-cli-output` in the run lists of Tasks 1.1, 2.1, 2.2, 4.1, 6.1, 6.2, 8.2. |
| m15 `BUNDLES` vs child list drift | Fixed | `CHILD_GATES` exported; BU4 asserts equality. |
| m16 sweep rule (b) breadth | Fixed (documented) | Kept as FR-026 states it; D16, help and PR text name that non-PR branches contained in the base are deleted (no commit lost). |
| m17 lane mode agent check | Fixed | D7 lane note and Task 3.3 (1i): a lane's last wave hands over to the lane merge. |

Round 2 (2026-11-20), against AUDIT.md round 2 (0 BLOCKER, 2 MAJOR, 6 MINOR). Round-1 rows above stay as written. Measurements for this round were run on `main` @ `54836f2` in the scratchpad (planted repos, a `git archive` copy for kritis).

| Finding | Disposition | What changed |
|---|---|---|
| M1 (round 2) event stores have no committer | Fixed: commit, not `info/exclude` | New D21 with the justification (tracked convention in this repo; an exclude in the common dir silently drops same-named files from directory adds in every checkout, measured; committed observations feed the learning loop). Task 3.3 (1a) carries the exact Phase-start block: creates the stores, registers `merge=union` for them in `<git-common-dir>/info/attributes`, commits only when it created or changed a file. (2b) reuses it byte-identically with `WORK_PATH="<dir>"`. (1g), (2f), (2g) commit each session-side append at once, never while an executor runs. Lanes: Phase start runs once before the lanes branch; union merge keeps both sides. Field-owner rows for the creation commit, append commits, Erik's lines and the attribute. Task 4.1 cases FL12-FL16 run the extracted blocks in a planted worktree (`git status --porcelain` empty, no second commit, lane merge rc 0, `git worktree remove` rc 0), FL17 checks the append commits; 4 new RED-proof lines. SC-4, V18, PR A text updated. Measured: the block gives rc 0 and 0 status lines; without its commit line 2 untracked lines and `worktree remove` refuses; without the attribute the second lane merge exits 1. |
| M2 (round 2) S path contradicts the phase workflows | Fixed | 01-discover.md, 02-specify.md, 03-clarify.md and 04-plan.md added to the PR B claim and to Task 9.1 (new action 2a; kept in 9.1 because the kritis harness files are shared). 01-discover: one opus Rene spawn with the combined Discovery + Specify + 3-category Clarify brief. 02-specify / 03-clarify: one inserted line each that skips their Rene spawn on S (Gate C stays, its dispatch resumes the same Rene). 04-plan: no Vincente on S; the **writer of the S plan is the same Rene spawn, resumed via `SendMessage`** (fallback: the session, same format), with `code_scope`, one `## Wave 1`, `### Suggested agent(s)` and `## Depth Pass`. D15 gives the merged step phase `1-4` and `resume: [gate-c-ac-dryrun, wave-plan]` (PS3 updated, PR B text names the FR-025 extension). New `cases/s-path-text.cjs` SP1-SP5 (incl. "no S-branch line in 04-plan names `a1-vincente-vibe-optimizer`" and CLI/text agreement). Kritis pin changes listed with red runs: P rows for 02-specify/03-clarify in `prompts.allowed-diff`, D 03-clarify `37`→`38`, a new D `elif` for 02-specify; P-mut 02-specify stays byte-unchanged, new K4 carries its guard. Measured: 217/4 with the two lines and no pin change, 221/0 with the listed pin changes. Touched-file pin table gains rows for the four files. V19 added. |
| m1 blank anchor for `delete-after` | Fixed | Anchor `loud when triaging.` (occurs once in golden and current, measured); 12 `gone` rows (blank, `**What shrinks…**`, blank, header, separator, 6 rows, blank); inserted block starts and ends with a blank line; the "no shared line" rule now covers non-blank lines. |
| m2 RR_POS on 05-merge item 3 | Fixed | D17 and Task 9.2: F becomes item 3, old items 3-4 become 4-5, the old item-3 line keeps every byte after its digit, the condition is appended at the end of the item. |
| m3 quoting of `<phase_goal>` / `<spec title>` | Fixed | Quoted heredoc `<<'A1_GOAL_EOF'` in the Phase-start block (and so in Step 1b); FL12/FL14 use an apostrophe and `$(touch PWNED)`; RED-proof (j) restores the `printf` form. Measured verbatim, no PWNED file. |
| m4 2.3d dirties `.a1/reservations.json` | Fixed | D5 and Task 2.1 (d): after a stage call, 2.3d commits the file on the primary checkout's `main` at once (push-cadence P3; push batched with the session step). Field-owner row; RV6; RED-proof (i). |
| m5 PLAN without `lanes:` stops every wave | Fixed | D7 check 6: no `lanes:` and no `--plan` (default a1-execute PLAN.md) is treated like `lanes: none`; with `--plan` the wave-plan rule applies. Help names both. NC31; RED-proof (k). |
| m6 help paragraph joins the `wave next-check` block | Fixed | Task 1.1 action 6: one empty line before `  Input-hash reuse (spec 027 FR-020):`; help-lean case asserts it; RED-proof (l). |
| V16 count | Updated | 98 RED-proof mutations + 1 planted sweep run = 99 lines (T1.1 12, T2.1 9, T2.2 11, T4.1 11, T9.1 11; others unchanged). |

Lane split and depth check re-run after this revision (outputs in the hand-back).
