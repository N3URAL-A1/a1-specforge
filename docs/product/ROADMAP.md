---
schema_version: 1
type: roadmap
project: a1-specforge
title: "a1-specforge — Roadmap"
status: active
updated: 2026-10-23
source: "migrated from docs/roadmap.md v3.0 (2026-07-10)"
milestones:
  - id: m0-repo-extract
    title: "Repo Extract"
    status: done
    target: 2026-05
  - id: m1-integrity-gates
    title: "Integrity Gates"
    status: done
    target: 2026-05
  - id: m2-phantom-proof-execution
    title: "Phantom-Proof Execution"
    status: done
    target: 2026-05
  - id: m3-quality-surface-expansion
    title: "Quality Surface Expansion"
    status: done
    target: 2026-05
  - id: m4-self-learning-loop
    title: "Self-Learning Loop"
    status: done
    target: 2026-05
  - id: m5-brownfield-modernization
    title: "Brownfield Modernization"
    status: done
    target: 2026-05
  - id: m6-works-for-rob
    title: "Works for Rob"
    status: done
    target: 2026-07
  - id: m7-oss-ready
    title: OSS-Ready
    status: done
    target: 2026-08
  - id: m8-launch-community
    title: "Launch & Community"
    status: in-progress
    target: 2026-09
  - id: continuous
    title: "Continuous / Unscheduled"
    status: in-progress
    target: null
