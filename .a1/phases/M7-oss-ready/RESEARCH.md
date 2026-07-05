---
goal: M7 "OSS-Ready" — an external user goes from `git clone` to first verified feature without editing a single file
generated: 2026-07-05
focus_areas: portability, hardcode inventory, language unification, CI/CD, checkpoint isolation
---

# Research: M7 OSS-Ready

## Executive Summary

M7 requires eliminating 115+ hardcoded paths and vault dependencies that block external users. The main issues:
1. **Vault hardcodes:** 52 references to `~/N3URAL-Vault` (14 in prose, 2 in shell snippets; the rest rely on `a1-tools.cjs` which already respects `A1_VAULT_ROOT`)
2. **Personal paths:** 32 `/Users/rob` references (mostly in learning docs and phase dirs — safe to clean; none in active skill code)
3. **Repo-root paths:** 31 `~/code/a1-skills` references in a1-evolve and docs (must become dynamic via git root detection)
4. **Vault fallback contract:** Missing graceful degradation to `.a1/learnings/` when vault doesn't exist — today it silently fails
5. **CI/CD:** No GitHub Actions; all 10 test fixtures need to be run on PR; a1-phantom runner missing
6. **Checkpoint skill:** Lives in public repo but depends on personal Cloud-Brain API credentials — must be moved to private overlay
7. **Language mix:** 8+ skills have German prompts; roadmap says "unify to English (keep German trigger phrases as aliases)" but implementation path unclear

---

## Tech Stack

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥ 18 | Required by a1-tools.cjs, install.sh assumes available |
| Git | Latest | Required for repo detection, symlink ops, commit workflow |
| Bash | 4+ | Shell scripts for test runners, install.sh |
| Claude Code CLI | Latest | User's environment (not bundled) |
| Obsidian Vault | Optional | Today: required; M7: optional via `A1_VAULT_ROOT`, fallback to `.a1/learnings/` |

---

## Relevant Codebase Patterns

### Vault Path Resolution (Already Works for Portability)

**File:** `/Users/rob/code/a1-skills/_shared/a1-tools.cjs` lines 256–258

```javascript
function vaultRoot() {
  if (process.env.A1_VAULT_ROOT) return process.env.A1_VAULT_ROOT;
  return path.join(os.homedir(), 'N3URAL-Vault');
}
```

**Status:** ✓ Already respects `A1_VAULT_ROOT` env var. All 32 vault operations go through this function or `resolveVaultPath()`.

**Limitation:** Hardcoded fallback to `~/N3URAL-Vault` on line 258 breaks on fresh machines without a vault. Need fallback chain:
1. `A1_VAULT_ROOT` if set
2. `.a1/learnings/` in git repo (repo-local, always writable)
3. `~/N3URAL-Vault` (legacy, with deprecation warning)

### Vault Hardcode Distribution

| Type | Count | Severity | Fix Type |
|------|-------|----------|----------|
| Prose (README, SKILL.md, docs) | ~14 | LOW | Documentation update only |
| Shell snippets in workflows | 2 | HIGH | Replace with env-var + fallback pattern |
| Examples in _learning.md | ~3 | LOW | Remove personal example paths |
| Already env-var-safe (a1-tools.cjs calls) | 32 | NONE | No change needed if vaultRoot() improved |

**Key files with vault prose:**
- `README.md:49` — default value in config table
- `a1-new-feature/SKILL.md:138`, `a1-modernize/SKILL.md:150`, `a1-reconcile/SKILL.md:133`, `a1-check/SKILL.md:68`, `checkpoint/SKILL.md:65,121` — all say "Default vault root: ~/N3URAL-Vault/"
- `a1-analyze/SKILL.md:119`, `a1-constitution/SKILL.md:114` — same pattern
- `a1-fix/workflows/00-preflight.md:46-47` — example paths

**Shell snippets (MUST FIX):**
- `a1-evolve/workflows/01-collect.md:9` — `VAULT="$HOME/N3URAL-Vault"`
- `a1-evolve/workflows/04-apply.md:28` — `VAULT="$HOME/N3URAL-Vault"`

### Repo-Root Hardcodes in a1-evolve

**File:** `a1-evolve/workflows/04-apply.md:58`

```bash
git -C ~/code/a1-skills add agents/ */SKILL.md */workflows/
git -C ~/code/a1-skills commit -m "evolve: apply..."
```

