# STATUS — M9-robustness

## Wave 1 — Lock hardening + fixture convention (cluster 4 + 3a/3b)
Completed: 2026-07-11

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 Atomic lock reclaim + comment fix | ✓ DONE | 9a8da95 | `acquireReservationsLock` stale-reclaim now tmp-write + renameSync + read-back-verify; `product-docs/run.sh:850` comment fixed to `process.ppid`. |
| 1.2 CONVENTIONS.md + CONTRIBUTING link + README count | ✓ DONE | d79b879 | New `_test-fixtures/CONVENTIONS.md`; CONTRIBUTING.md "Test fixtures" subsection; README fixture count 13 → 19. |

### Deviations
None — both tasks executed exactly as specified in the plan, no bugs, type errors, or missing imports encountered.

### Verification
- Task 1.1 done-when: `OK`
- Task 1.2 done-when: `OK`
- Full regression gate (both tasks): `ALL-SUITES-GREEN`

✓ Task 1.1 Atomic lock reclaim + comment fix — 9a8da95 — Wave 1
✓ Task 1.2 CONVENTIONS.md + CONTRIBUTING link + README count — d79b879 — Wave 1

## Wave 2 — `check reservations --release` (cluster 3c)
Completed: 2026-07-11

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1 Implement `--release` in `cmdCheckReservations` + fixtures | ✓ DONE | 6a416c6 | `--release` branch added before the existing claim logic: requires `--by`, optional `--claim`; foreign claim → `FORBIDDEN` + exit 1; no match → idempotent exit 0; own-claim/bulk-by-spec release writes `{ ...data, reservations: remaining }` (spread, not rebuild) so `code_scopes` entries survive. HELP updated. 6 new fixture cases incl. 2 hostile-input cases. |

### Deviations
- [Minor, test-portability] The plan's hostile-release-overlong case suggested no specific bounding mechanism beyond "must not hang"; `timeout`/`gtimeout` are not present on stock macOS (confirmed via `which timeout`/`which gtimeout` → not found), so the fixture bounds the call with a background job + poll-loop + `kill -9` fallback (10s ceiling) instead, preserving the same intent (never left running, exit captured or treated as failure) without adding a coreutils dependency.

### Verification
- Task 2.1 done-when: `OK` (`_test-fixtures/a1-reservations/run.sh` → `22 passed, 0 failed`; `check reservations --release --by nobody --file /tmp/m9-none.json` → `"idempotent": true`)
- Full regression gate (Wave 2): `ALL-SUITES-GREEN`

✓ Task 2.1 Implement `--release` in `cmdCheckReservations` + fixtures — 6a416c6 — Wave 2

## Wave 3 — `worktree adopt` (cluster 1a)
Completed: 2026-07-11

| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 `worktree adopt <repo-root> <slug>` subcommand + fixtures | ✓ DONE | (see commit below) | `cmdWorktreeAdopt` added after `cmdWorktreeGc`; matches an out-of-band `git worktree` by `--worktree-path` / `--branch` / slug-basename priority, builds a registry entry (`status: active`) from git truth, guards against an existing active entry and an already-registered worktree path. Dispatcher + HELP updated. 12 new fixture cases (happy path, adopt-then-exit-handoff, duplicate refused, nonexistent/NOT_FOUND, 2 hostile-input cases). |

