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
node ~/.claude/skills/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" spec-drafted \
  --phase-data '{"reverse_spec_path": "<master-file-dir>/reverse-spec.md", "open_question_count": <N>}'
```

## Step 4 — Gate G1: present spec to Robert

Show a structured summary (not the raw file):

```
Reverse-Spec fertig für <project-slug>.

FRs extrahiert: <N>
Offene Fragen: <M>

Top offene Fragen:
1. OQ-001: <what is unclear> (Impact: high) — in <file:line>
2. ...

Magst du die vollständige Spec lesen?
→ `projects/<slug>/modernize/<date>/reverse-spec.md`

Freigabe für Phase 3 (Gap-Analyse)?
```

**Do not proceed to Phase 3 without explicit "ja" / "freigabe" / "weiter".**

If Robert requests changes to the spec: spawn Rafael again with correction notes.
Update the file, show the changed sections, ask for re-approval.

## Step 5 — If spec-only mode

After G1 approval, if mode is `spec-only`:
- Update status to `gap-analyzed` (spec-only end state)

Wait — spec-only ends at gap-analyzed, but we haven't done gap analysis yet. For spec-only, we stop at spec-drafted and mark it as the final state. Let me reconsider.

Actually: `spec-only` mode ends after Phase 3 (Gap-Analysis). Phase 2 is the same for both modes. After G1 approval:
- `full` mode → proceed to `03-gap-analysis.md`
- `spec-only` mode → proceed to `03-gap-analysis.md` (same — spec-only just stops after Phase 3)
