---
name: a1-new-project
description: >
  Bootstrap a brand-new project from zero and drive it all the way to a working
  feature backlog that gets implemented feature by feature. Five phases:
  Bootstrap (git init + project scaffold from templates) → Scope-Interview
  (set the initial project scope CLEARLY and unambiguously — the most important
  step) → Roadmap (calls the a1-roadmap skill internally to turn scope into
  milestones + .a1/ scaffold) → Feature-Split (decompose scope/milestones into a
  prioritized feature backlog in .a1/features-backlog.md + Vault projects/<slug>/)
  → Feature-Loop (run every feature through a1-new-feature, with a checkpoint +
  context reset between features so the loop is resumable from file state).
  MUST trigger when the user says: "new project from scratch" (alias: "neues
  projekt von null"), "initialize a project" (alias: "projekt initialisieren"),
  "set up an initial project" (alias: "initiales projekt aufsetzen"),
  "a1-new-project", "bootstrap project", "create the project base structure"
  (alias: "projekt-grundstruktur anlegen"), "from scope to features" (alias:
  "vom scope bis zu den features"), "scaffold a project and split into features"
  (alias: "projekt scaffolden und in features splitten"), "set up a new project
  and split it into features", "start a new project from nothing", or any request
  to take an empty idea/folder and turn it into a scaffolded project with a
  worked-through feature backlog. This skill is a thin
  orchestrator: it calls a1-roadmap (Phase 3), a1-new-feature (Phase 5), and
  optionally a1-constitution (Phase 1) and checkpoint (Phase 5). It does NOT
  replace them.
  Do NOT activate for: phase/milestone planning of a project that ALREADY exists
  and is already bootstrapped (use a1-roadmap — note a1-roadmap is called BY this
  skill, so do not strip a1-roadmap's own triggers); a single feature in an
  existing project (use a1-new-feature); project status (use a1-progress); a bug
  (use a1-fix); codebase analysis (use a1-analyze); constitution-only work
  without bootstrap (use a1-constitution).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# a1-new-project — Zero-to-Backlog Bootstrap

Language: English-first; German trigger aliases supported.

Thin orchestrator. Phase logic lives in `workflows/`. This skill stitches
together existing skills — `a1-roadmap`, `a1-new-feature`, `a1-constitution`,
`checkpoint` — and adds the glue that turns an empty folder into a worked
feature backlog.

## When to use

Activate when the user wants to take a **brand-new project from nothing**:
create the repo and scaffold, set a clear scope, plan a roadmap, decompose it
into features, and then work each feature to verification. If the project is
already bootstrapped and just needs another milestone, use `a1-roadmap`
directly. If it needs one more feature, use `a1-new-feature` directly.

## Phases

| # | Phase | Workflow | Calls | Output |
|---|---|---|---|---|
| 1 | Bootstrap | `workflows/01-bootstrap.md` | (optional) a1-constitution | git repo + CLAUDE.md + .claude/ + .a1/ |
| 2 | Scope-Interview | `workflows/02-scope.md` | AskUserQuestion | `.a1/scope.md` + Vault scope |
| 3 | Roadmap | `workflows/03-roadmap.md` | **a1-roadmap** | `docs/product/ROADMAP.md` (schema v1) + `.a1/` phase scaffold |
| 4 | Feature-Split | `workflows/04-feature-split.md` | — (orchestrator) | `.a1/features-backlog.md` + Vault project hub |
| 5 | Feature-Loop | `workflows/05-feature-loop.md` | **a1-new-feature** + **checkpoint** | features implemented one by one |

> **Phase 2 (Scope-Interview) is the critical step.** Do not decompose anything
> before the scope is set and confirmed. An unclear scope poisons every later
> phase. Spend one or two extra clarification rounds rather than guess.

> **Phase 5 (Feature-Loop)** runs a checkpoint after EVERY feature to save state
> across all memory layers AND free the context window. The loop is resumable:
> all progress lives in `.a1/features-backlog.md` (per-feature status), never in
> the context window. After a context reset, re-entry reads the backlog and
> picks the next `pending` feature.

## Routing — pick the right phase on (re-)entry

State is inferred from files on disk, in this order:

1. No git repo / no `CLAUDE.md` in the target dir → **Phase 1 (Bootstrap)**.
2. Bootstrapped but no `.a1/scope.md` → **Phase 2 (Scope-Interview)**.
3. Scope exists but no `docs/product/ROADMAP.md` (nor legacy `.a1/roadmap.md`) → **Phase 3 (Roadmap)**.
4. Roadmap exists but no `.a1/features-backlog.md` → **Phase 4 (Feature-Split)**.
5. Backlog exists with at least one `pending`/`in-progress` feature →
   **Phase 5 (Feature-Loop)** — resume on the next non-`done` feature.
6. Backlog exists and every feature is `done` → project bootstrap complete;
   write the final Retro and hand off.

This file-based routing is what makes the skill safe to re-enter after a
`checkpoint` clears the context window mid-loop.

## Storage

```
<project-root>/
├── CLAUDE.md                  ← from template (Phase 1)
├── .claudeignore              ← stack-matched (Phase 1)
├── .claude/
│   └── agent-memory/MEMORY.md ← "# Memory\n" (Phase 1)
├── docs/product/
│   ├── ROADMAP.md              ← schema v1, via a1-roadmap CLI scaffold (Phase 3)
│   ├── NEXT.md                 ← generated
│   └── index.json              ← generated
└── .a1/
    ├── scope.md               ← confirmed scope (Phase 2)
    ├── features-backlog.md    ← prioritized backlog + per-feature status (Phase 4/5)
    └── phases/                ← phase dirs from a1-roadmap (machine execution state)
```

Phase 3 (Roadmap) delegates to `a1-roadmap`, which scaffolds the full
`docs/product/` structure at this point (FR-017) — all milestones and
features named upfront via `node _shared/a1-tools.cjs product init` (see
`a1-roadmap` workflows/04-scaffold.md). This skill never hand-writes
`docs/product/` files itself; it only calls `a1-roadmap`.

**On-touch migration (FR-017):** does not apply to this skill directly —
`a1-new-project` only ever bootstraps brand-new projects, so Phase 3 always
scaffolds `docs/product/` fresh (never migrates an existing legacy
`.a1/roadmap.md`). The on-touch, never-big-bang migration rule lives in
`a1-roadmap`/`a1-new-feature`/`a1-execute`, which are the skills that can
actually encounter an existing legacy-only project mid-run.

Vault mirror (single source of truth for cross-project memory):
- Project hub: `projects/<slug>/` (created in Phase 4)
- Specs/plans per feature: written by `a1-new-feature` in Phase 5
- Learnings: `<learning-store>/pattern/a1-learnings/a1-new-project.md`

Learning store defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` to use an external vault (e.g. Obsidian).

## Hard rules

- **Never overwrite existing files during Bootstrap.** Only add what is missing.
  If the dir is already a git repo or already has `CLAUDE.md`, detect and skip
  that sub-step respectfully — do not abort the whole run.
- **Never create a GitHub remote or push automatically.** `git init` is local
  only. `gh repo create` / first push happen ONLY after explicit user
  confirmation (outward-facing action — always confirm).
- **Never proceed past Phase 2 until the user confirms the scope.** This is the
  one phase where extra clarification is cheap and being wrong is expensive.
- **Never hand-write `docs/product/` artifacts.** Phase 3 delegates to
  `a1-roadmap`, which writes `ROADMAP.md`/`NEXT.md`/`index.json` exclusively
  via `a1-tools product ...` (FR-013). This skill never edits those files
  directly.
- **Never skip the checkpoint *save* between features in Phase 5.** Running
  `checkpoint` (which persists state across all memory layers) is mandatory —
  it is what makes the loop resumable. The subsequent `/clear` is user-driven
  and optional: on a healthy context the user may continue in-session; on a
  heavy context they `/clear` and re-trigger the skill, which resumes from
  `.a1/features-backlog.md`. The save is required, the clear is a choice.
- **Never hold loop progress in context only.** Feature status lives in
  `.a1/features-backlog.md`. On re-entry, trust the file, not memory.
- **Never split features too coarse or too fine.** One feature ≈ one
  `a1-new-feature` run ≈ one shippable user-visible capability. Confirm the
  split with the user before starting the loop.
- User-facing output language: see `_shared/language-policy.md` (artifacts English,
  conversation in the user's language).
- One question per turn during the Scope-Interview (use `AskUserQuestion` for
  the structured decisions). No wall-of-text.

## Hand-offs (out of scope for this skill)

- Per-feature implementation detail: owned by `a1-new-feature`.
- Adding a milestone to an already-bootstrapped project: `a1-roadmap` directly.
- Bug fixes: `a1-fix`. Status: `a1-progress`. Analysis: `a1-analyze`.
- Production deployment: Dirk / Dennis after features are verified.
