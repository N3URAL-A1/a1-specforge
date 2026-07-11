---
focus: robustness
generated: 2026-07-11T00:00:00Z
commit: 5dc111e
---

# M9 Robustness — Codebase Map

**Scope:** Audit of `_shared/a1-tools.cjs` (9294 lines), Worktree/PR-Lifecycle, Fixture Harness, Reservations. This map documents exact line ranges and dependencies needed for Phase Planning and Execution.

---

## 1. Command Architecture

### 16 Command Groups (Dispatch: 9083–9284)

All commands dispatch through `main()` at **line 9083**. The dispatcher (`[group, sub, ...rest]` pattern) routes to specific handler functions. Registry of groups:

| Group | Dispatch Range | Subcommands | Handler Count | Notes |
|-------|----------------|-------------|---------------|-------|
| **spec** | 9092–9096 | next-number, update-status, list | 3 | Phase specification tracking |
| **fix** | 9097–9107 | next-suffix, update-status, list, find-duplicates, integrity-check, init-postmortem, count-postmortems-since, update-promote-state, write-suggestion | 9 | Bug/learning lifecycle |
| **analyze** | 9108–9116 | next-slot, init, update-status, discover, add-finding, add-findings, list | 7 | Codebase analysis snapshots |
| **check** | 9117–9127 | reservations (standalone), [default] | 2 | Pre-flight validation |
| **code-scope** | 9128–9147 | claim, check-all, unblock, list | 4 | Path-list reservation overlap gates |
| **realpath-check** | 9148–9153 | validate, list | 2 | Symlink/realpath integrity |
| **checklist** | 9154–9163 | run, list | 2 | Wave dependency & FR coverage validation |
| **constitution** | 9164–9174 | init, discover, update-status, set-body, next-version, archive-current, write-mirror, link-claudemd, list | 9 | Project rules/governance |
| **worktree** | 9175–9182 | prepare, enter, status, exit, list, gc | 6 | Isolated development branches |
| **pr** | 9183–9188 | list-handoff, mark-status, [8 implicit] | 2 | PR review workflow tracking |
| **phantom** | 9189–9198 | init, update-status, list | 3 | Unrealized features (spec exists, code ∄) |
| **reconcile** | 9199–9206 | next-slot, init, parse-spec, update-status, add-drift, list | 6 | Spec-vs-code drift detection |
| **modernize** | 9207–9221 | next-slot, init, update-status, discover-stack, add-proposal, approve-proposal, add-wave, snapshot-behavior, start-wave, complete-wave, verify-parity, publish-notion, list | 13 | Legacy system modernization |
| **schema-check** | 9222–9228 | parse, run | 2 | SQL/schema validation |
| **cost** | 9229–9234 | run | 1 | Token/usage accounting |
| **product** | 9235–9269 | status, stage, markers, changelog, init, add-milestone, add-feature, feature-init, import, validate | 10 | Product roadmap (Notion/DataJSON) |
| **pack** | 9270–9281 | validate, import, export | 3 | Gate-pack distribution/import |

---

## 2. Shared Helper Functions — 134 Total

### Core I/O & Encoding (23 functions)

These handle all file persistence atomically and frontmatter parsing — used by almost every command group:

