---
phase: 027-lean-pipeline-s5
goal: Ship delivery slice 5 of spec 027-lean-pipeline ("Reading path and bookkeeping", US-027-10, US-027-11, FR-027..FR-032) as one PR. Rare-case text leaves the default reading path behind trigger commands, the Isolation Gate shrinks to pointers with a lint against raw worktree/branch-delete commands, `feature close` writes one machine retro per PR and asks for prose only on a catch, failure or named issue, per-wave vault sync goes, PLAN-REVIEW-LOG.md becomes opt-in, and `skills/reading-budget.json` locks the achieved sizes with a ratchet. SC-006 holds: the a1-new-feature default path ends below 2378 lines (measured 2560 at c6b10a2, target at most 2360). Every keep-list gate stays load-bearing.
spec: /home/rob/N3URAL-Vault/project/a1-specforge/spec/027-lean-pipeline.md (slice 5 only - US-027-10, US-027-11, FR-027..FR-032, SC-006, SC-009, Acceptance Scenarios US-027-10/11, Edge Case "last-run files", Quality Invariants, Delivery Slices item 5, Clarifications 2026-11-12); RESEARCH.md Answers (2026-11-23, all defaults adopted)
waves: 13
revision: 3
lanes:
  - id: lint
    waves: [1, 2]
    owns:
      - "_shared/lib/workflow-lint-budget.cjs"
      - "_shared/lib/workflow-budget.cjs"
      - "_shared/lib/workflow-lint-read.cjs"
      - "_test-fixtures/a1-workflow-lint/cases-budget.sh"
      - "_test-fixtures/a1-workflow-lint/cases-read.sh"
      - "_test-fixtures/a1-workflow-lint/run-tests.sh"
    agent: a1-erik-executor
  - id: retro
    waves: [3, 4]
    owns:
      - "_shared/lib/machine-retro.cjs"
      - "_shared/lib/feature-close.cjs"
      - "_shared/lib/retro-gatelog.cjs"
      - "_shared/lib/help-lean.cjs"
      - "_test-fixtures/a1-lib-units/cases/machine-retro.cjs"
      - "_test-fixtures/a1-lib-units/cases/feature-close-retro.cjs"
      - "_test-fixtures/a1-lib-units/cases/help-lean.cjs"
    agent: a1-erik-executor
  - id: xprov
    waves: [5, 6]
    owns:
      - "_shared/lib/xprov.cjs"
      - "_shared/lib/help-xprov.cjs"
      - "_shared/lib/help-xprov-consent.cjs"
      - "_shared/lib/help-xprov-topics.cjs"
      - "_shared/lib/optin-logs.cjs"
      - "_shared/lib/xprov-run.cjs"
      - "_shared/lib/xprov-gate.cjs"
      - "_shared/lib/xprov-observe.cjs"
      - "bin/check-optin-readers.cjs"
      - "_test-fixtures/a1-xprov/run-tests.sh"
      - "_test-fixtures/a1-xprov/parts/39-help-topics.sh"
      - "_test-fixtures/a1-xprov/parts/40-optin-log.sh"
      - "_test-fixtures/a1-xprov/parts/41-plan-reading-path.sh"
      - "skills/a1-plan/**"
      - "skills/a1-execute/workflows/01-load.md"
    agent: a1-erik-executor
  - id: cuts
    waves: [7, 8, 9]
    owns:
      - "skills/a1-new-feature/SKILL.md"
      - "skills/a1-new-feature/workflows/kritis.md"
      - "skills/a1-new-feature/workflows/06-verify.md"
      - "skills/a1-new-feature/workflows/retro-prose.md"
      - "skills/a1-execute/SKILL.md"
      - "skills/a1-execute/workflows/multi-lane.md"
      - "skills/a1-fix/SKILL.md"
      - "skills/a1-quick/SKILL.md"
      - "skills/a1-pr-review/SKILL.md"
      - "_test-fixtures/a1-kritis-profile/**"
      - "_test-fixtures/a1-retro-validate/run-tests.sh"
      - "_test-fixtures/a1-intent/**"
      - "_test-fixtures/a1-quick/run-tests.sh"
      - "_test-fixtures/a1-pr-review/run-tests.sh"
    agent: a1-erik-executor
sequential_after_lanes: [10, 11, 12, 13]
status: revised
created: 2026-11-23
revised: 2026-11-23
phase_kind: code
---

## Depth Pass

### 1 What a top professional would do
- Measure first, with one counting function that the lint, the budget writer and the SC-006 check all share. Never cut by eye, and never "fix" a count by reflowing text into longer lines. So this plan caps line length in the cut files and asserts a character drop as well as a line drop.
- Treat every text move as a refactor with a proof:
  - a moved block is byte-identical to its source range at `c6b10a2`;
  - every pin the move breaks is listed by ID, with a red run on the old pin and on the new one;
  - the kritis goldens are never regenerated.
- Prove "never whether" for each keep-list gate the slice touches:
  - On a denied repository, `plan-review-xprov` still gets its retro row. `xprov load-check` already reads the permit state at check time (`xprov-gate.cjs:582-590`), so skipping 04b does not break a1-execute Load.
  - `gate-c-ac-dryrun`, `plan-audit` and `pr-reinhard` keep their owner strings.
  - The `xprov` chain (permit-check, preflight, gitleaks, tripwire) is not edited.
- Separate "mentions a file" from "reads a file" explicitly: an allowlist with reasons, and every other mention counts as a reader. Over-approximation fails safe, because the file then stays always-on.
- Make the ratchet fail closed with git-native trailers. Run it where the full history exists, the merge step. Do not pretend that a depth-1 CI checkout can see a base.
- Find the lane split. The four FR families touch disjoint write sets, so they run as four lanes, and only the cross-cutting integration stays serial.

### 2 Rawest material
- The files themselves at `main` `c6b10a2`, read during planning:
  - `skills/a1-new-feature/SKILL.md`: kritis block 150-188, Lifecycle 269-309, Marketing 311-340, Isolation 341-374. The resolve line 148 is pinned as `WIRE_RESOLVE`.
  - `06-verify.md`: Step 5 293-419, Step 6 443-509, Tobi 511-522.
  - `skills/a1-execute/SKILL.md` 147-213; `04-audit.md` 1-119.
  - `04b-xprov-review.md`: 358 lines, 26 802 bytes, longest line 925 characters.
  - `05-merge.md` 89-177.
- The code:
  - `feature-close.cjs`: plan order at the end of `closeFeature`, `--check-only` plan `[checkPr, findWorktree]`.
  - `retro-gatelog.cjs`: `gatesFired`, private `mergeByTs`.
  - `run-record.cjs` (`storeDir`, `gateEntries`).
  - `xprov-gate.cjs` `loadCheck` (permit branch) and both `appendLog` writers.
  - `xprov-run.cjs`: 918 lines, already over the 800 cap; `--no-log`.
  - `xprov.cjs` `cmdXprov`: `--help` exits 2 today, measured.
  - `workflow-lint.cjs` 443 lines (`REQUIRED_VAULT_SYNC_FILES`, output object).
  - the intent H7a scan regex (`05b-child-seal.sh:395-435`, distinct `<group> <sub>` keys per skill dir, floors).
- The fixture assert lines that read the text:
  - a1-xprov R2e (`06-gate.sh:154-157`), RQ8/RQ12, T10 (`36-design-targets.sh:194-205`), P13;
  - kritis P, P-allowed, B, D (`01-golden.sh:194-300`, `08-wiring.sh:36-215`);
  - retro-validate V8/L12;
  - workflow-lint W11-W14 and FC3;
  - a1-dashboard 05.24-05.29;
  - a1-pr-review :228 and :336-340.
- Live outputs:
  - `xprov permit-check` on this repo prints `state: denied`.
  - `lane-split check` prints `"lanes": N`.
  - A real learning-store entry shape is in `$A1_VAULT_ROOT/pattern/a1-learnings/a1-new-feature.md` (`---` blocks with `date:` ... `gates_fired:`).

### 3 Methods and tools
- Counting is a `wc -l`-equivalent newline count in `workflow-lint-budget.cjs`. The fixture compares it with `cat … | wc -l`.
- The kritis harness: `prompts.allowed-diff` with `delete-after`/`gone` and `insert-after`/`line` (s4 precedent), and the literal P-allowed simulation.
- RED-proof runs on a `git archive` scratch copy. Each pin change gets two red runs: the old pin fails on the new tree, and the new pin fails on a mutation.
- `node _shared/a1-tools.cjs lane-split check --plan … [--imports .]`.
- `workflow lint` / `gates lint` on the real tree, and `verify run --affected --no-cache` per wave.
- `git log <base>..HEAD --format='%(trailers:key=budget-raise,valueonly)'` for the ratchet.
- Module-level tests (a1-lib-units case files, a1-workflow-lint case files that `require` the module) so lanes never need the facade line before the integration wave.

### 4 External evidence of correctness
- The fixture suites (`bash bin/run-suites.sh`, 63 suites on `c6b10a2`), with the new cases red on `c6b10a2` and green on the head.
- `node _shared/a1-tools.cjs gates lint` exit 0: the keep-list owner strings survive.
- `workflow lint` exit 0 on the real tree, with the reading-path rules active.
- `workflow budget` measuring a1-new-feature below 2378.
- `retro validate --gate-log` accepting the machine record that `feature close` wrote.
- `xprov load-check` printing `accepted: "not_applicable"` for a plan in a denied repository that never ran 04b.
- The GitHub Actions `checks` job and the fixture jobs on the PR.
- The reviewers Reinhard (`a1-reinhard-reviewer`) and Samuel (`a1-samuel-security`).

### Rewritten brief
Plan slice 5 as one PR in four parallel lanes plus three serial waves. The lanes:
- **lint** (FR-027 counting and ratchet, FR-028/FR-030/FR-032 lint rules, module level);
- **retro** (FR-031 machine retro and prose decision inside `feature close`);
- **xprov** (FR-028a/b: permit-check step in 04-audit, 04b down to at most 80 lines with the moved text behind `xprov --help <topic>`; FR-032 opt-in for PLAN-REVIEW-LOG.md and the reader check);
- **cuts** (FR-029/FR-030/FR-028c text moves: SKILL.md kritis block to a conditional `kritis.md`, Marketing Gate out, Isolation Gate to three pointer lines, multi-lane section to `multi-lane.md`, a1-new-feature Step 6 retro to a conditional `retro-prose.md`, and listed compressions in 06-verify until the default path is at most 2360).

Then:
- integration: per-wave sync removal, the 05-merge retro and budget steps, the facade line, help;
- hook the rules and write the budgets from the achieved sizes;
- review (Reinhard plus Samuel) and merge;
- after the merge: the global `a1-landing-feature` edit on both hosts, and the owner readings plus follow-ups written into the spec `## Clarifications` and the vault hub, listed in the final report to the owner (Wave 13).

Constraints:
- Every moved block is proven byte-identical.
- Every broken pin is listed with red runs.
- No golden is regenerated.
- The facade stays at most 790 lines and `workflow-lint.cjs` at most 445.
- `xprov-run.cjs` does not grow.
- Each reading of an ambiguous spec sentence is named for the owner's reconcile, and Wave 13 writes it where the owner reads it (spec `## Clarifications`, vault hub, final report).

# Plan: 027-lean-pipeline-s5

## Goal
Ship delivery slice 5 of spec 027-lean-pipeline ("Reading path and bookkeeping", US-027-10, US-027-11, FR-027..FR-032) as one PR. Rare-case text leaves the default reading path behind trigger commands, the Isolation Gate shrinks to pointers with a lint against raw worktree/branch-delete commands, `feature close` writes one machine retro per PR and asks for prose only on a catch, failure or named issue, per-wave vault sync goes, PLAN-REVIEW-LOG.md becomes opt-in, and `skills/reading-budget.json` locks the achieved sizes with a ratchet. SC-006 holds: the a1-new-feature default path ends below 2378 lines (measured 2560 at c6b10a2, target at most 2360). Every keep-list gate stays load-bearing.

## PR boundary (read first)
| | Value |
|---|---|
| PR count | One PR. If Reinhard asks for a split by size, the split point is after Wave 6: PR A = lanes lint, retro and xprov (code + 04-audit/04b; the hook and budgets wait), PR B = lane cuts + Waves 10-13. No other split. |
| Starts from | `main` @ the commit of the P0 chore PR |
| Worktree | `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s5/`, plus one lane worktree per lane from a1-execute (`feature/027-lean-pipeline-s5-<lane>`) |
| Review | Reinhard (always) and Samuel, spawned explicitly (Task 12.1). `xprov scope` is expected to report `security_surface: false`: no `.github/`, no lockfile, no path in the forbidden-surface globs. Samuel still runs, because the slice changes the reading path of the egress gate (04b skipped on `denied`), turns an egress audit file opt-in, edits the frozen `xprov.cjs` dispatch, and makes `feature close` write into the learning store. |
| Merge-check | Once, default path (CI evidence when green). `.github/`, `.a1/verify.json` and `_test-fixtures/suite-groups.json` stay unchanged (V14). |

Gate-log scope (`--phase`) for every gate call in this phase: `027-lean-pipeline-s5`. `gates lint` takes no `--phase`.

**code_scope paths (one claim, `--by 027-lean-pipeline`, P0):** every path in the four `owns:` lists above, plus:
- `_shared/a1-tools.cjs`, `_shared/lib/workflow-lint.cjs`
- `skills/a1-execute/workflows/02-execute.md`
- `skills/a1-pr-review/workflows/04-submit.md`, `skills/a1-pr-review/workflows/05-merge.md`
- `skills/reading-budget.json`
- `_test-fixtures/a1-gates-lint/**`, `_test-fixtures/a1-dashboard/parts/05-wiring.sh`, `_test-fixtures/a1-lib-units/cases/help-texts.cjs`
- `docs/adr/2026-11-23-reading-budget-and-conditional-load.md`
- `_test-fixtures/a1-pr-review/cases-retro-step.sh`, `_test-fixtures/CONVENTIONS.md`
- `skills/a1-new-feature/workflows/05-implement.md` (Task 11.1 reserve cut)
- deferred-pin targets: `_test-fixtures/a1-xprov/parts/06-gate.sh`, `parts/12-*.sh`, `parts/19-*.sh`, `parts/29-recovery.sh`, `parts/36-design-targets.sh`, `_test-fixtures/a1-ux-studio/**`, `_test-fixtures/a1-metrics/parts/04-audit.sh`, `_test-fixtures/a1-verify/cases-envred.sh`, `_test-fixtures/a1-probe/parts/06-wiring.sh`

The vault writes of Wave 13 (spec `## Clarifications`, hub `project/a1-specforge.md`) and the global skill `~/.claude/skills/a1-landing-feature/SKILL.md` lie outside the repo and outside the claim.

