---
focus: all
generated: 2026-07-05
phase: M7-oss-ready
task: Portability, hardcode removal, checkpoint isolation, CI/CD, language unification
---

# Codebase Map — M7 OSS-Ready

## Structure

```
/Users/rob/code/a1-skills/
├── a1-*/                      # 17 public skills (analyze, check, checklist, constitution, evolve, execute, fix, new-feature, new-project, plan, phantom, pr-review, progress, reconcile, roadmap, worktree, modernize)
│   ├── SKILL.md               # Skill definition (frontmatter + description)
│   ├── workflows/*.md         # Step-by-step execution guides (prose + code snippets)
│   ├── agents/                # Project-specific agents (new-feature, modernize, reconcile only)
│   ├── templates/             # Response templates (new-feature, reconcile)
│   └── _learning.md           # Retro + observations (auto-generated)
│
├── checkpoint/                # **PERSONAL ONLY** — Cloud-Brain sync + Vault persistence
│   ├── SKILL.md               # German-language, multi-layer checkpoint (Vault + Cloud-Brain API)
│   └── push-to-brain.py       # Cloud-Brain sync script (uses BRAIN_ROBERT_TOKEN secret)
│
├── agents/                    # 17 shared a1-framework agents (a1-<name>-<role>.md)
├── bin/install.sh             # Symlink installer (creates ~/.claude/skills/* and ~/.claude/agents/*)
├── _shared/                   # Common utilities
│   ├── a1-tools.cjs           # Core CLI: frontmatter parser, vault resolution, spec/fix/analyze subcommands
│   └── learnings-index.md     # Cache (canonical = Obsidian Vault pattern/a1-learnings/)
│
├── _test-fixtures/            # 10 fixture directories + runners
│   ├── a1-analyze-cli/run-tests.sh
│   ├── a1-check/run-tests.sh
│   ├── a1-checklist/run-tests.sh
│   ├── a1-cost/run.sh
│   ├── a1-modernize-roundtrip/run.sh
│   ├── a1-phantom/            # **MISSING RUNNER** (has 3 subdirs: clean/, no-code-tag/, phantoms/)
│   ├── a1-pr-review/run-test.sh
│   ├── a1-reconcile/run-tests.sh
│   ├── a1-schema-check/run.sh + parser/run-parser.sh
│   └── a1-worktree/run-tests.sh
│
├── .a1/                       # Phase state & learning store
│   └── phases/M7-oss-ready/   # This phase's RESEARCH/PLAN/VERIFICATION
│
└── README.md, docs/           # Public documentation

Symlinks (live in ~/.claude/):
  ~/.claude/skills/*            → /Users/rob/code/a1-skills/a1-*/
  ~/.claude/agents/*            → /Users/rob/code/a1-skills/agents/a1-*-*.md/
  ~/.claude/skills/_shared      → /Users/rob/code/a1-skills/_shared/
  ~/.claude/skills/checkpoint   → CURRENTLY SYMLINKED (should NOT be in public install.sh after M7)
```

---

## Tech Stack

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥18 | Required by a1-tools.cjs, install.sh assumes available |
| Git | Latest | Required for repo detection (git rev-parse), symlink ops, commit workflow |
| Bash | 4+ | Shell scripts for install.sh, test runners |
| Claude Code CLI | Latest | User's environment (not bundled); commands invoke MCP skills |
| Obsidian Vault | Optional (M7 goal) | Today: required for learning store; M7: optional via A1_VAULT_ROOT, fallback to `.a1/learnings/` |

---

## Architecture — Vault Path Resolution

### Current vaultRoot() Implementation

**File:** `/Users/rob/code/a1-skills/_shared/a1-tools.cjs:256–258`

```javascript
function vaultRoot() {
  if (process.env.A1_VAULT_ROOT) return process.env.A1_VAULT_ROOT;
  return path.join(os.homedir(), 'N3URAL-Vault');
}
```

### Limitation

Hardcoded fallback to `~/N3URAL-Vault` breaks on fresh machines without a vault. **M7 must implement fallback chain:**

