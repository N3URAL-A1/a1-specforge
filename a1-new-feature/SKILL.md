---
name: a1-new-feature
description: >
  End-to-end pipeline for taking a new feature idea from raw concept to verified implementation.
  Seven phases: Discover → Specify → Clarify → Plan → Consistency Gate → Implement → Verify. State lives in the spec
  file's YAML frontmatter and progresses through: discovering → draft → clarified → planned →
  implementing → done (or cancelled). Specs are stored in the Obsidian Vault under
  projects/<slug>/spec/<###>-<feature-slug>.md, wave plans under projects/<slug>/plans/.
  MUST trigger when the user says: "neues Feature für <projekt>", "spec für <projekt>",
  "new feature for <project>", "feature pipeline", "a1-new-feature", "neues Feature anlegen",
  "Feature von Idee bis Verify", or any request to start a feature from scratch and walk it
  through requirements, planning, implementation, and verification. This skill orchestrates
  sub-agents (Rene for phases 1–3, Vincente for phase 4, code agents for phase 5); it does NOT
  replace them. Do not activate for: pure spec writing on an existing feature (use Rene
  directly), bug fixes (use a1-fix), or wave planning of an already-specified
  feature (use Vincente directly).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-new-feature — Feature Pipeline (Discover → Verify)

This skill is a thin orchestrator. The phase logic lives in `workflows/`. The shared CLI
helper (`~/.claude/skills/_shared/a1-tools.cjs`) handles deterministic file ops (sequence
numbers, status updates, listing) under the `spec` subcommand group. Sub-agents do the
actual thinking.

## When to use

Activate when the user wants to take a new feature **from idea to verified implementation**,
not just write a spec or plan a wave. If the feature is already specified or already planned,
delegate directly to the relevant agent (Rene / Vincente / code agents) and skip this skill.

## Phases

| # | Phase | Workflow | Model | Status after |
|---|---|---|---|---|
| 1 | Discover | `workflows/01-discover.md` | Sonnet | discovering |
| 2 | Specify | `workflows/02-specify.md` | Sonnet | draft |
| 3 | Clarify | `workflows/03-clarify.md` | **Opus 4.7** | clarified |
| 4 | Plan | `workflows/04-plan.md` | **Opus 4.7** | planned |
| 4.5 | Consistency Gate | `workflows/04.5-consistency-gate.md` | Sonnet (CLI only) | planned (PASS) / awaiting-consistency-fix (FAIL) |
| 5 | Implement | `workflows/05-implement.md` | Sonnet | implementing → done |
| 6 | Verify + Retro | `workflows/06-verify.md` | Sonnet | done (or implementing if failures) |

> **Consistency Gate (Phase 4.5)** is a deterministic CLI gate (no LLM) that
> verifies the wave-plan structurally covers the spec (bijective FR coverage,
> frontmatter link, no phantom FRs). It is a **hard gate**: Phase 5 does not
> start on FAIL. On FAIL the spec status moves to `awaiting-consistency-fix`
> and re-invocation routes back to Phase 4.5 automatically.

> **Clarify (Phase 3)** runs with **Opus 4.7** and includes a **10-category proactive scope scan**
> (covering navigation context, duplicate submit, permissions, empty states, and more) plus
> — for frontend features — **UX Mockups from Uwe**: at least 2–3 variants per screen,
> based on the project-specific design-system skill, for user approval before the
> wave plan is built.

> **Plan (Phase 4)** runs with **Opus 4.7** for deeper wave-dependency analysis.

A spec abandoned at any phase is moved to status `cancelled`; its sequence number is **not**
recycled.

## Isolation Gate (HARD RULE — before Phase 5 Implement)

No feature code is written in the primary checkout. Before the first wave of
Phase 5, the feature MUST be moved into its own git worktree on a fresh branch off
`main`. This prevents the parallel-session corruption class: two sessions editing
the same working tree overwrite each other's files and push half-finished work
(e.g. a referenced type that was never committed) to `main`, leaving it build-red.

1. **Create the worktree** (delegate to the `a1-worktree` skill, or inline):
   ```bash
   git -C <repo> fetch origin main
   git -C <repo> worktree add ../a1-worktrees/<feature-slug> -b feature/<feature-slug> origin/main
   ```
   Every wave's edits, builds, and tests happen inside that worktree path.
2. **Implement wave by wave** there. After each wave, build + tests must be GREEN
   in the worktree before the next wave.
