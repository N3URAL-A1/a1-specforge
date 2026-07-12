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

## Wave 5 — `phantom` group — ✅ COMPLETE

- Commit: `4b94c7f`
- Task: 5.1 (extract `phantom` to `_shared/lib/phantom.cjs`) — done
- Moved byte-identical: `PHANTOM_STOP_WORDS`, `parsePhantomTasks`,
  `extractPhantomKeywords`, `phantomDefaultSince`, `phantomCollectDiff`,
  `phantomMatch`, `cmdPhantomCheck`, `cmdPhantomListTasks`, plus the
  doc-comment block explaining the phantom-detection contract. Exports
  only the two dispatcher-facing functions (`cmdPhantomCheck`,
  `cmdPhantomListTasks`); the 6 internal helpers + 1 constant stay
  module-private (verified no external callers via grep before and
  after the move).
- Git-safety check (per plan Step 4): `phantomCollectDiff` and
  `phantomDefaultSince` both invoke git exclusively through the shared
  `gitSafe()` helper (`_shared/lib/git-safe.cjs`), which uses
  `execFileSync('git', ['-C', repoPath, ...args], ...)` — the safe
  argv-array form, no shell string ever involved. Already safe, same
  principle as the F-015 fix; no code change needed, only imported
  `gitSafe`/`assertNoShellMetachar` as sibling-module requires.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range
  (4898-5168) plus a broader `^const |^let |^var ` sweep over the same
  window — found only `PHANTOM_STOP_WORDS` in range (already on the
  plan's MOVE list). The pre-existing `const { usage, HELP } =
  require(...)` line at the top of the range is Wave 1's facade import,
  not new wave-local state, and stays untouched. `PACK_ANON_LEVELS`/
  `PACK_TARGET_KINDS`/`PACK_DENY_REGEX` sit just below the range start
  (5194+, Wave 6 territory) — correctly out of scope this wave. No
  undocumented constant found this time (unlike Waves 2 and 4).
- Deviation (minor, pre-existing, same as Waves 1-4): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (22 suites, including
  a1-phantom: 3 passed 0 failed, and a1-cmd-injection: 7 passed 0 failed)
- Facade line count: 5831 → 5561 lines (−270)
- New module: `_shared/lib/phantom.cjs` (279 lines)

## Wave 6 — `pack` group — ✅ COMPLETE

- Commit: `f653a6e`
- Task: 6.1 (extract `pack` to `_shared/lib/pack.cjs`) — done
- Moved byte-identical: `PACK_ANON_LEVELS`, `PACK_TARGET_KINDS`,
  `PACK_DENY_REGEX`, `parsePackYaml`, `unquotePackScalar`,
  `parsePackInlineValue`, `parsePatternFile`, `packValidateDir`,
  `cmdPackValidate`, `copyDirRecursive`, `rmDirRecursive`, `cmdPackImport`,
  `parseVaultPatternsTable`, `cmdPackExport`, plus the doc-comment block
  explaining the Gate-Pack ADR contract (validate/import/export exit
  codes, deny-regex anonymization). Exports only the three dispatcher-
  facing functions (`cmdPackValidate`, `cmdPackImport`, `cmdPackExport`);
  the 8 internal helpers + 3 constants stay module-private (verified no
  external callers via grep before and after the move).
- Dependency correction (minor, logged in observations.jsonl): the plan's
  Task 6.1 Step 2 assumed this group reuses `io.cjs`'s `parseFrontmatter`
  ("pack.yaml (flat parser, reuses the frontmatter grammar...)"). Read the
  full moved block before writing the module and confirmed `parseFrontmatter`
  is never actually called — `parsePackYaml`/`parsePatternFile` only reuse
  the grammar *conceptually* (own from-scratch line parser), not the
  function itself. Imported what the code actually calls instead:
  `parseFlags` (used by `cmdPackImport`/`cmdPackExport` for flag parsing)
  and `vaultRoot` (used by `cmdPackExport` to locate patterns.md) from
  `io.cjs`. No dead import shipped.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range —
  found exactly the 3 constants already named in the plan text
  (`PACK_ANON_LEVELS`, `PACK_TARGET_KINDS`, `PACK_DENY_REGEX`), confirmed
  against the pre-move file via `git show HEAD:_shared/a1-tools.cjs`. No
  additional undocumented module-level const/RegExp found this wave
  (unlike Waves 2 and 4) — this is the first wave since the round-2 audit
  fix where the plan's own MOVE list was already complete.
- Deviation (minor, pre-existing, same as Waves 1-5): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (20 suites, including
  a1-pack: 13 passed 0 failed, and a1-cmd-injection)
- Facade line count: 5561 → 5122 lines (−439)
- New module: `_shared/lib/pack.cjs` (448 lines)

### Wave 6 checkpoint (per plan)

All 5 pure/self-contained groups (schema-check, cost, realpath-check,
phantom, pack) are now extracted. Plan estimated the facade "should have
shrunk by roughly 1400-1500 lines from the 7196 baseline" by this
checkpoint. **Actual shrinkage: 2074 lines (7196 → 5122)** — exceeds the
estimate by ~575-675 lines. Likely explanation: the 1400-1500 estimate
may have been based on moved-code-only line counts, while actual facade
deltas also drop each group's in-place section-comment doc blocks and
whitespace, and Wave 1's constant/help relocations (not counted as one
of the "5 pure groups") already contributed some of the reduction before
this checkpoint. No discrepancy investigation needed — a facade shrinking
faster than estimated is not a STOP-gate condition.

## Wave 7 — `worktree` + `pr` pair — ✅ COMPLETE

- Commit: `60956f9`
- Task: 7.1 (extract `worktree` to `_shared/lib/worktree.cjs` and `pr` to
  `_shared/lib/pr.cjs`) — done, both files in the same commit per the
  one-commit-per-wave rule (two separate CLI groups, two separate modules,
  as the plan requires — NOT merged into one file).
- Moved byte-identical to `worktree.cjs`: `cmdWorktreePrepare`,
  `cmdWorktreeEnter`, `cmdWorktreeStatus`, `cmdWorktreeExit`,
  `cmdWorktreeList`, `cmdWorktreeGc`, `resolveRealOrAbs`, `cmdWorktreeAdopt`,
  `cmdWorktreeReconcile` (kept in original definition order — `resolveRealOrAbs`
  sits between `cmdWorktreeGc` and `cmdWorktreeAdopt` in the source, preserved
  as-is). Imports from `lib/worktree-registry.cjs`: `WORKTREE_STATUSES`,
  `WORKTREE_EXIT_MODES`, `SLUG_RE`, `readRegistry`, `writeRegistryAtomic`,
  `nowCompactId`, `git`, `gitIsRepo`, `gitWorkingTreeClean`, `gitBranchExists`,
  `gitWorktreeList`, `gitBranchHasWorktree`, `findRegistryEntry`,
  `findActiveBySlug`, `repoParentWorktreeDir` — verified each by reading every
  moved function body first; deliberately did NOT import
  `worktreeRegistryPath` (destructured in the old facade require block but
  never actually called anywhere in the moved code — confirmed via grep, so
  not carried into the new module; this was dead-in-context, not a new dead
  import introduced by this wave).
- Moved byte-identical to `pr.cjs`: `PR_STATUSES` (module-level `const ... =
  new Set([...])`, correctly excluded from `status-constants.cjs` per Wave
  1's own reasoning since its only consumer extracts in this same wave —
  explicitly named in the plan's Wave 7 MOVE list, so no undocumented-constant
  finding here, unlike Waves 2 and 4), `cmdPrListHandoff`, `cmdPrMarkStatus`,
  `cmdPrMarkPrOpen`, `formatFindingMd`, `formatInlineMinorMd`,
  `cmdPrFindingsSummary`. Imports from `lib/worktree-registry.cjs`:
  `readRegistry`, `writeRegistryAtomic`, `findEntryBySlugOrId`,
  `readFindings` — verified `prReviewDir`/`ensurePrReviewDir` (named in the
  plan's suggested destructure list) are NOT actually called anywhere in the
  moved `pr` functions (only mentioned in a stale in-facade comment); omitted
  both from `pr.cjs`'s imports to avoid a dead import (plan's suggested
  import list was a superset of what's actually used — same
  over-specification pattern as Wave 6's `parseFrontmatter` finding, but
  caught before writing the file this time, not after).
- Export verification (per plan Step 6): confirmed via grep that
  `formatFindingMd`/`formatInlineMinorMd` have no callers anywhere in the
  facade outside the moved `pr` block — kept module-private in `pr.cjs`,
  not exported.
- Dependency-shadowing finding (minor, logged in observations.jsonl):
  `cmdWorktreePrepare` declares its own local `const fail = (name, hint) =>
  ...` (a validation-check accumulator, unrelated to `io.cjs`'s `fail(msg)`
  error-exit helper) that shadows the module scope for the whole function
  body. Confirmed via grep that every `fail(...)` call inside `worktree.cjs`
  resolves to this local shadow, not `io.cjs`'s `fail` — so `worktree.cjs`
  does NOT import `fail` from `io.cjs` at all (only `pr.cjs` does, where
  `fail` genuinely means the shared error-exit helper). Importing the shared
  `fail` unused into `worktree.cjs` would have been harmless but sloppy;
  omitted after tracing every call site.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the pre-move facade's wave 7
  line range (2605-3349) plus a `git diff` check post-move for any removed
  `^const|^let|^var` lines — found exactly the one constant already named in
  the plan (`PR_STATUSES`). No additional undocumented module-level
  const/RegExp found this wave (same clean outcome as Wave 6, in contrast to
  Waves 2 and 4).
- Stale comment cleanup (minor): the facade had a leftover
  `// ---------- entry point ----------` comment line sitting between the
  worktree and pr blocks (pre-existing misplacement, not something this wave
  introduced) and a `// prReviewDir, ensurePrReviewDir, readFindings,
  findEntryBySlugOrId live in lib/worktree-registry.cjs` comment that was
  stale even before this move (already inaccurate — `ensurePrReviewDir` was
  never called from the pr group). Both were naturally removed as part of
  replacing the moved blocks with the two `require(...)` lines; no separate
  action needed.
- Deviation (minor, pre-existing, same as Waves 1-6): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (all fixture suites, including
  a1-worktree: 48 passed 0 failed, a1-pr-review: 11 passed 0 failed, and
  a1-cmd-injection)
- Facade line count: 5122 → 4398 lines (−724)
- New modules: `_shared/lib/worktree.cjs` (599 lines),
  `_shared/lib/pr.cjs` (174 lines)

## Waves 8-17 — not started
