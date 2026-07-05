---
phase: M6-works-for-rob
goal: Fewer escaped bugs, earlier detection, lower friction — Gate 0.5 content-surfaces, request-scoped briefs, schema-check CLI, cost-tracker v1, add-findings fixture test, M5 validation
spec: docs/roadmap.md (M6 section) + .a1/phases/M6-works-for-rob/RESEARCH.md
waves: 4
status: audited
created: 2026-07-04
---

# Plan: M6 — Works for Rob

## Goal
Harden the a1-specforge pipeline for daily production use: extend Gate 0.5 to content-derived surfaces, promote the request-scoped security pattern into agent briefs, add two deterministic CLI checks (`schema-check`, `cost`), lock the shipped `add-findings --json` behind a committed fixture test, and validate the 4 open M5 (a1-modernize) success criteria.

## Success Criteria
- [ ] SC-1: Gate 0.5 in `a1-new-feature/workflows/05-implement.md` covers 3 content-derived surface types (heading/copy counts, slug/classification constant lists, test fixtures) with the concrete grep rule "grep the new entity name across copy + logic + fixtures"
- [ ] SC-2: `request_scoped_not_module_global` is a hard constraint in the Phase 4 wave-brief workflow (`a1-new-feature/workflows/04-plan.md` wave-brief template) and in the agent briefs `agents/a1-pablo-planner.md` (planner) and `agents/a1-erik-executor.md` (a1-modernize executor)
- [ ] SC-3: `node _shared/a1-tools.cjs schema-check ...` exists, runs the 3 deterministic checks (audit-trigger existence, RLS enabled, FK type match), exits 0 on pass / 1 on fail / 2 on error, and has `_test-fixtures/a1-schema-check/` scenarios with a `run.sh` that exits 0
- [ ] SC-4: `node _shared/a1-tools.cjs cost ...` aggregates token spend per session from `~/.claude/projects/<proj>/*.jsonl` and maps to spec/phase, with a fixture test; the VERIFICATION.md template in `a1-execute/workflows/03-verify.md` contains a cost summary line
- [ ] SC-5: The 4 M5 a1-modernize criteria (per RESEARCH.md: 7-phase pipeline works, 2 modes spec-only/full, 2 new agents Rafael+Theo deployed, 13 CLI subcommands functional) are exercised on a small test project and checked off in the `docs/roadmap.md` history section (M5 row)
- [ ] SC-6: The already-shipped `add-findings --json` code (commit 1499cd8) is locked by a committed fixture test `_test-fixtures/a1-analyze-cli/run-tests.sh` that exits 0 — this satisfies the roadmap M6 criterion "add-findings --json lands with fixture test" literally; the roadmap is NOT edited for this

Out of scope (already shipped or M7): a1-analyze read-only hardening, install.sh fix, all portability work. Note: `add-findings --json` code is shipped; only the missing fixture test is in scope (SC-6, Task 1.4).

Convention: **one commit per task**, conventional commits (`feat`, `docs`, `test`, `chore`).

---

## Wave 1 — Documentation gates + format spike + analyze fixture (parallel, no code deps)

**Suggested agent:** a1-executor (docs tasks are text-only; Task 1.3 is investigative — sonnet is sufficient)

### Task 1.1: Extend Gate 0.5 with content-derived surfaces
**Goal:** Gate 0.5 catches heading counts, classification constant lists, and fixture gaps.
**Actions:**
1. Edit `/Users/rob/code/a1-skills/a1-new-feature/workflows/05-implement.md`, Gate 0.5 section (currently lines 110–136). After the existing 5 surfaces, add 3 new mandatory surfaces:
   - **6. Heading/copy counts:** if the change alters the cardinality of any entity list, grep the old count word/number across `app/ components/ lib/ tests/` (e.g. `grep -rn "Three Products\|three products"`) — every hit must be updated or justified.
   - **7. Slug/classification constant lists:** grep the constant name (e.g. `AI_PRODUCT_SLUGS`) across the whole repo; every definition/duplicate must include the new entry.
   - **8. Test fixtures/mocks:** grep the new entity name across `tests/_fixtures/ tests/mocks/ tests/e2e/`; every fixture enumerating the entity type must include the new instance.
