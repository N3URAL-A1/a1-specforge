---
name: a1-check
description: >
  DEPRECATED — merged into a1-checklist as check #9 (M12, decision doc 7.1).
  The spec ↔ wave-plan FR-coverage gate (frontmatter link resolves, every spec
  FR-### in exactly one wave, no phantom FRs) now runs as part of
  a1-checklist's 9 pre-flight checks; route "consistency check for <feature>"
  (alias: "konsistenz-check für <feature>"), "check the plan matches the spec"
  (alias: "prüfe ob plan zur spec passt"), "fr-coverage check", "does the plan
  cover the spec" (alias: "deckt der plan die spec ab"), and "a1-check" to
  a1-checklist. This alias remains for one release so existing callers keep
  working: the underlying CLI (`a1-tools check run`, exit 0=PASS / 1=FAIL /
  2=ERROR) is still fully functional and is still called directly by
  a1-new-feature's Phase 4.5 gate. Do NOT use this skill for new routing —
  use a1-checklist.
allowed-tools:
  - Bash
  - Read
---

# a1-check — DEPRECATED (alias for a1-checklist check #9)

**Status: deprecated since M12 (2026-07-12), removal after one release.**

The FR-coverage consistency gate that lived here is now **check #9 of
`a1-checklist`** — same three invariants (frontmatter `spec_path` link,
bijective FR coverage, no phantom FRs), severity BLOCKER, absorbed per
decision doc `.a1/phases/M11-audit-fixes/decisions/check-checklist-merge.md`.

## If this skill was activated

Tell the user a1-check is deprecated, then run the merged gate instead:

```bash
node <repo>/_shared/a1-tools.cjs checklist run <project-slug>/<###-feature-slug> --format json
```

FR-coverage failures appear as check `fr_coverage_bijective` (BLOCKER).
Interpret results per `a1-checklist/workflows/01-run.md`.

## What is NOT deprecated

The **CLI subcommand keeps working unchanged** — `a1-new-feature` Phase 4.5
(`workflows/04.5-consistency-gate.md`) still calls it directly and branches on
its 3-way exit code:

```bash
node <repo>/_shared/a1-tools.cjs check <project-slug> \
  --feature <###-feature-slug> --format json
# exit 0=PASS · 1=FAIL (content inconsistency) · 2=ERROR (setup)
```

Phase 4.5 will switch to the checklist invocation when the deprecation window
ends; until then the exit-code contract here is frozen (decision doc 7.1,
migration step 5).

## Fix-path suggestions (unchanged, used by Phase 4.5)

- FAIL with FRs missing from waves → re-run `a1-new-feature` Phase 4 (Plan).
- FAIL with phantom FRs → re-run Phase 3 (Clarify) to add the FRs, or edit the
  wave-plan to drop them.
- FAIL with frontmatter-link mismatch → targeted edit of the plan's
  `spec_path`.
- ERROR → create the missing file / repair the frontmatter, re-run.

## Workflow

See `workflows/01-run-check.md` (kept for the CLI contract during the alias
period).
