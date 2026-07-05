---
plan: .a1/phases/M6-works-for-rob/PLAN.md
verdict: FAIL
blockers: 1
majors: 4
minors: 3
generated: 2026-07-04
---

# Plan Audit — M6 "Works for Rob"

## Verdict: FAIL

One roadmap success criterion (`add-findings --json`) is explicitly excluded from the plan with no justification or deferral note that aligns it with the roadmap. Execution can proceed on the other four success criteria, but PLAN.md either needs to add the task or formally document the exclusion with an explicit roadmap amendment — otherwise the verifier will reject M6 as incomplete against the roadmap's own definition of done.

---

## Findings

### BLOCKERS (must fix before execution)

**[B1]** Roadmap SC `add-findings --json lands with fixture test` is excluded from PLAN.md with no matching roadmap amendment — SC-4 (cost) covers a different roadmap criterion; this one has no owner.

The roadmap `docs/roadmap.md` (lines 31–34) lists four M6 success criteria. PLAN.md maps:
- Roadmap SC1 (Gate 0.5 content surfaces) → PLAN SC-1 ✓
- Roadmap SC2 (`add-findings --json` + retro friction) → **no task — PLAN.md out-of-scope list excludes it**
- Roadmap SC3 (cost visible in VERIFICATION.md) → PLAN SC-4 ✓ (partially — time-deferred)
- Roadmap SC4 (M5 criteria all checked) → PLAN SC-5 ✓

PLAN.md adds two new success criteria (SC-2 for request-scoped, SC-3 for schema-check) that are in roadmap scope but were elevated to checkable SCs. That is fine. The problem is that the `add-findings --json` roadmap SC is silently dropped with no roadmap edit and no follow-up task in M7.

> **Fix (one of two options):**
> Option A — add a small Task 1.4: implement `a1-tools analyze add-findings --json <file|->` (batch JSONL append to analysis file) with a fixture in `_test-fixtures/a1-analyze/`; ~30 LOC, low risk, closes the roadmap criterion.
> Option B — edit `docs/roadmap.md` to move the `add-findings --json` criterion to M7 and add a note in PLAN.md's out-of-scope line referencing that roadmap amendment. The verifier must then confirm the roadmap was updated.

---

### MAJOR (high risk of failure or incorrect verification)

**[M1]** Task 2.2 (`cost` subcommand) has a hard dependency on Task 1.3's JSONL contract findings but the wave structure does not enforce sequential ordering between 1.3 and 2.2 — it calls them "parallel" across waves, which is correct (Wave 1 before Wave 2), yet the JSONL token field path found by 1.3 is the core input assumption for 2.2. If 1.3 reveals the token data is NOT in `hook_success.additionalContext` but in a different event type (or absent entirely), Task 2.2's implementation strategy changes significantly. The plan mentions `_shared/cost-format-notes.md` as the handoff artifact, which is good, but the executor brief for Wave 2 must be blocked on that file existing with concrete field paths — this is not stated as a hard gate.

> **Fix:** Add to Wave 2 header: "Wave 2 must not start until `_shared/cost-format-notes.md` from Task 1.3 exists and contains confirmed field paths. If field paths differ from RESEARCH.md assumptions (`hook_success.content.hookSpecificOutput.additionalContext`), revise Task 2.2 strategy before implementing."

**[M2]** Task 2.1 (`schema-check` SQL parser) hides substantial implementation work in a single task with no size estimate beyond "~200–300 LOC" for both new subcommands combined. The SQL parsing requirements are extensive: `CREATE TABLE` (table name, columns, types, PK), `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`, inline `REFERENCES`, type normalization (`serial`→`integer`, `bigserial`→`bigint`). This is a non-trivial hand-rolled SQL parser inside a `.cjs` file without an external library. Regex-based SQL parsing is fragile for edge cases (multiline statements, quoted identifiers, inline constraints vs `ALTER TABLE`). The task also bundles 5 fixture scenarios. Together this risks being a 2–3× time estimate miss or producing a brittle check that false-positives on real projects.

> **Fix:** Split Task 2.1 into 2.1a (SQL parser + Check C FK-type only — the hardest check) and 2.1b (Check A audit-trigger + Check B RLS + fixtures + pipeline integration). This makes the parsing risk visible and separately estimable. Alternatively, explicitly constrain the SQL parser to a small safe subset (only top-level `CREATE TABLE` with semicolon-terminated blocks, no multiline ALTER before the next semicolon) and document what SQL patterns are out of scope.