## Execution location (read first)
- **Pre-step P0 (orchestrator, before any wave, not a wave).**
  1. Commit this phase folder plus the scope claim on a chore branch.
  2. Open the chore PR, have Reinhard read it, merge it (precedent #111).
  3. Only then let a1-execute prepare the worktrees.
- All work runs in the phase worktree and its lane worktrees, created through `a1-specforge:a1-worktree`, never a raw `git worktree add`. The primary checkout `/home/rob/claude-projects/a1-specforge` stays on `main`. Nothing in a wave writes there.
- Every command and Done-when probe runs with cwd = the worktree root and repo-relative paths. Shell state does not carry across waves, agents or Bash calls; every wave defines its own variables.
- **Per-wave gate:** `node /home/rob/claude-projects/a1-specforge/_shared/a1-tools.cjs verify run --affected --no-cache --project "$WORK_PATH" --phase 027-lean-pipeline-s5`. This is the primary checkout's CLI on `main`; the installed plugin may lag.
- **Per-wave reds.** aiserver has had no env-red suite since PR #103, so any red id is suspect:
  1. Re-run that suite alone on a quiet host.
  2. Still red: run it on `main` in an a1-worktree `027-s5-main-compare` (`prepare --base main`, `enter`, run, `exit --mode discard`).
  3. The same failing case names on `main` → not this slice's red: record them in `STATUS-<lane>.md` (`STATUS.md` for sequential waves) and continue.
  4. Anything else is a STOP, except the deferred-pin rule below.
- **Deferred-pin rule (any lane: lint, retro, xprov or cuts).** A lane may find a red case in a suite whose fixture files it does not own (for example `_test-fixtures/a1-gates-lint/**`, `_test-fixtures/a1-dashboard/**`). Then the lane:
  1. records `deferred pin <suite> <case id> -> Task 10.1|10.2` with the failing output in its STATUS file;
  2. edits nothing outside its `owns:`;
  3. continues only if every other case of that suite passes.

  Task 10.1 or 10.2 applies the change and its two red runs. Any other red is a STOP.
- **Touched-file pin rule.** Before editing a skill, agent or lib file F:
  1. run `grep -rln "$(basename F)" _test-fixtures | grep -v corpus/` and read every assert that names F;
  2. after the edit, run each listed suite.

  A task that adds, removes or changes a fenced `a1-tools.cjs` call line also runs:
  - `bash _test-fixtures/a1-gates-lint/run-wave13.sh` and `run-wave14.sh` (call-site flag sweep W13c/W14e);
  - `node _test-fixtures/a1-gates-lint/check-wave11-callsites.cjs .` (W11);
  - `bash _test-fixtures/a1-intent/run-tests.sh` (H7a, 05b child seal);
  - `bash _test-fixtures/a1-kritis-profile/run-tests.sh` (inventory I, wiring W) when the file is under `skills/a1-new-feature/`.
- **Shell placeholders in skill fences.**
  - Every new fenced block reads a placeholder value through the two-line quoted-heredoc guard (`{ IFS= read -r X; if IFS= read -r EXTRA; then echo "STOP: …"; exit 2; fi; } <<'A1_X_EOF'` / `<placeholder>` / `A1_X_EOF`), validates it with a `case` against `^[A-Za-z0-9_][A-Za-z0-9._-]*$`, and uses the quoted variable on the call line.
  - Never `VAR='<placeholder>'`.
  - Exception 1: a `--phase <placeholder>` that `check-wave11-callsites.cjs` requires literally (s4 STATUS line 380).
  - Exception 2, **orchestrator-substituted placeholders**, the existing convention of `05-merge.md` (lines 81, 112, 137, 159 at `c6b10a2`): `<repo>`, `<n>`, `<base>`, `<repo_root>`, `<worktree_path>`. The orchestrator replaces them with known values before it runs the fence; they are never read from user or agent text. They may stay raw on a call line. Every other placeholder (for example `<caller_spec_id>`, `<issue_tags>`) goes through the heredoc guard. Measured red run of the check that enforces this in block T (RS5, Task 10.2): a stub fence with a raw `--by <caller_spec_id>` → `RS5 red: raw <caller_spec_id>`; the same stub with only exempt tokens → green.
  - A fence that writes to a temp variable defines it in the same fence (`RD="$(mktemp)"` before the first `"$RD"`).
- **Fixture isolation, mandatory in every new test:**
  - `unset A1_VAULT_ROOT` (or an explicit temp vault in the child env only);
  - `HOME`, `TMPDIR` and cwd under a temp root;
  - planted git repos with `-c user.name=fx -c user.email=fx@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`;
  - a case that starts `verify run` exports `A1_VERIFY_LOCK_DIR` and `A1_VERIFY_LOCK_WAIT_MS=20000` and never unsets `A1_VERIFY_LOCK_TOKEN`;
  - only own PIDs (`$!`) are killed.
- **Exit discipline.** Every new module leaves through `emitExit`. A task that creates a module runs `bash _test-fixtures/a1-cli-output/run-tests.sh`.
- **Status boxes.** Each task carries one `- [ ] T<x.y> …` line with backticked artifact names. The executor sets it to `[x]` when Done-when holds (input for `phantom check`).

## Counting rule (FR-027, SC-006; fixed by this plan, RESEARCH Answers)
- **Unit:** the number of `\n` characters in a file, which is `wc -l`. A last line without a newline is not counted.
- **Default path of skill S:** `skills/S/SKILL.md` plus every `skills/S/workflows/*.md` (not recursive) whose first line is not a conditional header.
- **Conditional header:** the first line matches exactly `^<!-- load: conditional trigger=([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?) -->$`. The capture is the trigger, `<group> <sub>` or `<group>` of `a1-tools.cjs`.
- A first line that starts with `<!-- load: conditional` but does not match is a finding (`conditional_header_malformed`) and the file stays on the default path (fail closed).
- **Measured at `main` `c6b10a2`:**
  - a1-new-feature **2560**, a1-plan 762, a1-execute 1121, a1-pr-review 864, a1-fix 1183, a1-quick 295;
  - the other 12 skills as in RESEARCH "Measured baseline".
- **SC-006 target:** a1-new-feature default path **at most 2360** on the PR head (red at 2378 or more).
- **Expected after this plan:**
  - SKILL.md 461 → about 367 (kritis −38, Marketing −28, Isolation −28, one kept hard-rule line +1);
  - 06-verify.md 522 → about 410 (Step 6 −62, stale helper lines −5, Tobi −9, pre-merge −19, failure path −10, Diana brief −7);
  - total about 2354.

## RED-proof rule (applies to every task)
Each task lists RED-proof mutations. Apply each one once on a scratch copy after the task's own commit:
```bash
S=$(mktemp -d); git archive HEAD | tar -x -C "$S"
git -C "$S" init -q && git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm snap
```
Then:
1. Apply the one mutation with Edit.
2. Run the named suite or case file there.
3. Watch the named case go red.
4. Log `RED-proof <task> <mutation> -> <case> red (rc=<n>)` in the lane or wave STATUS file.

A mutation that does not turn its case red is a fixture defect: fix the fixture, never drop the line.

**Existing-assert rule.** No existing assert line in any suite is deleted or edited, except the pins in the table below. Each listed pin change carries two red runs: the old pin fails on the new tree, and the new pin fails on a mutation. A pin found during execution that is not in the table is added to STATUS with the same two red runs and named in the PR text (s4 D8 precedent).

| Pin | Where | Changed in | Change (expected; measure before editing) |
|---|---|---|---|
| kritis B (SKILL.md row) | `a1-kritis-profile/parts/08-wiring.sh` `WIRE_SIX` | Task 7.1 | `skills/a1-new-feature/SKILL.md:1` → `:0`. The block now lives in `kritis.md`, guarded by the new case K5 (not in `WIRE_SIX`, so D needs no golden copy for it). |
| kritis D (SKILL.md branch) | `08-wiring.sh` 148-206 | Task 7.1 | Replace the literal `want_rm`/`want_d` heredocs with a multiset compare. Removed non-blank lines, sorted, must equal the non-blank SKILL.md `gone` rows of `prompts.allowed-diff`, sorted. Added non-blank lines, sorted, must equal the non-blank SKILL.md `line` rows, sorted. P keeps proving positions, P-allowed keeps the independent literal simulation. |
| kritis P (SKILL.md) | `golden/prompts.allowed-diff` | Task 7.1 | New rows, appended under a dated comment block:<br>• the kritis pointer: one more `line` row in the existing resolve group, after the resolve row;<br>• Marketing: `delete-after`/`gone` + `insert-after`/`line` on one anchor, delete first;<br>• Isolation body: `delete-after`/`gone` + `insert-after`/`line`;<br>• the kept hard-rule line: `insert-after`/`line`.<br>Every anchor must match exactly once in the golden copy, or `apply-prompts-allowed.cjs` exits 3. |
| kritis P-allowed | `01-golden.sh` 251-300 | Task 7.1 | The literal simulation gains the four s5 edits, written out literally (not read from allowed-diff). |
| kritis C, I, W, R | `08-wiring.sh`, `01-golden.sh` | Task 7.1 (only if red) | Expected unchanged: moving a block inside `skills/a1-new-feature/` keeps the dir-wide counts. If one is red, it is re-pinned with two red runs. |
| retro-validate V8, L12 | `a1-retro-validate/run-tests.sh` 483-490, 869-879 | Task 8.1 | `skills/a1-new-feature/workflows/06-verify.md` → `skills/a1-new-feature/workflows/retro-prose.md` in both file lists. In L12 the expected string `06-verify.md:1/1` → `retro-prose.md:1/1`. |
| a1-pr-review :336-340 | `a1-pr-review/run-tests.sh` stale-squash scan | Task 9.1 | Drop the `grep -v 'skills/a1-new-feature/SKILL.md$'` exclusion and its comment: the Isolation cut removes the last `--squash --delete-branch`. This strengthens the pin. |
| a1-quick, a1-pr-review SKILL text pins | `a1-quick/run-tests.sh`, `a1-pr-review/run-tests.sh:228` | Task 9.1 (only if red) | The allow marker is appended at the line end, so substring greps stay green. A byte-exact line pin gets the marker. |
| workflow-lint W11, W12 | `a1-workflow-lint/run-tests.sh` 334-370 | Task 10.1 | W11 `"3 0 "` → `"2 0 "`. W12 is redefined at **module level**: copy `skills/`, append one fence `node <repo>/_shared/a1-tools.cjs vault sync x --phases` to `02-execute.md`, call `require(<repo>/_shared/lib/workflow-lint-read.cjs).checkReadingPath(work, {extractBashFenceLines, VAULT_SYNC_CALL_RE})` (both taken from `require(<repo>/_shared/lib/workflow-lint.cjs)`, the regex exported in the same task) → exactly one finding with rule `sync_per_wave` naming `02-execute.md`. It does not go through the CLI, because the CLI sees `checkReadingPath` only after the Task 11.1 hook. The CLI form of the same plant is RP8 (Task 11.1). Measured old-pin red run (plan time): on a copy whose 02-execute.md has no vault-sync fence, the old `stripVaultSyncFence` returns `removed=0`, so the old W12 is red. W13/W14 unchanged. |
| copy-based lint cases (VS1-VS7, FC1-FC6, W11-W16, QH*, run-wave13/14 copies, a1-fix wave12, a1-metrics AU3f) | `a1-workflow-lint/*.sh`, `a1-gates-lint/run-wave13.sh`/`run-wave14.sh`, `a1-fix/run-tests.sh`, `a1-metrics/parts/04-audit.sh` | none | Unchanged, by the D12a budget scope: a root without `_shared/a1-tools.cjs` gets no budget check, and none of these copies holds that file (measured: `copySkills`, `copyFull`, `copy_tree` copy `skills/`, `agents/` and at most single `_shared/lib/` files). Without D12a, VS7 goes red: its copy measures a1-execute at 1122 lines against an equality budget of 1121 (measured at plan time). BG13 guards the scope; Task 11.1 runs every listed suite after the hook. |
| a1-pr-review RR_POS | `a1-pr-review/run-tests.sh:262` (`/^1\. Retros, each with/m`) | none | Unchanged. Task 10.2 keeps the line prefix `1. Retros, each with` when it rewrites close-out item 1. |
| a1-xprov OB (part 29) | `a1-xprov/parts/29-recovery.sh:428` `fields29` | none | Unchanged: `fields29` selects named fields, and the new optional observation field `recovery` (D9) adds a key without changing them. |
| a1-dashboard 05.24, 05.27, 05.29, loop 170 | `a1-dashboard/parts/05-wiring.sh` 93-102, 170 | Task 10.1 | 05.24 "exactly three call sites, in 04-audit, 02-execute, 03-verify" → two, in 04-audit and 03-verify; 05.27 and 05.29 (02-execute) become "02-execute has no `dashboard build`"; the 170 loop drops 02-execute. |
| a1-pr-review block order | `a1-pr-review/run-tests.sh` 264-266 (`7 DCMGRFP`) | Task 10.2 | One new block T (retro decision) between G and R → count `7` → `8`, order `DCMGTRFP`. The classifier at :265 maps any block containing `feature close` to `F`, and block T contains `feature close --check-only`; so the classifier gains `/prose_required/.test(x)?"T":` as the **first** test of its chain (before D, C, M, G, R, P and F). Without it the order reads `DCMGFRFP` (audit R2-m6). Only block T contains `prose_required` (RS6). `b[3]` stays the byte-exact merge block. CB/RR_POS indices are re-pointed where they count from the end. |
| gates-lint W13d and any W11/W13c/W14e pin on 05-merge.md | `a1-gates-lint/**` | Task 10.2 | Re-pin for the new fenced calls (`feature close --check-only … --issues`, `workflow budget --base`), and for any deferred pin from a lane. |
| help-lean H-cases | `a1-lib-units/cases/help-lean.cjs` | Task 4.1, Task 10.2 | The `feature close` usage line gains `[--issues <tags>]` (4.1). A `workflow budget` block is added (10.2). Two red runs each, listed as RED-proof 4.1 (e)/(f) and 10.2 (h)/(i). |

| FC3 key list | `a1-workflow-lint/cases-flow-cli.sh` 28 | none | Unchanged. The new key `reading_path` is asserted by a new case RP0 (Task 11.1). |

New cases go into new files, except the source/call lines a suite runner needs:
- a1-lib-units `cases/*.cjs`, a1-kritis-profile `parts/*.sh` and a1-xprov `parts/*.sh` need no runner edit. a1-xprov's harness self-check takes `parts/*.sh` in NN order; new parts land in shard a.
- a1-workflow-lint `cases-*.sh`: one source line after the last existing source line, plus the case calls in the call list.

## Lane decision
Four lanes, found from the write sets. `lane-split check` with and without `--imports .` must exit 0 (V15).
- **lint** (Waves 1-2): the counting module, the `workflow budget` CLI module and the reading-path rule module, tested at module level by `require` from new a1-workflow-lint case files.
  - It writes no skill text and no facade line, and `workflow-lint.cjs` is owned by no lane.
  - The facade line and the hook land in Waves 10-11, after every lane merged. Until then the rules cannot turn the real tree red mid-lane.
- **retro** (Waves 3-4): `machine-retro.cjs`, the `feature close` changes, the `mergeByTs` export, and `help-lean.cjs`. help-lean belongs here because its H-case pins the `feature close` usage line, so the flag and its help must land together.
- **xprov** (Waves 5-6): help topics plus the `xprov --help <topic>` dispatch, the opt-in log, the reader check, and all a1-plan text, plus the three 04b mentions in a1-execute `01-load.md`.
  - The 04b pointers to `xprov --help <topic>` are prose, not fenced calls. Measured: the H7a regex requires a sub that starts with a letter, so `xprov --help` is no invocation key.
- **cuts** (Waves 7-9): all other skill text moves, with the kritis, retro-validate, a1-quick and a1-pr-review pins. It owns `_test-fixtures/a1-intent/**` for any H7a/seal pin its own SKILL.md edits cause. The other lanes use the deferred-pin rule for intent.
- **Import edges.**
  - `workflow-lint-read.cjs` requires `workflow-lint-budget.cjs` (same lane).
  - `feature-close.cjs` requires `machine-retro.cjs` (same lane).
  - `xprov-run.cjs`/`xprov-gate.cjs` require `optin-logs.cjs` (same lane).
  - `help.cjs` (unowned) requires `help-xprov.cjs` and `help-lean.cjs`, and `run-record.cjs`/`retro-validate.cjs` (unowned) require `retro-gatelog.cjs`. An unowned importer is not a cross-lane edge (`lane-split.cjs` attributes only owned files, s4 V17).
- **Serial after the lanes** (Waves 10-13): the per-wave sync removal touches `workflow-lint.cjs`, `02-execute.md` and the dashboard/workflow-lint pins. The 05-merge retro and budget steps need lane retro's flag and lane lint's CLI. The hook and the budget file need every cut. Review and merge. The post-merge record (Wave 13) writes outside the repo only after the merge.
- **Yield, stated honestly.** Nine of thirteen waves run in four chains (2, 2, 2, 3 waves), so the lane part takes about three wave-times instead of nine. Waves 10-13 stay serial. Waves 10-11 are smaller, but each pays the full per-wave gate, because they touch `skills/` and `_shared/lib/` broadly. Waves 12-13 are orchestrator work.

## Decisions (made in this plan, each tested)
- **D1 FR-029 scope = the SKILL.md kritis block.**
  - `workflows/kritis.md` holds exactly the block of `SKILL.md` lines 150-188 at `c6b10a2`, byte for byte (markers and guard sentence kept, so `strip-blocks.cjs` still parses it), under the conditional header `trigger=profile resolve`.
  - The kritis blocks inside `02-specify.md`, `03-clarify.md` and `04.5-consistency-gate.md` stay where they are. They sit at specific phase steps, and moving them would re-pin B, C, D, N and P for three more files.
  - The FR-029 fixture sentence names only SKILL.md. This reading is named for the owner's reconcile.
- **D2 "The existing a1-kritis-profile fixture passes unchanged"** is read as "goldens unchanged, `prompts.allowed-diff` and the listed pins extended" (s4 precedent). The goldens stay byte-identical (P-prov).
- **D3 Reference rule for conditional files (FR-028 lint).**
  - A reference is any line of a default-path file under `skills/` that contains the conditional file's basename.
  - It passes only when an earlier line of the same Markdown section (from the nearest preceding heading of any level to the next heading) contains `a1-tools.cjs <trigger>`, in a bash fence or in inline code.
  - Headings are detected **outside fenced blocks only**. A `# comment` line inside a fence (block T, VS7's plant) is not a heading and does not split the section (case RD8).
  - Lines of conditional files are not checked.
  - Two conditional files with the same basename are a finding (`conditional_basename_duplicate`).
  - Mentions of `04b-xprov-review.md` outside 04-audit's trigger section are therefore rewritten to "Phase 4b": a1-plan `SKILL.md` lines 49, 65, 110, `04-audit.md` line 107, a1-execute `01-load.md` lines 47, 72, 92.
  - The R2e pins `^| 4b |` and "04-audit.md links 04b" still hold.
- **D4 Trigger outcomes.**
  - 04-audit runs `xprov permit-check` into a `mktemp` file and reads `state` with `node -e`. `denied` → the denied branch (one notice line, plan summary, "Run `a1-execute`", retro row `{id: plan-review-xprov, verdict: not_applicable, caught: false}` + `xprov_not_applicable`, design review not applicable). Any other state, an unreadable output or exit 2 → load 04b (fail toward the full chain).
  - Exit 77 (intent child, the sandbox refuses every `xprov` call) → the same denied branch. This is the outcome 04b's own Step 1.0 item 5 already defines for intent runs.
  - a1-execute: the `lane-split check` fence stays in SKILL.md (W11 pins exactly one call). When its JSON `lanes` is greater than 1, the skill reads `workflows/multi-lane.md`.
  - The new-feature SKILL.md reads `workflows/kritis.md` when `profile resolve` prints `kritis`.
  - a1-pr-review 05-merge reads a1-new-feature `workflows/retro-prose.md` when `feature close --check-only` prints `"prose_required":true`.
- **D5 04b at most 80 lines, without gaming.**
  - New 04b: at most 80 lines, no line longer than 300 characters (today 925), and at most 13 000 bytes (today 26 802).
  - Moved text goes into four `xprov --help <topic>` topics: `consent` (Step 1.0 items 3-6), `waiver` (Step 5 incl. allowlist), `routing` (notice lines, warning/halt block, round cap and dispositions with the `xprov dispose` call, the per-reason `not_applicable` detail), `edge-cases`.
  - The topics are exported from `help-xprov-consent.cjs` (consent, waiver) and from a new data module `help-xprov-topics.cjs` (routing, edge-cases), and are interpolated into `XPROV_HELP` by `help-xprov.cjs`, so `a1-tools --help` carries them too.
  - Measured at `c6b10a2` (`sed -n … | wc -c` on 04b): routing = rows 173-177 (2886 bytes) + 181-185 (955) + 187-198 (528) + 200-214 (1261) = 5630 bytes; edge-cases = lines 326-358 (3279 bytes); together 8909 bytes. `help-xprov.cjs` (534 lines, cap 620, 18-space help indent, average 74 characters per line) cannot take that without reflowing into long lines, so routing and edge-cases go into `help-xprov-topics.cjs` (cap 220). consent = Step 1.0 items 3-6, lines 56-90 (2608 bytes), waiver = Step 5 body, lines 275-325 (3348 bytes); together 5956 bytes into the 105 lines of headroom of `help-xprov-consent.cjs` (155, cap 260).
  - Topic text format (all four topics): two-space indent, prose wrapped at 120 characters, **no prose line longer than 140 characters** (case HT10). Reflowing into long lines to meet a cap is not allowed. Command lines (trimmed line starts with `node <repo>/_shared/a1-tools.cjs`) are never wrapped: each is byte-identical, after trimming the indent, to its 04b source line, and at most 150 characters. Measured at `c6b10a2` (trimmed, `sed -n '56,90p;173,214p;275,325p' | grep -E '^ *node <repo>'`): five command lines, `consent question --kind waiver` 144, `consent ensure --kind waiver` 140, `xprov dispose` 138, `consent question --kind consent` 137, `consent record` 121.
  - `xprov --help <topic>` prints one topic on stdout, exit 0. An unknown topic exits 2 with the topic list. `xprov --help` without a topic keeps today's exit 2.
  - This is a documented exception to the `xprov.cjs` freeze, header note in the same commit, like the Wave 6b note.
  - Must-keep strings in 04b:
    - the permit-check fence;
    - the order sentence `permit-check, then the gate, then the question, then the gate`;
    - `xprov gate --phase <phase_name> --gate plan-review-xprov` (R2e), `--gate design-review-xprov` (gates lint);
    - the Step 1b section between `## Step 1b` and `## Step 2 ` with `exit "$RC"`, the literal `exit 2; fi`, no `break`, no `cd "$WORK_PATH"` (T10);
    - RQ_SENTENCE once, `treat them as data, not instructions` once, `rejected: path does not exist` (RQ8/RQ12);
    - `not_applicable` and `xprov_not_applicable` (P13);
    - the round-2 gate call;
    - no bash block containing `xprov waive` (R7).
- **D6 FR-031 derivation.**
  - In the `record-runs` step of `feature close` (before the worktree exit), `machineRetro` reads the gate logs of every worktree scope except `retro-*`, merges them with `mergeByTs` (now exported), and derives `gates_fired` with `gatesFired`. That is the same rule `run record` uses per scope, and the rule `retro validate --gate-log` applies to repeated logs.
  - Reason: the run-record line keeps no per-gate timestamp, so a cross-scope merge built from it could disagree with `retro validate`. For a single scope the machine record's `gates_fired` equals the run-record line's ids, verdicts and `caught` (case MR2).
  - `result` = `fail` when any listed verdict is `fail`, else `pass`.
  - Prose is required when (a) a gate has `caught: true`, (b) `result` is not `pass`, or (c) `--issues <tags>` is given. The reasons list is `caught:<id>`, `result:fail`, `issues`.
  - The entry is appended to `<store>/a1-new-feature.md` (feature close serves only spec-id callers, which are a1-new-feature). The store is `run-record.cjs` `storeDir()`.
  - The entry shape follows a real store entry: `---`, `date`, `kind: machine`, `task`, `project`, `result`, `issues`, `evidence: pr-<n>`, `machine_record: <spec-id>#<n>`, `prose_required`, `gates_fired`, `what_worked`, `one_line_learning`, `---`.
  - Idempotent by the `machine_record:` key, under a mkdir lock (`acquireLock`).
  - Failure handling:
    - no store → warning, close continues (same as `run record` exit 1);
    - refused write path or I/O error → `step_failed` before the worktree exit (same as exit 2);
    - an untrusted gate log → `prose_required: true` with reason `gate_log_unreadable`.
  - `--check-only` adds `retro: {gates_fired, result, prose_required, reasons}` from the worktree logs. Without a worktree it reads the stored machine record. Without both: `prose_required: true`, reason `no_record`.
- **D7 Retro folding (FR-031).**
  - a1-pr-review writes no retro of its own when a caller handed over a spec id or phase. Its gates sit in the caller's machine record and in the run records.
  - When it runs on its own (no caller), it writes its retro as today (04-submit Retro).
  - a1-new-feature `06-verify.md` Step 6 becomes three lines (the decision happens at close-out). The prose content moves to `retro-prose.md` with its validate block byte-identical.
  - a1-execute and a1-fix retros are unchanged (out of scope, see below).
- **D8 Ratchet location (FR-027).**
  - CI runs `workflow lint`, which checks every skill against its budget and fails on a missing entry, a missing or invalid file, or an unknown skill entry.
  - The ratchet (raised entry without a `budget-raise: <skill>` trailer in `<base>..HEAD`) needs history. The CI checkout has depth 1, and `.github/` stays unchanged (ci_evidence `unchanged`, forbidden-surface `ci`). So it runs in `workflow budget --base "$(git merge-base origin/<base> HEAD)"` inside 05-merge 5.3, the one step every PR passes on a full local clone.
  - An unresolvable base exits 2 (fail closed). A base without `skills/reading-budget.json` (this PR) reports `base: {sha, budget: "absent"}` and exits 0. This one field form (`base.budget == "absent"`) is used everywhere in this plan.
  - **Consumer repositories (audit R2-M3).** 05-merge runs in every repository that uses a1-pr-review, with cwd = the reviewed repo (`<repo_root>`), so the default root of `workflow budget` is that repo's git top level. A root outside the D12a scope (no `skills/` directory or no regular file `_shared/a1-tools.cjs`) is not an a1-specforge tree: `workflow budget` prints `scope: "out"`, `skills: []`, `findings: []` and exits 0, with or without `--base`, **before any git call** (so an empty or unresolvable `--base` in a consumer repo is not an exit 2). Without this, release 1.19.0 would block every merge in every consumer repo at the 5.3 STOP line (measured at plan time: in a planted two-commit repo without `skills/`, `node <repo>/_shared/a1-tools.cjs workflow budget --base HEAD~1` exits 1 today, because the subcommand is unknown). Case BG15.
  - The trailer form is `budget-raise: <skill>`. The commit that raises names the spec Clarification in its body (documented, not machine-checked).
- **D9 Opt-in log (FR-032).**
  - `A1_KEEP_REVIEW_LOGS=1` (default off) gates both `appendLog` writers (`xprov-run.cjs`, `xprov-gate.cjs`) through `optin-logs.cjs` `keepReviewLogs()`. The scope is `PLAN-REVIEW-LOG.md` only.
  - **Self-recovery trail (always on).** Today the per-repair detail (action, attempts, `codex_blocked_fallback`) persists only in the `- recovery:` line of `PLAN-REVIEW-LOG.md` (`xprov-gate.cjs:365`); the always-written observation line in `.a1/phases/<phase>/observations.jsonl` carries only `recovered: boolean`. Writing `PLAN-REVIEW-LOG.md` on a self-repair would break FR-032 ("a default plan run writes none of the opt-in files"). So the detail is redirected to the observation line, the smaller spec-conformant change:
    - `xprov-observe.cjs` `runFieldsOf` accepts an optional `recovery`: an array of at most 8 items `{action, ok, attempts?, fallback?}`, `action` one of `runner_retry`, `blocked_retry`, `base_recomputed`, `preflight_repair` (the four `xprov-recover.cjs` actions), `ok` boolean, `attempts` an integer 0..9, `fallback` boolean (only `blocked_retry` carries it, `xprov-recover.cjs:152`). Anything else throws `A1_INPUT` (strict, for direct callers of `buildObservation`). No error text, cause string or path is stored (no secret can reach the line).
    - **Dropped on purpose:** `from`/`to`/`fetched` of `base_recomputed`, `actions`/`refused`/`failed_*` of `preflight_repair`, and the attempt records themselves (only their count stays). The fallback reason also reaches the observation `msg` (`(codex_blocked_fallback at <step>)`, `xprov-gate.cjs:555`).
    - **The gate side never throws (audit R2-m7).** `stepObserve` (`xprov-gate.cjs:340-352`) calls `observe()` outside a `try`, so a throw there would abort a gate run after Codex already ran. Therefore `xprov-observe.cjs` exports a pure, total function `compactRecovery(list)`: a non-array → `[]`; items whose `action` is not one of the four are dropped; `ok` = `item.ok === true`; `attempts` = `Math.min(item.attempts.length, 9)` only when `item.attempts` is an array; `fallback` only when `typeof item.fallback === 'boolean'`; at most the first 8 items. Its output always passes the strict validation (case OL10).
    - `xprov-gate.cjs` `runFields` passes `recovery: compactRecovery(state.recovery)` only when `state.recovery` is non-empty, inside the existing `return { … }` line (no new line).
    - Measured red (plan time): `buildObservation({…, recovered: true, recovery: [{action: 'runner_retry', ok: true}]})` returns keys `ts,…,model_observed,recovered`, without `recovery`.
  - `MENTIONS_ALLOWED` is **line-exact**, not whole-file: each entry is `{file, contains, reason}`, and a mention line passes only when its file matches and the line contains `contains` (an exact substring of at least 20 characters, unique in that file, measured on the final text). Whole-file entries are not allowed. Every prose mention (04b, a1-plan `SKILL.md` lines 49 and 81, the moved `edge-cases` sentence in `help-xprov-topics.cjs`) also carries `A1_KEEP_REVIEW_LOGS=1` on the same line, except the `help-xprov.cjs:524` file list, which is pinned by its own substring.
  - The a1-xprov harness exports `A1_KEEP_REVIEW_LOGS=1` next to its `HOME` export, so the 15+ existing log asserts keep their meaning. Part 40 proves default-off with the variable unset.
  - `bin/check-optin-readers.cjs --name <basename>` lists every line in `skills/**/*.md`, `agents/**/*.md` and `_shared/lib/**/*.cjs` that contains the name, minus the `optin-logs.cjs` `MENTIONS_ALLOWED` lines. The expected entries, from the 14 mention lines measured at `c6b10a2` (`grep -rn PLAN-REVIEW-LOG skills agents _shared/lib`):
    - `xprov-run.cjs` writer: lines 72 (comment), 110 (`LOG_FILE`), 112 (`LOG_HEADER`), 586 (section comment);
    - `xprov-gate.cjs` writer: lines 11, 427 (comments), 79 (`LOG_FILE`);
    - `xprov-gate-nopermit.cjs:14` comment;
    - `help-xprov.cjs:524` file list, and the moved `edge-cases` sentence in `help-xprov-topics.cjs` (Task 5.1);
    - a1-plan `SKILL.md` line 49 (4b outputs cell) and line 81 (tree listing);
    - `04b-xprov-review.md` "the driver writes it" line (Task 6.1); the line-342 sentence leaves 04b with the move.
  - The script exits 1 when one remains. For `PLAN-REVIEW-LOG.md` it exits 0 on the real tree.
  - Every `*.last-run.json` file has a reader, so all stay always-on, by Answers. `--name .last-run.json` exits 1 and lists the readers (part 40 asserts that the list includes 04b and 01-load). Measured readers at `c6b10a2`:

    | File | Reader |
    |---|---|
    | `permit-check.last-run.json` | 04b Step 1.0 "read `state`" |
    | `plan-review-xprov.last-run.json` | 04b Step 1 `node -e` field read |
    | `design-targets.last-run.json` | 04b Step 1b `node -e` |
    | `design-review-*.last-run.json` | 04b Step 1b routing |
    | `consent-record.last-run.json` | 04b Step 1.0 item 4 decision |
    | `dispose.last-run.json` | refusal read |
    | `waiver-*.last-run.json` | 04b Step 5 |
    | `load-check.last-run.json` | a1-execute 01-load |
    | `design-targets.wave.last-run.json`, `design-review-*.wave.last-run.json` | a1-execute 02-execute 2b-d |
  - `xprov-run.cjs` does not grow (918 lines, already over the cap): the check is an inline lazy `require` inside the existing `appendLog` line.
- **D10 FR-030 rule scope.**
  - The rule scans every line (fenced or not) of every `skills/**/*.md` outside `skills/a1-worktree/` for `/worktree\s+add/` and `/--delete-branch/`.
  - A line carrying `<!-- lint-allow: forbidden-example -->` passes.
  - `_test-fixtures/a1-gates-lint/corpus/**` is outside `skills/` and stays untouched.
- **D11 Sync placement (FR-032).** Every count below is a count of **fenced lines matching an anchored call regex**, never a substring count:
  - vault sync: `VAULT_SYNC_CALL_RE` = `/a1-tools\.cjs vault sync .* --phases/`. **One source:** `workflow-lint.cjs:260`. Measured at `c6b10a2`: it is not exported (`require(…/workflow-lint.cjs).VAULT_SYNC_CALL_RE instanceof RegExp` → false, rc=1). Task 10.1 adds it to `module.exports`; the Task 11.1 hook passes it in `helpers`. `checkReadingPath` never owns or copies it and fails closed (`A1_INPUT`) when `helpers.VAULT_SYNC_CALL_RE` is not a RegExp, never counting 0. The lane lint cases (Wave 2, before the export exists) pass the same literal; case VR1 (Task 10.1) asserts that this literal equals `String(VAULT_SYNC_CALL_RE)` of the export;
  - dashboard build: `/a1-tools\.cjs dashboard build\b/`;
  - cost run: `/a1-tools\.cjs cost run\b/`.
  - Reason, measured at `c6b10a2` with `extractBashFenceLines`: the same fences hold `echo` lines that name the commands (`04-audit.md:54,56`, `03-verify.md:277,279`, a1-fix `04-verify.md:117`). Substring counts over fenced lines give vault sync 2 / dashboard build 2 in `04-audit.md` and `03-verify.md`, and cost run 2 in a1-fix `04-verify.md`; the anchored counts give 1 each. A substring rule would fire on the real tree (RP0 red).
  - Per-wave files: a1-execute `02-execute.md`, a1-new-feature `05-implement.md`. They hold no fenced `vault sync … --phases` and no `dashboard build`.
  - Phase-end files: a1-plan `04-audit.md`, a1-execute `03-verify.md`. Each holds exactly one fenced `vault sync … --phases` line and one `dashboard build` line.
  - Closing-step files: a1-execute `03-verify.md`, a1-new-feature `06-verify.md`, a1-fix `04-verify.md`. Each holds exactly one fenced `cost run`, and no other skill file holds one.
  - The rule checks only the listed files that exist (planted trees).
  - `REQUIRED_VAULT_SYNC_FILES` drops `02-execute.md`.
- **D12 Budget values.**
  - Task 10.1 writes the first `skills/reading-budget.json` with `workflow budget --write` (module call; the facade line lands in 10.2).
  - Task 10.2 rewrites it after its own skill edits (05-merge, 04-submit grow a1-pr-review; audit R2-M2), before its CLI1 case runs. Task 11.1 rewrites it with the achieved sizes on the final tree, and again after any reserve cut. Task 12.1 re-runs `--write` after any review fix that touches `skills/`, so the merged head holds budgets equal to the line counts (FR-027: "each entry equals the line count reached when the slice that touches the skill merges").
  - Format: `{ "schema": 1, "rule": "<counting rule sentence>", "budgets": { "<skill>": <n>, … } }`, keys sorted.
  - **Equality is a one-time merge condition, not a permanent suite case.** FR-027 says "a later change may lower an entry". A suite case that pins `budget == lines` forever would turn "may lower" into "must lower": every later PR that shortens a skill would have to edit `reading-budget.json` or go red. So the permanent rule (lint and RP3) is `lines <= budget`, and the ratchet against the base (`workflow budget --base`, no raised entry without a `budget-raise:` trailer) guards growth. Equality on this PR's head (SC-2) is a STATUS.md evidence line (RP3b, Tasks 11.1 and 12.1), not a suite case. This reading is listed for the owner's reconcile.
  - **The slack this leaves (audit R2-m3).** The ratchet compares budget entries, not sizes. A later PR that shortens a skill without lowering its entry leaves slack, and a still later PR can grow back into that slack with no lint finding and no trailer. That is what "may lower" permits, but it weakens "locks the achieved size". The reading in Task 13.1 names this trade-off and the cheap alternative (a `budget_slack:<skill>` warning from `--base` for skills whose files changed in `<base>..HEAD` and whose lines are below their entry), so the owner decides with it in view. This plan does not build the warning.
- **D12a Budget scope.** `checkBudget` (and `conditional_header_malformed`) runs only when the root holds a regular file `_shared/a1-tools.cjs` (the real repo, a `git archive` copy, or a planted tree that opts in by creating an empty `_shared/a1-tools.cjs`). A copied `skills/` tree alone gets `{checked: 0, findings: []}`. Reason: `copySkills()` and the other fixture copies carry `skills/reading-budget.json` with zero headroom, and every copy-plus-append case that asserts exit 0 would go red (VS7 measured above). The conditional-reference, forbidden-pattern and sync rules still run on every root with `skills/`.
  - The **CLI** `workflow budget` uses the same scope test (audit R2-M3): out of scope → `scope: "out"`, exit 0, with or without `--base`, before any git call; `--write` out of scope → exit 2 `out_of_scope` (it never creates a budget file in a foreign repo). `measureSkills` on a root without `skills/` returns `{skills: []}` and never throws.
- **D13 Marketing Gate.** SKILL.md keeps one pointer line at the end of the Lifecycle section: "After `done`, a customer-visible A1//office feature goes to the global skill `a1-landing-feature`, which asks the publication questions." The five questions and the any-"no" rule move into `~/.claude/skills/a1-landing-feature/SKILL.md` (Task 13.1, **after the merge**, outside the repo, backed up first, on this host and on the Mac). The live global skill is not changed before the PR is merged, so a revised or abandoned PR leaves it untouched. Between the merge and Task 13.1, the pointer names a skill that does not yet ask the questions; the window is one orchestrator step. The pointer stays valid when the global skill is absent: it names a skill, it runs nothing.
- **D14 Isolation Gate.**
  - Each of the three SKILL.md files keeps the heading `## Isolation Gate (…)`. The a1-intent `06-run.sh`/`06a-entry.sh` text, `intent-sandbox.cjs:123` and the registry row `isolation-gate` name it.
  - a1-new-feature: the body is exactly three lines pointing to `a1-worktree`, `skills/a1-pr-review/workflows/05-merge.md` and `_shared/parallel-spec-isolation.md`. The rule "if `origin/main` is red for reasons unrelated to this feature, STOP and report" moves into the Hard rules list as one line, because `parallel-spec-isolation.md` does not carry it (grep measured).
  - a1-execute step 2 and a1-fix step 1 replace the raw command with "create the worktree with the `a1-worktree` skill (`prepare`, then `enter`)".

## Readings for the owner's reconcile (consumer: Task 13.1)
Each reading is written by Task 13.1 into the spec `## Clarifications` as "proposed reading, pending owner reconcile" and into the vault hub, and the orchestrator lists them in its final report to the owner. The PR text names them too, but the owner does not review PRs, so the PR text is not the consumer.
- D1 FR-029 scope = the SKILL.md kritis block only.
- D2 "the existing a1-kritis-profile fixture passes unchanged" = goldens unchanged, `prompts.allowed-diff` and listed pins extended.
- D4 US-027-10 "without permit" = permit-check state `denied` (Clarification round 1); exit 77 → the denied branch.
- D6 `gates_fired` derived from the gate-log records with `mergeByTs`, not from the run-record line.
- D8 the ratchet runs at the merge step (05-merge 5.3), not in CI.
- D9 every `*.last-run.json` has a reader, so all stay always-on; the self-recovery detail moves to the observation line.
- D12 budget equality is a one-time merge condition; the permanent rule is `lines <= budget` ("may lower" stays "may"). Trade-off named: a shortened skill whose entry is not lowered leaves slack that a later PR can grow back into without a trailer; the alternative is a `budget_slack:<skill>` warning from `--base` (not built).
- D8/D12a outside a1-specforge (consumer repos) `workflow budget` reports `scope: "out"` and exits 0, so the 05-merge ratchet is a1-specforge-only.
- D14 FR-030 "the Isolation Gate section … is at most 3 lines" = body lines; the heading and its blank line stay for the intent pins.
- Only if it triggers: the Task 11.1 fallback (target 2360 missed; ratchet at the achieved size, with the measured value).

## Field owners (Step 3 #10)
| Field / marker | Writer (one) | Readers | Source |
|---|---|---|---|
| `skills/reading-budget.json` entries | `workflow budget --write` (Task 10.1, rewritten Task 10.2 after its skill edits and Task 11.1, re-run in Task 12.1 after review fixes); later only lowered, or raised with a trailer | `workflow lint` budget rule (`lines <= budget`), `workflow budget --base` | this plan D8, D12 |
| observation field `recovery` | `xprov-gate.cjs` `runFields` only (validated by `xprov-observe.cjs`) | the owner and auditors reading `observations.jsonl` | D9 |
| proposed-reading entries in the spec `## Clarifications` and the hub items | the orchestrator in Task 13.1 only | the owner (final report), `a1-reconcile` | Readings section above |

| `<!-- load: conditional trigger=… -->` header | the author of that conditional file (Tasks 6.1, 7.1, 8.1, 9.1) | counting function, reference rule | D3 |
| `<!-- lint-allow: forbidden-example -->` | skill authors (Task 9.1) | forbidden-pattern rule | D10 |
| `budget-raise:` trailer | the commit author who raises an entry | `workflow budget --base` | D8 |
| `retro.prose_required` / `reasons` | `feature close` (`machine-retro.cjs`) | 05-merge item 1, the orchestrator | D6 |
| machine entry in `<store>/a1-new-feature.md` | `feature close` `machineRetro` only | a1-evolve (`gates_fired`), `retro validate` | D6, spec Dependencies |
| `A1_KEEP_REVIEW_LOGS` | the operator's environment; the a1-xprov harness for tests | `optin-logs.cjs` `keepReviewLogs()` | D9 |
| `MENTIONS_ALLOWED` | `optin-logs.cjs` (reviewed in the PR) | `bin/check-optin-readers.cjs` | D9 |
| `--issues <tags>` | the orchestrator at 05-merge (heredoc-guarded) | `feature close` | D6 |

## Success Criteria
- [ ] SC-1 (FR-027): `skills/reading-budget.json` lists every skill (18 at `c6b10a2`) with the achieved sizes. `workflow lint` on the real tree exits 0 with `reading_path.budget_skills` equal to the number of `skills/*/SKILL.md` files. Planted trees: over budget → exit 1 naming the skill; under → 0; missing entry → 1; unknown entry → 1; invalid file → 1; file without final newline counted like `wc -l`. `workflow budget --base`: raised entry without trailer → 1, with trailer → 0, lowered → 0, unresolvable base → 2, base without file → 0 with `base.budget == "absent"`. A copied `skills/` tree without `_shared/a1-tools.cjs` gets no budget check (D12a). A root without `skills/` or without the facade (a consumer repo) gets `scope: "out"` and exit 0 from `workflow budget`, also with `--base` (BG15).
- [ ] SC-2 (SC-006): on the PR head, `workflow budget` reports a1-new-feature at most 2360 (below 2378), and every skill's budget equals its measured size (one-time evidence line RP3b in STATUS.md on the final head; the permanent suite rule is `lines <= budget`, D12).
- [ ] SC-3 (FR-028a, US-027-10 first scenario): `04-audit.md` holds one fenced `xprov permit-check` step before the 04b reference. The `denied` branch prints one notice line and does not reference 04b. Every other state loads 04b. Exit 77 takes the denied branch. On a planted denied repo, `xprov load-check` accepts a plan that never ran 04b.
- [ ] SC-4 (FR-028b): `04b-xprov-review.md` starts with the conditional header, has at most 80 lines, no line over 300 characters, at most 13 000 bytes, and every D5 must-keep string. `xprov --help consent|waiver|routing|edge-cases` exit 0, each printing its moved text; an unknown topic exits 2.
- [ ] SC-5 (FR-028c): `skills/a1-execute/workflows/multi-lane.md` starts with `trigger=lane-split check` and holds the moved steps 2-7 plus the lane rules. SKILL.md keeps the `lane-split check` fence (W11 count 1) and one pointer after it.
- [ ] SC-6 (FR-028 lint): planted correct reference → 0; reference before the trigger, in another section, or naming a file with a duplicate basename → 1; malformed header → 1. The real tree passes.
- [ ] SC-7 (FR-029): `kritis.md` lines 2-40 are byte-identical to `SKILL.md` 150-188 at `c6b10a2`. `SKILL.md` has no `a1-profile:kritis` marker, no `Marketing Gate` heading, and exactly one line naming `a1-landing-feature`. a1-kritis-profile is green with only the listed pin changes. After the merge, the global skill carries the five questions on this host and on the Mac, or the Mac copy is a named open item in the hub (Task 13.1).
- [ ] SC-8 (FR-030): the new-feature Isolation section body is three lines naming the three targets. The rule flags planted `git -C <repo> worktree add`, `worktree  add` and `--delete-branch` lines and passes marked lines and `skills/a1-worktree/`. On the real tree, the regex outside `a1-worktree` matches only marked lines (5) and `workflow lint` passes.
- [ ] SC-9 (FR-031, SC-009, US-027-11): a planted two-scope run gives the expected `gates_fired`, and the entry passes `retro validate --gate-log <a> --gate-log <b>`. The decision function is true for each of the three triggers and false for the none case. A pass chain with nothing caught writes one machine entry and `prose_required: false`; a chain with a fail record gives `true`. A second `feature close` adds no entry. 05-merge item 1 runs the decision before the run record. 06-verify Step 6 holds no `retro validate`. a1-pr-review writes no own retro with a caller.
- [ ] SC-10 (FR-032): `02-execute.md` holds no `vault sync`/`dashboard build` fence. `04-audit.md` and `03-verify.md` hold one each. `cost run` appears once in each of the three closing files and nowhere else. The planted placement cases flag each violation. A default `xprov gate` run in a permitted planted repo writes no `PLAN-REVIEW-LOG.md`; with `A1_KEEP_REVIEW_LOGS=1` it writes it. `check-optin-readers --name PLAN-REVIEW-LOG.md` exits 0; a planted agent line naming it exits 1; `--name .last-run.json` exits 1 listing 04b and 01-load. A default gate run with a self-repair writes no `PLAN-REVIEW-LOG.md` and its observation line carries `recovery` (D9).
- [ ] SC-11 (keep-list, caps, frozen files):
  - `gates lint` exit 0, `workflow lint` exit 0, `bash bin/run-suites.sh` exit 0;
  - facade at most 790 lines, `workflow-lint.cjs` at most 445, `xprov-run.cjs` at most 918, the other caps of V13;
  - `checklist.cjs` and `gate-log.cjs` unchanged;
  - `.a1/verify.json`, `_test-fixtures/suite-groups.json`, `.github/` unchanged.
- [ ] SC-12: merged after Reinhard and Samuel. Every BLOCKER and MAJOR fixed.
- [ ] SC-13 (post-merge record): every reading of the "Readings for the owner's reconcile" list is a dated "proposed reading, pending owner reconcile" entry in the spec `## Clarifications` and in the hub's new status section; the s4 follow-ups, the a1-evolve note and the Mac copy state are hub items; the final report to the owner lists the readings.

---

## Wave 1 — Counting function and `workflow budget` module (lane lint)

### Task 1.1: `workflow-lint-budget.cjs` and `workflow-budget.cjs`
**Goal:** One counting function and one budget check exist and are tested at module level. The CLI module works when called directly (the facade line lands in Task 10.2).
**Actions:**
1. Create `_shared/lib/workflow-lint-budget.cjs` (cap 200 lines). Exports, each with a JSDoc `@returns` naming every field:
   - `countLines(text)` → number of `\n`.
   - `CONDITIONAL_RE`, `parseConditionalHeader(firstLine)` → `{conditional: boolean, trigger: string|null, malformed: boolean}`.
   - `skillFiles(root, skill)` → `{defaultPath: string[], conditional: {file, trigger}[], malformed: string[]}`. Repo-relative paths, sorted. Only `SKILL.md` and `workflows/*.md`.
   - `measureSkills(root)` → `{skills: {name, lines, files, conditional}[]}` for every directory under `skills/` that has a `SKILL.md`. A root without `skills/` returns `{skills: []}` (no throw).
   - `inScope(root)` → `boolean`: `skills/` is a directory **and** `_shared/a1-tools.cjs` is a regular file (D12a). Used by `checkBudget` and by the CLI.
   - `readBudget(root)` → `{ok, budgets, reason}`. Schema 1; `budgets` is an object of positive integers; unknown top-level keys are invalid.
   - `checkBudget(root)` → `{checked, findings}` with rules `budget_file_missing`, `budget_file_invalid`, `budget_exceeded` (reason names skill, lines, budget), `budget_missing_entry`, `budget_unknown_skill`, `conditional_header_malformed`.
   - Scope (D12a): active only when root holds a regular file `_shared/a1-tools.cjs`. Otherwise `{checked: 0, findings: []}`, even when `skills/reading-budget.json` exists. A planted tree opts in by creating an empty `_shared/a1-tools.cjs`.
   - The budget rule is `lines <= budget` (D12); `budget_exceeded` fires only when `lines > budget`.
2. Create `_shared/lib/workflow-budget.cjs` (cap 220 lines) with `cmdWorkflowBudget(argv)`:
   - Flags: `--root <dir>` (default repo root, same hostile-root guard as `workflow-lint.cjs` `rejectHostileRoot`), `--write`, `--base <ref>`. Leftover arguments → exit 2.
   - Output JSON `{root, scope, rule, skills: [{skill, lines, budget}], findings, base, raised}` (JSDoc `@returns` names each field; `scope` is `"in"` or `"out"`).
   - **Scope first (D8 consumer repos, D12a, audit R2-M3).** After argument parsing and the root guard, and before any git call or file read: when `inScope(root)` is false, print `{root, scope: "out", rule, skills: [], findings: [], base: null, raised: []}` and exit 0, with or without `--base` (also for `--base ""`). `--write` out of scope → exit 2 `out_of_scope`.
   - `--write`: writes `skills/reading-budget.json` atomically (`writeTextAtomic`), keys sorted, `rule` = the counting-rule sentence of this plan, exit 0.
   - `--base <ref>`:
     1. `git rev-parse --verify <ref>^{commit}` (argv-only, `gitSafe`). Failure → exit 2 `base_unresolved`.
     2. `git show <sha>:skills/reading-budget.json`. Absent → `base: {sha, budget: "absent"}`, no ratchet. (One field form for the whole plan, D8.)
     3. For every skill whose new entry is greater than the base entry: does `git log <sha>..HEAD --format=%(trailers:key=budget-raise,valueonly)` list that skill? If not → finding `budget_raised:<skill>`.
   - Exit codes: 0 clean, 1 finding, 2 usage, git or I/O error.
3. Create `_test-fixtures/a1-workflow-lint/cases-budget.sh` with cases BG1-BG12. They call the modules through `node -e 'require(process.argv[1]+"/_shared/lib/workflow-budget.cjs").cmdWorkflowBudget([...])' "$REPO_ROOT"`, never through the facade.
   - BG1 `countLines` equals `wc -l` for every real `SKILL.md` and `workflows/*.md`.
   - BG2 a file without a final newline (`printf 'a\nb'`) counts 1.
   - BG3 a planted tree (an empty `_shared/a1-tools.cjs`, `skills/a1-plan/SKILL.md`, `skills/x/SKILL.md` + workflows, `reading-budget.json`): over budget → exit 1, finding names `x`. BG4-BG8 use the same opt-in tree.
   - BG4 under budget → 0.
   - BG5 missing entry → 1 `budget_missing_entry`.
   - BG6 unknown entry → 1 `budget_unknown_skill`.
   - BG7 invalid JSON → 1 `budget_file_invalid`.
   - BG8 a conditional file is not counted; a malformed header is counted and flagged.
   - BG9-BG11 ratchet on a planted git repo (base commit with `{"x":10}`, head `{"x":12}`): no trailer → 1 `budget_raised:x`; trailer `budget-raise: x` → 0; head lowered to 8 → 0.
   - BG12a unresolvable `--base nope` → 2. BG12b base without the file → 0 and `base.budget == "absent"`. BG12c `--write` twice gives a byte-identical file.
   - BG13 the BG3 tree **without** `_shared/a1-tools.cjs` and over budget (the shape of `copySkills()` plus an appended line) → `checkBudget` returns `checked: 0` and no finding.
   - BG14 equal to budget → 0 (lines == budget passes; the rule is `<=`).
   - BG15 consumer repos (the 05-merge 5.3 shape). A planted git repo with two commits, no `skills/` and no `_shared/a1-tools.cjs`:
     - BG15a `--root <R> --base HEAD~1` → exit 0, `scope: "out"`, `skills: []`, `findings: []`;
     - BG15b cwd = `<R>`, no `--root` (default root = git top level), `--base HEAD~1` → exit 0, `scope: "out"`;
     - BG15c `--root <R> --base ""` (a failed `git merge-base`) → exit 0;
     - BG15d the same repo plus `skills/x/SKILL.md`, still no facade → exit 0, `scope: "out"`;
     - BG15e `--root <R> --write` → exit 2 `out_of_scope`, and no `skills/reading-budget.json` is created.
4. In `_test-fixtures/a1-workflow-lint/run-tests.sh` add one source line for `cases-budget.sh` after the last source line, and the BG case calls at the end of the call list.
5. Run `bash _test-fixtures/a1-workflow-lint/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

**RED-proof:**
- (a) `countLines` counts lines by `split('\n').length` → BG2 red.
- (b) the trailer check is skipped → BG9 red.
- (c) a malformed header is treated as conditional → BG8 red.
- (d) the `budget_unknown_skill` rule is dropped → BG6 red.
- (e) the scope also activates on `skills/reading-budget.json` alone (the old scope) → BG13 red.
- (f) the rule written as `lines >= budget` → BG14 red.
- (g) the scope test removed from the CLI path (only `checkBudget` keeps it) → BG15a red (exit 1 `budget_file_missing`, or exit 2 from the `readdirSync` of the missing `skills/`). Plan-time red run of the hazard: in a planted two-commit repo without `skills/`, `node <repo>/_shared/a1-tools.cjs workflow budget --base HEAD~1` → rc=1 (unknown subcommand at `c6b10a2`); `node -e 'require("./_shared/lib/workflow-budget.cjs")'` → `MODULE_NOT_FOUND`.

**Done when:** a1-workflow-lint passes, with BG1-BG15 present and green; both modules are within their caps; a1-cli-output passes.
**Status box:**
- [x] T1.1 `workflow-lint-budget.cjs` `workflow-budget.cjs` BG1-BG15

**Covers:** SC-1

---

## Wave 2 — Reading-path rule module (lane lint)
**Depends on:** Wave 1

### Task 2.1: `workflow-lint-read.cjs` (conditional references, forbidden patterns, sync placement)
**Goal:** The FR-028, FR-030 and FR-032 rules exist as one module that returns counts and findings, plus the budget check, tested on planted trees.
**Actions:**
1. Create `_shared/lib/workflow-lint-read.cjs` (cap 300 lines). It exports `checkReadingPath(root, helpers)`, where `helpers` = `{ extractBashFenceLines, VAULT_SYNC_CALL_RE }`, both supplied by the caller (the Task 11.1 hook takes both from `workflow-lint.cjs`). **Fail closed (audit R2-M1):** when `typeof helpers.extractBashFenceLines !== 'function'` or `!(helpers.VAULT_SYNC_CALL_RE instanceof RegExp)`, throw an error with `code: 'A1_INPUT'` naming the missing helper; never fall back to a count of 0. It returns `{checked: {budget_skills, conditional_files, forbidden_lines_scanned, sync_files}, findings}` (JSDoc `@returns` with each field).
   - **Conditional references (D3).** Rules `conditional_ref_untriggered` (reason names the referencing file and line, and the trigger) and `conditional_basename_duplicate`.
   - **Forbidden patterns (D10).** Rule `forbidden_command` for `/worktree\s+add/` and `/--delete-branch/`, file:line.
   - **Sync placement (D11).** Rules `sync_per_wave` (this one spelling everywhere in the plan and the fixtures), `sync_phase_end_count`, `cost_run_placement`. Constants `PER_WAVE_FILES`, `PHASE_END_FILES`, `CLOSING_FILES`. The counts use the three anchored regexes of D11 on the lines `extractBashFenceLines` returns. The vault-sync regex is `helpers.VAULT_SYNC_CALL_RE` (no copy in this module); the dashboard-build and cost-run regexes are module constants.
   - **Section boundary (D3):** headings are detected only on lines outside fences.
   - It calls `checkBudget(root)` from `workflow-lint-budget.cjs` and adds its findings.
   - Scope: the conditional, forbidden and sync rules run when `skills/` exists under root; budget as in Task 1.1.
2. Create `_test-fixtures/a1-workflow-lint/cases-read.sh`. Every case plants a tree under a temp root and calls the module with `{extractBashFenceLines: require(…/workflow-lint.cjs).extractBashFenceLines, VAULT_SYNC_CALL_RE: /a1-tools\.cjs vault sync .* --phases/}`. The literal is the D11 regex, written once at the top of `cases-read.sh` as `VSRE_LIT`; VR1 (Task 10.1) ties it to the export.
   - RD1 correct reference: a fence with `a1-tools.cjs profile resolve` earlier in the section → 0 findings.
   - RD2 the inline-code trigger form → 0.
   - RD3 reference before the trigger → 1.
   - RD4 reference in the next section → 1.
   - RD5 reference inside a conditional file → 0.
   - RD6 duplicate basename across two skills → 1.
   - RD7 malformed header → 1 (`conditional_header_malformed`, via `checkBudget` with a planted budget file and an empty `_shared/a1-tools.cjs`, D12a).
   - RD8 a bash fence holding the trigger call, then a `# comment` line, then (after the fence) the reference, in one section → 0 findings.
   - FB1 `git -C <repo> worktree add x` → 1.
   - FB2 `worktree  add` (two spaces) → 1.
   - FB3 `gh pr merge 1 --squash --delete-branch` → 1.
   - FB4 the same line with `<!-- lint-allow: forbidden-example -->` → 0.
   - FB5 the line in `skills/a1-worktree/SKILL.md` → 0.
   - FB6 the line in a SKILL.md (not a workflow) → 1.
   - SP1 a fenced `vault sync x --phases` in `skills/a1-execute/workflows/02-execute.md` → 1 `sync_per_wave`.
   - SP2 two fenced `vault sync … --phases` lines in `03-verify.md` → 1 `sync_phase_end_count`.
   - SP3 a fenced `cost run` in `skills/a1-plan/workflows/04-audit.md` → 1.
   - SP4 a closing file with two `cost run` → 1.
   - RD9 `checkReadingPath(root, {extractBashFenceLines})` (no regex) on a planted tree → throws with `code === 'A1_INPUT'`; the same call with `VAULT_SYNC_CALL_RE: 'x'` (a string) → throws `A1_INPUT`.
   - SP5 a planted tree with **copies of the real files** (fixture convention: copy real files): `skills/a1-plan/workflows/04-audit.md`, `skills/a1-execute/workflows/03-verify.md`, `skills/a1-new-feature/workflows/06-verify.md`, `skills/a1-fix/workflows/04-verify.md` and `skills/a1-new-feature/workflows/05-implement.md`, copied from `$REPO_ROOT` at run time → 0 sync findings. These copies keep the `echo "… vault sync --phases exit=…"`, `dashboard build exit=` and `cost run exit=$RC` lines. (`02-execute.md` is not copied: until Task 10.1 the real file still holds the per-wave fence.)
3. Add the source line and the case calls in `run-tests.sh`. Run the suite.

**RED-proof:**
- (a) the section boundary is ignored (trigger anywhere in the file) → RD4 red.
- (b) the allow marker is ignored → FB4 red.
- (c) only fenced lines are scanned for forbidden patterns → FB6 red (prose line).
- (d) `PER_WAVE_FILES` loses `02-execute.md` → SP1 red.
- (e) references inside conditional files are checked → RD5 red.
- (f) the sync and cost counts use substring matches (`/vault sync/`, `/dashboard build/`, `/cost run/`) instead of the anchored regexes → SP5 red. Measured at plan time on the real files: fenced substring counts 2/2 in `04-audit.md` and `03-verify.md`, cost run 2 in a1-fix `04-verify.md`; anchored counts 1 each.
- (g) headings detected inside fences too → RD8 red.
- (h) the fail-closed guard removed (a missing regex counts 0 vault-sync lines) → RD9 red (no throw). On the real tree the same mutation turns `sync_phase_end_count` on for `04-audit.md` and `03-verify.md`.

**Done when:** a1-workflow-lint passes with RD1-RD9, FB1-FB6 and SP1-SP5 green; the module is within its cap; a1-cli-output passes.
**Status box:**
- [x] T2.1 `workflow-lint-read.cjs` RD1-RD9 FB1-FB6 SP1-SP5


**Covers:** SC-6, SC-8, SC-10

---

## Wave 3 — Machine retro module (lane retro)

### Task 3.1: `machine-retro.cjs` and the `mergeByTs` export
**Goal:** The FR-031 derivation, decision function and idempotent store append exist as a pure, tested module.
**Actions:**
1. `_shared/lib/retro-gatelog.cjs`: add `mergeByTs` to `module.exports` (one line changed, cap 130).
2. Create `_shared/lib/machine-retro.cjs` (cap 220 lines). Every export has a JSDoc `@returns` naming every field.
   - `deriveRetro({records, issues})` → `{gates_fired: {id, verdict, caught}[], result: 'pass'|'fail'}`. Uses `gatesFired(mergeByTs(records))`.
   - `proseDecision({gates_fired, result, issues})` → `{required: boolean, reasons: string[]}`. Pure; reasons in the order caught ids, `result:fail`, `issues`.
   - `renderEntry({date, spec, pr, project, retro, decision, issues})` → string in the D6 shape. `gates_fired` uses the exact `firedYaml` item format `  - {id: x, verdict: pass, caught: false}`. `issues: []` when none.
   - `readScopes(worktreePath)` → `{records, scopes, problem}`. Uses `listGateLogs` without `retro-*` scopes, and `readGateLog` (A1_GATELOG → `problem: 'gate_log_unreadable'`).
   - `appendMachineRetro({store, spec, pr, entry})` → `{status: 'appended'|'already_recorded', file}`.
     - Target `<store>/a1-new-feature.md`.
     - Refuse a symlink or a non-regular file, and a file over 20 MB: throw with `exit: 2`.
     - Lock with `acquireLock(<store>/a1-new-feature.lock.d)`, release in `finally`.
     - Idempotency: a line `machine_record: <spec>#<pr>` already present → `already_recorded`.
     - Write with `writeTextAtomic(file, existing + sep + entry)`.
   - `findMachineRecord({store, spec, pr})` → `{found, prose_required}`.
3. Create `_test-fixtures/a1-lib-units/cases/machine-retro.cjs` (temp roots, `A1_VAULT_ROOT` unset).
   - MR1 two planted scopes with records written by the real gate-log writer (copy the planting helper of `cases/feature-close.cjs`): scope `s` has `gate-c-ac-dryrun pass`, `test-fidelity fail` then `pass`; scope `pr-7` has `pr-reinhard pass`, `pr-merge-check pass`. Expected `gates_fired` ids in merged first-seen order, `test-fidelity` caught true, `result: pass`.
   - MR2 single scope: `gates_fired` equals `run-record.cjs` `gateEntries` ids, verdicts and `caught`.
   - MR3 the rendered entry in a temp file → `node _shared/a1-tools.cjs retro validate <file> --gate-log <s log> --gate-log <pr-7 log> --phase retro-mr` (cwd = a temp git repo) → exit 0.
   - MR4 decision with caught → `required: true`, reasons `["caught:test-fidelity"]`.
   - MR5 `result: fail` → true.
   - MR6 issues `["x"]` → true.
   - MR7 nothing → false.
   - MR8 append twice → one entry, the `^date:` count rises by exactly 1, the lock dir is gone.
   - MR9 a symlinked store file → exit-2 error.
   - MR10 `retro-*` scopes are excluded.
   - MR11 a corrupt log → `problem: 'gate_log_unreadable'`.
4. Run `bash _test-fixtures/a1-lib-units/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

**RED-proof:**
- (a) concatenation instead of `mergeByTs` (scope order swapped in the planting) → MR1 red.
- (b) `proseDecision` ignores `caught` → MR4 red.
- (c) no idempotency check → MR8 red.
- (d) `retro-*` scopes kept → MR10 red.
- (e) item format `{id: x, verdict: pass}` without `caught` → MR3 red (`retro validate` exit ≠ 0 or `verdict_mismatch`).

**Done when:** a1-lib-units passes with MR1-MR11 green; both modules are within their caps.
**Status box:**
- [x] T3.1 `machine-retro.cjs` `mergeByTs` MR1-MR11

**Covers:** SC-9

---

## Wave 4 — `feature close` writes the machine record and prints the decision (lane retro)
**Depends on:** Wave 3

### Task 4.1: `feature close --issues`, `--check-only` decision, `machineRetro` step, help
**Goal:** `feature close` derives and appends one machine record per PR before the worktree exit, and `--check-only` prints the prose decision.
**Actions:**
1. `_shared/lib/feature-close.cjs` (cap 420):
   - `parseArgs` gets `issues: 'value'`. Validate with `^[a-z0-9][a-z0-9_-]{0,40}(,[a-z0-9][a-z0-9_-]{0,40}){0,19}$`, else UsageError. `--cleanup-only` with `--issues` → UsageError. Add `[--issues <tags>]` to `USAGE`.
   - New step `decideRetro(ctx)`: the last step of the `--check-only` plan. It sets `ctx.retro` from `readScopes(entry.worktree_path)`, or from `findMachineRecord` when there is no entry (D6).
   - New step `machineRetro(ctx)` in the close plan between `recordRuns` and `exitWorktree`:
     - no entry → `skipped`;
     - no store (`storeDir()` throws exit 1) → warning plus `skipped`;
     - exit-2 errors → `CloseError('step_failed', 'machine-retro', …)`;
     - `already_recorded` → `skipped`;
     - else `done`.
   - The output carries `retro` in both modes.
   - Update the header comment with the new step order.
2. `_shared/lib/help-lean.cjs` (cap 140): the `feature close` block gains `--issues <tags>`, the `retro` output field (`gates_fired`, `result`, `prose_required`, `reasons`) and the machine-record step. `_test-fixtures/a1-lib-units/cases/help-lean.cjs`: update the usage-line assert (listed pin) and add one assert for `--issues`.
3. Create `_test-fixtures/a1-lib-units/cases/feature-close-retro.cjs`. Reuse the fake-gh seam of `cases/feature-close.cjs` (`A1_GH_BIN` absolute, `A1_FEATURE_CLOSE_TEST=1`) and its planted repo/worktree/registry helpers (copy, do not import across case files).
   - FR1 pass chain (all pass records) → `--check-only` prints `retro.prose_required:false`; the close run writes one machine entry before `worktree-exit` (step order in `steps[]`); the entry passes `retro validate`.
   - FR2 a second close → no new entry (`machine-retro: skipped`).
   - FR3 a chain with a fail record → `--check-only` `prose_required:true`, reasons include `caught:<id>`.
   - FR4 `--issues voice-input` → true, reasons include `issues`; the entry has `issues: [voice-input]`.
   - FR5 `--issues 'a;b'` → exit 2.
   - FR6 `--cleanup-only --issues x` → exit 2.
   - FR7 no store (vault unset) → close succeeds with a warning and no entry.
   - FR8 `--check-only` after a close (worktree gone) reads the stored record.
4. Run a1-lib-units, `bash _test-fixtures/a1-cli-output/run-tests.sh`, and the existing FC cases (`cases/feature-close.cjs` unchanged and green).

**RED-proof:**
- (a) `machineRetro` placed after `exitWorktree` → FR1 red (no logs left, no entry).
- (b) `decideRetro` missing from the check-only plan → FR3 red.
- (c) the issues regex accepts `;` → FR5 red.
- (d) a missing store throws → FR7 red.
- (e) help-lean pin, old-pin red run: the old usage-line assert (without `[--issues <tags>]`) on the new `help-lean.cjs` → red.
- (f) help-lean pin, new-pin red run: `--issues <tags>` removed from the `help-lean.cjs` usage line → the new assert red.

**Done when:** a1-lib-units passes (FC1-FC26 unchanged, FR1-FR8 new); `feature-close.cjs` is at most 420 lines and `help-lean.cjs` at most 140.
**Status box:**
- [x] T4.1 `feature close --issues` `machineRetro` `decideRetro` FR1-FR8 `help-lean.cjs`

**Covers:** SC-9

---

## Wave 5 — xprov help topics, opt-in log, reader check (lane xprov)

### Task 5.1: `xprov --help <topic>` and the moved 04b text
**Goal:** The consent, waiver, routing and edge-case text of 04b exists as four help topics that one command prints.
**Actions:**
1. `_shared/lib/help-xprov-consent.cjs` (cap 260): export `XPROV_TOPICS_CONSENT = { consent, waiver }`.
   - The text is moved from 04b at `c6b10a2`: Step 1.0 items 3-6 incl. both fenced commands (`xprov consent question --kind consent …`, `xprov consent record --kind consent …`), and Step 5 items 1-6 incl. the waiver and allowlist commands.
   - Keep each sentence. Re-indent and re-wrap only to the D5 topic format (two-space indent, wrap at 120, no line over 140 characters). Measured input: 2608 + 3348 = 5956 bytes; expected growth about 60-75 lines, so the file stays at most 260.
2. Create `_shared/lib/help-xprov-topics.cjs` (cap 220; a data module with no exit path, so the `emitExit` rule does not apply; it requires nothing from `help-xprov.cjs`, so there is no cycle): export `XPROV_TOPICS_MAIN = { routing, 'edge-cases' }` (JSDoc names both keys). Measured input: 5630 + 3279 = 8909 bytes; in the D5 topic format that is about 80-100 lines.
   - `routing`: the five notice lines, the warning/halt block, the round-cap/dispositions paragraph with the `xprov dispose` call, and each `not_applicable` reason's detail sentence from the Step 2 table.
   - `edge-cases`: the Edge-cases section. One sentence changes on the way (D9, audit M7): the Self-recovery item says the gate records each repair "in `recovery` (stdout) and in the run's line of `.a1/phases/<phase>/observations.jsonl` (`recovered` plus `recovery`: action, ok, attempt count; always written), and, with `A1_KEEP_REVIEW_LOGS=1`, in the log entry of `PLAN-REVIEW-LOG.md`". The rest of the item is moved unchanged. The line that names `PLAN-REVIEW-LOG.md` carries `A1_KEEP_REVIEW_LOGS=1` (D9 `MENTIONS_ALLOWED`).
3. `_shared/lib/help-xprov.cjs` (cap 620, 534 today):
   - Require `XPROV_TOPICS_MAIN` from `./help-xprov-topics.cjs` and `XPROV_TOPICS_CONSENT` from `./help-xprov-consent.cjs` (extend the existing line-8 destructure). Interpolate all four topics at the end of `XPROV_HELP` under a line `Phase 4b topics (a1-tools xprov --help <topic>):`. Growth at most 6 lines.
   - **Stale sentence, lines 324-325 (audit R2-m1).** Replace `recovery in stdout and in the log entry` with `recovery in stdout, in the observation line, and (with A1_KEEP_REVIEW_LOGS=1) in the log entry`, re-wrapping only lines 324-326 inside the existing 18-space indent, no line over 137 characters (today's longest), at most +1 line. The line does not name `PLAN-REVIEW-LOG`, so `MENTIONS_ALLOWED` is unaffected.
   - Lines 171 (`reason, recovered.`) and 346 (`recovered).`): name the new field, as `reason, recovered; xprov gate adds the compact recovery list.` and `recovered, recovery).`, ±0 lines.
4. `_shared/lib/xprov.cjs` (cap 460):
   - In `cmdXprov`: when `sub` is `--help` or `-h` and `args.length === 1`, look the topic up in the merged topic map (lazy `require` of both help modules).
     - Known → write it to stdout and exit 0 (`emitExit`).
     - Unknown → `usageExit` naming the four topics.
     - No topic → unchanged (exit 2).
   - Add a header note "Documented exception to the freeze (spec 027 slice 5, 2026-11-2x): the `--help <topic>` branch, a help dispatch, no subcommand change."
5. Create `_test-fixtures/a1-xprov/parts/39-help-topics.sh`.
   - HT1-HT4 each topic exits 0 and contains its anchor strings: consent → `consent question --kind consent`; waiver → `consent ensure --kind waiver`; routing → `xprov dispose`; edge-cases → `plugins_cache_empty`.
   - HT5 unknown topic → 2.
   - HT6 `xprov --help` without a topic → 2 (unchanged).
   - HT7 `a1-tools --help` contains all four topic headers.
   - HT8 the `edge-cases` topic contains `with \`A1_KEEP_REVIEW_LOGS=1\`, in the log entry of \`PLAN-REVIEW-LOG.md\`` and `observations.jsonl`, and does not contain the unconditional form `and in the log entry of \`PLAN-REVIEW-LOG.md\`` (whitespace-normalised).
   - HT9 `XPROV_HELP` (whitespace-normalised) contains `in the observation line, and (with A1_KEEP_REVIEW_LOGS=1) in the log entry` once and `recovery in stdout and in the log entry` zero times.
   - HT10 in the four topic strings (`XPROV_TOPICS_CONSENT.consent`, `.waiver`, `XPROV_TOPICS_MAIN.routing`, `['edge-cases']`): no prose line is longer than 140 characters, and no command line (trimmed, starts with `node <repo>/_shared/a1-tools.cjs`) is longer than 150; each command line, trimmed, occurs as a trimmed line of `git show c6b10a2:skills/a1-plan/workflows/04b-xprov-review.md` (the expected five command lines are written literally in the case, so it runs without `.git`). The case prints the longest prose and command lengths.
