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

## Wave 8 — `check-reservations` + `code-scope` pair (incl. `product.cjs` fix) — ✅ COMPLETE

- Commit: `c5bf97b`
- Task: 8.1 (extract `check-reservations` to `_shared/lib/check-reservations.cjs`,
  `code-scope` to `_shared/lib/code-scope.cjs`, retire `product.cjs`'s
  `CODE_SCOPE_STAGES` injection) — done, all three files in one commit per the
  same-commit coordination requirement (facade + code-scope.cjs +
  check-reservations.cjs + product.cjs).
- Moved byte-identical to `check-reservations.cjs`: `cmdCheckReservations`.
  Imports `parseFlags`/`nowIso` from `io.cjs`, `usage` from `help.cjs`,
  `reservationsFile`/`loadReservations`/`acquireReservationsLock`/
  `exitWithLock`/`writeJsonAtomic` from `locks.cjs` — verified the exact set
  by reading the function body first; `failWithLock` is NOT called by this
  function (only by `code-scope`'s stage transition), so it was correctly
  omitted here, narrower than the plan's suggested superset.
- Moved byte-identical to `code-scope.cjs`: `normalizeScopePath`,
  `scopeSegments`, `isGlobSegment`, `segmentsMatchGlob`, `isSegmentPrefix`,
  `nonGlobPrefix`, `scopePathsOverlap`, `findScopeOverlaps`, `parseScopeList`,
  `CODE_SCOPE_STAGES` (module-level const, NOT a function), `cmdCodeScopeClaim`,
  `cmdCodeScopeStage`, `cmdCodeScopeRelease`, `cmdCodeScopeList`,
  `cmdCodeScopeCheck`, plus the doc-comment block explaining the code-scope
  contract (path-list overlap gate, FR-004..007/017). Imports
  `parseFlags`/`nowIso` from `io.cjs`, `usage` from `help.cjs`,
  `reservationsFile`/`loadReservations`/`acquireReservationsLock`/
  `exitWithLock`/`failWithLock`/`writeJsonAtomic` from `locks.cjs` (this group
  DOES use `failWithLock`, unlike check-reservations). Exports
  `CODE_SCOPE_STAGES` alongside the 5 dispatcher-facing functions — this is
  the load-bearing export `product.cjs` depends on.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range
  (3730-4176 pre-move) — found exactly the one constant already named in
  the plan (`CODE_SCOPE_STAGES`). No additional undocumented module-level
  const/RegExp found this wave (clean outcome, same as Waves 3, 6, 7).
- **Same-commit `product.cjs` fix (per plan Step 7, the coordinated part of
  this wave):** replaced `let CODE_SCOPE_STAGES = null;` + the `init(deps)`
  function (which only ever set `CODE_SCOPE_STAGES = deps.CODE_SCOPE_STAGES`,
  since Wave 1 had already dropped `usage` from its injected fields) with a
  plain top-level `const { CODE_SCOPE_STAGES } = require('./code-scope.cjs');`.
  Removed `init` entirely from `product.cjs` (function body + `module.exports`
  entry) — confirmed via grep no other reference to `init` remained in the
  file (the string `init` still appears, but only inside command names like
  `cmdProductInit`/`product init`/`feature-init`, not the removed function).
  Facade's dispatcher `product` branch: removed the
  `product.init({ CODE_SCOPE_STAGES })` line entirely, kept the lazy
  `const product = require(...)` line unchanged (still paid only when
  `product ...` is invoked). No circular require introduced:
  `code-scope.cjs` does not require `product.cjs` or the facade.
- Facade: replaced both moved blocks with two `require(...)` lines near the
  other static Pattern-A imports; dispatcher branches for `check reservations`
  and `code-scope` unchanged in shape (still call the same function names,
  now resolved via import instead of local definition).
- Doc-comment cleanup: updated the two comment blocks (facade lines ~219-227
  documenting the `product` group, and ~3911-3915 at the dispatcher's
  `product` branch) that explicitly named `CODE_SCOPE_STAGES` as a live
  facade identifier — since `grep -c "CODE_SCOPE_STAGES" _shared/a1-tools.cjs`
  is a mandatory zero-check per the plan's Step 9 (facade must not reference
  the identifier AT ALL, not even in a comment), reworded both comments to
  describe it generically ("the stage-name constant") instead of naming it
  verbatim. This is a stricter reading than a functional necessity (comments
  don't affect runtime), but it's what the plan's own verification command
  literally checks, so it was honored precisely rather than left as a
  near-miss.
- Verification: `grep -c "^function cmdCheckReservations" _shared/a1-tools.cjs`
  → 0; `grep -c "^function cmdCodeScopeClaim" _shared/a1-tools.cjs` → 0;
  `grep -c "CODE_SCOPE_STAGES" _shared/a1-tools.cjs` → 0 (all three exactly
  as required).
- Smoke test (per plan's Done-when, proving `product.cjs`'s new direct
  `require('./code-scope.cjs')` resolves at runtime): ran
  `node _shared/a1-tools.cjs product stage --dir /tmp/m10-w8-smoke --set started`
  — exits 1 with a clean `usage error: product stage requires --by
  <feature-id> --set <stage>` (expected: no `--by` flag given, no dir/roadmap
  set up), critically NOT a `ReferenceError`. Additionally ran a fuller
  end-to-end smoke (`product init` → `add-milestone` → `add-feature` →
  `product stage --by 001-smoke --set started`) against a real scaffolded
  roadmap in `/tmp/m10-w8-smoke2`: succeeded (exit 0, JSON `{"status":"OK",
  "stage":"started",...}`), then confirmed the imported `CODE_SCOPE_STAGES`
  is genuinely live by testing an invalid stage name (`--set bogus-stage`)
  and getting the exact `CODE_SCOPE_STAGES.join('|')`-interpolated usage
  error message (`started|complete|review|verify|merge|origin-cleanup|done`)
  — proves the constant's actual values flow correctly through the new
  direct require, not just that the require doesn't throw.
- Deviation (minor, pre-existing, same as Waves 1-7): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (all fixture suites, including
  a1-reservations: 22 passed 0 failed, a1-code-scope: 72 passed 0 failed,
  product-docs: 68 passed 0 failed, product-adopt: 33 passed 0 failed)
- Facade line count: 4398 → 3975 lines (−423)
- New modules: `_shared/lib/check-reservations.cjs` (127 lines),
  `_shared/lib/code-scope.cjs` (336 lines)

## Wave 9 — `check` (FR-coverage gate) group — ✅ COMPLETE

- Commit: `731798b`
- Task: 9.1 (extract `check` to `_shared/lib/check.cjs`) — done
- Moved byte-identical: `extractSpecFRs`, `extractWaveFRs`, `diffFRCoverage`,
  `buildExpectedPaths`, `formatHumanReport`, `cmdCheckRun`, `emitCheckReport`,
  plus the doc-comment block explaining the consistency-gate contract
  (frontmatter_link / fr_coverage / fr_phantoms checks, exit codes 0/1/2).
  Exports only the dispatcher-facing function (`cmdCheckRun`); the 5
  internal helpers stay module-private (verified no external callers via
  grep before and after the move — `check reservations` is a fully
  separate command surface, already extracted in Wave 8 as
  `cmdCheckReservations`, not conflated with this group).
- `FR_PATTERN`/`WAVE_HEADING_PATTERN` decision (per plan's explicit
  verify step): grepped the WHOLE current facade for both names BEFORE
  moving. Both regex consts are consumed exclusively inside this group's
  own `extractSpecFRs` (`FR_PATTERN`) and `extractWaveFRs`
  (`FR_PATTERN`, plus a separate inline `headingRe` literal — not
  `WAVE_HEADING_PATTERN` itself, which turned out to have no live call
  site beyond its own definition, but was left in as originally written,
  a pure byte-identical move). No `checklist` call site found anywhere
  in the facade for either name (`checklist`'s functions have not been
  extracted yet, per Wave 10, and do not reference either constant at
  all — confirmed by grepping the checklist block's line range too).
  Reasoning: since there is no cross-wave consumer, this is a clean
  single-owner move, not a duplication case — both consts moved
  wholesale into `check.cjs`. No shared module invented, no duplication
  into a not-yet-created `checklist.cjs` needed. If Wave 10's own
  const-sweep later finds either name referenced inside `checklist`'s
  block, that will be a fresh finding for Wave 10 to handle independently
  (this wave's grep found nothing to suggest that).
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range
  (1688-1980 pre-move) — found exactly the two constants already
  identified above (`FR_PATTERN`, `WAVE_HEADING_PATTERN`). No additional
  undocumented module-level const/RegExp found this wave (clean outcome,
  same as Waves 3, 6, 7, 8).
- Dispatcher verification (per plan Step 5/7): `main()`'s
  `group === 'check'` branch keeps its existing special-case routing
  byte-identical — `check reservations` still routes to
  `cmdCheckReservations` (Wave 8's module), `check <slug>` still routes
  to `cmdCheckRun` (this wave's module). Verified via two smoke calls:
  `check reservations --list --file /tmp/m10-w9-smoke.json` (exit 0,
  valid JSON `{"count":0,"reservations":[]}`) and
  `check some-nonexistent-slug --feature 001-test` (exit 0 from the
  wrapper, but the printed report shows `"status":"ERROR","exit_code":2`
  — proves it reached `cmdCheckRun`'s load-phase error path, not a
  `ReferenceError`).
- Deviation (minor, pre-existing, same as Waves 1-8): a1-reconcile
  fixture suite writes live timestamps into checked-in fixture files
  during the regression run; diff reverted before staging, suite itself
  not fixed (out of scope).
- Full regression gate: ALL-SUITES-GREEN (all fixture suites, including
  a1-check: 6 passed 0 failed)
- Facade line count: 3975 → 3685 lines (−290)
- New module: `_shared/lib/check.cjs` (301 lines)

## Wave 10 — `checklist` group (F-009 split of `runChecklistChecks`) — ✅ COMPLETE

- Commit: `7299033`
- Task: 10.1 (extract `checklist` to `_shared/lib/checklist.cjs`, splitting
  `runChecklistChecks`) — done. This wave was a genuine behavior-preserving
  refactor, not a pure mechanical move (per plan's explicit framing).
- Moved byte-identical (no split needed): `CHECKLIST_REQUIRED_PLAN_FM_FIELDS`
  (module-level const array, NOT a function — correctly on the plan's own
  MOVE list this time, no undocumented-constant finding), `resolveChecklistTarget`,
  `checklistPaths`, `extractWaveBlocks`, `extractWaveDependencies`,
  `detectWaveCycles`, `classifyChecklistResult`, `formatChecklistHumanReport`,
  `cmdChecklistRun`, `emitChecklistReport`, `cmdChecklistList`. Exports only
  the two dispatcher-facing functions (`cmdChecklistRun`, `cmdChecklistList`);
  all other moved identifiers stay module-private (verified no external
  callers via grep before and after the move).
- **F-009 split of `runChecklistChecks` (246 lines pre-split) — the core
  task of this wave.** Read the full function end-to-end before writing any
  code (per plan Step 2 / executor instructions). Split into 5 named helpers,
  each independently well under the ~100-line ceiling (line counts via
  `awk` scan of `_shared/lib/checklist.cjs`, includes braces/comments/blanks):
  - `gatherChecklistInputs(paths)` — **31 lines** — parse/gather phase: loads
    spec + plan frontmatter/body from disk with the original graceful-fallback
    error handling, returns `{ spec, plan, planExists, errors, fatal }`.
  - `evaluateChecklistRules(slug, paths, spec, plan, planExists)` — **87
    lines** — compute-phase orchestrator: runs checks 1 (`spec_status_clarified`)
    and 2 (`wave_plan_exists`), then either emits the original 6-check
    no-plan degenerate branch (checks 3-8 all skipped/FAIL) or delegates to
    `evaluateChecklistPlanBodyRules` for the full check set.
  - `evaluateChecklistWaveStructureRules(waveBlocks)` — **64 lines** — checks
    3 (`waves_have_suggested_agents`), 4 (`wave_dependencies_dag`), 5
    (`waves_have_stories_advanced`) — all derived purely from parsed wave
    blocks.
  - `evaluateChecklistProjectMetaRules(slug, paths, plan)` — **78 lines** —
    checks 6 (`project_claudemd_exists`), 7 (`plans_directory_convention`), 8
    (`plan_frontmatter_complete`) — all derived from project metadata rather
    than wave blocks.
  - `evaluateChecklistPlanBodyRules(slug, paths, plan)` — **7 lines** — thin
    composer: extracts wave blocks once, concatenates the two sub-evaluators'
    results. Kept as its own named function (matching the plan's suggested
    name) rather than inlined, for readability at the call site.
  - `runChecklistChecks(slug, feature, paths)` — **14 lines** — kept as a
    thin orchestrator under its ORIGINAL name (plan's stated option B: "or is
    removed entirely if `cmdChecklistRun` can call the three directly —
    whichever keeps the diff smallest and clearest"). Keeping the name and
    signature meant `cmdChecklistRun`'s call site (`runChecklistChecks(slug,
    feature, paths)`) needed ZERO changes — smaller, safer diff than
    inlining three calls into `cmdChecklistRun` directly. Calls
    `gatherChecklistInputs` then `evaluateChecklistRules` in sequence,
    returns the exact same `{ checks, errors, fatal }` shape as the
    pre-split version.
  - Rationale for the 2-level compute split (5 helpers instead of the
    plan's suggested 3): a straightforward "gather / one compute / format"
    3-way split left the single compute helper at ~215 lines (way over
    the ~100-line ceiling), because checks 3-8's plan-body logic is
    itself substantial. Split the compute phase into wave-structure
    checks (3-5) vs. project-metadata checks (6-8) — a natural, readable
    grouping that keeps every individual helper under 90 lines while
    preserving the exact same combined checks[] array contents/order as
    the original single function.
  - No separate "format" helper was introduced for `runChecklistChecks`
    itself: the pre-split function's own "format" concern (shaping raw
    check results into the report object `cmdChecklistRun` expects) was
    already handled downstream by the pre-existing `classifyChecklistResult`
    / `formatChecklistHumanReport` functions, which this wave moved
    unchanged (not part of the F-009 target). Forcing an artificial extra
    "format" layer purely inside `runChecklistChecks` (which just returns
    `{ checks, errors, fatal }`, already a plain data shape) would have
    added indirection without a corresponding size-ceiling or readability
    benefit — noted as a deliberate deviation from the plan's suggested
    3-phase shape in favor of what the actual code structure warranted.
- `FR_PATTERN`/`WAVE_HEADING_PATTERN` check (per plan Step 5, referencing
  Wave 9's decision): grepped the whole checklist block — neither constant
  is referenced anywhere in it (Wave 9's own grep across the WHOLE facade
  already confirmed this before `check.cjs` was created). No duplication
  needed, no shared module invented.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const \|^let \|^var "` restricted to the pre-move facade's
  checklist line range (1688-2310) — found exactly the one constant
  already named in the plan (`CHECKLIST_REQUIRED_PLAN_FM_FIELDS`). No
  additional undocumented module-level const/RegExp found this wave (clean
  outcome, same as Waves 3, 6, 7, 8, 9).
- **Critical regression check specific to this wave (per plan Step 7,
  mandatory since this is a genuine refactor not a pure move):** ran the
  full `_test-fixtures/a1-checklist/run-tests.sh` suite (all 8 vault-fixture
  cases: pass, blocker-spec-not-clarified, blocker-no-plan,
  blocker-dep-cycle, major-missing-agents, major-missing-stories,
  major-missing-frontmatter, minor-no-claudemd, plus a 9th slug-only-resolve
  variant of the pass case) — all 9 passed. THEN additionally, beyond what
  the fixture suite's exit-code/status-field assertions check, ran a
  byte-for-byte stdout diff for EVERY ONE of the 8 fixture cases (not just
  one passing + one failing case as the plan's minimum bar) between the
  pre-wave facade (`git show HEAD:_shared/a1-tools.cjs`, restored to a
  scratch file alongside a copy of `_shared/lib/` with the new
  `checklist.cjs` removed, so it exercises the pre-split inline function)
  and the post-wave facade, using `checklist run demo/001-login --vault
  <fixture-dir> --format json`: all 8 diffs were empty (byte-identical),
  and all 8 exit codes matched. Also diffed `--format human` output for one
  case (`major-missing-agents`) and `checklist list demo` output for the
  `pass` fixture — both byte-identical too. This confirms the split
  preserved exact output SHAPE (field order, values, formatting), not just
  exit-code parity.
- Deviation (minor, pre-existing, same as Waves 1-9): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging (twice — once before the
  first commit attempt, once again after a second full regression-gate run
  re-triggered it), suite itself not fixed (out of scope).
- Full regression gate: ALL-SUITES-GREEN (all fixture suites, including
  a1-checklist: 9 passed 0 failed)
- Facade line count: 3685 → 3065 lines (−620)
- New module: `_shared/lib/checklist.cjs` (710 lines)
- **SC-4 confirmation (explicit):** `runChecklistChecks` is split into
  parse (`gatherChecklistInputs`, 31 lines) / compute
  (`evaluateChecklistRules` 87 lines, delegating to
  `evaluateChecklistWaveStructureRules` 64 lines and
  `evaluateChecklistProjectMetaRules` 78 lines via the 7-line composer
  `evaluateChecklistPlanBodyRules`) / the pre-existing format helpers
  (`classifyChecklistResult`, `formatChecklistHumanReport`, moved
  unchanged). No single helper in the split exceeds ~100 lines (largest
  compute-phase helper is 87 lines; largest overall function in the file
  is the unsplit `cmdChecklistRun` dispatcher at 96 lines, which was never
  an F-009 split target). SC-4 is satisfied.

## Wave 11 — `spec` group — ✅ COMPLETE

- Commit: `bbc8fbd`
- Task: 11.1 (extract `spec` to `_shared/lib/spec.cjs`) — done
- **Cross-group caller check (mandatory per plan Step 2, MUST-do-before-moving
  gate):** ran `grep -n "appendPhaseHistory(" _shared/lib/worktree.cjs
  _shared/lib/checklist.cjs _shared/a1-tools.cjs` BEFORE any move. Result: zero
  hits in `worktree.cjs` or `checklist.cjs` — all 9 hits (1 definition + 8 call
  sites) were still inside the facade itself, and every call site belongs to a
  group not yet extracted (spec/fix/analyze/constitution/reconcile — Waves
  11-14/16). No dangling-reference / under-scoped-earlier-wave condition
  found; NOT a STOP-gate case. Proceeded with the move as planned.
- Moved byte-identical: `appendPhaseHistory`, `cmdSpecNextNumber`,
  `cmdSpecUpdateStatus`, `cmdSpecList`. Exports all four (per plan Step 4 —
  `appendPhaseHistory` exported even though this wave's own cross-group check
  found no live cross-module caller yet, since fix/analyze/constitution/
  reconcile will import it from `lib/spec.cjs` when they extract in later
  waves).
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range (165-360
  pre-move) — found **`SPEC_STATUS_TO_PHASE`**, a module-level const object
  (not a `Set`, a plain phase-lookup map) sitting between `cmdSpecNextNumber`
  and `cmdSpecUpdateStatus`, not named in the plan's own Wave 11 MOVE list.
  Consumed via bracket lookup (`SPEC_STATUS_TO_PHASE[newStatus]`) inside
  `cmdSpecUpdateStatus`, not `.has()`/`.match()`/`.test()` — the same
  detection-blind-spot pattern already seen in Wave 2's `SQL_TYPE_ALIASES`
  finding. Moved it alongside the four named functions; leaving it in the
  facade would have stranded `cmdSpecUpdateStatus` with a `ReferenceError` on
  its very first non-trivial call. Logged in observations.jsonl (pattern:
  `missing_wiring`).
- Determined deps by reading the full moved block: `usage` (from
  `help.cjs`), `vaultRoot`, `resolveVaultPath`, `parseFlags`, `readMd`,
  `writeMdAtomic`, `nowIso`, `fail` (all from `io.cjs`), `SPEC_STATUSES` (from
  `status-constants.cjs`, per Wave 1's revision — `cmdSpecUpdateStatus`
  validates via `.has(newStatus)`).
- Export verification: confirmed via grep that only the facade's dispatcher
  (`group === 'spec'` branch, 3 call sites) calls the three `cmdSpec*`
  functions — no other group referenced them before the move.
- Deviation (minor, pre-existing, same as Waves 1-10): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging, suite itself not fixed
  (out of scope).
- Full regression gate: ALL-SUITES-GREEN (all fixture suites), specifically
  re-confirmed per plan's Wave 11 Done-when block:
  `_test-fixtures/a1-worktree/run-tests.sh` → 48 passed, 0 failed;
  `_test-fixtures/a1-checklist/run-tests.sh` → 9 passed, 0 failed (both guard
  against a broken `appendPhaseHistory` cross-import, both green).
- Facade line count: 3065 → 2946 lines (−119)
- New module: `_shared/lib/spec.cjs` (150 lines)

## Wave 12 — `analyze` group — ✅ COMPLETE

- Commit: `7476e98`
- Task: 12.1 (extract `analyze` to `_shared/lib/analyze.cjs`) — done
- Moved byte-identical: `cmdAnalyzeNextSlot`, `cmdAnalyzeInit`,
  `cmdAnalyzeUpdateStatus`, `cmdAnalyzeDiscover`, `cmdAnalyzeAddFinding`,
  `appendFinding`, `cmdAnalyzeAddFindings`, `cmdAnalyzeList`. Exports only
  the 7 dispatcher-facing functions (`cmdAnalyzeNextSlot`, `cmdAnalyzeInit`,
  `cmdAnalyzeUpdateStatus`, `cmdAnalyzeDiscover`, `cmdAnalyzeAddFinding`,
  `cmdAnalyzeAddFindings`, `cmdAnalyzeList`); `appendFinding` stays
  module-private (verified no external callers via grep before and after
  the move).
- `appendPhaseHistory` cross-import (per plan Step 2): confirmed live usage
  at the `cmdAnalyzeUpdateStatus` call site (bracket-mapped via
  `ANALYSIS_STATUS_TO_PHASE[newStatus]`, see below) and imported it from
  `lib/spec.cjs` (`const { appendPhaseHistory } = require('./spec.cjs');`)
  rather than duplicating the function body — `lib/spec.cjs` already
  exports it since Wave 11. Verified at runtime with an end-to-end smoke
  test (`analyze init` → `analyze update-status ... discovered`): the
  written frontmatter's `phase_history` array gained the expected
  `phase=discover completed=<iso>` entry, proving the cross-module import
  resolves correctly, not just that it doesn't throw.
- Const-sweep (mandatory per Executor ground rules): ran
  `grep -n "^const [A-Z_]* = "` restricted to the wave's line range
  (678-1145 pre-move) plus a broader `^const |^let |^var ` sweep over the
  same window — found **`ANALYSIS_STATUS_TO_PHASE`**, a module-level
  phase-lookup object (not a `Set`, analogous to Wave 11's
  `SPEC_STATUS_TO_PHASE` and the immediately-following
  `CONSTITUTION_STATUS_TO_PHASE`), sitting between `cmdAnalyzeInit` and
  `cmdAnalyzeUpdateStatus`, not named anywhere in the plan's own Wave 12
  MOVE list. Consumed via bracket lookup (`ANALYSIS_STATUS_TO_PHASE[newStatus]`)
  inside `cmdAnalyzeUpdateStatus`, not `.has()`/`.match()`/`.test()` — same
  detection-blind-spot pattern as Wave 2's `SQL_TYPE_ALIASES` and Wave 11's
  `SPEC_STATUS_TO_PHASE`. Moved it alongside the 7 named functions; leaving
  it in the facade would have stranded `cmdAnalyzeUpdateStatus` with a
  `ReferenceError` on its very first status-transition call. Logged in
  observations.jsonl (pattern: `missing_wiring`).
- Determined deps by reading the full moved block: `usage` (from
  `help.cjs`), `vaultRoot`, `resolveVaultPath`, `parseFlags`, `readMd`,
  `writeMdAtomic`, `nowIso`, `fail` (all from `io.cjs`), `ANALYSIS_STATUSES`/
  `ANALYSIS_FOCUSES`/`ANALYSIS_SEVERITIES` (from `status-constants.cjs`, per
  Wave 1's revision).
- Export verification: confirmed via grep that only the facade's dispatcher
  (`group === 'analyze'` branch, 7 call sites) calls the `cmdAnalyze*`
  functions — no other group referenced them before the move.
- Deviation (minor, pre-existing, same as Waves 1-11): a1-reconcile fixture
  suite writes live timestamps into checked-in fixture files during the
  regression run; diff reverted before staging (twice, once per full
  regression-gate run), suite itself not fixed (out of scope).
- Full regression gate: ALL-SUITES-GREEN (all fixture suites, including
  a1-analyze-cli: 4 passed, 0 failed)
- Facade line count: 2946 → 2490 lines (−456)
- New module: `_shared/lib/analyze.cjs` (496 lines)

## Waves 13-17 — not started
