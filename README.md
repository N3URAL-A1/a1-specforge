# a1-specforge

**Spec-driven development pipeline for Claude Code — from idea to reviewed PR, with a built-in self-learning loop.**

Claude Code is powerful, but without structure every session restarts from scratch: unclear specs, inconsistent plans, no trace of what was decided. a1-specforge gives Claude Code a backbone — auto-activating skills that guide every phase of a feature build, enforce consistency at deterministic gates, hand off between sub-agents automatically, and feed observations back into a self-optimizing learning loop.

<!--
  README scope note (keeps the bijective install/README check honest):
  bin/install.sh is the single source of truth for the installed set. Its
  grepped set = 17 skills + 18 agent names + the project slug. This README names
  exactly that set (skills AND agents both with the shared prefix) and no other
  matching token. The shared CLI is referenced only as the _shared/
  path, never by its filename, to avoid introducing a non-installed token. The
  personal checkpoint skill is NOT part of the public set (see
  docs/checkpoint-migration.md).
-->

## Quickstart

No environment variables required. From a clean machine:

```bash
git clone https://github.com/mellow-rob/a1-specforge.git
cd a1-specforge
./bin/install.sh
```

`install.sh` symlinks all skills and agents into `~/.claude/skills/` and `~/.claude/agents/`. Edits in the repo are live immediately — no reinstall. This is the **contributor / dev path** (live-edit symlinks).

### Install via plugin marketplace (users)

If you just want to use a1-specforge (no local edits), install it as a Claude Code plugin from the self-hosted marketplace — three commands:

```bash
claude plugin marketplace add mellow-rob/a1-specforge
claude plugin install a1-specforge@a1-specforge
claude plugin list        # confirm a1-specforge@a1-specforge is installed
```

All 17 skills and 18 agents load from the plugin. To remove: `claude plugin uninstall a1-specforge` then `claude plugin marketplace remove a1-specforge`. Contributors who want to edit skills in place should use `./bin/install.sh` above instead.

Then just describe what you want in Claude Code; the matching skill activates:

```
"new feature for my-project: edit user profile"
→ a1-new-feature activates → spec written → wave-plan built
→ consistency gate checks spec ↔ plan → code agents implement → PR reviewed
```

**Requirements:** Claude Code CLI, Node.js ≥ 18, git.

## Skills (17)

All 17 skills below match the `SKILLS` array in `bin/install.sh` exactly.

| Skill | Phase | Purpose |
|---|---|---|
| `a1-new-feature` | Build | End-to-end feature pipeline: Discover → Specify → Clarify → Plan → Consistency Gate → Implement → Verify. |
| `a1-new-project` | Build | Bootstrap a brand-new project from zero to a working feature backlog: Bootstrap → Scope-Interview → Roadmap → Backlog → first feature. |
| `a1-fix` | Build | End-to-end bug pipeline with a project-scoped learning loop: Pre-Flight → Report → Diagnose → Fix → Verify → Postmortem. |
| `a1-plan` | Plan | Full phase-planning pipeline: Research → Map → Plan → Audit, producing an executor-ready `PLAN.md` with waves and verifiable success criteria. |
| `a1-execute` | Execute | Wave-by-wave execution of a `PLAN.md` with a user checkpoint between waves and final goal-backward verification. |
| `a1-roadmap` | Plan | Create and manage roadmaps — break a product vision into milestones and phases and scaffold the `.a1/` directory for `a1-plan`. |
| `a1-analyze` | Insight | Read-only codebase analysis in five phases (parallel sub-agents): general, security, architecture, quality, onboarding. |
| `a1-modernize` | Insight | Understand, fix, or modernize an undocumented codebase. Two modes: `spec-only` (derive spec, read-only) and `full` (spec + gaps + wave-based fix plan). |
| `a1-progress` | Insight | Read-only project snapshot — scans `.a1/` state plus git/test/build state and recommends the next skill to run. |
| `a1-check` | Gate | Deterministic, no-LLM consistency gate verifying structural invariants between a feature's spec and its wave-plan (bijective FR coverage). |
| `a1-checklist` | Gate | Pre-flight readiness gate — 8 deterministic checks on a wave-plan (BLOCKER / MAJOR / MINOR) before execution starts. |
| `a1-constitution` | Setup | Generate/update a project's `constitution.md` — behavioral rules separated from CLAUDE.md's project facts, with 4-layer override precedence. |
| `a1-phantom` | Verify | Phantom-task detection — flags `[X]` tasks in `PLAN.md` with no matching git change. Warning-level, never blocks (always exits 0). |
| `a1-reconcile` | Verify | Spec-vs-implementation drift detection — classifies findings as MISSING / EXTRA / DIVERGED / STALE. |
| `a1-pr-review` | Review | Turns a finished branch into a reviewed PR: Detect → Review (reviewer sub-agent) → Draft → Submit. BLOCKER findings halt. |
| `a1-worktree` | Isolation | Isolated Git worktree lifecycle: Prepare → Enter → Exit (keep / discard / handoff), so agents work in a parallel checkout. |
| `a1-evolve` | Learn | Self-optimization engine — reads accumulated observations and `_learning.md` files, clusters recurring patterns, scores by impact, proposes concrete skill diffs. |

