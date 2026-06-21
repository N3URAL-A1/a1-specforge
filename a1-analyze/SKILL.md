---
name: a1-analyze
description: >
  Use PROACTIVELY whenever the user wants to understand, audit, map, survey, or
  document an existing codebase WITHOUT changing its code. Five-phase pipeline:
  Scope → Discover → Analyze → Synthesize → Report. State in the analysis file
  frontmatter (scoped → discovered → analyzed → synthesized → reported). Output
  is stored in the Obsidian Vault: projects/<slug>/analyses/<YYYY-MM-DD>-<focus>[-N].md.
  Five focus modes: general, security, architecture, quality, onboarding. MUST
  trigger on: "analysiere <projekt>", "analyze <projekt>", "projekt-audit",
  "codebase-überblick", "codebase scan", "security-analyse", "security audit",
  "architektur-analyse", "architecture review", "quality-check für <projekt>",
  "tech-stack scannen", "onboarding-doku für <projekt>", "pre-refactor-audit",
  "wie ist <projekt> aufgebaut", "was läuft in <projekt>", or "a1-analyze".
  Orchestrates read-only sub-agents (a1-reinhard-reviewer, a1-alex-architekt,
  a1-marco-mapper, a1-walter-web-developer, a1-aik-ai-engineer, a1-ludwig-legal)
  in parallel during Phase 3, plus two always-on read-only lanes on every run:
  the code-simplifier agent (report-only) and the security-review skill. Writes a
  mandatory self-learning Retro to the Obsidian Vault after every run (feeds
  a1-evolve). Never modifies project code; findings only.
  Do NOT activate for: bug reports (→ a1-fix), new feature work (→ a1-new-feature),
  PR code review (→ a1-reinhard-reviewer directly), or spec-vs-plan drift
  (→ a1-check for FR-coverage, a1-reconcile for spec-vs-implementation).
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
| `general` | a1-marco-mapper + a1-reinhard-reviewer | Tech stack, structure, top quality concerns |
| `security` | a1-reinhard-reviewer + optional a1-ludwig-legal | Auth, secrets, RLS, dependencies, compliance |
| `architecture` | a1-alex-architekt | System design, module boundaries, coupling, ADRs gap |
| `quality` | a1-reinhard-reviewer + a1-marco-mapper | Code quality, complexity, test coverage, dead code |
| `onboarding` | a1-marco-mapper + a1-alex-architekt + a1-walter-web-developer / a1-aik-ai-engineer | "How does this project work" doc for newcomers |

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
| 3 Analyze | a1-reinhard-reviewer, a1-alex-architekt, a1-ludwig-legal, a1-walter-web-developer, a1-aik-ai-engineer, a1-marco-mapper + **always-on lanes:** `code-simplifier` (read-only), `security-review` skill | `~/.claude/agents/*.md` (see `agents/*-link.md`); `code-simplifier` plugin; built-in `security-review` |
| 4 Synthesize | — (the skill itself) | — |
| 5 Report | — (the skill itself) | — |

Sub-agents are spawned via the Task tool with the `subagent_type` matching the
agent name (e.g. `subagent_type: "a1-reinhard-reviewer"`). The brief is
constructed from `templates/agent-brief-template.md` and provides Project
Context (Discover output), Focus, Output-Contract, and Out-of-Scope. They MUST
return findings in the contract schema; the skill rejects anything else and
re-asks once.

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
  with several Task invocations in one turn, each with the correct
  `subagent_type` of the named a1 agent).
- Phase 3 ALWAYS runs two standing read-only lanes in addition to the
  focus-specific agents, for every focus mode: the `code-simplifier` **agent**
  (parallel Task, report-only) and the `security-review` **skill**
  (in-conversation, serial — a skill cannot be a `subagent_type`). They emit
  findings into the same contract; they never edit code. If a lane's
  agent/command is unavailable, record a Notes entry and continue — never block
  the phase.
- The `code-simplifier` agent keeps its edit tools when dispatched, so its
  read-only promise is enforced **structurally**, not by prompt alone: Phase 3b
  snapshots `git status --porcelain` of the analyzed tree before the lane and
  diffs it after. Any on-disk change is a hard breach → revert, discard findings,
  BLOCKER Notes entry. (If the tree is not a git repo, the tripwire can't run —
  Notes must say the lane was prompt-only guarded.)
- The Retro in Phase 5 (Report) is MANDATORY on every run, writes to the local
  cache + canonical Vault, and offers `a1-evolve` at every 5th entry. See the
  Self-learning loop section for the canonical statement — do not skip it.
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
- Legal/DSGVO compliance deep-dive: a1-ludwig-legal directly.
- Architecture deep-session for systemic drift: a1-alex-architekt directly, or
  `a1-reconcile` skill for spec-vs-implementation drift detection.
- Final launch-readiness audit: a1-tobi-tester.
- PR code review: a1-reinhard-reviewer directly.

## Self-learning loop

Like `a1-fix`, `a1-new-feature`, and `a1-evolve`, a1-analyze feeds the a1
self-learning system so that what an analysis surfaces gets carried into future
implementations:

1. **Retro (Phase 5, mandatory)** — every run appends a structured entry to
   `_learning.md` (cache) and `~/N3URAL-Vault/pattern/a1-learnings/a1-analyze.md`
   (canonical), tagged with `issue_classes` including `simplification_opportunity`
   and `security_vuln` from the two always-on lanes.
2. **Threshold** — at every 5th entry the skill offers `a1-evolve`.
3. **Synthesis** — `a1-evolve` clusters the learnings across all skills and
   proposes concrete improvements (3+ occurrences = proposal).

This is why the Simplify and Security lanes run on *every* analysis: their
findings are the highest-signal input for "what should the next build avoid."

## Versions

- v1 (2026-05-12): initial build. 6 CLI subcommands, 5 phases, 5 focus modes.
- v2 (2026-06-21): two always-on read-only lanes in Phase 3 — `code-simplifier`
  agent (parallel Task, report-only, with a structural git-status tripwire) +
  `security-review` skill (in-conversation, serial), every focus mode;
  self-learning loop hardened (Retro mandatory, canonical Vault path
  `~/N3URAL-Vault/pattern/a1-learnings/`, threshold counts since last synthesis,
  offers a1-evolve). Vault-path migration scope: this change migrates only
  a1-analyze + a1-evolve to the canonical `pattern/` path. The remaining a1 skills
  (a1-plan, a1-execute, a1-fix, …) and the `_shared/a1-tools.cjs` default still use
  the legacy `~/Documents/Obsidian Vault/areas/...` path — a full sweep is tracked
  as separate follow-up to keep this change atomic.
