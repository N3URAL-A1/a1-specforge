# a1-specforge Roadmap — v3.0

**Created:** 2026-07-04 · **Owner:** N3URAL.AI · **Horizon:** July – September 2026
**Vision:** → [`docs/VISION.md`](VISION.md)

> **Note on self-hosting:** this repo intentionally does not run its own
> `a1-roadmap` skill to produce a `.a1/roadmap.md` scaffold. `docs/roadmap.md`
> (this file) is the deliberate single source of truth for a1-specforge's own
> milestones, hand-maintained alongside `.a1/phases/<milestone>/` state. If
> you're looking for the `.a1/roadmap.md` convention that `a1-roadmap`
> documents for *other* projects: for this repo, that role is filled by this
> file instead.

Two priorities, in order: **(1) reliability for daily production use** (gates, cost, ergonomics), **(2) open-source launch** (reputation + community adoption). Decisions 2026-07-04: product name is `a1-specforge`; learning store becomes repo-local (`.a1/learnings/`) by default with the Obsidian vault as optional sink via `A1_VAULT_ROOT`; no commercial layer.

Basis: general analysis 2026-07-04 (3 OSS-BLOCKER, 6 MAJOR, 5 MINOR) + learning corpus (17+ runs, 15 applied patterns).

---

## M6 — Works for Rob (July 2026)

**Goal:** Fewer escaped bugs, earlier detection, lower friction — validated on a1-office feature builds.

### Scope

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

### Success criteria

- [ ] Gate 0.5 catches a content-derived surface gap on a real run (or 5 clean runs pass) (instrumented in M6, validated on next runs)
- [x] `add-findings --json` lands with fixture test; analyze retro friction gone
- [ ] Cost per feature visible in VERIFICATION.md for 3 consecutive specs (instrumented in M6, validated on next runs)
- [x] M5 criteria all checked

---

## M7 — OSS-Ready (August 2026)

**Goal:** An external user goes from `git clone` to first verified feature without editing a single file.

### Scope

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

### Success criteria — all validated 2026-07-05, see `.a1/phases/M7-oss-ready/VERIFICATION.md`

- [x] Fresh-machine test (no vault, clean `~/.claude`): install → CLI writes land repo-local `.a1/learnings/`, zero file edits (transcript in VERIFICATION.md; found+fixed: install.sh missing mkdir -p)
- [x] CI green; phantom fixtures covered (GitHub Actions run 28742174363; phantom runner with deterministic nested-repo bootstrap)
- [x] README lists exactly the installed skill set (bijective diff install.sh↔README, exit 0)
- [x] checkpoint removed from public repo; Robert's local workflow intact (real dir at ~/.claude/skills/checkpoint)
- [x] No personal hardcodes in active skill files (all three sweep greps empty)

---

## M8 — Launch & Community (September 2026)

**Goal:** Real adoption: stars, first external contributors, first shared patterns.

### Scope

- Claude Code plugin-marketplace packaging (one-command install).
- Launch content: Show-HN / Reddit / LinkedIn posts (via Sabine), demo video, docs site or extended docs/.
- CONTRIBUTING path for community retros + gate-packs (retro schema, PR template, a1-evolve clusters community patterns).
- First published gate-pack (candidate: "Postgres-RLS pack" from the a1-office corpus, anonymized).

### Success criteria — enablers built 2026-07-05, see `.a1/phases/M8-launch-community/`

- [x] Plugin installable via marketplace (validated live: `claude plugin install a1-specforge@a1-specforge` loaded 17 skills + 18 agents; self-hosted marketplace.json)
- [x] ≥ 1 gate-pack published (`packs/postgres-rls/`, A2-anonymized, validate exit 0)
- [ ] Launch posts live; ≥ 100 GitHub stars — **time-deferred outcome:** drafts ready in `docs/launch/` (Show HN, Reddit, LinkedIn) + demo.tape; publication is Robert/Sabine's call
- [ ] ≥ 1 external PR merged — **time-deferred outcome:** enablers shipped (CODE_OF_CONDUCT, 4 good-first-issue drafts, contributor dry-run fixed 2 friction points)