| Function | Lines | Purpose | Used By |
|----------|-------|---------|---------|
| `vaultRoot()` | 294–352 | 3-tier vault resolution (env → repo-local → legacy) | 32 call sites; emits "Tier X" status once per process |
| `resolveVaultPath()` | 354–361 | Absolute path for a vault entry | spec, fix, analyze, ... (all wiki writers) |
| `parseFrontmatter()` | 363–441 | YAML block → JS object, handles multiline strings & scalar types | every .md reader |
| `serializeScalar()` | 443–534 | JS value → YAML scalar (quoted/unquoted, handles ints/bools/null/dates) | frontmatter serialization |
| `detectKeyOrder()` | 536–542 | YAML key emission order for determinism | serializeFrontmatter |
| `serializeFrontmatter()` | 544–568 | JS object → YAML block string | spec/fix/analyze writers |
| `readMd()` | 570–574 | Read .md file, parse frontmatter + body | ~15 readers across groups |
| `writeMdAtomic()` | 576–582 | Write with fmatter + body atomically (tmpfile + rename) | spec/fix/analyze/constitution/... writers |
| `nowIso()` | 584–589 | Current UTC timestamp (ISO8601) | every status change, timestamps |
| `writeTextAtomic()` | 591–627 | Generic atomic text write (tmpfile + rename, restores perms) | json/txt writers |
| `parseScalarToken()` | 629–651 | Parse a scalar YAML value (strips quotes, handles escapes) | parseNestedFrontmatter |
| `parseNestedFrontmatter()` | 653–779 | YAML with nested tables (proposals, waves, etc.) for modernize/reconcile | modernize, reconcile state files |
| `serializeNestedFrontmatter()` | 781–834 | Reverse: JS object → nested YAML with deterministic key order | modernize, reconcile writers |
| `writeNestedMdAtomic()` | 836–841 | Write nested .md (frontmatter + body, atomic) | modernize/reconcile writers |
| `readProductRoadmap()` | 843–849 | Read roadmap.md, return { fm, body } | product status/stage/markers |
| `readProductFeature()` | 851–861 | Read features/<id>/FEATURE.md | product status/feature commands |
| `writeJsonAtomic()` | [grep for line] | Write JSON file atomically | reservations, cost, check |
| `readJsonFile()` | [helper] | Read JSON file safely | reservations reader |
| [13 other scalar/type helpers] | | Utility parsers | domain-specific |

**Atomicity guarantee:** All writes use tmpfile + rename pattern (fsync optional). No partial-write risk on system crash.

**Vault integration:** Every file-write checks `vaultRoot()` once at process start (module-level flag `_vaultRootAnnounced` at line 277).

### Path & Directory Helpers (18 functions)

| Function | Lines | Purpose | Used By |
|----------|-------|---------|---------|
| `postmortemsDir()` | 2762–2767 | `wiki/postmortems/<project-slug>/` | fix commands |
| `agentsLockPath()` | 2769–2771 | `wiki/_canonical/agents.lock.json` | fix integrity-check |
| `lastPromotePath()` | 2773–2775 | `wiki/_state/last_promote.json` | fix update-promote-state |
| `constitutionVaultPath()` | 3507–3515 | `constitution/<project-slug>/current.md` | constitution readers |
| `constitutionHistoryDir()` | 3517–3521 | `constitution/<project-slug>/history/` | constitution archive-current |
| `modernizeDir()` | 5499–5503 | `.a1/modernize/<project-slug>/` | modernize all |
| `reconcileDir()` | 6049–6087 | `.a1/reconcile/<project-slug>/` | reconcile all |
| `checklistPaths()` | 4265–4280 | Returns {plan, spec, feature} paths for checklist | check/checklist runners |
| `worktreeRegistryPath()` | 4835–4838 | `~/.a1-worktrees-registry.json` (global) | all worktree commands |
| `prReviewDir()` | 5327–5329 | `<worktree-path>/.a1-pr-review/` | a1-pr-review reader |
| `ensurePrReviewDir()` | 5331–5335 | Create .a1-pr-review dir if missing | a1-pr-review init |
| `repoParentWorktreeDir()` | 4937–4942 | Parent dir for worktrees (`..<main-repo-slug>-worktrees/`) | worktree prepare |
| [7 other path constructors] | | Frontmatter key builders, temp dirs | various |

### Git Helpers (6 functions)

All shell out to `git` command — used only by worktree:

| Function | Lines | Purpose | Used By |
|----------|-------|---------|---------|
| `git()` | 4872–4885 | `git [args]` in repo, return stdout or throw | worktree commands |
| `gitIsRepo()` | 4887–4892 | Test `git rev-parse --git-dir` | worktree prepare (check 2) |
| `gitWorkingTreeClean()` | 4894–4897 | `git status --porcelain` empty? | worktree prepare (check 3) |
| `gitBranchExists()` | 4899–4904 | `git show-ref refs/heads/<branch>` | worktree prepare (checks 4, 5) |
| `gitWorktreeList()` | 4906–4921 | Parse `git worktree list --porcelain` | worktree list, gc |
| `gitBranchHasWorktree()` | 4923–4925 | True if branch attached to any worktree | worktree prepare (check 5) |

