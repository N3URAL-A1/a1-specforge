---
name: a1-analyze
description: >
  End-to-end pipeline for deeply analyzing an existing project or codebase and
  producing a structured Markdown report. Five phases: Scope → Discover →
  Analyze → Synthesize → Report. State lives in the analysis file's YAML
  frontmatter and progresses through: scoped → discovered → analyzed →
  synthesized → reported. Reports are stored in the Obsidian Vault under
  projects/<slug>/analyses/<YYYY-MM-DD>-<focus>[-N].md. Supports focus modes:
  general, security, architecture, quality, onboarding. MUST trigger when the
  user says: "Analysiere <projekt>", "Analyze <projekt>", "Projekt-Audit",
  "Codebase-Überblick", "Security-Analyse", "Architektur-Analyse",
  "Quality-Check für <projekt>", "Tech-Stack scannen", "Onboarding-Doku für
  <projekt>", "a1-analyze", "Pre-Refactor-Audit", or any request to assess,
  audit, map, or survey an existing project without changing its code. This
  skill orchestrates sub-agents (Reinhard for security/quality, Alex for
  architecture, codebase-mapper for structure, Walter/Aik for stack-specific
  depth, optionally Ludwig for legal/compliance); it does NOT replace them and
  it does NOT modify project code. Do not activate for: bug reports (use
  a1-fix for "Bug in <projekt>", "crash", "Fehler", "broken"), new feature work
  (use a1-new-feature for "neues Feature", "spec", "Anforderung"), code review
  of an open PR (use Reinhard directly), or spec-vs-implementation drift checks
  (planned as a1-check, separate skill).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# a1-analyze — Project Analysis Pipeline (Scope → Report)

This skill is a thin orchestrator. The phase logic lives in `workflows/`. The
shared CLI helper (`~/.claude/skills/_shared/a1-tools.cjs`) handles deterministic
file ops (slot calculation, frontmatter updates, tech-stack discovery, findings
append, listing). Sub-agents do the actual thinking in Phase 3.

## When to use

Activate when the user wants to understand, audit, or map an existing project
*without modifying its code*. Typical use cases: pre-refactor audit, security
review before launch, onboarding documentation for a new team member, architectural
overview before scaling decisions.

If the user reports a bug, use `a1-fix`. If they want to add functionality, use
`a1-new-feature`. If they want a focused PR code review, use Reinhard directly.

## Phases

| # | Phase | Workflow | Status after |
|---|---|---|---|
| 1 | Scope | `workflows/01-scope.md` | `scoped` |
| 2 | Discover | `workflows/02-discover.md` | `discovered` |
| 3 | Analyze | `workflows/03-analyze.md` | `analyzed` |
| 4 | Synthesize | `workflows/04-synthesize.md` | `synthesized` |
| 5 | Report | `workflows/05-report.md` | `reported` |

Terminal non-completion status: `cancelled`. Cancelled analyses keep their slot.

## Focus modes

The skill operates in one of five focus modes, set in Phase 1:

| Focus | Primary sub-agents (Phase 3) | What gets analyzed |
|---|---|---|
| `general` | codebase-mapper + Reinhard | Tech stack, structure, top quality concerns |
| `security` | Reinhard + optional Ludwig | Auth, secrets, RLS, dependencies, compliance |
| `architecture` | Alex | System design, module boundaries, coupling, ADRs gap |
| `quality` | Reinhard + codebase-mapper | Code quality, complexity, test coverage, dead code |
| `onboarding` | codebase-mapper + Alex + Walter/Aik | "How does this project work" doc for newcomers |

## Routing — pick the right phase

1. If the user provides an analysis path: read frontmatter `status`.
2. If no analysis exists yet: start Phase 1 (Scope) — clarify project slug and
   focus, then create the analysis file via `a1-tools analyze init`.
3. Otherwise route by status:
   - `scoped` → Phase 2 (Discover)
   - `discovered` → Phase 3 (Analyze)
   - `analyzed` → Phase 4 (Synthesize)
   - `synthesized` → Phase 5 (Report)
   - `reported` → done; offer to start a new analysis or surface `suggested_next`
   - `cancelled` → no work; confirm and stop

