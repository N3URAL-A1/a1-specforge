---
goal: Continue the M9 module split of _shared/a1-tools.cjs — extract the 14 remaining command groups into _shared/lib/<group>.cjs, add fixture coverage for fix + constitution, split the 5 oversized functions, and settle the init()-injection coupling question before it's copied 14 more times
generated: 2026-07-12
---

# Research: M10 module-split continuation

## Current state (verified against HEAD, not planning-time estimates)

`_shared/a1-tools.cjs` is **7196 lines** right now (drifted from the 7148 recorded in
M9's VERIFICATION.md — 2 unrelated Analysis fixes landed since: F-015 command-injection
fix in `gitLastTouchIso`/`cmdReconcileParseSpec`, now using `gitSafe(execFileSync)`, and
the F-008 HELP-text addition for `modernize`). `_shared/lib/` already holds the 4 modules
from M9: `io.cjs`, `locks.cjs`, `worktree-registry.cjs`, `product.cjs`. Regression gate
(`node --check` + 19 fixture suites) is green at this commit.

**14 remaining command groups + facade-only blocks, in file order** (`grep -n "^function "`
+ manual boundary verification via section-comment markers `// ---------- <x> ----------`):

| # | Group | Line range | Size | Functions | Notes |
|---|---|---|---|---|---|
| 1 | `spec` | 322–448 | 127 | `appendPhaseHistory`\*, `cmdSpecNextNumber`, `cmdSpecUpdateStatus`, `cmdSpecList` | `appendPhaseHistory` is a small shared helper — used only by spec today but check before moving (see Q1 below) |
| 2 | `fix` | 449–887 | 439 | `cmdFixNextSuffix`, `cmdFixUpdateStatus`, `cmdFixList`, `cmdFixFindDuplicates`, `postmortemsDir`, `agentsLockPath`, `lastPromotePath`, `cmdFixIntegrityCheck`, `cmdFixInitPostmortem`, `cmdFixCountPostmortemsSince`, `cmdFixUpdatePromoteState`, `cmdFixWriteSuggestion` | **F-007 target — zero fixture coverage.** Learning-loop state machine (postmortems, promote-state, integrity-check). Self-contained, no cross-group calls found. |
| 3 | `analyze` | 888–1354 | 467 | `cmdAnalyzeNextSlot`, `cmdAnalyzeInit`, `cmdAnalyzeUpdateStatus`, `cmdAnalyzeDiscover`, `cmdAnalyzeAddFinding`, `appendFinding`, `cmdAnalyzeAddFindings`, `cmdAnalyzeList` | Has fixture (`a1-analyze-cli`). Self-contained. |
| 4 | `constitution` | 1355–1778 | 424 | `constitutionVaultPath`, `constitutionHistoryDir`, `cmdConstitutionInit`, `cmdConstitutionDiscover`, `cmdConstitutionUpdateStatus`, `cmdConstitutionSetBody`, `cmdConstitutionNextVersion`, `cmdConstitutionArchiveCurrent` (calls `cmdConstitutionNextVersion` internally, in-group), `cmdConstitutionWriteMirror`, `cmdConstitutionLinkClaudemd`, `cmdConstitutionList` | **F-007 target — zero fixture coverage.** Self-contained; one intra-group call (`archiveCurrent` → `nextVersion`). |
| 5 | `check` (consistency gate) | 1779–2071 | 293 | `extractSpecFRs`, `extractWaveFRs`, `diffFRCoverage`, `buildExpectedPaths`, `formatHumanReport`, `cmdCheckRun`, `emitCheckReport` | Uses `FR_PATTERN`/`WAVE_HEADING_PATTERN` (module-local regex consts, verify they're scoped here not global — see Wave-6-style free-identifier check). Has fixture (`a1-check`). |
| 6 | `checklist` | 2072–2694 | 623 | `resolveChecklistTarget`, `checklistPaths`, `extractWaveBlocks`, `extractWaveDependencies`, `detectWaveCycles`, `runChecklistChecks` (**F-009: 246 lines**), `classifyChecklistResult`, `formatChecklistHumanReport`, `cmdChecklistRun`, `emitChecklistReport`, `cmdChecklistList` | Has fixture (`a1-checklist`, 80-line runner, 8 vault-fixture cases — good template). Largest single group by line count. |
| 7 | `worktree` + `pr` | 2695–3440 | 746 | worktree: `cmdWorktreePrepare`…`cmdWorktreeReconcile` (8 fns, incl. M9's `adopt`/`reconcile`); pr: `cmdPrListHandoff`, `cmdPrMarkStatus`, `cmdPrMarkPrOpen`, `formatFindingMd`, `formatInlineMinorMd`, `cmdPrFindingsSummary` | Both groups already depend on `lib/worktree-registry.cjs` (readRegistry, writeRegistryAtomic, git, gitIsRepo, findEntryBySlugOrId, etc. — imported, not re-derived). Has fixtures (`a1-worktree`, `a1-pr-review`). Natural pair — `pr` is entirely registry-driven, same as `worktree`. |
| 8 | `modernize` | 3441–4005 | 565 | `modernizeDir`, `cmdModernizeNextSlot` … `cmdModernizeList` (13 cmd fns) | Self-contained, no cross-group calls. Fixture: `a1-modernize-roundtrip`. Just got its HELP block added (F-008) — verify HELP text stays correct after move. |
| 9 | `reconcile` | 4006–4545 | 540 | `reconcileDir`, `cmdReconcileNextSlot`, `listProjectSpecs`, `cmdReconcileInit`, `parseKvEntry`, `classifyAnchor`, `extractAnchorsFromSpec`, `gitLastTouchIso`, `cmdReconcileParseSpec`, `cmdReconcileUpdateStatus`, `cmdReconcileAddDrift`, `cmdReconcileList` | **Depends on `worktree-registry.cjs`** for `gitSafe`(execFileSync-based)/`vaultRoot`/`resolveVaultPath` — already imported via `io.cjs`/`git-safe.cjs` requires at top of file. `gitLastTouchIso` is the fixed F-015 injection site — moving it is pure relocation, already safe. Fixture: `a1-reconcile` (231 lines, largest fixture — good template) + `a1-cmd-injection` (targeted regression for F-015). |
| 10 | `schema-check` | 4565–4835 | 271 | `sqlStripComments`, `sqlSplitStatements`, `normalizeSqlType`, `sqlIdent`, `splitTopLevelCommas`, `parseColumnDef`, `parseCreateTable`, `parseAlterTable`, `parseCreateTrigger`, `parseSqlFiles`, `cmdSchemaCheckParse`, `cmdSchemaCheckRun` (**F-009: 153 lines**) | Pure/self-contained SQL parser, zero I/O beyond reading `.sql` files. No cross-group deps. Fixture: `a1-schema-check`. Good isolation candidate — lowest risk in the whole list. |
| 11 | `cost` | 4990–5227 | 238 | `costEmptyTotals`, `costAddUsage`, `costParseJsonlFile`, `cmdCostRun` (**F-009: 187 lines**) | Pure JSONL aggregation, self-contained. Fixture: `a1-cost`. |
| 12 | `realpath-check` | 5228–5453 | 226 | `runGit` (**local duplicate of `git-safe.cjs`'s gitSafe — verify, likely redundant, see Q2**), `scanDiffForSurfaces`, `extractEvidenceSections`, `sectionHasCommand`, `cmdRealpathCheckRun` | Fixture: `a1-realpath-check`. |
| 13 | `check reservations` (scalar reservations CLI) | 5454–5577 | 124 | `cmdCheckReservations` | Depends on `locks.cjs` (`acquireReservationsLock`, `loadReservations`, `writeJsonAtomic`, `exitWithLock`, `failWithLock`) — already imported. Distinct from group #5 (`check` FR-coverage gate) despite sharing the `check` dispatcher prefix — **the dispatcher special-cases `check reservations` vs `check <slug>` at the `main()` level (see line ~7010), so these two are logically separate command surfaces that happen to share a CLI verb.** Fixture: `a1-reservations` (largest reservations suite, 22+ cases incl. hostile inputs from M9 Wave 2). |
| 14 | `code-scope` | 5578–5882 | 305 | `normalizeScopePath`, `scopeSegments`, `isGlobSegment`, `segmentsMatchGlob`, `isSegmentPrefix`, `nonGlobPrefix`, `scopePathsOverlap`, `findScopeOverlaps`, `parseScopeList`, `cmdCodeScopeClaim`, `cmdCodeScopeStage`, `cmdCodeScopeRelease`, `cmdCodeScopeList`, `cmdCodeScopeCheck` | Depends on `locks.cjs` (same as reservations — shares `.a1/reservations.json`) and defines `CODE_SCOPE_STAGES` (module-level const at line 5707) that is **also used by `lib/product.cjs`'s `cmdProductStage`/`cmdProductMarkersSet` via the existing `init({usage, CODE_SCOPE_STAGES})` injection** — this is the load-bearing precedent for how shared constants must be handled (see "How init() actually works" below). Fixture: `a1-code-scope`. |
| 15 | `usage`/`HELP` (facade-only) | 5883–6262 | 380 | `usage(msg)` (6 lines) + `const HELP = ...` (**F-009: ~374-line template string**) | **Must stay in the facade** — every group's dispatcher branch calls `usage(...)` on bad args, and `usage()` closes over `HELP`. This is the M9 precedent already documented in `io.cjs`'s move comment ("NOT moved: usage — depends on the HELP constant — stays in a1-tools.cjs"). Extracting groups will need the same `init({usage})` pattern product.cjs already uses, OR usage/HELP move to their own `lib/help.cjs` and every extracted module imports `usage` directly (no injection) — this is the F-011 design decision, see below. |
| 16 | `phantom` | 6278–6534 | 257 | `PHANTOM_STOP_WORDS`, `parsePhantomTasks`, `extractPhantomKeywords`, `phantomDefaultSince`, `phantomCollectDiff`, `phantomMatch`, `cmdPhantomCheck`, `cmdPhantomListTasks` | Self-contained (uses `git`/`execFileSync` for diff collection — verify it already uses the safe array form, not a shell string, given F-015 was elsewhere). Fixture: `a1-phantom`. |
| 17 | `pack` | 6558–6975 | 418 | `parsePackYaml`, `unquotePackScalar`, `parsePackInlineValue`, `parsePatternFile`, `packValidateDir`, `cmdPackValidate`, `copyDirRecursive`, `rmDirRecursive`, `cmdPackImport`, `parseVaultPatternsTable`, `cmdPackExport` | Self-contained; reuses `parseFrontmatter` grammar from `io.cjs` (already imported). Fixture: `a1-pack`. |
| 18 | `main()` (dispatcher) | 6976–7196 | **221 (F-009)** | pure `if/else` chain, one branch per group, `group === 'product'` branch already shows the lazy-require + `init()` pattern | Must stay in facade (it *is* the facade). F-009 recommends collapsing this via a per-group dispatch table once groups own their own sub-dispatch — see "Grouping/dispatch strategy" below. |

Total lines across groups 1–14 (excluding usage/HELP/main which are facade-resident):
**~6053 lines**. If all 14 extract cleanly, the facade should shrink to roughly
`7196 - 6053 + <require-boilerplate, ~5-8 lines per group> ≈ 1250-1300 lines` — well
under both the file's own 800-line target (would still need `main()`+HELP+usage+dispatcher
comments trimmed further, realistically the facade bottoms out around 700-900 lines once
`usage`/`HELP` also move) and the PLAN's implied continuation of the M9 pattern.

\* `appendPhaseHistory` (line 322) is defined immediately before `cmdSpecNextNumber` and
is NOT under the `spec` section comment (it's between the `product` section-comment
marker at 310 and the `spec` marker at 331) — check its actual callers before assuming
it's spec-only; likely a shared cross-group helper that predates the section comments
being fully accurate (the section markers are approximate navigation aids, not hard
boundaries — same caveat M9's plan flagged: "line numbers... use as orientation, locate
by function name first").

## How the M9 pattern actually works mechanically

Read `_shared/lib/product.cjs` (1567 lines) and `_shared/lib/worktree-registry.cjs` (176
lines) end to end. Two distinct sub-patterns exist, not one:

**Pattern A — pure dependency injection via `require()` (no `init()`), used by
`worktree-registry.cjs`:** The module has zero references to facade-only state. It
requires only `fs`/`path`/`os`/`child_process`, defines self-contained helpers
(`readRegistry`, `git`, `gitWorktreeList`, etc.), and `module.exports` the whole set. The
facade does a plain destructuring `require()` at the top of the file (not lazily, not
lazily-per-branch) and calls the functions directly — **no `init()` call anywhere for
this module.** This is possible because `worktree-registry.cjs` needs no `usage()` or
`HELP` — it only returns data or throws `Error`, and the *caller* (facade's `cmdWorktree*`
functions, which stayed in the facade) is what calls `usage()` on bad input.

**Pattern B — lazy require + `init()` injection, used by `product.cjs`:** The module
needs `usage()` (facade-only, depends on `HELP`) and `CODE_SCOPE_STAGES` (a facade-level
const shared with the facade-resident `code-scope` group). Because Node lib modules must
never `require('../a1-tools.cjs')` (circular require — explicitly forbidden by the M9
plan's ground rules), the facade instead:
1. Lazily `require()`s `product.cjs` **only inside the dispatcher's `else if (group ===
   'product')` branch** (not at file top) — this also means the require cost is paid only
   when `product` subcommands actually run.
2. Immediately calls `product.init({ usage, CODE_SCOPE_STAGES })` — a **module-level
   mutable `let`** inside `product.cjs` gets reassigned from the placeholder
   throw-if-uninitialized stub to the real facade closures.
3. Every `cmdProduct*` function then calls `usage(...)`/`CODE_SCOPE_STAGES` as free
   identifiers, resolved through that module-level `let` at call time.

**Does Pattern A or B fit each of the 14 groups?** Concretely:

- Groups that call `usage(...)` for bad-arg validation → need Pattern B (or the HELP/usage
  extraction alternative below). Grep confirms **all 14 remaining groups call `usage(...)`
  somewhere** except the ones that only call `fail(...)` (already in `io.cjs`, safe to
  import directly) — e.g. `schema-check`, `cost`, `realpath-check`, `phantom`, `pack`
  mostly use `fail`/`process.exit` directly and rarely `usage`; `spec`, `fix`, `analyze`,
  `constitution`, `check`, `checklist`, `worktree`, `pr`, `modernize`, `reconcile`,
  `code-scope` all call `usage(...)` for `--flag` validation errors. This is the dominant
  case, not the exception — **Pattern B (or its fix, see F-011 below) will very likely be
  needed for the majority of the 14 groups**, confirming the RESEARCH prompt's F-011
  concern is exactly on point: this pattern is about to multiply 10+ times, not stay a
  one-off.
- `code-scope` additionally exports `CODE_SCOPE_STAGES` as a value **other modules need**
  (`product.cjs` already consumes it via injection). If `code-scope` itself is extracted
  to `lib/code-scope.cjs`, `CODE_SCOPE_STAGES` should move there as the canonical owner,
  and `product.cjs`'s `init()` call would then import it from `code-scope.cjs` directly
  (`require('./code-scope.cjs').CODE_SCOPE_STAGES`) instead of being facade-injected —
  this actually *simplifies* product.cjs's injection surface by one field.

## F-011 resolution — tighten before it multiplies further

The finding's own recommendation ("pass shared deps as explicit function arguments or a
frozen context object required at module top, rather than module-level mutable `let`")
is the right call, and now is the moment to apply it — before Wave 1 of this phase copies
`init({usage, ...})` into a second, third, fourth module. Concrete design for this phase:

**Option chosen: extract `usage`/`HELP` into their own `lib/help.cjs` module FIRST, before
any of the 14 groups.** This removes the injection need entirely for the dominant case
(groups that only need `usage`):
```js
// lib/help.cjs
'use strict';
const HELP = `...`; // moved verbatim
function usage(msg) {
  process.stderr.write(`error: ${msg}\n\n`);
  process.stderr.write(`${HELP}\n`);
  process.exit(1); // verify exact current behavior before moving — read the real body first
}
module.exports = { usage, HELP };
```
Every extracted group module does a **plain top-level `require('./help.cjs')`** (Pattern
A — no `init()`, no lazy-require, no mutable `let`) since `usage`/`HELP` have zero
dependency on anything facade-specific once extracted. This retires the F-011 coupling
risk for every future group in one move, and lets `product.cjs`'s existing `init()` call
drop the `usage` field (keep `CODE_SCOPE_STAGES` only, or drop that too if `code-scope`
extracts and becomes the canonical owner — see above).

**Residual case:** if any group needs something *not* extractable to a standalone module
(state that's genuinely facade-runtime-only, not a constant), only then fall back to an
explicit context-object parameter threaded through the command functions — not a
module-level `let`. Scan of the 14 groups found no such case: every cross-group need
identified above (`usage`, `HELP`, `CODE_SCOPE_STAGES`) is a pure value/pure-function, not
runtime state, so this residual case is not expected to trigger in this phase, but the
principle should be written into the wave brief for whoever executes it in case something
surfaces on inspection that wasn't visible from static grep.

## Grouping strategy for waves

Ordered by risk (lowest first, matching M9's own wave-by-risk-and-dependency approach),
with natural clusters:

1. **`lib/help.cjs`** (usage + HELP) — must go first; every subsequent group's `usage()`
   calls need it available as a plain import. Zero behavior risk (pure move), but touches
   every dispatcher branch's error path, so verify with the full fixture run, not just the
   moved module's own smoke.
2. **Pure/self-contained, zero cross-group refs, already-fixtured** — lowest risk, do
   together or in quick succession: `schema-check` (271 lines, pure SQL parser, own
   fixture), `cost` (238 lines, pure JSONL aggregator, own fixture), `realpath-check` (226
   lines, own fixture — verify `runGit` isn't a duplicate unsafe git-shell helper before
   moving, see Q2), `phantom` (257 lines, own fixture — verify git-diff collection uses
   safe execFileSync form), `pack` (418 lines, reuses `parseFrontmatter` from `io.cjs`,
   own fixture).
3. **Registry-dependent pair** — `worktree` + `pr` (746 lines combined): already both
   consume `lib/worktree-registry.cjs`, natural single module `lib/worktree.cjs` (or keep
   as two files `worktree.cjs`+`pr.cjs` sharing the registry import — recommend **two
   files**, since `worktree` and `pr` are separate CLI groups with separate fixtures
   `a1-worktree`/`a1-pr-review`, and M9 already treated worktree-registry as the shared
   substrate specifically so the *command* groups could split independently later — this
   phase is exactly that "later").
4. **Reservations-dependent pair** — `check reservations` (124 lines) + `code-scope` (305
   lines): both consume `lib/locks.cjs` directly, share the same `.a1/reservations.json`
   file format, `code-scope` owns `CODE_SCOPE_STAGES` which `product.cjs` needs. Natural
   to extract together or in immediate sequence so the `CODE_SCOPE_STAGES` cross-reference
   is resolved in one pass (update `product.cjs`'s injection at the same time).
5. **`check` (FR-coverage gate, 293 lines) + `checklist` (623 lines)** — no cross-calls
   found between them (verified via grep — `check`'s functions never call
   `cmdChecklist*` or vice versa), but they are conceptually paired (both are
   plan/spec-consistency gates, both parse Markdown wave/FR structures with similar-shaped
   regex helpers: `extractWaveFRs`/`extractWaveBlocks`/`extractWaveDependencies`). Treat as
   **two separate waves** despite the conceptual link — `checklist` alone is 623 lines
   (the single largest group) with `runChecklistChecks` at 246 lines (an F-009 target that
   should be split into parse→compute→format helpers as part of the same wave, per the
   finding's own recommendation — don't just move it 246-lines-intact, that wastes the
   only natural moment to also fix F-009 for this function).
6. **Independent single-file groups** — `spec` (127 lines, smallest, but check
   `appendPhaseHistory`'s real callers first — Q1), `analyze` (467 lines, has fixture),
   `modernize` (565 lines, has fixture, just got HELP text added — re-verify that block
   after move), `reconcile` (540 lines, has fixture + a dedicated `a1-cmd-injection`
   regression fixture for F-015 — this is the group where the most recent security fix
   lives, extract carefully and re-run `a1-cmd-injection` explicitly, not just the general
   gate).
7. **New-fixture groups, highest care** — `fix` (439 lines) and `constitution` (424 lines)
   are the two F-007 targets with **zero existing fixture coverage**. Recommend: **write
   the fixtures FIRST, in a dedicated wave, before extracting these two** (mirrors M9's
   own sequencing note: "split runs LAST so all new features are covered by fixtures
   before the mechanical extraction, and line refs... stayed valid"). Extracting
   untested, stateful, multi-step code (postmortem lifecycle, constitution
   version-archive state machine) with no regression net inverts the risk order the rest
   of this plan otherwise follows.
8. **`main()` dispatcher trim** — after all 14 groups are extracted, `main()`'s 221-line
   if/else chain (F-009) can collapse. Do this as the final wave, mirroring how Wave 9 in
   M9 was the facade-shrinkage-proving step; verify `wc -l` and the "no moved function
   remains in facade" grep-count-0 checks the same way each prior wave did.

**Wave-sizing implication:** given 1 (help) + 5 (pure/self-contained, could be 1-3 waves
depending on agent throughput) + 2 (worktree/pr) + 2 (reservations/code-scope) + 2
(check/checklist) + 4 (spec/analyze/modernize/reconcile) + 1 (fixture-writing) + 2
(fix/constitution extraction) + 1 (dispatcher trim) ≈ **14-18 waves** is a realistic
range, similar order of magnitude to M9's 9 waves but this phase has 3.5x the groups (14
vs 4) — the pure/self-contained cluster (step 2) is the best candidate for combining
multiple groups per wave since they carry the lowest individual risk and have zero
inter-group coupling.

## Fixture requirements for `fix` and `constitution` (F-007)

Both need a `_test-fixtures/a1-fix/run-tests.sh` and
`_test-fixtures/a1-constitution/run-tests.sh` following the two proven house patterns —
`a1-checklist/run-tests.sh` (80 lines, vault-fixture-dir-per-case, good template for
state-machine-style commands with `--vault <path>` flags) and `a1-reconcile/run-tests.sh`
(231 lines, the largest and most recent example, includes the dedicated
`hostile-*` cases the CONVENTIONS.md mandates). Concretely, per CONVENTIONS.md's
mandatory shape:

- `set -u`; `pass=0 fail=0` counters; `assert_rc`-style helper printing `PASS`/`FAIL
  <name>`; final two lines `echo "<suite>: $pass passed, $fail failed"` + `[[ $fail -eq 0
  ]]`.
- All mutable state in `mktemp -d` (never write into the checked-in fixture dir — copy
  fixture data into the temp workdir first, mirroring `_test-fixtures/CONVENTIONS.md`'s
  Isolation section).
- **`fix` group** — cover at minimum: `next-suffix` (happy path numbering),
  `update-status` (valid transition + invalid-status rejection), `find-duplicates` (no
  dupes / has dupes), `integrity-check` (clean state / corrupted-state detection —
  read `cmdFixIntegrityCheck`'s actual body first to know what "corrupted" means for this
  command before writing the case), `init-postmortem` (creates the expected file under
  `postmortemsDir`), `count-postmortems-since` (date-boundary correctness),
  `update-promote-state` (state transition). Hostile inputs: path-traversal on any
  slug/id-shaped flag, oversized value on a free-text flag (e.g. suggestion text),
  injection-shaped string in a value that gets written to a file (assert it's stored
  inertly, never executed).
- **`constitution` group** — cover at minimum: `init` (scaffold), `discover`,
  `update-status`, `set-body`, `next-version` (version-bump arithmetic — this is the
  function most worth unit-style-testing since it's pure string/semver-ish logic),
  `archive-current` (verify it correctly calls `next-version` internally — this is the one
  documented intra-group call, a good regression target), `write-mirror`,
  `link-claudemd`, `list`. Hostile inputs: same 3 categories (path traversal on
  project-slug-shaped flags, injection-shaped body text via `set-body`, oversized body
  text).
- Both suites get picked up automatically by the CI glob `_test-fixtures/*/run-tests.sh`
  (already the canonical name post F-010 rename) — no CI config change needed.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `usage()`/`HELP` extraction (must-go-first step) touches every group's error path | HIGH — a mistake here breaks bad-arg handling across all 14 groups simultaneously, not just one | Extract in its own isolated wave with the full regression gate (all 19 suites, not just a subset) before touching any command group; the M9 "runtime load-proof" pattern (`node -e "require(...)"` beyond `node --check`) is essential here since a forgotten export surfaces as a `ReferenceError` at first `usage()` call, not at parse time |
| `fix`/`constitution` have zero fixture coverage today — extracting them blind has no regression net | HIGH for those 2 groups specifically | Sequence fixture-writing as its own wave BEFORE the extraction wave for these two (per M9's own precedent: "split runs LAST so all new features are covered by fixtures... before the mechanical extraction") |
| `code-scope`'s `CODE_SCOPE_STAGES` is a cross-module dependency already consumed by `product.cjs` via injection | MEDIUM — a naive move could silently break `product stage`/`product markers --set` if the injected value goes stale | Update `product.cjs`'s `init()` call site in the SAME commit that extracts `code-scope`, and re-run the `a1-reservations`+`a1-code-scope`+ product-suite fixtures together, not in isolation |
| `reconcile` carries the most recently patched security fix (F-015, `gitLastTouchIso`) | MEDIUM — a mechanical move that reintroduces a shell-string concatenation (e.g. via copy-paste from an older reference) would silently reopen the CVE-class bug | Explicitly re-run `_test-fixtures/a1-cmd-injection/` (the dedicated regression fixture) after moving `reconcile`, not just the general suite; diff the moved `gitLastTouchIso` body byte-for-byte against pre-move to confirm zero behavior change |
| Partial-extraction mid-wave state (a group half-moved when a wave is interrupted) | MEDIUM — CI red, confusing half-state (some `cmdFix*` in facade, some in `lib/fix.cjs`) | Follow M9's proven **one-commit-per-module** pattern exactly: a wave's commit is atomic (move all functions of ONE group + update facade require + dispatcher + verify `grep -c "^function <name>"` is 0 for every moved name, in one commit); if interrupted mid-wave, `git status`/`git diff` immediately shows whether the working tree is at a clean pre-wave or post-wave state — never commit a partial group |
| `main()`'s 221-line dispatcher becomes the LAST thing touched, but every one of the 14 prior waves edits a section of it (adding the `require`+dispatch lines for that group) | LOW-MEDIUM — 14+ separate edits to the same function across waves is exactly the kind of repeated-touch that risks merge-shaped mistakes even without real branches (sequential waves on main) | Each wave's dispatcher edit should be a small, mechanical, easily-diffable change (mirror the existing `else if (group === 'product') { const product = require(...); ... }` block shape exactly) — review the diff of `main()` specifically at the end of each wave's regression gate, not just the aggregate green/red signal |
| Rollback story per wave | LOW (well-precedented) | Identical to M9: `git revert` on the single wave commit restores the facade to its pre-wave, fully-working state, since the facade's dispatcher + `lib/<group>.cjs` are added/removed atomically per commit |

## Recommendations

1. **Extract `lib/help.cjs` (usage + HELP) as Wave 1**, before any of the 14 command
   groups — this is the F-011 fix, done once, that prevents the injection pattern from
   multiplying 10+ times. Every subsequent group does a plain `require('./help.cjs')`
   (Pattern A), not `init()` injection (Pattern B). Only fall back to Pattern B / an
   explicit context object if a group turns out to need genuine facade-runtime state
   (none identified in this research pass).
2. **Sequence by risk, not by file-declaration order**: pure/self-contained groups with
   existing fixtures first (`schema-check`, `cost`, `realpath-check`, `phantom`, `pack`),
   then the two registry-dependent pairs (`worktree`+`pr`, `check-reservations`+
   `code-scope` — updating `product.cjs`'s injection when `code-scope` moves), then
   `check`+`checklist` (splitting `runChecklistChecks`'s 246 lines into parse/compute/
   format helpers as part of that same wave — don't defer the F-009 fix), then the 4
   remaining independent groups (`spec`, `analyze`, `modernize`, `reconcile` — extra care
   + explicit `a1-cmd-injection` re-run on `reconcile`), then `fix`+`constitution` last
   (fixtures-first sub-wave, then extraction), then the `main()` dispatcher trim as the
   final wave.
3. **Fixtures for `fix`/`constitution` go in their own wave, strictly before those two
   groups' extraction wave** — this is the direct fix for F-007 and gives the riskiest,
   most stateful groups a regression net before they're moved, matching the exact
   sequencing principle M9 itself used for waves 1-5 vs. 6-9.
4. **Resolve `CODE_SCOPE_STAGES` ownership when `code-scope` extracts**: move the const
   into `lib/code-scope.cjs`, have `product.cjs` import it from there instead of via
   facade injection — this simultaneously extracts `code-scope` and shrinks
   `product.cjs`'s `init()` surface, retiring one more piece of the F-011 coupling.
5. **Verify `appendPhaseHistory`'s real callers (Q1) and `realpath-check`'s `runGit`
   (Q2) before wave-planning locks in the `spec` and `realpath-check` wave assignments** —
   both are small open questions from static analysis that a `grep -n "appendPhaseHistory\|runGit("` pass across the WHOLE file (not just the group's own line range) will resolve in under a minute and should happen at plan-time, not execution-time, to avoid a wave discovering a hidden cross-group dependency mid-move.

## Open questions for the planner (Q1/Q2)

- **Q1**: `appendPhaseHistory` (line 322) sits between the `product` and `spec` section
  markers. Confirm via `grep -n "appendPhaseHistory("` across the whole file whether any
  non-spec group calls it — if so, it either needs to move to `io.cjs` (like `parseFlags`/
  `fail` did in M9 Wave 6) or become a `lib/shared-helpers.cjs`-style small module, not
  bundled into `lib/spec.cjs`.
- **Q2**: `realpath-check`'s local `runGit` function (line ~5242, inside the
  `realpath-check` range) — verify it isn't a second, divergent git-shell helper
  duplicating `worktree-registry.cjs`'s `git`/`gitSafe`. If it predates the F-015 fix and
  still builds a shell string, this is itself a latent F-015-class finding that should be
  fixed (via `a1-fix`) in the same pass as its extraction, not carried into `lib/`
  unchanged.

## Key File References

- `/Users/rob/code/a1-skills/_shared/a1-tools.cjs` — the facade, 7196 lines, all 14
  group boundaries listed in the table above (line numbers verified against this exact
  file state; **re-verify by function name, not line number, before executing** — every
  wave shifts subsequent line numbers, per M9's own ground rule)
- `/Users/rob/code/a1-skills/_shared/lib/io.cjs`, `locks.cjs`, `worktree-registry.cjs`,
  `product.cjs` — the 4 existing M9 modules; `product.cjs` is the only one using the
  `init()` injection pattern (lines 32-40) and is the direct precedent for the F-011 fix
  above
- `/Users/rob/code/a1-skills/_test-fixtures/CONVENTIONS.md` — mandatory fixture shape +
  hostile-input requirement (path traversal / injection-shaped input / oversized values)
- `/Users/rob/code/a1-skills/_test-fixtures/a1-checklist/run-tests.sh` (80 lines) and
  `/Users/rob/code/a1-skills/_test-fixtures/a1-reconcile/run-tests.sh` (231 lines) — the
  two best templates for the new `a1-fix`/`a1-constitution` suites
- `/Users/rob/code/a1-skills/.a1/phases/M9-robustness/PLAN.md` — Waves 6-9, the exact
  mechanical-move pattern (module-local free-identifier verification, `node --check` +
  runtime `require()` load-proof + facade smoke test, one-commit-per-module, "Commit
  before starting Wave N+1") to replicate wave-by-wave in this phase
- `/Users/rob/code/a1-skills/.a1/phases/M9-robustness/VERIFICATION.md` — shows the
  goal-backward SC verification shape this phase's own VERIFICATION.md should follow,
  including the re-baselining lesson (SC-4's line-reduction bar was pinned to a
  planning-time snapshot and had to be corrected against the real pre-split commit — this
  phase's planner should bar the reduction target against the CURRENT 7196-line HEAD, not
  M9's 7148 figure, to avoid repeating that exact mistake)
- `/Users/rob/code/a1-skills/.a1/learnings/projects/a1-specforge/analyses/2026-07-12-quality.md` —
  source findings F-006, F-007, F-009, F-011 (plus F-008, already fixed, and F-015,
  already fixed — both confirmed resolved during this research pass)
- `/Users/rob/code/a1-skills/bin/install.sh:64` — symlinks the whole `_shared/` directory
  (`symlink_item "$REPO_DIR/_shared" "$SKILLS_DIR/_shared" "_shared"`), so no install-script
  change is needed as new `lib/*.cjs` files are added (confirmed same as M9's finding for
  this file)