1. **Tier 1:** `A1_VAULT_ROOT` env var (explicit override)
2. **Tier 2:** `.a1/learnings/` in git repo (repo-local, always writable, preferred for OSS)
3. **Tier 3:** `~/N3URAL-Vault` (legacy, with deprecation warning to stderr)
4. **Tier 4:** Auto-create Tier 2 on first write if all prior paths don't exist

### Vault Call Graph

All vault writes go through `a1-tools.cjs` helpers (located in `_shared/a1-tools.cjs`):

- `spec next-number` → creates `projects/<slug>/spec/OF-P-*.md`
- `spec list <project>` → reads from `projects/<slug>/spec/`
- `fix next-suffix` → creates `projects/<slug>/fixes/<date>-<slug>.md`
- `analyze init` → creates `projects/<slug>/analyses/<date>-<focus>.md`
- `constitution init` → creates `projects/<slug>/constitution.md`

**Which commands invoke vaultRoot():**
- a1-new-feature/workflows/01-research.md (spec next-number)
- a1-fix/workflows/01-research.md (fix next-suffix)
- a1-analyze/workflows/01-init.md (analyze init)
- a1-constitution/workflows/01-research.md (constitution init)
- a1-evolve/workflows/01-collect.md (reads pattern/a1-learnings/)
- a1-evolve/workflows/04-apply.md (writes to pattern/a1-learnings/, updates patterns.md)
- checkpoint/SKILL.md (Step 3–3c: reads/writes to all 7-type folders + Cloud-Brain sync)

**Failure mode when vault missing:** Silently returns non-writable path → mkdir fails → subsequent operations error with "ENOENT: no such file or directory" (unclear to user).

**M7 action:** Implement Tier 1–4 chain with ensureDir() and clear error messages.

---

## Shell Hardcodes — Exact Locations

### VAULT Hardcodes (2 instances)

| File | Line(s) | Code | Issue |
|------|---------|------|-------|
| `a1-evolve/workflows/01-collect.md` | 9 | `VAULT="$HOME/N3URAL-Vault"` | Breaks if vault doesn't exist; should use fallback chain |
| `a1-evolve/workflows/04-apply.md` | 28 | `VAULT="$HOME/N3URAL-Vault"` | Same issue; also used in Step 4 for reading patterns.md |

### REPO_ROOT Hardcodes (3+ instances)

| File | Line(s) | Code | Issue |
|------|---------|------|-------|
| `a1-evolve/workflows/04-apply.md` | 58–59 | `git -C ~/code/a1-skills add ...` | Breaks if repo cloned elsewhere (e.g., /home/alice/a1-specforge/) |
| `a1-evolve/workflows/04-apply.md` | 58–59 | `git -C ~/code/a1-skills commit ...` | Same issue |
| `a1-evolve/SKILL.md` | (description) | "Commits applied changes to ~/code/a1-skills/." | Documentation only (user-facing) |

**Fix pattern:**
```bash
# Current (broken)
git -C ~/code/a1-skills add agents/ */SKILL.md

# Fixed (dynamic)
REPO_ROOT="$(git rev-parse --show-toplevel)"
git -C "$REPO_ROOT" add agents/ */SKILL.md
```

---

## Vault Hardcodes in Prose (Documentation Updates)

| File | Line(s) | Severity | Action |
|------|---------|----------|--------|
| README.md | 49 | LOW | Update vault config table; explain fallback chain |
| a1-new-feature/SKILL.md | 138 | LOW | Change "Default vault root: ~/N3URAL-Vault/" to "Defaults to `.a1/learnings/`; override with A1_VAULT_ROOT" |
| a1-modernize/SKILL.md | 150 | LOW | Same update |
| a1-reconcile/SKILL.md | 133 | LOW | Same update |
| a1-check/SKILL.md | 68 | LOW | Same update |
| a1-analyze/SKILL.md | 119 | LOW | Same update |
| a1-constitution/SKILL.md | 114 | LOW | Same update |
| a1-fix/workflows/00-preflight.md | 46–47 | LOW | Example paths only; can keep or update |
| checkpoint/SKILL.md | 65, 121 | N/A | Will be deleted from public repo (moves to private overlay) |

**Note:** All prose references are safe to patch (no runtime dependency).

---

## Checkpoint Skill — Personal Exclusion

### Current State

**Location:** `/Users/rob/code/a1-skills/checkpoint/`