2. Add the umbrella rule verbatim: "**Rule: for each new entity/field/concept, grep its name (and any derived count text) across copy + logic + fixtures — not just DB/API/UI.**"
3. Update the gate's failure instruction: a hit found in only some surfaces = Gate 0.5 FAIL, wave not signed off.
4. Reference the 2026-07-03 recurrence (spec 001-homepage-redesign) as rationale in one line.
5. Commit: `feat(gate-0.5): content-derived surfaces (copy counts, constant lists, fixtures)`
**Done when:** `grep -n "Heading/copy counts\|classification constant\|Test fixtures" a1-new-feature/workflows/05-implement.md` shows all 3 new surface headings inside the Gate 0.5 section; the umbrella grep rule is present.
**Covers:** SC-1

### Task 1.2: Promote request_scoped_not_module_global into briefs
**Goal:** Serverless/Fluid-Compute request-scoping is a hard constraint in planning briefs and executor agent briefs.
**Actions:**
1. Edit `/Users/rob/code/a1-skills/a1-new-feature/workflows/04-plan.md`: after the deployment-chain/HTTP-contract section (~line 140), add subsection **"Request-scoped state (mandatory for serverless/Fluid Compute)"** with the four bullets from RESEARCH.md (per-request instantiation; no `let globalX = null; init(x)` pattern; pass context as parameters/request-scoped containers; check DB connections, auth handlers, config loaders).
2. Edit `/Users/rob/code/a1-skills/agents/a1-pablo-planner.md`: add the same constraint to the backend-wave planning guidance (wave briefs touching serverless backend MUST include the request-scoped check).
3. Edit `/Users/rob/code/a1-skills/agents/a1-erik-executor.md` (the canonical file — do NOT edit through the symlink under `a1-modernize/agents/`; atomic tmp+rename writes would replace the symlink inode; verify first with `ls -la a1-modernize/agents/`): one short mandatory section, link back to 04-plan.md wording.
4. Update `/Users/rob/code/a1-skills/_shared/learnings-index.md`: move `request_scoped_not_module_global` from Monitoring to Applied, noting the target files.
5. Commit: `docs(security): request-scoped-not-module-global hard constraint in wave briefs + agent briefs`
**Done when:** `grep -rln "request-scoped\|request_scoped" a1-new-feature/workflows/04-plan.md agents/a1-pablo-planner.md agents/a1-erik-executor.md _shared/learnings-index.md` returns all four files.
**Covers:** SC-2

### Task 1.3: Cost-tracker spike — JSONL format investigation (data-format risk)
**Goal:** Confirm exactly where token/usage data lives in Claude Code session JSONL and define the extraction contract before implementation. **This task gates Wave 2 Task 2.2** — its output artifact is the implementation contract.
**Actions:**
1. Inspect real logs: `ls -la ~/.claude/projects/-Users-rob-code-a1-skills/*.jsonl` and sample lines, e.g. `head -c 4000 <file>` plus `grep -o '"usage":{[^}]*}' <file> | head -5` and `grep -c '"type":"assistant"' <file>`. Identify: which event types carry `usage` (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens), model field location, timestamp field, sessionId, and whether sub-agent logs in `subagents/` duplicate or extend main-session totals.
2. Determine spec/phase mapping strategy: session timestamps vs git commit timestamps, and/or cwd/sessionId metadata. Pick the simplest v1: aggregate per session, then map sessions to a time window supplied via `--since`/`--until` or per-phase via `.a1/phases/*/` timestamps.
3. Write findings as a design comment block: create `/Users/rob/code/a1-skills/_shared/cost-format-notes.md` documenting the JSONL event schema (**exact field paths** for tokens/model/time — Wave 2 blocks on these), the aggregation contract, and the chosen CLI interface (`a1-tools cost --project <dir> [--since ISO] [--json]`). If the token data turns out NOT to live where RESEARCH.md assumed, document the actual location and flag the deviation prominently at the top of the file.
4. Build a minimal fixture: copy 20–50 anonymized representative JSONL lines (redact content, keep structure/usage fields) into `/Users/rob/code/a1-skills/_test-fixtures/a1-cost/session-sample.jsonl` with known expected totals noted in a sibling `expected.md`.
5. Commit: `chore(cost): JSONL session-log format notes + test fixture`
**Done when:** `_shared/cost-format-notes.md` exists with concrete field paths and CLI contract; `_test-fixtures/a1-cost/session-sample.jsonl` exists and `node -e 'require("fs").readFileSync(".../session-sample.jsonl","utf8").trim().split("\n").forEach(l=>JSON.parse(l))'` exits 0 (every line is valid JSON).
**Covers:** SC-4 (prerequisite)