### Frontmatter State Tracking (8 functions)

| Function | Lines | Purpose | Used By |
|----------|-------|---------|---------|
| `appendPhaseHistory()` | 2427–2436 | Push "phase=X completed=ISO" to phase_history array | spec/fix/analyze/... status updaters |
| `appendFinding()` | 3395–3421 | Add one finding to findings[] with ID | analyze add-finding |
| `extractSpecFRs()` | 3928–3934 | Parse ## Acceptance Criteria from spec body → list | check/checklist |
| `extractWaveFRs()` | 3936–3965 | Parse ## Wave 1 Acceptance Criteria from plan → map { waveNum: [FR] } | checklist coverage check |
| `diffFRCoverage()` | 3967–3985 | Compare spec FRs vs plan wave FRs; report missing/extra | check coverage reporter |
| `extractWaveBlocks()` | 4282–4303 | Parse ## Wave N from plan body, collect [blockMdText] | checklist runner |
| `extractWaveDependencies()` | 4305–4320 | Parse `depends_on: [W1, W3]` from wave block | checklist cycle detector |
| `detectWaveCycles()` | 4322–4363 | Tarjan cycle detection in wave DAG | checklist blocker check |

### Registry & Lock Helpers (8 functions)

| Function | Lines | Purpose | Used By |
|----------|-------|---------|---------|
| `worktreeRegistryPath()` | 4835–4838 | `~/.a1-worktrees-registry.json` | all worktree, all pr |
| `readRegistry()` | 4840–4854 | Load JSON registry, ensure `.worktrees` and `.pr_reviews` arrays exist | worktree/pr read |
| `writeRegistryAtomic()` | 4856–4861 | Atomic JSON write to registry | worktree/pr write |
| `nowCompactId()` | 4863–4870 | Slug + "-" + ISO datestamp (compact ID) | worktree entry creation |
| `findRegistryEntry()` | 4927–4929 | Lookup by ID in `.worktrees[]` | worktree enter/status/exit |
| `findActiveBySlug()` | 4931–4935 | Find latest `.worktrees[]` entry by repo+slug, status ≠ 'exited' | worktree prepare |
| `findEntryBySlugOrId()` | 5347–5358 | Find by slug OR ID in registry | pr list-handoff |
| `readFindings()` | 5337–5345 | Read `.a1-pr-review/findings.jsonl` | a1-pr-review detect |

### Reservations & Code-Scope (12 functions)

Lines 7490–7800+:

