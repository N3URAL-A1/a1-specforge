---
phase: M10-module-split-continuation
goal: Extract all 14 remaining command groups from _shared/a1-tools.cjs into _shared/lib/<group>.cjs behind the proven M9 pattern, fix F-011 (usage/HELP injection coupling) before it multiplies, close F-007 (zero fixture coverage for fix + constitution), and resolve F-009's 5 oversized functions
spec: inline (RESEARCH.md + MAP.md, M10-module-split-continuation)
project: a1-specforge
waves: 17
status: revised
created: 2026-07-12
revised: 2026-07-12
revision_history:
  - "revision 1 (2026-07-12): resolved AUDIT.md round-1 verdict FAIL (3 BLOCKER, 4 MAJOR). B1: Wave 1 now extracts ALL 14 module-level status/mode Set constants (not just the 10 HELP-interpolated ones — MODERNIZE_STATUSES/MODES/PROPOSAL_DECISIONS/WAVE_STATUSES were an additional gap found during revision, same root cause) into lib/status-constants.cjs; Waves 11/12/13/14/16 updated with explicit imports for the constants their command functions validate against via .has(). B2: all `_test-fixtures/<dir>/run.sh` Done-when references corrected to `run-tests.sh` (live repo: 16 of 17 pre-existing suites use run-tests.sh; only a1-cmd-injection genuinely uses run.sh). B3: Wave 7's a1-pr-review run-test.sh typo corrected to run-tests.sh. M1: Wave 1's buildHelp(deps) fallback removed — HELP stays a plain string import now that B1's fix means the constants live in their own shared module regardless. M3: generic STOP-gate rule added to Executor ground rules (not just Wave 11)."
  - "revision 2 (2026-07-12): resolved AUDIT.md round-2 verdict FAIL (1 BLOCKER, B1-NEW). The round-1 fix for B1 only searched for status/mode-named Sets and missed the same failure class recurring at a NARROWER scope: module-level const/RegExp literals sitting adjacent to functions on a single wave's own MOVE list, invisible to the `^function` boundary grep. Round-2 audit found 3 (SQL_COLDEF_STOPWORDS in Wave 2, PACK_ANON_LEVELS+PACK_TARGET_KINDS in Wave 6); a full manual sweep of every remaining module-level const/RegExp against every wave's MOVE list (per the round-2 audit's own recommended methodology) found 5 MORE not caught by round 2's narrower search: PACK_DENY_REGEX (Wave 6, same block as the round-2 pair), REALPATH_MOCK_MARKERS/REALPATH_URL/REALPATH_LOCALHOST (Wave 4), CHECKLIST_REQUIRED_PLAN_FM_FIELDS (Wave 10), INLINE_CODE_RE/FILE_EXT_RE/ENDPOINT_RE/FUNC_CALL_RE (Wave 14), and PR_STATUSES (Wave 7 — correctly excluded from status-constants.cjs per revision 1's own reasoning, since it's same-wave-local, but still needed an explicit MOVE-list mention or it strands). All 8 added to their respective waves' MOVE lists with explanatory notes. A new Executor ground rule now mandates a per-wave `grep -n \"^const [A-Z_]* = \"` sweep against the MOVE list before any wave is considered final, specifically to prevent a fourth occurrence of this failure class."
code_scope:
  - _shared/a1-tools.cjs
  - _shared/lib/
  - _test-fixtures/a1-fix/
  - _test-fixtures/a1-constitution/
---

# Plan: M10 module split continuation

## Goal
Extract the 14 remaining command groups out of the 7196-line `_shared/a1-tools.cjs` facade into `_shared/lib/<group>.cjs` modules, fixing F-011 (usage/HELP injection coupling), F-007 (fix/constitution zero fixture coverage), F-009 (5 oversized functions), and F-006 (facade line-count reduction) along the way — while keeping the CLI contract byte-identical and every fixture suite green after every wave.

## Executor ground rules (apply to EVERY task, identical to M9)

