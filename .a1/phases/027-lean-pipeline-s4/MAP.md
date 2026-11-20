---
focus: all
generated: 2026-11-20
---

# Codebase Map: 027-lean-pipeline slice 4 (A = FR-019..022, B = FR-023..026)

Measured at `main` 54836f2. `git status` shows only `?? .a1/phases/027-lean-pipeline-s4/`. `A1_VAULT_ROOT=/home/rob/N3URAL-Vault`.

## Structure (only what this slice touches)

```
_shared/a1-tools.cjs            facade, 784/800 lines (group dispatch inside main(); lazy require per group)
_shared/gates-registry.md       registry rows (pr-reinhard l.54, lane-split l.32, gate-0.6/0.7 l.36-37, 4.5 l.41, test-fidelity l.72, fix-class-sweep l.73)
_shared/quality-invariants.json 12 keep-list gates (pr-reinhard: owner_ref 02-review.md, must_contain a1-reinhard-reviewer)
_shared/lib/                    gate-log, gates-lint, workflow-lint(+ -verify), lane-split, fix-class-sweep, checklist, code-scope, worktree, run-record, help-*.cjs
skills/a1-pr-review/workflows/  02-review, 03-draft, 04-submit, 05-merge
skills/a1-execute/workflows/    02-execute, 03-verify
skills/a1-new-feature/          SKILL.md + workflows 04.5, 05-implement, 06-verify
skills/a1-plan/workflows/       01-research, 02-map, 04-audit
_test-fixtures/                 one dir per suite, run-tests.sh sources cases-*.sh parts
```

## Tech Stack

Node >= 18 CommonJS (`'use strict'`, `.cjs`), no dependency. Bash fixture suites. Markdown skills. Repo state: `.a1/xprov.json` external_review denied, so plan review is Reinhard-only. CI/test shape: `.a1/verify.json` `each: _test-fixtures/*/run*.sh`; `ci_evidence.unchanged` lists `.github/` and `_test-fixtures/suite-groups.json`.

## Architecture

- Facade `main()` dispatches by `group` (if/else chain). New groups should be one line, pattern at l.748: `else if (group === 'run') { require(path.join(__dirname,'lib','run-record.cjs')).cmdRun(sub, rest); return; }`. The `pr` group (l.535) is an in-facade chain: `list-handoff`, `mark-status`, `mark-pr-open`, `findings-summary`, then `merge-check` (l.540, lazy require of `pr-merge-check.cjs`). Add the two new `pr` subs as one lazy branch there.
- Gate log: the facade hook `installGateLog` (gate-log.cjs l.429) is the only writer. It strips `--phase` (`stripPhase` l.348), keeps scope in a local `const scope = stripped.scope || UNSCOPED` (l.444). `currentScope()` does not exist (grep over `_shared`: 0 hits). `setRecordExtra` l.86 and `EXTRA_RULES` l.47 (`input_hash`, `reused`, `ci_evidence_why`, `scanned`) exist; `verifyChain` l.301, `matchInvoke` l.335 are exported.
- Lint stack: `gates lint` (gates-lint.cjs, 198 lines: `gradeRow` l.110, `checkSkills` l.~134, `findCalls` exported; `callRegex`) and `workflow lint` (workflow-lint.cjs 433 lines; rule modules plug in at l.~404-418 via `workflow-lint-verify.cjs` 181 lines, fence helpers passed as a parameter). `gate-ids.cjs` `rowInvokes` parses the invoke column.
- Child-process rule: `lane-split.cjs` (483) and `fix-class-sweep.cjs` (341) call `emitExit`/`process.exit` themselves; `cmdFixClassSweep(_sub, rest)` l.326, `cmdLaneSplitCheck(args)` l.312, `cmdChecklistRun(args)` checklist.cjs l.662 (exports l.823).

## Per-FR file and function map