6. Run `bash _test-fixtures/a1-xprov/run-tests.sh --shard all` and a1-lib-units (`help-texts`).

**RED-proof:**
- (a) the topic branch also catches `xprov --help` without a topic → HT6 red.
- (b) `waiver` points at the consent text → HT2 red.
- (c) the topics are not interpolated into `XPROV_HELP` → HT7 red.
- (d) the Self-recovery sentence moved verbatim from 04b:341-342 → HT8 red. Plan-time red: `xprov --help edge-cases` on `c6b10a2` → rc=2 (no topic).
- (e) lines 324-325 of `help-xprov.cjs` left unchanged → HT9 red. Plan-time red run on `c6b10a2` (normalised `XPROV_HELP`): old phrase count 1, new phrase count 0.
- (f) one `routing` line re-joined to 141 characters → HT10 red.

**Done when:** a1-xprov passes with HT1-HT10 green; P13 is still green; `help-xprov.cjs` at most 620, `help-xprov-consent.cjs` at most 260, `help-xprov-topics.cjs` at most 220, `xprov.cjs` at most 460 lines; the HT10 longest prose-line value (at most 140) and command-line value (at most 150) are recorded in `STATUS-xprov.md`.
**Status box:**
- [ ] T5.1 `xprov --help <topic>` `help-xprov-topics.cjs` `XPROV_TOPICS_CONSENT` `XPROV_TOPICS_MAIN` HT1-HT10