**Files:**
- `SKILL.md` (290 lines, 17.7 KB) — German-language skill; multi-layer persistence
- `push-to-brain.py` (3.5 KB) — Python script for Cloud-Brain API sync

**Installation:**
- Explicitly **NOT** in install.sh SKILLS array (line 55: `# Deliberately NOT installed: "checkpoint"`)
- BUT: Still symlinked to `~/.claude/skills/checkpoint/` (exists in Rob's environment)

### OSS Blocker Dependencies

1. **Obsidian Vault** (`~/N3URAL-Vault/`) — optional via env var (M7 fixes this)
2. **Cloud-Brain API** (`brain-proxy-mt` endpoint) — **N3URAL.AI ONLY, personal**
3. **BRAIN_ROBERT_TOKEN secret** — hardcoded in SKILL.md line 101:
   ```bash
   export BRAIN_ROBERT_TOKEN="$(security find-generic-password -s brain-robert-token -w)"
   ```

### M7 Action: Remove from Public Repo

1. Delete `/Users/rob/code/a1-skills/checkpoint/` from git
2. Add `checkpoint/` to `.gitignore`
3. Remove comment from `bin/install.sh` (lines 55–56)
4. **Symlink situation in Rob's environment:**
   - Currently: `~/.claude/skills/checkpoint → /Users/rob/code/a1-skills/checkpoint/`
   - After removal: This symlink will be broken on new clone + install.sh
   - **Solution for Robert:** Create private overlay repo or script to symlink a private copy (out of M7 scope; document as "migration needed")

---

## Test Fixtures & Runners

### Inventory (10 fixtures)

| Fixture | Runner | Status | Runner Type |
|---------|--------|--------|-------------|
| a1-analyze-cli | run-tests.sh | ✓ | Bash + node (CLI tests) |
| a1-check | run-tests.sh | ✓ | Bash + node (spec consistency checks) |
| a1-checklist | run-tests.sh | ✓ | Bash + node (pre-flight gates) |
| a1-cost | run.sh | ✓ | Bash + node (token aggregation) |
| a1-modernize-roundtrip | run.sh | ✓ | Bash + node (frontmatter fidelity) |
| **a1-phantom** | **MISSING** | ✗ | **CREATE run.sh** |
| a1-pr-review | run-test.sh | ✓ | Bash + node (PR gate checks) |
| a1-reconcile | run-tests.sh | ✓ | Bash + node (spec drift detection) |
| a1-schema-check | run.sh + parser/run-parser.sh | ✓ | Bash + node (SQL schema validation) |
| a1-worktree | run-tests.sh | ✓ | Bash + node (git worktree lifecycle) |

### a1-phantom Fixture Structure

```
_test-fixtures/a1-phantom/
├── clean/                     # Valid PLAN.md, all tasks have [X] code tags
│   ├── .git/                  # Git repo (not symlinked; full nested .git dir)
│   ├── PLAN.md
│   └── src/
│       ├── auth.js
│       └── util.js
│
├── no-code-tag/               # Missing [X] code tags on some tasks
│   ├── .git/
│   ├── PLAN.md
│   └── src/
│
└── phantoms/                  # Phantom tasks in PLAN.md (no corresponding code)
    ├── .git/
    ├── PLAN.md
    └── src/
```

**Key observation:** Each fixture subdirectory contains a **full `.git/` directory** (not a gitlink). This is not a git submodule — it's a standalone nested repo. When a fresh clone happens, all 3 `.git` dirs are cloned as regular directories.

### Runner Convention Pattern (Template for a1-phantom)

**Observed in a1-check/run-tests.sh and a1-worktree/run-tests.sh:**

```bash
#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO_ROOT/_shared/a1-tools.cjs"
FIX="$REPO_ROOT/_test-fixtures/a1-check"

pass=0
fail=0

run_case() {
  local name="$1"
  local expected_exit="$2"
  local expected_status="$3"
  
  local out
  out=$(node "$TOOLS" check demo --feature 001-login --vault "$FIX/$name" 2>&1)
  local actual_exit=$?
  
  if [[ "$actual_exit" == "$expected_exit" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# Run all cases
run_case "pass" 0 "ok"
run_case "fail" 1 "error"

# Report
if [[ $fail -gt 0 ]]; then
  echo "$fail test(s) failed"
  exit 1
fi
echo "All tests passed ($pass)"
```

**For a1-phantom runner:**
- Iterate through subdirs: `clean/`, `no-code-tag/`, `phantoms/`
- For each, run `node "$TOOLS" phantom-check` with the fixture dir as input
- Validate exit codes: 0 for clean, 1 for issues
- Parse JSON output for detailed status
- Report pass/fail counts

### install.sh Smoke Test (CI Requirement)

**Current install.sh behavior:**

```bash
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
AGENTS_DIR="$HOME/.claude/agents"

mkdir -p "$SKILLS_DIR" "$AGENTS_DIR"  # Creates if missing
symlink_item "$REPO_DIR/$skill" "$SKILLS_DIR/$skill" "$skill"
```

**M7 CI requirement:**
- Run on clean `$HOME` (temp dir like `/tmp/test-home/.claude/`)
- Verify all symlinks created
- Verify no checkpoint symlink
- Verify _shared symlink exists

---

## Language Status — German Content Inventory

### Skills with German User Prompts/Workflows

| Skill | Files with German | Line Count | M7 Action |
|-------|------------------|------------|-----------|
| a1-analyze | workflows/05-report.md | 247 | Update prose + prompts to English-first |
| a1-fix | workflows/00-preflight.md, 04-verify.md | 210 + varies | Translate preflight prompts to English |
| a1-modernize | 5 workflow files (01–06) | 198 | Translate all workflow prompts to English |
| a1-execute | workflows/03-verify.md | varies | Add language strategy section to SKILL.md |
| a1-plan | (no triggers doc) | — | Add language strategy section to SKILL.md |
| a1-progress | (no triggers doc) | — | Add language strategy section to SKILL.md |
| a1-roadmap | (no triggers doc) | — | Add language strategy section to SKILL.md |
| a1-evolve | (no triggers doc) | — | Add language strategy section to SKILL.md |

### No SKILL.md Language Documentation

These 8 skills lack explicit language policy in SKILL.md (should state triggers + prompts language):
- a1-plan
- a1-execute
- a1-progress
- a1-roadmap
- a1-evolve
- a1-check (German prompts, no language section)
- a1-phantom (German triggers in name, no language section)
- a1-pr-review (German triggers in name, no language section)

### M7 Language Unification Strategy

**Goal:** English-first, German aliases supported for backward compatibility.

**Implementation path:**
1. Update all SKILL.md files to include `language:` frontmatter field and explicit trigger examples (English primary, German aliases as secondary)
2. Translate user-facing prompts in workflows from German to English
3. Add note to README: "All skills support English input. German trigger aliases remain active for backward compatibility."

---

## Personal Path References (Safe to Clean)

| File | Line(s) | Content | Severity | Action |
|------|---------|---------|----------|--------|
| a1-plan/_learning.md | 45 | Personal session example path | LOW | Remove or generalize |
| a1-modernize/workflows/01-scope.md | 38 | `/Users/rob/code/...` in German prompt | LOW | Update to generic placeholder |
| checkpoint/SKILL.md | 49 | `/Users/rob/` slug calculation example | N/A | Deleted (checkpoint removed) |
| .a1/phases/M6-works-for-rob/ | (entire dir) | Contextual docs for M6 | LOW | Rename to `M6-reference/` or document as historical |

**None of these are runtime blockers** — safe to patch or remove.

---

## CI/CD Requirements (M7 Blockers)

### Missing: `.github/workflows/` Directory

**M7 must create:**

1. **test.yml** — Test runner on every push/PR
   ```yaml
   on: [push, pull_request]
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with:
             node-version: '18'
         - name: Run all fixtures
           run: |
             for fixture in _test-fixtures/*/run*.sh; do
               bash "$fixture" || exit 1
             done
         - name: Install smoke test
           run: |
             mkdir -p /tmp/test-home/.claude/{skills,agents}
             HOME=/tmp/test-home bash ./bin/install.sh
             test -L /tmp/test-home/.claude/skills/a1-new-feature || exit 1
             test ! -L /tmp/test-home/.claude/skills/checkpoint || exit 1
   ```

2. **lint.yml** — Hardcode detection + frontmatter validation
   ```yaml
   steps:
     - name: Check for hardcodes
       run: |
         grep -r '/Users/rob' src/ --exclude-dir=.a1 --exclude-dir=.git || true
         grep -r '~/code/a1-skills' . --exclude-dir=.git || true
         # Whitelist: docs/, .a1/phases/ (historical/contextual)
     - name: Validate YAML frontmatter
       run: node _shared/a1-tools.cjs frontmatter-check ...
   ```

---

## Quality Issues & Hotspots

### Complexity Hotspots (Large Files)

| File | Lines | Risk | Note |
|------|-------|------|------|
| checkpoint/SKILL.md | 290 | HIGH | Will be deleted (M7) |
| a1-new-feature/workflows/06-verify.md | 256 | MED | Complex verification logic |
| a1-analyze/workflows/03-analyze.md | 247 | MED | Multiple agent coordination |
| a1-modernize/SKILL.md | 198 | MED | Complex modernization workflow |
| a1-fix/workflows/04-verify.md | 210 | MED | Multi-stage verification |

### Test Coverage Gaps

- **a1-phantom:** No runner yet (fixture exists, but untested on CI)
- **a1-evolve:** No fixture tests (workflow-heavy, no unit tests)
- **install.sh:** No verification tests until M7 CI added
- **Vault fallback chain:** No tests yet (must add after implementation)

### Code Quality Notes

- **No duplicate identifiers detected** (checked against RESEARCH summary)
- **Immutability:** Files are generally read-only; safe patterns used in frontmatter parsing
- **Error handling:** a1-tools.cjs has basic error handling; workflows rely on user confirmation (ok for interactive skills)
- **Hardcodes:** 115+ references (documented in RESEARCH.md); M7 target: reduce to <10 (whitelisted in docs/)

---

## Concerns & Risks

### High Severity

1. **Vault dependency blocks external users** (115+ hardcoded paths)
   - Risk: New users can't run a1-new-feature without manual env var setup
   - Mitigation: Implement fallback chain (Tier 1–4)
   - Timeline: Week 1 (M7 blocking)

2. **checkpoint still reachable via symlink** (personal secret exposure)
   - Risk: Public clone has broken symlink; if checkpoint is ever re-added, secrets leak
   - Mitigation: Remove from git, add to .gitignore, document private overlay migration
   - Timeline: Week 1 (M7 blocking)

3. **a1-phantom runner missing** (incomplete test suite)
   - Risk: CI passes but phantom detection not tested
   - Mitigation: Create run.sh, integrate into test.yml
   - Timeline: Week 2 (M7 blocker for CI green)

4. **Shell snippets hardcoded to ~/code/a1-skills** (breaks external clones)
   - Risk: a1-evolve/workflows/04-apply.md fails on `/home/alice/a1-specforge/`
   - Mitigation: Replace with `git rev-parse --show-toplevel`
   - Timeline: Week 1 (M7 blocking)

### Medium Severity

5. **German prompts in workflows** (user confusion)
   - Risk: External users expect English; existing users (Rob) expect German
   - Mitigation: Translate to English, support German aliases
   - Timeline: Week 2 (nice-to-have for M7; complete by M7 final)

6. **a1-tools.cjs vaultRoot() not testable on fresh machine** (quality)
   - Risk: Fallback chain logic untested until real external user hits it
   - Mitigation: Add `a1-tools-vault-fallback/` fixture; test all 4 tiers
   - Timeline: Week 2 (M7 testing)

7. **install.sh --home/-prefix override missing** (CI setup friction)
   - Risk: CI smoke test needs custom $HOME; script doesn't support it yet
   - Mitigation: Add optional env var override (or rely on $HOME env var already set by CI)
   - Timeline: Week 2 (optional; `$HOME=/tmp/test-home` works for now)

### Low Severity

8. **Personal paths in .a1/phases/ docs** (not runtime-blocking)
   - Risk: Confuses external users reading phase docs
   - Mitigation: Sanitize or rename M6 phase dir
   - Timeline: Week 2 (polish)

9. **No SKILL.md language documentation** (user onboarding)
   - Risk: Ambiguity which language to use for triggers
   - Mitigation: Add language: field to all SKILL.md frontmatter
   - Timeline: Week 2 (polish)

---

## .gitignore & Symlink Strategy

### Current .gitignore Assumptions

**Not checked yet; M7 must verify:**
- `.a1/learnings/` — should be gitignored (user project specs)
- `checkpoint/` — should be added (personal skill, private overlay only)
- Test fixture `.git/` dirs — OK to commit (they're nested test repos, not submodules)

### Symlink Cleanup

**After M7 completion:**
- `~/.claude/skills/checkpoint` — will be broken (symlink → deleted target)
- All other symlinks (`a1-*`, `agents/`, `_shared`) — remain valid
- **No action needed in repo**; Robert must manually update local environment or use private overlay script

---

## Relevant for This Task

### For the Planner

1. **vaultRoot() fallback chain** is the critical foundation — it unblocks all other vault-dependent skills on fresh machines. Must be done first, with comprehensive testing.

2. **Shell snippet fixes** (a1-evolve/workflows/04-apply.md) are 3 one-liners but must handle both vault path AND repo root dynamically.

3. **checkpoint removal** is straightforward git deletion + .gitignore addition, but document the private overlay migration path for Robert's workflow.

4. **a1-phantom runner** is a templatable copy-paste from a1-check/run-tests.sh; it iterates 3 subdirs instead of N cases.

5. **CI/CD setup** (test.yml + lint.yml) is the largest work volume but relatively mechanical once fixtures + linting rules are defined.

6. **Language unification** is polish; defer to end of Week 2 if Week 1 blocks pile up.

### File Paths to Patch (in priority order)

1. `/Users/rob/code/a1-skills/_shared/a1-tools.cjs:256–258` — vaultRoot() function
2. `/Users/rob/code/a1-skills/a1-evolve/workflows/01-collect.md:9` — VAULT hardcode
3. `/Users/rob/code/a1-skills/a1-evolve/workflows/04-apply.md:28,58–59` — VAULT + REPO_ROOT hardcodes
4. `/Users/rob/code/a1-skills/checkpoint/` — **DELETE from git**
5. `/Users/rob/code/a1-skills/bin/install.sh:55–56` — **REMOVE checkpoint comment**
6. `/Users/rob/code/a1-skills/.github/workflows/test.yml` — **CREATE**
7. `/Users/rob/code/a1-skills/_test-fixtures/a1-phantom/run.sh` — **CREATE**
8. `/Users/rob/code/a1-skills/README.md` — **UPDATE** vault section
9. `/Users/rob/code/a1-skills/14 SKILL.md files` — **UPDATE** language strategy + vault config prose

### Constants & Patterns to Define

**For implementation:**
- `LEARNINGS_SUBDIR = ".a1/learnings"` — constant for repo-local vault (no hardcoding in workflows)
- `VAULT_FALLBACK_ORDER = [A1_VAULT_ROOT, repo/.a1/learnings, ~/N3URAL-Vault]` — documented in a1-tools.cjs
- `run.sh template for fixtures` — extract from a1-check/run-tests.sh, generalize for any fixture

---

## Success Criteria (from RESEARCH.md)

1. **Fresh-machine test passes:**
   - Clone to `/tmp/test-oss/a1-specforge/`
   - Run `./bin/install.sh` (no `A1_VAULT_ROOT` set)
   - Run `a1-new-feature` interactively
   - Spec file created in `.a1/learnings/projects/<slug>/spec/` ✓
   - Zero file edits by user ✓

2. **CI green:**
   - All 10 test fixtures pass on PR ✓
   - a1-phantom runner executes all 3 subdirs ✓
   - lint.yml finds zero hardcodes (except whitelisted) ✓
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

---

## Key Observations

- **Vault operations are centralized** in a1-tools.cjs; fixing vaultRoot() once fixes all 7 read/write paths simultaneously.
- **Shell hardcodes are scattered** (a1-evolve workflows, README examples); grep-friendly but must be patched individually.
- **Test fixtures already have structure** for a1-phantom; runner is the only missing piece.
- **No secrets in public code** except checkpoint (which is being removed); .gitignore is currently sufficient.
- **symlink strategy is clean** — all live in repo, symlinked to ~/.claude/; removal of checkpoint won't affect other skills.
- **CI/CD is greenfield** — no existing workflows; can build fresh without compatibility concerns.
