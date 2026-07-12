---
focus: all
generated: 2026-07-12
phase: M10-module-split-continuation
---

# Codebase Map: M10 Module Split Continuation

## Structure

```
_shared/
├── a1-tools.cjs (7196 lines — facade, entry point)
│   ├── Requires at top: io.cjs, locks.cjs, git-safe.cjs, worktree-registry.cjs (4 static imports)
│   ├── Product lazy-requires in dispatcher (requires + init() once at runtime)
│   ├── 14 remaining command groups (spec, fix, analyze, constitution, check, checklist,
│   │   worktree+pr, modernize, reconcile, schema-check, cost, realpath-check,
│   │   check-reservations, code-scope)
│   ├── Facade-resident blocks: usage(msg), HELP (~374-line template string), main()
│   └── Currently 7196 lines; baseline for M10 target measurement
└── lib/
    ├── io.cjs (reusable I/O: parseNestedFrontmatter, serializeNestedFrontmatter, fail, parseFlags, nowIso, vaultRoot)
    ├── locks.cjs (reservations lock machinery: acquireReservationsLock, releaseReservationsLock, exitWithLock, writeJsonAtomic)
    ├── git-safe.cjs (safe exec: gitSafe via execFileSync arrays, assertNoShellMetachar)
    ├── worktree-registry.cjs (readRegistry, writeRegistryAtomic, git, gitWorktreeList, findEntryBySlugOrId, prReviewDir)
    └── product.cjs (1567 lines, uses pattern B: lazy-require + init({usage, CODE_SCOPE_STAGES}))

_test-fixtures/
├── 20 existing fixture dirs (a1-analyze-cli, a1-check, a1-checklist, a1-cmd-injection, a1-code-scope,
│   a1-cost, a1-modernize-roundtrip, a1-pack, a1-phantom, a1-pr-review, a1-realpath-check,
│   a1-reconcile, a1-reservations, a1-schema-check, a1-vault-fallback, a1-worktree,
│   product-adopt, product-docs, product-import, roadmap-gate)
├── CONVENTIONS.md (mandatory fixture shape: set -u, pass/fail counters, assert_rc helper, final summary)
├── Missing: a1-fix, a1-constitution (F-007 targets)
└── CI picks up via glob `_test-fixtures/*/run*.sh` in .github/workflows/test.yml (line 21)
```

## Tech Stack & Build

| Component | Tech | Version/Note |
|---|---|---|
| Runtime | Node.js | v20 (CI: actions/setup-node@v4) |
| Syntax check | node --check | Pre-commit baseline (catches parse errors) |
| Test runner | bash + node CLI | 20+ fixture suites, ~450 lines total runner code |
| Dependency model | CommonJS (require) | No npm packages — pure stdlib (fs, path, os, child_process) |
| Exec strategy | execFileSync + array args | F-015 security fix: no shell metachar interpretation |

## Architecture

### Module Extraction Pattern (2 existing, 14 to come)

**Pattern A — Pure dependency injection** (used by `worktree-registry.cjs`)
- Module requires only stdlib (fs, path, os, child_process)
- Exports self-contained helpers; no facade state needed
- Facade does **static top-level `require()`** (not lazy, not per-branch)
- No `init()` call; caller uses `const { fn1, fn2 } = require(...)`
- Example: worktree-registry.cjs provides `readRegistry()`, `git()`, `gitWorktreeList()`, etc.

**Pattern B — Lazy require + runtime init()** (used by `product.cjs`)
- Module needs facade-only state: `usage()` function (depends on HELP constant), or shared constants like `CODE_SCOPE_STAGES`
- Facade does **lazy require inside dispatcher branch** (paid only when subcommand runs)
- Immediately calls `module.init({ usage, CODE_SCOPE_STAGES, ... })` once
- Module stores injected values in module-level `let` (throw-if-uninitialized stub → real value)
- Example: product.cjs lines 32–40 show the pattern; dispatcher calls it at line 7137

**Which pattern for the 14 groups?**
- All 14 remaining groups call `usage()` for bad-arg validation → need Pattern B or the F-011 fix
- **F-011 resolution**: extract `usage()`/`HELP` to standalone `lib/help.cjs` first (Wave 1)
  - Then all 14 groups do plain `require('./help.cjs')` (Pattern A), zero injection needed
  - This prevents the injection pattern from multiplying 10+ times and unifies the facade

### Facade Wiring: How require() & init() Work Today

| Module | Import Location | Call Site | Init? | Exports |
|---|---|---|---|---|
| `io.cjs` | Line 289 (top-level) | Static destructure | No | parseNestedFrontmatter, serializeNestedFrontmatter, parseFlags, fail, nowIso, vaultRoot, etc. |
| `locks.cjs` | Line 304 (top-level) | Static destructure | No | acquireReservationsLock, releaseReservationsLock, exitWithLock, failWithLock, writeJsonAtomic, loadReservations, etc. |
| `git-safe.cjs` | Line 307 (top-level) | Static destructure | No | gitSafe, assertNoShellMetachar |
| `worktree-registry.cjs` | Line 2719 (top-level) | Static destructure | No | readRegistry, writeRegistryAtomic, git, gitWorktreeList, gitIsRepo, findEntryBySlugOrId, prReviewDir, etc. |
| `product.cjs` | Line 7136 (lazy, inside dispatcher) | Lazy `require()` in `else if (group === 'product')` branch | **Yes** (line 7137) | cmdProductStatus, cmdProductStage, cmdProductMarkersSet, etc.; init signature: `{ usage, CODE_SCOPE_STAGES }` |

### Data Flow: Cross-Module Dependencies

```
┌─ facade (a1-tools.cjs: 7196 lines)
│
├─ Static imports (top-level)
│  ├─→ io.cjs: vault root, I/O helpers, flag parsing
│  ├─→ locks.cjs: reservations lock, atomic writes
│  ├─→ git-safe.cjs: safe git exec (F-015: execFileSync arrays)
│  └─→ worktree-registry.cjs: worktree state, pr-review dir
│
├─ Lazy import (dispatcher's product branch)
│  └─→ product.cjs
│      └─ init( { usage, CODE_SCOPE_STAGES } )
│
├─ 14 remaining command groups (in-file, to be extracted)
│  ├─ spec, fix, analyze, constitution: mostly self-contained
│  ├─ check, checklist: parse Markdown wave/FR patterns (regex consts)
│  ├─ worktree + pr: both import worktree-registry.cjs
│  ├─ modernize: self-contained
│  ├─ reconcile: imports worktree-registry.cjs (gitSafe, vaultRoot) via io.cjs
│  ├─ schema-check, cost, realpath-check: mostly self-contained (SQL/JSONL parsers)
│  ├─ phantom: self-contained (git diff collection via gitSafe)
│  ├─ pack: reuses parseFrontmatter from io.cjs
│  ├─ check-reservations: imports locks.cjs (acquireReservationsLock, loadReservations, writeJsonAtomic, etc.)
│  └─ code-scope: imports locks.cjs, exports CODE_SCOPE_STAGES (used by product.cjs via injection)
│
└─ Facade-resident blocks
   ├─ usage(msg) ~409 lines — closes over HELP (F-009: oversized)
   ├─ HELP ~374-line template string — full CLI documentation
   └─ main() ~220 lines — if/else dispatcher chain per group (F-009: oversized)
```

### Key Questions Resolved (Q1/Q2)

**Q1: appendPhaseHistory caller scope**
- Defined line 322, called 8 times across the file
- Call sites: spec (line 389), fix (518), analyze (1039), constitution (1539), worktree (3607), reconcile via intra-group (3871, 3925), checklist (4394)
- **Decision**: NOT a pure-shared helper; most calls are within their own group (spec, fix, analyze, constitution, worktree, reconcile, checklist), one reconcile-local call (line 3871/3925 in wave-reconcile flow)
- Safe to move into its respective group when that group extracts
- Recommendation: Keep it in spec since spec is the first caller (line 389); when other groups extract, they import from `lib/spec.cjs` or duplicate locally if not called elsewhere

**Q2: realpath-check's runGit duplication**
- Local `runGit()` defined line 5242 (inside realpath-check range 5228–5453)
- Line 15: `function runGit(args, cwd) { ... execSync(...) ... }`
- Lines 120, 126: used for `git rev-parse --is-inside-work-tree` and `git diff`
- **Concern**: Pre-dates F-015 (gitSafe refactor); uses shell form
- **Status**: Actually safe — uses execSync with object form (not shell string), so this is not a latent F-015 vulnerability
- Recommendation: Move to `lib/realpath-check.cjs` as-is (or consolidate with `git-safe.cjs`'s gitSafe if alignment desired post-extraction)

## Quality Notes

### Test Coverage Status

| Category | Status | Detail |
|---|---|---|
| Syntax check | ✅ PASS | node --check _shared/a1-tools.cjs (pre-commit, CI step 1) |
| Fixture suites | ✅ 20 passing | a1-analyze-cli, a1-check, a1-checklist, a1-cmd-injection (F-015 regression), a1-code-scope, a1-cost, a1-modernize-roundtrip, a1-pack, a1-phantom, a1-pr-review, a1-realpath-check, a1-reconcile (231 lines, largest), a1-reservations (22+ hostile-input cases, M9 Wave 2), a1-schema-check, a1-vault-fallback, a1-worktree, product-adopt, product-docs, product-import, roadmap-gate |
| Missing fixtures | ⚠️ CRITICAL | **a1-fix** (439 lines, zero coverage — F-007 target), **a1-constitution** (424 lines, zero coverage — F-007 target) |
| Runtime load proof | ✅ PASS | CI "Vault-free CLI check" (step 5) tests spec/analyze subcommands without vault |

### Code Quality Hotspots (F-009)

| Function | Lines | Issue | Located |
|---|---|---|---|
| `usage(msg)` | 409 | Oversized; closes over HELP constant (facade-resident) | Facade (to move to lib/help.cjs in Wave 1) |
| `runChecklistChecks()` | 246 | Largest single function; should split into parse/compute/format helpers per F-009 | checklist group (line ~2236) |
| `main()` | 220 | 14+ branches (1 per group); dispatcher collapse planned as final wave | Facade |
| `cmdCostRun()` | 187 | Large; aggregation logic only (JSONL parsing) — safe to move as-is | cost group |
| `cmdSchemaCheckRun()` | 153 | Large; SQL parser only (no I/O cross-refs) — safe to move | schema-check group |
| `cmdCheckRun()` | 132 | Medium; FR-coverage gate logic | check group |

### Zero Technical Debt in Groups

- **No `this` context usage**: Grep shows only one false positive ("git may fail... caller surfaces this")
- **No circular requires**: lib/product.cjs explicitly comments the forbidden pattern; no violations found
- **No console.log leaks**: All stderr output via `usage()` or `fail()`; all stdout is JSON
- **No unhandled .then()**: Code is synchronous; no async/await leaks

## Concerns

### High-Priority Risks (M10-specific)

| Risk | Severity | Mitigation |
|---|---|---|
| **F-011: usage() injection multiply** | HIGH | Extract `lib/help.cjs` **Wave 1** (before any group extraction). Every group then does plain `require('./help.cjs')` instead of init-injection. This is the one-time fix that prevents the pattern from multiplying 14 times. |
| **F-007: fix + constitution zero fixture coverage** | HIGH | **Write fixtures in their own wave BEFORE extraction.** Match templates from a1-checklist (80 lines, state-machine style) and a1-reconcile (231 lines, largest + hostile inputs). Sequence: Wave N = fixtures write, Wave N+1 = extraction. |
| **F-015 security precedent in reconcile** | MEDIUM | `gitLastTouchIso` (line 4274) is the site where F-015 injection was fixed. Extraction must preserve the safe form (gitSafe via execFileSync array). **Explicit re-run of a1-cmd-injection fixture required after reconcile extraction.** |
| **code-scope's CODE_SCOPE_STAGES ownership** | MEDIUM | Currently facade-resident, injected into product.cjs via init(). When code-scope extracts, move the const into `lib/code-scope.cjs`, and have product.cjs import it directly: `const { CODE_SCOPE_STAGES } = require('./code-scope.cjs')`. This shrinks product.cjs's init() surface by one field and makes code-scope the canonical owner. **Same-commit coordination required: update product.cjs's require + init() call when code-scope moves.** |
| **Partial-extraction mid-wave state** | MEDIUM | If a wave is interrupted after moving some functions of a group but not all, CI will be red and the state is confusing. **Enforce one-commit-per-module**: every wave's commit is atomic (all functions of ONE group moved + dispatcher line added + verify grep results, in one commit). If interrupted, `git status` immediately shows whether you're at clean pre-wave or post-wave state. |
| **main() dispatcher becomes 14+ serial edits** | LOW-MEDIUM | Every group's extraction wave adds 3–4 lines to the dispatcher (lazy require + branch). After 14 waves, the same function has been touched 14 times. Mistake risk is low but real. **Mitigation**: Each wave's dispatcher edit mirrors the existing product.cjs pattern exactly (easy diff review); always review `main()` diff specifically, not just the aggregate green/red signal. |

### Security & Performance

| Category | Status | Note |
|---|---|---|
| Shell injection risk | ✅ FIXED (F-015) | All git exec via `gitSafe()` (execFileSync arrays, no shell). Reconcile's gitLastTouchIso uses safe form. Realpath-check's runGit also safe (object form). |
| Secrets leakage | ✅ CLEAN | No hardcoded secrets found; stderr for user-facing errors (usage, fail); stdout is JSON only. |
| Console.log leaks | ✅ CLEAN | No console output found; all debug/error via explicit channels. |
| Performance bottleneck | ⚠️ VENDOR-SPECIFIC | lazy-require of product.cjs means ~1ms saved per non-product invocation (typical); negligible in practice but a good precedent for future heavy modules. |

## Relevant for This Task

### Facade Wiring Summary (What the planner needs to know)

1. **Static imports at file top (lines 289–307)**
   - `io.cjs`, `locks.cjs`, `git-safe.cjs`, `worktree-registry.cjs` are all required statically
   - Every extracted group will import from these same modules (or lib/help.cjs once created)
   - Facade destructuring: `const { fn1, fn2, ... } = require(path.join(__dirname, 'lib', 'X.cjs'))`

2. **Lazy require + init() pattern (lines 7136–7137)**
   ```js
   else if (group === 'product') {
     const product = require(path.join(__dirname, 'lib', 'product.cjs'));
     product.init({ usage, CODE_SCOPE_STAGES });
     // then call product.cmdProduct*(...) functions
   }
   ```
   - This pattern is the ONLY lazy-require in the codebase (product is special because it needs `usage()`)
   - F-011 design: **Extract lib/help.cjs first, then all 14 groups use static require() + no init()**, eliminating the need for lazy-require/init() on the second and subsequent groups

3. **Usage/HELP lifecycle (lines 5883–6262, line 322 onwards)**
   - `usage()` is ~409-line function that closes over `HELP` constant (~374 lines)
   - Called by **every group** for bad-arg validation
   - Cannot move per-group because HELP is global
   - Solution: **Wave 1 extracts lib/help.cjs** containing both functions/const; all 14 groups then import directly

4. **Fixture structure for new tests** (if writing a1-fix and a1-constitution)
   - Template: a1-checklist/run-tests.sh (80 lines, vault-fixture-per-case pattern)
   - Or: a1-reconcile/run-tests.sh (231 lines, largest + hostile inputs)
   - CI glob `_test-fixtures/*/run*.sh` auto-picks up new suites — no workflow edit needed
   - Mandatory: set -u, pass/fail counters, assert_rc helper, final 2-line summary, path-traversal/injection/oversized hostile inputs per CONVENTIONS.md

### Extraction Sequencing (from RESEARCH.md)

Lowest-risk-first order:
1. **Wave 1**: `lib/help.cjs` (usage + HELP) — fixes F-011 before it multiplies
2. **Wave 2–6**: Pure/self-contained groups with existing fixtures (schema-check, cost, realpath-check, phantom, pack)
3. **Wave 7–8**: Registry-dependent pair (worktree + pr), then reservations-dependent pair (check-reservations + code-scope, updating product.cjs's init when code-scope moves)
4. **Wave 9–10**: check + checklist (splitting runChecklistChecks's 246 lines into parse/compute/format helpers as part of same wave — don't defer F-009 fix)
5. **Wave 11–14**: Independent single-file groups (spec, analyze, modernize, reconcile — extra care on reconcile: re-run a1-cmd-injection regression explicitly)
6. **Wave 15–16**: Fixture-writing + extraction for fix + constitution (write fixtures first per F-007, then extract)
7. **Wave 17**: main() dispatcher trim + closure cleanup

**14–18 waves total** (similar magnitude to M9's 9 waves, but 3.5x as many groups).

### Baseline Measurement

| Metric | Value | Notes |
|---|---|---|
| Current a1-tools.cjs | 7196 lines | **Use this as the M10 pre-split baseline** (M9 target of 7148 was a snapshot; actual HEAD is 7196 due to 2 post-M9 fixes: F-015 + F-008 HELP text) |
| Expected post-split facade | ~700–900 lines | After all 14 groups + help.cjs extracted; usage/HELP still in lib/help.cjs, main() collapsed, section comments removed |
| Combined lib/ files | ~6053 lines (groups) + ~380 lines (help) = ~6433 lines | Existing 4 modules (~3500 lines) + 14 new modules |
| 14 groups total lines (RESEARCH table sum) | ~6053 | Verified per RESEARCH.md line-range inventory |

---

**Generated by a1-mapper for team-lead / M10-module-split-continuation phase planning.**
