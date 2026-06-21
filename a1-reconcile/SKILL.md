---
name: a1-reconcile
description: >
  Spec-vs-implementation drift detection — checks whether what a spec promised
  actually exists in the code. Produces a drift report classifying findings as
  MISSING (spec asks, code lacks), EXTRA (code has, spec silent), DIVERGED
  (signatures/paths differ), or STALE (spec updated after last code touch).
  Four phases: Scope → Parse → Probe → Report. State persisted in the drift
  report's YAML frontmatter (scoped → parsed → probed → reported). Reports
  stored in Obsidian Vault at projects/<slug>/drift-<YYYY-MM-DD>[-N].md. Three
  modes: single (one spec), project (all specs), vault-sync (weekly cron).
  MUST trigger when the user says: "drift check", "spec vs implementation",
  "spec vs code", "reconcile <projekt>", "a1-reconcile", "is the code still
  in sync with the spec", "spec-drift", "passt der code noch zur spec",
  "implementation drift", "what did we ship vs what we specified",
  "pre-release audit", "stimmt spec und code noch überein", "habe ich alles
  gebaut was in der spec steht", or any request to verify spec/code alignment.
  Orchestrates sub-agents (a1-marco-mapper for structural probing, Alex for
  architecture-level DIVERGED); read-only — never modifies project code or
  specs. Do NOT activate for: generic codebase audits without spec anchor
  (use a1-analyze), structural spec↔plan consistency (use a1-check), bug
  reports (use a1-fix), new feature work (use a1-new-feature), or PR review
  (use Reinhard directly).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-reconcile — Spec ↔ Code Drift Detection (Scope → Report)

This skill is a thin orchestrator. The phase logic lives in `workflows/`. The
shared CLI helper (`~/.claude/skills/_shared/a1-tools.cjs reconcile`) handles
deterministic file ops (slot calculation, spec parsing, frontmatter updates,
drift append, listing). Sub-agents do the probing in Phase 3.

## When to use