### Task 1.4: Fixture test for shipped `add-findings --json`
**Goal:** The already-shipped `add-findings --json` code (commit 1499cd8, only ad-hoc tested so far) is covered by a committed regression fixture, closing the roadmap M6 criterion "add-findings --json lands with fixture test".
**Actions:**
1. Create `/Users/rob/code/a1-skills/_test-fixtures/a1-analyze-cli/` following the existing `_test-fixtures/*` pattern. Include minimal input fixtures (a findings JSON file, an intentionally invalid-severity findings file) plus any scaffold the analyze commands need (e.g. a temp analysis target dir created inside the script).
2. Write `run-tests.sh` covering 4 cases with asserted exit codes and output:
   - **File input:** `node _shared/a1-tools.cjs analyze add-findings --json findings.json` → exit 0, all findings appended.
   - **Stdin input:** `cat findings.json | node _shared/a1-tools.cjs analyze add-findings --json -` → exit 0, same result.
   - **Invalid severity:** findings file with a bogus severity → non-zero exit, no partial write (assert target unchanged).
   - **Single add-finding regression:** the pre-existing singular `add-finding` invocation still works → exit 0.
3. Script must be self-cleaning (work in a temp dir, no leftover state) and exit 0 only if all 4 cases pass.
4. Do NOT edit `docs/roadmap.md` for this — the criterion is satisfied literally by this test landing.
5. Commit: `test(analyze): fixture regression suite for add-findings --json (file, stdin, invalid severity, add-finding)`
**Done when:** `bash _test-fixtures/a1-analyze-cli/run-tests.sh` exits 0 and its output shows 4 passing cases.
**Covers:** SC-6

---

## Wave 2 — CLI implementation (strictly sequential: 2.1a → 2.1b → 2.2 — all three edit `_shared/a1-tools.cjs`; no parallel edits to that file)

**Entry condition (hard gate):** Wave 2 must not start Task 2.2 until `_shared/cost-format-notes.md` from Task 1.3 exists and names the **exact JSONL field paths** for token usage. If Task 1.3 finds no usable token data at the assumed locations, Task 2.2 is re-scoped before implementation: fallback = extract cost from the API `usage` fields on `assistant` events (input/output/cache token counts per assistant message), aggregated the same way — update `cost-format-notes.md` with the fallback contract first, then implement against it.

**Suggested agent:** a1-executor (code tasks in a1-tools.cjs; follow existing check/checklist ownership pattern: subcommand owns stdout + exit code)

