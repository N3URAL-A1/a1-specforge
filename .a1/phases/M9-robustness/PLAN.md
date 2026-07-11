---
phase: M9-robustness
goal: Harden the a1 tooling — worktree adopt/reconcile + pr-review fallback, first clean module split of a1-tools.cjs behind a stable facade, hostile-input fixture convention + reservations --release, atomic lock reclaim
spec: inline (4 robustness clusters, see RESEARCH.md)
project: a1-specforge
waves: 9
status: revised
created: 2026-07-11
revised: 2026-07-11
audit_incorporated: AUDIT.md v1 — 3 MAJOR (M1 slug positional access, M2 io.cjs free-identifier list, M3 split done-when runtime load-proof) eingepflegt; Wave-Struktur unverändert
code_scope:
  - _shared/a1-tools.cjs
  - _shared/lib/
  - _test-fixtures/CONVENTIONS.md
  - _test-fixtures/a1-reservations/run.sh
  - _test-fixtures/a1-worktree/run-tests.sh
  - _test-fixtures/product-docs/run.sh
  - CONTRIBUTING.md
  - README.md
  - skills/a1-worktree/SKILL.md
  - skills/a1-worktree/workflows/
  - skills/a1-pr-review/SKILL.md
  - skills/a1-pr-review/workflows/01-detect.md
---

# Plan: M9-robustness

> **Revision (2026-07-11):** Die 3 MAJOR-Findings aus `AUDIT.md` v1 wurden gezielt eingepflegt —
> M1 (Task 5.1: positionaler slug über `flags._[0]` statt `args[0]`, exakte fail-Meldung),
> M2 (Wave 6: vollständige, namentliche Liste der mitzuziehenden modul-lokalen Konstanten/Flags),
> M3 (Wave 6–9: done-when zusätzlich mit echtem Modul-Load + Facade-Smoke, nicht nur `node --check`).
> Wave-Struktur und alle übrigen Tasks sind unverändert.

## Goal
Harden the a1 tooling: (1) adopt/reconcile for out-of-band git worktrees + a1-pr-review fallback, (2) first module split of the 9294-line `a1-tools.cjs` into `_shared/lib/` behind a byte-stable CLI facade, (3) documented hostile-input fixture convention + `check reservations --release`, (4) atomic lock-reclaim + comment fix.

## Executor ground rules (apply to EVERY task)

- **CLI contract is frozen.** `node _shared/a1-tools.cjs <group> <sub> ...` — group names, subcommand names, flag names, JSON output shapes of EXISTING commands must not change. New subcommands/flags are additive only.
- **Full regression gate after every task that touches `_shared/`:**
  ```bash
  cd /Users/rob/code/a1-skills && node --check _shared/a1-tools.cjs && \
  ok=1; for r in _test-fixtures/*/run*.sh; do bash "$r" >/dev/null || { echo "SUITE FAILED: $r"; ok=0; break; }; done; [[ $ok -eq 1 ]] && echo ALL-SUITES-GREEN
  ```
  A task is only done when this prints `ALL-SUITES-GREEN`.
- **One commit per task**, conventional commits (`feat(a1-tools): ...`, `refactor(a1-tools): ...`, `test(fixtures): ...`, `docs: ...`).
- Line numbers below were verified against commit-state 2026-07-11 (file HEAD ≈ 3dbeee7, 9294 lines). Earlier waves shift later line numbers — always locate by **function name** first (`grep -n "^function <name>" _shared/a1-tools.cjs`), use line numbers only as orientation.
- Never require `a1-tools.cjs` from a lib module (no circular requires). Lib modules may require sibling lib modules.

## Success Criteria (binary)

- [ ] SC-1: `worktree adopt` registers an existing on-disk git worktree as `status: active` from git truth; `worktree exit --mode handoff` works on the adopted entry afterwards.
- [ ] SC-2: `worktree reconcile` reports both directions (stale registry entries; unregistered git worktrees as adopt candidates) and only mutates the registry with `--prune`.
- [ ] SC-3: `pr findings-summary --worktree-path <path>` works without any registry entry; a1-pr-review SKILL.md + 01-detect.md document the fallback (adopt-first for status writes, direct path for read-only summary).
- [ ] SC-4: `_shared/lib/{io,locks,worktree-registry,product}.cjs` exist; `a1-tools.cjs` shrinks by ≥ 2500 lines; all 19 fixture suites green after EACH extraction commit (verifiable via git history: one commit per module, each CI-green).
- [ ] SC-5: `_test-fixtures/CONVENTIONS.md` exists with a mandatory "Hostile inputs" section; CONTRIBUTING.md links to it.
- [ ] SC-6: `check reservations --release` releases own claims, refuses foreign claims (exit 1), is idempotent on missing claims (exit 0), with fixture coverage incl. hostile inputs.
- [ ] SC-7: `acquireReservationsLock` stale-reclaim uses tmp-write + `renameSync` + read-back-verify (no unlink+open gap); existing 3 stale-lock fixture cases stay green.
- [ ] SC-8: Comment at `_test-fixtures/product-docs/run.sh:850` matches the code (`process.ppid`, not `$$`).

---

## Wave 1 — Lock hardening + fixture convention (cluster 4 + 3a/3b)
`depends_on: []` — Tasks 1.1 (code) and 1.2 (docs only) touch disjoint files; parallel-safe.
**Suggested agent:** a1-walter-web-developer (tight brief: Node CLI, zero deps, no API redesign).