## Agents (18)

`install.sh` also symlinks 18 shared framework agents (counted from `agents/*.md`). Each installed file is the agent name below plus `.md`.

| Agent | Role |
|---|---|
| `a1-rico-researcher` | Research context, domain, prior art |
| `a1-marco-mapper` | Map codebase structure and architecture |
| `a1-pablo-planner` | Turn spec + research into an executable wave-plan |
| `a1-adam-auditor` | Audit plan quality and coverage gaps |
| `a1-erik-executor` | Execute one wave of a plan with commits |
| `a1-victor-verifier` | Goal-backward verification of a phase |
| `a1-falk-fault-finder` | Bug triage and root-cause analysis |
| `a1-reinhard-reviewer` | Code / PR review (line-level, security) |
| `a1-rafael-reverse-spec` | Derive a spec from existing code |
| `a1-theo-test-engineer` | Test design and coverage |
| `a1-tobi-tester` | Product / launch-readiness audit |
| `a1-rene-requirement-engineer` | Idea → requirements and backlog |
| `a1-alex-architekt` | System design and ADRs |
| `a1-walter-web-developer` | Web / full-stack implementation |
| `a1-aik-ai-engineer` | AI/ML, RAG, agent logic |
| `a1-uwe-ux-expert` | UX research and UI design |
| `a1-vincente-vibe-optimizer` | Build/code-task orchestration |
| `a1-ludwig-legal` | Legal / compliance (GDPR, EU AI Act) |

## Shared CLI

Deterministic helpers for all pipelines live under `_shared/` (`~6.8k` LOC): atomic frontmatter writes, number/suffix reservations, spec/fix/analyze scaffolding, phantom and schema checks, cost tracking, and the learning-store resolver. Skills call it; you rarely invoke it directly.

## Configuration

**No configuration is required.** The learning store resolves automatically via a 3-tier fallback chain (precedence: env > repo-local > legacy):

| Tier | Source | When used |
|---|---|---|
| 1 | `A1_VAULT_ROOT` (env) | Set explicitly → used as-is; directory created on first write. |
| 2 | repo-local `.a1/learnings/` | Default inside any git repo — auto-created on first write. |
| 3 | legacy `~/N3URAL-Vault` | Only if it already exists **and** you are not inside a git repo; emits a deprecation warning. |

If none resolve (not in a git repo, no env, no legacy vault), the CLI hard-fails with exit 2 and tells you to set `A1_VAULT_ROOT` or run inside a git repo — **no silent degradation**. The resolved root and its source are printed once per process to stderr.

| Variable | Default | Description |
|---|---|---|
| `A1_VAULT_ROOT` | *(unset)* → repo-local `.a1/learnings/` | Optional. Point the learning store at an external vault (e.g. an Obsidian notes directory). |

```bash
# Optional — only if you want an external vault instead of repo-local .a1/learnings/
export A1_VAULT_ROOT="/path/to/your/notes"
```

## Language policy

English-first; German trigger phrases remain supported as aliases. Some workflow bodies are still mixed-language — full unification is deferred to M8.

## Testing

13 fixture test suites live under `_test-fixtures/*/run*.sh` (including the vault-fallback and phantom runners) plus a nested schema-check parser runner. Run them all:

```bash
for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done
```

CI runs the same suites, a `node --check` on the CLI, and an `install.sh` smoke test on a clean `$HOME`.

## vs. GSD / spec-kit

| | GSD | spec-kit | a1-specforge |
|---|---|---|---|
| Execution loop | ✅ | ❌ | ✅ |
| Spec writing | ❌ | ✅ | ✅ |
| Multi-agent orchestration | ❌ | ❌ | ✅ |
| Auto-activating skills | ❌ | ❌ | ✅ |
| Deterministic consistency gates | ❌ | ❌ | ✅ |
| Drift + phantom detection | ❌ | ❌ | ✅ |
| Self-learning loop (observations → evolve) | ❌ | ❌ | ✅ |
| Cost tracker | ❌ | ❌ | ✅ |
| Reusable gate-packs (`packs/`) + `docs/CONSTITUTION.md` | ❌ | ❌ | ✅ |

## Structure

```
a1-specforge/
├── <skill>/            # 17 skill directories (see table above)
├── agents/             # 18 shared framework agents (one .md each)
├── _shared/            # deterministic CLI helpers (frontmatter, reservations, checks)
├── packs/              # reusable gate-packs (e.g. postgres-rls)
├── bin/install.sh      # symlink setup
├── docs/               # roadmap.md, CONSTITUTION.md, feature-entry-conditions.md, …
└── _test-fixtures/     # fixture test suites
```

## Roadmap

→ [`docs/roadmap.md`](docs/roadmap.md)

---

Built by [N3URAL.AI](https://n3ural.ai) · Runs on [Claude Code](https://claude.ai/code)