Activate when the user wants to verify that what a spec promised actually got
built — and is still in the code. Typical cases: pre-release audit ("did we
ship what we specified?"), weekly vault-sync ("which projects have drifted?"),
post-refactor sanity check ("did we accidentally remove anything the spec
still requires?").

If the user wants a generic project audit without spec anchor, use `a1-analyze`.
If they want the structural spec↔plan check (FR coverage, frontmatter link),
use `a1-check`. If they want to fix the drift, hand off to `a1-fix` or
`a1-new-feature` after the report.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 1 | Scope | `workflows/01-scope.md` | `scoped` |
| 2 | Parse | `workflows/02-parse.md` | `parsed` |
| 3 | Probe | `workflows/03-probe.md` | `probed` |
| 4 | Report | `workflows/04-report.md` | `reported` |

Terminal non-completion status: `cancelled`. Cancelled reports keep their slot.

## Trigger modes

| Mode | What gets reconciled | Typical caller |
|---|---|---|
| `single` | One spec (`--spec <###-slug>`) | Dev wants to verify their own feature |
| `project` | All specs of one project | Pre-release audit, before stamping `shipped` |
| `vault-sync` | All specs across all projects in the vault | Weekly cron / vault hygiene |

The mode is set in Phase 1 and recorded in frontmatter (`scope_mode`,
`scope_targets[]`). Probe and Report iterate over `scope_targets`.

## Drift classes

Each finding in the report is classified into exactly one of:

| Class | Definition | Typical hand-off |
|---|---|---|
| `MISSING` | Spec requires an artifact (file/function/endpoint), code does not contain it | `a1-fix` or implementation task |
| `EXTRA` | Code contains an artifact related to the feature but not referenced in the spec | `a1-new-feature` (update spec) or remove code |
| `DIVERGED` | Both exist but signature/path/structure differs from what the spec stated | Manual inspection + targeted edit |
| `STALE` | Spec `status: shipped` and spec `updated` is newer than the last code commit touching the referenced area | Re-verify or re-implement |

## Routing — pick the right phase

1. If the user provides a drift-report path: read frontmatter `status`.
2. If no drift report exists yet: start Phase 1 (Scope) — clarify mode and
   targets, then create the report file via `a1-tools reconcile init`.
3. Otherwise route by status:
   - `scoped` → Phase 2 (Parse)
   - `parsed` → Phase 3 (Probe)
   - `probed` → Phase 4 (Report)
   - `reported` → done; offer to start a new reconcile or hand off
   - `cancelled` → no work; confirm and stop

## State mechanics

State is persisted in the drift-report's YAML frontmatter. Update it via the
shared CLI helper, never with raw string-replace on the file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs reconcile update-status \
  "projects/<slug>/drift-<YYYY-MM-DD>.md" <new-status> \
  [--phase-data '<json>']
```

The helper performs an atomic frontmatter rewrite (read → modify → write-temp
→ rename) and appends a `phase_history` entry with completion timestamp.

Drifts are appended one at a time via:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs reconcile add-drift \
  "<drift-path>" <MISSING|EXTRA|DIVERGED|STALE> "<artifact>" "<description>" \
  [--recommendation "<text>"] [--spec-ref "<FR-###>"] [--code-ref "<path:line>"]
```

## Storage

All artifacts live in the Obsidian Vault:

- Drift reports: `projects/<slug>/drift-<YYYY-MM-DD>[-N].md`

Suffixes `-2`, `-3` are appended for second, third, ... reports on the same
day. The helper `reconcile next-slot` returns the next free slot.

For `vault-sync` mode, a single dated report aggregates all projects:
`projects/_vault-sync/drift-<YYYY-MM-DD>[-N].md` — same suffix logic.

Default vault root: `~/N3URAL-Vault/`. Override
via env var `A1_VAULT_ROOT`.

## Agent integration

| Phase | Agent(s) | Source |
|---|---|---|
| 1 Scope | — (the skill itself) | — |
| 2 Parse | — (CLI helper only) | `_shared/a1-tools.cjs reconcile parse-spec` |
| 3 Probe | a1-marco-mapper, Alex (optional, for architecture-level DIVERGED) | `agents/*-link.md` |
| 4 Report | — (the skill itself) | — |

Sub-agents in Phase 3 receive a probe brief (`templates/agent-probe-brief.md`)
listing every spec-referenced artifact with its expected location. They MUST
return drift findings in JSON, classified into MISSING / EXTRA / DIVERGED /
STALE. Free prose is rejected and re-asked once.

Sub-agents are **read-only**. They never modify project files, never edit the
spec, never touch the drift report. If they want a change, it goes into
`recommendation` of a drift finding.

## Hard rules

- Never edit the drift-report frontmatter directly with Edit/Write — always
  use `a1-tools reconcile ...`.
- Never modify the spec from this skill. The spec is the anchor; reconcile
  reads it.
- Never modify project code from this skill. Drift findings drive hand-offs;
  the actual fix runs through `a1-fix` / `a1-new-feature` after the user decides.
- Phase 2 (Parse) runs **without** sub-agents. Acceptance-Criteria + artifact
  references are extracted deterministically by the CLI.
- Phase 3 (Probe) dispatches sub-agents in parallel when targets are
  independent (multi-tool-call with several `Task` invocations in one turn).
- Sub-agents in Phase 3 must follow the Output-Contract:
  `{class: MISSING|EXTRA|DIVERGED|STALE, artifact, spec_ref, code_ref,
  description, recommendation}`. Free-prose is rejected and re-asked once.
- The skill NEVER auto-activates `a1-fix` or `a1-new-feature`. It proposes in
  `suggested_next:`; the user decides.
- User-facing prompts and questions are in **English**. All file content
  (frontmatter, drift entries, code refs, spec refs) stays in English.
- One question per turn in Phase 1. Max 2 clarifying questions.
- Reports in `cancelled` status keep their date+suffix slot.
- For `vault-sync` mode, the skill is allowed to skip projects that have no
  spec under `projects/<slug>/spec/` — record them in the report's
  `skipped_projects[]` with a reason.

## Hand-offs (out of scope for this skill)

- Implementation gaps surfaced as MISSING → `a1-new-feature` (if scope is
  whole new functionality) or `a1-fix` (if surgical).
- DIVERGED findings → manual inspection by the user, then `a1-fix` for the
  edit. The skill proposes; it does not auto-route.
- EXTRA findings → user decides: update spec via `a1-new-feature` (Phase 3
  Clarify) or remove the code via `a1-fix`.
- STALE findings → re-run `a1-reconcile` against the new spec version, or
  trigger a fresh `a1-analyze` if the drift looks structural.
- Final launch-readiness audit: Tobi.

## Versions

- v1 (2026-05-13): initial build. 6 CLI subcommands, 4 phases, 4 drift classes,
  3 trigger modes.
