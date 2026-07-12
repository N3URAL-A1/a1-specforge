# a1-specforge — Product Vision

**Created:** 2026-07-04 · **Owner:** N3URAL.AI

## One sentence

**The self-improving development framework: a spec-driven pipeline for Claude Code that learns from every run and rewrites its own gates.**

## Why this exists

AI coding agents are strong at writing code and weak at everything around it: unclear specs, silent scope drift, false "done" reports, bugs found in production instead of at the gate. Every framework in this space (spec-kit, GSD, Taskmaster) ships a *static* process. a1-specforge ships a *learning* one:

```
run → retro (_learning.md / .a1/learnings/) → cluster (a1-evolve)
    → diff on the skill/agent prompts themselves → harder gates on the next run
```

This loop is real, not aspirational: 15 patterns applied since May 2026 with dated provenance (e.g. an 8×-recurring DB-schema bug class became a per-table checklist in the planner; false agent self-reports became Gate 0; incomplete surface coverage became Gate 0.5). **The framework that built the most features has the best gates — and can share them.**

## Who it's for

1. **Primary today:** a solo non-developer founder (Robert) shipping real SaaS products (a1-office, niimo) entirely through Claude Code. Every reliability gain here is validated on production software.
2. **Next:** solo devs and small teams using Claude Code who want repeatable, auditable feature delivery instead of vibe sessions.
3. **Later:** teams that treat the shared learning corpus as an asset — imported gate-packs instead of re-learning the same bugs.

## Strategic pillars

### 1. Reliability first ("it must work for me")
The product is only credible if it ships Robert's products with fewer escaped bugs and lower cost. Priorities: shift detection left (11/17 bug catches currently happen at the last two gates), deterministic CLI checks over prompt appeals, token-cost visibility per spec/wave.

### 2. Portability ("works on any machine")
No hardcoded personal paths. Learning store is repo-local (`.a1/learnings/`) by default; an Obsidian vault is an optional sink via `A1_VAULT_ROOT`. One install command, one source of truth for the skill list.

### 3. Community learning ("the moat")
The long-term differentiator is not the pipeline — it's the **learning exchange**:
- **Gate-Packs:** anonymized, importable pattern bundles. Shipped: "Postgres-RLS pack" (`packs/postgres-rls/`). Candidates for future packs: "Next.js deploy pack", "Flutter parity pack". Users import battle-tested gates instead of collecting their own bugs.
- Network effect: more users → more retros → better shared gates → more users.
- Contribution path: a retro schema anyone can submit via PR; a1-evolve clusters community patterns the same way it clusters local ones.

## Creative directions (prioritized)

> Note: this table reflects original prioritization intent, not shipped order.
> In execution, #5 (GitHub Actions gates) and #6 (Plugin distribution) shipped
> in M7/M8 ahead of #2 (a1-dashboard) and #4 (a1-test), which remain in
> `docs/roadmap.md`'s Backlog section. Treat `docs/roadmap.md` as the
> authoritative sequencing; this table is the original rationale.

| # | Idea | What it is | Why |
|---|------|-----------|-----|
| 1 | **Gate-Packs / Learning-Exchange** | Shareable pattern bundles + import command | The network-effect moat; nobody else can copy a corpus |
| 2 | **a1-dashboard** | Local web UI over `.a1/` state: phases, waves, verifications, learnings, token spend | Makes the pipeline visible to non-developers — the founder persona |
| 3 | **Cost tracker** (`a1-tools cost`) | Token spend per spec/phase/wave, reported in VERIFICATION.md | "What did this feature cost?" — unanswered today |
| 4 | **a1-test** | Spec-driven Playwright/Vitest generation from acceptance criteria | Closes the ACs → executable tests gap; kills mock-test blind spots |
| 5 | **GitHub Actions gates** | a1-check / a1-checklist / a1-phantom as CI checks on PRs | Extends gates beyond the local session; team-readiness |
| 6 | **Plugin distribution** | Claude Code plugin-marketplace packaging | `install` in one command instead of clone+symlink |

## What we deliberately don't do

- No commercial layer for now (no SaaS, no paid tier) — ambition is reputation for N3URAL.AI + genuine community adoption.
- No Jira/Confluence integration, no V-model, no full spec-kit adoption (unchanged from v2).
- No multi-LLM abstraction — this is a Claude Code framework, deeply integrated, not a lowest-common-denominator tool.

## Success criteria (12 months)

- Robert ships every N3URAL feature through the pipeline with **zero escaped BLOCKER bugs** over a rolling 10-run window and visible cost per feature.
- An external user goes from `git clone` to first verified feature **without editing a single file**.
- ≥ 1 community-contributed pattern applied via a1-evolve; ≥ 1 gate-pack published and imported by a stranger.