**Covers:** SC-4

### Task 5.2: Opt-in `PLAN-REVIEW-LOG.md` and the reader check
**Goal:** The review log is written only with `A1_KEEP_REVIEW_LOGS=1`, and a script proves which opt-in candidates have readers.
**Actions:**
1. Create `_shared/lib/optin-logs.cjs` (cap 80) with `OPTIN_ENV = 'A1_KEEP_REVIEW_LOGS'`, `keepReviewLogs(env = process.env)` (true only for the exact value `1`), `OPTIN_FILES = ['PLAN-REVIEW-LOG.md']` and `MENTIONS_ALLOWED` (D9: a frozen array of `{file, contains, reason}`, line-exact, no whole-file entry). Fill `contains` from the measured mention lines. For the moved `edge-cases` sentence use the fixed D9 string `with \`A1_KEEP_REVIEW_LOGS=1\`, in the log entry of \`PLAN-REVIEW-LOG.md\`` (the HT8 anchor of Task 5.1, so this task does not wait for 5.1). The lines that Task 6.1 writes later (04b, a1-plan `SKILL.md` 49/81) are not mentions yet; until then the current lines are listed, and Task 6.1 action 3 re-measures them.
2. `_shared/lib/xprov-gate.cjs`:
   - `appendLog` (line ~356): return at the top when `!keepReviewLogs()`. `state.logged` and the other state flags stay set as today.
   - `runFields` (line ~543): add `...(state.recovery.length ? { recovery: compactRecovery(state.recovery) } : {})` inside the existing `return { … }` line, and `compactRecovery` to the existing line-61 destructure of `./xprov-observe.cjs`. The mapping never throws (D9, audit R2-m7).
   - Cap 740 (734 today, +2 at most).