| FR | Code touched | Workflow/registry touched | Lines now |
|---|---|---|---|
| 019 | NEW `pr-review-record.cjs` (record, evidence); `gates-lint.cjs` `gradeRow` l.121 (rule `prompt_names_command`); facade `pr` chain l.535-541 (+1 branch); NEW `help-*.cjs` entry (pattern `help-run.cjs`, import in `help.cjs` l.19) | `gates-registry.md:54` invoke cell `none` -> `pr review-record` @ a1-pr-review; `02-review.md` (180) call after Reinhard returns, BLOCKER=fail; `06-verify.md` Step 0 (l.17-30, the early Reinhard spawn) and the `code-scope stage --set review` block (l.248-252, "normally already done in Step 0"); `SKILL.md:278` Review stage row | gates-lint 198 |
| 020 | `gate-log.cjs` add `currentScope()` export (465 -> ~475); NEW `reuse-hash.cjs`; call sites: facade `checklist run` branch l.504-509 (do not edit `checklist.cjs`, 823/800), `lane-split.cjs` l.312, `fix-class-sweep.cjs` l.326; `run-record.cjs` (179) only if `reused` records must be excluded from duration sums | registry rows l.32, 41, 73 (text only if needed) | checklist 823 (OVER cap), gate-log 465 |
| 021 | NEW `wave-next-check.cjs` (+ `wave` facade line); NEW lint rule in a new module beside `workflow-lint-verify.cjs` (hook l.~404-418 in `workflow-lint.cjs`, 433) | `02-execute.md` l.226-248 (`Continue? [y to proceed / n to stop]` at l.235, "Wait for user input" at l.248; the GOAL.md Decisions text l.238-246 is the `scope_change` source); `05-implement.md` l.85-92 (agent-confirm, "Do **not** dispatch automatically" l.92) | workflow-lint 433 |
| 022 | lint rule only (same new module) | `03-draft.md:103-108` (create-PR question, "adjust draft" bullet l.108), `04-submit.md:8-9` re-ask, `04-submit.md:74` "User aborts at confirm". Keep force-push asks `04-submit.md:29,73` | 03-draft 113, 04-submit 87 |
| 023 | NEW lint module for `<!-- a1:parallel group=<id> -->` | `01-research.md` (37; "before Marco and Pablo run" sentence ~l.30-35), `02-map.md` (31; files_to_read block l.12-16 is RESEARCH.md only), `04-audit.md` l.40-55 (vault sync + dashboard build fence); also `_shared/agent-lessons.md#rico-decisions-needed` | - |
| 024 | NEW `wave checks` inside the `wave` module (spawns the three subcommands as child CLI processes with `--phase`); `verify-cli.cjs` (91) `writeOut` is the race point, read only | `03-verify.md` (275) and `06-verify.md` (469; fence at l.~72-78 `verify run --out`); `02-execute.md` l.112-140 and `05-implement.md` l.~210-255 literal calls of realpath-check/schema-check/test-fidelity | - |
| 025 | NEW `feature-plan-steps.cjs` (data table per size); `spec.cjs` (330) `SPEC_SIZES` read only | `a1-new-feature/SKILL.md` l.85-123 "Size triage & fast path" table (453-line file; net shrink) | SKILL 453 |
| 026 | NEW `feature-close.cjs` (child CLI processes for `code-scope stage|release`, `spec update-status`, `worktree exit`, `run record`; `git-safe.cjs` (45) for git argv; `A1_GH_BIN` seam in `pr-merge-check.cjs:75`) | `05-merge.md` (147), `SKILL.md` Lifecycle Completion Gate l.269-301 | code-scope 320, worktree 694 |

`code-scope.cjs`: stages `started,complete,review,verify,merge,origin-cleanup,done` (l.90); `cmdCodeScopeStage` l.193 rejects only `nextIdx < currentIdx` (l.212), so a repeat of the same stage is not rejected by that check (read from code, not run). `cmdCodeScopeRelease` ~l.238.

## Line counts against the caps

| File | Lines | Cap | Headroom |
|---|---|---|---|
| `_shared/a1-tools.cjs` | 784 | 800 | 16 |
| `_shared/lib/checklist.cjs` | 823 | 800 | over by 23, no edit allowed |
| `_shared/lib/gate-log.cjs` | 465 | 800 | 335 |
| `_shared/lib/gates-lint.cjs` | 198 | 800 | 602 |
| `_shared/lib/workflow-lint.cjs` | 433 | 800 | 367 |
| `_shared/lib/workflow-lint-verify.cjs` | 181 | 800 | 619 |
| `_shared/lib/lane-split.cjs` / `fix-class-sweep.cjs` | 483 / 341 | 800 | 317 / 459 |
| `_shared/lib/help.cjs` | 707 | 800 | 93 (new help goes in a `help-*.cjs`) |
| `worktree.cjs` / `verify-run.cjs` | 694 / 692 | 800 | read only |