### Task 2.1a: `schema-check` SQL parser (CREATE/ALTER TABLE, FK extraction, type normalization)
**Goal:** A small, explicitly-bounded SQL parser inside a1-tools.cjs that Task 2.1b's checks consume — the parsing risk isolated and separately testable.
**Actions:**
1. In `/Users/rob/code/a1-skills/_shared/a1-tools.cjs`, add an internal module section (e.g. `// --- schema-check: SQL parsing ---`) with pure functions (no I/O beyond file reads):
   - `parseSqlFiles(dir)` → reads all `.sql` files, splits into semicolon-terminated top-level statements.
   - Extract from `CREATE TABLE`: table name, columns with declared types, PK column(s) (inline `PRIMARY KEY` and table-level `PRIMARY KEY (...)`).
   - Extract FKs from both inline `REFERENCES other(col)` and `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (col) REFERENCES other(col)`.
   - Extract `CREATE TRIGGER <name> ... ON <table>` and `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` (note presence of `FORCE`).
   - Type normalization helper: `serial`→`integer`, `bigserial`→`bigint`, `smallserial`→`smallint`; case-insensitive compare; ignore length/precision suffix differences only if identical base type.
2. **Document the supported SQL subset** in a comment block AND in the eventual `--help` text: top-level semicolon-terminated statements only; no quoted identifiers with embedded semicolons; no `$$` function bodies parsed for triggers beyond the `CREATE TRIGGER ... ON <table>` header; unsupported constructs are skipped, never crash.
3. Unit fixtures for the parser alone: `/Users/rob/code/a1-skills/_test-fixtures/a1-schema-check/parser/` with 2–3 `.sql` files (multiline CREATE TABLE, inline + ALTER FK, serial PK) and a `run-parser.sh` that invokes a hidden debug mode (`schema-check parse --migrations <dir> --json`) and asserts the extracted tables/FKs/triggers against an `expected.json` via `node` compare. Register the `schema-check` command group with the `parse` subcommand in `main()` dispatch (~lines 4933–5050).
4. Commit: `feat(schema-check): bounded SQL parser (tables, FKs, triggers, RLS) + parser fixtures`
**Done when:** `bash _test-fixtures/a1-schema-check/parser/run-parser.sh` exits 0; `node --check _shared/a1-tools.cjs` exits 0.
**Covers:** SC-3 (foundation)

### Task 2.1b: `schema-check run` — the 3 checks + scenario fixtures + pipeline hook (after 2.1a)
**Goal:** Deterministic pre-gate for the deterministic subset of schema_flaw: audit-trigger existence, RLS enabled, FK type match.
**Actions:**
1. Add subcommand `schema-check run` on top of the 2.1a parser (owns stdout, exit code 0=pass, 1=findings, 2=error):
   - `a1-tools schema-check run --migrations <dir> [--tables t1,t2] [--trigger-pattern 'audit|log'] [--json]`
   - **Check A (audit trigger):** for each created table, a `CREATE TRIGGER` matching `--trigger-pattern` (default `audit|log`) must exist on it. Configurable per project (constitution can override — document flag only, no constitution code change in M6).
   - **Check B (RLS):** for each created table, `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` must appear (warn if no `FORCE`).
   - **Check C (FK types):** each FK column's normalized type must equal the referenced PK column's normalized type.
   - Output: per-table PASS/FAIL lines + summary; `--json` emits structured findings.
2. Scenario fixtures: `/Users/rob/code/a1-skills/_test-fixtures/a1-schema-check/` with scenarios `pass/`, `fail-no-audit-trigger/`, `fail-no-rls/`, `fail-fk-type-mismatch/`, `error-no-migrations/`, each containing a `migrations/` dir with minimal `.sql` files, plus a top-level `run.sh` that runs all 5 scenarios, asserts exit codes (0/1/1/1/2), and also invokes the parser fixture from 2.1a.
3. Integrate into the pipeline: in `a1-new-feature/workflows/05-implement.md`, add one line to the pre-wave gate section: for waves with migrations, run `a1-tools schema-check run --migrations <dir>` before wave sign-off; semantic checks (enum completeness, expand→migrate→contract) stay in the 04-plan.md narrative checklist — add a pointer note there.
4. Commit: `feat(schema-check): audit-trigger/RLS/FK-type checks + scenario fixtures + gate hook`
**Done when:** `bash _test-fixtures/a1-schema-check/run.sh` exits 0; `node _shared/a1-tools.cjs schema-check run --migrations _test-fixtures/a1-schema-check/pass/migrations` exits 0 and the `fail-no-rls` scenario exits 1.
**Covers:** SC-3