features:
  - id: 001-roadmap-gate-parallel-features
    milestone: continuous
    title: "Roadmap Gate + Parallel Feature Lifecycle"
    status: done
    stage: null
    depends_on: []
    started: 2026-07-10
    finished: 2026-07-10
    spec_path: project/a1-specforge/spec/001-roadmap-gate-parallel-features.md
    plan_path: null
  - id: 002-product-docs-layer
    milestone: continuous
    title: "Project Product Docs: docs/product layer + adopt mode"
    status: done
    stage: done
    depends_on:
      - 001-roadmap-gate-parallel-features
    started: 2026-07-10
    finished: 2026-09-13
    spec_path: project/a1-specforge/spec/002-product-docs-layer.md
    plan_path: null
  - id: 007-retro-gate-id-validator
    milestone: continuous
    title: "Machine guards for false-green evidence: gate-id validator, workflow lint, glob liveness"
    status: done
    stage: done
    depends_on: []
    started: 2026-09-12
    finished: 2026-09-12
    spec_path: project/a1-specforge/spec/007-retro-gate-id-validator.md
    plan_path: project/a1-specforge/plans/007-retro-gate-id-validator-wave-plan.md
  - id: 008-false-green-test-guards
    milestone: continuous
    title: "Machine guards against false-green tests in the project repos"
    status: done
    stage: done
    depends_on: []
    started: 2026-09-13
    finished: 2026-09-13
    spec_path: project/a1-specforge/spec/008-false-green-test-guards.md
    plan_path: null
  - id: 005-vault-first-artifacts
    milestone: continuous
    title: "Vault-first artifacts"
    status: cancelled
    stage: null
    depends_on: []
    started: null
    finished: null
    spec_path: project/a1-specforge/spec/005-vault-first-artifacts.md
    plan_path: null
  - id: 006-specforge-kritis-profile
    milestone: continuous
    title: "SpecForge into a1 as an optional --profile kritis lane"
    status: planned
    stage: null
    depends_on: []
    started: null
    finished: null
    spec_path: project/a1-specforge/spec/006-specforge-kritis-profile.md
    plan_path: null
  - id: 004-xs-quick-lane
    milestone: continuous
    title: "XS Quick Lane (a1-quick)"
    status: done
    stage: null
    depends_on: []
    started: null
    finished: null
    spec_path: project/a1-specforge/spec/004-xs-quick-lane.md
    plan_path: null
  - id: 003-product-schema-v11-vision-audits
    milestone: continuous
    title: "Product schema v1.1: vision + audits (spec id contains a dot: 003-product-schema-v1.1-…)"
    status: done
    stage: null
    depends_on: []
    started: null
    finished: null
    spec_path: project/a1-specforge/spec/003-product-schema-v1.1-vision-audits.md
    plan_path: null
  - id: 009-cross-provider-review-gate
    milestone: continuous
    title: "Cross-provider review gate — Codex as a registered, read-only plan and wave reviewer"
    status: done
    stage: done
    depends_on: []
    started: 2026-09-24
    finished: 2026-10-04
    spec_path: project/a1-specforge/spec/009-cross-provider-review-gate.md
    plan_path: null
  - id: 010-vault-cockpit-contract
    milestone: continuous
    title: "Vault cockpit contract — every a1 status readable in Obsidian on Mac, server and phone"
    status: in-flight
    stage: started
    depends_on: []
    started: 2026-10-14
    finished: null
    spec_path: project/a1-specforge/spec/010-vault-cockpit-contract.md
    plan_path: null
  - id: 011-intent-queue-consumer
    milestone: continuous
    title: "Intent queue consumer — the a1 half of triggering skills from the phone via the vault"
    status: in-flight
    stage: started
    depends_on:
      - 010-vault-cockpit-contract
    started: 2026-09-26
    finished: null
    spec_path: project/a1-specforge/spec/011-intent-queue-consumer.md
    plan_path: null
  - id: 014-xprov-egress-hardening
    milestone: continuous
    title: "xprov egress hardening: owner-store permit, scan-bound run, secret patterns, gitleaks"
    status: done
    stage: done
    depends_on: []
    started: 2026-10-08
    finished: 2026-10-12
    spec_path: project/a1-specforge/spec/014-xprov-egress-hardening.md
    plan_path: project/a1-specforge/plans/014-xprov-egress-hardening-wave-plan.md
  - id: 015-docs-consolidation
    milestone: continuous
    title: "Docs consolidation: one roadmap source of truth, README vault section moved to docs/vault.md"
    status: done
    stage: done
    depends_on: []
    started: 2026-10-14
    finished: 2026-10-14
    spec_path: project/a1-specforge/spec/015-docs-consolidation.md
    plan_path: project/a1-specforge/plans/015-docs-consolidation-wave-plan.md
  - id: 016-xprov-autonomy
    milestone: continuous
    title: "xprov autonomy: chat consent instead of terminal steps, Codex at the right places, self-recovering aborts"
    status: done
    stage: done
    depends_on: []
    started: 2026-10-14
    finished: 2026-10-21
    spec_path: project/a1-specforge/spec/016-xprov-autonomy.md
    plan_path: project/a1-specforge/plans/016-xprov-autonomy-wave-plan.md
  - id: 017-enforced-self-checks
    milestone: continuous
    title: "Enforced self-checks: gates that really run, verifier reads exit codes, test fidelity, defect-class sweep"
    status: done
    stage: done
    depends_on:
      - 016-xprov-autonomy
    started: 2026-10-20
    finished: 2026-10-22
    spec_path: project/a1-specforge/spec/017-enforced-self-checks.md
    plan_path: project/a1-specforge/plans/017-enforced-self-checks-wave-plan.md
  - id: 018-pipeline-metrics
    milestone: continuous
    title: "Measure the pipeline: escaped-defect attribution and cost per feature"
    status: in-flight
    stage: review
    depends_on:
      - 017-enforced-self-checks
    started: 2026-10-23
    finished: null
    spec_path: project/a1-specforge/spec/018-pipeline-metrics.md
    plan_path: project/a1-specforge/plans/018-pipeline-metrics-wave-plan.md
  - id: 019-depth-pass-planning
    milestone: continuous
    title: "Depth Pass before every planning task"
    status: done
    stage: done
    depends_on: []
    started: 2026-10-19
    finished: 2026-10-21
    spec_path: project/a1-specforge/spec/019-depth-pass-planning.md
    plan_path: project/a1-specforge/plans/019-depth-pass-planning-wave-plan.md
  - id: 020-live-probes
    milestone: continuous
    title: "Live probes: measure the real effect after merge or deploy"
    status: planned
    stage: null
    depends_on: []
    started: null
    finished: null
    spec_path: project/a1-specforge/spec/020-live-probes.md
    plan_path: null
  - id: 021-dashboard
    milestone: continuous
    title: "a1-dashboard: local read-only view of pipeline state"
    status: planned
    stage: null
    depends_on:
      - 018-pipeline-metrics
    started: null
    finished: null
    spec_path: project/a1-specforge/spec/021-dashboard.md
    plan_path: null
next: 006-specforge-kritis-profile
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
- [~] **002-product-docs-layer** — Project Product Docs: human+machine readable `docs/product/` layer (ROADMAP.md, NEXT.md, index.json, features/) as single source of truth with CLI-maintained markers, ProOrg data contract, HTML-roadmap import, and adopt mode for existing projects. (depends on: 001-roadmap-gate-parallel-features)

## In-flight features

None.

## Changelog