Other files over 800 exist only in xprov modules (`xprov-snapshot.cjs` 1038, `xprov-run.cjs` 918, `xprov-preflight.cjs` 809, `xprov-allowlist.cjs` 804); not in scope.

## Pins that constrain skill-text and lint edits

1. **`prompt_names_command`** (`gates-lint.cjs:121`): `(class === 'prompt' || 'human') && kind === 'command'` emits the finding. FR-019 needs an invoke on the `pr-reinhard` prompt row, so the rule must be relaxed for that one row (data-driven or id exception). Fixture R3b (`_test-fixtures/a1-gates-lint/run-tests.sh:139-142`) plants `| none |` -> `` `check reservations` @ a1-new-feature `` on `gate-c-ac-dryrun` and expects `prompt_names_command`. It must stay red for that row. Keep R3b byte-unchanged and add a sibling case for `pr-reinhard` green.
2. After the registry cell changes, `checkSkills` demands a literal fenced `pr review-record` call in `a1-pr-review` files and, when the skill wires gate-log, a `--phase` on it (`call_without_phase`). `duplicate_subcommand` rejects a second row with the same subcommand.
3. **`run-wave14.sh:108`** ("keep-list" oracle IDS) lists `pr-reinhard` with `quality-invariants.json` (owner_ref `02-review.md`, must_contain `a1-reinhard-reviewer`). `02-review.md` must keep the anchor.
4. **`check-wave11-callsites.cjs`** (`_test-fixtures/a1-gates-lint/`) pins exact per-file call counts: `02-execute.md` {realpath-check run 1, schema-check run 1, test-fidelity 1, verify run 1}; `03-verify.md` {verify run 1, verify check 1}; `05-implement.md` same four as 02-execute (spec-id placeholder); `06-verify.md` {verify run 1, verify check 1}; `a1-execute/SKILL.md` {lane-split check 1}; `agents/a1-victor-verifier.md` {verify run 1, verify check 1}. FR-024 (background `verify run` in 03/06-verify) and a `wave checks` that replaces the three literals both change these counts. Edit the pin deliberately, or keep the literals. Its allowed-flag table has no `wave checks`.
5. **`workflow-lint-verify.cjs`**: `verify-scope` (per-wave `verify run` must carry `--affected`; Verify-step `verify run` in `03-verify.md`, `06-verify.md`, `agents/a1-victor-verifier.md` must not); `verify-reuse-ban` (no `verify reuse` in `05-merge.md` or `pr-merge-check.cjs`); `quiet-host-poll` (no `pgrep` in any fenced block under `skills/`: a background-PID join in FR-024 must use `wait`/`kill -0`, not `pgrep`). A background start of `verify run` is one of the "Verify-step" calls and must not add `--affected`.
6. **`a1-pr-review/run-tests.sh` 05-merge.md pins (l.~244-275)**:
   - exactly 6 fenced bash blocks (`b.length = 6`);
   - block order string `DCMGRP` (classifier: `/run record/` -> R, `/probe run/` -> P, `/pr merge-check/` -> M, `^gh pr merge ` -> G, `/disposition review/` -> D, `/product validate --spec-status --require-vault/` -> C; first match wins, so a `feature close` block that mentions `run record` would classify as R);
   - `b[3]` byte-exact `gh pr merge <n> --squash --match-head-commit <head_sha>`;
   - run record block between `1. Retros, each with` and `\d. a1-worktree exit discard`;
   - first three blocks test `RC=$?`, `-ne 0`, `exit "$RC"`; blocks 1-2 carry `--phase pr-<n>`, block 0 carries none.
   A seventh block for `feature close` changes the count and the order string; replacing the R block removes the R pin. Either way these are listed assert changes.
7. **Corpus copies**: `_test-fixtures/a1-gates-lint/corpus/skills/...` holds copies of `02-execute.md`, `05-implement.md`, `04.5-consistency-gate.md`, `02-review.md`, `SKILL.md`. They contain the "Continue?" and "Wait for user" strings today. They are fixture inputs, not the live tree, so edits to live skills do not touch them. A new lint over the live tree must not scan the corpus.
8. `04.5-consistency-gate.md` and `05-implement.md:25` carry `checklist run ... --only 9,10,11 --format json --phase`; `a1-checklist/workflows/01-run.md:28,37,51` call `checklist run` without `--only`. Reuse keyed on `--only 9,10,11` leaves those untouched.
9. `a1-exit2-audit/run-tests.sh` (107 lines) and `a1-cli-output` inspect every command's exit-2 paths and help text; each new command needs a help entry and exit-2 on bad input.