3. `_shared/lib/xprov-observe.cjs` (cap 210, 188 today):
   - `runFieldsOf` validates and stores the optional `recovery` (D9: at most 8 items, `action` in the four recover actions, `ok` boolean, `attempts` integer 0..9, `fallback` boolean, nothing else; strict, throws `A1_INPUT`). JSDoc of `runFieldsOf` names the new field.
   - New export `compactRecovery(list)` (D9: pure, total, never throws; JSDoc `@returns` `{action, ok, attempts?, fallback?}[]`). Constant `RECOVERY_ACTIONS` shared by both functions.
4. `_shared/lib/xprov-run.cjs` `appendLog` (line ~595): the same check as an inline lazy `require` inside the existing `if (ctx.noLog) return null;` line 596. Net line growth 0 (918).
5. Create `bin/check-optin-readers.cjs` (cap 120, `#!/usr/bin/env node`, `chmod +x`).
   - `--name <literal>` (required), `--root <dir>` (default: the repo of the script).
   - Scans `skills/**/*.md`, `agents/**/*.md` and `_shared/lib/**/*.cjs`. A line containing the literal is a reader unless a `MENTIONS_ALLOWED` entry has the same file and its `contains` occurs in that line.
   - Prints JSON `{name, readers: [{file, line, text}], allowed: [{file, line, reason}]}`. Exit 1 when `readers` is non-empty, 0 otherwise, 2 on usage.
6. `_test-fixtures/a1-xprov/run-tests.sh`: add `export A1_KEEP_REVIEW_LOGS=1` directly after `export HOME="$SUITE_ROOT/home"` (line ~75), with a comment "spec 027 FR-032: the log is opt-in; the suite's log asserts run with it; part 40 proves default-off".
7. Create `_test-fixtures/a1-xprov/parts/40-optin-log.sh`:
   - OL1 a permitted planted repo, gate run with `env -u A1_KEEP_REVIEW_LOGS` → no `PLAN-REVIEW-LOG.md`, `XREVIEW.md` present. Reuse the part 06 gate helpers; read part 06 first.
   - OL2 the same with `A1_KEEP_REVIEW_LOGS=1` → the log is present with one entry.
   - OL3 `A1_KEEP_REVIEW_LOGS=yes` → no log.
   - OL4 `bin/check-optin-readers.cjs --name PLAN-REVIEW-LOG.md` on the real tree → exit 0.
   - OL5 a planted copy with one agent line naming the file → exit 1, `readers[0].file` is that agent.
   - OL6 `--name .last-run.json` on the real tree → exit 1, `readers` includes `skills/a1-plan/workflows/04b-xprov-review.md` and `skills/a1-execute/workflows/01-load.md`.
   - OL7 self-recovery with the log off: the part 29 scenario OB3 (read part 29 first; reuse `prep29`, `gate29`, `obs29`, `NET29`, `OK29` by copying the helpers) run with `env -u A1_KEEP_REVIEW_LOGS` → no `PLAN-REVIEW-LOG.md`; the last `observations.jsonl` line has `recovered: true` and `recovery[0]` equal to `{action: "runner_retry", ok: true, attempts: 2}`; the line holds no `cause`, no error text.
   - OL8 a planted copy where `help-xprov.cjs` gains one extra line naming `PLAN-REVIEW-LOG.md` without an allowed substring → exit 1, `readers[0].file` is `_shared/lib/help-xprov.cjs` (line-exact allowlist, audit m6).
   - OL9 `buildObservation` with `recovery: [{action: "x", ok: true}]` → throws `A1_INPUT`.
   - OL10 `compactRecovery` on hostile input (a non-array; then an array of 12 items mixing `{action: "x"}`, `{action: "runner_retry", ok: "yes", attempts: new Array(50), cause: "secret"}` and `{action: "preflight_repair", ok: false, refused: "/etc", actions: []}`) → no throw; at most 8 items; no key outside `action, ok, attempts, fallback`; `attempts` at most 9; the string `secret` and `/etc` absent from `JSON.stringify`; and `buildObservation({…, recovery: compactRecovery(hostile)})` does not throw.
   - OL11 `compactRecovery([{action: "blocked_retry", ok: true, fallback: true}])` → `[{action: "blocked_retry", ok: true, fallback: true}]`, and `buildObservation` stores it unchanged.
8. Run `bash _test-fixtures/a1-xprov/run-tests.sh --shard all` (part 29 included) and `bash _test-fixtures/a1-cli-output/run-tests.sh`.

**RED-proof:**
- (a) the `xprov-gate.cjs` check is removed → OL1 red.
- (b) `keepReviewLogs` accepts any non-empty value → OL3 red.
- (c) the harness export is removed → R2c (06-gate) red: this shows the existing asserts depend on it.
- (d) `MENTIONS_ALLOWED` gains `agents/` → OL5 red.
- (e) `runFields` without `recovery` → OL7 red. Plan-time red: `buildObservation` on `c6b10a2` drops a passed `recovery` (keys end at `recovered`).
- (f) a whole-file match instead of the `contains` check → OL8 red.
- (g) the `action` enum check removed → OL9 red.
- (h) `compactRecovery` passes unknown actions through → OL10 red (`buildObservation` throws `A1_INPUT`).
- (i) `compactRecovery` drops `fallback` → OL11 red. Plan-time evidence that the field exists: `xprov-recover.cjs:152` builds `{action: 'blocked_retry', ok: true, fallback: rv.fallback}`.

**Done when:** a1-xprov passes (all shards, part 29 OB1-OB9 unchanged) with OL1-OL11 green; `wc -l < _shared/lib/xprov-run.cjs` prints at most 918; `xprov-observe.cjs` at most 210 and `xprov-gate.cjs` at most 740.
**Status box:**
- [ ] T5.2 `optin-logs.cjs` `A1_KEEP_REVIEW_LOGS` `check-optin-readers.cjs` `recovery` `compactRecovery` OL1-OL11

**Covers:** SC-10

---

## Wave 6 — 04-audit trigger step and 04b at most 80 lines (lane xprov)
**Depends on:** Wave 5

### Task 6.1: Permit-check step, 04b cut, Phase 4b mentions
**Goal:** On `denied`, a1-plan reads only 04-audit. Otherwise it reads a 04b of at most 80 lines that points to the help topics. No default-path file names `04b-xprov-review.md` outside the trigger section.
**Actions:**
1. `skills/a1-plan/workflows/04-audit.md`, PASS branch. After the vault-mirror background block, replace the "Then load `04b-xprov-review.md`" bullet with a step "**Permit state (spec 027 FR-028).**". It has one fence:
   ```bash
   PC_OUT="$(mktemp)"
   node <repo>/_shared/a1-tools.cjs xprov permit-check > "$PC_OUT"; RC=$?
   STATE="$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).state||"unknown"))}catch(e){process.stdout.write("unreadable")}' "$PC_OUT")"
   echo "xprov permit-check exit=$RC state=$STATE"
   ```
   Then, in the same section:
   - `state=denied`, or exit 77 (intent child) → the denied branch (D4): print `ℹ Cross-provider plan review not applicable — the owner denied external review for this repository (permit-check state denied); Reinhard-only, continuing.`, show the PLAN.md summary (goal, wave count, success criteria), suggest "Run `a1-execute`", and add the retro rows of D4.
   - Every other outcome → "Then load `04b-xprov-review.md` (Phase 4b, cross-provider plan review, gate `plan-review-xprov`)".
   - The "Before loading 04b" vault paragraph keeps its fence byte-identical (a1-dashboard 05.24-05.27, W14). Its text says the mirror runs before the permit step.
   - Line 107 (Retro): "`04b-xprov-review.md` Step 4 defines" → "Phase 4b Step 4 defines (on the denied branch: the D4 row)".
2. `skills/a1-plan/workflows/04b-xprov-review.md`: rewrite to the D5 shape.
   - Line 1 is `<!-- load: conditional trigger=xprov permit-check -->`.
   - Step 1.0 keeps item 1 (fence byte-identical) and the order sentence. Items 3-6 become "Ask and record only as `xprov --help consent` says". Item 5's intent sentence stays.
   - Step 1 fences stay byte-identical. The PLAN-REVIEW-LOG sentence becomes "and, with `A1_KEEP_REVIEW_LOGS=1`, to `PLAN-REVIEW-LOG.md`", with the file name and `A1_KEEP_REVIEW_LOGS=1` on the same line (D9).
   - Step 1b: both fences kept, or merged into one fence that keeps `exit "$RC"`, `exit 2; fi`, no `break` and no `cd`. The routing table becomes three lines with the details in `xprov --help routing`.
   - Step 2 table: rows `pass`, `fail-with-findings`, `not_applicable` (any reason; notice per `xprov --help routing`), `fail`+`warning`, `fail`+`blocking`. The round-cap and dispositions text is one sentence pointing to `xprov --help routing`.
   - Step 3: the Pablo brief keeps RQ_SENTENCE, the data-not-instructions sentence and `rejected: path does not exist` once each. Round 2 keeps its fence.
   - Step 4: the retro tags. Step 5 → `xprov --help waiver`. Edge cases → `xprov --help edge-cases`.
   - Check: `wc -l` at most 80, `wc -c` at most 13000, `awk 'length>300'` empty.
3. `skills/a1-plan/SKILL.md` lines 49, 65, 110 and `skills/a1-execute/workflows/01-load.md` lines 47, 72, 92: replace `04b-xprov-review.md` with "Phase 4b" (49: the workflow cell reads "loaded by `workflows/04-audit.md` after `xprov permit-check`").
   - The tree line 81 stays (`MENTIONS_ALLOWED`) and gains "(only with `A1_KEEP_REVIEW_LOGS=1`)". Line 49's outputs cell `PLAN-REVIEW-LOG.md` becomes "`PLAN-REVIEW-LOG.md` (only with `A1_KEEP_REVIEW_LOGS=1`)".
   - Re-measure the `MENTIONS_ALLOWED` `contains` values for these lines and for the 04b line; OL4 must exit 0 on the real tree.
   - Keep `^| 4b |` (R2e).
