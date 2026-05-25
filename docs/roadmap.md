# a1-specforge Roadmap — v2.0

**Created:** 2026-05-12  
**Owner:** N3URAL.AI  
**Horizon:** May – July 2026

## Vision

Turn a good multi-agent framework into a complete, provably-closed development system: every phase verifiably done, every artifact consistent, no task silently empty.

## Background

Comparing against [GitHub spec-kit](https://github.com/github/spec-kit): a1-specforge is stronger in four areas (Vault integration, multi-agent personas, code-review graph MCP, self-learning loop). It started weaker in three:

1. Cross-artifact consistency (no check: does spec↔plan↔tasks align?)
2. Constitution separation (CLAUDE.md mixed rules with project data)
3. Phantom-task detection (task marked [X] but no code behind it?)

This roadmap closes those gaps.

---

## M0 — Repo Extract ✅ (2026-05-12)

Extracted skill set from `~/.claude/skills/` into this repo. Symlinks set. Deployment via `bin/install.sh`.

**Result:** Skills are versioned, reproducible, and publicly shareable.

---

## M1 — Integrity Gates ✅ (2026-05-17)

**Goal:** No feature build starts without a verified artifact stack.

### Shipped

- **`a1-analyze`** — 5-phase parallel codebase analysis (general, security, architecture, quality, onboarding). Hard gate between Plan → Build in `a1-new-feature`.
- **`a1-constitution`** — Generates `constitution.md` per project. Clear separation: `CLAUDE.md` = facts + context / `constitution.md` = behavioral rules + 4-layer override precedence (Global Rules < Project CLAUDE.md < Agent Frontmatter < Session Instruction).
- **`a1-check`** — Bijective FR-coverage gate: every functional requirement maps to exactly one wave, no gaps, no duplicates.

### Success criteria

- [x] `a1-analyze` ships with 5 parallel sub-agent phases
- [x] Constitution skill generates a complete `constitution.md` with 4-layer override model
- [x] Override precedence documented in one place, enforced in Reinhard reviews

---

## M2 — Phantom-Proof Execution ✅ (2026-05-17)

**Goal:** No task silently empty.

### Shipped

- **`a1-phantom`** — Phantom-task detection: checks every `[X]` task in PLAN.md against the actual git diff. Docs-only tasks exempt via `# no-code` tag.
- **`a1-checklist`** — Pre-flight validator. 8 checks before execution: BLOCKER / MAJOR / MINOR severity. Integrates into `a1-new-feature` as an optional pre-check.
- **`a1-worktree`** — Git worktree lifecycle: prepare → enter → exit (keep / discard / handoff). Layout: `~/code/.worktrees/<project>/wave-<id>-<slug>/`.
- **`a1-pr-review` + Reinhard PR-mode** — One PR per wave. Reinhard reviews via `gh pr diff`, writes `gh pr review --comment`, APPROVE/REQUEST_CHANGES gate before merge.

### Success criteria

- [x] `a1-phantom` ships and detects phantom tasks against real git diffs
- [x] `a1-checklist` runs as optional pre-check in `a1-new-feature`
- [x] `a1-worktree` lifecycle fully implemented
- [x] Reinhard reviews a wave PR and returns APPROVE or REQUEST_CHANGES

---

## M3 — Quality Surface Expansion ✅ (2026-05-17)

**Goal:** Code review and feature ideation seamlessly integrated.

### Shipped

- **Reinhard + Tobi extensions** — Reinhard: `constitution.md`-aware reviews, RLS check as mandatory for n3ural-platform PRs. Tobi: `constitution.md` compliance as blocking gate in launch-readiness checklist (STEP 8).
- **Feature entry conditions** — `docs/feature-entry-conditions.md`: clear decision tree for `feature-idea` vs `feature-spec` vs `a1-new-feature`. No more guessing.
- **`a1-reconcile`** — Spec-drift detection: compares implementation against spec, classifies MISSING / EXTRA / DIVERGED / STALE. Output: `projects/<name>/drift-YYYY-MM-DD.md` in Obsidian Vault.

### Success criteria

- [x] Reinhard flags missing RLS coverage in constitution-aware review mode
- [x] `feature-idea` / `feature-spec` have documented, unambiguous entry conditions
- [x] `a1-reconcile` runs cleanly on a test project with DIVERGED semantic routing to Alex

---

## M4 — Self-Learning Loop ✅ (2026-05-17)

**Goal:** Skills improve through use, not through theorizing.

### Shipped

- **`a1-plan`** — Research → Map → Plan → Audit pipeline. 4 parallel sub-agents: a1-rico-researcher, a1-marco-mapper, a1-pablo-planner, a1-adam-auditor.
- **`a1-execute`** — Wave-by-wave execution with a1-erik-executor + a1-victor-verifier. Inline observations written to `.a1/phases/<name>/observations.jsonl`.
- **`a1-progress`** — Project status check across all active phases.
- **`a1-roadmap`** — New project / milestone planning.
- **`a1-evolve`** — Self-optimization engine: reads `_learning.md` files + Obsidian Vault learning store, clusters patterns (threshold: 3+ occurrences), proposes diffs for SKILL.md and agent files.
- **6 framework agents** — a1-rico-researcher, a1-pablo-planner, a1-erik-executor, a1-victor-verifier, a1-marco-mapper, a1-adam-auditor.

### Success criteria

- [x] a1-execute writes structured observations after each wave
- [x] a1-evolve reads Vault as canonical learning store
- [x] 5-run accumulation triggers an evolution proposal

---

## M5 — Brownfield Modernization (2026-05-25)

**Goal:** Handle existing codebases that lack docs, specs, and tests. Derive the spec from code, find gaps, propose improvements, execute wave-by-wave with guaranteed parity.

### Shipped

- **`a1-modernize`** — 7-phase brownfield pipeline (Scope → Reverse-Spec → Gap-Analysis → Tech-Proposals → Plan → Execute → Publish). Two modes: `spec-only` (read-only, understand what the app does) and `full` (understand + modernize). Stop-gate before every major transition — Robert approves everything individually.
- **`a1-rafael-reverse-spec`** — New agent. Reads existing code without documentation, extracts observed behavior into user stories, flows, data models, and acceptance criteria. Flags unclear intent as `open_question:` — never guesses.
- **`a1-theo-test-engineer`** — New agent. Provides current test patterns per stack, writes skeleton test files per wave, marks parity assertions explicitly. Works together with Erik in Phase 6.
- **13 CLI subcommands** (`modernize` group in `_shared/a1-tools.cjs`): `init`, `next-slot`, `update-status`, `discover-stack`, `add-proposal`, `approve-proposal`, `add-wave`, `snapshot-behavior`, `start-wave`, `complete-wave`, `verify-parity`, `publish-notion`, `list`.

### Design decisions

- Eigenständiger Skill (nicht Mode von `a1-analyze`) — a1-analyze ist read-only, a1-modernize schreibt.
- Proposals haben Status `pending / approved / rejected / deferred` — einzeln, nie batch.
- Funktionale Parität (`verify-parity` grün) ist Definition-of-Done pro Wave.
- Notion-Publish mit lokalem Markdown-Fallback — kein stiller Skip.

### Success criteria

- [ ] `a1-modernize spec-only` runs on a project with no docs and produces a complete reverse-spec
- [ ] `a1-modernize full` executes a wave with behavior-snapshot + parity-replay
- [ ] `a1-rafael-reverse-spec` flags at least 1 open_question on an ambiguous codebase
- [ ] `a1-theo-test-engineer` produces a skeleton test with parity assertions for Flutter + React

---

## Backlog (Someday / Maybe)

- Cost tracker per spec (token spend per feature build)
- PR-bridge / auto-changelog (PLAN.md → PR description)
- GitHub Actions integration (multi-person setup)
- `a1-test` — spec-driven test generation (Playwright + Vitest from acceptance criteria)

## Deliberately excluded

- Full spec-kit adoption (a1-specforge is better adapted to our stack)
- Jira / Confluence integration (no need for solo operator)
- V-model extension (overkill)

---

## Dependency graph

```
M0: Repo extract
  └── M1: a1-constitution, a1-analyze, a1-check
        └── M2: a1-checklist, a1-phantom, a1-worktree, a1-pr-review
              └── M3: Reinhard/Tobi extensions, a1-reconcile, feature-entry-conditions
                    └── M4: a1-plan, a1-execute, a1-evolve, a1-progress, a1-roadmap
                          └── M5: a1-modernize, a1-rafael-reverse-spec, a1-theo-test-engineer
```