- **2026-07-10** — added 002-product-docs-layer (in-flight, next) — combined feature from brainstorm: docs/product layer + adopt mode + HTML import.
- **2026-07-10** — Migrated from `docs/roadmap.md` v3.0 (markdown) to `docs/product/ROADMAP.md` schema v1 — new machine-readable roadmap contract; source file left untouched.
- **2026-07-10** — Added **001-roadmap-gate-parallel-features** (shipped) — first feature under the schema-v1 feature index; roadmap gate + parallel feature lifecycle merged (56e0fa4/e55addf).
- **2026-09-12** — feature '007-retro-gate-id-validator' added — new feature via `product add-feature`
- **2026-09-12** — feature.md created for '007-retro-gate-id-validator' — formal spec/plan attached via `product feature-init`
- **2026-09-12** — 007-retro-gate-id-validator -> complete — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> verify — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> merge — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> origin-cleanup — stage transition via `product stage`
- **2026-09-12** — 007-retro-gate-id-validator -> done — stage transition via `product stage`
- **2026-09-13** — feature '008-false-green-test-guards' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '008-false-green-test-guards' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature '005-vault-first-artifacts' added — new feature via `product add-feature`
- **2026-09-13** — feature '006-specforge-kritis-profile' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '005-vault-first-artifacts' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature.md created for '006-specforge-kritis-profile' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature '004-xs-quick-lane' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '004-xs-quick-lane' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — feature '003-product-schema-v11-vision-audits' added — new feature via `product add-feature`
- **2026-09-13** — feature.md created for '003-product-schema-v11-vision-audits' — formal spec/plan attached via `product feature-init`
- **2026-09-13** — 008-false-green-test-guards -> done — stage transition via `product stage`
- **2026-09-13** — 002-product-docs-layer -> done — stage transition via `product stage`
- **2026-09-24** — feature '009-cross-provider-review-gate' added — Codex (claudex-loop) becomes a registered a1 gate at PLAN.md and per wave with findings adapter, retro attribution, hardened CODEX_HOME and git tripwire — per Option D decision 2026-09-03
- **2026-09-24** — feature '010-vault-cockpit-contract' added — One-way mirror of docs/product and phase state into project/<slug>/, CLI-stamped type:, vault lint, hub spec links, host-aware locks; supersedes 005
- **2026-09-24** — feature '011-intent-queue-consumer' added — Signed, default-deny intent notes in inbox/intents/ consumed by a1-owned CLI on the Mac; closed action enum, single-flight, ledger outside the vault
- **2026-09-25** — spec 009 waves 1–6 merged (#10, 4ee46d9): xprov modules, Phase 4b / step 2b-x wiring, gates at warning — Codex becomes a registered read-only reviewer; Wave 7 (live smoke + blocking flip) awaits Robert's xprov permit
- **2026-09-26** — 011-intent-queue-consumer -> started — stage transition via `product stage`
- **2026-10-08** — feature '014-xprov-egress-hardening' added — Code leaves for Codex only with an owner-store permit, from a scanned snapshot, with gitleaks as a second layer; closes F-001/002/003/006/007/011/028/029
- **2026-10-08** — feature.md created for '014-xprov-egress-hardening' — formal spec/plan attached via `product feature-init`
- **2026-10-12** — 014-xprov-egress-hardening -> done — stage transition via `product stage`
- **2026-10-12** — 014-xprov-egress-hardening started date corrected to 2026-10-08 (claim date); code_scope claim released — product stage stamped today; the stage started on 2026-10-08
- **2026-10-12** — 009-cross-provider-review-gate -> done — stage transition via `product stage`; dates corrected to real span 2026-09-24 .. 2026-10-04 (Wave 7 merged in #18 / 26e79c3; blocking flip 2026-10-03), spec_path set after reconcile (all 30 FRs present)
- **2026-10-12** — 005-vault-first-artifacts -> cancelled (obsolete) — Spec closed itself 2026-09-13 as obsolete: the planned separate vault sink is superseded by A1_VAULT_ROOT, which delivers FR-001..003; cancelled (not done) because the spec premise no longer holds; a1-reconcile 2026-10-12 confirmed nothing to build
- **2026-10-13** — next cursor set to 006-specforge-kritis-profile — 002-product-docs-layer is done; product markers warned that next pointed at a done feature
- **2026-10-14** — feature '015-docs-consolidation' added — new feature via `product add-feature`
- **2026-10-14** — feature.md created for '015-docs-consolidation' — formal spec/plan attached via `product feature-init`
- **2026-10-14** — 010-vault-cockpit-contract -> started — stage transition via `product stage`
- **2026-10-14** — 015-docs-consolidation -> started — stage transition via `product stage`
- **2026-10-14** — 015-docs-consolidation -> done — stage transition via `product stage`
- **2026-10-14** — feature '016-xprov-autonomy' added — new feature via `product add-feature`
- **2026-10-14** — feature '017-enforced-self-checks' added — new feature via `product add-feature`
- **2026-10-14** — feature.md created for '016-xprov-autonomy' — formal spec/plan attached via `product feature-init`
- **2026-10-14** — feature.md created for '017-enforced-self-checks' — formal spec/plan attached via `product feature-init`
- **2026-10-14** — 015 docs consolidation done; 016 xprov autonomy and 017 enforced self-checks added and prioritised ahead of 006 — owner decision 2026-10-14: reliability and autonomy before launch and new profiles (record 2026-10-14-a1-autonomy-chat-consent)
- **2026-10-14** — 016-xprov-autonomy -> started — stage transition via `product stage`
- **2026-10-15** — feature '018-pipeline-metrics' added — new feature via `product add-feature`
- **2026-10-15** — feature.md created for '018-pipeline-metrics' — formal spec/plan attached via `product feature-init`
- **2026-10-18** — feature '019-depth-pass-planning' added — Every planner answers the four depth questions and rewrites its brief before decomposing; a deterministic gate enforces the section
- **2026-10-18** — feature.md created for '019-depth-pass-planning' — formal spec/plan attached via `product feature-init`
- **2026-10-19** — 019-depth-pass-planning -> complete — stage transition via `product stage`
- **2026-10-19** — 019-depth-pass-planning -> review — stage transition via `product stage`
- **2026-10-19** — 019-depth-pass-planning -> verify — stage transition via `product stage`
- **2026-10-19** — 016-xprov-autonomy -> complete — stage transition via `product stage`
- **2026-10-20** — 016-xprov-autonomy -> review — stage transition via `product stage`
- **2026-10-20** — 016-xprov-autonomy -> verify — stage transition via `product stage`
- **2026-10-20** — 016-xprov-autonomy -> merge — stage transition via `product stage`
- **2026-10-20** — 016-xprov-autonomy -> origin-cleanup — stage transition via `product stage`
- **2026-10-20** — 019-depth-pass-planning -> merge — stage transition via `product stage`
- **2026-10-20** — 019-depth-pass-planning -> origin-cleanup — stage transition via `product stage`
- **2026-10-20** — 017-enforced-self-checks -> started — stage transition via `product stage`
- **2026-10-20** — feature.md created for '001-roadmap-gate-parallel-features' — formal spec/plan attached via `product feature-init`
- **2026-10-20** — feature.md created for '002-product-docs-layer' — formal spec/plan attached via `product feature-init`
- **2026-10-20** — feature.md created for '010-vault-cockpit-contract' — formal spec/plan attached via `product feature-init`
- **2026-10-20** — feature.md created for '011-intent-queue-consumer' — formal spec/plan attached via `product feature-init`
- **2026-10-21** — 017-enforced-self-checks -> complete — stage transition via `product stage`
- **2026-10-21** — 016-xprov-autonomy -> done — stage transition via `product stage`
- **2026-10-21** — 019-depth-pass-planning -> done — stage transition via `product stage`
- **2026-10-22** — 017-enforced-self-checks -> review — stage transition via `product stage`
- **2026-10-22** — 017-enforced-self-checks -> verify — stage transition via `product stage`
- **2026-10-22** — 017-enforced-self-checks -> merge — stage transition via `product stage`
- **2026-10-22** — 017-enforced-self-checks -> origin-cleanup — stage transition via `product stage`
- **2026-10-22** — 017-enforced-self-checks -> done — stage transition via `product stage`
- **2026-10-22** — feature '020-live-probes' added — After merge or deploy, declared probes measure the real effect from outside, including a counter-test
- **2026-10-22** — feature.md created for '020-live-probes' — formal spec/plan attached via `product feature-init`
- **2026-10-23** — 018-pipeline-metrics -> complete — stage transition via `product stage`
- **2026-10-23** — 018-pipeline-metrics -> review — stage transition via `product stage`
- **2026-10-23** — feature '021-dashboard' added — A generated read-only vault note shows phases, waves, verifications, learnings and cost without reading files
- **2026-10-23** — feature.md created for '021-dashboard' — formal spec/plan attached via `product feature-init`

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