---

## Backlog (Someday / Maybe)

- **a1-dashboard** — local web UI over `.a1/` state (phases, waves, verifications, learnings, token spend)
- **a1-test** — spec-driven Playwright/Vitest generation from acceptance criteria
- **Learning-Exchange service** — hosted community pattern registry (post-M8, only if adoption warrants)
- PR-bridge / auto-changelog (PLAN.md → PR description)
- GitHub Actions as *pipeline gates* on PRs (a1-check/a1-checklist/a1-phantom in CI)

## Deliberately excluded

- Commercial layer (paid tier, SaaS) — reputation + community only, for now
- Full spec-kit adoption, Jira/Confluence, V-model (unchanged from v2)
- Multi-LLM abstraction — this is a Claude Code framework

---

## M9 — Robustness (July 2026)

**Goal:** Harden the a1 tooling itself — worktree edge cases, the first clean module split of `a1-tools.cjs`, hostile-input fixture convention, atomic lock reclaim.

### Scope

- `worktree adopt`/`reconcile` for on-disk worktrees not (yet) tracked in the registry; `pr-review` fallback with no registry entry.
- First module split of the CLI facade behind a stable `_shared/lib/` interface (`io`, `locks`, `worktree-registry`, `product`).
- `_test-fixtures/CONVENTIONS.md` mandatory "Hostile inputs" section; `check reservations --release`.
- Atomic lock reclaim (`renameSync` + read-back-verify) for stale reservation locks.

### Success criteria — all validated 2026-07-12, see `.a1/phases/M9-robustness/VERIFICATION.md`

- [x] `worktree adopt`/`reconcile` work end-to-end against git truth (PASS 8/8 binary SCs, live-tested)
- [x] `pr findings-summary --worktree-path` fallback works with no registry entry
- [x] Facade split: `_shared/lib/{io,locks,worktree-registry,product}.cjs` extracted; facade 9584→7148 lines (2436 removed)
- [x] Hostile-input fixture convention documented + linked from CONTRIBUTING.md
- [x] `reservations --release` release/refuse/idempotent semantics + fixture coverage (22 passed, 0 failed)
- [x] Stale-lock reclaim uses tmp-write + rename + read-back-verify, 3 fixture cases green

## Dependency graph

```
M6: reliability (gates, CLI, cost)      ← must not regress during M7
  └── M7: portability, CI, docs
        └── M8: plugin, launch, community
              └── M9: robustness (worktree edge cases, module split, hostile inputs)
```

---

## History — Roadmap v2.0 (May–June 2026, all shipped)

| Milestone | Shipped | Contents |
|---|---|---|
| M0 — Repo Extract | 2026-05-12 | Skills versioned in repo, install.sh symlinks |
| M1 — Integrity Gates | 2026-05-17 | a1-analyze, a1-constitution (4-layer override), a1-check (bijective FR coverage) |
| M2 — Phantom-Proof Execution | 2026-05-17 | a1-phantom, a1-checklist, a1-worktree, a1-pr-review + Reinhard PR mode |
| M3 — Quality Surface Expansion | 2026-05-17 | Reinhard/Tobi constitution-aware, feature-entry-conditions, a1-reconcile |
| M4 — Self-Learning Loop | 2026-05-17 | a1-plan, a1-execute, a1-progress, a1-roadmap, a1-evolve + 6 framework agents |
| M5 — Brownfield Modernization | 2026-05-25 | a1-modernize (7 phases, 2 modes), a1-rafael-reverse-spec, a1-theo-test-engineer, 13 CLI subcommands — success criteria validated 2026-07-05 (7-phase pipeline ✓, 2 modes ✓, Rafael+Theo agents ✓, 13 CLI subcommands ✓; validation found+fixed 2 frontmatter round-trip bugs, see `.a1/phases/M6-works-for-rob/m5-validation.md`) |

v2 background: gap-closing vs GitHub spec-kit (consistency gates, constitution separation, phantom detection). All three gaps closed.
