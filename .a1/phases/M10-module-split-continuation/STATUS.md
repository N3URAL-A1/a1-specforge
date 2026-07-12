# STATUS — M10-module-split-continuation

## Wave 1 — `lib/status-constants.cjs` + `lib/help.cjs` — ✅ COMPLETE

- Commit: `618b029`
- Tasks: 1.1 (status-constants.cjs) + 1.2 (help.cjs) — both done, committed together
  (facade changes for both tasks were too tightly interleaved to split cleanly;
  "one commit per wave" ground rule took precedence over the two-commits suggestion)
- Deviation (minor, logged in observations.jsonl): a1-reconcile fixture suite
  writes live timestamps into checked-in fixture files instead of a mktemp copy
  (CONVENTIONS.md Isolation violation, pre-existing, out of Wave 1 scope) — the
  resulting diff was reverted before commit, suite itself not fixed.
- Full regression gate: ALL-SUITES-GREEN (22 suites, including a1-cmd-injection)
- Facade line count: not yet re-measured post-wave (Wave 1 was a pure relocation,
  facade net-shrinks only modestly — real shrinkage starts Wave 2)

## Wave 2 — `schema-check` group — ✅ COMPLETE

- Commit: `fb2312c`
- Task: 2.1 (extract `schema-check` to `_shared/lib/schema-check.cjs`) — done
- Moved byte-identical: `sqlStripComments`, `sqlSplitStatements`,
  `normalizeSqlType`, `sqlIdent`, `splitTopLevelCommas`, `SQL_COLDEF_STOPWORDS`,
  `parseColumnDef`, `parseCreateTable`, `parseAlterTable`, `parseCreateTrigger`,
  `parseSqlFiles`, `cmdSchemaCheckParse`, `cmdSchemaCheckRun` (153 lines,
  inherited size per plan note, not in F-009/SC-4 scope). Exports only the
  two dispatcher-facing functions (`cmdSchemaCheckParse`, `cmdSchemaCheckRun`);
  internal parser helpers stay module-private (verified no external callers).
- Deviation (minor, logged in observations.jsonl): the mandatory
  `grep -n "^const [A-Z_]* = "` sweep against the MOVE list found a SECOND
  module-level const in range that the plan's Wave 2 text did not name —
  `SQL_TYPE_ALIASES` (consumed only by `normalizeSqlType` via bracket lookup,
  not `.has()`/`.match()`/`.test()`, which is likely why the plan's own
  investigation missed it). Moved it alongside `SQL_COLDEF_STOPWORDS` since
  leaving it in the facade would strand `normalizeSqlType` with a
  `ReferenceError`. No other consumer found outside the moved block.
- Deviation (minor, pre-existing, same as Wave 1): a1-reconcile fixture suite
  writes live timestamps into checked-in fixture files during the regression
  run; diff reverted before staging, suite itself not fixed (out of scope).
- Full regression gate: ALL-SUITES-GREEN (22 suites, including a1-cmd-injection)
- Facade line count: 6728 → 6287 lines (−441)
- New module: `_shared/lib/schema-check.cjs` (452 lines)

## Wave 3 — `cost` group — ✅ COMPLETE

- Commit: `b9d1c31`
- Task: 3.1 (extract `cost` to `_shared/lib/cost.cjs`) — done
- Moved byte-identical: `costEmptyTotals`, `costAddUsage`, `costParseJsonlFile`,
  `cmdCostRun` (187 lines, inherited size per plan note, not in F-009/SC-4
  scope), plus its doc-comment block explaining the JSONL contract
  (message.id de-dup, sub-agent usage merging, malformed-line skip counter).
  Exports only the dispatcher-facing function (`cmdCostRun`); the three
  helpers stay module-private (verified no external callers via grep before
  and after the move).
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range (4400-4660)
  plus a broader `^const |^let |^var ` sweep (4350-4700) as an extra
  cross-check — found NO additional module-level const/RegExp literals in
  range beyond the Wave-2-added `require(...)` line for `schema-check.cjs`
  and the next group's `REALPATH_SIGNATURES` (correctly out of range, stays
  in the facade for Wave 4). No stranding risk this wave, unlike Wave 2's
  `SQL_TYPE_ALIASES` finding.
- Deviation (minor, pre-existing, same as Waves 1-2): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (22 suites, including a1-cmd-injection)
- Facade line count: 6287 → 6095 lines (−192)
- New module: `_shared/lib/cost.cjs` (203 lines)

## Waves 4-17 — not started