## Fixture suites that can host new `cases-*.sh` (no new suite dir)

`suite-groups.json` lists suites per CI job by file (`a1-gates-lint/run-tests.sh`, `run-wave13.sh`, `run-wave14.sh`, `a1-lane-split/run-tests.sh`, `a1-fix-class-sweep/run-tests.sh`, `a1-code-scope/run-tests.sh`, ...). A new `run*.sh` file is a new entry (`--check-groups`) and would change a frozen-unchanged file. A new `cases-*.sh` that an existing `run-tests.sh` sources adds none. Files `cases-*.sh` do not match `run*.sh` of `.a1/verify.json` `each`.

| Suite | Existing parts / source line | Summary location (cases must be sourced before it) | Hosts |
|---|---|---|---|
| `a1-workflow-lint` (419) | `cases-verify-scope.sh`, `cases-quiet-host.sh` sourced at l.408-409; case calls l.411-413 (`caseW1..16; caseVS1..8; caseQH1..7`) | `printf results` l.415 | FR-021 prompt lint, FR-022 confirmation lint, FR-023 parallel lint, FR-024 background markers. Pattern: `caseXX` functions, then add the call to the list |
| `a1-gates-lint` (493) | none; `run-wave13.sh`, `run-wave14.sh` exist (already in groups) | last lines print `a1-gates-lint: $pass passed` | FR-019 relaxed rule (new `cases-pr-reinhard.sh`), `wave checks` wiring if `findCalls` learns it. Helpers `ok`/`bad` |
| `a1-pr-review` (361) | none (all in run-tests.sh) | ends `echo "a1-pr-review: ..."` l.358-360 | FR-019 `review-record` / `review-evidence` cases (needs a fake git head), FR-026 05-merge pin updates; uses `pass_case`/`fail_case` |
| `a1-lane-split` (305) | none | - | FR-020 lane-split reuse |
| `a1-fix-class-sweep` (327) | `real/` dir | - | FR-020 class-sweep reuse |
| `a1-code-scope` (618) | none | - | FR-026 stage idempotence |
| `a1-worktree` (864) | `cases-gatelog.sh` sourced l.855 | - | FR-026 worktree exit via `feature close` |
| `a1-checklist` | in `suite-groups.json` (fixtures-rest) | - | FR-020 gate-4.5 reuse if a better host than gates-lint |

Placement for the rest (no existing host measured): `wave next-check` / `wave checks` -> `a1-gates-lint` cases (reads gate logs) or `a1-code-scope`; `feature plan-steps` -> `a1-lib-units` (has `cases/` dir, `lib.cjs`) or `a1-workflow-lint`; `feature close` -> `a1-code-scope` + `a1-worktree` (needs fake `gh` through `A1_GH_BIN`, second clone). Fixtures follow `_test-fixtures/CONVENTIONS.md` (`unset A1_VAULT_ROOT`, `lib/tmp.sh`, `lib/vlock.sh` private lock).

## Overlap of Part A and Part B (per file)