### Task 1.1: Atomic lock reclaim + comment fix
**Goal:** Two processes observing the same stale lock can never both believe they hold it; fixture comment matches code.
**Actions:**
1. In `_shared/a1-tools.cjs`, function `acquireReservationsLock` (locate via `grep -n "^function acquireReservationsLock" _shared/a1-tools.cjs`, ~7600). Replace the stale-reclaim branch (currently `if (isLockStale(lockPath)) { try { fs.unlinkSync(lockPath); } catch ... } continue; }`, ~7612-7619) with an atomic rename reclaim:
   ```js
   if (isLockStale(lockPath)) {
     // Atomic reclaim: write our payload to a unique tmp file, then
     // renameSync over the stale lock (atomic replace on POSIX — same
     // pattern as writeJsonAtomic). Then read back and verify our pid
     // actually won: if another reclaimer renamed after us, their payload
     // is in place and we lost — retry instead of proceeding.
     const tmpLock = `${lockPath}.reclaim.${process.pid}.${attempt}`;
     try {
       fs.writeFileSync(tmpLock, JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
       fs.renameSync(tmpLock, lockPath);
     } catch (_e2) {
       try { fs.unlinkSync(tmpLock); } catch (_e3) { /* best effort */ }
       continue;
     }
     let winner = null;
     try { winner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_e4) { /* raced */ }
     if (winner && winner.pid === process.pid) return lockPath;
     continue; // lost the reclaim race — another live holder now owns the lock
   }
   ```
2. Update the doc comment above `acquireReservationsLock` (~7589-7599): replace the sentence "if stale, deletes it and retries the acquire immediately" with a description of the tmp-write + atomic-rename + read-back-verify reclaim. Keep the rest of the comment intact.
3. Fix `_test-fixtures/product-docs/run.sh` line 850: change `# Case B: lock owned by a LIVE pid (this test script's own $$, guaranteed` to `# Case B: lock owned by a LIVE pid (process.ppid inside the node -e child = this test script's pid, guaranteed`. Code stays untouched — it is correct.
4. Note (decision, no action): a true concurrent-reclaim race is not black-box testable in a sequential bash fixture; the existing 3 cases at `product-docs/run.sh:820-871` (dead-pid reclaim fast, live-pid blocks, corrupt payload reclaim) ARE the regression net and must stay green. Do NOT add a background-process race fixture.
**Done when:**
```bash
grep -q "renameSync(tmpLock, lockPath)" _shared/a1-tools.cjs && ! grep -q 'this test script.s own \$\$' _test-fixtures/product-docs/run.sh && bash _test-fixtures/product-docs/run.sh >/dev/null && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`.
**Covers:** SC-7, SC-8

### Task 1.2: `_test-fixtures/CONVENTIONS.md` + CONTRIBUTING link + README count
**Goal:** Fixture conventions (incl. mandatory hostile-input tests) are documented in one canonical file.
**Actions:**
1. Create `_test-fixtures/CONVENTIONS.md` with exactly these sections:
   - `# Fixture Suite Conventions` — intro: every CLI change needs fixture coverage; suites live at `_test-fixtures/<suite>/run*.sh` (most `run.sh`; `a1-worktree` uses `run-tests.sh`, `a1-pr-review` uses `run-test.sh`); run all via `for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done`.
   - `## Runner pattern` — document (with a short bash snippet copied from `_test-fixtures/a1-reservations/run.sh:14-30`): `set -u`; `pass=0 fail=0` counters; `assert_rc`/`assert_true`-style helpers printing `PASS`/`FAIL  <name>`; last two lines are `echo "<suite>: $pass passed, $fail failed"` and `[[ $fail -eq 0 ]]` (exit 0 = all green, 1 = any failure).
   - `## Isolation` — all mutable state goes into `mktemp -d`; CI additionally runs with `HOME=$(mktemp -d)`; original fixture data is immutable; JSON assertions via `node -e` to avoid shell quoting.
   - `## Hostile inputs (mandatory)` — **every new CLI subcommand must ship at least one rejection test** covering, where applicable: (a) path traversal (`../../etc/passwd`, absolute paths where relative expected), (b) injection-shaped input (`; rm -rf /`, `$(...)`, backticks, `<script>` — must be treated as inert strings, never evaluated), (c) oversized values (≥ 10 000 chars — must fail fast or handle gracefully, never hang/crash). Expected behavior: non-zero exit + clear stderr, OR safe inert handling — assert one of the two explicitly. Reference example: the stale-lock cases at `_test-fixtures/product-docs/run.sh:820-871` show the house style. Context note: the historical traversal findings were fixed in commit d639b8e — this section exists so regressions are caught, not to fix anything.
2. In `CONTRIBUTING.md`, add under the existing "Modifying an existing skill" section (locate via `grep -n "Modifying" CONTRIBUTING.md`) a new subsection `### Test fixtures` with 2-3 lines: any change to `_shared/a1-tools.cjs` requires fixture coverage per `_test-fixtures/CONVENTIONS.md`, including the mandatory hostile-input case for new subcommands.
3. In `README.md` (~line 137-140, locate via `grep -n "fixture" README.md`): if a stale suite count (e.g. "13") is stated, update it to "19" (verify: `ls -d _test-fixtures/*/ | wc -l`).
**Done when:**
```bash
grep -q "Hostile inputs" _test-fixtures/CONVENTIONS.md && grep -q "CONVENTIONS.md" CONTRIBUTING.md && echo OK
```
**Covers:** SC-5

---

## Wave 2 — `check reservations --release` (cluster 3c)
`depends_on: [W1]` (same file region as Task 1.1 — sequenced to avoid conflicts).
**Suggested agent:** a1-walter-web-developer.

