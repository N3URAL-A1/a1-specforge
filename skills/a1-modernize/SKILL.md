---
name: a1-modernize
description: >
  Use PROACTIVELY whenever the user wants to understand, fix, or modernize an
  existing codebase that lacks documentation, specs, or tests. Two modes:
  `spec-only` (derive the spec from code, read-only, fast) and `full` (derive
  spec + gap-analysis + tech proposals + wave-based fix plan with tests + Notion
  publish). Seven-phase pipeline: Scope → Reverse-Spec → Gap-Analysis →
  Tech-Proposals → Plan → Execute → Publish. State in YAML frontmatter
  (scoped → spec-drafted → gap-analyzed → proposals-pending → planned →
  executing → published). Output stored repo-local (external vault via
  `A1_VAULT_ROOT`, e.g. Obsidian):
  projects/<slug>/modernize/<YYYY-MM-DD>-<focus>[-N].md.
  MUST trigger on: "modernize <project>", "clean up an old codebase" (alias:
  "alte Codebase aufräumen"), "derive specs" (alias: "specs ableiten"),
  "reverse-spec", "what does this app do" (alias: "was tut diese App"), "code
  without docs" (alias: "code ohne docs"), "unmaintained app" (alias:
  "ungepflegte App"), "clean up legacy code" (alias: "legacy-code aufräumen"),
  "existing codebase" (alias: "bestehende Codebase"), "understand code without
  docs" (alias: "code verstehen ohne doku"), "a1-modernize", "specs for an
  existing project" (alias: "specs für bestehendes projekt"), "brownfield",
  "reduce tech debt" (alias: "tech debt abbauen"), "modernize the codebase"
  (alias: "codebase modernisieren"), "it works but nobody knows how" (alias:
  "funktioniert aber niemand weiß wie"), or any request to understand/improve
  an existing app without a greenfield redesign.
  Orchestrates a1-rafael-reverse-spec + a1-marco-mapper (Phase 2),
  a1-reinhard-reviewer + a1-alex-architekt + a1-reconcile (Phase 3),
  stack-conditional agents (Phase 4), a1-pablo-planner + a1-adam-auditor
  (Phase 5), a1-erik-executor + a1-victor-verifier + a1-theo-test-engineer
  (Phase 6).
  Do NOT activate for: new feature work on a documented codebase (→ a1-new-feature),
  single bug fix (→ a1-fix), read-only codebase analysis (→ a1-analyze),
  spec-vs-implementation drift check (→ a1-reconcile directly).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-modernize — Brownfield Modernization Pipeline

Language: English-first; German trigger aliases supported.

This skill is a thin orchestrator. Phase logic lives in `workflows/`. The CLI
helper (`<repo>/_shared/a1-tools.cjs`) handles deterministic file ops.
Sub-agents do the thinking. Robert approves at every stop-gate.

## When to use

Activate when the user has an existing app — working or broken — without
adequate documentation, specs, or tests, and wants to understand it, improve it,
or both.

| Situation | Mode |
|---|---|
| "I just want to understand what this app does" | `spec-only` |
| "I want to understand it AND fix it up" | `full` |

If the user wants to add a brand-new feature to a well-documented codebase, use
`a1-new-feature`. If they report a single crash, use `a1-fix`. If they want a
read-only forensic analysis, use `a1-analyze`.

## Phases

| # | Phase | Workflow | Mode | Status after |
|---|---|---|---|---|
| 1 | Scope | `workflows/01-scope.md` | both | `scoped` |
| 2 | Reverse-Spec | `workflows/02-reverse-spec.md` | both | `spec-drafted` |
| 3 | Gap-Analysis | `workflows/03-gap-analysis.md` | both | `gap-analyzed` ← END for spec-only |
| 4 | Tech-Proposals | `workflows/04-tech-proposals.md` | full only | `proposals-pending` |
| 5 | Plan | `workflows/05-plan.md` | full only | `planned` |
| 6 | Execute | `workflows/06-execute.md` | full only | `executing` → `executed` |
| 7 | Publish | `workflows/07-publish.md` | full only | `published` |

Terminal non-completion status: `cancelled`.

**Retro:** Phase 7 (Publish) closes with a mandatory Retro — see
`workflows/07-publish.md` — feeding `a1-evolve`'s pattern clustering.

## Stop-and-Ask Gates

Robert must approve before these phase transitions:

| Gate | After phase | What Robert sees |
|---|---|---|
| G1 | Phase 2 | Reverse-spec: FR list, ACs, open questions |
| G2 | Phase 4 | Per-proposal approval (pending/approved/rejected/deferred) |
| G3 | Phase 5 | Wave DAG, wave briefs, test strategy |
| G4 | Before each wave | Wave brief + snapshot plan |
| G5 | After each wave | Diff, parity-replay result, FR-AC checks |
| G6 | Before publish | Final report preview |

Never transition past a gate without explicit Robert confirmation.

## Mode routing

In Phase 1 (Scope), confirm the mode:
- `spec-only`: run Phases 1–3, stop after `gap-analyzed`
- `full`: run all 7 phases

## Routing — pick the right phase