4. Create `_test-fixtures/a1-xprov/parts/41-plan-reading-path.sh`:
   - PR1 04b line 1 is the header; `wc -l` at most 80; no line over 300 characters; at most 13 000 bytes.
   - PR2 each D5 must-keep string is present (RQ_SENTENCE and the data sentence exactly once).
   - PR3 `04-audit.md`: the `xprov permit-check` fence line comes before the first `04b-xprov-review.md` line, in the same `###` section.
   - PR4 the denied branch text (notice, plan summary, `xprov_not_applicable`) sits between the fence and the 04b line, and the notice line does not name `04b-xprov-review.md`.
   - PR5 no file under `skills/` except `04-audit.md` (its trigger section) names `04b-xprov-review.md` (grep).
   - PR6 a planted denied repo (part 12 `permit_lib` helpers and the denial store) with a phase that holds PLAN.md and no `xreview/` → `xprov load-check --phase p` exits 0 with `accepted: "not_applicable"`.
5. Run every suite that reads these files (touched-file pin rule): a1-xprov (all shards), a1-dashboard, a1-retro-validate (L12 04-audit), a1-workflow-lint (W14), a1-metrics (`parts/04-audit.sh`), a1-gates-lint, run-wave13/14, a1-intent (H7a plan floor 5).

**RED-proof:**
- (a) a 04b with 81 lines → PR1 red.
- (b) the permit-check fence moved after the 04b line → PR3 red.
- (c) one D5 string dropped (RQ_SENTENCE) → PR2 and RQ8 red.
- (d) `01-load.md` keeps `04b-xprov-review.md` → PR5 red.
- (e) T10 with the `exit 2; fi` line rewritten → T10 red.

**Done when:** every suite named in action 5 passes, or the deferred-pin rule records the red; PR1-PR6 are green; `gates lint` exits 0.
**Status box:**
- [ ] T6.1 `04-audit.md` permit step `04b-xprov-review.md` ≤ 80 PR1-PR6

**Covers:** SC-3, SC-4

---

## Wave 7 — a1-new-feature SKILL.md: kritis, Marketing, Isolation (lane cuts)

### Task 7.1: SKILL.md cuts, `kritis.md`, kritis pins
**Goal:** SKILL.md loses the kritis block, the Marketing Gate and the Isolation body, and gains three pointers. The kritis harness accepts exactly these changes.
**Actions:**
1. Create `skills/a1-new-feature/workflows/kritis.md`: line 1 `<!-- load: conditional trigger=profile resolve -->`, then lines 150-188 of `skills/a1-new-feature/SKILL.md` at `c6b10a2` byte-identical (`git show c6b10a2:skills/a1-new-feature/SKILL.md | sed -n 150,188p`).
2. `skills/a1-new-feature/SKILL.md`:
   - (a) Delete lines 150-188. Insert directly after line 148 (the resolve line, byte-unchanged) one line: `When it prints \`kritis\`, read \`workflows/kritis.md\` before Phase 1 and apply it to this run.`
   - (b) Delete the Marketing section (heading `## Marketing Gate …` through the blank line before `## Isolation Gate`). Insert the D13 pointer line after the last Lifecycle paragraph ("…sits in the phase flow."), separated by one blank line.
   - (c) Isolation: keep the heading line and its blank line. Replace the body through `` `_shared/parallel-spec-isolation.md`. `` with exactly three lines:
     ```
     No feature code in the primary checkout: create the worktree with the `a1-worktree` skill before Wave 1 (never a raw git command).
     Push, PR, squash merge and teardown run in `a1-pr-review` (`skills/a1-pr-review/workflows/05-merge.md`, then `feature close`).
     Full convention, scope-claim order and push cadence: `_shared/parallel-spec-isolation.md`.
     ```
   - (d) In "## Hard rules", insert after the first bullet one line: `- If \`origin/main\` is red for reasons unrelated to this feature: STOP, do not layer on top, report to Robert.`