**Risk:** External user clones to `/home/alice/a1-specforge/` → command fails. Need dynamic repo root:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
git -C "$REPO_ROOT" add ...
```

**Other instances:**
- `a1-evolve/SKILL.md` description: "Commits applied changes to ~/code/a1-skills/."
- `a1-evolve/workflows/04-apply.md` multiple git commands
- README.md installation example

### Personal Path Cleanup

**Safe to remove (no runtime dependency):**
- `a1-plan/_learning.md:45` — personal session example
- `a1-modernize/workflows/01-scope.md:38` — example in German prompt
- `checkpoint/SKILL.md:49` — slug calculation example
- `.a1/phases/M6-works-for-rob/` — entire phase directory (contextual docs, can use `$(git rev-parse --show-toplevel)`)

**Action:** Replace `/Users/rob/code/...` with placeholder or relative paths for M7 docs.

---

## External Dependencies & Fallback Contracts

### Vault Fallback Chain (Must Define for M7)

**Current state:** If `A1_VAULT_ROOT` not set and `~/N3URAL-Vault` doesn't exist, operations fail with unclear errors.

**M7 requirement:** Define graceful fallback:

1. **Tier 1 (Explicit):** `A1_VAULT_ROOT` env var if set
2. **Tier 2 (Repo-local):** `$(git rev-parse --show-toplevel)/.a1/learnings/` (always writable, no external dependency)
3. **Tier 3 (Legacy):** `~/N3URAL-Vault` (with deprecation warning to stderr)
4. **Tier 4 (Fail-safe):** If all three paths don't exist, create Tier 2 (`git-toplevel/.a1/learnings/`) automatically on first write

**Implementation needed in `a1-tools.cjs`:**

```javascript
function vaultRoot() {
  // Tier 1: explicit env var
  if (process.env.A1_VAULT_ROOT) {
    const vault = process.env.A1_VAULT_ROOT;
    ensureDirExists(vault);
    return vault;
  }

  // Tier 2: repo-local (preferred for OSS)
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    const repoLocal = path.join(repoRoot, '.a1', 'learnings');
    ensureDirExists(repoLocal);
    return repoLocal;
  } catch {
    // not in a git repo
  }

  // Tier 3: legacy (with warning)
  const legacy = path.join(os.homedir(), 'N3URAL-Vault');
  if (fs.existsSync(legacy)) {
    console.warn('[a1-tools] Using legacy vault at', legacy, '— prefer A1_VAULT_ROOT or repo-local .a1/learnings/');
    return legacy;
  }

  // Tier 4: create repo-local as fallback
  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const repoLocal = path.join(repoRoot, '.a1', 'learnings');
  fs.mkdirSync(repoLocal, { recursive: true });
  return repoLocal;
}
```

**Contract for skills:**
- Always use `.a1/learnings/` for new projects by default (no external vault required)
- If user wants to use their Obsidian vault, set `A1_VAULT_ROOT=/path/to/vault`
- Learning data syncs to both locations if `A1_VAULT_ROOT` is set

**Breaking change risk:** Medium. Some workflows assume vault structure (`~/N3URAL-Vault/projects/<slug>/spec/`). Tier 2 must replicate this structure in `.a1/learnings/projects/<slug>/spec/`.

---

## CI/CD Requirements

### Test Fixtures Inventory

| Fixture | Has Runner | Status | Notes |
|---------|-----------|--------|-------|
| a1-analyze-cli | run-tests.sh | ✓ | CLI tests |
| a1-check | run-tests.sh | ✓ | Spec consistency checks |
| a1-checklist | run-tests.sh | ✓ | Pre-flight gates |
| a1-cost | run.sh | ✓ | Token aggregation |
| a1-modernize-roundtrip | run.sh | ✓ | Frontmatter fidelity |
| a1-phantom | **MISSING** | ✗ | Has 3 subdirs (clean, no-code-tag, phantoms) but no runner |
| a1-pr-review | run-test.sh | ✓ | PR gate checks |
| a1-reconcile | run-tests.sh | ✓ | Spec drift detection |
| a1-schema-check | run.sh + parser/run-parser.sh | ✓ | SQL schema validation |
| a1-worktree | run-tests.sh | ✓ | Git worktree lifecycle |

**a1-phantom fixture structure:**
```
_test-fixtures/a1-phantom/
├── clean/             (5 files — clean PLAN.md)
├── no-code-tag/       (5 files — missing [X] code tags)
└── phantoms/          (5 files — phantom tasks in PLAN.md)
```

**Needed runner:** Iterate through subdirs, run `node ... a1-tools phantom-check ...` on each, validate exit code and output format.

### GitHub Actions Pipeline (M7 Blocker)

**Missing:** No `.github/workflows/` directory.

**Needed for M7:**

1. **File:** `.github/workflows/test.yml`
   - Trigger: on push to any branch, on PR
   - Steps:
     - Checkout repo
     - Setup Node.js (>= 18)
     - Run all `_test-fixtures/*/run*.sh`
     - Run new `_test-fixtures/a1-phantom/run.sh`
     - **Smoke test install.sh** on a clean `$HOME`:
       ```bash
       mkdir -p /tmp/test-home/.claude/{skills,agents}
       HOME=/tmp/test-home bash ./bin/install.sh
       # Verify symlinks exist
       test -L /tmp/test-home/.claude/skills/a1-new-feature
       ```
     - Report results (fail if any fixture fails)

2. **File:** `.github/workflows/lint.yml`
   - Check for hardcodes: grep for `/Users/rob`, `~/code/a1-skills`, `~/N3URAL-Vault` (with whitelist)
   - Check frontmatter consistency (YAML round-trip via a1-tools)

---

## Checkpoint Skill Isolation

### Current State

**Location:** `/Users/rob/code/a1-skills/checkpoint/`

**Files:**
- `SKILL.md` (17.7 KB) — German trigger phrases, multi-layer persistence (Obsidian, Cloud-Brain, git)
- `push-to-brain.py` (3.5 KB) — API sync script for Cloud-Brain

**Installation:**
- Commented out in `bin/install.sh` line 55: `# Deliberately NOT installed: checkpoint`
- BUT: Actually symlinked to `~/.claude/skills/checkpoint/` (exists in Rob's environment)

### OSS Blocker

**Dependencies:**
1. Obsidian Vault (`~/N3URAL-Vault/`) — can be optional via env var (M7 handles this)
2. **Cloud-Brain API** (`brain-proxy-mt` endpoint) — **PERSONAL, N3URAL.AI only**
3. **BRAIN_ROBERT_TOKEN secret** — hardcoded credential path (`security find-generic-password -s brain-robert-token`)

**Lines 87–108 (Step 3b — Cloud-Brain Sync):**
```
export BRAIN_ROBERT_TOKEN="$(security find-generic-password -s brain-robert-token -w)"
curl -X POST https://brain-proxy-mt/...
```

**Action for M7:** This skill must NOT be in the public repo. It's personal tooling for Robert's workflow.

### Migration Plan

1. **Delete from public repo:**
   - Remove `/Users/rob/code/a1-skills/checkpoint/` from git
   - Remove from `install.sh` (already commented; fully remove the section)

2. **Move to private overlay:**
   - Create `~/.claude/skills-private/checkpoint/` (or symlink from a private repo)
   - Robert updates his `.claude/skills` symlink manually or via a private bootstrap script
   - `install.sh --include-private` flag (future option, not M7 scope)

3. **Document transition:**
   - Add note to README: "The `checkpoint` skill is personal to this project and lives in a private repo. External users can build their own or skip it."
   - Keep the architecture (vault + memory + git) as a pattern example in docs/

---

## Language Unification Strategy

### Current State by Skill

| Skill | User Prompts | File Content | Status |
|-------|--------------|--------------|--------|
| a1-analyze | English | English | ✓ Aligned |
| a1-checklist | Translated to EN | English | ✓ Aligned (translated from German) |
| a1-constitution | English | English | ✓ Aligned |
| a1-reconcile | English | English | ✓ Aligned |
| a1-check | German | English | ⚠ Mixed |
| a1-fix | German | English | ⚠ Mixed |
| a1-modernize | German | English | ⚠ Mixed |
| a1-new-feature | **MIXED** (triggers EN, workflow EN) | English | ⚠ Mixed |
| a1-phantom | German | English (JSON format) | ⚠ Mixed |
| a1-pr-review | German | English (PR body) | ⚠ Mixed |
| a1-worktree | German | English | ⚠ Mixed |
| a1-plan | Not documented | English | ? Unknown |
| a1-execute | Not documented | English | ? Unknown |
| a1-progress | Not documented | English | ? Unknown |
| a1-roadmap | Not documented | English | ? Unknown |
| a1-evolve | Not documented | English | ? Unknown |

### M7 Requirement: "Unify to English (keep German trigger phrases as aliases)"

**Interpretation:**

1. **File content & output:** Always English (no change needed)
2. **User prompts in workflows:** Translate to English as primary
3. **Trigger phrases in SKILL.md:** Keep German as aliases under existing English triggers
4. **Example:**
   ```yaml
   triggers:
     - "bug in <project>: X is broken"  # English (primary)
     - "bug in <project>: X funktioniert nicht"  # German (alias)
     - "fehler in <project>"  # German alias
   ```

### Implementation Path

1. Update all `a1-*/SKILL.md` `triggers:` sections to list English first, German aliases after
2. For workflows with German prompts (a1-fix/workflows/00-preflight.md, etc.), add English alternative or translate to English
3. Document language policy in README: "All prompts are English. German is supported as input aliases for backward compatibility."
4. Update 8 "not documented" skills to specify their language strategy in SKILL.md

### Risk: User Expectations

- Current users (mostly Rob) use German triggers and expect German feedback
- External users expect English
- Solution: Workflows can check user locale/Claude language setting, but M7 scope is simpler — just be English-first

---

## Vault Write Contracts & Failure Modes

### What Writes Happen at Runtime?

All writes go through `a1-tools.cjs` helpers:
- `spec next-number` → creates `projects/<slug>/spec/OF-P-*.md`
- `fix next-suffix` → creates `projects/<slug>/fixes/<date>-<slug>.md`
- `analyze init` → creates `projects/<slug>/analyses/<date>-<focus>.md`
- `constitution init` → creates `projects/<slug>/constitution.md`

### Failure Mode: Fresh External User, No Vault

**Scenario:**
1. User clones `a1-specforge` to `/home/alice/a1-specforge/`
2. Runs `./bin/install.sh` ✓ (no vault needed)
3. Runs `a1-new-feature` for first time
4. Skill calls `a1-tools spec next-number my-project`
5. vaultRoot() returns `~/N3URAL-Vault` (doesn't exist) → `mkdir -p` fails silently or returns error
6. Alice sees: `spec next-number failed: ENOENT: no such file or directory`

**M7 fix:** Apply fallback chain above. First write to `.a1/learnings/` succeeds automatically.

### .a1/learnings/ Structure (New)

For M7 OSS users, the default vault structure becomes repo-local:

```
.a1/learnings/
├── projects/
│   └── my-project/
│       ├── spec/
│       │   ├── OF-P-001.md
│       │   └── OF-P-002.md
│       ├── fixes/
│       │   ├── 2026-07-05-bug-title.md
│       │   └── ...
│       └── analyses/
│           ├── 2026-07-05-general.md
│           └── ...
├── pattern/
│   └── a1-learnings/
│       ├── index.md
│       ├── patterns.md
│       ├── a1-new-feature.md
│       └── ...
└── ...
```

This is `.gitignore`'d to prevent committing project specs, but learnings can be optionally committed for team sharing.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Vault fallback breaks existing workflows** | HIGH | Extensive testing: run M5 + M6 phases with `.a1/learnings/` only, no `A1_VAULT_ROOT` set. Add fixture: `a1-tools-vault-fallback/`. |
| **checkpoint skill still accessible as symlink** | MEDIUM | Remove from git now; add to `.gitignore` if it ever comes back; add pre-commit hook to reject checkpoint/ paths. |
| **Personal paths leak in documentation** | LOW | Grep for `/Users/rob`, `mellow-rob`, personal email in RESEARCH/PLAN/VERIFICATION docs; sanitize before release. |
| **a1-phantom runner has hidden dependencies** | MEDIUM | Build runner now; test on CI; ensure no hardcoded paths or vault assumptions. |
| **install.sh assumes `~/.claude/{skills,agents}` exist** | LOW | Script already creates them with `mkdir -p`. Verify on clean `$HOME` in CI. |
| **German-only users confused by English prompts** | LOW | Migration doc + changelog entry; keep German aliases active for ~2 releases. |
| **Vault sync to Cloud-Brain breaks without token** | N/A | checkpoint moves to private; no public breaking. |

---

## Recommendations for Planner

1. **Immediate (Portability Foundation — Week 1):**
   - Update `a1-tools.cjs` vaultRoot() with fallback chain (Tier 1–4)
   - Fix 2 shell snippets in a1-evolve workflows (lines 9, 28)
   - Add dynamic repo-root detection (git rev-parse) to a1-evolve/workflows/04-apply.md
   - Delete checkpoint/ from git; add to .gitignore
   - Update README.md vault config section with "A1_VAULT_ROOT is optional; defaults to `.a1/learnings/` in repo"

2. **Documentation (Week 1):**
   - Update 14 SKILL.md files: change "Default vault root: ~/N3URAL-Vault/" to "Defaults to repo-local `.a1/learnings/`; override with A1_VAULT_ROOT"
   - Add language strategy to 5 "not documented" skills (a1-plan, a1-execute, a1-progress, a1-roadmap, a1-evolve)
   - Create `docs/PORTABILITY.md` explaining vault fallback chain & fresh-machine setup
   - Remove `/Users/rob` examples from learning docs and .a1/phases/ prose

3. **CI/CD (Week 2):**
   - Create `.github/workflows/test.yml`: run all `_test-fixtures/*/run.sh`
   - Create `_test-fixtures/a1-phantom/run.sh`: iterator through subdirs, run phantom check, validate exit codes
   - Add `install.sh` smoke test to CI with clean `$HOME`
   - Create `.github/workflows/lint.yml`: grep for hardcodes (with whitelist), check YAML round-trip

4. **Language Unification (Week 2):**
   - Update `a1-*/SKILL.md` `triggers:` to list English first, German aliases as comments or separate section
   - Translate German prompts in 5 workflows to English (with German alternative noted)
   - Document policy in README: "English-first, German aliases supported"

5. **Testing & Validation (Week 2–3):**
   - Run M5 + M6 phases with NO `A1_VAULT_ROOT` set, no personal vault → all specs must land in `.a1/learnings/`
   - Fresh-machine test: clean `/tmp/test-home`, clone repo, run install.sh, run a1-new-feature → spec written to `.a1/learnings/`
   - Verify all CI tests pass on main branch

---

## Key File References

### Hardcode Sites (Priority Order)

| File | Line(s) | Category | Action |
|------|---------|----------|--------|
| `_shared/a1-tools.cjs` | 256–258 | Vault root function | **FIX** — add fallback chain |
| `a1-evolve/workflows/01-collect.md` | 9 | Shell snippet | **FIX** — use `$(git rev-parse ...)`/`.a1/learnings/` |
| `a1-evolve/workflows/04-apply.md` | 28, 58 | Shell snippets | **FIX** — dynamic repo root + vault path |
| `README.md` | 49 | Documentation | **UPDATE** — explain fallback |
| `a1-new-feature/SKILL.md` | 138 | Prose | **UPDATE** — vault config docs |
| `a1-modernize/SKILL.md` | 150 | Prose | **UPDATE** — vault config docs |
| `a1-reconcile/SKILL.md` | 133 | Prose | **UPDATE** — vault config docs |
| `checkpoint/SKILL.md` | all | Private skill | **DELETE** from public repo |
| `bin/install.sh` | 55–56 | Comment | **REMOVE** — checkpoint section |

### Test Fixtures & CI

| File | Status | M7 Action |
|------|--------|----------|
| `_test-fixtures/a1-phantom/` | No runner | **CREATE** `run.sh` |
| `.github/workflows/` | Not exist | **CREATE** `test.yml`, `lint.yml` |

### Language Documentation

| File | Action |
|------|--------|
| `a1-*/SKILL.md` (14 files) | **UPDATE** — unify language strategy |
| `README.md` | **ADD** — language policy section |
| `docs/PORTABILITY.md` | **CREATE** — fresh-machine setup guide |

---

## Success Criteria

1. **Fresh-machine test passes:**
   - Clone `a1-specforge` to `/tmp/test-oss/`
   - Run `./bin/install.sh` with no `A1_VAULT_ROOT` set
   - Run `a1-new-feature` interactively
   - Spec file created in `.a1/learnings/projects/<slug>/spec/` ✓
   - Zero file edits by user ✓

2. **CI green:**
   - All 10 test fixtures pass on PR ✓
   - a1-phantom runner executes all subdirs ✓
   - lint.yml finds zero hardcodes (except in comments/docs with whitelist) ✓
   - install.sh smoke test succeeds ✓

3. **Documentation complete:**
   - README updated; vault section clear ✓
   - 14 SKILL.md files document language strategy ✓
   - `docs/PORTABILITY.md` explains fallback chain ✓
   - No `/Users/rob` in public docs (except phase history) ✓

4. **Checkpoint isolated:**
   - `checkpoint/` removed from git ✓
   - Added to `.gitignore` ✓
   - No symlink in default install.sh ✓
