---
name: a1-checklist
description: >
  Use PROACTIVELY as the pre-flight readiness gate before ANY feature
  implementation starts. Runs 8 deterministic structural checks on a feature's
  wave-plan: spec status is `clarified`, wave-plan exists, every wave has a
  Suggested agent line, dependencies form a DAG (no cycles), every wave
  references advanced stories, project CLAUDE.md is present, plans/ directory
  convention is honored, and plan frontmatter has all required fields. Severity
  maps to BLOCKER (stops the gate), MAJOR (warns), MINOR (info). MUST trigger
  on: "checklist for <feature>" (alias: "checkliste für <feature>"),
  "pre-flight check", "is the plan implementation-ready" (alias: "ist der plan
  implementierungs-bereit"), "ready for implementation" (alias: "ready für
  implementation"), "plan check", "can I start implementation now" (alias: "kann
  ich jetzt mit der umsetzung starten"), "check wave-plan completeness" (alias:
  "prüf die wave-plan-vollständigkeit"), "checklist run <slug>", "a1-checklist",
  or any request to verify whether a wave-plan is ready to be handed to executing
  agents. Distinct from a1-check
  (which is narrow FR-coverage between spec and plan) — this is the broader
  readiness gate covering structure, metadata, and project hygiene. Exit
  semantics: 0=PASS or PASS_WITH_WARNINGS, 1=FAIL (BLOCKER), 2=ERROR (setup).
  Do NOT activate for: FR-coverage checks (→ a1-check), semantic spec review
  (→ a1-rene-requirement-engineer), generic project audits (→ a1-analyze), or
  post-implementation quality checks (→ a1-tobi-tester).
allowed-tools:
  - Bash
  - Read
---

# a1-checklist — Pre-Flight Readiness Gate

Language: English-first; German trigger aliases supported.

Thin Markdown wrapper around the deterministic CLI gate. All logic lives in
`<repo>/_shared/a1-tools.cjs checklist run`. The workflow file
translates the structured result into German user-facing guidance.

## When to use

Activate when the user wants to know whether a feature's wave-plan is
implementation-ready. The check runs across:

1. The feature's spec (`projects/<slug>/spec/<###>-<feature-slug>.md`)
2. The feature's wave-plan (`projects/<slug>/plans/<###>-<feature-slug>-wave-plan.md`)
3. The project root metadata (`projects/<slug>/CLAUDE.md`, `plans/` layout)

## When NOT to use

- FR-coverage between spec and plan → `a1-check`
- Semantic review of a spec's content → `a1-rene-requirement-engineer`
- Cross-cutting project audit → `a1-analyze`
- After implementation, retrospective quality check → `a1-tobi-tester`

## Hand-off

- **PASS** → user proceeds to implementation
- **PASS_WITH_WARNINGS** → user can proceed but warnings are listed for awareness
- **FAIL (BLOCKER)** → workflow suggests fix-paths (re-clarify spec, re-plan,
  or fix the dep cycle), then stops
- **ERROR** → workflow asks user to fix setup (missing files / bad frontmatter)

## Hard rules

- This skill is read-only. It never edits spec, plan, or CLAUDE.md files.
- The skill never gates on semantic content — only structural and metadata
  invariants. Story-level review belongs to humans (or Rene).
- All check logic is in `_shared/a1-tools.cjs checklist run` — keep this skill
  thin. If you find yourself reimplementing a check here, move it to the CLI.

## Workflows

- `workflows/01-run.md` — Run the checklist and interpret the result.