### Task 2.2: `a1-tools cost` subcommand (cost-tracker v1) — blocked on Wave 2 entry condition
**Goal:** Token spend aggregation from session JSONL logs, per session with time-window filtering for spec/phase mapping.
**Actions:**
1. Pre-check: confirm `_shared/cost-format-notes.md` exists and names exact field paths (Wave 2 entry condition). If it flags the fallback contract (API usage fields on assistant events), implement against that instead.
2. In `/Users/rob/code/a1-skills/_shared/a1-tools.cjs`, add a `cost` command group per the contract in `_shared/cost-format-notes.md`. Minimum: `a1-tools cost run --project <claude-projects-dir> [--since ISO] [--until ISO] [--json]`.
   - Stream-parse each `.jsonl` (line by line, skip malformed lines with a warning counter — never crash on one bad line), extract usage events per the documented field paths, include `subagents/` logs per Task 1.3 finding (avoid double counting).
   - Aggregate: total input / output / cache-read / cache-creation tokens, per model, per session; grand total.
   - Human output: table + one summary line `Cost: <total> tokens (in <input>, out <output>, cache <cache>)`; `--json` for machine use.
3. Fixture test: extend `/Users/rob/code/a1-skills/_test-fixtures/a1-cost/` with `run.sh` that runs `cost run --project _test-fixtures/a1-cost` against `session-sample.jsonl` and asserts the totals match `expected.md` values (exit 0 on match, 1 on mismatch).
4. Commit: `feat(cost): a1-tools cost v1 — token aggregation from session JSONL + fixture`
**Done when:** `bash _test-fixtures/a1-cost/run.sh` exits 0; `node _shared/a1-tools.cjs cost run --project _test-fixtures/a1-cost --json` outputs valid JSON with the expected token totals.
**Covers:** SC-4

---

## Wave 3 — Integration + M5 validation

**Suggested agent:** a1-executor for 3.1; 3.2 is an end-to-end run — orchestrate directly (main session) so gate outputs are observable

### Task 3.1: Cost summary line in the VERIFICATION.md flow
**Goal:** Every verification records feature cost.
**Actions:**
1. Edit `/Users/rob/code/a1-skills/a1-execute/workflows/03-verify.md`: in the VERIFICATION.md template (lines ~1–58), add a `**Cost:**` line after the verdict, with the exact command the verifier runs: `node ~/.claude/skills/_shared/a1-tools.cjs cost run --project ~/.claude/projects/<project-dir> --since <phase-start-ISO>` and the summary-line format `Cost: NNN tokens (in X, out Y, cache Z)`. Instruct: if the cost command fails, write `Cost: unavailable (<reason>)` — never omit the line.
2. Mirror the same instruction in `a1-new-feature/workflows/06-verify.md` (the cost summary template location noted in MAP.md).
3. Commit: `feat(verify): cost summary line in VERIFICATION.md templates`
**Done when:** `grep -n "Cost:" a1-execute/workflows/03-verify.md a1-new-feature/workflows/06-verify.md` shows the template line and the fallback rule in both files.
**Covers:** SC-4