| File | A edits | B edits | Order effect |
|---|---|---|---|
| `skills/a1-new-feature/workflows/06-verify.md` | remove Step 0 early Reinhard (l.17-30), re-point the `review` stage (l.248-252) | add background `verify run` start/join (fence l.~72-78) | B rebases on A; same file, different regions |
| `skills/a1-execute/workflows/02-execute.md` | remove `Continue?` / wait (l.226-248) | `wave checks` for the three literals (l.112-140) | same file, B rebases |
| `skills/a1-new-feature/workflows/05-implement.md` | remove agent-confirm (l.85-92) | `wave checks` (l.~210-255) | same file, B rebases |
| `skills/a1-new-feature/SKILL.md` | Review row (l.278) | size-S table (l.85-123), Completion Gate (l.269-301) | same file, B rebases |
| `skills/a1-execute/workflows/03-verify.md` | none | background `verify run` | B only |
| `skills/a1-pr-review/workflows/02-review.md` | review-record call | none | A only |
| `skills/a1-pr-review/workflows/03-draft.md`, `04-submit.md` | confirmation removal | none | A only |
| `skills/a1-pr-review/workflows/05-merge.md` | none | feature-close block / pin change | B only |
| `skills/a1-plan/workflows/01-research.md`, `02-map.md`, `04-audit.md` | none | parallel markers | B only |
| `_shared/a1-tools.cjs` | `pr` branch + `wave` line (use ~2-3 of 16 lines) | `feature` line, `wave checks` rides on `wave` | cumulative use ~3-5 lines |
| `_shared/lib/workflow-lint.cjs` | hook line for FR-021/022 module | hook line for FR-023/024 module (or reuse A's module) | same hook region, B rebases |
| `_shared/lib/gates-lint.cjs`, `gate-log.cjs`, `gates-registry.md`, `lane-split.cjs`, `fix-class-sweep.cjs` | yes | none | A only |
| `_test-fixtures/a1-workflow-lint/run-tests.sh` (call list l.411-413, sourcing l.408-409) | add sourcing + calls | add sourcing + calls | both edit the same lines, B rebases |
| `_test-fixtures/a1-pr-review/run-tests.sh` | `review-record` cases | 05-merge pin change | different regions |
| `_test-fixtures/a1-gates-lint/check-wave11-callsites.cjs` | none | call-count pin (FR-024) | B only |
| `a1-tools.cjs` usage string (the long "unknown command group" text) | add `wave`, `pr` subs | add `feature` | same line, B rebases |

The `wave` module is created in A (`next-check`) and extended in B (`checks`); `help-*` file for it likewise.

## Quality Notes

- Slice 1-3 baseline: `bash bin/run-suites.sh` before every PR; the aiserver env-red list is empty since PR #103 (memory note).
- No test exists for the `wave`, `feature`, `pr review-*` commands (they do not exist). `reuse-hash` has no counterpart.
- `checklist.cjs` is already over its cap; slice 3 did not shrink it. Do not touch it.
- Measured gate cost (from RESEARCH): the three FR-020 gates cost 3-70 ms; value is stale-pass protection, not time.

## Concerns (ordered)

1. FR-026 `feature close` deletes local branches and exits worktrees. The called commands exit the process (`emitExit`), so it must spawn child CLI processes. Review depth: Reinhard; Samuel only if `pr-security-surface` flags it.
2. The `05-merge.md` DCMGRP pin and `b[3]` byte pin (see Pins 6): a mis-placed `run record` mention in a new block changes the classifier result.
3. `check-wave11-callsites.cjs` per-file call counts break on FR-024 as soon as a second `verify run` fence or a `wave checks` replacement lands.
4. The `gates lint` wiring for `wave checks`: literals must stay visible to `findCalls` or `findCalls`/`callRegex` must learn the command.
5. Facade headroom 16 lines; the long usage string at the end of `main()` must also list the new groups (single line edit, same line by A and B).
6. `gate-log.cjs` `currentScope()` is new API in the only gate-log writer; tests for it belong in `a1-worktree/cases-gatelog.sh` (existing gate-log hook cases) or a gates-lint case.

## Relevant for This Task (facts for the planner)

- Files over cap: only `checklist.cjs` (823). Facade has 16 lines left.
- Existing fixture cases-parts: `a1-workflow-lint` (2), `a1-worktree` (1). The other suites must gain a first `cases-*.sh` sourced by their `run-tests.sh` before the summary lines.
- `suite-groups.json` and `.github/` are in `ci_evidence.unchanged`; a new `run*.sh` is a new group entry. `cases-*.sh` sourced from an existing suite need none.
- Pins that must change deliberately: `check-wave11-callsites.cjs` counts (B), `a1-pr-review/run-tests.sh` block count and order (B), the `prompt_names_command` rule (A) while R3b stays unchanged. Pins that must stay: `b[3]` merge block, R3b, quality-invariants `pr-reinhard` anchor, `verify-scope`, `quiet-host-poll`, the force-push asks in `04-submit.md`.
- Open question (not measured): whether `gates lint` run-wave13/14 fixtures compare the real registry's `pr-reinhard` invoke cell; `run-wave14.sh:108` lists the id only. Check by running `bash _test-fixtures/a1-gates-lint/run-wave14.sh` after the registry edit.