### Deviations
- [Rule 1, bug found during execution] The plan's literal spec for the candidate filter/match used plain `path.resolve()` to compare CLI-arg worktree paths against `git worktree list --porcelain` output. On macOS, `mktemp -d` returns a path under the `/var/...` symlink while git's porcelain output reports the realpath `/private/var/...`, so the exact-match comparisons (repoRoot-exclusion filter, `--worktree-path` matching, duplicate-path guard) spuriously failed with `NOT_FOUND` in the fixture environment. Added a local `resolveRealOrAbs()` helper (`fs.realpathSync` with a `path.resolve` fallback when the path doesn't exist yet) and used it in the three path-comparison spots. Behavior for existing/absolute non-symlinked paths is unchanged; this only fixes the symlink-realpath mismatch. Logged in `observations.jsonl` (pattern: `vague_action`).
- [Fixture correction] The plan's oversized-slug hostile case implied exit 2 (invalid slug), but `SLUG_RE` (`^[a-z0-9][a-z0-9-]*$`) has no length bound, so an all-lowercase 10000-char slug is syntactically valid and correctly falls through to the normal `NOT_FOUND` path (exit 1) rather than the invalid-slug path (exit 2). Adjusted the fixture assertion to accept exit ∈ {1,2} plus "no hang", matching actual correct behavior instead of a specific exit code that doesn't match the real control flow. Logged in `observations.jsonl` (pattern: `vague_action`).
- Note: running the full fixture suite incidentally rewrote timestamps in two pre-existing `a1-reconcile` fixture data files (`single-missing`/`single-pass` `drift-2026-05-13.md`) — this is a pre-existing test-isolation issue in that unrelated suite (in-place fixture mutation), not caused by or related to Task 3.1. Reverted those files with `git checkout --` before committing; out of scope to fix here.

### Verification
- Task 3.1 done-when: `OK` (`_test-fixtures/a1-worktree/run-tests.sh` → `34 passed, 0 failed`; `grep -q "worktree adopt" _shared/a1-tools.cjs` → match)
- Full regression gate (Wave 3): `ALL-SUITES-GREEN`

✓ Task 3.1 `worktree adopt` subcommand + fixtures — (commit SHA below) — Wave 3

## Wave 4 — `worktree reconcile` (cluster 1b)
Completed: 2026-07-11

| Task | Status | Commit | Notes |
|---|---|---|---|
| 4.1 `worktree reconcile <repo-root>` subcommand + fixtures | ✓ DONE | b197a03 | `cmdWorktreeReconcile` added after `cmdWorktreeAdopt`; diffs registry vs `git worktree list` both directions (stale registry entries missing on disk; unregistered git worktrees as adopt candidates). Read-only by default, mutates only with `--prune` (mirrors `cmdWorktreeGc`'s cleaned-status pattern). Dispatcher + HELP updated. 5 new fixture cases (in-sync, candidate-detection-with-unchanged-registry-proof, stale dry-run, prune, hostile inputs incl. nonexistent repo-root and missing positional arg). |

### Deviations
- [Rule 1, known-bug reuse] The plan's literal spec for reconcile's path comparisons used plain `path.resolve()`. Per the Wave-3 precedent (same macOS `/tmp` vs `/private/tmp` symlink-realpath mismatch documented there), used the existing `resolveRealOrAbs()` helper (introduced in Wave 3, already in the facade) for all three path-comparison spots (stale-entry disk/git match, adopt-candidate registry match) instead. Without this, in-sync worktrees created under `mktemp -d` would spuriously show up as both stale AND as adopt candidates in the fixture environment. Logged in `observations.jsonl` (pattern: `vague_action`).
- [Fixture correction] `reconcile-prune-pruned-contains-id` initially used a single-line grep pattern (`"pruned": \[.*<id>`) against pretty-printed multi-line JSON, which never matches across a newline. Fixed by flattening the output (`tr -d '\n'`) before the grep. Caught immediately by the fixture run itself (1 failure out of 48), no plan/spec ambiguity involved — pure test-authoring fix, not logged as a separate observation.
- [Fixture correction] The plan's hostile-input suggestion ("nonexistent repo-root" / "missing arg") was verified against actual exit codes rather than assumed: missing `<repo-root>` goes through `usage()` → exit 1 (not 2); a resolvable-but-non-git-repo path goes through the explicit `gitIsRepo` check → exit 2. Fixture asserts the verified codes.
- Post-full-suite-run note: as in Wave 3, running the complete fixture suite incidentally touched timestamps in the unrelated `a1-reconcile` fixture data files (`single-missing`/`single-pass` `drift-2026-05-13.md`) — pre-existing test-isolation issue in that suite, reverted with `git checkout --` before committing, out of scope here.

### Verification
- Task 4.1 done-when: `bash _test-fixtures/a1-worktree/run-tests.sh | tail -1 | grep -q "0 failed" && node _shared/a1-tools.cjs worktree reconcile /Users/rob/code/a1-skills >/dev/null` → `DONE-WHEN-OK` (48 passed, 0 failed)
- Full regression gate (Wave 4): `ALL-SUITES-GREEN`

✓ Task 4.1 `worktree reconcile` subcommand + fixtures — b197a03 — Wave 4

## Wave 5 — pr-review fallback + skill docs (cluster 1c/1d)
Completed: 2026-07-11

| Task | Status | Commit | Notes |
|---|---|---|---|
| 5.1 `pr findings-summary --worktree-path` fallback + fixture | ✓ DONE | ec4a6d4 | `cmdPrFindingsSummary` switched from positional `args[0]` to `parseFlags`/`flags._[0]`; new `--worktree-path` direct-path branch (no registry entry needed) returns `{ id: null, slug: basename, worktree_path, source: 'direct-path', ... }`, byte-identical missing-findings message reused; existing registry-path branch behavior and output shape unchanged (no `source` key added there). HELP line updated. Fixture converted to the `pass=0 fail=0` counter convention (was ad-hoc `pass()`/`fail()` + `set -euo pipefail`, no machine-parseable summary line) and extended with `findings-direct-path`, hostile `--worktree-path '../../nonexistent'`, and an explicit positional-slug-still-wired regression case (11 cases total, 0 failed). |
| 5.2 a1-worktree skill docs for adopt/reconcile | ✓ DONE | 27762c6 | New `skills/a1-worktree/workflows/04-adopt-reconcile.md` (mirrors `01-prepare.md` layout: When to use, Step 1 Adopt, Step 2 Reconcile, Hard rules). `SKILL.md` Phases table gained row 4 (Adopt/Reconcile) + a routing bullet + a recovery note ("no registry entry" → `worktree adopt`). |
| 5.3 a1-pr-review skill fallback docs | ✓ DONE | a214b79 | `workflows/01-detect.md` gained a `### Fallback: no handoff entry` section after step 1.6 (adopt-first preferred path; read-only `pr findings-summary --worktree-path` alternative; explicit note that `mark-status`/`mark-pr-open` always require a registry entry). `SKILL.md` description (Detect phase, ~line 5) and "When NOT to use" section (~line 49) each got a one-line fallback pointer to `workflows/01-detect.md`. |

### Deviations
- [Rule 4 boundary interpretation, in-scope] Task 5.1's fixture (`_test-fixtures/a1-pr-review/run-test.sh`) did not follow the `pass=0 fail=0` counter + last-line-summary convention documented in `_test-fixtures/CONVENTIONS.md` (Wave 1) — it used `set -euo pipefail` with ad-hoc `pass()`/`fail()` echo helpers and a final `"All tests passed."` line, which does not satisfy the plan's own done-when (`tail -1 | grep -q "0 failed"`). Converted the whole file to the standard counter/summary pattern (all 8 pre-existing test bodies kept byte-identical in behavior, only the pass/fail bookkeeping and `set -u` vs `set -euo pipefail` changed) so the new cases could be added consistently and the task's own done-when check is satisfiable. This was necessary to complete Task 5.1 as specified, not a scope expansion — logged as a deviation for traceability, not written to observations.jsonl (pure test-infra convention alignment, not a code/plan defect).
- Post-full-suite-run note (recurring, same as Waves 3-4): running the complete fixture suite again incidentally touched timestamps in the unrelated `a1-reconcile` fixture data files (`single-missing`/`single-pass` `drift-2026-05-13.md`) both times the gate was run in this wave. Reverted with `git checkout --` before each commit; already logged as a `fixture-isolation` note in `observations.jsonl` during Wave 4, not re-logged here.

### Verification
- Task 5.1 done-when: `OK` (`_test-fixtures/a1-pr-review/run-test.sh` → `11 passed, 0 failed`; positional-slug check → `no registry entry for` reached, not a usage error)
- Task 5.2 done-when: `OK` (`skills/a1-worktree/workflows/04-adopt-reconcile.md` exists; `grep -q "adopt" skills/a1-worktree/SKILL.md` matches)
- Task 5.3 done-when: `OK` (`grep -q "worktree adopt" skills/a1-pr-review/workflows/01-detect.md` matches; `grep -qi "fallback" skills/a1-pr-review/SKILL.md` matches)
- Full regression gate (Wave 5, run after each task): `ALL-SUITES-GREEN`

✓ Task 5.1 `pr findings-summary --worktree-path` fallback + fixture — ec4a6d4 — Wave 5
✓ Task 5.2 a1-worktree skill docs for adopt/reconcile — 27762c6 — Wave 5
✓ Task 5.3 a1-pr-review skill fallback docs — a214b79 — Wave 5

## Wave 6 — Module split 1/4: `_shared/lib/io.cjs` (cluster 2a)
Completed: 2026-07-12

| Task | Status | Commit | Notes |
|---|---|---|---|
| 6.1 Extract core I/O + flag parsing to `_shared/lib/io.cjs` | ✓ DONE | (see commit below) | Pure mechanical move of `vaultRoot`, `resolveVaultPath`, `parseFrontmatter`, `serializeScalar`, `detectKeyOrder`, `serializeFrontmatter`, `readMd`, `writeMdAtomic`, `nowIso`, `writeTextAtomic`, `parseScalarToken`, `parseNestedFrontmatter`, `serializeNestedFrontmatter`, `writeNestedMdAtomic`, `parseFlags`, `fail` into new `_shared/lib/io.cjs` (own `fs`/`path`/`os` requires), plus the module-local `_vaultRootAnnounced` flag and the 5 KEY_ORDER consts (`SPEC_KEY_ORDER`, `BUG_KEY_ORDER`, `ANALYSIS_KEY_ORDER`, `CONSTITUTION_KEY_ORDER`, `RECONCILE_KEY_ORDER`) that `detectKeyOrder` needs. Facade now destructure-requires all 16 names from `lib/io.cjs` via an `__dirname`-relative require. `usage` (depends on `HELP`) and the two PRODUCT-KEY_ORDER consts stayed in the facade per plan. Facade shrank 9584 → 9008 lines (576 lines). |

### Deviations
- [Rule 2, self-caused during this task] The mechanical big-block cut (awk splice of lines 270-841) initially over-deleted `PRODUCT_ROADMAP_KEY_ORDER`/`PRODUCT_FEATURE_KEY_ORDER` — both explicitly required by the plan to stay in the facade (they sat inside the deleted range but are NOT part of the io.cjs move). Caught immediately by the `product-adopt` fixture suite (`internal error: PRODUCT_ROADMAP_KEY_ORDER is not defined`, 24/33 cases failing) during the full regression gate — not by `node --check` (syntax-valid, runtime-only ReferenceError). Re-added both consts immediately after the new `lib/io.cjs` require block in the facade; re-ran the full done-when and full regression gate, both green. Logged in `observations.jsonl` (pattern: `vague_action`). This is exactly the class of bug the plan's runtime-load-proof done-when step is designed to catch, and it worked as intended.
- Pre-existing, unrelated: as in Waves 3-5, running the full fixture suite touches timestamps in `_test-fixtures/a1-reconcile/{single-missing,single-pass}/vault/projects/demo/drift-2026-05-13.md` (known test-isolation issue in that suite, out of scope here). Reverted with `git checkout --` before committing, not re-logged (already logged in Wave 4).

### Verification
- Task 6.1 done-when: `OK` (`node --check` both files; `node -e "require(...)"` runtime-load-proof both files; facade smoke `check reservations --list` from `/tmp` outside repo cwd; `grep -c "^function parseFrontmatter" _shared/a1-tools.cjs` → 0)
- Full regression gate (Wave 6, re-run after the Rule-2 fix): `ALL-SUITES-GREEN`

✓ Task 6.1 Extract core I/O + flag parsing to `_shared/lib/io.cjs` — (commit SHA below) — Wave 6