### Task 2.1: Implement `--release` in `cmdCheckReservations` + fixtures
**Goal:** Scalar reservations can be released via CLI instead of `rm .a1/reservations.json`.
**Actions:**
1. In `_shared/a1-tools.cjs`, `cmdCheckReservations` (locate `grep -n "^function cmdCheckReservations"`, ~7658): add `release: 'bool'` to the `parseFlags` spec. After the `--list` branch, insert a `if (flags.release) { ... }` branch BEFORE the existing claim logic with these exact semantics:
   - Requires `--by <spec-id>`; `--claim <type>:<value>` is optional. Missing `--by` → `usage('check reservations --release requires --by <spec-id> (optionally --claim <type>:<value>)')`.
   - If `--claim` given: parse `type:value` with the same `indexOf(':')` validation as the claim path (reuse the exact parsing block).
   - Acquire lock: `const lockPath = acquireReservationsLock(file);` then `const data = loadReservations(file);` (mirror `cmdCodeScopeRelease` at ~7952-7973 — same lock/write/exit sequence, use `exitWithLock`/`failWithLock`, never bare `process.exit` inside the locked section).
   - Match set: with `--claim` → entries where `r.type === type && r.value === value`; without → all entries where `r.by === by` (bulk release, mirrors `code-scope release`).
   - If a `--claim` match exists but `existing.by !== by` → stdout JSON `{ status: 'FORBIDDEN', file, claim: {type, value, by}, held_by: existing.by }`, stderr `cannot release: <type>:<value> is held by <holder>, not <by>`, `exitWithLock(lockPath, 1)`.
   - If no match → **idempotent success**: stdout JSON `{ status: 'OK', file, released: [], idempotent: true, note: 'nothing to release' }`, `exitWithLock(lockPath, 0)`.
   - Otherwise filter matches out (only those with `r.by === by`), preserve all other keys of the loaded object: `writeJsonAtomic(file, { ...data, reservations: remaining })` (NOTE: must spread `...data` so `code_scopes`-bearing files are not truncated — this differs from `cmdCodeScopeRelease` which rebuilds `{ reservations }`; do it the safe spread way here). Stdout `{ status: 'OK', file, released: [<removed entries>], idempotent: false }`, `exitWithLock(lockPath, 0)`.
2. Update the `HELP` constant (locate `grep -n "check reservations" _shared/a1-tools.cjs | tail -5`, help block near ~8140): add a line `a1-tools check reservations --release --by <spec-id> [--claim <type>:<value>] [--file <path>]` with a one-line description ("release own claims; foreign claim -> exit 1; missing claim -> idempotent exit 0").
3. Extend `_test-fixtures/a1-reservations/run.sh` (append before the final summary lines, reusing existing `assert_rc` helper and `$FILE`) with these cases:
   - `release-own`: `check reservations --release --claim migration:090 --by spec-016 --file "$FILE"` → exit 0; then `--list` output must NOT contain `migration:090` (grep -v assertion, mirror the existing list-content pattern).
   - `release-foreign`: re-claim `migration:091` as spec-016, then `--release --claim migration:091 --by spec-020` → exit 1 and output contains `FORBIDDEN`; claim still listed afterwards.
   - `release-missing-idempotent`: `--release --claim migration:999 --by spec-016` → exit 0 and output contains `"idempotent": true`.
   - `release-bulk-by`: claim two entries for spec-030, then `--release --by spec-030` → exit 0; `--list` shows neither.
   - Hostile inputs (per CONVENTIONS.md): `hostile-release-injection`: `--release --claim 'x:$(touch /tmp/pwned)' --by spec-016` → exit 0 idempotent, and assert the string was treated inertly (no file created: `[[ ! -e /tmp/pwned ]]`); `hostile-release-overlong`: `--release --claim "type:$(head -c 12000 /dev/zero | tr '\0' 'a')" --by spec-016` → exits (0 or 1) within the run without hanging, use exit-code-in-{0,1} assertion.
   - Update the scenario comment block at the top of the file to list the new scenarios.
**Done when:**
```bash
bash _test-fixtures/a1-reservations/run.sh | tail -1 | grep -q "0 failed" && node _shared/a1-tools.cjs check reservations --release --by nobody --file /tmp/m9-none.json | grep -q '"idempotent": true' && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`.
**Covers:** SC-6

---

## Wave 3 — `worktree adopt` (cluster 1a)
`depends_on: [W2]`
**Suggested agent:** a1-walter-web-developer.

### Task 3.1: `worktree adopt <repo-root> <slug>` subcommand + fixtures
**Goal:** An existing git worktree (created outside a1) gets a registry entry with `status: active`, fields taken from git truth.
**Actions:**
1. In `_shared/a1-tools.cjs`, add `function cmdWorktreeAdopt(args)` directly after `cmdWorktreeGc` (locate `grep -n "^function cmdWorktreeGc"`, ~5291; insert after its closing brace ~5319). Exact behavior:
   ```
   flags = parseFlags(args, { 'worktree-path': 'string', branch: 'string', base: 'string' });
   [repoRootRaw, slug] = flags._;
   ```
   - Missing args → `usage('worktree adopt requires <repo-root> <slug>')`.
   - `!SLUG_RE.test(slug)` → stderr `error: invalid slug "<slug>" ...` + `process.exit(2)` (copy the pattern from `cmdWorktreePrepare` ~4959-4962).
   - `repoRoot = path.resolve(repoRootRaw)`; `!gitIsRepo(repoRoot)` → stderr + exit 2 (pattern ~4966-4969).
   - `const wts = gitWorktreeList(repoRoot).filter(w => path.resolve(w.path) !== repoRoot);` (exclude the main worktree).
   - Candidate selection (in this priority order): (a) if `flags['worktree-path']` → match `path.resolve(w.path) === path.resolve(flags['worktree-path'])`; (b) else if `flags.branch` → match `w.branch === flags.branch`; (c) else → match `path.basename(w.path) === slug`. Zero matches → stderr `error: no git worktree matches; candidates:` + JSON list of `wts` on stdout as `{ status: 'NOT_FOUND', candidates: wts }`, exit 1. More than one match → same shape with `status: 'AMBIGUOUS'`, stderr hint to pass `--worktree-path`, exit 1.
   - `const reg = readRegistry();` Guard 1: `findActiveBySlug(reg, repoRoot, slug)` truthy → stderr `error: registry already has active entry <id> for this repo+slug — nothing to adopt` + exit 1. Guard 2: any `reg.worktrees` entry with `status !== 'cleaned'` and same resolved `worktree_path` → stderr `error: worktree path already registered as <id>` + exit 1.
   - Build entry exactly like `cmdWorktreePrepare` (~5020-5034) but from git truth: `id: nowCompactId(slug)`, `worktree_path: path.resolve(match.path)`, `branch: match.branch || flags.branch || null`, `base_branch: flags.base || 'main'`, `status: 'active'`, `exit_mode: null`, `agent_brief: null`, `phase_history: ['phase=adopt completed=' + nowIso()]`. `commit_count`: `git(repoRoot, ['rev-list', '--count', baseBranch + '..' + branch], { allowFail: true })` → parseInt if string, else 0.
   - `reg.worktrees.push(entry); writeRegistryAtomic(reg);` return `{ id, slug, repo_root: repoRoot, worktree_path, branch, base_branch, status: 'active', commit_count, adopted: true }`.
