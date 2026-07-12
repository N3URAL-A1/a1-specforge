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

## Wave 4 — `realpath-check` group — ✅ COMPLETE

- Commit: `5d33155`
- Task: 4.1 (extract `realpath-check` to `_shared/lib/realpath-check.cjs`) — done
- Moved byte-identical: `REALPATH_SIGNATURES`, `REALPATH_MOCK_MARKERS`,
  `REALPATH_DEFAULT_REAL_MARKERS`, `REALPATH_URL`, `REALPATH_LOCALHOST` (all
  5 module-level const/RegExp literals immediately before `runGit`), `runGit`,
  `scanDiffForSurfaces`, `extractEvidenceSections`, `sectionHasCommand`,
  `cmdRealpathCheckRun`, plus the doc-comment block explaining the Gate 0.7
  contract (surface-signature scan, evidence-section requirements, known
  limits). Exports only the dispatcher-facing function (`cmdRealpathCheckRun`);
  the 4 helpers + 5 constants stay module-private (verified no external
  callers via grep before and after the move).
- Q2 re-verified live (per RESEARCH.md/plan Step 2): `runGit` uses
  `spawnSync('git', args, { cwd, encoding: 'utf8' })` — the safe array-args
  form, NOT a shell string. Not an F-015-class issue; moved as-is, no fix
  needed. No name/behavior collision with `worktree-registry.cjs`'s
  `git`/`gitSafe` (kept local under its current name per plan Step 2 — no
  consolidation attempted, out of scope).
- `REALPATH_SIGNATURES` (flagged by Wave 3's agent as needing re-location and
  a "does it belong here" check, per plan revision note): confirmed its only
  consumer is `scanDiffForSurfaces` (via `.sql`/`.rls`/`.http` property
  access), which is itself on this wave's MOVE list — moved into this module,
  not stranded in the facade.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range
  (4400-4735) — found **`REALPATH_DEFAULT_REAL_MARKERS`**, a fifth
  module-level const the plan's Wave 4 MOVE-list text never named (plan only
  named `REALPATH_MOCK_MARKERS`/`REALPATH_URL`/`REALPATH_LOCALHOST` plus
  flagged `REALPATH_SIGNATURES` for re-verification — `REALPATH_DEFAULT_REAL_MARKERS`
  wasn't mentioned anywhere). It's consumed directly (not via `.has()`/
  `.match()`/`.test()`, which is likely why static analysis missed it) inside
  `cmdRealpathCheckRun`'s `new RegExp(flags['real-markers'] || REALPATH_DEFAULT_REAL_MARKERS, 'i')`
  line. Moved it alongside the other 4 — leaving it in the facade would have
  caused a `ReferenceError` on the very first `realpath-check run` invocation
  with no `--real-markers` flag. Logged in observations.jsonl (pattern:
  `missing_wiring`).
- Deviation (minor, pre-existing, same as Waves 1-3): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (22 suites, including
  a1-realpath-check: 5 passed, 0 failed, and a1-cmd-injection)
- Facade line count: 6095 → 5831 lines (−264)
- New module: `_shared/lib/realpath-check.cjs` (274 lines)

## Waves 5-17 — not started
