---
focus: all (arch + tech + blast-radius for plugin packaging migration)
generated: 2026-07-05
---

# Codebase Map — M8 Launch & Community

## Executive Summary

**a1-specforge** is a purely Markdown/CLI distribution (no runtime SaaS): 17 skill directories + 18 agent `.md` files + a deterministic Node.js CLI (`_shared/a1-tools.cjs`, ~6.8k LOC) installed into `~/.claude/skills/` and `~/.claude/agents/` via `bin/install.sh` symlinks.

**Structural migration risk (HIGH):** Plugin marketplace convention requires `skills/` and `agents/` directories at the **plugin root**, but the repo currently has **17 skill dirs scattered at repo root** (`a1-new-feature/`, `a1-fix/`, etc.). The RESEARCH.md recommends moving all 17 into `skills/` (matching Anthropic's own `claude-code` repo pattern) rather than creating a plugin-only copy. **This cascades into 5 breaking points** (install.sh paths, CI fixture paths, CONTRIBUTING.md docs, SKILL.md/workflow path references, and relative paths in test runners).

**Packaging fit:** No disallowed plugin agent-frontmatter fields found (hooks/mcpServers/permissionMode all absent from 18 agents). German content is scattered (55-60 lines, mostly user-facing prompts in workflow bodies — translatable in one pass). Contributor gaps are small (seed 3–5 good-first-issues, add CODE_OF_CONDUCT, link postgres-rls pack example).

---

## Repo Structure (Current Flat Layout)

```
a1-specforge/
├── a1-new-feature/           ← MOVE to skills/a1-new-feature/
├── a1-fix/                   ← MOVE to skills/a1-fix/
├── a1-analyze/               ← MOVE to skills/a1-analyze/
├── a1-check/                 ← MOVE to skills/a1-check/
├── a1-checklist/             ← MOVE to skills/a1-checklist/
├── a1-constitution/          ← MOVE to skills/a1-constitution/
├── a1-worktree/              ← MOVE to skills/a1-worktree/
├── a1-pr-review/             ← MOVE to skills/a1-pr-review/
├── a1-phantom/               ← MOVE to skills/a1-phantom/
├── a1-reconcile/             ← MOVE to skills/a1-reconcile/
├── a1-plan/                  ← MOVE to skills/a1-plan/
├── a1-execute/               ← MOVE to skills/a1-execute/
├── a1-progress/              ← MOVE to skills/a1-progress/
├── a1-roadmap/               ← MOVE to skills/a1-roadmap/
├── a1-evolve/                ← MOVE to skills/a1-evolve/
├── a1-modernize/             ← MOVE to skills/a1-modernize/
├── a1-new-project/           ← MOVE to skills/a1-new-project/
│
├── agents/
│   ├── a1-rico-researcher.md          (18 agents — already in correct location)
│   ├── a1-pablo-planner.md
│   ├── ... (15 more)
│   └── a1-theo-test-engineer.md
│
├── _shared/
│   ├── a1-tools.cjs                  (6.8k LOC, Node.js CLI, no external deps)
│   ├── _learning.md                  (auto-retro cache)
│   └── learnings-index.md            (cache)
│
├── _test-fixtures/                   (15 fixture suites with run*.sh)
│   ├── a1-check/
│   ├── a1-analyze-cli/
│   ├── ... (12 more)
│   └── a1-vault-fallback/
│
├── bin/
│   └── install.sh                    (symlink orchestrator — BREAKS on skill move)
│
├── .github/
│   ├── workflows/
│   │   └── test.yml                  (CI — references _shared/ & install.sh paths)
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md             (exists)
│   │   └── feature_request.md        (exists)
│   └── PULL_REQUEST_TEMPLATE.md      (exists)
│
├── docs/
│   ├── adr/
│   ├── analysis/
│   └── roadmap.md
│
├── packs/                            (gate-pack distros)
│   └── postgres-rls/
│       ├── pack.yaml
│       └── patterns/
│           ├── fk-type-match.md
│           ├── schema-audit-trigger.md
│           └── rls-grant-matrix.md
│
├── .a1/                              (project meta, to remain at root)
├── .claude/                          (project .claude meta, to remain at root)
├── README.md                         (install instructions — light update needed)
├── CONTRIBUTING.md                   (skill structure section — BREAKS)
└── .gitignore
```

**POST-MOVE layout (expected):**

```
a1-specforge/
├── skills/
│   ├── a1-new-feature/
│   ├── a1-fix/
│   └── ... (15 more)
├── agents/                           (no change)
├── _shared/                          (no change)
├── .claude-plugin/
│   ├── plugin.json                   (to create)
│   └── marketplace.json              (to create)
├── bin/install.sh                    (update paths: $skill → skills/$skill)
├── CONTRIBUTING.md                   (update docs: a1-<name>/ → skills/a1-<name>/)
└── ... (rest unchanged)
```

---

## Breaking Points (Blast Radius) — 5 Categories

### 1. **Symlink Install Path (`bin/install.sh`) — REPO-LAYOUT (breaks on move)**

**File:** `/Users/rob/code/a1-skills/bin/install.sh`

**Current logic (lines 38–62):**
```bash
SKILLS=(
  "a1-new-feature"
  "a1-fix"
  ... (15 more)
  "_shared"
)

for skill in "${SKILLS[@]}"; do
  symlink_item "$REPO_DIR/$skill" "$SKILLS_DIR/$skill" "$skill"
done
```

**Migration:** Change to:
```bash
SKILLS=(
  "a1-new-feature"
  "a1-fix"
  ... (15 more)
)

for skill in "${SKILLS[@]}"; do
  symlink_item "$REPO_DIR/skills/$skill" "$SKILLS_DIR/$skill" "$skill"
done

# _shared is NOT a skill; keep as-is
symlink_item "$REPO_DIR/_shared" "$SKILLS_DIR/_shared" "_shared"
```

**Impact:** Install script is the primary dev/user distribution path. Must work post-move or all local development breaks.

---

### 2. **CI Workflow Paths (`.github/workflows/test.yml`) — REPO-LAYOUT (breaks on move)**

**File:** `/Users/rob/code/a1-skills/.github/workflows/test.yml`

**Current references:**
- Line 16: `node --check _shared/a1-tools.cjs` ✓ (OK, no depth change if _shared stays at root)
- Line 23: `bash "$r"` (iterates `_test-fixtures/*/run*.sh`)
- Line 32: `bash ./bin/install.sh` (runs install.sh smoke test)
- Line 34: `test -L "$HOME/.claude/skills/a1-new-feature"` (checks symlink exists)

**Fixture runners:** All 15 fixtures in `_test-fixtures/*/run*.sh` use `../../` relative paths to find REPO_DIR. Path depth doesn't change (fixtures stay at `_test-fixtures/a1-*/`), so these are SAFE.

**Migration impact:** None for CI itself — the workflow runs in the repo root, so `_shared/` path is unchanged, and `./bin/install.sh` still runs. Smoke test (lines 32–35) validates symlinks were created, which will work if `install.sh` is updated correctly.

---

### 3. **Fixture Runners (`_test-fixtures/*/run*.sh`) — REPO-LAYOUT (conditionally safe)**

**Sample (all follow the same pattern):**

```bash
# a1-check/run-tests.sh
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"  # resolves to repo root

# a1-pr-review/run-test.sh
CLI="node $(cd "$(dirname "${BASH_SOURCE[0]}")/../../_shared" && pwd)/a1-tools.cjs"
```

**Current path depth:** `_test-fixtures/a1-<name>/` → `../../` = repo root. Resolves to `$REPO_DIR/_shared/a1-tools.cjs`.

**Post-move path depth:** Same, because:
- Fixtures stay at `_test-fixtures/a1-<name>/` (NOT moved into skills/)
- `_shared/` stays at repo root
- `../../` from fixture still resolves to repo root

**Impact:** SAFE — no depth change needed. Fixtures access `_shared/` via the same relative path pre and post-move.

**Caveat:** If *any* fixture were to run with skill content (e.g., reading `SKILL.md`), it would need to hardcode the new depth (`skills/a1-new-feature/` instead of `a1-new-feature/`). Check for this in the fixture logic.

---

### 4. **Runtime Skill References in SKILL.md & Workflows (`~/.claude/skills/...`) — RUNTIME (unaffected)**

**These are symlink paths — live at install time, not repo-layout paths.**

**Examples:**
```
a1-checklist/SKILL.md:
  `~/.claude/skills/_shared/a1-tools.cjs checklist run`
  
a1-analyze/workflows/01-scope.md:
  node ~/.claude/skills/_shared/a1-tools.cjs analyze init <project-slug> <focus>

a1-new-feature/SKILL.md:
  n3urala1-design (`~/.claude/skills/n3urala1-design`) — example cross-skill reference
```

**Why safe:** Install.sh creates symlinks `~/.claude/skills/a1-new-feature → $REPO_DIR/skills/a1-new-feature` (post-move). The **symlink name** is `a1-new-feature`, not the source path. Skills that reference `~/.claude/skills/a1-new-feature/SKILL.md` at runtime (via symlink) are unaffected by where the source lives in the repo.

**Migration:** No changes to `~/.claude/skills/...` references in SKILL.md or workflows needed — they remain valid because install.sh's symlink **names** don't change, only the source target.

**Caveat:** If a skill embedded a hardcoded repo path like `$HOME/.../code/a1-skills/a1-new-feature/...` (unlikely, but check), that would break and needs fixing.

---

### 5. **Documentation & CONTRIBUTING.md Paths — REPO-LAYOUT & DOCS (breaks, but is docs)**

**Files affected:**
- `CONTRIBUTING.md` (lines 21–35, "Skill structure" section)
- `README.md` (README table references skill names but not paths; mostly safe)
- Docs in `docs/` (generally safe; typically don't hardcode skill dir paths)

**Current CONTRIBUTING.md (lines 25–31):**
```markdown
Every skill follows the same layout:

a1-<name>/
├── SKILL.md
├── workflows/
├── templates/
└── agents/
```

**Post-move update needed:**
```markdown
Every skill follows the same layout:

skills/a1-<name>/
├── SKILL.md
├── workflows/
├── templates/
└── agents/
```

**Step 1 of "Adding a skill" (line 41):**
```markdown
Add the skill name to the `SKILLS` array in `bin/install.sh`.
```
(This guidance stays valid; the array just references names, not paths.)

**Impact:** Contributor-facing only — if CONTRIBUTING.md is wrong, new contributions attempt to create `a1-<name>/` at repo root instead of `skills/a1-<name>/`, and install.sh finds nothing.

---

## Cross-Skill References & Dependencies

### Internal References (skill-to-skill)

**Found:** One explicit cross-skill reference in `a1-new-feature/SKILL.md`:
```
| Projects using n3ural design system | `n3urala1-design` (`~/.claude/skills/n3urala1-design`) |
```

This is a **runtime symlink reference** (`~/.claude/skills/...`) — SAFE after plugin packaging because the symlink name is stable.

**Vault pattern references:** Many skills reference `pattern/a1-learnings/` (a central Vault path, not a repo path). These are Vault-relative, not repo-relative — SAFE.

### Test fixture dependencies

No test fixtures import or source code from skills (they run CLI commands against _shared). SAFE.

### Pack structure

`packs/postgres-rls/` contains:
- `pack.yaml` (metadata)
- `patterns/` directory (markdown files with gate patterns)

**No repo-path or skill-path references inside pack files.** SAFE.

---

## Agent Frontmatter Audit — Plugin Compatibility

**Checked all 18 agents for disallowed fields:** `hooks`, `mcpServers`, `permissionMode`

**Result:** ✅ **ZERO occurrences** across all 18 `agents/*.md` files.

Sample frontmatter (valid for plugin):
```yaml
---
name: a1-rico-researcher
description: Research context, domain, prior art
model: sonnet
---
```

No agent uses security-gated fields. **Ready for plugin packaging.**

---

## German Workflow Content — Translation Task

**Scope:** 19 workflow files contain 55–60 German lines (not full-German files; scattered user-facing prompts and output messages).

**Files with German (sorted by German-line count):**

| File | Umlaut hits | Total lines | Content type |
|---|---|---|---|
| `a1-new-feature/workflows/06-verify.md` | 9 | 306 | Verification checklist, prompt strings |
| `a1-fix/workflows/00-preflight.md` | 8 | 91 | Integrity error message, example output |
| `a1-new-project/workflows/02-scope.md` | 6 | 113 | Interview questions ("Später" = later) |
| `a1-new-project/workflows/01-bootstrap.md` | ~4 | 130 | Constitution offer ("Später") |
| `a1-fix/workflows/04-verify.md` | ~3 | 250 | Postmortem/lessons output |
| `a1-modernize/workflows/02-reverse-spec.md` | 3 | 140 | User prompt ("Magst du...") |
| `a1-modernize/workflows/05-plan.md` | 3 | 200 | Phase readiness prompt |
| `a1-modernize/workflows/03-gap-analysis.md` | 3 | 108 | Gap-list and recommendations |
| `a1-modernize/workflows/07-publish.md` | 5 | 171 | Report preview & learning prompt |
| `a1-modernize/workflows/04-tech-proposals.md` | 2 | 97 | Tech proposal header |
| `a1-modernize/workflows/06-execute.md` | 2 | 150 | Execution summary |
| `a1-modernize/workflows/01-scope.md` | 2 | 190 | Mode description |
| `a1-new-feature/workflows/04-plan.md` | 1 | 250 | Coverage example comment |
| `a1-analyze/workflows/05-report.md` | 1 | 300 | Retro suggestion |
| `a1-execute/workflows/03-verify.md` | 1 | 200 | Learning accumulation prompt |
| `a1-pr-review/workflows/01-detect.md` | 1 | 150 | User input example |
| `a1-new-project/workflows/04-feature-split.md` | 1 | 100 | "Später" marker |
| `a1-new-project/workflows/05-feature-loop.md` | 1 | 141 | Next-steps note |
| `a1-worktree/workflows/03-exit.md` | 1 | 130 | Task description example |

**Translation approach:** Line-by-line in-place replacement preserving Markdown structure. No restructuring. **Estimated effort: 4–6 hours** (1 pass over 19 files, run fixture tests post-translate to catch typos).

**De-risk gate:** `grep -r "[äöüßÄÖÜ]" a1-*/workflows/*.md | wc -l` must be 0 after translation pass.

---

## Contributor-Flow Gaps (RESEARCH.md findings)

**Status:** Smaller than roadmap scope implies. Existing infrastructure is solid.

| Item | Status | Work | Notes |
|---|---|---|---|
| Issue templates | ✅ Exists | None | `.github/ISSUE_TEMPLATE/bug_report.md` + `feature_request.md` present and usable |
| PR template | ✅ Exists | None | `.github/PULL_REQUEST_TEMPLATE.md` present with skill-affected + change-type checklist |
| CONTRIBUTING.md | ⚠️ Partial | Small update | Skill-structure section needs path update (see section 5 above); gate-pack section exists but missing link to postgres-rls example; no plugin-install vs. dev-install distinction |
| Good-first-issues | ❌ Missing | Seed 3–5 | Create labeled GitHub issues for low-entry tasks (e.g., translate remaining German, add workflow number, fixture test coverage) |
| CODE_OF_CONDUCT | ❌ Missing | Create | Standard Contributor Covenant template; 5 min to add |
| Architecture doc | ⚠️ Partial | Optional | `_shared/a1-tools.cjs` has no external README; blocks first-time CLI contributors. Not blocking for M8 (docs-only skill work isn't blocked). |

**Recommended M8 additions (non-blocking; mostly seeding):**
1. Add `CODE_OF_CONDUCT.md` (standard template, 200 lines)
2. Seed 3–5 GitHub issues labeled `good-first-issue` with clear scope
3. Add one sentence to CONTRIBUTING.md: "See `packs/postgres-rls/` for a complete worked example of contributing a gate-pack"
4. Add one section to CONTRIBUTING.md distinguishing plugin-install (users) from clone+symlink (contributors)

---

## Tech Stack Summary

| Component | Version / Tech | Notes |
|---|---|---|
| CLI | Node.js ≥18 (CommonJS) | `_shared/a1-tools.cjs`, ~6.8k LOC, no npm deps (uses Node built-ins only) |
| Distribution | Bash symlinks (`install.sh`) | Current method; will remain for dev/contributor workflow post-plugin |
| Plugin distribution | Claude Code plugin system | New (M8); `.claude-plugin/plugin.json` + `marketplace.json` |
| Storage backend | Vault (optional) or `.a1/` dirs | A1_VAULT_ROOT env var enables Vault fallback; `.a1/` is default local storage |
| Testing | Bash fixture scripts (15 suites) | Run on every push via GitHub Actions; validates CLI, install, spec/fix/analyze pipelines |
| CI | GitHub Actions (ubuntu-latest, Node 20) | Syntax check, all 15 fixtures, install smoke test, vault-free CLI check |
| Package format | Markdown (`SKILL.md`, `*.md` workflows) + YAML (frontmatter) | No build step; distribution is file copying + symlink or plugin install |
| Pack format | YAML metadata + Markdown patterns | `packs/<name>/pack.yaml` + `patterns/*.md`; export/validate/import via CLI |

---

## Key File Manifest (Breaking vs. Safe)

| File / Path | Change Required? | Reason | Risk |
|---|---|---|---|
| `bin/install.sh` | **YES** | Update skill symlink source paths: `$REPO_DIR/$skill` → `$REPO_DIR/skills/$skill` | HIGH — install breaks if not updated |
| `.github/workflows/test.yml` | No | Repo-root paths (`_shared/`, `bin/`) unchanged; fixture relative paths still valid | LOW |
| `CONTRIBUTING.md` | **YES** | Update skill-structure docs: `a1-<name>/` → `skills/a1-<name>/` | MED — contributor confusion only |
| `README.md` | Minimal | Quickstart section already uses `./bin/install.sh` (correct); skill/agent tables are name-only (safe); no path refs in tables. Add one sentence about plugin-install option. | LOW |
| `_shared/a1-tools.cjs` | No | No repo-path references; deterministic file ops only. Symlink path is stable at `~/.claude/skills/_shared/`. | SAFE |
| `a1-*/SKILL.md` | No | References are `~/.claude/skills/...` (runtime symlinks). Symlink names unchanged by move. | SAFE |
| `a1-*/workflows/*.md` | No (except German translation) | Runtime symlink references (`~/.claude/skills/...`). German lines are separate task. | SAFE + TRANSLATION TASK |
| `agents/*.md` | No | Already in correct location for plugin. No disallowed plugin fields present. | SAFE |
| `_test-fixtures/*/run*.sh` | No | Relative paths (`../../`) resolve to repo root. Path depth unchanged. | SAFE |
| `packs/postgres-rls/` | No | No repo-path or skill-path references inside pack files. | SAFE |
| `.a1/`, `.claude/` | No | Project-level state, not moved. | SAFE |
| `.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` | No | Already exist; templates are workflow-agnostic. | SAFE |
| `.claude-plugin/plugin.json` | **CREATE** | New file, manifest for plugin. Reference `skills/` and `agents/` at plugin root. | NEW |
| `.claude-plugin/marketplace.json` | **CREATE** | New file, catalog entry. Standard structure. | NEW |

---

## Schema & Plugin Manifest Template

### `plugin.json` (to create at `.claude-plugin/plugin.json`)

```json
{
  "name": "a1-specforge",
  "displayName": "a1-specforge: Spec-Driven Development Pipeline",
  "version": "1.0.0",
  "description": "Spec-driven development pipeline for Claude Code — from idea to reviewed PR, with a built-in self-learning loop.",
  "author": { "name": "Robert Heine" },
  "homepage": "https://github.com/mellow-rob/a1-specforge",
  "repository": "https://github.com/mellow-rob/a1-specforge",
  "license": "MIT",
  "keywords": ["development", "planning", "quality-gates", "self-learning", "spec-driven"],
  "skills": "skills",
  "agents": "agents",
  "commands": null,
  "hooks": null,
  "mcpServers": null
}
```

**Key fields:**
- `name`: immutable plugin slug (used by marketplace; renaming breaks existing installs)
- `skills`/`agents`: path strings (relative to plugin root, defaults to `skills/` and `agents/`)
- `hooks`, `mcpServers`: plugin-shipped agents **cannot** use these fields (security policy); ours use neither, so null

### `marketplace.json` (to create at `.claude-plugin/marketplace.json`)

```json
{
  "name": "a1-specforge-marketplace",
  "displayName": "a1-specforge Marketplace",
  "plugins": [
    {
      "name": "a1-specforge",
      "displayName": "a1-specforge: Spec-Driven Development Pipeline",
      "version": "1.0.0",
      "description": "Spec-driven development pipeline for Claude Code",
      "source": "./",
      "author": "Robert Heine"
    }
  ]
}
```

**Pattern:** Self-hosted marketplace (same repo as plugin source).

---

## Rollback Checkpoints (Wave 1 Architecture)

**Wave 1 (Plugin Packaging Structural Refactor):**

1. ✅ Create `skills/` directory (mkdir)
2. ✅ Move all 17 skill dirs: `a1-*/` → `skills/a1-*/`
3. ✅ Update `bin/install.sh` paths
4. ✅ Update `CONTRIBUTING.md` (skill structure section)
5. ✅ Commit & verify: `git status`, `ls -la skills/`, `CONTRIBUTING.md` diff
6. ✅ Run full CI locally: `bash bin/install.sh` on clean $HOME, then check `~/.claude/skills/a1-new-feature` exists
7. ✅ Run all 15 fixture tests: `bash _test-fixtures/*/run*.sh`
8. **Checkpoint:** Commit only when steps 1–7 all green
9. ✅ Create `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
10. ✅ Validate manifest with plugin-dev toolkit
11. ✅ Final commit: "chore(plugin): add plugin.json + marketplace.json"

**Rollback method (if step 1–8 breaks):** `git reset --hard` pre-move commit (Wave 1 is a self-contained structural refactor, no skill content changes).

---

## Relevant for M8 Planning

### Wave 1: Plugin Packaging (Structural) — 2–3 days

**Owner:** a1-executor (code migration)

**Scope:**
- Move 17 skill dirs under `skills/`
- Update `bin/install.sh`, `CONTRIBUTING.md`, `.github/workflows/test.yml` (if any updates needed post-review)
- Create `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`
- Verify with fresh-machine install test + all fixture tests + manual smoke test
- Commit with rollback checkpoint

**Blockers:** None identified. Changes are mechanical (file moves + path updates).

---

### Wave 2: Launch Content & Contributor Setup — 3–5 days

**Owner:** a1-executor + a1-mapper + optional a1-analyze (for demo recording)

**Scope:**
1. German translation (19 workflow files, 55–60 lines) — `a1-executor`
2. Seed 3–5 `good-first-issue` GitHub issues — Robert / `a1-executor`
3. Add CODE_OF_CONDUCT.md — `a1-executor`
4. Add CONTRIBUTING.md improvements (postgres-rls link, plugin-vs-dev note) — `a1-executor`
5. Draft launch content (Show HN, Reddit, LinkedIn post skeleton) — `a1-mapper` (docs-as-analysis) or manual
6. Record demo GIF with VHS (optional, nice-to-have) — `a1-analyze` or manual with ffmpeg
7. README.md minimal updates (plugin install section) — `a1-executor`

**Non-blockers on this wave:** Structural plugin packaging (Wave 1) must land first, but no skill code changes needed. Wave 2 is all docs + launch enablers.

---

## Critical Distinctions for Planning

1. **Symlink vs. Repo-Layout Paths:** 
   - `~/.claude/skills/a1-new-feature/` = runtime symlink path (SAFE post-move, symlink names don't change)
   - `$REPO_DIR/a1-new-feature/` = repo-layout path (BREAKS post-move, must update to `$REPO_DIR/skills/a1-new-feature/`)

2. **Fixture path depth:**
   - Pre-move: `_test-fixtures/a1-*/` → `../../` = repo root
   - Post-move: Same (fixtures don't move)
   - **Unaffected**

3. **Plugin agent fields:**
   - Disallowed: `hooks`, `mcpServers`, `permissionMode`
   - Audit result: 0 occurrences across 18 agents ✅

4. **German content scope:**
   - 55–60 lines across 19 files, scattered user-facing prompts
   - Not full-German files; translatable in one pass
   - Estimated 4–6 hours

5. **Contributor gaps:**
   - Existing: Issue templates, PR template, CONTRIBUTING structure all present
   - Missing: good-first-issues (seeding only), CODE_OF_CONDUCT, postgres-rls link, plugin-vs-dev distinction in CONTRIBUTING
   - Estimated new work: 2–3 hours (seeding + 3 small docs)

---

## Summary Table: Pre- vs. Post-Move Impact

| Category | Pre-Move | Post-Move | Impact | Effort |
|---|---|---|---|---|
| Skill directory location | `a1-*/` at repo root | `skills/a1-*/` | Structural change | Mechanical (move + symlink update) |
| Install script paths | `$REPO_DIR/$skill` | `$REPO_DIR/skills/$skill` | Must update | 5 lines changed in install.sh |
| Runtime symlink paths | `~/.claude/skills/a1-new-feature` | `~/.claude/skills/a1-new-feature` (unchanged) | No impact | Zero work |
| CI fixture paths | Relative `../../` depth | Same depth (fixtures stay at `_test-fixtures/`) | No impact | Zero work |
| Plugin manifest | None (symlink-only) | `.claude-plugin/plugin.json` + `marketplace.json` | New files to create | ~30 lines JSON each |
| Plugin compatibility | N/A | Agent frontmatter check | No issues found ✅ | Zero work |
| Documentation (CONTRIBUTING.md) | `a1-<name>/` examples | `skills/a1-<name>/` examples | Docs update | ~10 lines changed |
| German translation | Existing | Translated to English | Small translation task | 4–6 hours, 19 files |
| Contributor enablers | Partial (templates exist) | Enhanced (good-first-issues, CoC) | Seeding + docs | 2–3 hours (non-blocking) |

---

## Files to Read/Edit in M8

### Must Read (pre-planning)
- `RESEARCH.md` (this phase's research — already in context)
- `bin/install.sh` (symlink logic)
- `CONTRIBUTING.md` (docs to update)
- `.github/workflows/test.yml` (CI path check)
- `.claude-plugin/plugin.json` (template above)

### Must Edit (Wave 1)
1. Move 17 skill dirs: `git mv a1-* skills/`
2. Edit `bin/install.sh` (6 lines: path update)
3. Edit `CONTRIBUTING.md` (lines 21–31: path examples)
4. Create `.claude-plugin/plugin.json`
5. Create `.claude-plugin/marketplace.json`

### Must Edit (Wave 2)
1. Translate 19 workflow files (55–60 German lines)
2. Create `.github/CODE_OF_CONDUCT.md`
3. Update `CONTRIBUTING.md` (add postgres-rls link + plugin-vs-dev note)
4. Update `README.md` (add plugin install section)
5. Seed 3–5 GitHub issues (good-first-issue labels)

### Nice-to-Have (Wave 2 stretch)
- Record demo GIF with VHS (requires ffmpeg + charmbracelet/vhs)
- Draft Show HN / Reddit / LinkedIn content skeleton
- CLI architecture doc for `_shared/a1-tools.cjs`

---

## Validation Checklist (Post-Move)

- [ ] `ls -la skills/` shows 17 skill dirs
- [ ] `grep REPO_DIR bin/install.sh | grep skills` finds the new path
- [ ] `./bin/install.sh` runs without error
- [ ] `test -L ~/.claude/skills/a1-new-feature` (symlink exists)
- [ ] `bash .github/workflows/test.yml` locally or `act` (all steps pass)
- [ ] `bash _test-fixtures/*/run*.sh` all pass
- [ ] `git diff HEAD~1 CONTRIBUTING.md` shows only path updates
- [ ] `grep "[äöüßÄÖÜ]" a1-*/workflows/*.md | wc -l` = 0 (after German translation)
- [ ] `.claude-plugin/plugin.json` validates with plugin-dev toolkit
- [ ] `git log --oneline` shows "chore(plugin): add plugin.json + marketplace.json" and all pre-move commits intact

---

## Conclusion

**Blast radius is HIGH but well-scoped.** The plugin packaging move is a structural refactor touching 3 critical files (install.sh, CONTRIBUTING.md, CLI path refs) but no skill logic changes. Wave 1 is low-risk because it's purely mechanical. Wave 2 (launch content) is additive and non-blocking. **Proceed with two-wave plan, checkpoint after Wave 1 validation, run fresh-machine smoke test before publishing to marketplace.**