### Task 3.2: M5 validation run — 4 open a1-modernize criteria
**Goal:** Exercise the 4 open M5 success criteria on a small test project and record results. **The authoritative criteria list is RESEARCH.md's decomposition (lines 268–280), used verbatim below.**
**Actions:**
1. Create a small disposable test project (in the scratchpad or `/tmp` worktree, NOT committed): a ~5-file Node/Express toy app with 2 endpoints, one obvious gap (e.g. missing input validation), and one genuinely ambiguous behavior (e.g. an undocumented magic constant) — enough for reverse-spec, an open_question, and one execution wave.
2. **Criterion 1 — 7-phase pipeline works:** run a1-modernize through all 7 phases on the toy project (full mode); each phase produces its expected artifact without error.
3. **Criterion 2 — 2 modes working (spec-only / full):** additionally run phases 1–3 in spec-only mode on a fresh copy; verify a reverse-spec doc is produced and no source files were modified (`git status` clean). Full mode is covered by Criterion 1.
4. **Criterion 3 — 2 new agents integrated (Rafael, Theo):** during the runs verify (a) a1-rafael-reverse-spec emits at least one `open_question` entry for the ambiguous behavior, and (b) a1-theo-test-engineer produces skeleton tests for the wave before implementation. Also include the parity check: `a1-tools modernize snapshot-behavior` before and `verify-parity` after the wave — parity passes.
5. **Criterion 4 — 13 CLI subcommands usable:** smoke-test dispatch of all 13 modernize subcommands (init, next-slot, update-status, discover-stack, add-proposal, approve-proposal, add-wave, snapshot-behavior, start-wave, complete-wave, verify-parity, publish-notion, list): each `node _shared/a1-tools.cjs modernize <sub> --help`-level invocation (or harmless invocation with missing args) must dispatch — i.e. produce usage/expected error, never "unknown command" or a crash. Record the 13-line result table.
6. Record outcome per criterion (pass/fail + one line evidence) in `.a1/phases/M6-works-for-rob/m5-validation.md`.
7. Update `/Users/rob/code/a1-skills/docs/roadmap.md` M5 history row: change "**success criteria still open → validated in M6**" to "success criteria validated 2026-07-NN (7-phase pipeline ✓, 2 modes ✓, Rafael+Theo agents ✓, 13 CLI subcommands ✓)" — adjust marks per actual results; any failure becomes a follow-up bug via a1-fix, not silently checked.
8. Commit: `docs(roadmap): M5 a1-modernize success criteria validated end-to-end`
**Done when:** `.a1/phases/M6-works-for-rob/m5-validation.md` lists the 4 RESEARCH.md criteria with evidence incl. the 13-subcommand table; `grep -n "validated" docs/roadmap.md` shows the updated M5 row.
**Covers:** SC-5

---

## Wave 4 — Quality pass + roadmap checkbox

**Suggested agent:** a1-verifier / a1-executor

### Task 4.1: Full fixture regression + roadmap update
**Goal:** No regression in existing deterministic checks; M6 progress reflected in roadmap.
**Actions:**
1. Run every fixture runner: `for f in _test-fixtures/*/run*.sh; do bash "$f" || echo "FAIL: $f"; done` — all must exit 0 (including the three new suites a1-schema-check, a1-cost, a1-analyze-cli).
2. Smoke the dispatcher: `node _shared/a1-tools.cjs spec list` (or equivalent no-op) still works — no dispatch breakage from the new groups; `node --check _shared/a1-tools.cjs` exits 0.
3. In `docs/roadmap.md` M6 success criteria: check `[x] add-findings --json lands with fixture test` (Task 1.4) and `[x] M5 criteria all checked` (if 3.2 passed). Leave `Gate 0.5 catches a gap on a real run` and `Cost visible for 3 consecutive specs` unchecked — they require real feature runs over time; add a note "(instrumented in M6, validated on next runs)".
4. Write the phase retro to `a1-plan/_learning.md` (M6 is a planning/hardening phase, not an a1-execute feature run) per the standard format (✅/⚠️/💡); mirror to the Vault `pattern/a1-learnings/a1-plan.md` per convention.
5. Commit: `chore(M6): fixture regression pass + roadmap status update`
**Done when:** All `_test-fixtures/*/run*.sh` runners exit 0; `node --check _shared/a1-tools.cjs` exits 0; roadmap M6 section updated.
**Covers:** SC-3, SC-4, SC-5, SC-6 (verification)

---

## Verification (goal-backward)

The goal is "fewer escaped bugs, earlier detection, lower friction." After all waves:

