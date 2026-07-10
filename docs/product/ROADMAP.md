---
schema_version: 1
type: roadmap
project: a1-specforge
title: a1-specforge — Roadmap
status: active
updated: 2026-07-10
source: "migrated from docs/roadmap.md v3.0 (2026-07-10)"
milestones:
  - id: m0-repo-extract
    title: Repo Extract
    status: done
    target: 2026-05
  - id: m1-integrity-gates
    title: Integrity Gates
    status: done
    target: 2026-05
  - id: m2-phantom-proof-execution
    title: Phantom-Proof Execution
    status: done
    target: 2026-05
  - id: m3-quality-surface-expansion
    title: Quality Surface Expansion
    status: done
    target: 2026-05
  - id: m4-self-learning-loop
    title: Self-Learning Loop
    status: done
    target: 2026-05
  - id: m5-brownfield-modernization
    title: Brownfield Modernization
    status: done
    target: 2026-05
  - id: m6-works-for-rob
    title: Works for Rob
    status: done
    target: 2026-07
  - id: m7-oss-ready
    title: OSS-Ready
    status: done
    target: 2026-08
  - id: m8-launch-community
    title: Launch & Community
    status: in-progress
    target: 2026-09
  - id: continuous
    title: Continuous / Unscheduled
    status: in-progress
    target: null
features:
  - id: 001-roadmap-gate-parallel-features
    milestone: continuous
    title: Roadmap Gate + Parallel Feature Lifecycle
    status: done
    stage: null
    depends_on: []
    started: 2026-07-10
    finished: 2026-07-10
next: null
---

# a1-specforge — Roadmap

> Two priorities, in order: **(1) reliability for daily production use** (gates, cost, ergonomics), **(2) open-source launch** (reputation + community adoption). Decisions 2026-07-04: product name is `a1-specforge`; learning store becomes repo-local (`.a1/learnings/`) by default with the Obsidian vault as optional sink via `A1_VAULT_ROOT`; no commercial layer. Vision: [`docs/VISION.md`](../VISION.md).

## Milestones

### Repo Extract <!-- entry: m0-repo-extract -->
Status: done · Target: 2026-05 (shipped 2026-05-12)
Goal: Skills versioned in repo, install.sh symlinks.

**Features:**
- (no tracked feature IDs — pre-schema milestone; contents in Appendix)

### Integrity Gates <!-- entry: m1-integrity-gates -->
Status: done · Target: 2026-05 (shipped 2026-05-17)
Goal: a1-analyze, a1-constitution (4-layer override), a1-check (bijective FR coverage).

**Features:**
- (no tracked feature IDs — pre-schema milestone; contents in Appendix)

### Phantom-Proof Execution <!-- entry: m2-phantom-proof-execution -->
Status: done · Target: 2026-05 (shipped 2026-05-17)
Goal: a1-phantom, a1-checklist, a1-worktree, a1-pr-review + Reinhard PR mode.

**Features:**
- (no tracked feature IDs — pre-schema milestone; contents in Appendix)

### Quality Surface Expansion <!-- entry: m3-quality-surface-expansion -->
Status: done · Target: 2026-05 (shipped 2026-05-17)
Goal: Reinhard/Tobi constitution-aware, feature-entry-conditions, a1-reconcile.

**Features:**
- (no tracked feature IDs — pre-schema milestone; contents in Appendix)

### Self-Learning Loop <!-- entry: m4-self-learning-loop -->
Status: done · Target: 2026-05 (shipped 2026-05-17)
Goal: a1-plan, a1-execute, a1-progress, a1-roadmap, a1-evolve + 6 framework agents.

**Features:**
- (no tracked feature IDs — pre-schema milestone; contents in Appendix)

### Brownfield Modernization <!-- entry: m5-brownfield-modernization -->
Status: done · Target: 2026-05 (shipped 2026-05-25; success criteria validated 2026-07-05)
Goal: a1-modernize (7 phases, 2 modes), a1-rafael-reverse-spec, a1-theo-test-engineer, 13 CLI subcommands.

**Features:**
- (no tracked feature IDs — pre-schema milestone; contents in Appendix)

### Works for Rob <!-- entry: m6-works-for-rob -->
Status: done · Target: 2026-07
Goal: Fewer escaped bugs, earlier detection, lower friction — validated on a1-office feature builds. Covers gate hardening, CLI ergonomics, cost tracker v1, and M5 validation. Two success criteria are instrumented and validate on upcoming runs (see Appendix).

**Features:**
- (scope tracked as phase waves, not feature IDs; details in Appendix)