2. Dispatcher (locate `grep -n "unknown worktree subcommand"`, ~9182): add `else if (sub === 'adopt') result = cmdWorktreeAdopt(rest);` before the `usage(...)` else.
3. `HELP` constant, worktree block (~8120-8130): add `a1-tools worktree adopt <repo-root> <slug> [--worktree-path <abs>] [--branch <name>] [--base <branch>]` + description "Register an EXISTING git worktree (created outside a1) as status=active, fields from git truth."
4. Extend `_test-fixtures/a1-worktree/run-tests.sh` (uses `A1_WORKTREE_REGISTRY` env — follow existing setup in the file; append cases before the summary):
   - `adopt-happy`: in the temp repo, create a worktree manually (`git -C "$REPO" worktree add "$WT_DIR/manual-feat" -b feature/manual-feat`), run `worktree adopt "$REPO" manual-feat --worktree-path "$WT_DIR/manual-feat"` → exit 0, output contains `"status": "active"` and `"adopted": true`.
   - `adopt-then-exit-handoff`: take `id` from the adopt JSON (`node -e` JSON parse), run `worktree exit <id> --mode handoff` → exit 0, `"status": "handoff"` (this is the original incident scenario).
   - `adopt-duplicate-refused`: second adopt of the same slug → exit 1, stderr mentions `active entry`.
   - `adopt-nonexistent`: `worktree adopt "$REPO" ghost-slug` → exit 1, output contains `NOT_FOUND`.
   - Hostile input: `worktree adopt "$REPO" '../evil'` → exit 2 (invalid slug); `worktree adopt "$REPO" "$(printf 'a%.0s' {1..10000})"` → exit 2, no hang.
**Done when:**
```bash
bash _test-fixtures/a1-worktree/run-tests.sh | tail -1 | grep -q "0 failed" && grep -q "worktree adopt" _shared/a1-tools.cjs && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`.
**Covers:** SC-1

---

## Wave 4 — `worktree reconcile` (cluster 1b)
`depends_on: [W3]` (uses adopt as remediation hint; same file region).
**Suggested agent:** a1-walter-web-developer.

### Task 4.1: `worktree reconcile <repo-root>` subcommand + fixtures
**Goal:** Registry vs. `git worktree list` diff in both directions; mutation only with explicit `--prune`.
**Actions:**
1. Add `function cmdWorktreeReconcile(args)` after `cmdWorktreeAdopt`:
   - `flags = parseFlags(args, { prune: 'bool' });` positional `<repo-root>` required (`usage('worktree reconcile requires <repo-root>')`); resolve + `gitIsRepo` check (exit 2 pattern).
   - `const gitWts = gitWorktreeList(repoRoot).filter(w => path.resolve(w.path) !== repoRoot);` `const reg = readRegistry();`
   - **Direction A (registry → disk), stale entries:** for each `reg.worktrees` entry with `e.repo_root === repoRoot && e.status !== 'cleaned'` where `!gitWts.some(w => path.resolve(w.path) === e.worktree_path) && !fs.existsSync(e.worktree_path)` → push `{ id: e.id, slug: e.slug, path: e.worktree_path, reason: 'registry entry has no git worktree and path missing on disk' }` to `stale[]`. If `flags.prune`: set `e.status = 'cleaned'; e.exit_mode = e.exit_mode || 'reconcile'; e.last_status_change = nowIso(); e.phase_history.push('phase=reconcile completed=' + nowIso());` and collect id in `pruned[]` (mirror `cmdWorktreeGc` ~5297-5309). Explicit design decision: no interactive confirmation — the `--prune` flag IS the confirmation; without it the command is read-only.
   - **Direction B (disk → registry), adopt candidates:** for each `gitWts` entry with no `reg.worktrees` match (`w2.worktree_path === path.resolve(w.path) && w2.status !== 'cleaned'`) → push `{ path: w.path, branch: w.branch || null, hint: 'a1-tools worktree adopt ' + repoRoot + ' <slug> --worktree-path ' + w.path }` to `adopt_candidates[]`.
   - Write registry only `if (flags.prune && pruned.length > 0)`. Return `{ repo_root: repoRoot, in_sync: stale.length === 0 && adopt_candidates.length === 0, stale, pruned, adopt_candidates, prune: !!flags.prune }`. Exit 0 in all non-error cases (reporting drift is not a failure).
2. Dispatcher: add `else if (sub === 'reconcile') result = cmdWorktreeReconcile(rest);` in the worktree branch.
3. `HELP`: add `a1-tools worktree reconcile <repo-root> [--prune]` + "Diff registry vs 'git worktree list' both ways. Read-only by default; --prune marks orphaned registry entries cleaned. Unregistered worktrees are listed as adopt candidates."
4. Fixture cases in `_test-fixtures/a1-worktree/run-tests.sh`:
   - `reconcile-in-sync`: right after an adopt, reconcile → exit 0, `"in_sync": true`.
   - `reconcile-detects-candidate`: create a manual worktree without adopting → reconcile → `adopt_candidates` non-empty, contains the path; registry file unchanged (compare `md5`/`cmp` of registry before/after).
   - `reconcile-detects-stale-dry`: adopt a worktree, then `git worktree remove --force <path>` → reconcile WITHOUT `--prune` → `stale` non-empty, `pruned` empty, entry still non-cleaned in registry.
   - `reconcile-prune`: same state, reconcile `--prune` → `pruned` contains the id; `worktree list --status=cleaned` now shows it.