- [ ] **Earlier detection — content surfaces:** Gate 0.5 section of `a1-new-feature/workflows/05-implement.md` lists 8 surfaces incl. copy counts, constant lists, fixtures, plus the umbrella grep rule (SC-1). Check: `grep -n "Heading/copy counts\|classification constant\|Test fixtures" a1-new-feature/workflows/05-implement.md` returns all 3 new surfaces.
- [ ] **Fewer escaped bugs — security:** request-scoped constraint present in `a1-new-feature/workflows/04-plan.md`, `agents/a1-pablo-planner.md`, `agents/a1-erik-executor.md`; learnings-index shows it as Applied (SC-2).
- [ ] **Earlier detection — schema:** `bash _test-fixtures/a1-schema-check/run.sh` exits 0; the 5 scenarios produce exit codes 0/1/1/1/2; parser fixtures pass (SC-3).
- [ ] **Lower friction — cost visibility:** `bash _test-fixtures/a1-cost/run.sh` exits 0; both verify workflow templates contain the `Cost:` line with fallback rule (SC-4).
- [ ] **Regression lock — analyze CLI:** `bash _test-fixtures/a1-analyze-cli/run-tests.sh` exits 0 covering file/stdin/invalid-severity/add-finding; roadmap SC "add-findings --json lands with fixture test" checkable without roadmap edits (SC-6).
- [ ] **M5 closed:** `m5-validation.md` has 4 evidence entries matching RESEARCH.md's criteria plus the 13-subcommand dispatch table; roadmap M5 row updated; roadmap M6 checkbox "M5 criteria all checked" ticked (SC-5).
- [ ] **No regression:** all pre-existing `_test-fixtures/*/run*.sh` still exit 0; `node --check _shared/a1-tools.cjs` passes.
- [ ] **Time-deferred criteria noted:** roadmap M6 carries the note that Gate-0.5-real-run and 3-consecutive-spec cost visibility are validated on upcoming feature builds, not in this phase.

---

## Revision Notes (2026-07-04, per AUDIT.md)

- **B1 resolved:** New Task 1.4 + SC-6 — committed fixture test `_test-fixtures/a1-analyze-cli/run-tests.sh` for the already-shipped `add-findings --json` (file, stdin, invalid severity, single add-finding regression). No roadmap edit; the roadmap criterion is satisfied literally by the test landing. Out-of-scope note updated accordingly.
- **M1 resolved:** Wave 2 header now carries a hard entry condition: `_shared/cost-format-notes.md` must exist with exact JSONL field paths before 2.2 starts; explicit fallback branch defined (cost from API usage fields on assistant events) if 1.3 finds no usable token data. Task 1.3 and 2.2 updated to reference the gate.
- **M2 resolved:** Task 2.1 split into sequential 2.1a (bounded SQL parser with documented supported subset + own parser unit fixtures) and 2.1b (Checks A/B/C + 5 scenario fixtures + run.sh + gate hook).
- **M3 resolved:** SC-2 rewritten to reference actual files: `a1-new-feature/workflows/04-plan.md` wave-brief template, `agents/a1-pablo-planner.md`, `agents/a1-erik-executor.md`. No nonexistent "backend agent brief" paths.
- **M4 resolved:** Task 3.2 now uses RESEARCH.md's four criteria verbatim (7-phase pipeline, 2 modes, 2 agents Rafael+Theo, 13 CLI subcommands) and adds the 13-subcommand `--help`-level dispatch smoke check with a recorded result table. Prior granular checks (open_question, parity, skeleton tests) folded into Criteria 1–3 as evidence.
- **m1 addressed:** Task 1.2 action 3 edits `agents/a1-erik-executor.md` directly with an explicit symlink warning.
- **m2 addressed:** Task 4.1 retro now goes to `a1-plan/_learning.md` (+ Vault mirror), not `a1-execute/_learning.md`.
- **m3 addressed:** SC-1 Done-When and the Verification section use content-specific greps instead of the fragile `grep -c "grep"` proxy.
- Tasks unchanged by the audit (1.1, 1.3 core, 3.1) kept as-is except for the fixes above.