### OSS-Ready <!-- entry: m7-oss-ready -->
Status: done · Target: 2026-08 (all success criteria validated 2026-07-05)
Goal: An external user goes from `git clone` to first verified feature without editing a single file. Portability (no personal hardcodes), English docs, CI over all fixtures.

**Features:**
- (scope tracked as phase waves, not feature IDs; details in Appendix)

### Launch & Community <!-- entry: m8-launch-community -->
Status: in-progress · Target: 2026-09
Goal: Real adoption: stars, first external contributors, first shared patterns. Plugin-marketplace packaging and gate-pack shipped 2026-07-05; launch posts and first external PR are time-deferred outcomes (drafts and enablers ready, publication is Robert/Sabine's call).

**Features:**
- (scope tracked as phase waves, not feature IDs; details in Appendix)

### Continuous / Unscheduled <!-- entry: continuous -->
Status: in-progress · Target: —
Goal: Framework hardening features shipped outside the milestone cadence.

**Features:**
- [x] **001-roadmap-gate-parallel-features** — Roadmap Gate + Parallel Feature Lifecycle: enforce roadmap existence/alignment before feature work and prevent in-flight features from claiming overlapping code scopes (lifecycle stages, code-scope reservations, release gate). Shipped 2026-07-10 (commits 56e0fa4/e55addf; spec + verification in `.a1/learnings/projects/a1-specforge/spec/`).

## In-flight features

None.

## Changelog

- **2026-07-10** — Migrated from `docs/roadmap.md` v3.0 (markdown) to `docs/product/ROADMAP.md` schema v1 — new machine-readable roadmap contract; source file left untouched.
- **2026-07-10** — Added **001-roadmap-gate-parallel-features** (shipped) — first feature under the schema-v1 feature index; roadmap gate + parallel feature lifecycle merged (56e0fa4/e55addf).

---

## Appendix — migrated details

Source: `docs/roadmap.md` v3.0 · Created 2026-07-04 · Owner: N3URAL.AI · Horizon: July–September 2026.
Basis: general analysis 2026-07-04 (3 OSS-BLOCKER, 6 MAJOR, 5 MINOR) + learning corpus (17+ runs, 15 applied patterns).

### M6 — Works for Rob (July 2026)

**Scope:**
- **Gate hardening**
  - Extend Surface-Coverage Gate 0.5 to content-derived surfaces (heading counts, slug/classification lists, test fixtures) — pattern recurred 2026-07-03 despite the gate. Rule: grep the new entity name across copy + logic + fixtures.
  - Hard read-only enforcement line in all a1-analyze agent briefs ("return output as TEXT, write NO files") — Marco breach 2026-06/07.
  - Promote `request_scoped_not_module_global` (security-relevant, Fluid Compute) into backend/web agent briefs.
  - Evaluate a deterministic CLI check for the `schema_flaw` class (8×) instead of prompt-only checklist.
- **CLI ergonomics**
  - `a1-tools add-findings --json <file|->` batch mode + fix word-splitting on multi-arg descriptions.
  - Fix install drift: install.sh covers all shipped skills (checkpoint deliberately excluded, commented).
- **Cost tracker v1** — `a1-tools cost`: token spend per spec/phase/wave from session logs, summary line in VERIFICATION.md.
- **M5 validation** — run the 4 open a1-modernize success criteria end-to-end and check them off.

**Success criteria:**
- [ ] Gate 0.5 catches a content-derived surface gap on a real run (or 5 clean runs pass) (instrumented in M6, validated on next runs)
- [x] `add-findings --json` lands with fixture test; analyze retro friction gone
- [ ] Cost per feature visible in VERIFICATION.md for 3 consecutive specs (instrumented in M6, validated on next runs)
- [x] M5 criteria all checked

### M7 — OSS-Ready (August 2026)

**Scope:**
- **Portability**
  - All `~/N3URAL-Vault` hardcodes (~30 sites) → `A1_VAULT_ROOT` with repo-local `.a1/learnings/` default; learning loop must not silently degrade without a vault.
  - All `~/code/a1-skills` hardcodes (a1-evolve) → dynamic repo-root resolution.
  - Remove personal absolute-path examples from workflows/_learning files.
  - Move the personal `checkpoint` skill out of the OSS repo into a private overlay.
- **Docs & language**
  - README rewrite: all skills documented, honest metrics, quickstart, demo GIF.
  - Unify to English (keep German trigger phrases as aliases).
- **CI**
  - GitHub Actions runs all `_test-fixtures/*/run.sh`; add the missing a1-phantom runner; smoke-test install.sh on a clean $HOME.

**Success criteria — all validated 2026-07-05, see `.a1/phases/M7-oss-ready/VERIFICATION.md`:**
- [x] Fresh-machine test (no vault, clean `~/.claude`): install → CLI writes land repo-local `.a1/learnings/`, zero file edits (transcript in VERIFICATION.md; found+fixed: install.sh missing mkdir -p)
- [x] CI green; phantom fixtures covered (GitHub Actions run 28742174363; phantom runner with deterministic nested-repo bootstrap)
- [x] README lists exactly the installed skill set (bijective diff install.sh↔README, exit 0)
- [x] checkpoint removed from public repo; Robert's local workflow intact (real dir at ~/.claude/skills/checkpoint)
- [x] No personal hardcodes in active skill files (all three sweep greps empty)

### M8 — Launch & Community (September 2026)

**Scope:**
- Claude Code plugin-marketplace packaging (one-command install).
- Launch content: Show-HN / Reddit / LinkedIn posts (via Sabine), demo video, docs site or extended docs/.
- CONTRIBUTING path for community retros + gate-packs (retro schema, PR template, a1-evolve clusters community patterns).
- First published gate-pack (candidate: "Postgres-RLS pack" from the a1-office corpus, anonymized).

**Success criteria — enablers built 2026-07-05, see `.a1/phases/M8-launch-community/`:**
- [x] Plugin installable via marketplace (validated live: `claude plugin install a1-specforge@a1-specforge` loaded 17 skills + 18 agents; self-hosted marketplace.json)
- [x] ≥ 1 gate-pack published (`packs/postgres-rls/`, A2-anonymized, validate exit 0)
- [ ] Launch posts live; ≥ 100 GitHub stars — **time-deferred outcome:** drafts ready in `docs/launch/` (Show HN, Reddit, LinkedIn) + demo.tape; publication is Robert/Sabine's call
- [ ] ≥ 1 external PR merged — **time-deferred outcome:** enablers shipped (CODE_OF_CONDUCT, 4 good-first-issue drafts, contributor dry-run fixed 2 friction points)

### Backlog (Someday / Maybe)

- **a1-dashboard** — local web UI over `.a1/` state (phases, waves, verifications, learnings, token spend)
- **a1-test** — spec-driven Playwright/Vitest generation from acceptance criteria
- **Learning-Exchange service** — hosted community pattern registry (post-M8, only if adoption warrants)
- PR-bridge / auto-changelog (PLAN.md → PR description)
- GitHub Actions as *pipeline gates* on PRs (a1-check/a1-checklist/a1-phantom in CI)

### Deliberately excluded

- Commercial layer (paid tier, SaaS) — reputation + community only, for now
- Full spec-kit adoption, Jira/Confluence, V-model (unchanged from v2)
- Multi-LLM abstraction — this is a Claude Code framework

### Dependency graph

```
M6: reliability (gates, CLI, cost)      ← must not regress during M7
  └── M7: portability, CI, docs
        └── M8: plugin, launch, community
```

### History — Roadmap v2.0 (May–June 2026, all shipped)

| Milestone | Shipped | Contents |
|---|---|---|
| M0 — Repo Extract | 2026-05-12 | Skills versioned in repo, install.sh symlinks |
| M1 — Integrity Gates | 2026-05-17 | a1-analyze, a1-constitution (4-layer override), a1-check (bijective FR coverage) |
| M2 — Phantom-Proof Execution | 2026-05-17 | a1-phantom, a1-checklist, a1-worktree, a1-pr-review + Reinhard PR mode |
| M3 — Quality Surface Expansion | 2026-05-17 | Reinhard/Tobi constitution-aware, feature-entry-conditions, a1-reconcile |
| M4 — Self-Learning Loop | 2026-05-17 | a1-plan, a1-execute, a1-progress, a1-roadmap, a1-evolve + 6 framework agents |
| M5 — Brownfield Modernization | 2026-05-25 | a1-modernize (7 phases, 2 modes), a1-rafael-reverse-spec, a1-theo-test-engineer, 13 CLI subcommands — success criteria validated 2026-07-05 (7-phase pipeline ✓, 2 modes ✓, Rafael+Theo agents ✓, 13 CLI subcommands ✓; validation found+fixed 2 frontmatter round-trip bugs, see `.a1/phases/M6-works-for-rob/m5-validation.md`) |

v2 background: gap-closing vs GitHub spec-kit (consistency gates, constitution separation, phantom detection). All three gaps closed.