## State mechanics

State is persisted in the analysis file's YAML frontmatter. Update it via the
shared CLI helper, never with raw string-replace on the file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze update-status \
  "projects/<slug>/analyses/<YYYY-MM-DD>-<focus>.md" <new-status> \
  [--phase-data '<json>']
```

The helper performs an atomic frontmatter rewrite (read → modify → write-temp →
rename) and appends a `phase_history` entry with completion timestamp.

Findings are appended one at a time via:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze add-finding \
  "<analysis-path>" <BLOCKER|MAJOR|MINOR> <category> <location> <description> \
  [--recommendation "<text>"]
```

## Storage

All artifacts live in the Obsidian Vault:

- Analyses: `projects/<slug>/analyses/<YYYY-MM-DD>-<focus>[-N].md`

Suffixes `-2`, `-3` are appended for second, third, ... analyses of the same
focus on the same day. The helper `analyze next-slot` returns the next free slot.

Default vault root: `~/Documents/Obsidian Vault/` (note the space).
Override via env var `A1_VAULT_ROOT` if testing.

## Agent integration

| Phase | Agent(s) | Source |
|---|---|---|
| 1 Scope | — (the skill itself) | — |
| 2 Discover | — (CLI helper only) | `_shared/a1-tools.cjs analyze discover` |
| 3 Analyze | Reinhard, Alex, Ludwig, Walter, Aik, codebase-mapper | `~/.claude/agents/*.md` (see `agents/*-link.md`) |
| 4 Synthesize | — (the skill itself) | — |
| 5 Report | — (the skill itself) | — |

Sub-agents are spawned via the `Task` tool with a focused brief constructed
from `templates/agent-brief-template.md`. They receive Project Context (Discover
output), Focus, Output-Contract, and Out-of-Scope. They MUST return findings in
the contract schema; the skill rejects anything else and re-asks once.

Sub-agents in this skill are **read-only**. They never modify project files. If
a sub-agent suggests a change, it goes into `recommendation` of a finding, not
into code.

## Hard rules

- Never edit the analysis frontmatter directly with Edit/Write — always use
  `a1-tools analyze ...`.
- Phase 2 (Discover) runs **without** sub-agents. Tech-stack detection, LOC,
  Git stats are deterministic via CLI.
- Sub-agents in Phase 3 must follow the Output-Contract:
  `{severity: BLOCKER|MAJOR|MINOR, category, location, description, recommendation}`.
  Free-prose answers are rejected and re-requested once.
- Phase 3 dispatches sub-agents in parallel when independent (multi-tool-call
  with several `Task` invocations in one turn).
- Auto-dispatch in Phase 3 is allowed because sub-agents are read-only. No user
  approval needed before each dispatch.
- The skill NEVER writes into `projects/<slug>/fixes/` or `projects/<slug>/features/`.
- The skill NEVER auto-activates `a1-fix` or `a1-new-feature`. It proposes;
  the user decides.
- User-facing prompts and questions are in **English**. All file content
  (frontmatter, findings, code refs) stays in English.
- One question per turn in Phase 1 (Scope). Max 2 clarifying questions.
- Sub-agents are referenced via `agents/<name>-link.md`, never redefined here.
- Analyses in `cancelled` status keep their date+focus+suffix slot; it is not
  recycled.

## Hand-offs (out of scope for this skill)

- New features arising from findings: `a1-new-feature` skill (proposed in
  `suggested_next:`, user activates manually).
- Bug fixes for BLOCKER findings: `a1-fix` skill (proposed in `suggested_next:`,
  user activates manually).
- Legal/DSGVO compliance deep-dive: Ludwig directly.
- Architecture deep-session for systemic drift: Alex directly, or future
  `a1-reconcile` skill (M3 roadmap).
- Final launch-readiness audit: Tobi.
- PR code review: Reinhard directly.

## Versions

- v1 (2026-05-12): initial build. 6 CLI subcommands, 5 phases, 5 focus modes.