**[M3]** Task 1.2 SC-2 verification condition references "a1-new-feature backend agent briefs" but `a1-new-feature/agents/` contains only `rene-link.md` — there is no dedicated backend agent brief. The SC-2 Done-When grep targets `a1-new-feature/workflows/04-plan.md` (the planner workflow, not an agent brief), which is reasonable, but the SC wording "a1-new-feature and a1-modernize backend agent briefs" will cause the verifier to look for agent brief files that don't exist. If the verifier is strict, the SC-2 Done-When check will pass (grep does return 04-plan.md) but the SC text will read as if agent brief files were updated.

> **Fix:** Update SC-2 text to read "the request-scoped constraint is in the Phase 4 wave-brief workflow (`04-plan.md`) for a1-new-feature, and in the agent brief for a1-erik-executor (a1-modernize executor) and a1-pablo-planner." This matches what Task 1.2 actually does and is verifiable.

**[M4]** Task 3.2 M5 validation criteria do not match the 4 criteria listed in RESEARCH.md. RESEARCH.md enumerates: (1) 7-phase pipeline functional, (2) 2 modes working (spec-only / full), (3) 2 new agents integrated (Rafael, Theo), (4) 13 CLI subcommands usable. PLAN.md Task 3.2 maps to: (1) spec-only run, (2) rafael open_question, (3) full run with parity, (4) theo skeleton tests. These are different decompositions of overlapping concepts but are not identical — RESEARCH.md's criterion 4 (13 CLI subcommands) has no corresponding check in Task 3.2, and PLAN.md's "rafael open_question" check is more granular than RESEARCH.md's "2 agents integrated." The roadmap says "4 open a1-modernize success criteria" without listing them, so the PLAN.md decomposition is the authoritative one — but an executor who reads both documents will be confused about which criteria to validate.

> **Fix:** In Task 3.2, explicitly state "The 4 M5 criteria for this validation are defined here (not in RESEARCH.md which uses a different decomposition): (1) spec-only run, (2) rafael open_question, (3) full+parity, (4) theo skeleton tests." Then add a 5th check to Task 3.2 that at minimum smoke-tests `node _shared/a1-tools.cjs modernize list` so that CLI subcommand availability is at least spot-checked.

---

### MINOR (note for executor; does not block)

**[m1]** Task 1.2 action 3 says to edit `a1-modernize/agents/` (the a1-erik-executor). Those files are symlinks to `agents/a1-erik-executor.md`. Editing a symlink in place works in most shells but `writeMdAtomic` (tmp + rename) will break the symlink if it creates a new inode. The executor should edit `agents/a1-erik-executor.md` directly, not the symlink path, or verify that the symlink target is what gets modified. Worth a quick `ls -la a1-modernize/agents/a1-erik-executor-link.md` check before editing.

**[m2]** Task 4.1 Step 4 instructs writing the phase retro to `a1-execute/_learning.md` but this is an M6 phase, not an a1-execute run. The conventional location per the a1-framework is the skill whose learning loop applies. Since M6 is a planning/hardening phase, the retro could reasonably go to `a1-plan/_learning.md` or a dedicated `M6-retro` entry. This is a naming ambiguity that won't block execution but may generate a misplaced retro entry.

**[m3]** The Verification section (bottom of PLAN.md) includes the check "`grep -c "grep" a1-new-feature/workflows/05-implement.md` increased vs pre-M6" as evidence for SC-1. This is a fragile proxy — adding any unrelated grep example to the file would also satisfy it. A better verification check would be `grep -n "Heading/copy counts\|classification constant\|Test fixtures" a1-new-feature/workflows/05-implement.md` which tests for the actual content added by Task 1.1.

---

## What's Good

1. **Wave dependency ordering is correct and well-justified.** Wave 1 (docs + spike) → Wave 2 (CLI implementation) → Wave 3 (integration + M5) → Wave 4 (regression + roadmap) follows a clean dependency chain. The spike (Task 1.3) is correctly placed in Wave 1 before the cost implementation in Wave 2, with `cost-format-notes.md` as an explicit handoff artifact.

2. **Done-when conditions are mostly binary and grep-verifiable.** Tasks 1.1, 2.1, 2.2, and 3.1 all have shell-runnable verification commands (`bash run.sh`, `node --check`, `grep -n`). This gives the verifier concrete, unambiguous pass/fail signals rather than subjective review.

3. **Scope discipline is strong.** The plan correctly defers portability (hardcoded paths), install.sh drift, and a1-analyze read-only hardening to M7 with explicit rationale, preventing scope creep. The "time-deferred criteria noted" check in the Verification section is a mature acknowledgment that some roadmap goals require real feature runs and cannot be validated within a single phase.

---

## Re-Audit (cycle 2) — 2026-07-04

### Per-finding resolution status