1. If the user provides a master file path: read frontmatter `status`.
2. If no master file exists: start Phase 1.
3. Route by status:
   - `scoped` → Phase 2
   - `spec-drafted` → Gate G1 (show spec, wait for Robert) → Phase 3
   - `gap-analyzed` → if `spec-only` mode: done, show `suggested_next`; if `full`: → Phase 4
   - `proposals-pending` → Gate G2 (show proposals) → Phase 5
   - `planned` → Gate G3 (show plan) → Phase 6
   - `executing` → resume next pending wave (Gate G4)
   - `executed` → Phase 7
   - `published` → done, show `suggested_next`
   - `cancelled` → no work, confirm and stop

## State mechanics

All state is in YAML frontmatter of the master file. Update via CLI only:

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "projects/<slug>/modernize/<YYYY-MM-DD>-<focus>.md" <new-status> \
  [--phase-data '<json>']
```

Proposals and waves have dedicated commands:

```bash
# Add a tech proposal
node <repo>/_shared/a1-tools.cjs modernize add-proposal \
  "<master-path>" --title "<t>" --rationale "<r>" --risk low|medium|high \
  --effort "<e>" --rollback "<rb>"

# Approve/reject/defer a proposal
node <repo>/_shared/a1-tools.cjs modernize approve-proposal \
  "<master-path>" P-001 approved|rejected|deferred [--reason "<text>"]

# Add a wave
node <repo>/_shared/a1-tools.cjs modernize add-wave \
  "<master-path>" --title "<t>" [--depends-on W-01,W-02]

# Start / complete a wave
node <repo>/_shared/a1-tools.cjs modernize start-wave "<master-path>" W-01
node <repo>/_shared/a1-tools.cjs modernize complete-wave "<master-path>" W-01 \
  --snapshot-replay pass|fail --fr-ac-checks '<json>'

# Verify parity (exit-1 on drift)
node <repo>/_shared/a1-tools.cjs modernize verify-parity "<master-path>"
```

## Storage

All artifacts default repo-local; external vault via `A1_VAULT_ROOT` (e.g. Obsidian):
- Master file: `projects/<slug>/modernize/<YYYY-MM-DD>-<focus>[-N].md`
- Wave artifacts in repo: `.a1/phases/<modernize-slug>/waves/wave-NN.md`

Learning store defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` to use an external vault (e.g. Obsidian).
Override via env var `A1_VAULT_ROOT`.

## Agent integration

| Phase | Agent(s) | Source |
|---|---|---|
| 2 Reverse-Spec | a1-rafael-reverse-spec + a1-marco-mapper | `agents/*-link.md` |
| 3 Gap-Analysis | a1-reinhard-reviewer + a1-alex-architekt + a1-reconcile (sub-process) | `agents/*-link.md` |
| 4 Tech-Proposals | walter / felix / dirk / aik (stack-conditional) | `agents/*-link.md` |
| 5 Plan | a1-pablo-planner + a1-adam-auditor | `agents/*-link.md` |
| 6 Execute | a1-erik-executor + a1-victor-verifier + a1-theo-test-engineer | `agents/*-link.md` |

Phase 4 dispatch rule — only spawn agents whose stack is present in `discover.tech_stack`:
- Web/Frontend (react, next, vue, angular) → walter
- Mobile (flutter, swift, kotlin) → felix
- Infra (docker, k8s, terraform, ci/cd) → dirk
- AI/LLM components → aik

Agents in Phases 2–3 are read-only. No code edits until Phase 6.

## Hard rules

- Never edit the master frontmatter directly with Edit/Write — always use `a1-tools modernize ...`.
- Phase 2 stop-gate is mandatory. Phase 3 does not start without Robert's explicit approval of the reverse-spec.
- Tech proposals are approved individually. Never batch-approve.
- Per wave in Phase 6: no behavior snapshot = no implementation, no parity-replay-green = no commit, no FR-AC-check = no done.
- Sub-agents get a structured brief: Project Context, Focus, Output-Contract, Out-of-Scope.
- Skill never writes into `fixes/` directly — call `a1-fix` as a wave if appropriate.
- User-facing output language: see `_shared/language-policy.md` (artifacts English,
  conversation in the user's language).
- One question per turn in Phase 1. Max 2 clarifying questions total.
- Sub-agents referenced via `agents/<name>-link.md`. Never redefine them here.
- `open_question:` entries in the reverse-spec are never filled by the skill — only Robert can resolve them.
- Functional parity (`verify-parity` green) is the definition-of-done per wave.
- Notion publish: on failure, show clear message + fallback to local Markdown export. No silent skip.

## Hand-offs

| Situation | Next skill |
|---|---|
| BLOCKER finding in gap-analysis | `a1-fix` |
| Architectural drift | `a1-reconcile` |
| No `constitution.md` in project | `a1-constitution` |
| Post-modernize new feature | `a1-new-feature` |
| Deferred tech proposal → own sprint | `a1-plan` |

`a1-roadmap`'s `adopt` mode (brownfield migration of a legacy-only project
to `docs/product/` schema v1) MAY call this skill in `spec-only` mode to
derive reverse-spec evidence (done/status signals) for milestones/features
that predate any formal spec — see `a1-roadmap` SKILL.md "Adopt mode". This
skill itself never writes to `docs/product/`; any such write happens through
`a1-tools product ...`, called by `a1-roadmap`.

## Versions

- v1 (2026-05-25): initial build. 7 phases, 2 modes, 13 CLI subcommands, 2 new agents (a1-rafael-reverse-spec, a1-theo-test-engineer), M5.
