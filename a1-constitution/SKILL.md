---
name: a1-constitution
description: >
  Generate or update a project's constitution.md — the per-project behavioral
  rules artifact that complements CLAUDE.md (which holds facts about the
  project). Enforces the separation: CLAUDE.md = data + context, constitution.md
  = behavior + 4-Layer Override-Precedence (Global Rules < Project CLAUDE.md <
  Agent Frontmatter < Session Instruction). Four phases: Discover → Draft (via
  a1-alex-architekt) → Review → Write. State lives in the vault constitution's
  YAML frontmatter (discovering → drafted → reviewed → written). Vault is the
  single source of truth at projects/<slug>/constitution/constitution.md; the
  repo file at <project-root>/constitution.md is a derived mirror written in
  Phase 4. Old versions are snapshotted under
  projects/<slug>/constitution/history/ before each rewrite. MUST trigger
  when the user says: "constitution für <projekt>", "generate constitution",
  "constitution erzeugen", "verhaltensregeln für <projekt>",
  "override-reihenfolge dokumentieren", "a1-constitution", "update
  constitution", "behavioral rules für das projekt", "carve rules out of
  CLAUDE.md", "wir brauchen feste regeln für dieses projekt", or any request
  to define/update per-project behavioral rules separate from CLAUDE.md. Do
  NOT activate for: editing CLAUDE.md facts (manual or via Alex directly),
  generic project audits (use a1-analyze), bug fixes (use a1-fix), feature
  work (use a1-new-feature), or compliance reviews of an existing
  constitution (manual via Reinhard with constitution link).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-constitution — Per-Project Behavioral Rules (Discover → Write)

This skill is a thin orchestrator. The phase logic lives in `workflows/`. The
shared CLI helper (`~/.claude/skills/_shared/a1-tools.cjs`) handles deterministic
file ops (vault file init, discovery, status updates, body writes, history
snapshots, repo mirror, CLAUDE.md cross-link). Alex (a1-alex-architekt) does
the drafting in Phase 2.

## When to use

Activate when the user wants to create or update a per-project `constitution.md`.
Typical use cases: a new project needs behavioral rules carved out of an
overloaded CLAUDE.md; an existing project's rules drifted and need a refresh;
a global rule changed and projects need updated override snapshots.

If the user wants to edit CLAUDE.md content (facts about the project), do that
manually or via Alex directly. If the user wants to audit whether code complies
with a constitution, that is a manual Reinhard/Tobi review with the
constitution provided as input — not this skill.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 1 | Discover | `workflows/01-discover.md` | `discovering` |
| 2 | Draft | `workflows/02-draft.md` | `drafted` |
| 3 | Review | `workflows/03-review.md` | `reviewed` |
| 4 | Write | `workflows/04-write.md` | `written` |

Terminal non-completion status: `cancelled`. A cancelled constitution keeps
its file in the vault for audit; the next run will refuse `init` until the
user removes or archives it manually.

## Routing — pick the right phase

1. If the user provides a constitution path: read frontmatter `status`.
2. If no vault constitution exists for the project yet (`projects/<slug>/constitution/constitution.md` missing):
   start Phase 1 (Discover) — clarify project slug + repo-root, then init the file.
3. Otherwise route by status:
   - `discovering` → resume Phase 1 (gather missing inputs, re-confirm) → Phase 2
   - `drafted` → Phase 3 (Review)
   - `reviewed` → Phase 4 (Write)
   - `written` → Done; offer to start an update cycle (which archives current
     and re-enters Phase 1) or exit.
   - `cancelled` → confirm and stop; ask the user to clean up manually.

## State mechanics

State is persisted in the vault constitution file's YAML frontmatter. Update
it via the shared CLI helper, never with raw string-replace on the file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
  "projects/<slug>/constitution/constitution.md" <new-status>
```

The helper performs an atomic frontmatter rewrite (read → modify → write-temp
→ rename) and appends a `phase_history` entry with completion timestamp. The
status `written` additionally sets `last_written_at` to the current ISO timestamp.

The body is written in Phase 2 via:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution set-body \
  "<constitution-path>" --body-file "<tmp-file-from-alex>"
```

## Storage

| Artifact | Path |
|---|---|
| Canonical (vault) | `projects/<slug>/constitution/constitution.md` |
| History snapshots | `projects/<slug>/constitution/history/<YYYY-MM-DD>-v<N>.md` |
| Repo mirror | `<repo-root>/constitution.md` |
| Cross-link in CLAUDE.md | Managed block in `<repo-root>/CLAUDE.md` (HTML comment delimiters) |

Single source of truth: the vault file. The repo mirror is derived in Phase 4
and is regenerable at any time via `constitution write-mirror`.

Default vault root: `~/N3URAL-Vault/`.
Override via env var `A1_VAULT_ROOT` if testing.

## Agent integration

| Phase | Agent | Source |
|---|---|---|
| 1 Discover | — (skill itself + CLI) | `_shared/a1-tools.cjs constitution discover` |
| 2 Draft | **Alex (a1-alex-architekt)** | `~/.claude/agents/a1-alex-architekt.md` (see `agents/alex-link.md`) |
| 3 Review | — (skill itself + user) | — |
| 4 Write | — (CLI only) | — |

Alex is spawned via the `Task` tool with a focused brief constructed from
`templates/alex-brief-template.md`. The brief contains: project slug, vault
path, discovery output (CLAUDE.md excerpt, global rules listing, existing repo
file), 3-5 user-provided behavioral concerns from Phase 1 interview, the
constitution-template skeleton, and a strict Output Contract.

Alex's output is the **full constitution body** (Markdown, no YAML frontmatter
— that stays under skill control). The skill writes it via `constitution
set-body` and transitions to `drafted`.

## Hard rules

- Never edit the constitution frontmatter directly with Edit/Write — always use
  `a1-tools constitution ...`.
- Phase 4 is **strictly CLI-driven**: archive → bump version → write-mirror →
  link-claudemd → update-status. No LLM in this phase.
- The vault file is the source of truth. If a user reports "constitution.md in
  the repo is wrong", we re-derive from vault (`write-mirror`), never edit the
  repo file directly.
- The repo CLAUDE.md is touched ONLY via `constitution link-claudemd`, which
  is idempotent (managed HTML-comment block).
- One question per turn in Phase 1 interview. Max 3 user-facing questions.
- User-facing prompts are in **English**. All file content (frontmatter, body,
  references) stays in English.
- Alex is referenced via `agents/alex-link.md`, never redefined here.
- The skill NEVER auto-spawns Reinhard, Tobi, or any other agent after Phase 4.
  Post-write recommendations are surface-level suggestions only.
- A `cancelled` constitution keeps its file slot. The user must manually delete
  or move it to `history/` before a fresh init.

## Hand-offs (soft, no auto-spawn)

After Phase 4, the skill surfaces these recommendations:

- **First-time constitution:** "CLAUDE.md has been updated with a cross-link.
  Repo mirror written. Vault file is the source of truth."
- **Updated constitution:** "History snapshot saved under `history/<date>-v<N>.md`.
  If rules were tightened, Reinhard can manually review recent PRs against the
  new constitution (pass the constitution path explicitly — there is no
  automatic constitution-aware review yet)."
- **Missing CLAUDE.md:** Phase 1 soft-blocks. "CLAUDE.md is missing at
  `<repo-root>/CLAUDE.md`. Please create it first from
  `~/.claude/templates/CLAUDE.md.template`, then restart `a1-constitution`."

## Versions

- v1 (2026-05-13): initial build. 9 CLI subcommands, 4 phases, singleton +
  history layout, vault = source of truth, repo = mirror.