**[B1] RESOLVED.** Task 1.4 added (Wave 1, parallel). SC-6 created. The already-shipped `add-findings --json` code is now covered by a committed fixture test `_test-fixtures/a1-analyze-cli/run-tests.sh` with 4 cases (file input, stdin input, invalid severity, add-finding regression). Out-of-scope note explicitly states the code is shipped and only the fixture test is in scope. No roadmap edit is made — the plan correctly notes the criterion is satisfied literally by the test landing. Closes the gap cleanly.

**[M1] RESOLVED.** Wave 2 header now carries a hard entry condition: Task 2.2 must not start until `_shared/cost-format-notes.md` exists with exact JSONL field paths. An explicit fallback branch is defined (extract cost from API `usage` fields on `assistant` events) if Task 1.3 finds no usable token data at assumed locations. Task 2.2 action 1 re-states the pre-check requirement. The gate is hard and the fallback is concrete.

**[M2] RESOLVED.** Task 2.1 is split into 2.1a (bounded SQL parser, parser unit fixtures, `parse` subcommand with debug mode) and 2.1b (Checks A/B/C, 5 scenario fixtures, `run.sh`, gate hook). The supported SQL subset is documented in a comment block and in `--help` text. Wave 2 header explicitly states "2.1a → 2.1b sequential." The parser risk is isolated and separately testable.

**[M3] RESOLVED.** SC-2 now names the three actual files: `a1-new-feature/workflows/04-plan.md`, `agents/a1-pablo-planner.md`, `agents/a1-erik-executor.md`. The Done-When grep targets all four files (adding `_shared/learnings-index.md`). No reference to nonexistent backend agent brief files.

**[M4] RESOLVED.** Task 3.2 explicitly states "The authoritative criteria list is RESEARCH.md's decomposition (lines 268–280), used verbatim below" and maps to RESEARCH.md's 4 criteria exactly: 7-phase pipeline, 2 modes, 2 agents (Rafael+Theo), 13 CLI subcommands. The 13-subcommand check is a `--help`-level dispatch smoke test with a recorded result table. Prior granular checks (open_question, parity, skeleton tests) are folded into Criteria 1–3 as evidence.

**[m1] RESOLVED.** Task 1.2 action 3 explicitly instructs editing `agents/a1-erik-executor.md` directly, warns about atomic tmp+rename breaking the symlink inode, and requires a pre-edit `ls -la` check.

**[m2] RESOLVED.** Task 4.1 Step 4 now targets `a1-plan/_learning.md` with a Vault mirror to `pattern/a1-learnings/a1-plan.md`.

**[m3] RESOLVED.** The Verification section now uses content-specific greps: `grep -n "Heading/copy counts\|classification constant\|Test fixtures" a1-new-feature/workflows/05-implement.md` for SC-1, and the Done-When condition in Task 1.1 uses the same pattern.

---

### New gaps introduced by the revision

**[NEW-M1] MAJOR — Tasks 2.1b and 2.2 both write to `_shared/a1-tools.cjs` and are stated as parallel.**

The Wave 2 header says "2.1a → 2.1b sequential; 2.2 parallel to both." Tasks 2.1b and 2.2 both modify `_shared/a1-tools.cjs` — 2.1b adds `schema-check run` and 2.2 adds the `cost` command group. If two agents execute these concurrently (which the "parallel" label invites), they will produce conflicting edits to the same file and one agent's work will clobber the other's, or both will fail to merge. The plan does not warn against this or mandate sequential execution within Wave 2.

> Fix: Change the Wave 2 header to "2.1a → 2.1b → 2.2 sequential (all three write to a1-tools.cjs)" OR explicitly state that 2.1b and 2.2 must be executed by the same agent in sequence (not concurrently). The "parallel" label must be removed or scoped only to tasks that do not share a write target.

**[NEW-m1] MINOR — Task 1.4 fixture scope assumes the pre-existing `add-finding` (singular) CLI signature without verifying it first.**

Task 1.4 case 4 ("Single add-finding regression") requires knowing the exact invocation signature of the already-shipped `add-finding` command. The plan does not include a step to inspect the current `a1-tools.cjs` dispatch table before writing the fixture. If the executor is unfamiliar with the existing command, they may write the wrong invocation. Low risk given the commit reference (1499cd8) is cited, but a one-line "inspect the existing dispatch entry first" instruction would make this safe.

---

### Final verdict

**PASS_WITH_WARNINGS**

All 7 original findings (B1, M1-M4, m1-m3) are resolved cleanly. One new MAJOR gap was introduced by the 2.1a/2.1b split: Tasks 2.1b and 2.2 are labeled parallel but both write to the same file (`a1-tools.cjs`). This will cause a clobber conflict if two agents run concurrently. This must be fixed before execution — change the Wave 2 parallelism label to sequential for 2.1b and 2.2, or restrict to a single agent. The fix is a one-line wording change in the Wave 2 header and does not require a third audit cycle; the planner can patch it inline before handing to the executor.