- **CLI contract is frozen.** Group names, subcommand names, flag names, JSON output shapes of EXISTING commands must not change. New requires/exports are the only structural change.
- **Line numbers below were verified against commit-state 2026-07-12, file HEAD 7196 lines.** Every wave shifts subsequent line numbers — always locate by **function name** first (`grep -n "^function <name>" _shared/a1-tools.cjs`), use line numbers only as orientation.
- **Boundary grep only finds functions, not consts (revision-2 lesson).** `grep -n "^function <name>"` locates function boundaries but is BLIND to module-level `const`/`RegExp` literals sitting between or alongside those functions (this exact gap produced two rounds of BLOCKER findings in this plan's own audit history: first the `SPEC_STATUSES`-class constants across waves, then `SQL_COLDEF_STOPWORDS`/`PACK_ANON_LEVELS`/`PACK_TARGET_KINDS`/`PACK_DENY_REGEX` within single waves). Before finalizing ANY wave's "MOVE unchanged" list, additionally run `grep -n "^const [A-Z_]* = " _shared/a1-tools.cjs` restricted to that wave's line range and cross-check every hit against the "MOVE unchanged" list — if a const in range is consumed via `.has(`/`.match(`/`.test(` by a function on the list and isn't itself named on the list, add it. This check is now mandatory per-wave, not just at the two waves it was caught at during planning.
- **Full regression gate after every task that touches `_shared/`:**
  ```bash
  cd /Users/rob/code/a1-skills && node --check _shared/a1-tools.cjs && \
  for f in _shared/lib/*.cjs; do node --check "$f" || { echo "SYNTAX FAIL: $f"; exit 1; }; done && \
  node -e "require('./_shared/a1-tools.cjs')" 2>&1 | grep -v "^$" ; \
  ok=1; for r in _test-fixtures/*/run*.sh; do bash "$r" >/dev/null || { echo "SUITE FAILED: $r"; ok=0; break; }; done; [[ $ok -eq 1 ]] && echo ALL-SUITES-GREEN
  ```
  A task is only done when this prints `ALL-SUITES-GREEN`. Note: `node -e "require(...)"` on the facade will run `main()` (facade calls `main()` unconditionally at file end) — pipe through `2>&1` and expect either the HELP text (no argv) or an error; the point of this line is to catch `ReferenceError` from a forgotten export, not to assert a specific exit code. If this makes the check noisy, prefer the per-module runtime load-proof (`node -e "require('./_shared/lib/<new-module>.cjs')"`) plus a real facade CLI smoke call instead (see each wave's own Done-when block for the concrete form, mirroring M9 Waves 6-9).
- **One commit per wave**, conventional commits (`refactor(a1-tools): extract <group> to lib/<group>.cjs`). A wave's commit is atomic: all functions of the group(s) it covers move + facade require/dispatcher updated + verified, in one commit. Never commit a partial group.
- Never require `a1-tools.cjs` from a lib module (no circular requires). Lib modules may require sibling lib modules (`require('./io.cjs')`, `require('./locks.cjs')`, `require('./worktree-registry.cjs')`, `require('./help.cjs')`, etc.).
- After each wave, confirm no moved function remains in the facade: `grep -c "^function <name>" _shared/a1-tools.cjs` → 0 for every moved name.
- Track the facade's line count every wave (`wc -l _shared/a1-tools.cjs`) as part of that wave's done-when — this is the running SC-4 evidence trail, not just a final check.
- **STOP gate (applies to every wave, not just Wave 11):** if a wave's Done-when block fails and the fix is not a one-line correction to that wave's own new code (e.g. it reveals a wrong assumption about an EARLIER wave's move — a dangling reference, a missing constant import, a stale fixture-name reference), STOP. Do not proceed to the next wave. Fix the earlier wave's gap, re-run its full regression gate until it prints `ALL-SUITES-GREEN`, then resume. A wave is never "close enough" — the one-commit-per-wave discipline only holds if each wave's done-when is trusted absolutely by the next wave.

## Success Criteria (binary)

- [ ] SC-1: `_shared/lib/status-constants.cjs` exists, exports all 14 status/mode `Set` constants; `_shared/lib/help.cjs` exists, exports `{ usage, HELP }` (a plain string, not a `buildHelp(deps)` function — resolved by revision 1, no longer ambiguous); every one of the 14 extracted groups imports `usage` via plain `require('./help.cjs')` and, where its command functions need runtime status validation, the relevant constants via plain `require('./status-constants.cjs')` (Pattern A) — zero new `init()`-injection call sites are added by this phase (F-011 fixed at the root, not multiplied).
- [ ] SC-2: All 14 command groups (`spec`, `fix`, `analyze`, `constitution`, `check`, `checklist`, `worktree`, `pr`, `modernize`, `reconcile`, `schema-check`, `cost`, `realpath-check`, `check-reservations`, `code-scope`) have their command functions + group-local helpers living in `_shared/lib/<group>.cjs` (or the agreed pairing, e.g. `worktree.cjs`+`pr.cjs`), not in the facade. Verified via `grep -c "^function cmd<Group>" _shared/a1-tools.cjs` → 0 for every group.
- [ ] SC-3: `_test-fixtures/a1-fix/run-tests.sh` and `_test-fixtures/a1-constitution/run-tests.sh` exist, follow CONVENTIONS.md's mandatory shape (set -u, pass/fail counters, assert helper, hostile-input cases), and are green — written BEFORE those two groups are extracted (F-007 fixed).
- [ ] SC-4: `runChecklistChecks` is split into parse/compute/format helpers (each demonstrably smaller, no single helper > ~100 lines) as part of the checklist extraction wave, not deferred (F-009 partial fix).
- [ ] SC-5: `main()`'s dispatcher if/else chain is collapsed/trimmed after all 14 groups are extracted — verified by a smaller `main()` function body and no leftover dead per-group inline comments referencing moved code (F-009 partial fix).
- [ ] SC-6: `product.cjs`'s `init()` call drops the `usage` field (now imports `usage` from `lib/help.cjs` directly) and, once `code-scope` extracts, imports `CODE_SCOPE_STAGES` from `lib/code-scope.cjs` instead of via facade injection.
- [ ] SC-7: `_shared/a1-tools.cjs` facade shrinks directionally — target **< 900 lines** after Wave 17, measured against the verified 7196-line baseline (not a hardcoded exact number; checked via real `wc -l` output at Verification time).
- [ ] SC-8: All fixture suites (the pre-existing 20 + the 2 new `a1-fix`/`a1-constitution` suites) are green after every wave, and `_test-fixtures/a1-cmd-injection/` is explicitly re-run (not just as part of the aggregate loop) after the `reconcile` wave to confirm the F-015 safe `execFileSync`-array form survived the move unchanged.

---

## Wave 1 — `lib/status-constants.cjs` + `lib/help.cjs` — the F-011 root fix

`depends_on: []`
**Suggested agent:** a1-walter-web-developer — brief: "pure mechanical move, zero behavior change, no renames, no signature changes, no refactoring beyond the move; this wave's error path AND validation constants touch every group, so verify with the FULL fixture run, not a subset".

**Revision note (resolves AUDIT.md B1 + M1):** the original Wave 1 only considered the 10 status/mode Set constants (`SPEC_STATUSES`, `BUG_STATUSES`, `BUG_SEVERITIES`, `ANALYSIS_STATUSES`, `ANALYSIS_FOCUSES`, `ANALYSIS_SEVERITIES`, `CONSTITUTION_STATUSES`, `RECONCILE_STATUSES`, `RECONCILE_SCOPE_MODES`, `RECONCILE_DRIFT_CLASSES`) in the context of HELP-string interpolation — it missed that these SAME constants are used via `.has(...)` for runtime validation INSIDE command functions that later waves move to `lib/`. Live-verified call sites (2026-07-12): `SPEC_STATUSES.has` at line 372 (`cmdSpecUpdateStatus`, Wave 11), `BUG_STATUSES.has` at 490 (`cmdFixUpdateStatus`, Wave 16), `ANALYSIS_FOCUSES.has`/`ANALYSIS_STATUSES.has`/`ANALYSIS_SEVERITIES.has` at 897/941/1025/1239/1266 (`analyze` group, Wave 12), `CONSTITUTION_STATUSES.has` at 1529 (`constitution`, Wave 16), `RECONCILE_SCOPE_MODES.has`/`RECONCILE_STATUSES.has`/`RECONCILE_DRIFT_CLASSES.has` at 4091/4382/4458 (`reconcile`, Wave 14). **Additional gap found during revision (not in original AUDIT.md, same root cause):** `MODERNIZE_STATUSES.has` at 3597, `MODERNIZE_MODES.has` at 3508, `MODERNIZE_PROPOSAL_DECISIONS.has` at 3746 (all inside `modernize` group, Wave 13) — these 4 constants are NOT interpolated into HELP (verified: `grep -n '\${' <HELP block>` shows only the original 10), but are just as broken if left in the facade once `modernize`'s command functions move to `lib/modernize.cjs`. Also `MODERNIZE_WAVE_STATUSES` is defined alongside them (no live `.has()` call site found outside its own definition, but move it too for consistency — it is part of the same logical constant block and a future caller referencing it from `lib/modernize.cjs` should not have to reach back into the facade).

Fix: this wave now extracts the **entire "valid status sets" block** (all 14 Set constants, lines ~173-269 as of 2026-07-12 HEAD — re-locate by content, not line number, since Wave 1 runs first and lines are still at their original HEAD position) into its own `lib/status-constants.cjs`, alongside `usage`/`HELP` in `lib/help.cjs`. This removes the buildHelp(deps)-vs-move-constants ambiguity entirely (resolves M1): since the constants move into their own shared module regardless of HELP's needs, `HELP` can and does stay a plain string constant that imports them from `status-constants.cjs`, and `buildHelp(deps)` is not needed as a fallback — there is only one way to do this now.

### Task 1.1: Extract status/mode Set constants to `_shared/lib/status-constants.cjs`

**Goal:** All 14 module-level `Set` constants used for status/mode/severity validation live in one shared module that both `lib/help.cjs` (for HELP-string interpolation) and every later wave's group module (for runtime `.has()` validation) can import via a plain `require('./status-constants.cjs')` — zero injection needed anywhere.

**Actions:**
1. Locate the block: `grep -n "^// ---------- valid status sets ----------\|^const MODERNIZE_WAVE_STATUSES" _shared/a1-tools.cjs` (expected: comment header ~171, block ends after `MODERNIZE_WAVE_STATUSES`'s closing `]);` ~269, immediately before the `// ---------- core I/O` comment marking the `io.cjs` require block — re-verify exact end by reading the file, do not assume).
2. Before moving, confirm the full list of `.has(` call sites for EACH constant across the whole file (not just the ones named above): `grep -n "SPEC_STATUSES\.has\|BUG_STATUSES\.has\|BUG_SEVERITIES\.has\|ANALYSIS_STATUSES\.has\|ANALYSIS_FOCUSES\.has\|ANALYSIS_SEVERITIES\.has\|CONSTITUTION_STATUSES\.has\|RECONCILE_STATUSES\.has\|RECONCILE_SCOPE_MODES\.has\|RECONCILE_DRIFT_CLASSES\.has\|MODERNIZE_STATUSES\.has\|MODERNIZE_MODES\.has\|MODERNIZE_PROPOSAL_DECISIONS\.has\|MODERNIZE_WAVE_STATUSES\.has\|PR_STATUSES\.has" _shared/a1-tools.cjs`. Note: `PR_STATUSES` (defined separately at ~3291, inside the `pr` group's own section) is a DIFFERENT constant — it stays local to `lib/pr.cjs` when Wave 7 extracts `pr`, since its only consumer is within the same group extracted in the same wave; do NOT move `PR_STATUSES` into `status-constants.cjs`, it has no cross-wave dependency problem.
3. Create `_shared/lib/status-constants.cjs`:
   ```js
   'use strict';

   const SPEC_STATUSES = new Set([...]);
   const BUG_STATUSES = new Set([...]);
   const BUG_SEVERITIES = new Set([...]);
   const ANALYSIS_STATUSES = new Set([...]);
   const ANALYSIS_FOCUSES = new Set([...]);
   const ANALYSIS_SEVERITIES = new Set([...]);
   const CONSTITUTION_STATUSES = new Set([...]);
   const RECONCILE_STATUSES = new Set([...]);
   const RECONCILE_SCOPE_MODES = new Set([...]);
   const RECONCILE_DRIFT_CLASSES = new Set([...]);
   const MODERNIZE_STATUSES = new Set([...]);
   const MODERNIZE_MODES = new Set([...]);
   const MODERNIZE_PROPOSAL_DECISIONS = new Set([...]);
   const MODERNIZE_WAVE_STATUSES = new Set([...]);

   module.exports = {
     SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
     ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
     CONSTITUTION_STATUSES,
     RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
     MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES,
   };
   ```
   Move all 14 constants **byte-identical** (exact same array contents, exact same Set values — this is a pure relocation, not a re-derivation).
4. In `_shared/a1-tools.cjs`, replace the removed block with a static require near the other Pattern-A imports (~line 289-307, alongside `io.cjs`/`locks.cjs`/`git-safe.cjs`):
   ```js
   const {
     SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
     ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
     CONSTITUTION_STATUSES,
     RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
     MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES,
   } = require(path.join(__dirname, 'lib', 'status-constants.cjs'));
   ```
   The facade still has ALL 14 constants in scope at this point (via the require) — this wave is a pure relocation, no functional change yet. Later waves (11, 12, 13, 14, 16) will each drop their own subset of these facade-level destructured names once their group's command functions move into `lib/<group>.cjs` and import directly from `status-constants.cjs` themselves.
5. Verify: `grep -c "^const SPEC_STATUSES = new Set" _shared/a1-tools.cjs` → 0 (same check pattern for all 14 — spot-check at least 4 different ones, not just the first).

### Task 1.2: Extract `usage()` + `HELP` to `_shared/lib/help.cjs`

**Goal:** Every group's bad-arg error path (`usage(...)`) is servable via a plain `require('./help.cjs')`, with zero `init()`-injection needed for this dependency going forward. `HELP` stays a plain string (no `buildHelp(deps)` needed — resolved by Task 1.1 moving its interpolated constants to a shared module).

**Actions:**
1. Verify current boundaries: `grep -n "^function usage\|^const HELP" _shared/a1-tools.cjs` (expected: `usage` ~5883, 5 lines; `HELP` starting immediately after, ~372-line template string ending with the closing backtick+semicolon just before the next `// ----------` comment — re-verify exact end line by reading the file, do not assume; note line numbers have shifted from Task 1.1's edit, re-locate by content).
2. Create `_shared/lib/help.cjs`:
   ```js
   'use strict';

   const {
     SPEC_STATUSES, BUG_STATUSES, BUG_SEVERITIES,
     ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES,
     CONSTITUTION_STATUSES,
     RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES,
   } = require('./status-constants.cjs');

   function usage(msg) {
     process.stderr.write(`usage error: ${msg}\n`);
     process.stderr.write(`\n${HELP}\n`);
     process.exit(1);
   }

   const HELP = `<verbatim copy of the current HELP template string — its ${[...CONSTITUTION_STATUSES].join(', ')}-style interpolations now resolve against the required-in constants above, byte-identical output>`;

   module.exports = { usage, HELP };
   ```
   Move the `usage` function and `HELP` constant byte-identical. `HELP`'s interpolations (`${[...CONSTITUTION_STATUSES].join(', ')}` etc. — confirm the exact full list via `grep -n '\${' <HELP block>`, expected the same 10 identified in Task 1.1's investigation) now resolve via the `status-constants.cjs` require added at the top of this new file — no ambiguity, no `buildHelp(deps)` fallback.
3. In `_shared/a1-tools.cjs`, replace the removed `usage`/`HELP` block with:
   ```js
   const { usage, HELP } = require(path.join(__dirname, 'lib', 'help.cjs'));
   ```
   placed alongside the other static top-level requires, grouped with the Task 1.1 `status-constants.cjs` require.
4. Update `main()`'s no-argv branch (`if (argv.length === 0 || ...) { process.stdout.write(\`${HELP}\n\`); ... }`) — no code change needed since `HELP` is now imported into the same scope, just confirm it still resolves.
5. Update `product.cjs`'s `init()` call site (`_shared/lib/product.cjs` lines ~32-40 and the facade's dispatcher call at ~7137): drop `usage` from the injected fields. `product.cjs` should instead do `const { usage } = require('./help.cjs');` as a plain top-level require (Pattern A), and its `init(deps)` function keeps only `CODE_SCOPE_STAGES` for now (that field is resolved in Wave 8 when `code-scope` extracts). Update the facade's `product.init({ usage, CODE_SCOPE_STAGES })` call to `product.init({ CODE_SCOPE_STAGES })`.
6. Verify no group's `usage(` calls broke: run a smoke call for at least 3 different groups' bad-arg paths, e.g. `node _shared/a1-tools.cjs spec next-number 2>&1 | grep -q "usage error"`, `node _shared/a1-tools.cjs fix list 2>&1 | head -1`, `node _shared/a1-tools.cjs product status --dir /tmp/nonexistent 2>&1 | head -1` (product path exercises the updated init()).
7. Verify: `grep -c "^function usage" _shared/a1-tools.cjs` → 0; `grep -c "^const HELP" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/status-constants.cjs && node --check _shared/lib/help.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/status-constants.cjs')" && \
node -e "require('./_shared/lib/help.cjs')" && \
node _shared/a1-tools.cjs --help | head -1 | grep -q "a1-tools" && \
node _shared/a1-tools.cjs spec next-number 2>&1 | grep -q "usage error" && \
node _shared/a1-tools.cjs product status --dir /tmp/m10-w1-smoke 2>&1 >/dev/null; \
[[ $(grep -c "^function usage" _shared/a1-tools.cjs) -eq 0 ]] && \
[[ $(grep -c "^const HELP" _shared/a1-tools.cjs) -eq 0 ]] && \
[[ $(grep -c "^const SPEC_STATUSES = new Set" _shared/a1-tools.cjs) -eq 0 ]] && \
[[ $(grep -c "^const MODERNIZE_WAVE_STATUSES = new Set" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit (one commit per task, i.e. two commits, matching the one-commit-per-module rule) before starting Wave 2.**
**Covers:** SC-1, SC-6 (partial — usage field dropped)

---

## Wave 2 — `schema-check` group

`depends_on: [W1]`
**Suggested agent:** a1-walter-web-developer (mechanical-move brief, same as M9 Waves 6-9).

### Task 2.1: Extract `schema-check` to `_shared/lib/schema-check.cjs`

**Goal:** Pure/self-contained SQL parser group lives in its own module; facade unchanged in behavior.

**Actions:**
1. Locate current boundaries: `grep -n "^function sqlStripComments\|^function cmdSchemaCheckRun" _shared/a1-tools.cjs` (expected range ~4567-4989, includes the two section-comment blocks around it).
2. Create `_shared/lib/schema-check.cjs` (`'use strict';` + `const fs = require('fs'); const path = require('path');` — verify no other requires needed by reading the moved code first).
3. MOVE unchanged: `sqlStripComments`, `sqlSplitStatements`, `normalizeSqlType`, `sqlIdent`, `splitTopLevelCommas`, `SQL_COLDEF_STOPWORDS` (module-level `const ... = new Set([...])` sitting between `splitTopLevelCommas` and `parseColumnDef` — it is NOT a `function`, so it will NOT show up in the `^function` boundary grep from Step 1; do not skip it. `parseColumnDef` calls `SQL_COLDEF_STOPWORDS.has(t)` and will throw `ReferenceError` if left behind in the facade), `parseColumnDef`, `parseCreateTable`, `parseAlterTable`, `parseCreateTrigger`, `parseSqlFiles`, `cmdSchemaCheckParse`, `cmdSchemaCheckRun` (**F-009 target: 153 lines** — this is a large function but is pure SQL-parsing logic with no I/O cross-refs per RESEARCH.md; move it as-is in this wave, do not attempt a split here — F-009 splitting is scoped only to `runChecklistChecks` per SC-4, not every oversized function; note in the commit message that `cmdSchemaCheckRun`'s size is inherited, not newly introduced).
4. Verify what `cmdSchemaCheckRun`/`cmdSchemaCheckParse` call for error paths — if they call `usage(...)` or `fail(...)`, add `const { usage } = require('./help.cjs');` and/or `const { fail } = require('./io.cjs');` at the top of `schema-check.cjs`.
5. Export: `module.exports = { cmdSchemaCheckParse, cmdSchemaCheckRun };` (only the two dispatcher-facing functions; internal parser helpers stay module-private unless a fixture or another group calls them directly — verify via `grep -n "sqlStripComments\|parseSqlFiles" _shared/a1-tools.cjs` after the move that no other group references them).
6. In the facade, replace the moved block with `const { cmdSchemaCheckParse, cmdSchemaCheckRun } = require(path.join(__dirname, 'lib', 'schema-check.cjs'));` near the other static requires. Dispatcher branch (`group === 'schema-check'`) calls stay byte-identical (just now calling the imported functions).
7. Verify: `grep -c "^function sqlStripComments" _shared/a1-tools.cjs` → 0; `grep -c "^function cmdSchemaCheckRun" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/schema-check.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/schema-check.cjs')" && \
bash _test-fixtures/a1-schema-check/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdSchemaCheckRun" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 3.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 3 — `cost` group

`depends_on: [W2]`
**Suggested agent:** a1-walter-web-developer.

### Task 3.1: Extract `cost` to `_shared/lib/cost.cjs`

**Goal:** Pure JSONL aggregation group lives in its own module.

**Actions:**
1. Locate: `grep -n "^function costEmptyTotals\|^function cmdCostRun" _shared/a1-tools.cjs` (expected ~4990-5227, including its section-comment doc block explaining the JSONL contract — MOVE that comment block too, it documents non-obvious behavior: message.id de-duplication, sub-agent usage merging).
2. Create `_shared/lib/cost.cjs` (`'use strict';` + `fs`/`path` as needed). MOVE unchanged: `costEmptyTotals`, `costAddUsage`, `costParseJsonlFile`, `cmdCostRun` (**F-009 target: 187 lines** — move as-is, same rationale as schema-check's `cmdSchemaCheckRun`: pure aggregation logic, not in SC-4's scope).
3. Determine error-path deps: check if `cmdCostRun` calls `usage(...)` or `fail(...)` or `process.exit` directly — import accordingly from `help.cjs`/`io.cjs`.
4. Export `{ cmdCostRun }` (verify `costEmptyTotals`/`costAddUsage`/`costParseJsonlFile` aren't called from any other group first via `grep -n "costEmptyTotals\|costAddUsage\|costParseJsonlFile" _shared/a1-tools.cjs`).
5. Facade: replace with `const { cmdCostRun } = require(path.join(__dirname, 'lib', 'cost.cjs'));`. Dispatcher branch unchanged in shape.
6. Verify: `grep -c "^function cmdCostRun" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/cost.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/cost.cjs')" && \
bash _test-fixtures/a1-cost/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdCostRun" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 4.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 4 — `realpath-check` group

`depends_on: [W3]`
**Suggested agent:** a1-walter-web-developer.

### Task 4.1: Extract `realpath-check` to `_shared/lib/realpath-check.cjs`

**Goal:** Self-contained realpath/evidence-scan group lives in its own module. Resolves Q2 from RESEARCH.md (confirmed by MAP.md: `runGit` uses `execSync` with the safe object-args form, not a shell string — not an F-015-class issue, move as-is).

**Actions:**
1. Locate: `grep -n "^function runGit\|^function cmdRealpathCheckRun" _shared/a1-tools.cjs` (expected ~5228-5453).
2. Before moving, confirm `runGit` (local to this group) does NOT collide in name/behavior with `git`/`gitSafe` from `worktree-registry.cjs`/`git-safe.cjs` — read its body once more to reconfirm MAP.md's Q2 finding (`execSync` object-args form, safe). Keep it local to this module under its current name; do not attempt to consolidate with `gitSafe` in this wave — that is a separate concern not in scope.
3. Create `_shared/lib/realpath-check.cjs` (`'use strict';` + `fs`, `path`, `const { execSync } = require('child_process');` — verify exact child_process import shape by reading the current code). MOVE unchanged: `REALPATH_MOCK_MARKERS`, `REALPATH_URL`, `REALPATH_LOCALHOST` (three module-level `RegExp` literal consts, defined immediately before `scanDiffForSurfaces` — NOT functions, will NOT show up in the `^function` boundary grep from Step 1; do not skip them. `scanDiffForSurfaces` uses `REALPATH_URL`/`REALPATH_LOCALHOST`, `cmdRealpathCheckRun` uses `REALPATH_MOCK_MARKERS`, both on this MOVE list), `runGit`, `scanDiffForSurfaces`, `extractEvidenceSections`, `sectionHasCommand`, `cmdRealpathCheckRun`.
4. Determine error-path deps (`usage`/`fail`) and import from `help.cjs`/`io.cjs` as needed.
5. Export `{ cmdRealpathCheckRun }` (verify the 4 helper functions have no external callers via grep before dropping them from exports).
6. Facade: replace with require; dispatcher branch unchanged.
7. Verify: `grep -c "^function cmdRealpathCheckRun" _shared/a1-tools.cjs` → 0; `grep -c "^function runGit" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/realpath-check.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/realpath-check.cjs')" && \
bash _test-fixtures/a1-realpath-check/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdRealpathCheckRun" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 5.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 5 — `phantom` group

`depends_on: [W4]`
**Suggested agent:** a1-walter-web-developer.

### Task 5.1: Extract `phantom` to `_shared/lib/phantom.cjs`

**Goal:** Self-contained phantom-task-detection group lives in its own module.

**Actions:**
1. Locate: `grep -n "^const PHANTOM_STOP_WORDS\|^function parsePhantomTasks\|^function cmdPhantomListTasks" _shared/a1-tools.cjs` (expected ~6278-6534).
2. Create `_shared/lib/phantom.cjs` (`'use strict';` + `fs`, `path`, and whatever `phantomCollectDiff` needs for git-diff collection — verify it uses `gitSafe`/`execFileSync` array form, per RESEARCH.md's flagged verification point; if it calls `gitSafe` from `git-safe.cjs`, import it: `const { gitSafe } = require('./git-safe.cjs');`).
3. MOVE unchanged: `PHANTOM_STOP_WORDS`, `parsePhantomTasks`, `extractPhantomKeywords`, `phantomDefaultSince`, `phantomCollectDiff`, `phantomMatch`, `cmdPhantomCheck`, `cmdPhantomListTasks`.
4. Confirm `phantomCollectDiff`'s git invocation is the safe array form (read the body before moving — if it's a shell-string exec, this is a live finding; fix it to use `gitSafe`/`execFileSync` array args as part of this same wave, same principle as the F-015 fix, and note it in the commit message).
5. Determine error-path deps, import from `help.cjs`/`io.cjs` as needed.
6. Export `{ cmdPhantomCheck, cmdPhantomListTasks }` (verify internal helpers have no external callers).
7. Facade: replace with require; dispatcher branch unchanged.
8. Verify: `grep -c "^function cmdPhantomCheck" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/phantom.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/phantom.cjs')" && \
bash _test-fixtures/a1-phantom/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdPhantomCheck" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 6.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 6 — `pack` group

`depends_on: [W5]`
**Suggested agent:** a1-walter-web-developer.

### Task 6.1: Extract `pack` to `_shared/lib/pack.cjs`

**Goal:** Self-contained pack import/export/validate group lives in its own module; reuses `parseFrontmatter` from `io.cjs`.

**Actions:**
1. Locate: `grep -n "^function parsePackYaml\|^function cmdPackExport" _shared/a1-tools.cjs` (expected ~6558-6975).
2. Create `_shared/lib/pack.cjs` (`'use strict';` + `fs`, `path`, `const { parseFrontmatter } = require('./io.cjs');` since RESEARCH.md confirms this group reuses `io.cjs`'s frontmatter parser).
3. MOVE unchanged: `PACK_ANON_LEVELS` (module-level `const ... = new Set(['A1', 'A2', 'A3'])`, sits immediately before `parsePackYaml` — NOT a `function`, will NOT show up in the `^function` boundary grep from Step 1; do not skip it. Consumed via `.has()` inside manifest-anonymization validation and `cmdPackImport`'s flag validation, both on this MOVE list), `PACK_TARGET_KINDS` (module-level `const ... = new Set([...])`, defined immediately after `PACK_ANON_LEVELS` — same risk, consumed via `.has()` inside pack-target-kind validation), `PACK_DENY_REGEX` (module-level `const ... = /.../i` RegExp literal, defined immediately after `PACK_TARGET_KINDS` — also NOT a function, consumed via `.match(PACK_DENY_REGEX)` inside `cmdPackExport`'s anonymization-leak scan; move it too, it has no other consumer outside this group), `parsePackYaml`, `unquotePackScalar`, `parsePackInlineValue`, `parsePatternFile`, `packValidateDir`, `cmdPackValidate`, `copyDirRecursive`, `rmDirRecursive`, `cmdPackImport`, `parseVaultPatternsTable`, `cmdPackExport`.
4. Determine error-path deps (`usage`/`fail`), import accordingly.
5. Export `{ cmdPackValidate, cmdPackImport, cmdPackExport }` (verify internal helpers' external-caller status via grep first).
6. Facade: replace with require; dispatcher branch (`group === 'pack'`) unchanged in shape.
7. Verify: `grep -c "^function cmdPackExport" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/pack.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/pack.cjs')" && \
bash _test-fixtures/a1-pack/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdPackExport" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 7.**
**Covers:** SC-2, SC-7 (incremental)

**Checkpoint after Wave 6:** All 5 pure/self-contained groups (schema-check, cost, realpath-check, phantom, pack) are extracted. This is a natural stopping point — the facade should have shrunk by roughly 1400-1500 lines from the 7196 baseline. Verify with `wc -l _shared/a1-tools.cjs` before continuing to Wave 7.

---

## Wave 7 — `worktree` + `pr` pair

`depends_on: [W6]`
**Suggested agent:** a1-walter-web-developer — brief: "two files, both consume the existing lib/worktree-registry.cjs, keep them as separate modules with separate fixture-suite mappings".

### Task 7.1: Extract `worktree` to `_shared/lib/worktree.cjs` and `pr` to `_shared/lib/pr.cjs`

**Goal:** Both CLI groups (already depending on `lib/worktree-registry.cjs` for registry/git primitives) get their command functions moved into their own modules, kept as two separate files per RESEARCH.md's recommendation (separate CLI groups, separate fixtures).

**Actions:**
1. Locate worktree range: `grep -n "^function cmdWorktreePrepare\|^function cmdWorktreeReconcile" _shared/a1-tools.cjs` (expected ~2721-3282, includes `cmdWorktreeAdopt`/`cmdWorktreeReconcile` from M9 at ~3115/3216, and a local helper `resolveRealOrAbs` at ~3101 — MOVE it too, it's worktree-group-local).
2. Locate pr range: `grep -n "^function cmdPrListHandoff\|^function cmdPrFindingsSummary\|formatFindingMd\|formatInlineMinorMd" _shared/a1-tools.cjs` (expected starting ~3298 through the end of the pr block before `// ---------- modernize subcommands ----------` at 3441 — confirm exact end boundary by reading the section-comment markers, RESEARCH.md's stated end was 3440).
3. Create `_shared/lib/worktree.cjs` (`'use strict';` + `fs`, `path`, `const wtreg = require('./worktree-registry.cjs');` destructured for `readRegistry, writeRegistryAtomic, git, gitIsRepo, gitWorkingTreeClean, gitBranchExists, gitWorktreeList, gitBranchHasWorktree, findRegistryEntry, findActiveBySlug, repoParentWorktreeDir, nowCompactId, WORKTREE_STATUSES, WORKTREE_EXIT_MODES, SLUG_RE` — verify the exact set actually used by reading each moved function's body, do not over-import). MOVE unchanged: `resolveRealOrAbs`, `cmdWorktreePrepare`, `cmdWorktreeEnter`, `cmdWorktreeStatus`, `cmdWorktreeExit`, `cmdWorktreeList`, `cmdWorktreeGc`, `cmdWorktreeAdopt`, `cmdWorktreeReconcile`.
4. Create `_shared/lib/pr.cjs` (`'use strict';` + `fs`, `path`, `const wtreg = require('./worktree-registry.cjs');` destructured for `prReviewDir, ensurePrReviewDir, readFindings, findEntryBySlugOrId, readRegistry, writeRegistryAtomic` — verify exact set used). MOVE unchanged: `PR_STATUSES` (module-level `const ... = new Set(['handoff', 'in-review', 'reviewed', 'pr-open'])`, defined immediately before `cmdPrListHandoff` — NOT a function, will NOT show up in the `^function` boundary grep from Step 2; do not skip it. This constant is local to the `pr` group and does NOT belong in `status-constants.cjs` — its only consumer extracts in this same wave, see Wave 1's note explaining why it was correctly excluded from the cross-wave fix — but it still must be named explicitly here or it strands in the facade), `cmdPrListHandoff`, `cmdPrMarkStatus`, `cmdPrMarkPrOpen`, `formatFindingMd`, `formatInlineMinorMd`, `cmdPrFindingsSummary`.
5. Both modules: determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs` as needed (Pattern A — plain require, per the Wave 1 fix).
6. Export from `worktree.cjs`: `{ cmdWorktreePrepare, cmdWorktreeEnter, cmdWorktreeStatus, cmdWorktreeExit, cmdWorktreeList, cmdWorktreeGc, cmdWorktreeAdopt, cmdWorktreeReconcile }`. Export from `pr.cjs`: `{ cmdPrListHandoff, cmdPrMarkStatus, cmdPrMarkPrOpen, cmdPrFindingsSummary }` (verify `formatFindingMd`/`formatInlineMinorMd` have no callers outside `pr.cjs` first).
7. Facade: replace both moved blocks with two requires near the other static imports:
   ```js
   const { cmdWorktreePrepare, cmdWorktreeEnter, cmdWorktreeStatus, cmdWorktreeExit, cmdWorktreeList, cmdWorktreeGc, cmdWorktreeAdopt, cmdWorktreeReconcile } = require(path.join(__dirname, 'lib', 'worktree.cjs'));
   const { cmdPrListHandoff, cmdPrMarkStatus, cmdPrMarkPrOpen, cmdPrFindingsSummary } = require(path.join(__dirname, 'lib', 'pr.cjs'));
   ```
   Dispatcher branches (`group === 'worktree'`, `group === 'pr'`) unchanged in shape.
8. Verify: `grep -c "^function cmdWorktreePrepare" _shared/a1-tools.cjs` → 0; `grep -c "^function cmdPrListHandoff" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/worktree.cjs && node --check _shared/lib/pr.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/worktree.cjs')" && node -e "require('./_shared/lib/pr.cjs')" && \
bash _test-fixtures/a1-worktree/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
bash _test-fixtures/a1-pr-review/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdWorktreePrepare" _shared/a1-tools.cjs) -eq 0 ]] && \
[[ $(grep -c "^function cmdPrListHandoff" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 8.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 8 — `check reservations` + `code-scope` pair (incl. `product.cjs` `CODE_SCOPE_STAGES` fix)

`depends_on: [W7]`
**Suggested agent:** a1-walter-web-developer — brief: "same-commit coordination required: this wave also updates lib/product.cjs's init() call site".

### Task 8.1: Extract `check-reservations` to `_shared/lib/check-reservations.cjs` and `code-scope` to `_shared/lib/code-scope.cjs`; retire `product.cjs`'s `CODE_SCOPE_STAGES` injection

**Goal:** Both groups (already depending on `lib/locks.cjs`, sharing `.a1/reservations.json`) get extracted together so the `CODE_SCOPE_STAGES` cross-reference is resolved in one pass — `code-scope.cjs` becomes the canonical owner, `product.cjs` imports it directly instead of via `init()`.

**Actions:**
1. Locate check-reservations range: `grep -n "^function cmdCheckReservations" _shared/a1-tools.cjs` (expected ~5454-5567, a single function — confirm exact end via the next section-comment marker).
2. Locate code-scope range: `grep -n "^function normalizeScopePath\|^const CODE_SCOPE_STAGES\|^function cmdCodeScopeCheck" _shared/a1-tools.cjs` (expected ~5578-5882, includes `CODE_SCOPE_STAGES` const at ~5707).
3. Create `_shared/lib/check-reservations.cjs` (`'use strict';` + `fs`, `path`, `const locks = require('./locks.cjs');` destructured for `acquireReservationsLock, loadReservations, writeJsonAtomic, exitWithLock, failWithLock` — verify exact set from the function body). MOVE unchanged: `cmdCheckReservations`.
4. Create `_shared/lib/code-scope.cjs` (`'use strict';` + `fs`, `path`, `const locks = require('./locks.cjs');` destructured similarly). MOVE unchanged: `normalizeScopePath`, `scopeSegments`, `isGlobSegment`, `segmentsMatchGlob`, `isSegmentPrefix`, `nonGlobPrefix`, `scopePathsOverlap`, `findScopeOverlaps`, `parseScopeList`, `CODE_SCOPE_STAGES`, `cmdCodeScopeClaim`, `cmdCodeScopeStage`, `cmdCodeScopeRelease`, `cmdCodeScopeList`, `cmdCodeScopeCheck`.
5. Both modules: determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs` (Pattern A).
6. Export from `check-reservations.cjs`: `{ cmdCheckReservations }`. Export from `code-scope.cjs`: `{ cmdCodeScopeClaim, cmdCodeScopeStage, cmdCodeScopeRelease, cmdCodeScopeList, cmdCodeScopeCheck, CODE_SCOPE_STAGES }` — `CODE_SCOPE_STAGES` MUST be exported since `product.cjs` needs it (this is the load-bearing precedent RESEARCH.md flagged).
7. **Same-commit `product.cjs` update:** in `_shared/lib/product.cjs`, replace `let CODE_SCOPE_STAGES = null;` and the `init(deps)` function's `CODE_SCOPE_STAGES = deps.CODE_SCOPE_STAGES;` line with a plain top-level `const { CODE_SCOPE_STAGES } = require('./code-scope.cjs');`. Since Wave 1 already dropped `usage` from `init()`'s injected fields, `init()` now has nothing left to inject — **remove the `init` function and the `let`-based stub entirely**, and remove `product.init({ CODE_SCOPE_STAGES })` from the facade's dispatcher product branch (the `const product = require(...)` lazy-require line stays, since `product.cjs` still benefits from lazy-loading, but the `.init(...)` call is deleted). Update `module.exports` in `product.cjs` if it previously exported `init` — it should not need to anymore.
8. Facade: replace both moved blocks with:
   ```js
   const { cmdCheckReservations } = require(path.join(__dirname, 'lib', 'check-reservations.cjs'));
   const { cmdCodeScopeClaim, cmdCodeScopeStage, cmdCodeScopeRelease, cmdCodeScopeList, cmdCodeScopeCheck } = require(path.join(__dirname, 'lib', 'code-scope.cjs'));
   ```
   (facade does NOT need `CODE_SCOPE_STAGES` itself anymore — only `product.cjs` does, and it now imports it directly). Dispatcher branches for `check reservations` and `code-scope` unchanged in shape; the `product` branch loses its `.init(...)` line per step 7.
9. Verify: `grep -c "^function cmdCheckReservations" _shared/a1-tools.cjs` → 0; `grep -c "^function cmdCodeScopeClaim" _shared/a1-tools.cjs` → 0; `grep -c "CODE_SCOPE_STAGES" _shared/a1-tools.cjs` → 0 (facade no longer references it at all).

**Done when:**
```bash
node --check _shared/lib/check-reservations.cjs && node --check _shared/lib/code-scope.cjs && node --check _shared/lib/product.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/check-reservations.cjs')" && node -e "require('./_shared/lib/code-scope.cjs')" && node -e "require('./_shared/lib/product.cjs')" && \
bash _test-fixtures/a1-reservations/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
bash _test-fixtures/a1-code-scope/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
bash _test-fixtures/product-docs/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
bash _test-fixtures/product-adopt/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
node _shared/a1-tools.cjs product stage --dir /tmp/m10-w8-smoke --set started 2>&1 >/dev/null; \
[[ $(grep -c "^function cmdCodeScopeClaim" _shared/a1-tools.cjs) -eq 0 ]] && \
[[ $(grep -c "CODE_SCOPE_STAGES" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
The `product stage --set` smoke call proves `product.cjs`'s new direct `require('./code-scope.cjs')` for `CODE_SCOPE_STAGES` actually resolves at runtime (a broken import here would surface as a `ReferenceError`, not a silent no-op).
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 9.**
**Covers:** SC-2, SC-6, SC-7 (incremental)

---

## Wave 9 — `check` (FR-coverage gate) group

`depends_on: [W8]`
**Suggested agent:** a1-walter-web-developer.

### Task 9.1: Extract `check` to `_shared/lib/check.cjs`

**Goal:** The plan/spec FR-coverage consistency gate lives in its own module. Kept as a separate wave from `checklist` despite the conceptual link (per RESEARCH.md — no cross-calls found, but `checklist` alone is large enough to warrant its own wave with the F-009 split work).

**Actions:**
1. Locate: `grep -n "^function extractSpecFRs\|^function emitCheckReport" _shared/a1-tools.cjs` (expected ~1779-2071).
2. Create `_shared/lib/check.cjs` (`'use strict';` + `fs`, `path`). MOVE unchanged: `extractSpecFRs`, `extractWaveFRs`, `diffFRCoverage`, `buildExpectedPaths`, `formatHumanReport`, `cmdCheckRun`, `emitCheckReport`. Also move the module-local regex consts `FR_PATTERN`/`WAVE_HEADING_PATTERN` if they are scoped to this group specifically — verify via `grep -n "FR_PATTERN\|WAVE_HEADING_PATTERN" _shared/a1-tools.cjs` across the WHOLE file first (RESEARCH.md flagged this as a "verify not global" item); if `checklist`'s functions ALSO reference these same consts, they must instead go into a small shared location both `check.cjs` and `checklist.cjs` can import (e.g. duplicate the two regex literals into both modules if they're truly identical trivial consts, since duplicating a 1-line regex literal is lower-risk than inventing a new shared-helpers module for two lines — decide based on what the grep actually shows).
3. Determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`.
4. Export `{ cmdCheckRun }` (verify internal helpers have no external callers via grep — note `check reservations` shares the `check` CLI verb but is a fully separate command surface per RESEARCH.md's finding #13, already extracted in Wave 8; do not conflate the two).
5. Facade: replace with require; the `main()` dispatcher's `group === 'check'` branch must keep its existing special-case logic that routes `check reservations` to the Wave-8-extracted `cmdCheckReservations` and `check <slug>` to this wave's `cmdCheckRun` — verify this branching logic (currently inside `main()`, locate via `grep -n "'check'" _shared/a1-tools.cjs`) stays intact, just now calling into two different lib modules instead of two facade-local functions.
6. Verify: `grep -c "^function cmdCheckRun" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/check.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/check.cjs')" && \
bash _test-fixtures/a1-check/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
node _shared/a1-tools.cjs check reservations --list --file /tmp/m10-w9-smoke.json >/dev/null && \
[[ $(grep -c "^function cmdCheckRun" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
The `check reservations --list` smoke call proves the `check` dispatcher's slug-vs-reservations special-case still routes correctly after this wave touches the same branch that Wave 8 also touched.
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 10.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 10 — `checklist` group (includes F-009 split of `runChecklistChecks`)

`depends_on: [W9]`
**Suggested agent:** a1-walter-web-developer — brief: "this wave includes a genuine refactor, not just a mechanical move: runChecklistChecks (246 lines) must be split into parse/compute/format helpers as part of this same commit, per SC-4 — read the function fully before splitting, preserve exact behavior".

### Task 10.1: Extract `checklist` to `_shared/lib/checklist.cjs`, splitting `runChecklistChecks`

**Goal:** The largest single group (623 lines) is extracted, and its oversized core function is split into smaller, named helpers with the same combined behavior (F-009 fix, not deferred).

**Actions:**
1. Locate: `grep -n "^function resolveChecklistTarget\|^function cmdChecklistList" _shared/a1-tools.cjs` (expected ~2072-2694).
2. Read `runChecklistChecks` (currently ~2232-2478, 246 lines) end to end BEFORE writing any code. Identify its natural phases (per F-009's own recommendation: parse → compute → format). Concretely: split into (a) a parse/gather helper that reads the plan/spec files and extracts wave blocks/dependencies/FRs into a plain data structure, (b) a compute helper that evaluates each check against that data structure and produces raw pass/fail/reason results, (c) a format helper that shapes the raw results into the report object `cmdChecklistRun` expects. Name them descriptively, e.g. `gatherChecklistInputs`, `evaluateChecklistRules`, `buildChecklistResultSet` — exact names are the executor's call, but each split function should independently be well under 100 lines, and `runChecklistChecks` itself becomes a thin orchestrator calling the three in sequence (or is removed entirely if `cmdChecklistRun` can call the three directly — executor's judgment, whichever keeps the diff smallest and clearest).
3. Create `_shared/lib/checklist.cjs` (`'use strict';` + `fs`, `path`). MOVE (with the Step 2 split applied): `CHECKLIST_REQUIRED_PLAN_FM_FIELDS` (module-level `const [...]` array, defined before `runChecklistChecks` — NOT a function, will NOT show up in the `^function` boundary grep from Step 1; do not skip it. `runChecklistChecks` — and whichever of its Step-2 split-out replacements ends up owning the frontmatter-field check — filters against `CHECKLIST_REQUIRED_PLAN_FM_FIELDS`), `resolveChecklistTarget`, `checklistPaths`, `extractWaveBlocks`, `extractWaveDependencies`, `detectWaveCycles`, the split-out replacement(s) for `runChecklistChecks`, `classifyChecklistResult`, `formatChecklistHumanReport`, `cmdChecklistRun`, `emitChecklistReport`, `cmdChecklistList`.
4. Determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`.
5. Export `{ cmdChecklistRun, cmdChecklistList }` (verify internal helpers have no external callers).
6. Facade: replace with require; dispatcher branch unchanged in shape.
7. **Critical regression check for this wave specifically:** because Step 2 is a genuine behavior-preserving refactor (not a pure move), run the FULL `_test-fixtures/a1-checklist/run-tests.sh` suite (all 8 vault-fixture cases per RESEARCH.md) and manually diff at least one JSON output (e.g. a passing case and a failing case) against a `git stash`-restored pre-wave run to confirm byte-identical output shape, not just exit-code parity.
8. Verify: `grep -c "^function runChecklistChecks" _shared/a1-tools.cjs` → 0; `grep -c "^function cmdChecklistRun" _shared/a1-tools.cjs` → 0. Also confirm the split: `grep -c "^function " _shared/lib/checklist.cjs` should show more named functions than the original single `runChecklistChecks`, and none of them should individually exceed ~100 lines (`awk '/^function/{name=$0; start=NR} /^}/{if(name) print NR-start, name; name=""}' _shared/lib/checklist.cjs | sort -rn | head -5` to spot-check the largest).

**Done when:**
```bash
node --check _shared/lib/checklist.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/checklist.cjs')" && \
bash _test-fixtures/a1-checklist/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function runChecklistChecks" _shared/a1-tools.cjs) -eq 0 ]] && \
[[ $(grep -c "^function cmdChecklistRun" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 11.**
**Covers:** SC-2, SC-4, SC-7 (incremental)

---

## Wave 11 — `spec` group

`depends_on: [W10]`
**Suggested agent:** a1-walter-web-developer.

### Task 11.1: Extract `spec` to `_shared/lib/spec.cjs`

**Goal:** Smallest independent group extracted, resolving Q1 (`appendPhaseHistory` ownership) per MAP.md's confirmed answer: keep it in `spec` since `spec` is its first caller; other groups import it from `lib/spec.cjs` when they need it.

**Actions:**
1. Locate: `grep -n "^function appendPhaseHistory\|^function cmdSpecList" _shared/a1-tools.cjs` (expected ~322-448; `appendPhaseHistory` at 322 sits before the `// ---------- spec subcommands ----------` marker at 331 but MAP.md confirms it belongs with `spec`).
2. **Cross-group caller check (MUST do before moving):** MAP.md's Q1 resolution lists `appendPhaseHistory` callers at approximate lines 389 (spec), 518 (fix), 1039 (analyze), 1539 (constitution), 3607 (worktree — pre-extraction line, now inside `lib/worktree.cjs` post-Wave-7), 3871/3925 (reconcile), 4394 (checklist — pre-extraction line, now inside `lib/checklist.cjs` post-Wave-10). Since `fix`, `analyze`, `constitution`, and `reconcile` are NOT yet extracted at this point in the wave sequence, but `worktree` (Wave 7) and `checklist` (Wave 10) ALREADY ARE — re-run `grep -n "appendPhaseHistory(" _shared/lib/worktree.cjs _shared/lib/checklist.cjs _shared/a1-tools.cjs` right now to get the CURRENT caller list before deciding the export shape.
3. Create `_shared/lib/spec.cjs` (`'use strict';` + `fs`, `path`, `const { SPEC_STATUSES } = require('./status-constants.cjs');` — `cmdSpecUpdateStatus` validates against `SPEC_STATUSES.has(newStatus)`, per Wave 1's revision this constant now lives in `status-constants.cjs`, not the facade). MOVE unchanged: `appendPhaseHistory`, `cmdSpecNextNumber`, `cmdSpecUpdateStatus`, `cmdSpecList`.
4. Export `{ appendPhaseHistory, cmdSpecNextNumber, cmdSpecUpdateStatus, cmdSpecList }` — export `appendPhaseHistory` even though it's spec-internal-by-origin, because Step 2's grep will likely show `lib/worktree.cjs` and/or `lib/checklist.cjs` (already-extracted modules) calling it; those modules should import it from `lib/spec.cjs` (`const { appendPhaseHistory } = require('./spec.cjs');`) rather than duplicating the function body. If the Step 2 grep shows NO cross-module callers at this point (i.e., all real callers are in groups not yet extracted: fix/analyze/constitution/reconcile), still export it — those groups will import it from `lib/spec.cjs` when THEY extract in later waves (11-14 range), which is simpler than each of them getting their own copy.
5. If Step 2's grep shows `lib/worktree.cjs` or `lib/checklist.cjs` already calling `appendPhaseHistory` as a bare identifier (i.e., it was silently still resolving to the facade's now-not-yet-moved function via closure — this should NOT be possible after Wave 1-10's require-based extraction, since each extracted module only has what it explicitly required; if this DOES surface, it means an earlier wave under-scoped its move and left a dangling reference — flag this immediately, do not proceed with Wave 11 until resolved, since it means an earlier wave's "done when" check had a gap).
6. Determine `usage`/`fail` deps for the `cmdSpec*` functions, import from `./help.cjs`/`./io.cjs`.
7. Facade: replace with require; dispatcher branch unchanged in shape.
8. Verify: `grep -c "^function appendPhaseHistory" _shared/a1-tools.cjs` → 0; `grep -c "^function cmdSpecList" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/spec.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/spec.cjs')" && \
node _shared/a1-tools.cjs spec list some-test-project 2>&1 >/dev/null; \
bash _test-fixtures/a1-worktree/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
bash _test-fixtures/a1-checklist/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function appendPhaseHistory" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
The `a1-worktree` and `a1-checklist` re-runs specifically guard against a broken `appendPhaseHistory` cross-import from Step 5's check.
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 12.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 12 — `analyze` group

`depends_on: [W11]`
**Suggested agent:** a1-walter-web-developer.

### Task 12.1: Extract `analyze` to `_shared/lib/analyze.cjs`

**Goal:** Self-contained analyze group (has existing fixture `a1-analyze-cli`) extracted.

**Actions:**
1. Locate: `grep -n "^function cmdAnalyzeNextSlot\|^function cmdAnalyzeList" _shared/a1-tools.cjs` (expected ~888-1354).
2. Check for `appendPhaseHistory` usage (per MAP.md: call at ~1039) — import it from `lib/spec.cjs` (`const { appendPhaseHistory } = require('./spec.cjs');`) rather than duplicating.
3. Create `_shared/lib/analyze.cjs` (`'use strict';` + `fs`, `path`, `const { appendPhaseHistory } = require('./spec.cjs');`, `const { ANALYSIS_STATUSES, ANALYSIS_FOCUSES, ANALYSIS_SEVERITIES } = require('./status-constants.cjs');` — `cmdAnalyzeUpdateStatus`/`cmdAnalyzeInit`/`cmdAnalyzeDiscover`/`cmdAnalyzeAddFinding(s)` validate against these three constants per Wave 1's revision). MOVE unchanged: `cmdAnalyzeNextSlot`, `cmdAnalyzeInit`, `cmdAnalyzeUpdateStatus`, `cmdAnalyzeDiscover`, `cmdAnalyzeAddFinding`, `appendFinding`, `cmdAnalyzeAddFindings`, `cmdAnalyzeList`.
4. Determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`.
5. Export `{ cmdAnalyzeNextSlot, cmdAnalyzeInit, cmdAnalyzeUpdateStatus, cmdAnalyzeDiscover, cmdAnalyzeAddFinding, cmdAnalyzeAddFindings, cmdAnalyzeList }` (verify `appendFinding` has no external callers, keep it module-private if so).
6. Facade: replace with require; dispatcher branch unchanged in shape.
7. Verify: `grep -c "^function cmdAnalyzeList" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/analyze.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/analyze.cjs')" && \
bash _test-fixtures/a1-analyze-cli/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
[[ $(grep -c "^function cmdAnalyzeList" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 13.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 13 — `modernize` group

`depends_on: [W12]`
**Suggested agent:** a1-walter-web-developer.

### Task 13.1: Extract `modernize` to `_shared/lib/modernize.cjs`

**Goal:** Self-contained modernize group (largest of the remaining independent groups, 565 lines, has fixture `a1-modernize-roundtrip`) extracted; re-verify its recently-added HELP text (F-008, already in `lib/help.cjs` since Wave 1) still displays correctly after this move.

**Revision note (found during B1 fix, not in original AUDIT.md — same root cause):** `cmdModernizeInit` validates against `MODERNIZE_MODES.has(mode)` (live at line ~3508), `cmdModernizeUpdateStatus` against `MODERNIZE_STATUSES.has(newStatus)` (~3597), `cmdModernizeApproveProposal` against `MODERNIZE_PROPOSAL_DECISIONS.has(decision)` (~3746). All three constants now live in `lib/status-constants.cjs` per Wave 1 — this group needs an explicit import, same as spec/analyze/reconcile/fix/constitution.

**Actions:**
1. Locate: `grep -n "^function modernizeDir\|^function cmdModernizeList" _shared/a1-tools.cjs` (expected ~3441-4005).
2. Create `_shared/lib/modernize.cjs` (`'use strict';` + `fs`, `path`, `const { MODERNIZE_STATUSES, MODERNIZE_MODES, MODERNIZE_PROPOSAL_DECISIONS, MODERNIZE_WAVE_STATUSES } = require('./status-constants.cjs');` — verify via `grep -n "MODERNIZE_.*\.has(" _shared/a1-tools.cjs` at extraction time which of the 4 this group's functions actually consume; import all 4 if any wave-status validation exists too, since they were moved as one logical block in Wave 1). MOVE unchanged: `modernizeDir`, `cmdModernizeNextSlot`, `cmdModernizeInit`, `cmdModernizeUpdateStatus`, `cmdModernizeDiscoverStack`, `cmdModernizeAddProposal`, `cmdModernizeApproveProposal`, `parityBaselineToMap`, `normalizeJsonEntries`, `cmdModernizeAddWave`, `cmdModernizeSnapshotBehavior`, `cmdModernizeStartWave`, `cmdModernizeCompleteWave`, `cmdModernizeVerifyParity`, `cmdModernizePublishNotion`, `cmdModernizeList`.
3. Determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`. Check for any `appendPhaseHistory` usage — import from `lib/spec.cjs` if present (verify via grep first; RESEARCH.md's caller list did not mention modernize, but re-check).
4. Export the 13 `cmdModernize*` functions (verify `parityBaselineToMap`/`normalizeJsonEntries` have no external callers, keep module-private if so).
5. Facade: replace with require; dispatcher branch unchanged in shape.
6. Run the `modernize --help`-adjacent smoke: confirm the HELP text's modernize section (F-008 addition) still renders — this doesn't change with this move since HELP already lives in `lib/help.cjs` since Wave 1, but verify no stale reference was left in the moved block's own comments.
7. Verify: `grep -c "^function cmdModernizeList" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/modernize.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/modernize.cjs')" && \
bash _test-fixtures/a1-modernize-roundtrip/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
node _shared/a1-tools.cjs --help | grep -qi "modernize" && \
[[ $(grep -c "^function cmdModernizeList" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 14.**
**Covers:** SC-2, SC-7 (incremental)

---

## Wave 14 — `reconcile` group (F-015 security-sensitive — explicit `a1-cmd-injection` re-run required)

`depends_on: [W13]`
**Suggested agent:** a1-walter-web-developer — brief: "this group contains the most recently patched security fix (F-015, gitLastTouchIso). Byte-diff the moved function body against pre-move before committing. The a1-cmd-injection fixture is not optional here — run it explicitly, not just as part of the aggregate loop".

### Task 14.1: Extract `reconcile` to `_shared/lib/reconcile.cjs`

**Goal:** The reconcile group (540 lines, largest fixture `a1-reconcile` at 231 lines + dedicated `a1-cmd-injection` regression fixture) is extracted with zero behavior change to its F-015-patched `gitLastTouchIso`.

**Actions:**
1. Before touching any code: `git show HEAD:_shared/a1-tools.cjs | sed -n '/^function gitLastTouchIso/,/^}/p' > /tmp/m10-w14-pre-move-gitLastTouchIso.txt` — save the exact pre-move body of `gitLastTouchIso` for a post-move byte-diff.
2. Locate: `grep -n "^function reconcileDir\|^function cmdReconcileList" _shared/a1-tools.cjs` (expected ~4006-4545).
3. Create `_shared/lib/reconcile.cjs` (`'use strict';` + `fs`, `path`, `const { gitSafe } = require('./git-safe.cjs');` since `gitLastTouchIso` uses the F-015-fixed `gitSafe`/`execFileSync`-array form per RESEARCH.md; also `const wtreg = require('./worktree-registry.cjs');` if `vaultRoot`/other registry helpers are used — verify exact set by reading the moved code, RESEARCH.md notes this group depends on `worktree-registry.cjs` via `io.cjs`'s already-imported `gitSafe`/`vaultRoot`, confirm the real import chain before writing requires; also `const { RECONCILE_STATUSES, RECONCILE_SCOPE_MODES, RECONCILE_DRIFT_CLASSES } = require('./status-constants.cjs');` — `cmdReconcileInit`/`cmdReconcileUpdateStatus`/`cmdReconcileAddDrift` validate against these three constants per Wave 1's revision, live call sites at `.has(` for `RECONCILE_SCOPE_MODES`/`RECONCILE_STATUSES`/`RECONCILE_DRIFT_CLASSES`). MOVE unchanged: `INLINE_CODE_RE`, `FILE_EXT_RE`, `ENDPOINT_RE`, `FUNC_CALL_RE` (four module-level `RegExp` literal consts, defined immediately before `classifyAnchor` — NOT functions, will NOT show up in the `^function` boundary grep from Step 2; do not skip them. `classifyAnchor` uses `ENDPOINT_RE`/`FUNC_CALL_RE`/`FILE_EXT_RE`, `extractAnchorsFromSpec` uses `INLINE_CODE_RE`, both on this MOVE list — this is the exact same const-strands-in-facade risk class that produced this plan's own BLOCKER findings twice already, do not repeat it a third time here), `reconcileDir`, `cmdReconcileNextSlot`, `listProjectSpecs`, `cmdReconcileInit`, `parseKvEntry`, `classifyAnchor`, `extractAnchorsFromSpec`, `gitLastTouchIso`, `cmdReconcileParseSpec`, `cmdReconcileUpdateStatus`, `cmdReconcileAddDrift`, `cmdReconcileList`. Also check for intra-group calls at the reported reconcile-local `appendPhaseHistory` call sites (~3871/3925 per MAP.md, pre-extraction line numbers — these lines have shifted after Waves 1-13, re-locate by function name) — import `appendPhaseHistory` from `lib/spec.cjs` if confirmed.
4. **Byte-diff check:** after moving, run `git show HEAD:_shared/lib/reconcile.cjs 2>/dev/null; sed -n '/^function gitLastTouchIso/,/^}/p' _shared/lib/reconcile.cjs > /tmp/m10-w14-post-move-gitLastTouchIso.txt && diff /tmp/m10-w14-pre-move-gitLastTouchIso.txt /tmp/m10-w14-post-move-gitLastTouchIso.txt && echo "IDENTICAL"` — this MUST print `IDENTICAL` (the diff should be empty, meaning zero output from `diff` before the echo runs — a non-empty diff means the function body changed during the move, which must not happen).
5. Determine remaining `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`.
6. Export the 11 `cmdReconcile*`-prefixed + helper functions actually called by the dispatcher (verify `reconcileDir`, `listProjectSpecs`, `parseKvEntry`, `classifyAnchor`, `extractAnchorsFromSpec`, `gitLastTouchIso` have no external callers — keep module-private if so, export only the `cmdReconcile*` functions the dispatcher calls).
7. Facade: replace with require; dispatcher branch unchanged in shape.
8. Verify: `grep -c "^function gitLastTouchIso" _shared/a1-tools.cjs` → 0; `grep -c "^function cmdReconcileList" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/reconcile.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/reconcile.cjs')" && \
diff /tmp/m10-w14-pre-move-gitLastTouchIso.txt /tmp/m10-w14-post-move-gitLastTouchIso.txt && echo "gitLastTouchIso-IDENTICAL" && \
bash _test-fixtures/a1-reconcile/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && \
bash _test-fixtures/a1-cmd-injection/run.sh 2>&1 | tail -1 | grep -qE "0 failed|passed" && echo "CMD-INJECTION-SUITE-GREEN" && \
[[ $(grep -c "^function gitLastTouchIso" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
The explicit `a1-cmd-injection` re-run and the byte-diff are both non-negotiable for this wave per RESEARCH.md's flagged risk — do not skip either even if the aggregate regression gate is green.
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 15.**
**Covers:** SC-2, SC-7 (incremental), SC-8

---

## Wave 15 — Write fixtures for `fix` + `constitution` (F-007 fix, BEFORE extraction)

`depends_on: [W14]`
**Suggested agent:** a1-walter-web-developer — brief: "write bash test fixtures against the CURRENT facade-resident code (nothing moves in this wave). These fixtures are the regression net for Wave 16's extraction — they must be green against today's code before Wave 16 touches anything".

### Task 15.1: Write `_test-fixtures/a1-fix/run-tests.sh`

**Goal:** The `fix` command group (439 lines, learning-loop state machine: postmortems, promote-state, integrity-check) gets fixture coverage for the first time, against the CURRENT (pre-extraction) facade code.

**Actions:**
1. Read `_shared/a1-tools.cjs`'s `fix` group functions end to end first (locate via `grep -n "^function cmdFix" _shared/a1-tools.cjs`, expected ~451-887): `cmdFixNextSuffix`, `cmdFixUpdateStatus`, `cmdFixList`, `cmdFixFindDuplicates`, `postmortemsDir`, `agentsLockPath`, `lastPromotePath`, `cmdFixIntegrityCheck`, `cmdFixInitPostmortem`, `cmdFixCountPostmortemsSince`, `cmdFixUpdatePromoteState`, `cmdFixWriteSuggestion` — to know their exact flags, exit codes, and file-write side effects before writing assertions against them.
2. Read `_test-fixtures/a1-checklist/run-tests.sh` (80 lines) and `_test-fixtures/a1-reconcile/run-tests.sh` (231 lines, largest, includes hostile-input cases) as templates, plus `_test-fixtures/CONVENTIONS.md` for the mandatory shape.
3. Create `_shared/../_test-fixtures/a1-fix/run-tests.sh` (bash, `set -u`, `pass=0 fail=0` counters, `assert_rc`-style helper printing `PASS`/`FAIL  <name>`, final two lines `echo "a1-fix: $pass passed, $fail failed"` + `[[ $fail -eq 0 ]]`). All mutable state in `mktemp -d`; copy any fixture input data into the temp workdir first (never write into the checked-in fixture dir).
4. Cover at minimum (per RESEARCH.md's F-007 spec): `next-suffix` (happy-path numbering), `update-status` (valid transition + invalid-status rejection), `find-duplicates` (no dupes / has dupes), `integrity-check` (clean state / corrupted-state detection — read `cmdFixIntegrityCheck`'s body first to know what "corrupted" means for this command), `init-postmortem` (creates the expected file under `postmortemsDir`), `count-postmortems-since` (date-boundary correctness), `update-promote-state` (state transition).
5. Hostile inputs (mandatory per CONVENTIONS.md): path-traversal on any slug/id-shaped flag (`../../etc/passwd`), oversized value on a free-text flag (e.g. suggestion text via `write-suggestion`, ≥10000 chars), injection-shaped string in a value written to a file (`; rm -rf /`, `$(...)`, backticks — assert it's stored inertly as a literal string, never executed/interpreted).
6. Run the new suite against the CURRENT facade code (nothing has moved yet) — it must be green before this wave is done.

**Done when:**
```bash
test -f _test-fixtures/a1-fix/run-tests.sh && bash _test-fixtures/a1-fix/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed" && echo OK
```
**Covers:** SC-3

### Task 15.2: Write `_test-fixtures/a1-constitution/run-tests.sh`

**Goal:** The `constitution` command group (424 lines, version-archive state machine) gets fixture coverage for the first time, against the CURRENT (pre-extraction) facade code. Independent of Task 15.1 (different group, different fixture dir) — runs in parallel within this wave.

**Actions:**
1. Read `_shared/a1-tools.cjs`'s `constitution` group functions end to end first (locate via `grep -n "^function cmdConstitution\|^function constitution" _shared/a1-tools.cjs`, expected ~1355-1778): `constitutionVaultPath`, `constitutionHistoryDir`, `cmdConstitutionInit`, `cmdConstitutionDiscover`, `cmdConstitutionUpdateStatus`, `cmdConstitutionSetBody`, `cmdConstitutionNextVersion`, `cmdConstitutionArchiveCurrent` (calls `cmdConstitutionNextVersion` internally — this intra-group call is a good regression target per RESEARCH.md), `cmdConstitutionWriteMirror`, `cmdConstitutionLinkClaudemd`, `cmdConstitutionList`.
2. Same templates as Task 15.1 (`a1-checklist`, `a1-reconcile`), same CONVENTIONS.md shape (`set -u`, counters, assert helper, final summary).
3. Create `_test-fixtures/a1-constitution/run-tests.sh`. Cover at minimum: `init` (scaffold), `discover`, `update-status`, `set-body`, `next-version` (version-bump arithmetic — pure string/semver-ish logic, worth testing several input variants), `archive-current` (verify it correctly calls `next-version` internally — assert the resulting archived version number matches what a direct `next-version` call would produce), `write-mirror`, `link-claudemd`, `list`.
4. Hostile inputs: path traversal on project-slug-shaped flags, injection-shaped body text via `set-body` (assert stored inertly), oversized body text (≥10000 chars).
5. Run the new suite against the CURRENT facade code — must be green before this wave is done.

**Done when:**
```bash
test -f _test-fixtures/a1-constitution/run-tests.sh && bash _test-fixtures/a1-constitution/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed" && echo OK
```
**Covers:** SC-3

**Wave-level done when:** both Task 15.1 and 15.2 done-when checks pass, plus full regression gate → `ALL-SUITES-GREEN` (the 2 new suites are now part of the aggregate loop automatically via the `_test-fixtures/*/run*.sh` glob). **Commit both fixture files together (or as two commits if preferred, but both must land before Wave 16 starts) before starting Wave 16.**

---

## Wave 16 — Extract `fix` + `constitution` groups (now covered by Wave 15's fixtures)

`depends_on: [W15]`
**Suggested agent:** a1-walter-web-developer — brief: "mechanical move, same as prior waves, but this time you have a regression net from Wave 15 — run it after the move and confirm it's still green".

### Task 16.1: Extract `fix` to `_shared/lib/fix.cjs`

**Goal:** The learning-loop state machine group moves into its own module, now protected by Wave 15's fixture suite. Also resolves the `BUG_STATUSES.has(...)` half of B1 for this group.

**Actions:**
1. Locate: `grep -n "^function cmdFixNextSuffix\|^function cmdFixWriteSuggestion" _shared/a1-tools.cjs` (expected ~451-887).
2. Create `_shared/lib/fix.cjs` (`'use strict';` + `fs`, `path`, `const { BUG_STATUSES, BUG_SEVERITIES } = require('./status-constants.cjs');` — `cmdFixUpdateStatus` validates against `BUG_STATUSES.has(newStatus)`, and bug severity validation elsewhere in this group uses `BUG_SEVERITIES`, per Wave 1's revision). MOVE unchanged: `cmdFixNextSuffix`, `cmdFixUpdateStatus`, `cmdFixList`, `cmdFixFindDuplicates`, `postmortemsDir`, `agentsLockPath`, `lastPromotePath`, `cmdFixIntegrityCheck`, `cmdFixInitPostmortem`, `cmdFixCountPostmortemsSince`, `cmdFixUpdatePromoteState`, `cmdFixWriteSuggestion`. Check for `appendPhaseHistory` usage (per MAP.md: call at ~518, pre-extraction line — re-locate by function name) — import from `lib/spec.cjs` if confirmed.
3. Determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`.
4. Export the `cmdFix*` functions the dispatcher calls (verify `postmortemsDir`/`agentsLockPath`/`lastPromotePath` have no external callers, keep module-private if so).
5. Facade: replace with require; dispatcher branch unchanged in shape.
6. Verify: `grep -c "^function cmdFixNextSuffix" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/fix.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/fix.cjs')" && \
bash _test-fixtures/a1-fix/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed" && \
[[ $(grep -c "^function cmdFixNextSuffix" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
**Covers:** SC-2, SC-3 (validated), SC-7 (incremental)

### Task 16.2: Extract `constitution` to `_shared/lib/constitution.cjs`

**Goal:** The version-archive state machine group moves into its own module, now protected by Wave 15's fixture suite. Also resolves the `CONSTITUTION_STATUSES.has(...)` half of B1 for this group. Independent of Task 16.1 within this wave, but both must complete and be verified before the wave's commit — treat as two sequential sub-tasks of one wave (both touch the facade's dispatcher region) rather than true parallel tasks, to avoid two agents editing the same file region simultaneously; if executed by separate agents, sequence 16.1 then 16.2, not concurrent.

**Actions:**
1. Locate: `grep -n "^function constitutionVaultPath\|^function cmdConstitutionList" _shared/a1-tools.cjs` (expected ~1355-1778 — re-verify exact range since Task 16.1 already shifted line numbers if done first).
2. Create `_shared/lib/constitution.cjs` (`'use strict';` + `fs`, `path`, `const { CONSTITUTION_STATUSES } = require('./status-constants.cjs');` — `cmdConstitutionUpdateStatus` validates against `CONSTITUTION_STATUSES.has(newStatus)`, per Wave 1's revision). MOVE unchanged: `constitutionVaultPath`, `constitutionHistoryDir`, `cmdConstitutionInit`, `cmdConstitutionDiscover`, `cmdConstitutionUpdateStatus`, `cmdConstitutionSetBody`, `cmdConstitutionNextVersion`, `cmdConstitutionArchiveCurrent`, `cmdConstitutionWriteMirror`, `cmdConstitutionLinkClaudemd`, `cmdConstitutionList`. The intra-group call `cmdConstitutionArchiveCurrent` → `cmdConstitutionNextVersion` stays a plain in-module call (no export/import needed for this, both live in the same file).
3. Determine `usage`/`fail` deps, import from `./help.cjs`/`./io.cjs`. Check for `appendPhaseHistory` usage (per MAP.md: call at ~1539, pre-extraction line) — import from `lib/spec.cjs` if confirmed.
4. Export the `cmdConstitution*` functions the dispatcher calls (verify `constitutionVaultPath`/`constitutionHistoryDir` have no external callers, keep module-private if so).
5. Facade: replace with require; dispatcher branch unchanged in shape.
6. Verify: `grep -c "^function cmdConstitutionList" _shared/a1-tools.cjs` → 0.

**Done when:**
```bash
node --check _shared/lib/constitution.cjs && node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/lib/constitution.cjs')" && \
bash _test-fixtures/a1-constitution/run-tests.sh 2>&1 | tail -1 | grep -qE "0 failed" && \
[[ $(grep -c "^function cmdConstitutionList" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
**Covers:** SC-2, SC-3 (validated), SC-7 (incremental)

**Wave-level done when:** both Task 16.1 and 16.2 verified independently, plus full regression gate → `ALL-SUITES-GREEN` (all 22 suites: 20 original + a1-fix + a1-constitution). **Commit (one commit per task, i.e. two commits, matching the one-commit-per-module rule) before starting Wave 17.**

---

## Wave 17 — `main()` dispatcher trim + facade cleanup (final wave)

`depends_on: [W16]`
**Suggested agent:** a1-walter-web-developer — brief: "all 14 groups are now extracted; this wave is pure facade cleanup — collapse the dispatcher, remove dead section comments, do NOT touch any lib/ file".

### Task 17.1: Collapse `main()`'s dispatcher and remove dead facade content

**Goal:** `main()`'s 220-line if/else chain (F-009 target) is trimmed now that every group is a `require()` + thin dispatch, and leftover section-comment scaffolding from the original monolith is removed. This is also where SC-5 and SC-7's final measurement land.

**Actions:**
1. Read the CURRENT `main()` function end to end (`grep -n "^function main" _shared/a1-tools.cjs`) — by this point every branch should be calling into an imported `lib/<group>.cjs` function, none should have inline command logic left.
2. Design decision (make explicit in the commit message, both are acceptable — pick based on what keeps the diff smallest and most readable): **Option A** — collapse the `if (group === 'x') { if (sub === 'y') ... }` nested chain into a dispatch table: `const GROUP_HANDLERS = { spec: { 'next-number': cmdSpecNextNumber, ... }, ... };` with a single generic lookup+call+error-path block replacing all per-group branches. **Option B** — keep the current if/else shape (safest, smallest diff, already well-understood) but remove now-redundant inline comments that reference "lives in lib/X.cjs" (those comments were useful DURING the multi-wave extraction to mark provenance; once every group is extracted, the comment is dead weight — the `require()` at the top of the file already documents the module boundary). **Recommendation: Option B** unless the executor judges the resulting `main()` is still uncomfortably large after comment removal — a working, boring dispatcher is worth more here than a clever collapse, given this is the very last wave and regression risk should trend toward zero, not get re-introduced by a structural rewrite of the one function every prior wave has repeatedly, carefully, incrementally edited.
3. Remove now-orphaned section-comment markers throughout the facade (e.g. `// ---------- spec subcommands ----------`, `// ---------- fix subcommands ----------`, etc.) that no longer have any code beneath them — these are pure navigation aids for code that has moved; leaving them creates a confusing false impression that code still lives there. Do NOT remove markers that still have facade-resident code (there should be none by this point — verify).
4. Confirm the facade's remaining content is: (a) the `require()` block at the top (`io.cjs`, `locks.cjs`, `git-safe.cjs`, `help.cjs`, `worktree-registry.cjs`, and 14 new `lib/<group>.cjs` files), (b) any still-facade-resident shared Sets/consts that `HELP`'s interpolation needs but that Wave 1 decided NOT to move into `help.cjs` (re-check Wave 1's actual decision here — if `HELP` became a function taking these as params, this facade code calls it that way; if the consts moved into `help.cjs`, there should be nothing left here), (c) `main()` itself, (d) the trailing `main();` call.
5. Run `wc -l _shared/a1-tools.cjs` and record the final number — this is the real, checkable SC-7 evidence (directional target: < 900 lines; do not hardcode a specific pass/fail number beyond that threshold in this task, since the exact final count depends on cumulative decisions across all 16 prior waves).

**Done when:**
```bash
node --check _shared/a1-tools.cjs && \
node -e "require('./_shared/a1-tools.cjs')" 2>&1 | grep -qi "a1-tools" && \
node _shared/a1-tools.cjs --help | head -1 | grep -q "a1-tools" && \
FINAL_LINES=$(wc -l < _shared/a1-tools.cjs); echo "Final facade size: $FINAL_LINES lines"; \
[[ $FINAL_LINES -lt 900 ]] && echo "SC-7-TARGET-MET" || echo "SC-7-TARGET-MISSED (facade still $FINAL_LINES lines — flag to a1-victor-verifier for goal-backward review, do not silently pass)"
```
plus full regression gate (ALL 22 suites) → `ALL-SUITES-GREEN`. **Commit.**
**Covers:** SC-5, SC-7 (final)

---

## Verification (goal-backward, after all 17 waves)

Run from `/Users/rob/code/a1-skills`:

- [ ] All suites green + syntax across facade and every lib module:
  ```bash
  node --check _shared/a1-tools.cjs && for f in _shared/lib/*.cjs; do node --check "$f" || echo "FAIL: $f"; done && \
  ok=1; for r in _test-fixtures/*/run*.sh; do bash "$r" >/dev/null || { echo "FAILED: $r"; ok=0; }; done; [[ $ok -eq 1 ]] && echo GREEN
  ```
- [ ] SC-1: `grep -c "usage: deps.usage\|init({ usage\|function buildHelp" _shared/lib/*.cjs _shared/a1-tools.cjs` → 0 anywhere (no new injection call sites added by this phase, HELP stayed a plain string); `grep -rl "require.*help.cjs" _shared/lib/*.cjs | wc -l` → should be close to 14 (every extracted group importing usage/HELP directly); `grep -rl "require.*status-constants.cjs" _shared/lib/*.cjs | wc -l` → should be at least 6 (spec, analyze, modernize, reconcile, fix, constitution each import the status/mode constants they validate against).
- [ ] SC-2: for each of the 14 group names' representative dispatcher-facing command function, `grep -c "^function cmd<Name>" _shared/a1-tools.cjs` → 0.
- [ ] SC-3: `bash _test-fixtures/a1-fix/run-tests.sh` and `bash _test-fixtures/a1-constitution/run-tests.sh` both green; both existed BEFORE the Wave 16 extraction commit (verify via `git log --follow -- _test-fixtures/a1-fix/run-tests.sh` timestamp precedes `git log --follow -- _shared/lib/fix.cjs`).
- [ ] SC-4: `grep -c "^function " _shared/lib/checklist.cjs` shows the split helpers exist; spot-check the largest is < 100 lines.
- [ ] SC-5: `main()`'s line count is meaningfully smaller than the pre-Wave-17 220-line baseline; no dead section-comment markers remain (`grep -c "^// ---------- .* subcommands ----------" _shared/a1-tools.cjs` should be 0 or close to it).
- [ ] SC-6: `grep -c "init(" _shared/lib/product.cjs` → 0 (init function removed); `grep -q "require.*code-scope.cjs" _shared/lib/product.cjs` → present.
- [ ] SC-7: `wc -l < _shared/a1-tools.cjs` < 900 (directional target, verified against real output, not assumed).
- [ ] SC-8: `bash _test-fixtures/a1-cmd-injection/run.sh` explicitly green (not just as part of the aggregate loop); `git log --oneline` shows 17 wave commits (one atomic commit per wave, some waves may be 2 commits per the one-commit-per-module rule — verify count is reasonable, not necessarily exactly 17).
- [ ] CLI facade stable, callable from outside the repo cwd: `cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs check reservations --list --file /tmp/m10-final-smoke.json` exits 0.
- [ ] Sample cross-section of commands from groups extracted across different waves all still work end to end: `node _shared/a1-tools.cjs spec list <slug>`, `node _shared/a1-tools.cjs fix list <slug>`, `node _shared/a1-tools.cjs modernize list <slug>`, `node _shared/a1-tools.cjs product status --dir <path>`, `node _shared/a1-tools.cjs worktree list`, `node _shared/a1-tools.cjs pack validate <dir>` — each should either produce valid output or a clean, expected user-facing error (not a crash/ReferenceError).
</content>
