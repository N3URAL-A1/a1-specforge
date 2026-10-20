## Depth Pass

### 1 What a top professional would do

- Treat `plan depth-check` as a parser over real plan files, not over an idealised template: test CRLF, UTF-8 BOM, `~~~` and backtick fences, duplicated headings, and numbering variants on copies of real plans, and time it on a 1 MB file before it is wired as blocking.
- Prove the single-source claim by code, not by review: the fixture parses both lists out of `_shared/depth-pass.md` and asserts equality with the exported constants, and a repo grep for one distinctive prompt sentence returns exactly one markdown hit.
- Prove every guard by mutation (RED proof): each exit-1 case names one production line, the mutation runs once on a `git archive` snapshot, and the case is observed red.
- Check the wiring as control flow, not as text: in 04-plan the status update must not run when the check exits 1, and every new bash block must pass `workflow lint` (no status test after a pipe).
- Dogfood: this plan carries its own Depth Pass, and its section becomes the real-file "complete" fixture case.
- Watch for merge collisions: specs 017 and 018 are `planned` and edit the same facade, `help.cjs` and registry. If 017 merges first, its registry contract applies to the new row.

### 2 Rawest material

- `_shared/lib/lane-split.cjs` (header, `parseFlags` use, JSON-on-stdout, exit 0/1/2) and its facade branch `_shared/a1-tools.cjs:440-447` (lazy require) — the exact pattern to copy.
- `_shared/lib/io.cjs` `parseFlags` and `_shared/lib/help.cjs:251` (the `lane-split check` usage line, insert point for the new line).
- `_shared/gates-registry.md` real rows `plan-audit` (line 23) and `lane-split` (line 25), plus `_shared/lib/gate-ids.cjs` and `_shared/lib/retro-validate.cjs`, which parse those rows when `retro validate` runs.
- Real runners `_test-fixtures/a1-lane-split/run-tests.sh` and `_test-fixtures/a1-reservations/run-tests.sh`; `_test-fixtures/CONVENTIONS.md` sections "Runner pattern", "Hostile inputs", "RED proof".
- The exact insert points in the real files: `skills/a1-plan/workflows/03-plan.md` prompt template (line 31) and "Lane gate" (line 54); `skills/a1-modernize/workflows/05-plan.md` Step 2 (line 34) and Step 3 (line 57); `skills/a1-new-feature/workflows/04-plan.md` Step 3 (line 189); `agents/a1-pablo-planner.md` Steps 2/3 (lines 49-52), PLAN.md template (line 195), self-check (line 246); `agents/a1-adam-auditor.md` Steps 6/7 (lines 108/116).
- `_shared/lib/workflow-lint.cjs` predicates, `bin/install.sh:64` (symlinks `_shared` as one directory), `.github/workflows/test.yml:45` (CI loop picks up every `run*.sh`).
- This plan file as a real, complete Depth Pass instance.

### 3 Methods and tools

- TDD red-first: fixture cases written before the code, table-driven tokenizer cases, JSON assertions through `node -e`.
- Mutation testing per CONVENTIONS "RED proof" on a `git archive` snapshot (never in the shared worktree).
- Hostile-input cases: `../` traversal, a directory as `--plan`, injection-shaped plan text, a generated 10 000-char and 1 MB plan timed with `time`.
- Doc-to-code equality check that parses the "Self-reference rule" lists.
- `node --check`, `node _shared/a1-tools.cjs workflow lint`, `bash bin/verify-install-sync.sh`, `retro validate` on a sample retro with `gates_fired[].id: depth-pass`, `lane-split check` on this plan, `grep -rl` for the prompt sentence.

### 4 External evidence of correctness

- `bash _test-fixtures/a1-depth-pass/run-tests.sh` exits 0 unmutated, and each exit-1 case turns red under its named mutation.
- The full CI loop `for r in _test-fixtures/*/run*.sh` exits 0 on GNU/Linux CI (catches BSD-only shell).
- `workflow lint` exits 0 and `verify-install-sync.sh` exits 0 (both measured 0 on 2026-10-18 as the baseline).
- `retro validate` accepts `gates_fired[].id: depth-pass` with no drift.
- `plan depth-check` on this plan exits 0; on a copy whose answer 4 reads "Claude and I will check it" it exits 1 with sub-heading 4 named.
- Timing: under 1 s at 10 000 chars, under 2 s at 1 MB.
- `grep -rl` of one distinctive prompt sentence over `*.md` returns exactly one file (`_shared/depth-pass.md`); baseline today is zero hits.

### Rewritten brief

Build a deterministic `plan depth-check` gate that is copied from the real `lane-split` pattern, owns its word lists in one doc that the fixture proves equal to the code, survives hostile and malformed real-world plan files, and is mutation-proven case by case. Wire it into the three planner workflows as a control-flow block (exit 1 stops the pipeline and goes back to the planner), teach Pablo, Vincente and Adam to write and judge the section by reference to `_shared/depth-pass.md` only, register one `depth-pass` row, and accept the work only on suite, lint, install-sync and `retro validate` exit codes.