**Done when:**
```bash
bash _test-fixtures/a1-worktree/run-tests.sh | tail -1 | grep -q "0 failed" && node _shared/a1-tools.cjs worktree reconcile /Users/rob/code/a1-skills >/dev/null && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`.
**Covers:** SC-2

---

## Wave 5 — pr-review fallback + skill docs (cluster 1c/1d)
`depends_on: [W4]`
**Suggested agent:** a1-walter-web-developer (5.1); docs tasks 5.2/5.3 can run parallel to each other, and 5.2/5.3 touch different files than 5.1.

### Task 5.1: `pr findings-summary --worktree-path` fallback
**Goal:** Read-only findings summary works with a direct path, no registry entry needed.
**Actions:**
1. In `cmdPrFindingsSummary` (locate `grep -n "^function cmdPrFindingsSummary"`, ~5453): change to `const flags = parseFlags(args, { 'worktree-path': 'string' });`.
   - **Positional-slug-Umstellung (PFLICHT — sonst bricht der slug-Pfad):** Heute liest die Funktion rein positional: `if (args.length < 1) usage(...); const [slugOrId] = args;`. Nach der `parseFlags`-Umstellung ist der positionale Wert NICHT mehr `args[0]`, sondern `flags._[0]`. Ersetze den Zugriff durch `const [slugOrId] = flags._;` und die Guard durch `if (!flags['worktree-path'] && flags._.length < 1) usage('pr findings-summary requires <id-or-slug> or --worktree-path');`. `args[0]` darf NICHT stehenbleiben.
   - **Direct-path-Zweig:** If `flags['worktree-path']` is set: `const wtPath = path.resolve(flags['worktree-path']);` — `!fs.existsSync(wtPath)` → `fail('worktree path does not exist: ' + wtPath)`; read findings via `readFindings(wtPath)`. Missing-findings-Fall mit EXAKT dieser Meldung (byte-identisch zum heutigen Registry-Pfad): `fail(`no findings.json in ${wtPath}/.a1-review/ — run Phase 2 first`);`. Return same shape with `id: null, slug: path.basename(wtPath), worktree_path: wtPath, source: 'direct-path'`.
   - **Registry-Zweig unverändert:** Otherwise keep the existing positional `<id-or-slug>` registry path byte-identical — nur der Zugriff `flags._[0]` statt `args[0]` ändert sich (Guard oben). Do NOT add `source: 'registry'` to its return object — do not change the existing output shape; only the new direct-path branch carries `source`.