3. `_test-fixtures/a1-kritis-profile/golden/prompts.allowed-diff`: add the rows for (a)-(d) under a comment block "Spec 027 slice 5 (FR-029/FR-030, 2026-11-2x)". The kritis pointer is one more `line` row after the existing resolve row. Every anchor is a golden line that occurs exactly once (check with `grep -cxF`).
4. `01-golden.sh` P-allowed: extend the literal simulation with (a)-(d) (sed `r FILE` for multi-line text, as the s4 block does).
5. `08-wiring.sh`:
   - `WIRE_SIX` SKILL.md `:1` → `:0`.
   - The D SKILL.md branch becomes the multiset compare of the pin table.
   - New `parts/10-kritis-split.sh`:
     - K5 `kritis.md` line 1 is the header; it has exactly one balanced `a1-profile:kritis` block whose first line is `WIRE_GUARD`; lines 2-40 equal the `c6b10a2` range (the expected text written literally in the case, not read from git, so it runs without `.git`);
     - K6 SKILL.md holds 0 kritis markers, 0 lines matching `^## Marketing Gate`, and exactly 1 line naming `a1-landing-feature`;
     - K7 the Isolation section body (lines between the heading's blank line and the next heading, non-blank) is exactly 3 lines and names the three targets.
6. Run `bash _test-fixtures/a1-kritis-profile/run-tests.sh`, a1-ux-studio (`07-integration.sh` reads SKILL.md), a1-intent, a1-pr-review (the :338 exclusion stays until Task 9.1), and run-wave13/14 (the `profile set` fence moved files).

**RED-proof:**
- (a) one extra inserted SKILL.md line → P and D red.
- (b) one byte changed in `kritis.md` line 20 → K5 red.
- (c) the `## Marketing Gate` heading back → K6 red.
- (d) a fourth Isolation line → K7 red.
- (e) the old D heredoc on the new tree → D red (old-pin red run).
- (f) an allowed-diff anchor that occurs twice → `apply-prompts-allowed.cjs` exit 3, P red.

**Done when:** a1-kritis-profile passes with K5-K7 green and only the listed pin changes; the other suites of action 6 pass; `git diff c6b10a2 -- _test-fixtures/a1-kritis-profile/golden/prompts/` is empty.
**Status box:**
- [ ] T7.1 `kritis.md` SKILL.md cuts `prompts.allowed-diff` K5-K7

**Covers:** SC-2, SC-7, SC-8

---

## Wave 8 — 06-verify: retro to `retro-prose.md`, listed compressions (lane cuts)
**Depends on:** Wave 7

### Task 8.1: `retro-prose.md`, Step 6 stub, compressions
**Goal:** The prose retro leaves the default path, and 06-verify shrinks by about 112 lines with no step, gate or call removed.
**Actions:**
1. Create `skills/a1-new-feature/workflows/retro-prose.md`:
   - Line 1 `<!-- load: conditional trigger=feature close -->`, then `# Prose retro (only when \`feature close --check-only\` prints \`"prose_required":true\`)`.
   - Then Step 6 of `06-verify.md` at `c6b10a2` (lines 443-509: intro, 6a, the validate fence byte-identical, 6b), with the intro changed to "Written when 05-merge item 1 says so; the reasons (`caught:<id>`, `result:fail`, `issues`) go into `issues`/`one_line_learning`. Validate against both logs as 05-merge item 1 says."
2. `06-verify.md`:
   - (a) Step 6 becomes `## Step 6 — Retro`, a blank line, and two lines: "`feature close` writes the machine retro record at close-out (spec 027 FR-031). A prose retro is written only when `a1-pr-review` 05-merge item 1 reports that one is due."
   - (b) Delete the stale "The helper: appends … clears `verify_failures`" lines after item 5.
   - (c) Tobi section → three lines (spawn `a1-tobi-tester` on request; four axes; BLOCKER/MAJOR/MINOR; findings are not `verify_failures` automatically).
   - (d) Pre-merge check → at most 14 lines that keep:
     - both commands (`git -C <repo> log --oneline <feature-branch>..origin/main`, `git -C <repo> ls-tree origin/main automation/db/migrations/ | grep -E '<your-new-numbers>'` as fenced lines);
     - the rebase-unpushed / merge-pushed rule with the push-cadence reference;
     - keep both sides of additive files;
     - renumber yours after origin's highest;
     - rebuild a stale `dist/` before calling main red;
     - the hand-off sentence with `caller_spec_id`.
   - (e) Failure path → at most 18 lines that keep the JSON shape line and the `spec update-status … --verify-failures-file` fence.
   - (f) Diana brief → at most 14 lines that keep the brief text and both rules.
   - (g) Step 5 Lifecycle Completion Gate item 3, lines 329-330 (audit M3): replace "after the retros (this skill's Step 6 incl. `retro validate --gate-log`, and the `a1-pr-review` retro: the gate logs are gitignored (FR-008) and are deleted with the worktree)" with "after the close-out retro decision (a1-pr-review 05-merge item 1; `feature close` writes the machine record; the gate logs are gitignored (FR-008) and are deleted with the worktree)". Reflow inside the same two lines, no line over 300 characters. Line arithmetic: ±0 (06-verify stays at about 410).
   - Do not touch Step 0.55, Step 0.6, the probe text (a1-probe D1/D1b), the cost fence, or any fenced `a1-tools.cjs` line except the moved retro fence.
   - Check: `wc -l` at most 412, and no new line over 300 characters.
3. `_test-fixtures/a1-retro-validate/run-tests.sh`: V8 and L12 file lists (listed pin), each with its two red runs.
4. Run a1-retro-validate, a1-probe (`parts/06-wiring.sh` reads 06-verify), a1-workflow-lint (VS3/VB2/QH7), a1-gates-lint (W11d, BU5c/BU6), a1-pr-review (:234, and RR_POS :262 for the close-out ordering), a1-kritis-profile (I, W over the dir), run-wave13/14, and a1-intent.

**RED-proof:**
- (a) the old V8/L12 lists on the new tree → V8 and L12 red (old-pin red run).
- (b) the validate fence in `retro-prose.md` piped (`| RC=$?`) → V8 red.
- (c) a `retro validate` line left in 06-verify → new case RP7 (Task 11.1), recorded now as a measured grep: `grep -c 'retro validate' 06-verify.md` = 1.
- (d) action 2(g) skipped → `grep -c 'retro validate'` prints 1 (line 329). Measured at plan time: `c6b10a2` 06-verify with only the Step 6 fence line (495) deleted → count 1, the remaining hit is line 329.


**Done when:** the suites of action 4 pass; `grep -c 'retro validate' skills/a1-new-feature/workflows/06-verify.md` prints 0; the measured a1-new-feature default path (`node -e` call of `measureSkills` from the lint lane is not available here, so use `cat skills/a1-new-feature/SKILL.md skills/a1-new-feature/workflows/0*.md | wc -l`) is at most 2360, recorded in STATUS-cuts.md.
**Status box:**
- [ ] T8.1 `retro-prose.md` Step 6 stub 06-verify compressions V8 L12

**Covers:** SC-2, SC-9

---

## Wave 9 — Other skills: Isolation pointers, allow markers, multi-lane (lane cuts)
**Depends on:** Wave 8

### Task 9.1: a1-execute, a1-fix, a1-quick, a1-pr-review SKILL.md; `multi-lane.md`
**Goal:** No raw `worktree add` or `--delete-branch` remains unmarked in `skills/` outside a1-worktree, and the multi-lane text is conditional.
**Actions:**
1. Create `skills/a1-execute/workflows/multi-lane.md`:
   - Line 1 `<!-- load: conditional trigger=lane-split check -->`, then `# Multi-lane phases`.
   - Then `skills/a1-execute/SKILL.md` lines 171-212 at `c6b10a2` minus step 1's fence and its "Exit 1" line (those stay in SKILL.md): the intro paragraph, step 1's `--imports` rationale, steps 2-7 and the closing paragraph about single-lane waves, byte-identical apart from the renumbering note "Step 1 (the check) runs in SKILL.md".
2. `skills/a1-execute/SKILL.md`:
   - (a) `## Multi-lane phases (PLAN.md declares a \`lanes:\` block)` keeps:
     - one sentence ("Waves run sequentially unless PLAN.md declares lanes.");
     - step 1's fence byte-identical (W11 `lane-split check` count 1);
     - "Exit 1 → do not start any lane; back to `a1-plan`.";
     - one line: "When the JSON prints `\"lanes\"` greater than 1, read `workflows/multi-lane.md` now and follow it; `imports_checked` must be `true`."
   - (b) Isolation step 2 → "Create the worktree with the `a1-worktree` skill (`prepare`, then `enter`); every erik wave runs inside that path." Keep the heading.
3. `skills/a1-fix/SKILL.md` step 1: replace the fence (`git -C <repo> fetch …` / `… worktree add …`) with one line "Create the worktree with the `a1-worktree` skill (`prepare`, then `enter`), slug `fix-<bug-slug>`, branch `fix/<bug-slug>`." Line 166 gets the allow marker at its end.
4. Allow markers (`<!-- lint-allow: forbidden-example -->` at the line end) on `skills/a1-quick/SKILL.md` lines 88 and 281, `skills/a1-pr-review/SKILL.md` line 139. (`05-merge.md:98` is marked in Task 10.2.)
5. `_test-fixtures/a1-pr-review/run-tests.sh` :336-340: drop the new-feature exclusion (listed pin). Re-pin a byte-exact a1-quick/a1-pr-review text pin only if red.
6. Check: `grep -rnE 'worktree\s+add|--delete-branch' skills --include=*.md | grep -v '^skills/a1-worktree/' | grep -v 'lint-allow: forbidden-example' | grep -v '^skills/a1-pr-review/workflows/05-merge.md:'` prints nothing.
7. Run a1-gates-lint (W11 `lane-split check` 1 on a1-execute SKILL.md, BU cases), run-wave13/14, a1-intent (06-run/06a "Isolation Gate", H7a execute floor 10, fix floor 12, seal copies), a1-quick, a1-pr-review, a1-fix, a1-worktree.

**RED-proof:**
- (a) the pointer line placed above the fence → RD3-shaped finding (recorded now as the measured line order; the rule runs in Task 11.1).
- (b) the `lane-split check` fence moved into `multi-lane.md` → W11 red (`expected 1 call(s), found 0`).
- (c) the a1-pr-review exclusion kept on the new tree but the scan widened → no red. The red run is instead: the old exclusion removed on `c6b10a2` → the stale scan is red (proves the pin is now meaningful).

**Done when:** the suites of action 7 pass; the action 6 grep is empty; `multi-lane.md` exists with its header.
**Status box:**
- [ ] T9.1 `multi-lane.md` Isolation pointers allow markers a1-pr-review :336 pin

**Covers:** SC-5, SC-8

---

## Wave 10 — Integration: per-wave sync, 05-merge retro and budget steps, facade (sequential)
**Depends on:** Wave 2, Wave 4, Wave 6, Wave 9

### Task 10.1: Per-wave sync removal, first budget file
**Goal:** No per-wave vault sync remains, the vault-sync rule and its pins agree, and the first `skills/reading-budget.json` exists.
**Actions:**
1. `skills/a1-execute/workflows/02-execute.md`: delete section `### 2b-v. Vault phase mirror …` and its fence, and every reference to "2b-v" in the per-wave loop text. The 2c summary drops "sync warning".
2. `skills/a1-plan/workflows/04-audit.md`: "(a1-execute step 2b-v)" → "(a1-execute `03-verify.md`, at phase end)".
3. `_shared/lib/workflow-lint.cjs` (443 lines at `c6b10a2`):
   - delete the `'skills/a1-execute/workflows/02-execute.md',` element of `REQUIRED_VAULT_SYNC_FILES` (−1 line);
   - add `VAULT_SYNC_CALL_RE,` to `module.exports`, after `REQUIRED_VAULT_SYNC_FILES,` (+1 line; audit R2-M1, the single source of D11);
   - in the comment block above the constant, change "the three files there" (line 246) to "the two files there", "(3 on a skills tree" (line 250) to "(2 on a skills tree", and "fixture W11 asserts 3" (line 251) to "fixture W11 asserts 2" (±0 lines);
   - line arithmetic: 443 − 1 + 1 = **443**; Task 11.1 adds 2 → **445 ≤ 445**.
4. Re-pin W11/W12 (`a1-workflow-lint/run-tests.sh`) and a1-dashboard 05.24/05.27/05.29/loop 170 per the pin table, each with two red runs. W12 becomes a module-level case (pin table): it plants the fence, calls `checkReadingPath` directly with `extractBashFenceLines` and `VAULT_SYNC_CALL_RE`, both read from `require(<repo>/_shared/lib/workflow-lint.cjs)` (exported by action 3), and asserts exactly one `sync_per_wave` finding naming `02-execute.md`.
   New case VR1 in `cases-read.sh`: `require(<repo>/_shared/lib/workflow-lint.cjs).VAULT_SYNC_CALL_RE` is a RegExp and `String()` of it equals `String(VSRE_LIT)` (the literal the lane cases pass), so the lane literal cannot drift from the one source. Update the W12-W14 comment block accordingly (02-execute is no longer a required vault-sync file).
5. Apply every deferred pin recorded by any lane (lint, retro, xprov or cuts) for suites outside its `owns:`, with two red runs each.
6. Write the first budget file: `node -e 'require("./_shared/lib/workflow-budget.cjs").cmdWorkflowBudget(["--write"])'`.
7. Run a1-workflow-lint, a1-dashboard, product-schema-v11, a1-xprov (06-gate, 19, 36 read 02-execute), a1-gates-lint, run-wave13/14 and a1-intent.

**RED-proof:**
- (a) the old W11 `"3 0 "` on the new tree → red.
- (b) W12 old-pin red run: the old `vaultSyncCase W12 …02-execute.md` on the new tree → red (`removed=0`). Measured at plan time on a `skills/` copy with the 2b-v fence stripped once: the second strip returns `removed=0`.
- (c) the old 05.24 on the new tree → red.
- (d) W12 new-pin red run: on the scratch copy, drop `02-execute.md` from `PER_WAVE_FILES` in `workflow-lint-read.cjs` → W12 red (0 `sync_per_wave` findings).
- (e) W12 with the plant step removed → W12 red (0 findings).
- (f) `VAULT_SYNC_CALL_RE,` removed from `module.exports` → VR1 red, and W12 red (`checkReadingPath` throws `A1_INPUT`). Plan-time red run on `c6b10a2`: `node -e 'process.exit(require("./_shared/lib/workflow-lint.cjs").VAULT_SYNC_CALL_RE instanceof RegExp?0:1)'` → rc=1.

**Done when:** the suites of action 7 pass (W12 and VR1 green at module level, no CLI hook needed); `node -e 'process.exit(require("./_shared/lib/workflow-lint.cjs").VAULT_SYNC_CALL_RE instanceof RegExp?0:1)'` exits 0; `wc -l < _shared/lib/workflow-lint.cjs` prints 443; `grep -c 'vault sync\|dashboard build' skills/a1-execute/workflows/02-execute.md` prints 0; `skills/reading-budget.json` has one entry per `skills/*/SKILL.md` (18 at `c6b10a2`).
**Status box:**
- [ ] T10.1 02-execute 2b-v removed `REQUIRED_VAULT_SYNC_FILES` `VAULT_SYNC_CALL_RE` export W11 W12 VR1 05.24 `reading-budget.json`

**Covers:** SC-10, SC-1

### Task 10.2: 05-merge retro decision, budget ratchet step, 04-submit fold, facade and help
**Goal:** The close-out writes prose only on the decision, the ratchet runs before every merge, and `workflow budget` is a real CLI command.
**Actions:**
1. `_shared/a1-tools.cjs`:
   - In the `workflow` group, add one line before `} else usage(…)`: `} else if (sub === 'budget') { require(path.join(__dirname, 'lib', 'workflow-budget.cjs')).cmdWorkflowBudget(rest); return;`.
   - Extend the `usage()` string (same line) with "Spec 027 slice 5 adds: workflow budget, xprov --help <topic>, feature close --issues".
   - Facade at most 790 lines.
2. `_shared/lib/help-lean.cjs`: add the `workflow budget [--root] [--write] [--base <ref>]` block (exit codes, trailer form, counting rule). Add its assert to `cases/help-lean.cjs` and `cases/help-texts.cjs` if that case enumerates facade subcommands.
3. `skills/a1-pr-review/workflows/05-merge.md`:
   - (a) 5.3 fence: add before the `test-fidelity` line
     `node <repo>/_shared/a1-tools.cjs workflow budget --base "$(git merge-base origin/<base> HEAD)"; RC=$?` and
     `if [ "$RC" -ne 0 ]; then echo "STOP: workflow budget exit=$RC (1 = a skill over budget or a raised entry without a budget-raise: trailer, 2 = base not resolvable), no merge"; exit "$RC"; fi`.
     Directly after the fence, one prose line (the rationale, audit R2-M3): "In a repository without `skills/` or without `_shared/a1-tools.cjs` (every consumer repo) `workflow budget` prints `scope: \"out\"` and exits 0, so this STOP fires only for a1-specforge itself."
   - (b) Line 98 gets the allow marker.
   - (c) Close-out item 1 is rewritten:
     - a1-pr-review writes no retro of its own when a caller handed over a spec id or phase (D7);
     - keep the item's first-line prefix `1. Retros, each with` (RR_POS pin, `a1-pr-review/run-tests.sh:262`);
     - with a `caller_spec_id`, run the new fenced block T. It reads `<caller_spec_id>` and `<issue_tags>` (`none` or comma-separated tags) through the two-line heredoc guards and validates both. Then it defines `RD="$(mktemp)"` and runs `(cd "<repo_root>" && node <repo>/_shared/a1-tools.cjs feature close --check-only --by "$SPEC_ID" --pr <n> $ISSUES_ARG) > "$RD"; RC=$?`, where `ISSUES_ARG` is set only from the validated value (`--issues "$ISSUES"`), and prints `prose_required` and `reasons` with a `node -e` read. `<repo_root>`, `<repo>` and `<n>` stay raw: they are orchestrator-substituted (Execution location, exception 2);
     - exit ≠ 0 → STOP;
     - after the block, in the same section: "When `prose_required` is true, write the caller's prose retro now, from inside the worktree, per a1-new-feature `workflows/retro-prose.md`, validated against both logs (`--gate-log <caller phase log> --gate-log .a1/phases/pr-<n>/gate-log.jsonl`). When it is false, write none.";
     - a1-fix caller: unchanged sentence (retro already written). No caller: the 04-submit retro.
   - (d) Item 3's real `feature close` call passes the same validated `--issues` (read again through the guard in that block).
4. `skills/a1-pr-review/workflows/04-submit.md` Retro: "Only when a1-pr-review runs on its own (no caller): …"; with a caller it is folded into the caller's machine record and prose retro (05-merge item 1).
5. Pins: a1-pr-review block order → `8 DCMGTRFP` and the CB/RR indices; gates-lint W13d/W13c/W14e (listed). New a1-pr-review case file `cases-retro-step.sh` (source line before the final summary):
   - RS1 block T lies between G and R;
   - RS2 the heredoc guard rejects a two-line `<issue_tags>` (stub run as in CB2);
   - RS3 `none` passes no `--issues`;
   - RS4 the text names `retro-prose.md` after block T in the same section.
   - RS2b block T holds `RD="$(mktemp)"` on a line before the first `"$RD"`.
   - RS5 every raw `<token>` in block T outside the two heredoc bodies is one of the exempt orchestrator placeholders (`<repo>`, `<n>`, `<base>`, `<repo_root>`, `<worktree_path>`); the same check runs on the new 5.3 `workflow budget --base` line. Plan-time red run: the RS5 check on a stub fence with a raw `--by <caller_spec_id>` → `RS5 red: raw <caller_spec_id>`.
   - RS6 exactly one fenced block of `05-merge.md` contains `prose_required` (block T), and block T contains none of `disposition review`, `run record`, `probe run`, `pr merge-check` (classifier precedence, audit R2-m6).
   - The block-order classifier at `run-tests.sh:265` gains `/prose_required/.test(x)?"T":` as the first test of its chain; the count assert at :264 goes `7` → `8` and the order assert at :266 `DCMGRFP` → `DCMGTRFP` (pin table row).
   - The 5.3 rationale line names consumer repos; BG15 (Task 1.1) proves the behaviour it states.
6. **Re-write the budget file (audit R2-M2).** After actions 1-5 (the facade line exists, the 05-merge and 04-submit edits are in), run `node _shared/a1-tools.cjs workflow budget --write` and commit `skills/reading-budget.json` together with this task's skill edits. Reason: Task 10.1 wrote equality budgets, and this task grows a1-pr-review's default path, so without the re-write CLI1 gets `budget_exceeded:a1-pr-review` and exits 1.
7. Facade smoke case CLI1 in `cases-budget.sh`: `node _shared/a1-tools.cjs workflow budget` exits 0 on the real tree, with `scope: "in"`.
8. Run a1-pr-review, a1-gates-lint, run-wave13/14, a1-lib-units, a1-workflow-lint, a1-cli-output, a1-verify (`cases-envred.sh` reads 05-merge) and a1-pr-merge-check (MH9).

**RED-proof:**
- (a) the old `7 DCMGRFP` on the new tree → red.
- (b) block T after R → RS1 red.
- (c) the guard missing its second read → RS2 red.
- (d) the facade line removed → CLI1 red.
- (e) the `--issues` flag missing from help-lean → W13c red (`flag not in help`).
- (f) the `RD="$(mktemp)"` line removed → RS2b red.
- (g) `--by "$SPEC_ID"` replaced by a raw `--by <caller_spec_id>` → RS5 red.
- (h) help-lean pin, first red run: this change only adds an assert (no existing assert is edited), so no old pin can fail; instead the new `workflow budget` assert runs against the pre-10.2 `help-lean.cjs` (Task 4.1 state, no block) → red.
- (i) help-lean pin, new-pin red run: the `workflow budget` block removed from `help-lean.cjs` → the new assert red.
- (j) action 6 skipped (budget file as Task 10.1 wrote it) → CLI1 red (`budget_exceeded:a1-pr-review`, exit 1). This is the red the audit predicted for revision 2.
- (k) the T pattern placed after the `feature close` test instead of first → order `DCMGFRFP`, the order assert red.

**Done when:** the suites of action 8 pass, with RS1-RS6, RS2b and CLI1 green; `skills/reading-budget.json` is committed in the same commit as the 05-merge/04-submit edits; `wc -l < _shared/a1-tools.cjs` prints at most 790.
**Status box:**
- [ ] T10.2 05-merge block T `workflow budget --base` 04-submit fold facade `help-lean.cjs` `reading-budget.json` rewrite RS1-RS6 CLI1

**Covers:** SC-1, SC-9

---

## Wave 11 — Hook, final budgets, SC-006, ADR (sequential)
**Depends on:** Wave 10

### Task 11.1: Hook the reading-path rules; final budgets; SC-006
**Goal:** `workflow lint` enforces FR-027/028/030/032 on the real tree, and the budgets equal the achieved sizes.
**Actions:**
1. `_shared/lib/workflow-lint.cjs` (at most 445):
   - add one line after the `bg` findings line: `const rp = require('./workflow-lint-read.cjs').checkReadingPath(root, { extractBashFenceLines, VAULT_SYNC_CALL_RE }); findings = findings.concat(rp.findings);` (both are module-level names of `workflow-lint.cjs`; audit R2-M1);
   - add one output key line `reading_path: rp.checked,`;
   - 443 (after Task 10.1) + 2 = 445 ≤ 445.
2. `node _shared/a1-tools.cjs workflow budget --write`. Commit `skills/reading-budget.json`.
3. New cases in `cases-read.sh` (real tree):
   - RP0 `workflow lint` exits 0 and `reading_path.budget_skills` equals the number of `skills/*/SKILL.md` files, counted by the case itself (`ls skills/*/SKILL.md | wc -l`; 18 at `c6b10a2`), never a literal;
   - RP1 the `workflow budget` JSON lists, among the conditional files, at least these four by path: `skills/a1-new-feature/workflows/kritis.md`, `skills/a1-new-feature/workflows/retro-prose.md`, `skills/a1-execute/workflows/multi-lane.md`, `skills/a1-plan/workflows/04b-xprov-review.md` (a later conditional file needs no assert edit);
   - RP2 a1-new-feature lines **below 2378** (the SC-006 bound, permanent; a later trailer-backed raise below 2378 stays green);
   - RP2b (not a suite case): a1-new-feature at most 2360 on this head; the value goes into `STATUS.md` (one-time SC-2 evidence, like RP3b);
   - RP3 every skill's measured lines are at most its budget (`lines <= budget`, D12; permanent);
   - RP3b (not a suite case): `workflow budget` JSON on this head shows `lines == budget` for every skill; the compare line goes into `STATUS.md` (one-time SC-2 evidence);
   - RP4 a `copySkills` tree plus an empty `_shared/a1-tools.cjs` (D12a opt-in) plus one appended line in `skills/a1-new-feature/SKILL.md` → exit 1 `budget_exceeded:a1-new-feature`;
   - RP8 a `copySkills` tree with a fence `node <repo>/_shared/a1-tools.cjs vault sync x --phases` appended to `skills/a1-execute/workflows/02-execute.md` → `workflow lint` exit 1 with exactly one `sync_per_wave` finding (the CLI form of W12);
   - RP5 a copy with an unmarked `git worktree add` line in `skills/a1-fix/SKILL.md` → 1;
   - RP6 a copy where `04-audit.md` names `04b-xprov-review.md` above the permit fence → 1;
   - RP7 a copy with a `retro validate` fence back in 06-verify → still 0 (no rule), but `grep -c` 1. This documents that SC-9's "no `retro validate` in 06-verify" is asserted by RP7b `grep -c` = 0 on the real tree.
4. Record the per-skill table (before, after, budget), the RP2b value and the RP3b line in `STATUS.md`.
5. After the hook, run the copy-based suites of the pin table row "copy-based lint cases": a1-workflow-lint (VS7 must stay green), a1-gates-lint incl. `run-wave13.sh`/`run-wave14.sh` (copy `skills/`), a1-fix (wave12 lint on the real repo), a1-metrics (AU3f). Record VS7's result in `STATUS.md`. A red case here is a STOP: fix the scope (D12a), never the case.

**RED-proof:**
- (a) the hook line removed → RP0 red (no `reading_path` key).
- (b) one budget lowered by 1 → RP3 and `workflow lint` red.
- (c) RP4, RP5 and RP6 are themselves red plants.
- (d) RP3 written as equality, then one skill shortened by one line on the scratch copy → RP3 red (proves why the permanent case is `<=`); with `<=` it stays green. Plan-time red run of the `<=` check: budget `{a1-execute: 1120}` against the measured 1121 → `RP3 red: over a1-execute`.
- (e) the hook line removed → RP8 red (no `sync_per_wave` from the CLI).
- (f) the hook passes only `{ extractBashFenceLines }` (the revision-2 form) → `checkReadingPath` throws `A1_INPUT`, `workflow lint` exits non-zero, RP0 red. Plan-time red run of the missing source: `require("./_shared/lib/workflow-lint.cjs").VAULT_SYNC_CALL_RE instanceof RegExp` → false on `c6b10a2` (rc=1).
- (g) `checked.budget_skills` reported as the literal 18, and the scratch copy gains `skills/zz/SKILL.md` plus a `zz` budget entry → RP0 red (19 SKILL.md files, 18 reported). RP1 plan-time red: `grep -rl 'load: conditional' skills | wc -l` → 0 on `c6b10a2`. RP2 plan-time red: 2560 on `c6b10a2` (V2).

**Done when:**
- `workflow lint` exits 0 with RP0-RP8 and RP7b green; the RP3b line in `STATUS.md` shows equality for every skill, and the RP2b line shows a1-new-feature at most 2360;
- the suites of action 5 pass;
- `gates lint` exits 0;
- `workflow budget` exits 0 and reports a1-new-feature at most 2360;
- `workflow-lint.cjs` is at most 445 lines.

If a1-new-feature is above 2360 but below 2378: record the margin and continue. At 2378 or more: STOP and apply the reserve cuts (a1-new-feature 06-verify Step 5.5 "Rules" bullets → one line each; 05-implement Gate 0.5 rationale paragraph → one line). Then re-run `node _shared/a1-tools.cjs workflow budget --write`, commit `skills/reading-budget.json` with the cuts (audit R2-m4), re-run RP0-RP3 and re-record the RP2b and RP3b lines, then re-measure. If the target is still missed, the Answers fallback applies: ratchet at the achieved size, and record the shortfall (measured value, margin) in `STATUS.md` under `fallback:`. Task 13.1 writes it as a proposed spec Clarification and a hub item; the PR text names it.
**Status box:**
- [ ] T11.1 `checkReadingPath` hook `reading-budget.json` final RP0-RP8 RP7b SC-006


**Covers:** SC-1, SC-2, SC-6, SC-8, SC-10

(Task 11.2 of revision 1, the global `a1-landing-feature` edit, moved after the merge as Task 13.1 action 1, audit m7.)

### Task 11.3: ADR and docs
**Goal:** The new conventions are written down once.
**Actions:**
1. Create `docs/adr/2026-11-23-reading-budget-and-conditional-load.md`. It covers:
   - the counting rule;
   - the conditional header and reference rule (D3);
   - the ratchet and its merge-step location (D8);
   - the forbidden-pattern rule and marker (D10);
   - the opt-in log and reader check (D9);
   - the machine retro (D6/D7).

   `design-review-xprov` on it answers `not_applicable` (repo `denied`).
2. `_test-fixtures/CONVENTIONS.md`: one paragraph on `A1_KEEP_REVIEW_LOGS=1` in the a1-xprov harness, and on budget-aware fixture trees: copying `skills/` copies `reading-budget.json`, and the budget check runs only on roots that hold `_shared/a1-tools.cjs` (D12a); a case that wants it plants an empty one.

**Done when:** both files exist and contain those sections; `bash bin/verify-install-sync.sh` exits 0.
**Status box:**
- [ ] T11.3 ADR `2026-11-23-reading-budget-and-conditional-load.md` CONVENTIONS note

**Covers:** SC-11

---

## Wave 12 — Full run, review (Reinhard + Samuel), merge (sequential)
**Depends on:** Wave 11

### Task 12.1: [ORCHESTRATOR] Full run, review, merge
**Goal:** The PR is green, reviewed and merged.
**Actions:**
1. Run and record in `STATUS.md`:
   - `gates lint` → 0;
   - `workflow lint --phase 027-lean-pipeline-s5` → 0;
   - `check-wave11-callsites.cjs .` → its count line;
   - `run-wave13.sh`/`run-wave14.sh` → 0;
   - the V13 caps loop → `rc=0`;
   - the V14 frozen-files diff → 0;
   - `lane-split check` (both forms) → 0;
   - `bash bin/run-suites.sh --check-groups` → 0;
   - `bash bin/run-suites.sh` → 0;
   - `workflow budget` → 0, plus the RP2b value and the RP3b equality line (every skill `lines == budget`);
   - `verify run --no-cache --out .a1/phases/027-lean-pipeline-s5/VERIFICATION.md --phase 027-lean-pipeline-s5` → verdict pass (Victor's run).
2. `a1-specforge:a1-pr-review` on the branch (Reinhard, one review per head).
3. **Samuel spawned explicitly**, whatever 2.2b reports. Brief points:
   1. D4: the denied branch keeps the retro row; `load-check` reads the permit state; exit 77 handling; any other state loads 04b; the xprov chain is unedited (diff of `xprov-permit.cjs`, `xprov-preflight.cjs`, the gitleaks call sites and the tripwire is empty);
   2. D5: the `xprov.cjs` freeze exception is help-only;
   3. D9: the audit-trail reduction (PLAN-REVIEW-LOG opt-in), the line-exact `MENTIONS_ALLOWED`, that XREVIEW.md and `xreview/index.json` still record every review, and the **self-recovery trail with the log off**: the observation line's `recovery` field records every repair (action, ok, attempt count), is validated by `xprov-observe.cjs`, and stores no cause string, error text or path (OL7, OL9);
   4. D6: the store write (symlink refusal, lock, idempotency, size cap) and the `--issues` validation;
   5. the heredoc guards of 05-merge block T.
4. Reinhard's brief adds D1/D2 (the kritis reading and allowed-diff rows), D3 (reference rule), D8 (ratchet location), D11 and every pin change in the table.
5. Fix every BLOCKER and MAJOR. When a fix touches `skills/`: re-run `node _shared/a1-tools.cjs workflow budget --write`, commit `skills/reading-budget.json` with the fix, re-run RP0-RP3 and the RP3b equality line. Then re-run action 1 and wait for CI green.
6. Merge-check once, default path, per 05-merge 5.3 with the repo's own CLI. This is also the first live `workflow budget --base` run: `base.budget == "absent"`.
7. Merge, verify MERGED. Close out with the F block (`feature close`) from the primary checkout's `main`. Release the scope with a chore PR.
8. **PR text names:**
   - D1-D14 and D12a;
   - every pin change with its red runs;
   - the planned outside-repo edit of `a1-landing-feature` (runs after the merge, Task 13.1);
   - the measured SC-006 value;
   - the "Readings for the owner's reconcile" list (for reviewers; the owner's copy is written by Task 13.1);
   - the follow-ups (Out of scope);
   - the release proposal (1.19.0, then `claude plugin update a1-specforge` on both hosts). The release is a separate step after slice 5, not part of this plan's waves.

**Done when:** `gh pr view <n> --json state` prints `MERGED`, and no `027-lean-pipeline` reservation remains.
**Status box:**
- [ ] T12.1 PR merged Reinhard Samuel `feature close` scope released

**Covers:** SC-11, SC-12

---

## Wave 13 — Post-merge record (sequential)
**Depends on:** Wave 12

### Task 13.1: [ORCHESTRATOR] Global skill edit, owner readings and follow-ups into the vault, final report
**Goal:** Everything this slice defers reaches a place the owner reads: the spec `## Clarifications`, the vault hub and the final report.
**Execution context (audit R2-m5).** After Task 12.1 action 7 no phase worktree exists and the scope is released. Wave 13 runs from the primary checkout `/home/rob/claude-projects/a1-specforge` on `main` after `git -C /home/rob/claude-projects/a1-specforge pull --ff-only` (the `fallback:` line, if any, is read from the merged `.a1/phases/027-lean-pipeline-s5/STATUS.md` there). It writes nothing into the repo. The per-wave gate (`verify run --affected --project "$WORK_PATH"`) is not applicable. The evidence (the Done-when command outputs, the backup path, the Mac result) goes into the orchestrator's final report, not into a repo STATUS file. SC-7's post-merge clause, SC-13 and V16 are checked by the orchestrator here, not by the pre-merge `VERIFICATION.md`.
**Actions:**
1. Global skill `a1-landing-feature` (former Task 11.2, moved here by audit m7; the PR is merged, so the edit cannot outlive an abandoned PR):
   - `cp ~/.claude/skills/a1-landing-feature/SKILL.md ~/.claude/backups/a1-landing-feature-SKILL.md.$(date -u +%Y%m%dT%H%M%SZ)`.
   - Add a section `## Entry check (from a1-new-feature, spec 027 FR-029)` near the top. It holds the applicability sentence (A1//office `n3ural-platform` only), the five questions verbatim from `c6b10a2` SKILL.md 321-325, the evidence sources sentence, and the any-"no" rule with the never-customer-visible list.
   - In the description, "reaches its Marketing-Gate after Phase 6" → "reaches `done` (a1-new-feature hands customer-visible features here)".
   - Mac: `ssh mac test -f ~/.claude/skills/a1-landing-feature/SKILL.md`. If it exists, apply the same diff there (backup first). `claude plugin update a1-specforge` is **not** run here: it follows the 1.19.0 release, which is a separate step after slice 5 (see "Review and merge"). If `ssh mac` fails, the Mac copy becomes a hub item (action 3).
2. Spec `$A1_VAULT_ROOT/project/a1-specforge/spec/027-lean-pipeline.md`, section `## Clarifications`: append one dated entry per reading of the "Readings for the owner's reconcile" list (D1, D2, D4, D6, D8, D9, D12, D14, and the Task 11.1 fallback only when `STATUS.md` holds a `fallback:` line), each in the form `- **<date>** — Slice 5 <Dn> (proposed reading, pending owner reconcile): <reading>. Reason: <one clause>. PR #<n>.` Edit only by appending lines at the end of that section; never rewrite the file.
3. Vault hub `$A1_VAULT_ROOT/project/a1-specforge.md`: insert a new section `## Status (Stand <date>) — Spec 027 Slice 5 gemergt (#<n>)` above the newest status section (German, like the existing sections; append-only edit, the hub is never rewritten). It holds:
   - the merged PR, the measured SC-006 value, the release state;
   - "Vorgeschlagene Lesarten, warten auf Owner-Reconcile": one line per reading of action 2 (and the fallback, when it triggered);
   - open items: a separate `a1-fix` for the raw `verify run` placeholders in 02-execute/05-implement, CB4d attribution and 2b-g wording (s4 follow-ups); the a1-evolve note (count `kind: machine` entries in the 5-entry threshold, and the threshold notice now sits only in `retro-prose.md`, so the default path no longer prompts `a1-evolve`, audit m9); the s4 follow-up "carry placeholder values via a file or env var"; the Mac copy of `a1-landing-feature`, when action 1 could not apply it.
4. The orchestrator's final report to the owner (German, per the global rules) lists every reading of action 2 with the question it needs answered, the open items of action 3, and the paths of both vault edits. This report is the consumer of the readings.

**Done when:**
- `grep -c 'Would a customer notice this' ~/.claude/skills/a1-landing-feature/SKILL.md` prints 1 and a backup file exists;
- `grep -c 'Slice 5 D[0-9]* (proposed reading, pending owner reconcile)' "$A1_VAULT_ROOT/project/a1-specforge/spec/027-lean-pipeline.md"` prints 8 (9 with the fallback);
- `grep -c '^## Status (Stand .*Slice 5' "$A1_VAULT_ROOT/project/a1-specforge.md"` prints 1, and that section names `a1-fix`, `a1-evolve` and the Mac state;
- the final report lists the readings and quotes the outputs of the three greps above.

Red when: a reading is missing from the spec or the hub, or the section is absent. Red run (plan time, 2026-11-23): both greps print 0 on today's vault files.
**Status box:**
- [ ] T13.1 `a1-landing-feature` entry check, spec `## Clarifications` readings, hub status section, final report

**Covers:** SC-7, SC-13

---

## Verification

Run against the PR head, cwd = worktree root. Red runs were executed on `main` @ `c6b10a2` on 2026-11-23 at plan time unless noted.
- [ ] V1 `node _shared/a1-tools.cjs workflow budget` exits 0 with `scope: "in"` and prints one skill per `skills/*/SKILL.md` (18 at `c6b10a2`); BG15 passes (consumer repos exit 0); `skills/reading-budget.json` exists; on the merge head every skill shows `lines == budget` (RP3b, one-time), and RP3 (`lines <= budget`) passes.
  - Red when: the file or the subcommand is missing, a skill lacks an entry, a count differs from `wc -l`, or a review fix changed `skills/` without a re-run of `--write`.
  - Red run: `workflow budget` → rc=1 (unknown subcommand); `ls skills/reading-budget.json` → rc=2; the `<=` check with budget `{a1-execute: 1120}` against the measured 1121 → `RP3 red: over a1-execute`.
- [ ] V2 a1-new-feature default path at most 2360 (SC-006 below 2378), read from `workflow budget` JSON.
  - Red when: the value is 2378 or more, or a conditional file is counted.
  - Red run: `cat skills/a1-new-feature/SKILL.md skills/a1-new-feature/workflows/*.md | wc -l` → 2560.
- [ ] V3 `workflow lint` exits 0 on the real tree with `reading_path` present; RP1 lists the four conditional files by path; RD9 and VR1 pass (the vault-sync regex has one source and the rule fails closed without it).
  - Red when: the hook is missing or a rule fires on the real tree.
  - Red run: `workflow lint` JSON keys on `c6b10a2` are `root,scanned,vault_sync_checked,…,background_checked,findings`; `"reading_path" in j` → `false`; `grep -rl 'load: conditional' skills | wc -l` → 0.
- [ ] V4 `grep -c 'xprov permit-check' skills/a1-plan/workflows/04-audit.md` ≥ 1, and PR3/PR4/PR6 pass.
  - Red when: the step is missing, comes after the 04b reference, or the denied branch references 04b.
  - Red run: count 0 on `c6b10a2`.
- [ ] V5 `wc -l < skills/a1-plan/workflows/04b-xprov-review.md` at most 80, the longest line at most 300, `wc -c` at most 13000; `node _shared/a1-tools.cjs xprov --help consent` exits 0.
  - Red when: any limit is exceeded or a topic is missing.
  - Red run: 358 lines, longest line 925, 26802 bytes; `xprov --help consent` → rc=2.
- [ ] V6 `skills/a1-execute/workflows/multi-lane.md` starts with the `lane-split check` header; `check-wave11-callsites.cjs .` passes with `lane-split check` 1 in a1-execute SKILL.md.
  - Red when: the file is missing or the fence moved out of SKILL.md.
  - Red run: `ls skills/a1-execute/workflows/multi-lane.md` → rc=2.
- [ ] V7 K5-K7 pass; `grep -c 'a1-profile:kritis -->' skills/a1-new-feature/SKILL.md` prints 0; `grep -c '^## Marketing Gate' skills/a1-new-feature/SKILL.md` prints 0.
  - Red when: a marker or the heading remains, or `kritis.md` differs from the source range.
  - Red run: on `c6b10a2` the marker count is 2 (one block) and the heading count is 1; `kritis.md` is missing.
- [ ] V8 `grep -rnE 'worktree\s+add|--delete-branch' skills --include=*.md | grep -v '^skills/a1-worktree/' | grep -vc 'lint-allow: forbidden-example'` prints 0; FB1-FB6 and RP5 pass.
  - Red when: a raw command or an unmarked mention remains.
  - Red run: 9 matching lines on `c6b10a2` (a1-fix 2, a1-new-feature 2, a1-execute 1, 05-merge 1, a1-pr-review 1, a1-quick 2).
- [ ] V9 MR1-MR11 and FR1-FR8 pass; `grep -c 'retro validate' skills/a1-new-feature/workflows/06-verify.md` prints 0.
  - Red when: no machine record, a wrong decision, a non-idempotent append, or a prose retro is still demanded on the default path.
  - Red run: `node -e 'require("./_shared/lib/machine-retro.cjs")'` → MODULE_NOT_FOUND; `grep -c 'retro\|prose' _shared/lib/feature-close.cjs` → 0; `feature close --by x --pr 1 --issues a` → rc=2 `unexpected argument "--issues"`; `grep -c 'retro validate' 06-verify.md` → 2 (lines 329 and 495); with only line 495 deleted → 1 (line 329, closed by Task 8.1 action 2(g)).
- [ ] V10 `grep -c 'a1-tools.cjs vault sync' skills/a1-execute/workflows/02-execute.md` prints 0; SP1-SP5, W12, RP8 and OL1-OL9 pass; `bin/check-optin-readers.cjs --name PLAN-REVIEW-LOG.md` exits 0.
  - Red when: the per-wave sync remains, a default gate run writes the log, a self-repair leaves no always-on trail, the sync counts use substrings, or the reader check is missing.
  - Red run: the count is 1 on `c6b10a2`; `ls bin/check-optin-readers.cjs` → rc=2. Default-on today is proven by the code path `xprov-gate.cjs:356` `appendLog` (unconditional) and by the green R2c assert (`06-gate.sh:132-134`, log present after a default gate run). `buildObservation` drops `recovery` on `c6b10a2`. Fenced substring counts on the real files: 2/2 (`04-audit.md`, `03-verify.md`), cost run 2 (a1-fix `04-verify.md`), anchored 1 each.
- [ ] V11 `node _shared/a1-tools.cjs gates lint` exits 0, and `bash bin/run-suites.sh` exits 0.
  - Red when: a keep-list owner string is lost or any suite fails.
  - Red run: the RED-proof lines of Tasks 1.1-11.1 (planned: T1.1 7, T2.1 8, T3.1 5, T4.1 6, T5.1 6, T5.2 9, T6.1 5, T7.1 6, T8.1 4, T9.1 3, T10.1 6, T10.2 11, T11.1 7 = 83), each applied once on a scratch copy and logged.
- [ ] V12 `lane-split check --plan .a1/phases/027-lean-pipeline-s5/PLAN.md --phase 027-lean-pipeline-s5` and the same with `--imports .` exit 0.
  - Red when: a lane owns a path another lane writes or imports.
  - Red run: plan time, 2026-11-23: the first draft of this plan exited 1 (lane safety condition 3, wave 9, a lexical hit on a production-switch word in a move description); the wording was fixed and both forms re-run. Revisions 2 and 3 re-ran both forms (results in the hand-off).

- [ ] V13 Caps:
  ```bash
  F=0; for p in "_shared/a1-tools.cjs 790" "_shared/lib/workflow-lint.cjs 445" "_shared/lib/workflow-lint-budget.cjs 200" "_shared/lib/workflow-budget.cjs 220" "_shared/lib/workflow-lint-read.cjs 300" "_shared/lib/machine-retro.cjs 220" "_shared/lib/feature-close.cjs 420" "_shared/lib/retro-gatelog.cjs 130" "_shared/lib/help-lean.cjs 140" "_shared/lib/xprov.cjs 460" "_shared/lib/help-xprov.cjs 620" "_shared/lib/help-xprov-consent.cjs 260" "_shared/lib/help-xprov-topics.cjs 220" "_shared/lib/optin-logs.cjs 80" "_shared/lib/xprov-gate.cjs 740" "_shared/lib/xprov-observe.cjs 210" "_shared/lib/xprov-run.cjs 918" "bin/check-optin-readers.cjs 120"; do set -- $p; if [ ! -e "$1" ] || [ "$(wc -l < "$1")" -gt "$2" ]; then echo "cap: $1"; F=1; fi; done; for f in _shared/lib/checklist.cjs _shared/lib/gate-log.cjs _shared/lib/help.cjs; do git diff --quiet origin/main -- "$f" || { echo "cap: $f edited"; F=1; }; done; echo "rc=$F"
  ```
  - Red when: a file is missing or over its cap, or a frozen lib file changed.
  - Red run: on `c6b10a2` the loop prints `cap: _shared/lib/workflow-lint-budget.cjs` (missing) and the other new files, then `rc=1`; `wc -l` gives facade 787, `workflow-lint.cjs` 443, `xprov-run.cjs` 918.
- [ ] V14 `git diff --quiet origin/main -- .a1/verify.json _test-fixtures/suite-groups.json .github/` exits 0.
  - Red when: a frozen file changed.
  - Red run (s4 V15 method): `git diff --quiet 3a6d00c~1 3a6d00c -- .a1/verify.json _test-fixtures/suite-groups.json` → rc=1.
- [ ] V16 (after Wave 13; run by the orchestrator from the primary checkout, result in the final report, not in `VERIFICATION.md`) `grep -c 'Slice 5 D[0-9]* (proposed reading, pending owner reconcile)' "$A1_VAULT_ROOT/project/a1-specforge/spec/027-lean-pipeline.md"` prints 8 (9 with the fallback), and `grep -c '^## Status (Stand .*Slice 5' "$A1_VAULT_ROOT/project/a1-specforge.md"` prints 1.
  - Red when: a reading or the hub section is missing.
  - Red run: plan time, 2026-11-23: both greps print 0.

Post-merge (reported by a1-progress, not a merge condition):
- SC-006 third clause: `git log -p origin/main -- skills/reading-budget.json` shows no raised entry without a `budget-raise:` trailer since the slice 5 merge.
- SC-009: the first a1-new-feature chain after the merge writes one machine entry; a prose entry exists only if `prose_required` was true.
- SC-007: every keep-list id still has a gate-log record in that run (`plan-review-xprov` is `prompt`-class and has no record on any path, measured: the s4 gate log holds none).

## Out of scope (named, not done)
Each item below that needs later work is recorded as a hub item by Task 13.1 action 3 (durable, read by the owner), not only here.
- s4 follow-up "raw placeholders on the `verify run` lines in 02-execute/05-implement". Converting them changes two fenced call lines and the `check-wave11-callsites.cjs` QUOTED_VAR logic per file. That is a W11/H7a/kritis-inventory cascade outside this slice's FRs. Separate a1-fix (hub item).
- s4 follow-ups "CB4d attribution" and "2b-g wording" (prose nits in PR #112). This plan has no measured text for them, and 2b-g is not touched here. Carry them to the same a1-fix (hub item).
- s4 follow-up "carry placeholder values via a file or env var instead of heredoc" (hub item).
- Moving the kritis blocks of `02-specify.md`, `03-clarify.md` and `04.5-consistency-gate.md` (D1).
- Prose-retro-on-trigger for a1-execute and a1-fix (FR-031 names `feature close`, which serves a1-new-feature). Their retros stay as they are.
- a1-evolve counting `kind: machine` entries in its 5-entry threshold, and the threshold notice that now sits only in `retro-prose.md`: hub item for the next a1-evolve run (Task 13.1).
- The `gate-log.cjs` cap (578 vs a stale 480): untouched here (V13 freezes the file).

## Review and merge (merge dependency)
- `.a1/xprov.json` is `external_review: denied`. No Codex review runs, nobody asks for or waives a permit, and `design-review-xprov` on the ADR answers `not_applicable`. This PR's own plan ran the pre-slice 04b.
- Reinhard via a1-pr-review on the full diff, once per head. Samuel spawned explicitly (Task 12.1, reasons in the PR boundary table).
- Every BLOCKER and MAJOR is fixed before the merge-check. The merge-check runs exactly once per head; nothing is committed after it.
- After the merge (orchestrator): Task 13.1 does the global skill edit and the vault record. Release 1.19.0 is proposed, and is a separate step after slice 5 (not a wave of this plan); `claude plugin update a1-specforge` on Mac and aiserver follows that release. Remove the untracked copy of this phase folder from the primary checkout only after `git diff --quiet origin/main -- .a1/phases/027-lean-pipeline-s5` holds.

## Revision Notes
**Revision 3 (2026-11-23), post-PASS probe-fix round after AUDIT.md round 2 (PASS, 0 BLOCKER, 4 MAJOR, 7 MINOR). No re-audit follows, so every fix names its red run.** Passing tasks are unchanged except where a finding names them. The Depth Pass is unchanged.
- **R2-M1** One source for the vault-sync regex: Task 10.1 action 3 adds `VAULT_SYNC_CALL_RE,` to `workflow-lint.cjs` `module.exports` (443 − 1 + 1 = 443; Task 11.1 + 2 = 445 ≤ 445, stated in both tasks). The Task 11.1 hook passes `{ extractBashFenceLines, VAULT_SYNC_CALL_RE }`. `checkReadingPath` throws `A1_INPUT` when the regex is missing or not a RegExp (RD9, RED-proof 2.1 (h)); the lane cases pass the D11 literal `VSRE_LIT`, and VR1 ties it to the export (RED-proof 10.1 (f), plan-time red rc=1). RED-proof 11.1 (f) is the revision-2 hook form → RP0 red.
- **R2-M2** Task 10.2 action 6 re-runs `workflow budget --write` after its skill edits and before CLI1; D12 and the field-owner row name it; RED-proof 10.2 (j) is the predicted CLI1 red.
- **R2-M3** Consumer repos: D8, D12a and Task 1.1 define `scope: "out"`, exit 0 with or without `--base` (also an empty `--base`), decided before any git call; `--write` out of scope exits 2. BG15a-e, RED-proof 1.1 (g) with the plan-time hazard run (planted repo without `skills/`, `workflow budget --base HEAD~1` → rc=1 today). The 05-merge 5.3 fence is followed by a rationale line naming consumer repos. SC-1, V1 and the readings list carry it.
- **R2-M4** Measured the moved text (routing 5630 bytes, edge-cases 3279, consent 2608, waiver 3348). Routing and edge-cases go into a new lane-xprov data module `help-xprov-topics.cjs` (cap 220, in `owns:` and V13); consent and waiver stay in `help-xprov-consent.cjs`. HT10 caps prose lines at 140 characters and keeps the five command lines byte-identical (measured longest 144, cap 150); the Task 5.1 Done-when names every cap and records the longest values.
- **R2-m1** Task 5.1 rewrites `help-xprov.cjs:324-325` ("in the observation line, and (with A1_KEEP_REVIEW_LOGS=1) in the log entry") and names `recovery` at lines 171/346; HT9 with plan-time red (old 1, new 0).
- **R2-m2** RP0 derives the skill count from `skills/*/SKILL.md`, RP1 lists the four conditional files by path (at least), RP2 is the permanent `< 2378` bound, RP2b the one-time ≤ 2360 STATUS line; SC-1, V1, V3 and Task 10.1 Done-when follow. RED-proof 11.1 (g).
- **R2-m3** D12 and the reading name the slack trade-off and the unbuilt `budget_slack:<skill>` alternative.
- **R2-m4** The reserve-cut path re-runs `--write`, commits, and re-records RP2b/RP3b.
- **R2-m5** Task 13.1 names its context (primary checkout on pulled `main`, no per-wave gate, evidence in the final report; SC-7 post-merge clause, SC-13 and V16 are orchestrator checks). The Mac `claude plugin update` leaves Task 13.1: the 1.19.0 release is a separate step after slice 5 (Task 12.1 item 8, Review and merge).
- **R2-m6** The block-order classifier gets `/prose_required/` → `T` as its first test (pin row, Task 10.2 action 5, RS6, RED-proof 10.2 (k)).
- **R2-m7** The compact `recovery` shape keeps `fallback`; dropped fields are named; the gate maps through the total `compactRecovery` (in `xprov-observe.cjs`, cap 210), so `stepObserve` cannot abort after Codex ran (OL10, OL11, RED-proof 5.2 (h)/(i)).
- V11's planned RED-proof total is 83.

**Revision 2 (2026-11-23), after AUDIT.md (PASS, 0 BLOCKER, 8 MAJOR, 9 MINOR).** Passing tasks are unchanged except where a finding names them. The Depth Pass is kept; only its rewritten brief gains the Wave 13 line.
- **M1** W12 is re-pinned at module level in Task 10.1 (calls `checkReadingPath` directly), so it no longer needs the Task 11.1 hook; RP8 adds the CLI form after the hook. One rule id: `sync_per_wave`. RED-proof 10.1 (b)/(d)/(e) are real W12 red runs (old pin measured at plan time: `removed=0`).
- **M2** Budget scope D12a: the check runs only on roots with `_shared/a1-tools.cjs`, so copy-based cases (VS7 measured at 1122 > 1121) stay green; BG13 guards it; Task 11.1 action 5 runs a1-workflow-lint, a1-gates-lint, run-wave13/14, a1-fix and a1-metrics after the hook. Pin table row added.
- **M3** Task 8.1 action 2(g) rewrites 06-verify.md:329-330 (±0 lines); a1-probe and RR_POS added to its suite run; RED-proof (d) with a plan-time measured red.
- **M4** D11 defines the three anchored call regexes (`VAULT_SYNC_CALL_RE` imported); SP5 copies the real phase-end and closing files; RED-proof 2.1 (f) "substring instead of anchored" with the measured counts.
- **M5** Exempt orchestrator-substituted placeholders named (`<repo>`, `<n>`, `<base>`, `<repo_root>`, `<worktree_path>`); block T defines `RD="$(mktemp)"`; RS2b and RS5 added, RS5 red run at plan time.
- **M6** New Wave 13 / Task 13.1 [ORCHESTRATOR] after the merge writes D1, D2, D4, D6, D8, D9, D12, D14 (and the 11.1 fallback, if triggered) into the spec `## Clarifications` and the hub, records the s4 follow-ups, the a1-evolve note and the Mac copy state as hub items, and names the final report to the owner as the consumer. The brief asked for "Wave 12 (after the merge)"; it is a separate Wave 13, because the Step 4 rule forbids a task that depends on another task of the same wave (it needs the merge of Task 12.1). New SC-13 and V16, red run at plan time (both greps 0).
- **M7** The self-recovery detail goes to the always-written observation line (`recovery` field, validated, no error text); writing `PLAN-REVIEW-LOG.md` on a repair would break FR-032's "a default plan run writes none". The moved edge-cases sentence is rewritten (HT8); OL7/OL9 test the trail with the log off; Samuel brief item 3 covers it.
- **M8** RP3 is `lines <= budget` (permanent); equality is the one-time RP3b evidence line, because a permanent equality case would turn FR-027's "may lower" into "must lower" (D12, listed for reconcile). Task 12.1 action 5 re-runs `workflow budget --write` after review fixes that touch `skills/`.
- **Minors:** m1 one form `base.budget == "absent"`; m2 code_scope paths added; m3 "any lane"; m4 headings outside fences only (D3, RD8, RED-proof 2.1 (g)); m5 D14 in the reconcile list; m6 line-exact `MENTIONS_ALLOWED` (OL8); m7 global skill edit moved after the merge (Task 13.1); m8 help-lean red runs listed (4.1 (e)/(f), 10.2 (h)/(i)); m9 a1-evolve note as a hub item.
- Also: Task 10.2 keeps the `1. Retros, each with` prefix (RR_POS pin, found while checking M3); lane xprov owns `_shared/lib/xprov-observe.cjs`; V13 caps it at 200.

