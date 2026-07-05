# a1-specforge Roadmap — v3.0

**Created:** 2026-07-04 · **Owner:** N3URAL.AI · **Horizon:** July – September 2026
**Vision:** → [`docs/VISION.md`](VISION.md)

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
  - Remove `/Users/rob/...` examples from workflows/_learning files.
  - Move the personal `checkpoint` skill out of the OSS repo into a private overlay.
- **Docs & language**
  - README rewrite: all skills documented, honest metrics, quickstart, demo GIF.
  - Unify to English (keep German trigger phrases as aliases).
- **CI**
  - GitHub Actions runs all `_test-fixtures/*/run.sh`; add the missing a1-phantom runner; smoke-test install.sh on a clean $HOME.

### Success criteria

- [ ] Fresh-machine test (no vault, clean `~/.claude`): install → a1-new-feature run → verified feature, zero file edits
- [ ] CI green on PRs; phantom fixtures covered
- [ ] README lists exactly the installed skill set (single source of truth)

---

## M8 — Launch & Community (September 2026)

**Goal:** Real adoption: stars, first external contributors, first shared patterns.

### Scope

- Claude Code plugin-marketplace packaging (one-command install).
- Launch content: Show-HN / Reddit / LinkedIn posts (via Sabine), demo video, docs site or extended docs/.
- CONTRIBUTING path for community retros + gate-packs (retro schema, PR template, a1-evolve clusters community patterns).
- First published gate-pack (candidate: "Postgres-RLS pack" from the a1-office corpus, anonymized).

### Success criteria

- [ ] Plugin installable via marketplace
- [ ] Launch posts live; ≥ 100 GitHub stars
- [ ] ≥ 1 external PR merged; ≥ 1 gate-pack published

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

## Dependency graph

```
M6: reliability (gates, CLI, cost)      ← must not regress during M7
  └── M7: portability, CI, docs
        └── M8: plugin, launch, community
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