2. Design decision (document, don't implement flags): `pr mark-status` / `pr mark-pr-open` WRITE the registry — a path-based bypass is meaningless there. The supported fallback for them is **adopt first** (`worktree adopt`, Wave 3), then the normal registry path.
3. `HELP` pr block (~8132-8140): extend the `pr findings-summary` line to `a1-tools pr findings-summary <id-or-slug> | --worktree-path <abs>`.
4. Fixture: `_test-fixtures/a1-pr-review/run-test.sh` — append a case `findings-direct-path`: create a temp dir with `.a1-review/findings.json` (copy the JSON shape used earlier in that same script), run `pr findings-summary --worktree-path "$TMP_WT"` → exit 0, output contains `"source": "direct-path"` and correct `counts`. Plus hostile case: `--worktree-path '../../nonexistent'` → exit 1, stderr contains `does not exist`.
**Done when:**
```bash
bash _test-fixtures/a1-pr-review/run-test.sh | tail -1 | grep -q "0 failed" && \
# positional slug path still reads flags._[0] correctly (must NOT error with a flag-parse/usage message):
node _shared/a1-tools.cjs pr findings-summary __m9_no_such_slug__ 2>&1 | grep -q 'no registry entry for' && echo OK
```
The second check proves the positional slug is still read (it must reach the `no registry entry` fail — NOT a `requires <id-or-slug>` usage error, which would mean `flags._[0]` was not wired).
plus full regression gate → `ALL-SUITES-GREEN`.
**Covers:** SC-3

### Task 5.2: a1-worktree skill docs for adopt/reconcile
**Goal:** The skill documents the two new subcommands so agents actually use them.
**Actions:**
1. Create `skills/a1-worktree/workflows/04-adopt-reconcile.md` following the structure/heading style of `skills/a1-worktree/workflows/01-prepare.md` (read it first, mirror its section layout). Content: when to use adopt (worktree exists on disk / was created via raw `git worktree add`, `worktree exit` fails with "no registry entry"), the exact commands (`node _shared/a1-tools.cjs worktree adopt <repo-root> <slug> [--worktree-path <abs>]`, `... worktree reconcile <repo-root> [--prune]`), the JSON outputs (`adopted: true`, `stale`/`adopt_candidates`), and the rule: reconcile is read-only without `--prune`; run reconcile before gc when registry and disk may have drifted.
2. In `skills/a1-worktree/SKILL.md`: add `adopt` and `reconcile` to wherever the subcommand list / lifecycle table lists prepare/enter/exit/list/gc (grep for `gc` in the file), plus a one-line recovery note: "Worktree exists but exit says 'no registry entry' → `worktree adopt`, see workflows/04-adopt-reconcile.md".
**Done when:**
```bash
test -f skills/a1-worktree/workflows/04-adopt-reconcile.md && grep -q "adopt" skills/a1-worktree/SKILL.md && echo OK
```
**Covers:** SC-1, SC-2 (docs)

### Task 5.3: a1-pr-review skill fallback docs
**Goal:** Phase 1 (Detect) has a documented path when no `handoff` registry entry exists.
**Actions:**
1. In `skills/a1-pr-review/workflows/01-detect.md`: after the registry-scan step (`pr list-handoff`), add a `### Fallback: no handoff entry` section: if the user names a branch/worktree path directly and `pr list-handoff` is empty → (a) preferred: `worktree adopt <repo-root> <slug> --worktree-path <path>` then `worktree exit <id> --mode handoff`, then continue the normal registry flow; (b) read-only alternative for findings only: `pr findings-summary --worktree-path <path>`. State explicitly: `mark-status`/`mark-pr-open` always require a registry entry (adopt first), and the existing rule "never write the registry file directly, CLI only" (SKILL.md line ~108) stays in force.
2. In `skills/a1-pr-review/SKILL.md`: in the Detect phase description (line ~5) and the preconditions section (~line 49), add one sentence each referencing the fallback ("no registry entry? → adopt-first fallback, see workflows/01-detect.md").
**Done when:**
```bash
grep -q "worktree adopt" skills/a1-pr-review/workflows/01-detect.md && grep -qi "fallback" skills/a1-pr-review/SKILL.md && echo OK
```
**Covers:** SC-3 (docs)

---

## Wave 6 — Module split 1/4: `_shared/lib/io.cjs` (cluster 2a)
`depends_on: [W5]` — split runs LAST so all new features are covered by fixtures before the mechanical extraction, and line refs in W1-W5 stayed valid.
**Suggested agent:** a1-walter-web-developer — brief: "pure mechanical move, zero behavior change, no renames, no signature changes, no refactoring beyond the move".

### Task 6.1: Extract core I/O + flag parsing to `_shared/lib/io.cjs`
**Goal:** Frontmatter/atomic-write/flag/error helpers live in a requireable module; facade unchanged.
**Actions:**
1. `mkdir -p _shared/lib`. Create `_shared/lib/io.cjs` starting with `'use strict';` and its own `const fs = require('fs'); const path = require('path'); const os = require('os');` (only what's needed).
2. MOVE (cut from `a1-tools.cjs`, paste unchanged into `io.cjs`) these functions — locate each via `grep -n "^function <name>" _shared/a1-tools.cjs`:
   `vaultRoot`, `resolveVaultPath`, `parseFrontmatter`, `serializeScalar`, `detectKeyOrder`, `serializeFrontmatter`, `readMd`, `writeMdAtomic`, `nowIso`, `writeTextAtomic`, `parseScalarToken`, `parseNestedFrontmatter`, `serializeNestedFrontmatter`, `writeNestedMdAtomic`, `parseFlags` (~2438-2462), `fail` (~8037-8040).

   **Modul-lokale free identifiers, die MITGEZOGEN werden MÜSSEN (vollständige Liste — nicht selbst herleiten; verifiziert gegen main-Stand 2026-07-11):**
   - `let _vaultRootAnnounced = false;` (~277) — Modul-Flag, von `vaultRoot()` gelesen und gesetzt. MOVE mit an den Kopf von `io.cjs`.
   - Die 5 KEY_ORDER-Konstanten, die `detectKeyOrder()` referenziert: `SPEC_KEY_ORDER` (~453), `BUG_KEY_ORDER` (~465), `ANALYSIS_KEY_ORDER` (~484), `CONSTITUTION_KEY_ORDER` (~501), `RECONCILE_KEY_ORDER` (~513). MOVE alle 5 nach `io.cjs` (sie werden AUSSCHLIESSLICH von `detectKeyOrder` genutzt).
   - Kein weiterer modul-lokaler Bezeichner wird von den bewegten Funktionen frei referenziert. Insbesondere: `vaultRoot` nutzt nur `process`, `path`, `fs`, `os` (→ `os` deshalb requiren) und `require('child_process')` inline (bleibt inline). `serializeNestedFrontmatter`/`writeNestedMdAtomic` referenzieren KEINE `PRODUCT_ROADMAP_KEY_ORDER`/`PRODUCT_FEATURE_KEY_ORDER` — diese `keyOrder` kommt als Parameter von den (in `product.cjs` verbleibenden) Aufrufern; die beiden PRODUCT-KEY_ORDER-Konstanten (~826, ~831) bleiben also in `a1-tools.cjs` bzw. wandern in Wave 9 nach `product.cjs`. `parseFlags` und `fail` sind self-contained (nur `process`).
   NOT moved: `usage` (depends on the `HELP` constant — stays in `a1-tools.cjs`); die 2 PRODUCT-KEY_ORDER-Konstanten (siehe oben).
3. End `io.cjs` with `module.exports = { vaultRoot, resolveVaultPath, parseFrontmatter, serializeScalar, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic, nowIso, writeTextAtomic, parseScalarToken, parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic, parseFlags, fail };`
4. In `_shared/a1-tools.cjs`, at the spot of the removed frontmatter block, add:
   `const { vaultRoot, resolveVaultPath, parseFrontmatter, serializeScalar, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic, nowIso, writeTextAtomic, parseScalarToken, parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic, parseFlags, fail } = require(path.join(__dirname, 'lib', 'io.cjs'));`
   (use `__dirname`-relative require so the installed symlink works; Node resolves the realpath of the symlinked file, so `__dirname` is the repo `_shared/` dir — verify with the smoke check below). Note: `cmdWorktreePrepare` shadows `fail` locally — that is fine, do not touch it.
5. Verify no moved function is still defined in the facade: for each name run `grep -c "^function <name>" _shared/a1-tools.cjs` → must be 0.
6. Smoke the symlink path exactly like CI: `HOME=$(mktemp -d) node "$(readlink -f ~/.claude/skills 2>/dev/null >/dev/null; echo _shared/a1-tools.cjs)" spec next-number` — at minimum run `node _shared/a1-tools.cjs spec next-number` from `/tmp` (`cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs check reservations --list --file /tmp/x.json`).
7. Check `bin/install.sh` (grep for `_shared`): if it symlinks/copies `a1-tools.cjs` as a single file into a target dir (rather than the whole `_shared` dir), it must now also handle `_shared/lib/` — adjust if and only if needed; if it symlinks (Node follows realpath), no change needed.
**Done when:**
```bash
node --check _shared/lib/io.cjs && node --check _shared/a1-tools.cjs && \
# runtime load-proof (catches ReferenceError from a forgotten export/require — node --check does NOT):
node -e "require('./_shared/lib/io.cjs')" && node -e "require('./_shared/a1-tools.cjs')" && \
# real facade smoke that runs a moved io helper (parseFlags + fail path) from outside the repo cwd:
(cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs check reservations --list --file /tmp/m9-io-smoke.json >/dev/null) && \
[[ $(grep -c "^function parseFrontmatter" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before starting Wave 7.**
**Covers:** SC-4

---

## Wave 7 — Module split 2/4: `_shared/lib/locks.cjs` (cluster 2b)
`depends_on: [W6]`
**Suggested agent:** a1-walter-web-developer (same mechanical-move brief).

### Task 7.1: Extract reservations-lock machinery + transactional writes
**Actions:**
1. Create `_shared/lib/locks.cjs` (`'use strict';` + `const fs = require('fs'); const path = require('path');` + `const { nowIso, fail } = require('./io.cjs');`).
2. MOVE unchanged: `RESERVATIONS_LOCK_RETRIES`, `RESERVATIONS_LOCK_RETRY_DELAY_MS`, `RESERVATIONS_LOCK_STALE_MS`, `sleepSyncMs`, `isPidDead`, `isLockStale`, `acquireReservationsLock` (the Wave-1 version), `releaseReservationsLock`, `exitWithLock`, `failWithLock`, `writeJsonAtomic`, `reservationsFile`, `loadReservations` (all in the ~7499-7656 block), plus `writeAllOrNothing` (locate `grep -n "^function writeAllOrNothing"`, ~1073 — first read it and move any private helper it references along with it, or import from io.cjs if already there).
3. Export all of them. In `a1-tools.cjs`, add `const { writeJsonAtomic, acquireReservationsLock, releaseReservationsLock, exitWithLock, failWithLock, reservationsFile, loadReservations, isLockStale, isPidDead, sleepSyncMs, writeAllOrNothing } = require(path.join(__dirname, 'lib', 'locks.cjs'));` and delete the moved definitions. Keep the big P7 section comment (~7489-7497) in the facade as a pointer: replace the moved block with a 2-line comment `// reservations lock machinery lives in lib/locks.cjs`.
4. Verify: `grep -c "^function acquireReservationsLock" _shared/a1-tools.cjs` → 0; callers in `product`, `code-scope`, `check reservations` untouched.
**Done when:**
```bash
node --check _shared/lib/locks.cjs && node --check _shared/a1-tools.cjs && \
# runtime load-proof (locks.cjs requires io.cjs — catches a broken/forgotten import):
node -e "require('./_shared/lib/locks.cjs')" && node -e "require('./_shared/a1-tools.cjs')" && \
# real facade smoke that exercises the moved lock machinery (acquire + release around a write):
(cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs check reservations --list --file /tmp/m9-locks-smoke.json >/dev/null) && \
[[ $(grep -c "^function acquireReservationsLock" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN` (the product-docs stale-lock cases 820-874 are the critical net here). **Commit before Wave 8.**
**Covers:** SC-4

---

## Wave 8 — Module split 3/4: `_shared/lib/worktree-registry.cjs` (cluster 2d)
`depends_on: [W7]`
**Suggested agent:** a1-walter-web-developer (same brief).

### Task 8.1: Extract registry + git helpers shared by `worktree` and `pr` groups
**Actions:**
1. Create `_shared/lib/worktree-registry.cjs` (`'use strict';`, requires `fs`, `path`, `os`, `const { execFileSync } = require('child_process');`).
2. MOVE unchanged (block ~4828-4939 + ~5327-5361): `WORKTREE_STATUSES`, `WORKTREE_EXIT_MODES`, `SLUG_RE`, `worktreeRegistryPath`, `readRegistry`, `writeRegistryAtomic`, `nowCompactId`, `git`, `gitIsRepo`, `gitWorkingTreeClean`, `gitBranchExists`, `gitWorktreeList`, `gitBranchHasWorktree`, `findRegistryEntry`, `findActiveBySlug`, `repoParentWorktreeDir`, `prReviewDir`, `ensurePrReviewDir`, `readFindings`, `findEntryBySlugOrId`. Remove the now-duplicate `const { execFileSync } = require('child_process');` from the facade (line ~4833).
3. Export all; in the facade add the destructured `require(path.join(__dirname, 'lib', 'worktree-registry.cjs'))`. The **command functions** (`cmdWorktree*`, `cmdPr*`, incl. adopt/reconcile from Waves 3-4) STAY in `a1-tools.cjs` in this phase — only shared helpers move (this is the anti-duplication cut RESEARCH demands; the command groups themselves are a later phase).
4. Verify: `grep -c "^function gitWorktreeList" _shared/a1-tools.cjs` → 0; `node _shared/a1-tools.cjs worktree list` still works.
**Done when:**
```bash
node --check _shared/lib/worktree-registry.cjs && node --check _shared/a1-tools.cjs && \
# runtime load-proof (registry module + facade actually load, not just parse):
node -e "require('./_shared/lib/worktree-registry.cjs')" && node -e "require('./_shared/a1-tools.cjs')" && \
# real facade smoke that runs a moved registry helper (readRegistry via worktree list) from outside the repo cwd:
(cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs worktree list >/dev/null) && \
[[ $(grep -c "^function readRegistry" _shared/a1-tools.cjs) -eq 0 ]] && echo OK
```
plus full regression gate → `ALL-SUITES-GREEN`. **Commit before Wave 9.**
**Covers:** SC-4

---

## Wave 9 — Module split 4/4: `_shared/lib/product.cjs` (cluster 2c)
`depends_on: [W8]`
**Suggested agent:** a1-walter-web-developer (same brief; largest move, ~1900 lines).

### Task 9.1: Extract the entire product command group
**Actions:**
1. Create `_shared/lib/product.cjs` (`'use strict';`, requires `fs`, `path`, `const io = require('./io.cjs');` destructured, `const locks = require('./locks.cjs');` destructured).
2. MOVE unchanged the whole product region — two blocks (re-verify boundaries first via `grep -n "^function readProductRoadmap\|^function cmdProduct\|^// ----------" _shared/a1-tools.cjs`):
   - product helpers ~843-1177: `readProductRoadmap`, `readProductFeature`, `regenerateDerived`, `appendChangelogEntry`, `assertSlug`, `productDirFromFlags`, `buildRoadmapWritesWithChangelog` (NOT `writeAllOrNothing` — already in locks.cjs since Wave 7).
   - product commands + legacy-import helpers ~1178-2434: every `function cmdProduct...` plus the import/parse helpers in 2013-2365. Before moving, confirm none of these helpers are called from a NON-product command: for each helper name run `grep -n "<name>(" _shared/a1-tools.cjs` after the move — remaining hits must only be inside `lib/product.cjs` or the dispatcher's product branch. If a helper IS used elsewhere (e.g. `assertSlug`), move it to `io.cjs` instead and import it in `product.cjs` — document the decision in the commit message.
3. Export a command map: `module.exports = { cmdProductStatus, cmdProductStage, ... };` (every `cmdProduct*` that the dispatcher's product branch (~9235-9269) references — list them by reading that branch).
4. In the facade's dispatcher product branch, add at the top of the branch `const product = require(path.join(__dirname, 'lib', 'product.cjs'));` (lazy, inside the `else if (group === 'product')` block) and prefix every call: `result = product.cmdProductStatus(rest);` etc. Keep every `sub === '...'` string byte-identical.
5. Verify facade shrinkage: `wc -l _shared/a1-tools.cjs` — expect ≤ ~6800 lines (≥ 2500 lines total reduction vs the 9294 baseline across Waves 6-9).
**Done when:**
```bash
node --check _shared/lib/product.cjs && node --check _shared/a1-tools.cjs && \
# runtime load-proof (product.cjs requires io+locks — catches a forgotten export/require):
node -e "require('./_shared/lib/product.cjs')" && node -e "require('./_shared/a1-tools.cjs')" && \
# real facade smoke that dispatches into the moved product group (loads product.cjs lazily and runs cmdProductStatus):
node _shared/a1-tools.cjs product status --dir /tmp/m9-prod-smoke-none >/dev/null 2>&1; rc=$?; [[ $rc -eq 1 ]] && \
[[ $(grep -c "^function cmdProduct" _shared/a1-tools.cjs) -eq 0 ]] && [[ $(wc -l < _shared/a1-tools.cjs) -lt 6900 ]] && echo OK
```
`product status --dir <missing>` routes through the dispatcher into `lib/product.cjs` and must exit **1** (`ROADMAP.md not found` — a clean `fail`), proving the module loaded and `cmdProductStatus` ran. A `ReferenceError`/missing-export would surface as a crash (exit ≠ 1, e.g. an uncaught-throw stack), not silently — that is what this check catches beyond `node --check`.
plus full regression gate → `ALL-SUITES-GREEN` (product-docs, product-adopt, product-import, roadmap-gate are the critical suites). **Commit.**
**Covers:** SC-4

---

## Verification (goal-backward, after all waves)

Run from `/Users/rob/code/a1-skills`:

- [ ] All suites green + syntax:
  ```bash
  node --check _shared/a1-tools.cjs && for f in _shared/lib/*.cjs; do node --check "$f"; done && \
  ok=1; for r in _test-fixtures/*/run*.sh; do bash "$r" >/dev/null || { echo "FAILED: $r"; ok=0; }; done; [[ $ok -eq 1 ]] && echo GREEN
  ```
- [ ] SC-1/SC-2 live check (throwaway repo):
  ```bash
  T=$(mktemp -d); export A1_WORKTREE_REGISTRY="$T/reg.json"; R="$T/repo"; git init -q -b main "$R"; git -C "$R" commit -q --allow-empty -m init; \
  git -C "$R" worktree add -q "$T/wt-demo" -b feature/demo; \
  node _shared/a1-tools.cjs worktree adopt "$R" demo --worktree-path "$T/wt-demo" | grep -q '"adopted": true' && \
  node _shared/a1-tools.cjs worktree reconcile "$R" | grep -q '"in_sync": true' && echo SC1-SC2-OK; unset A1_WORKTREE_REGISTRY
  ```
- [ ] SC-3: `grep -q "worktree-path" skills/a1-pr-review/workflows/01-detect.md` and fixture suite `a1-pr-review` green.
- [ ] SC-4: `ls _shared/lib/io.cjs _shared/lib/locks.cjs _shared/lib/worktree-registry.cjs _shared/lib/product.cjs` all exist; `wc -l < _shared/a1-tools.cjs` < 6900; git log shows 4 separate extraction commits (Waves 6-9).
- [ ] SC-5: `grep -q "Hostile inputs" _test-fixtures/CONVENTIONS.md && grep -q "CONVENTIONS.md" CONTRIBUTING.md`.
- [ ] SC-6: a1-reservations suite green incl. `release-foreign` (exit 1) and `release-missing-idempotent` (exit 0) cases.
- [ ] SC-7: `grep -q "renameSync(tmpLock, lockPath)" _shared/lib/locks.cjs` (function moved in Wave 7) and product-docs stale-lock cases green.
- [ ] SC-8: `grep -q "process.ppid" _test-fixtures/product-docs/run.sh` at the Case-B comment and no `$$`-claim remains.
- [ ] CLI facade stable: `cd /tmp && node /Users/rob/code/a1-skills/_shared/a1-tools.cjs check reservations --list --file /tmp/none.json` exits 0 (require-path works outside the repo cwd).
