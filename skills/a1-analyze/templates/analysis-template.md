# Reference: Analysis File Structure

**Do not render this file as-is.** The file is created on disk by
`a1-tools analyze init` with the proper frontmatter and a sectioned body. This
reference documents the expected shape so workflows can verify it.

## Expected frontmatter (created by `analyze init`)

```yaml
---
type: project-analysis
project: <slug>
focus: <general|security|architecture|quality|onboarding>
title: <one-line title>
status: scoped
created_at: <ISO timestamp>
analyzed_path: <absolute path>
phase_history:
  - phase=scope completed=<ISO>
discover: []
agents_dispatched: []
findings: []
findings_count:
  - blocker=0
  - major=0
  - minor=0
suggested_next: []
tags:
  - analysis
  - project/<slug>
  - focus/<focus>
---
```

Note: `discover`, `agents_dispatched`, `findings`, `suggested_next` are stored as
string lists with `key=value; key=value` entries because the shared frontmatter
parser does not support nested objects. The CLI helper handles encoding/decoding.

## Expected body sections (created by `analyze init`)

```
# Analysis: <title>

## Scope
- Project: <slug>
- Focus: <focus>
- Analyzed path: <path>

## Discover (Phase 2 — filled by CLI)

## Findings (Phase 3 — appended by sub-agents)

## Synthesis (Phase 4 — LLM)

## Recommendations (Phase 5 — LLM)

## Notes
```

## Section ownership

| Section | Filled by | Phase |
|---|---|---|
| Scope | analyze init | 1 |
| Discover | workflow 02 (Edit after analyze discover) | 2 |
| Findings | sub-agents in Phase 3, post-processing summarizes frontmatter list | 3 |
| Synthesis | workflow 04 (LLM-written) | 4 |
| Recommendations | workflow 05 (LLM-written) | 5 |

## Reserved fields in discover entries

- tech_stack (comma-separated list)
- loc
- file_count
- last_commit (ISO date)
- branch
- commit_count_30d

## Reserved fields in agents_dispatched entries

- name=<agent-name>
- focus=<sub-focus>
- completed_at=<ISO>

## Reserved fields in findings entries

- id=F-NNN (auto-incremented)
- severity=BLOCKER|MAJOR|MINOR
- category=<short label>
- location=<file:line or module>
- description=<text, no semicolons/newlines>
- recommendation=<optional text>

## Reserved fields in suggested_next entries

- skill=<a1-fix|a1-new-feature|...>
- reason=<text>
- target_findings=<F-001,F-002,...>
