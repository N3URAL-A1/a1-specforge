# Phase 02 — Reverse-Spec

Goal: extract observed behavior from the codebase and formulate it as a
behavioral specification (user stories, flows, data model, external interfaces,
open questions). Output: `reverse_spec` section in the master file,
status `spec-drafted`.

**Stop-gate G1 after this phase.** Robert must approve the spec before Phase 3.

## Step 1 — Spawn Marco (structure map)

Spawn `a1-marco-mapper` with:

```
Project path: <analyzed_path>
Focus: arch + tech
Output path: <master-file-dir>/MAP.md
Task context: Input for reverse-spec extraction. Map routes, models, screens,
  data access layer. We need a navigation guide for Rafael.
```

## Step 2 — Spawn Rafael (behavior extraction) — after Marco completes

Spawn `a1-rafael-reverse-spec` with:

```
Project path: <analyzed_path>
Marco's MAP.md: <master-file-dir>/MAP.md
Output path: <master-file-dir>/reverse-spec.md
Focus scope: <mode focus from Phase 1>
Wave brief: Extract all observable behavior — routes, screens, models,
  external interfaces. Flag unclear intent as open_question. Do not guess.
```

## Step 3 — Update status

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" spec-drafted \
  --phase-data '{"reverse_spec_path": "<master-file-dir>/reverse-spec.md", "open_question_count": <N>}'
```

## Step 4 — Gate G1: present spec to Robert

Show a structured summary (not the raw file):

```
Reverse-Spec complete for <project-slug>.

FRs extracted: <N>
Open questions: <M>

Top open questions:
1. OQ-001: <what is unclear> (Impact: high) — in <file:line>
2. ...

Want to read the full spec?
→ `projects/<slug>/modernize/<date>/reverse-spec.md`

Approval for Phase 3 (Gap Analysis)?
```

**Do not proceed to Phase 3 without an explicit "yes" / "approve" / "continue" (or "ja" / "freigabe" / "weiter").**

If Robert requests changes to the spec: spawn Rafael again with correction notes.
Update the file, show the changed sections, ask for re-approval.

## Step 5 — Route by mode

Phase 2 is identical for both modes. After G1 approval:

- `full` mode → proceed to `03-gap-analysis.md`.
- `spec-only` mode → also proceed to `03-gap-analysis.md`. Spec-only does not
  end here: it ends after Phase 3 (Gap-Analysis), whose `gap-analyzed` status
  is the terminal state for spec-only runs.
