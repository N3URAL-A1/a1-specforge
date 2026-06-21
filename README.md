# a1-specforge

**Spec-driven development pipeline for Claude Code — from idea to reviewed PR, without manual orchestration.**

Claude Code is powerful. But without structure, every session starts from scratch: unclear specs, inconsistent plans, no trace of what was decided. a1-specforge gives Claude Code a backbone — auto-activating skills that guide every phase of a feature build, enforce consistency, and hand off between agents automatically.

## How it works

You describe what you want in plain language. The right skill activates automatically and runs the pipeline — spawning sub-agents, writing specs, validating plans, detecting drift, and preparing PRs.

```
"new feature for my-project: edit user profile"
→ a1-new-feature activates → Rene writes spec → Vincente builds wave plan
→ consistency gate checks spec↔plan → code agents implement → Reinhard reviews PR
```

## Skills

| Skill | Phase | What it does |
|---|---|---|
| `a1-new-feature` | Build | End-to-end feature pipeline: Discover → Specify → Clarify → Plan → Implement → Verify |
| `a1-fix` | Build | Bug pipeline: Report → Diagnose → Fix → Verify |
| `a1-analyze` | Insight | Codebase analysis (5 phases, parallel sub-agents): general, security, architecture, quality, onboarding |
| `a1-check` | Gate | Spec ↔ Wave-Plan consistency gate — bijective FR coverage, deterministic (no LLM) |
| `a1-checklist` | Gate | Pre-flight validator — 8 checks before execution (BLOCKER / MAJOR / MINOR) |
| `a1-constitution` | Setup | Generates `constitution.md` per project — separates behavioral rules from project data |
| `a1-worktree` | Isolation | Git worktree lifecycle: prepare → enter → exit (keep / discard / handoff) |
| `a1-pr-review` | Review | PR review via Reinhard sub-agent — BLOCKER gate before `gh pr create` |
| `a1-phantom` | Verify | Phantom task detection — checks `[X]` tasks in PLAN.md against actual git diff |
| `a1-reconcile` | Verify | Spec drift detection — MISSING / EXTRA / DIVERGED / STALE across spec and code |
| `_shared/a1-tools.cjs` | CLI | Shared CLI helper for all pipelines (~2500 LOC, atomic frontmatter writes) |

## Install

```bash
git clone https://github.com/mellow-rob/a1-specforge.git ~/code/a1-specforge
cd ~/code/a1-specforge
./bin/install.sh
```

Creates symlinks from `~/.claude/skills/` to this repo. Edits are live immediately — no reinstall needed.

**Requirements:** Claude Code CLI, Node.js ≥ 18, git.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `A1_VAULT_ROOT` | `~/N3URAL-Vault` | Path to your Obsidian vault (or any markdown notes directory) |

Set in your shell profile:
```bash
export A1_VAULT_ROOT="/path/to/your/notes"
```

## Usage

Skills activate automatically when you describe what you want:

| You say | Skill activates |
|---|---|
| "new feature for \<project\>" | `a1-new-feature` |
| "bug in \<project\>: X is broken" | `a1-fix` |
| "analyze \<project\>" | `a1-analyze` |
| "check consistency for \<slug\>/\<id\>" | `a1-check` |
| "checklist for \<slug\>/\<id\>" | `a1-checklist` |
| "constitution for \<project\>" | `a1-constitution` |
| "worktree for \<feature\>" | `a1-worktree` |
| "phantom check for \<slug\>" | `a1-phantom` |
| "drift check for \<slug\>/\<id\>" | `a1-reconcile` |

## vs. GSD / spec-kit

| | GSD | spec-kit | a1-specforge |
|---|---|---|---|
| Execution loop | ✅ | ❌ | ✅ |
| Spec writing | ❌ | ✅ | ✅ |
| Multi-agent orchestration | ❌ | ❌ | ✅ |
| Auto-activating skills | ❌ | ❌ | ✅ |
| Consistency gates | ❌ | ❌ | ✅ |
| Drift detection | ❌ | ❌ | ✅ |
| Vault integration | ❌ | ❌ | ✅ |

## Structure

```
a1-specforge/
├── a1-new-feature/     # Feature pipeline
├── a1-fix/             # Bug pipeline
├── a1-analyze/         # Codebase analyzer
├── a1-check/           # Consistency gate
├── a1-checklist/       # Pre-flight validator
├── a1-constitution/    # Constitution generator
├── a1-worktree/        # Worktree lifecycle
├── a1-pr-review/       # PR review pipeline
├── a1-phantom/         # Phantom task detector
├── a1-reconcile/       # Spec drift detector
├── _shared/
│   └── a1-tools.cjs    # Shared CLI helper
├── bin/
│   └── install.sh      # Symlink setup
└── docs/
    ├── roadmap.md
    └── feature-entry-conditions.md
```

## Roadmap

→ [`docs/roadmap.md`](docs/roadmap.md)

---

Built by [N3URAL.AI](https://n3ural.ai) · Runs on [Claude Code](https://claude.ai/code)
