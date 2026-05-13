# Sub-Agent Probe Brief (Phase 3 — Probe)

Used by `workflows/03-probe.md` to construct a focused brief per (repo ×
agent) dispatch. All four sections below MUST appear verbatim.

```
You are <AGENT_NAME>. Task: Spec-vs-Code drift probe.

## Project Context

- Project slug: <PROJECT_SLUG>
- Local repo path: <REPO_PATH>

Drift report (do NOT edit, read-only reference):
<DRIFT_REPORT_PATH>

## Probe Task

For each of the following spec anchors, check deterministically in the code:
- Does the artifact exist at the referenced location?
- Does it exist somewhere else in the repo (DIVERGED hint)?
- Does it not exist at all (MISSING)?
- Is there related code that does NOT appear in the spec anchor (EXTRA — only
  report if clearly belonging to this feature)?

Anchor list:
<SPEC_SUMMARY_BLOCK>

Approach:
1. For each anchor: targeted search (Grep / Glob) in REPO_PATH.
2. If `kind=file`: check file existence. If not found: MISSING.
3. If `kind=function`: Grep for function/class name.
4. If `kind=endpoint`: Grep for route definition (e.g. `app.post('/api/login'`).
5. If `kind=other`: heuristic keyword search from FR text.
6. After targeted searches: a quick broad scan for EXTRA candidates
   (functions/endpoints in the feature area not covered by any anchor).

## Output Contract (HARD)

Return ONLY a JSON list. Per entry:

```json
{
  "class": "MISSING" | "EXTRA" | "DIVERGED" | "STALE" | "IN_SYNC",
  "artifact": "short label",
  "spec_ref": "FR-### or empty",
  "code_ref": "path:line or empty",
  "description": "factual, 1-3 sentences",
  "recommendation": "actionable next step or empty"
}
```

Class definitions:
- MISSING: spec requires it, not found in code.
- EXTRA: code artifact exists (feature-relevant), spec does not reference it.
- DIVERGED: exists in both, but path/signature/structure differs.
- STALE: use ONLY if you find explicit hints of outdated code state
  (e.g. TODO markers, "deprecated", commented-out implementation that
  matches the spec). Otherwise do not set — Phase 3 does STALE reclassification
  from the pre-filter.
- IN_SYNC: confirmed match. ONE entry per probed anchor is enough.

Free prose is rejected. If you find nothing: `[]`.

## Out of Scope

- NO code changes. You are read-only.
- NO test runs, NO builds, NO deploys.
- Do NOT modify any files in REPO_PATH.
- Do NOT create or edit drift report files.
- NO spec edits.
- NO statements about semantic correctness — only structural presence/form.
- NO discussion of alternative architectures.
```

## Dispatch checklist (workflow uses this)

- [ ] All four brief sections present
- [ ] Project Context filled from frontmatter
- [ ] Spec Summary Block contains every `parsed_targets[]` entry for this repo
- [ ] Output Contract verbatim, no shortening
- [ ] Out of Scope verbatim, no shortening
- [ ] Agent name set
- [ ] Drift report path passed (read-only reference)