3. **Merge + push** only after the final wave is GREEN (typically after Phase 6
   Verify passes):
   ```bash
   git -C <repo> checkout main && git -C <repo> pull --ff-only origin main
   git -C <repo> merge --no-ff feature/<feature-slug> && git -C <repo> push origin main
   ```
   If `git pull` brings in a `main` that no longer builds for reasons unrelated to
   this feature: STOP, do NOT layer on top, report to Robert.
4. **Tear down** the worktree (`a1-worktree` exit, or `git worktree remove`).

**Never** cherry-pick commits onto a fresh main branch as a merge workaround.
**Never** push a build-red `main`. **Never** edit the primary checkout mid-feature
while another session may hold it.

## Routing — pick the right phase

1. Read the spec frontmatter `status` field if a spec path is given.
2. If no spec exists yet for the feature: start at Phase 1 (Discover) — call the helper to get
   the next sequence number, create the spec file from the template with status `discovering`.
3. Otherwise route by status:
   - `discovering` → Phase 1 (continue interview) or Phase 2 (if Discover complete)
   - `draft` → Phase 3 (Clarify) when `[NEEDS CLARIFICATION]` markers exist, otherwise Phase 4
   - `clarified` → Phase 4 (Plan)
   - `planned` → **Phase 4.5 (Consistency Gate)** — must PASS before Phase 5
   - `awaiting-consistency-fix` → Phase 4.5 (re-run gate after user fix), or the
     phase the user chose for the fix path (Phase 3 / Phase 4 / targeted edit)
   - `implementing` → Phase 5 (next wave) or Phase 6 (Verify) when waves complete
   - `done` → no work; ask user if they want a re-verify or a new feature
   - `cancelled` → no work; confirm and stop

## State mechanics

State is persisted in the spec frontmatter. Update it via the CLI helper, never with raw
string-replace on the file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  "projects/<slug>/spec/<###>-<feature-slug>.md" <new-status>
```

The helper performs an atomic frontmatter rewrite (read → modify → write-temp → rename) and
appends a `phase_history` entry with the completion timestamp.

## Storage

All artifacts live in the Obsidian Vault:

- Specs: `projects/<slug>/spec/<###>-<feature-slug>.md`
- Wave plans: `projects/<slug>/plans/<###>-<feature-slug>-wave-plan.md`

The `<###>` sequence is per-project, zero-padded to 3 digits, monotonically increasing.
Cancelled specs keep their number; the helper picks the next unused number via glob.

Default vault root: `~/N3URAL-Vault/`.
Override via env var `A1_VAULT_ROOT` if testing.

## Agent integration

| Phase | Agent | Source |
|---|---|---|
| 1–3 | Rene | `~/.claude/agents/a1-rene-requirement-engineer.md` (see `agents/rene-link.md`) |
| 3 (UX) | **Uwe** — frontend features only | global `a1-uwe-ux-expert`; uses project design-system skill (see below) |
| 4 | Vincente | global `a1-vincente-vibe-optimizer` |
| 5 | Code agents | Agent pool: read from target project's CLAUDE.md → Agent Workflow table. Fallbacks: Walter, Bernd, Aik, Felix, Alex. **User confirms** per wave brief. |
| 6 | The skill itself (and Tobi, optional) | — |

### Design-System Skill per Project

| Project | Skill |
|---|---|
| Projects using n3ural design system | `n3urala1-design` (`~/.claude/skills/n3urala1-design`) |
| Other projects | Check project CLAUDE.md for design system skill reference; fallback: `frontend-design` |

The skill **proposes** code agents in Phase 5 based on the wave-plan brief; the user dispatches.

## Hard rules

- **Never write feature code outside an isolated worktree on a feature branch.**
  The Isolation Gate runs before Phase 5. Merge to `main` only when build + tests
  are GREEN. Never cherry-pick as a merge workaround. Never push a build-red `main`.
- Never edit the spec frontmatter directly with Edit/Write — always use `a1-tools spec update-status`.
- Never skip a phase. If a feature seems trivial enough to skip Discover/Clarify, do them
  anyway — they take seconds and prevent rework.
- Never recycle sequence numbers. Cancelled specs keep their slot.
- Never modify a spec while it is in `implementing` without surfacing the change to the user
  first; spec drift mid-implementation breaks Phase 6 verify.
- All file artifacts (spec frontmatter, FR/SC IDs, wave plans, verification notes) stay in
  English. User-facing communication follows the project's language convention.
- One question per turn during Discover and Clarify. No wall-of-text interviews.

## Hand-offs (out of scope for this skill)

- Bug fixes: `a1-fix` skill.
- Cross-feature roadmap planning: Frank or Vincente directly.
- Production deployment: Dirk / Dennis after Phase 6 done.
