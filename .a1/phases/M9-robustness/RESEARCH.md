---
goal: 4 robustness clusters (worktree adopt/reconcile, a1-tools.cjs split, hostile-input fixtures + reservations --release, lock-reclaim race + comment/code divergence)
generated: 2026-07-11
---

# Research: M9-robustness

## Tech Stack

- Runtime: Node.js (CommonJS, zero npm dependencies — see comment at `_shared/a1-tools.cjs:1825`).
- Single CLI entrypoint: `_shared/a1-tools.cjs`, **9294 lines**, dispatched via `node _shared/a1-tools.cjs <group> <sub> ...args`. This exact invocation is referenced from every `SKILL.md`/workflow file — the CLI surface (`group`/`sub` names, flag names, JSON output shape) must not change during the split.
- Test harness: 19 bash fixture suites under `_test-fixtures/*/run*.sh` (some named `run.sh`, one `run-tests.sh`), each spins up ephemeral temp dirs/git repos and asserts exit codes + JSON fields via `assert_rc`/`assert_true`-style helpers. Run all via `README.md:140`: `for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done`.
- Repo file-size convention: 800 lines max (per user's global coding-style rule) — `a1-tools.cjs` at 9294 lines is ~11.6x over.

## Relevant Codebase Patterns

### 1. Worktree registry & lifecycle (`_shared/a1-tools.cjs:4828-5319`)

- Registry file: `~/.a1-worktrees-registry.json` (env override `A1_WORKTREE_REGISTRY`, resolved in `worktreeRegistryPath()` at `4835`).
- Registry schema per entry (built in `cmdWorktreePrepare`, `4941-5052`): `{ id, slug, repo_root, worktree_path, branch, base_branch, status, created_at, last_status_change, agent_brief, commit_count, exit_mode, phase_history[] }`.
- Statuses: `WORKTREE_STATUSES = new Set(['prepared', 'active', 'handoff', 'cleaned'])` (`4830`).
- `cmdWorktreePrepare` (`4941`) is the **only** way an entry is created — checks (in order): slug regex, repo is git, working tree clean, base branch exists, target branch free-or-worktreeless, **worktree_path_free** (`4992-4998`, fails hard if the target dir already exists on disk), **no_active_registry_entry** (`5000-5010`). There is no path for "a worktree already exists on disk outside the registry, please adopt it" — `prepare` will always FAIL on `worktree_path_free` for that case, and there is no other entrypoint to create a registry row.
- `cmdWorktreeExit` (`5151-5255`) requires `entry.status !== 'cleaned'`, looks up by `findRegistryEntry(reg, id)` (`4927`) — an id that does not exist in the registry hard-errors (`5166-5169`, exit 1). This is the exact failure mode from the incident: worktree existed via `git worktree add` outside a1, `a1-worktree exit` has no matching registry id.
- `gitWorktreeList(repoRoot)` (`4906-4921`) already exists and parses `git worktree list --porcelain` into `[{path, branch}]` — this is the primitive needed for both `adopt` and `reconcile`; it is currently only used by `gitBranchHasWorktree` (`4923`) inside `prepare`'s branch check.
- `cmdWorktreeGc` (`5291-5319`) is the closest existing "registry vs. reality" reconciliation, but it only goes one direction: registry entries whose `worktree_path` is **missing on disk** get marked `cleaned`. It never looks at `git worktree list` output, and never handles worktrees that exist on disk **but have no registry entry at all** (the opposite direction needed for `adopt`/`reconcile`).
- `findEntryBySlugOrId(reg, slugOrId)` is referenced in `cmdPrMarkStatus`/`cmdPrMarkPrOpen`/`cmdPrFindingsSummary` (`5395-5480`) but not shown in the grep of definitions above — search for `function findEntryBySlugOrId` before modifying pr commands; it is the lookup helper the planner should reuse for any adopt-by-slug logic.
- `writeRegistryAtomic(reg)` (`4856-4861`): tmp-file + `fs.renameSync` pattern — reuse this for any new adopt/reconcile write path, do not invent a new write helper.

### 2. `a1-pr-review` hard dependency on registry (`skills/a1-pr-review/SKILL.md`)

- Line 5: "Detect (scan a1-worktree registry for `handoff`)" — detection phase is registry-only, no fallback.
- Line 41-44: expected chain is `a1-new-feature → a1-worktree (enter/exit handoff) → a1-pr-review`.
- Line 49: explicit precondition "Worktrees still `active` — must exit to `handoff` via a1-worktree first."
- Line 80: state table — worktree status lives *only* in `~/.a1-worktrees-registry.json`; review findings/PR draft live in `<worktree>/.a1-review/`.
- Line 108: "Never write `~/.a1-worktrees-registry.json` directly. CLI only." (this constraint must be preserved by whatever fallback is added).
- CLI-side: `cmdPrListHandoff` (`5370-5393`) filters `reg.worktrees` by `status === 'handoff'` — a worktree with no registry entry is invisible to this command by construction. `cmdPrFindingsSummary` (`5453-5480`) requires `findEntryBySlugOrId` to succeed before it will even look at `<worktree_path>/.a1-review/findings.json`.
- **Fallback requirement from the phase goal:** allow `a1-pr-review` to operate given a directly-specified branch/path, bypassing the registry lookup. This likely needs a new flag path through `cmdPrFindingsSummary`/`cmdPrMarkStatus`/`cmdPrMarkPrOpen` (e.g. `--worktree-path` instead of `<id-or-slug>`) plus a SKILL.md fallback phase description — but if `adopt` (see cluster 1) is implemented, the simpler fix may be "adopt first, then registry path works unchanged." Flag this tradeoff explicitly for the planner to decide.

### 3. `a1-tools.cjs` internal structure (line-range map for splitting)

Section markers found via `grep -n "^// ----------"`:

| Range | Section | Notes |
|---|---|---|
| 166-354 | requires + `vaultRoot()`/`resolveVaultPath()` | shared, needed by nearly every group |
| 359-598 | frontmatter parser (line-based, minimal) + `readMd`/`writeMdAtomic`/`writeTextAtomic`/`nowIso` | shared helper — used by product, spec, fix, analyze, constitution, reconcile, modernize |
| 599-843 | nested-frontmatter helpers (`parseNestedFrontmatter`, `serializeNestedFrontmatter`, `writeNestedMdAtomic`) | shared |
| 843-1177 | product roadmap read/regenerate/changelog helpers (`readProductRoadmap`, `readProductFeature`, `regenerateDerived`, `appendChangelogEntry`, `assertSlug`, `productDirFromFlags`, `writeAllOrNothing`, `buildRoadmapWritesWithChangelog`) | product-group-specific but `writeAllOrNothing` (`1073`) and `assertSlug` (`1046`) look reusable — check callers before moving |
| 1178-2434 | `cmd_Product*` command functions (status, stage, markers, changelog, init, add-milestone, add-feature, feature-init) + legacy-roadmap import/parse helpers (2013-2365) | candidate module: `product.cjs` |
| 2436-2464 | `parseFlags` (shared flag parser) | must stay in a shared module — used by every `cmd*` function across all groups |
| 2464-2582 | spec subcommands (`cmdSpecNextNumber`, `cmdSpecUpdateStatus`, `cmdSpecList`) | candidate module: `spec.cjs` |
| 2582-2760 | fix subcommands | candidate module: `fix.cjs` |
| 2760-3021 | fix learning-loop subcommands (postmortem, integrity-check, promote-state, write-suggestion) — uses `crypto` inline (`2788`, `2808`) | keep with `fix.cjs` or split further if it grows |
| 3021-3488 | analyze subcommands (next-slot, init, update-status, discover, add-finding(s), list) — `cmdAnalyzeDiscover` uses `execSync` inline (`3331`) | candidate module: `analyze.cjs` |
| 3488-3912 | constitution subcommands | candidate module: `constitution.cjs` |
| 3912-4205 | check subcommand (consistency gate) — `cmdCheckRun` (not shown above, search for it) owns its own exit code | candidate module: `check.cjs` |
| 4205-4828 | checklist subcommands | candidate module: `checklist.cjs` |
| 4828-5321 | **worktree subcommands** (see cluster 1 above) — also defines `execFileSync`, `SLUG_RE`, `git()`, `gitIsRepo`, `gitWorkingTreeClean`, `gitBranchExists`, `gitWorktreeList`, `gitBranchHasWorktree` (git-shell helpers, reused nowhere else currently but `pr` group also touches the same registry) | candidate module: `worktree.cjs`; **`pr` group (5370-5481) reads the same registry via `readRegistry()`/`findRegistryEntry()`/`findEntryBySlugOrId()` — these two groups are coupled and should probably ship in the same module or worktree.cjs must export its registry helpers for pr.cjs to `require()`** |
| 5482-6040 | modernize subcommands | candidate module: `modernize.cjs` |
| 6040-6583 | reconcile subcommands | candidate module: `reconcile.cjs` |
| 6583-7489 | unmarked/mixed section — contains schema-check, cost, phantom, pack groups per the `main()` dispatcher; section boundaries not consistently commented — **re-grep `^function cmd` in this range before splitting**, do not rely solely on the `// ----------` markers here |
| 7489-7716 | `check reservations` (P7 cross-run registry) — `reservationsFile`, `loadReservations`, `writeJsonAtomic`, `acquireReservationsLock`, `releaseReservationsLock`, `exitWithLock`, `failWithLock`, `isLockStale`, `isPidDead`, `sleepSyncMs`, `cmdCheckReservations` | **this lock/reservation machinery is shared infra used by `product`, `code-scope`, and `check reservations` itself** — must land in a shared module (e.g. `_shared/reservations-lock.cjs`), not inside any single command-group file |
| 7716-8029 | code-scope subcommands (claim, stage, release, list, check) — reuses `reservationsFile`/`loadReservations`/`acquireReservationsLock` from the reservations section above | candidate module: `code-scope.cjs`, depends on the shared reservations-lock module |
| 8031-8040 | `usage()`, `fail()` — tiny shared error helpers, used everywhere | shared module |
| 8042-9082 | `HELP` text constant + (per earlier grep) pack subcommands, additional helpers | candidate module: `pack.cjs` + shared `HELP` string (must be reassembled from per-group help fragments if split, or kept centrally and imported by the dispatcher) |
| 9083-9292 | `main()` — the dispatcher itself | becomes the **thin dispatcher** file; must keep `group`/`sub` string matching 100% identical (these strings are the CLI's public contract) |

**Shared helpers used across ≥2 groups (must go in a common module, referenced by relative `require()` from each split file):**
- `parseFlags` (`2438`)
- `nowIso`, `writeMdAtomic`, `writeTextAtomic`, `readMd`, frontmatter parser (`359-598`)
- `vaultRoot`, `resolveVaultPath` (`294`, `354`)
- `usage`, `fail` (`8031`, `8037`)
- `writeJsonAtomic`, `acquireReservationsLock`, `releaseReservationsLock`, `exitWithLock`, `failWithLock`, `reservationsFile`, `loadReservations`, `isLockStale`, `isPidDead`, `sleepSyncMs` (`7499-7656`) — needed by `product` (`1219` etc.), `code-scope` (`7869` etc.), and `check reservations` itself
- `git`, `gitIsRepo`, `gitWorkingTreeClean`, `gitBranchExists`, `gitWorktreeList`, `gitBranchHasWorktree`, `readRegistry`, `writeRegistryAtomic`, `findRegistryEntry`, `findActiveBySlug`, `findEntryBySlugOrId`, `nowCompactId`, `repoParentWorktreeDir` — needed by both `worktree` and `pr` groups

**Split strategy recommendation (risk-minimizing):**
1. Extract shared helpers first into `_shared/a1-tools-lib/` (e.g. `frontmatter.cjs`, `atomic-io.cjs`, `reservations-lock.cjs`, `worktree-registry.cjs`, `flags.cjs`) — pure `require()`/`module.exports`, no behavior change.
2. Extract command-group files one at a time (`spec.cjs`, `fix.cjs`, ... `pack.cjs`), each `require()`-ing only the shared helpers it needs, each exporting a `{ [subcommandName]: cmdFn }` map or similar.
3. Rewrite `main()` in `a1-tools.cjs` as a thin dispatcher that `require()`s each group module lazily (only load the module for the invoked `group`) and forwards to it — preserves `node _shared/a1-tools.cjs <group> <sub> ...` exactly.
4. After **each** extraction step, run the full fixture suite (`for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done`) before proceeding to the next group — do not batch multiple group extractions into one commit given the "all 19 suites must stay green" constraint.
5. Do the `worktree`+`pr` pair together (step 2) since they share the registry helpers — splitting them into fully separate files with no shared module would duplicate ~500 lines of registry logic.

### 4. Hostile-input fixture convention — currently undocumented

- Searched `CONTRIBUTING.md`, `README.md`, `docs/roadmap.md` for any "fixture convention" / "hostile input" section — **none exists**. `CONTRIBUTING.md` only documents skill-file structure (SKILL.md/workflows/templates/agents) and the Gate-Pack contribution flow; it says nothing about `_test-fixtures/` conventions at all.
- `_test-fixtures/` has no top-level README either (`find _test-fixtures -maxdepth 1 -iname "README*"` → empty).
- 19 fixture directories exist today (`_test-fixtures/*/`), each with `run.sh` or `run-tests.sh` (`a1-worktree` uses `run-tests.sh`, most others use `run.sh` — the loop in README.md:140 uses the glob `run*.sh` to catch both).
- Existing fixtures do test some adversarial cases already — e.g. `_test-fixtures/product-docs/run.sh:820-871` tests stale-lock-with-dead-pid, live-pid-blocks, and corrupt-JSON-payload lock recovery (good precedent for the security fixture style/format: `assert_rc`, `assert_true`, elapsed-time assertions). This is a good template to point the planner at for "how a hostile-input case should look" even though it's not adversarial-input in the RCE/traversal sense.
- **Action needed:** decide *where* to document the "hostile inputs" fixture requirement. Given CONTRIBUTING.md is the existing contribution-process doc and already has a "Modifying an existing skill" section, the natural spot is either (a) a new `## Fixture conventions` section in `CONTRIBUTING.md`, or (b) a new `_test-fixtures/README.md`. No existing precedent favors one over the other — planner should pick one and be explicit in the task.
- **Note:** the RCE-via-`new Function` and path-traversal findings referenced in the phase goal were **not found in the current `_shared/a1-tools.cjs`** (`grep -rn "new Function"` across the repo returns zero hits, and the only `path.resolve(flags.*)` call sites found at `4993`/`5271`/`7377`/`7406`/`8919`/`9008` resolve caller-supplied paths without an obvious traversal guard, but none currently pair with `new Function`/`eval`). Two possibilities: (a) the vulnerable code was on an uncommitted/unshared local branch and already reverted, or (b) it lives in a file this research pass didn't inspect (e.g. a skill template, `bin/install.sh`, or a pack file). **Planner must re-confirm the exact file/line with whoever ran the review before writing remediation tasks** — do not assume `a1-tools.cjs` is (still) the vulnerable file.

### 5. `check reservations --release` — missing subcommand

- `cmdCheckReservations` (`7658-7714`) supports only `--claim`/`--by` (create-or-idempotent-confirm) and `--list` (`7667-7671`). There is no `--release` flag and no code path that removes an entry from `data.reservations` for the `check reservations` command.
- Contrast: `code-scope release` **does** exist (`cmdCodeScopeRelease`, `7952-7973`) — takes `--by <feature-id>`, acquires the lock via `acquireReservationsLock(file)`, filters out matching `type === 'code_scope'` entries, writes atomically, releases lock. This is the exact pattern to mirror for `check reservations --release`.
- Both commands operate on the same underlying file (`.a1/reservations.json`, resolved via `reservationsFile(flags)` at `7499`) but with different `type` filters — `code-scope release` filters `r.type === 'code_scope'`, a new `check reservations --release` would need to filter by the scalar `<type>:<value>` claim shape (`{ type, value, by, at }`, built at `7708`).
- **Incident context from phase goal:** "today an obsolete reservations.json had to be discarded manually via rm" — implies the *file* needed clearing, not just one reservation entry; consider whether the new subcommand should support releasing (a) a single `--claim <type>:<value>`, (b) all reservations `--by <spec-id>`, or (c) explicitly note that wiping the whole file remains a manual `rm .a1/reservations.json` operation (arguably fine, low risk, atomic writes mean it's always safe to delete and let the next command recreate it empty via `loadReservations`'s `!fs.existsSync` branch at `7504`).

### 6. Lock-reclaim race (rename vs. unlink+open) — `_shared/a1-tools.cjs:7600-7630`

- Current `acquireReservationsLock` (`7600-7630`) flow on `EEXIST`: calls `isLockStale(lockPath)` (`7563-7587`); if stale, does `fs.unlinkSync(lockPath)` (`7614`) then `continue`s the loop to retry `fs.openSync(lockPath, 'wx')` on the **next** iteration. Between the `unlinkSync` and the next `openSync('wx')`, there is a window where **two concurrent processes that both observed the same stale lock can both successfully `unlink` (one will throw ENOENT on the second unlink, already caught at `7615-7617` as "already gone") and then both race for the `wx` open** — but note: `fs.openSync(path, 'wx')` is itself atomic (fails with EEXIST if the file exists), so a second process that unlinked-then-opened *should* still be safe against a third process, **unless** two processes both pass `isLockStale` before either unlinks, both unlink (one silently no-ops), and then **both** proceed to the `wx` open in the same or next loop iteration — the `wx` flag guarantees only one open succeeds at the OS level, so the actual race window is narrower than "two processes hold the lock simultaneously". Reinhard's review (per phase goal, 2026-07-11) describes it as: two processes can both observe staleness and both attempt reclaim in the same instant — the fix requested is **atomic rename-based reclaim** instead of unlink-then-open, i.e. write a new lock file with a unique tmp name, then `fs.renameSync(tmpLockPath, lockPath)` which atomically replaces the target on POSIX (this closes the unlink→open gap because there is no gap: the content and the acquisition happen in the same syscall). Compare to the already-atomic pattern used elsewhere in this same file: `writeRegistryAtomic` (`4856-4861`) and `writeJsonAtomic` (`7514-7520`) both use `tmp + renameSync` — the fix should follow that exact established pattern, applied to `acquireReservationsLock`'s stale-reclaim branch (`7612-7619`).
- Node.js `fs.renameSync` on POSIX systems is atomic when source and destination are on the same filesystem (standard `rename(2)` guarantee) — this holds for the reclaim case since the tmp lock file and the target lock file are both in the same directory (`path.dirname(file)`, `7601`).
- Fixture coverage to extend: `_test-fixtures/product-docs/run.sh:820-871` already has 3 cases (dead-pid reclaim succeeds+fast, live-pid still blocks, corrupt-payload reclaim succeeds) — a 4th case for "concurrent reclaim by two processes" would need actual process concurrency (e.g. two backgrounded `node ... &` invocations racing on the same stale lock) to be a meaningful regression test; a single-process sequential fixture cannot exercise the true race. Flag this for the planner: a robust fixture here may require `wait`/background subshells in bash, more complex than the existing sequential cases.

### 7. Comment/code divergence — `_test-fixtures/product-docs/run.sh`

- Line 850 comment: `# Case B: lock owned by a LIVE pid (this test script's own $$, guaranteed`
- Line 857 code: `fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.ppid || process.pid, createdAt: new Date().toISOString() }));` — uses `process.ppid || process.pid` (the *parent* pid of the inline `node -e` subprocess, i.e. the bash script's own pid, since `node -e` is spawned as a child of the bash script) rather than `$$` (bash's own pid variable, which is never actually passed into this `node -e` invocation — no `"$$"` appears in the arg list at line 858, only `"$LOCK_FILE"`).
- Functionally the code is *correct* (using `process.ppid` inside the spawned node process does resolve to the bash script's pid, which is alive for the test's duration) — the bug is purely that the comment claims `$$` is used when actually `process.ppid` is used. Fix is a one-line comment edit at `run.sh:850` to say `process.ppid` instead of `$$`, or (alternative, more literal fix) actually pass `"$$"` as an explicit `node -e` argument and use `process.argv[N]` instead of `process.ppid` — planner should pick the smaller-diff option (comment fix) unless there's a reason to prefer explicit pid-passing.

## External Dependencies

None — the CLI is dependency-free by design (comment at `_shared/a1-tools.cjs:1825`). No package.json dependency table applies to this phase; all 4 clusters are internal refactors/additions.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Splitting a1-tools.cjs breaks one of the 19 fixture suites silently (module load order, circular `require()`, or a helper accidentally left non-exported) | HIGH | Extract one command-group at a time; run full fixture suite after each extraction, not just at the end; keep `main()`'s group/sub string matching byte-identical |
| `worktree`/`pr` groups share undocumented implicit coupling via the registry file — splitting them into fully separate modules without a shared registry helper module will duplicate lock-free registry read/write logic and risk drift | MED | Put `readRegistry`/`writeRegistryAtomic`/`findRegistryEntry`/`findEntryBySlugOrId`/git-helpers in one shared module both `worktree.cjs` and `pr.cjs` require() |
| `worktree adopt` writing a synthetic registry entry for a worktree that was created with unusual flags (e.g. non-standard branch naming, worktree outside `repoParentWorktreeDir`) could silently misrepresent `base_branch`/`branch_ahead` fields that downstream commands (`status`, `exit`) rely on | MED | Adopt should shell out to `git worktree list --porcelain` + `git rev-parse` to fill fields from git truth, not prompt/guess; validate against `gitWorktreeList` output before writing |
| The RCE (`new Function`)/path-traversal findings referenced in the phase goal were not located in the current codebase during this research pass | HIGH (blocks cluster 3 task-writing until resolved) | Planner must get the exact file/line from Reinhard's 2026-07-11 review before writing remediation tasks — do not guess a target file |
| `check reservations --release` semantics ambiguous (single claim vs. all claims by spec-id vs. whole-file wipe) — matching the wrong granularity could make manual `rm` still necessary for some cases | LOW | Mirror `code-scope release --by <feature-id>` pattern (release-all-by-owner) as the primary mode; document that whole-file wipe remains `rm .a1/reservations.json` (already safe, self-healing on next read) |
| True concurrent-reclaim race in `acquireReservationsLock` is hard to reproduce in a sequential bash fixture | LOW | Rename-based fix removes the theoretical gap regardless of whether a regression fixture can prove it; treat the fixture as nice-to-have, not blocking |

## Recommendations

1. **Cluster 2 (split) should be sequenced last or in parallel-but-isolated**, since it touches every other cluster's implementation surface. If clusters 1/3/4 land first against the monolith, cluster 2 becomes a pure mechanical extraction with a bigger regression net (more fixture cases covering the exact behavior to preserve). If order flexibility doesn't matter to the roadmap, do the split first while the file is simpler.
2. **For cluster 1**, implement `worktree adopt <repo-root> <worktree-path> [--branch <name>] [--base <name>]` that: validates the path is a real git worktree via `gitWorktreeList(repoRoot)` (reuse existing helper at `4906`), synthesizes a registry entry via the same shape `cmdWorktreePrepare` builds (`5019-5034`) but with `status: 'active'` and a `phase_history` entry noting `phase=adopt`, and writes via the existing `writeRegistryAtomic`. Add `worktree reconcile [--dry-run]` (parallel to `cmdWorktreeGc`'s existing structure at `5291`) that diffs `git worktree list` against the registry in **both directions**: registry-says-exists-but-gone (already handled by `gc`) and disk-says-exists-but-not-in-registry (new — the adopt gap).
3. **For cluster 1's `a1-pr-review` fallback**, add an optional `--worktree-path <path>` / `--branch <name>` flag to `cmdPrFindingsSummary`/`cmdPrMarkStatus`/`cmdPrMarkPrOpen` that bypasses `findEntryBySlugOrId` and operates directly on `<path>/.a1-review/findings.json`, with a clear SKILL.md addition documenting this as the explicit escape hatch (keep the "CLI only, never write registry directly" rule for the registry-backed path).
4. **For cluster 3 (hostile-input fixtures)**, before writing tasks, get the exact vulnerable file/line from the source review (not found in this pass) — otherwise the executor has nothing concrete to patch. Once located, follow the `product-docs/run.sh:820-871` fixture style (bash + inline `node -e` + `assert_rc`/`assert_true`) as the house style for adversarial-input fixtures. Document the "hostile inputs" requirement in `CONTRIBUTING.md` under a new section (simplest, single-file change, already the canonical contribution doc) rather than a new `_test-fixtures/README.md`.
5. **For cluster 3's `check reservations --release`**, implement as `check reservations --release --by <spec-id>` filtering `data.reservations` by `by === <spec-id>` (matching `code-scope release`'s pattern at `7952-7973`, including the `acquireReservationsLock`/`writeJsonAtomic`/lock-release sequence) rather than by `--claim <type>:<value>` alone, since the incident was "an entire obsolete reservations.json", implying spec-scoped bulk release is the more useful primitive; keep `--claim` as an optional additional filter for surgical single-claim release.
6. **For cluster 4's lock-reclaim fix**, change `acquireReservationsLock`'s stale branch (`7612-7619`) from `unlinkSync` + loop-retry-open to: write `{pid, createdAt}` to a uniquely-named tmp file in the same directory, then `fs.renameSync(tmp, lockPath)` — this is a same-file-family change to an already-well-commented function; preserve the existing extensive doc-comments (`7589-7599`) and update them to describe the new atomic-rename behavior.
7. **For cluster 4's comment fix**, it's a single-line edit at `_test-fixtures/product-docs/run.sh:850` — trivial, can be bundled into the same commit as the lock-reclaim fix since both touch the same lock-machinery area of the codebase.

## Key File References

- `/Users/rob/code/a1-skills/_shared/a1-tools.cjs` — the monolith; all line numbers above refer to this file (as read during this research pass; re-verify line numbers before executing, since cluster 2's split will shift them and other clusters landing first will shift them too)
- `/Users/rob/code/a1-skills/skills/a1-pr-review/SKILL.md` — registry dependency documentation, needs the fallback-path addition
- `/Users/rob/code/a1-skills/skills/a1-worktree/` — likely needs a new `workflows/*.md` step for `adopt`/`reconcile` (not read in this pass — check existing workflow file numbering before adding)
- `/Users/rob/code/a1-skills/CONTRIBUTING.md` — target for the new "Fixture conventions / hostile inputs" section
- `/Users/rob/code/a1-skills/_test-fixtures/a1-worktree/run-tests.sh` — 213 lines, existing worktree fixture suite (happy path, blockers, discard-refuses-with-commits, list+filter, duplicate-prepare-refused, gc-clean-slate) — extend with adopt/reconcile cases
- `/Users/rob/code/a1-skills/_test-fixtures/a1-reservations/run.sh` — existing reservations fixture suite, extend with `--release` cases
- `/Users/rob/code/a1-skills/_test-fixtures/product-docs/run.sh:820-871` — stale-lock fixture style reference + the `$$`/`process.ppid` divergence at line 850/857
- `~/.a1-worktrees-registry.json` — the real registry file (env override `A1_WORKTREE_REGISTRY`); already contains one real entry from a prior niimo worktree run (status `cleaned`) — do not assume this file is empty in dev/testing
- `/Users/rob/code/a1-skills/README.md:137-140` — documents the fixture-suite-count and run-all-loop; **update the "13 fixture test suites" text if wrong** (actual count found: 19 directories, matching the phase-goal description, so README's "13" figure is already stale — flag as a possible drive-by fix, not in scope unless planner wants it)