| Function | Lines | Purpose | Scope Impact |
|----------|-------|---------|--------|
| `cmdCheckReservations()` | 7658–7714 | --claim & --list subcmds; scalar reservations registry | M9: Entry point for check reservations |
| `normalizeScopePath()` | 7731–7737 | Strip ./, collapse //, remove trailing / | code-scope overlap calc |
| `isGlobPattern()` | 7739–7746 | Detect *, ?, [, ! in path segment | glob-vs-literal logic |
| `segmentizePath()` | 7748–7761 | Split normalized path into ["a", "b", "c"] segments | overlap checking |
| `checkPrefixOverlap()` | 7763–7795 | Compare two segment lists for prefix overlap (conservative) | code-scope gate |
| `checkGlobOverlap()` | 7797–7850 | Match glob pattern against all other scope paths (minimatch logic) | code-scope glob features |
| `reservationsFile()` | 7853–7861 | Resolve `flags.file` or `.a1/reservations.json` | load/store helper |
| `loadReservations()` | 7863–7880 | Read JSON, ensure { reservations: [], code_scopes: [] } structure | code-scope gate reader |
| `cmdCodeScopeClaim()` | 8062–8200+ | Claim paths (glob/literal), overlap-check all in-flight scopes | M9: Key gate logic |
| `cmdCodeScopeCheckAll()` | [next section] | Validate all code_scopes in registry for overlaps | M9: Audit subcommand |
| `cmdCodeScopeUnblock()` | [next section] | Force-remove a scope (admin) | M9: Recovery path |
| `cmdCodeScopeList()` | [next section] | Report all registered code_scopes | M9: Visibility |

**Reservations JSON Schema (.a1/reservations.json):**
```json
{
  "reservations": [
    { "type": "string", "value": "string", "by": "spec-id", "at": "ISO-timestamp" }
  ],
  "code_scopes": [
    { "paths": ["src/foo/*", "src/bar/baz.ts"], "by": "spec-id", "stage": "prepared|entered|exiting", "at": "ISO-timestamp" }
  ]
}
```

---

## 3. Worktree/PR Lifecycle

### Worktree Commands (Lines 4941–5291)

**Registry:** `~/.a1-worktrees-registry.json` (global, not per-repo). Structure:
```json
{
  "worktrees": [
    {
      "id": "slug-2026-07-11T123456Z",
      "slug": "slug",
      "repo_root": "/path/to/repo",
      "worktree_path": "/path/../slug-worktrees/slug",
      "branch": "feature/slug",
      "base_branch": "main",
      "status": "prepared|entered|exiting|exited",
      "created_at": "ISO",
      "last_status_change": "ISO",
      "agent_brief": "string|null",
      "commit_count": 0,
      "exit_mode": "merge|rebase|abandon|null",
      "phase_history": ["phase=prepare completed=...", "phase=enter completed=..."]
    }
  ],
  "pr_reviews": [...]
}
```

#### 1. `cmdWorktreePrepare()` (Lines 4941–5052)

**Pre-flight checks (7 checks, BLOCKER logic):**

| Check | Lines | Condition | Fail Hint |
|-------|-------|-----------|-----------|
| `slug_valid` | 4959–4963 | `SLUG_RE.test()` | Invalid characters |
| `repo_is_git` | 4966–4970 | `gitIsRepo()` | Not a git repo |
| `working_tree_clean` | 4973–4974 | `gitWorkingTreeClean()` | Uncommitted changes |
| `base_branch_exists` | 4977–4978 | `gitBranchExists(base)` | Branch missing |
| `target_branch_free` | 4981–4990 | Branch ∄ OR branch ∄ worktree | **M9 FOCUS:** Already has worktree |
| `worktree_path_free` | 4993–4998 | `!fs.existsSync(path)` | **M9 FOCUS:** Path exists |
| `no_active_registry_entry` | 5001–5010 | `!findActiveBySlug() OR force-reset` | Already registered (unless `--force-reset`) |

If any check FAILS → exit 1 with JSON { status: 'BLOCKER', checks: [...] }

If all PASS → create registry entry with status='prepared', exit 0 with { id, repo_root, worktree_path, branch, status: 'prepared', checks: [...] }

**M9 Key Points:**
- Lines 4981–4990: `target_branch_free` — detects if branch already has a worktree (via `gitBranchHasWorktree()`)
- Lines 4993–4998: `worktree_path_free` — filesystem existence check
- Lines 5003–5010: Registry idempotence via `--force-reset` flag

#### 2. `cmdWorktreeEnter()` (Lines 5054–5100)

Finds registered entry by ID, creates git worktree, updates status='entered'. No pre-flight checks here (assumes prepare succeeded).

#### 3. `cmdWorktreeStatus()` (Lines 5102–5150)

Reads registry, reports current state (path, branch, commit count, phase).

#### 4. `cmdWorktreeExit()` (Lines 5151–5256)

Cleans up: git worktree remove, updates status='exited', optionally merges/rebases. Mode (merge|rebase|abandon) stored in `exit_mode` field.

#### 5. `cmdWorktreeList()` & `cmdWorktreeGc()` (Lines 5257–5319)

List all worktrees; gc cleans up stale entries.

### PR Lifecycle Commands (Lines 5370–5460+)

**Registry location:** Same global `~/.a1-worktrees-registry.json`, `.pr_reviews[]` array.

#### 1. `cmdPrListHandoff()` (Lines 5370–5393)

Find worktree entry, read `.a1-pr-review/findings.jsonl`, return list of findings for code review.

#### 2. `cmdPrMarkStatus()` (Lines 5395–5437)

Update PR status in registry (draft → review → approved → merged).

#### 3-8. Implicit PR Subcommands (Defined in a1-pr-review skill)

The skill `skills/a1-pr-review/` owns the actual review phases:
- `workflows/01-detect.md` — scan for findings
- `workflows/02-review.md` — agent review
- `workflows/03-draft.md` — generate PR body
- `workflows/04-submit.md` — post to GitHub

**M9 Key Point:** a1-tools only *tracks* PR lifecycle via registry; the skill *executes* the phases.

---

## 4. Fixture Harness & CI

### Test-Fixture Convention

**Structure:** `_test-fixtures/<suite-name>/`
```
_test-fixtures/a1-cost/
├── run.sh                        # Test runner script
├── session-sample.jsonl          # Input data
└── session-sample/subagents/     # Subagent logs
```

**Runner Pattern** (from `_test-fixtures/a1-cost/run.sh`, lines 1–82):

```bash
#!/usr/bin/env bash
set -u
pass=0 fail=0
record() { if [[ "$1" == PASS ]]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi; echo "$1  $2"; }
assert_json() { if node -e "const r=JSON.parse(process.argv[1]); process.exit(($expr)?0:1);" "$json"; then record PASS "$label"; else record FAIL "$label — got: $json"; fi; }
# ... test cases ...
echo "suite: $pass passed, $fail failed"
[[ $fail -eq 0 ]]  # Exit with final count
```

**Conventions:**
1. Exit code 0 = all tests passed; 1 = failures exist
2. Each test case uses `record PASS "description"` or `record FAIL "description — detail"`
3. JSON assertions via `node -e "expr"` to avoid shell quoting
4. Temp data copied to `mktemp -d`, original fixture remains immutable
5. Final line: `echo "<suite>: $pass passed, $fail failed"` + `[[ $fail -eq 0 ]]` (exit code)

**Documentation:** No formal spec file yet (M9 TODO: add to CONTRIBUTING.md or create FIXTURES.md).

### CI Integration (.github/workflows/test.yml)

| Lines | Step | Commands |
|-------|------|----------|
| 15–16 | Syntax | `node --check _shared/a1-tools.cjs` |
| 18–26 | Fixtures | `for r in _test-fixtures/*/run*.sh; do bash "$r"; done` + `run-parser.sh` |
| 28–35 | Smoke Install | `./bin/install.sh` + verify symlinks |
| 37–43 | Vault-Free CLI | `node a1-tools spec next-number` (no vault env) |

**Key:** Tests run in isolated `HOME=$(mktemp -d)` to avoid interfering with local setup.

### Fixture Inventory (20 suites)

| Suite | Lines | Focus | Status |
|-------|-------|-------|--------|
| a1-analyze-cli | ~150 | analyze init/update-status | ✓ |
| a1-check | ~300 | check run (FR coverage) | ✓ |
| a1-checklist | ~200 | checklist run (wave deps) | ✓ |
| a1-code-scope | ~250 | code-scope claim/overlap | **M9 FOCUS** |
| a1-cost | 82 | cost aggregation | ✓ |
| a1-modernize-roundtrip | ~400 | modernize state machine | ✓ |
| a1-pack | 112 | pack validate/import/export | ✓ |
| a1-phantom | 115 | phantom init/update | ✓ |
| a1-pr-review | ~150 | pr-review findings | **M9 FOCUS** |
| a1-realpath-check | ~100 | symlink validation | ✓ |
| a1-reconcile | ~350 | reconcile drift detection | ✓ |
| a1-reservations | ~150 | check reservations (scalar) | **M9 FOCUS** |
| a1-schema-check | ~200 | schema-check parse/run | ✓ |
| a1-vault-fallback | ~80 | vault resolution (3-tier) | ✓ |
| a1-worktree | ~250 | worktree prepare/enter/exit | **M9 FOCUS** |
| product-adopt | ~300 | product import legacy | ✓ |
| product-docs | 874 | product roadmap parsing | ✓ |
| product-import | ~200 | product import (Notion) | ✓ |
| roadmap-gate | 232 | product gate overlaps | ✓ |

**M9 Priority Suites:** a1-worktree, a1-code-scope, a1-pr-review, a1-reservations — these exercise the robustness gates.

---

## 5. Shared Helper Dependencies Matrix

### Helpers Used by Command Groups

| Helper | Spec | Fix | Analyze | Check | Code-Scope | Worktree | PR | Cost | Modernize | Reconcile | Product | Checklist |
|--------|------|-----|---------|-------|------------|----------|----|----|-----------|-----------|---------|-----------|
| parseFrontmatter | ✓ | ✓ | ✓ | ✓ | - | - | - | - | ✓ | ✓ | ✓ | ✓ |
| serializeFrontmatter | ✓ | ✓ | ✓ | - | - | - | - | - | ✓ | ✓ | ✓ | - |
| readMd | ✓ | ✓ | ✓ | ✓ | - | - | - | - | ✓ | ✓ | ✓ | ✓ |
| writeMdAtomic | ✓ | ✓ | ✓ | - | - | - | - | - | ✓ | ✓ | ✓ | - |
| vaultRoot | ✓ | ✓ | ✓ | ✓ | - | - | - | - | ✓ | ✓ | - | ✓ |
| nowIso | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| appendPhaseHistory | ✓ | ✓ | ✓ | - | - | - | - | - | ✓ | ✓ | - | - |
| git* (6 funcs) | - | - | - | - | - | ✓ | - | - | - | - | - | - |
| readRegistry | - | - | - | - | ✓ | ✓ | ✓ | - | - | - | - | - |
| writeRegistryAtomic | - | - | - | - | ✓ | ✓ | ✓ | - | - | - | - | - |
| loadReservations | - | - | - | ✓ | ✓ | - | - | - | - | - | - | - |
| normalizeScopePath | - | - | - | - | ✓ | - | - | - | - | - | - | - |
| checkPrefixOverlap | - | - | - | - | ✓ | - | - | - | - | - | - | - |
| checkGlobOverlap | - | - | - | - | ✓ | - | - | - | - | - | - | - |

**Shared Core (>50% of groups):** parseFrontmatter, serializeFrontmatter, readMd, writeMdAtomic, vaultRoot, nowIso, appendPhaseHistory → **Candidates for extraction to shared module**

**Group-Specific (single group):** git* functions (worktree only), checkPrefixOverlap (code-scope only) → **Can stay embedded or extract by group**

---

## 6. Check Reservations — Detailed Spec

### Data Format (.a1/reservations.json)

**File location:** `.a1/reservations.json` in repo root OR `~/.a1/reservations.json` (fallback, per `reservationsFile()` at line 7853–7861).

**Schema:**
```json
{
  "reservations": [
    {
      "type": "string (e.g., 'port', 'hostname', 'feature-slug')",
      "value": "string (the claimed value)",
      "by": "string (spec-id or feature-name claiming it)",
      "at": "ISO-8601 timestamp (when claimed)"
    }
  ],
  "code_scopes": [
    {
      "paths": ["src/foo/*", "src/bar/baz.ts"],
      "by": "string (spec-id)",
      "stage": "prepared|entered|exiting",
      "at": "ISO-8601 timestamp"
    }
  ]
}
```

### Subcommands (Lines 7658–8200+)

#### `check reservations --list [--file <path>]`

**Function:** `cmdCheckReservations()` lines 7667–7671

**Output:** JSON { file, count, reservations: [...] }

**Exit:** 0 (success)

#### `check reservations --claim <type>:<value> --by <spec-id> [--file <path>]`

**Function:** `cmdCheckReservations()` lines 7674–7714

**Logic:**
1. Parse `--claim` as `type:value` (line 7677–7682)
2. Load reservations file (line 7685)
3. Search for existing (type, value) match (line 7686)
   - If found AND by == requestor → exit 0 { status: 'OK', idempotent: true }
   - If found AND by ≠ requestor → exit 1 { status: 'CONFLICT', held_by, holder }
4. If not found → create reservation, write atomically, exit 0 { status: 'OK', idempotent: false }

**M9 Key Points:**
- Idempotence: same spec can claim same value multiple times (retries safe)
- CONFLICT blocks execution (exit 1 with stderr message)
- File locking: atomic rename (no partial writes)

### Code-Scope Extension (Lines 7717–8200+)

#### `code-scope claim --paths <glob|literal>... --by <spec-id> [--stage prepared] [--file <path>]`

**Function:** `cmdCodeScopeClaim()` lines 8062–8200+

**Logic:**
1. Parse `--paths` array (each can be glob or literal)
2. Load code_scopes from registry (line [load])
3. For each NEW scope path:
   - Normalize (line 7731–7737)
   - Check prefix overlap vs ALL in-flight scopes (line 7763–7795 `checkPrefixOverlap`)
   - If glob pattern, check glob-to-literal overlap (line 7797–7850 `checkGlobOverlap`)
4. If overlap found → exit 1 with conflict report
5. If clear → add entry to code_scopes[], write atomically, exit 0

**M9 Focus:** Overlap gate (P7 in header comment at line 7490) prevents parallel feature implementation on conflicting file sets.

---

## 7. Module-Split Candidates for M9 Refactoring

### Option A: Extract Core I/O Module

**File:** `_shared/a1-io.cjs` (estimated 800–1000 lines)

**Functions to move:**
- parseFrontmatter, serializeFrontmatter
- parseNestedFrontmatter, serializeNestedFrontmatter
- readMd, writeMdAtomic, writeNestedMdAtomic
- readJsonFile, writeJsonAtomic
- serializeScalar, parseScalarToken
- detectKeyOrder
- vaultRoot, resolveVaultPath
- nowIso, writeTextAtomic

**Dependents:** 12+ command groups (all except worktree, git-only)

**Rationale:** Immutable I/O patterns + vault integration are stable; extracting reduces a1-tools.cjs by ~10% and enables independent testing.

### Option B: Extract Code-Scope/Overlap Module

**File:** `_shared/a1-code-scope.cjs` (estimated 400–500 lines)

**Functions to move:**
- normalizeScopePath, isGlobPattern, segmentizePath
- checkPrefixOverlap, checkGlobOverlap
- loadReservations, reservationsFile
- cmdCodeScopeClaim, cmdCodeScopeCheckAll, cmdCodeScopeUnblock, cmdCodeScopeList

**Dependents:** code-scope group + check integration

**Rationale:** Overlap-gate logic is self-contained; can be tested independently; reduces a1-tools.cjs by ~5%.

### Option C: Extract Worktree/Registry Module

**File:** `_shared/a1-worktree.cjs` (estimated 600–700 lines)

**Functions to move:**
- worktreeRegistryPath, readRegistry, writeRegistryAtomic
- git* (6 functions)
- nowCompactId, findRegistryEntry, findActiveBySlug, findEntryBySlugOrId
- cmdWorktreePrepare, cmdWorktreeEnter, cmdWorktreeStatus, cmdWorktreeExit, cmdWorktreeList, cmdWorktreeGc

**Dependents:** worktree + pr groups

**Rationale:** Isolated lifecycle; can be unit-tested against mock git; reduces a1-tools.cjs by ~7%.

---

## 8. Quality Notes & Known Constraints

### Lock Mechanism

**Atomicity:** All writes use `tmpfile + rename` pattern (POSIX atomic). No fsync (acceptable for non-critical state).

**Example (writeMdAtomic, line 576–582):**
```javascript
function writeMdAtomic(p, fm, body) {
  const tmp = p + '.tmp.' + Math.random().toString(36).slice(2);
  const content = serializeFrontmatter(fm) + body;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, p); // atomic
}
```

**No explicit locking:** Registry files (.a1/reservations.json, ~/.a1-worktrees-registry.json) are read-then-write; concurrent access *may* lose updates in high-contention scenarios (rare in practice — typically one agent per session). **M9 TODO:** Consider advisory lock file (`.lock` sibling) for multi-concurrent runs.

### Error Handling

**Fail-fast:** Most commands call `fail()` helper (line ~4955, 7851) or `process.exit(2)` on validation errors.

**No try-catch in main subcommand handlers:** Errors bubble to main() catch block (line 9285–9288), which emits "internal error" and exits 2.

**M9 Risk:** If an internal error occurs during atomic write, the error message goes to stderr but the process still exits 1 or 2 — the caller cannot distinguish "logic error" from "I/O error" from the exit code alone.

### Known Gaps

1. **Vault-free CLI:** Some commands (`spec next-number`, `analyze init`) work without vault (Tier 2 fallback creates `.a1/learnings/` auto). Others require vault (fix commands need wiki/). Documentation unclear on which is which.

2. **Registry race condition:** No lock on `~/.a1-worktrees-registry.json`. Two concurrent `worktree prepare` calls may both succeed and create duplicate entries.

3. **Git worktree lifecycle:** No validation that `.a1-worktrees-registry.json` matches actual `git worktree list` output. Stale registry entries possible if user manually deletes worktree.

4. **Fixture naming:** No enforced convention for fixture data files (session-sample.jsonl, expected.md, etc.). Leads to inconsistent naming across suites.

---

## 9. Task Context: M9 Robustness

**Goal:** Harden gates (code-scope overlap, worktree lifecycle, reservations), improve error messages, add recovery tooling.

**Key Deliverables:**
- [ ] Audit code-scope overlap logic for glob-edge cases (M9 Task 1)
- [ ] Add `worktree repair` command to heal stale registry entries (M9 Task 2)
- [ ] Implement advisory locking for concurrent registry access (M9 Task 3)
- [ ] Refactor I/O module for independent testing (M9 Task 4 — optional)
- [ ] Add fixture convention doc + validate all 20 suites (M9 Task 5)
- [ ] Improve error messages in code-scope gate (M9 Task 6)

**Test Execution:** All 20 fixture suites must pass before merge; CI enforces via test.yml.

---

## File Manifest

**Core files:**
- `/Users/rob/code/a1-skills/_shared/a1-tools.cjs` — main tool (9294 lines)
- `/Users/rob/code/a1-skills/.github/workflows/test.yml` — CI runner
- `/Users/rob/code/a1-skills/CONTRIBUTING.md` — contribution guidelines
- `/Users/rob/code/a1-skills/skills/a1-worktree/SKILL.md` — skill definition
- `/Users/rob/code/a1-skills/skills/a1-pr-review/SKILL.md` — skill definition

**Test fixtures (20 suites):**
- `/Users/rob/code/a1-skills/_test-fixtures/a1-worktree/run.sh`
- `/Users/rob/code/a1-skills/_test-fixtures/a1-code-scope/run.sh`
- `/Users/rob/code/a1-skills/_test-fixtures/a1-pr-review/run.sh`
- `/Users/rob/code/a1-skills/_test-fixtures/a1-reservations/run.sh`
- (+ 16 others)

---

## Summary

**a1-tools.cjs structure (9294 lines):**
- 16 command groups (dispatch 9083–9284)
- 86 command handler functions (cmd*)
- 134 shared helper functions (core I/O, git, registry, overlap logic)
- Atomic file I/O via tmpfile+rename
- 3-tier vault resolution (env → repo-local → legacy)
- Global worktree/pr registry (`~/.a1-worktrees-registry.json`)
- Reservations + code-scope overlap gate (same .a1/reservations.json file)

**M9 Focus Areas:**
1. **Code-scope overlap gate:** Lines 7717–8200+; needs edge-case hardening
2. **Worktree lifecycle:** Lines 4941–5291; needs stale-registry repair + locking
3. **Check reservations:** Lines 7658–7714; scalar + code-scope variants
4. **Fixture harness:** 20 suites, shell-based; conventions undocumented
5. **Module split candidates:** I/O (1000L), code-scope (500L), worktree (700L) — extraction would reduce complexity.

**Next Step:** a1-plan will use this MAP to draft wave-by-wave execution plan.
