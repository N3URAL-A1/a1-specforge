# Phase 03 — Probe (parallel sub-agent dispatch)

Goal: classify each parsed target into MISSING / EXTRA / DIVERGED / STALE (or
"in-sync") by probing the repository. Output: drift report with `status:
probed` and populated `drifts[]`.

## Step 1 — Group targets by repo

Read `parsed_targets[]` from frontmatter and group by `repo_path`. For each
distinct repo, dispatch one sub-agent invocation (so the agent reads the repo
context once, not per-target).

## Step 2 — Build probe briefs from the template

For each repo group, read
`~/.claude/skills/a1-reconcile/templates/agent-probe-brief.md` and substitute:

- `<AGENT_NAME>` — `a1-marco-mapper` for the structural probe; add `Alex`
  as a second parallel dispatch if any target has `kind: function` or
  `kind: endpoint` AND the project has > 5 such targets (architecture-level
  scrutiny).
- `<PROJECT_SLUG>`, `<REPO_PATH>` — from frontmatter
- `<SPEC_SUMMARY_BLOCK>` — bullet list of `parsed_targets[]` entries, grouped
  by spec_id, formatted as `- FR-### (<kind>): <ref> — <context>`
- `<DRIFT_REPORT_PATH>` — absolute path (read-only reference)

All four brief sections (Project Context, Probe Task, Output Contract, Out of
Scope) MUST appear verbatim.

## Step 3 — Dispatch in parallel

Use the `Task` tool with one invocation per (repo × agent) pair, all in a
single turn.

```
Task(subagent_type="general-purpose",
     description="a1-marco-mapper drift probe <slug>",
     prompt="<the full brief>")
Task(subagent_type="general-purpose",
     description="Alex architecture drift probe <slug>",
     prompt="<the full brief>")
```

For agents with a dedicated `subagent_type` (e.g. `a1-marco-mapper`), use
that type. Otherwise `general-purpose` with the agent persona on line 1 of
the brief.

## Step 4 — Validate each agent's output

Each agent MUST return a JSON array of drift objects. Schema:

```json
{
  "class": "MISSING" | "EXTRA" | "DIVERGED" | "STALE" | "IN_SYNC",
  "artifact": "short label, e.g. POST /api/login or src/auth/credentials.ts",
  "spec_ref": "FR-002",
  "code_ref": "src/auth/cred.ts:42",
  "description": "factual, 1-3 sentences explaining the drift",
  "recommendation": "actionable next step"
}
```

Validation:

1. Valid JSON array → continue.
2. Empty array `[]` → record dispatch with zero drifts.
3. Non-JSON / wrong shape → re-dispatch ONCE: "Last response was not a valid
   JSON array. Please retry with ONLY JSON per Output-Contract."
   If second attempt also fails → record failure in `probe_notes[]`, skip
   this agent's findings.
4. Filter out `class: IN_SYNC` entries — they confirm presence but don't
   need to land in the drift report. Count them in `probe_metadata.in_sync`.

Each drift object must have: `class`, `artifact`, `description`. `spec_ref`,
`code_ref`, `recommendation` are optional but strongly encouraged. Reject and
re-ask once if `class` or `artifact` or `description` is missing.

## Step 5 — Apply STALE pre-filter rule

Cross-check against Phase 2's STALE candidates:

- A target that was a `stale_candidate` AND the agent classified as `IN_SYNC`
  → reclassify as `STALE` (the code matches structurally, but the spec is
  newer; the semantic behaviour may have drifted).
- A target that was a `stale_candidate` AND the agent classified as `MISSING`
  → keep as `MISSING` (more specific).
- A target that was a `stale_candidate` AND the agent classified as
  `DIVERGED` → keep as `DIVERGED` (more specific).

## Step 6 — Append drifts to the report

For each non-IN_SYNC drift:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs reconcile add-drift \
  "<drift-path>" \
  <CLASS> \
  "<artifact>" \
  "<description>" \
  --recommendation "<text>" \
  --spec-ref "<FR-###>" \
  --code-ref "<path:line>"
```

The helper auto-increments the ID (D-001, D-002, ...) and atomically appends
to the frontmatter `drifts[]`.

## Step 6b — DIVERGED follow-up: semantic probe (if needed)

After collecting a1-marco-mapper results, check if any drift has
`class: DIVERGED`. If yes AND Alex was NOT already dispatched in Step 3:

Dispatch Alex as a focused DIVERGED semantic probe:

```
Task(subagent_type="a1-alex-architekt",
     description="Alex DIVERGED semantic probe <slug>",
     prompt="IMPORTANT: Return ONLY a JSON array. No prose.\n\n
You are Alex (a1-alex-architekt). Task: semantic analysis of DIVERGED spec findings.\n\n
Project: <PROJECT_SLUG>, repo: <REPO_PATH>.\n\n
The following artifacts were classified as DIVERGED by a structural probe
(they exist in code but path, signature, or boundary differs from spec).
For each one, confirm or refine the classification with an architecture-level
assessment. Focus on: wrong module, wrong layer, broken interface boundary,
coupling violations.\n\n
DIVERGED artifacts to assess:\n<DIVERGED_ARTIFACT_LIST>\n\n
Output Contract: JSON array with same schema as primary probe.
Return [] if all DIVERGED findings hold up without refinement.")
```

Merge Alex's DIVERGED results into the drift list: Alex's findings override
a1-marco-mapper's DIVERGED entries for the same artifact (Alex has deeper
semantic context). Apply Step 4 validation rules (JSON check, re-ask once).

If Alex was already dispatched in Step 3 (> 5 function/endpoint targets):
his DIVERGED findings from that run already cover this — skip Step 6b.

## Step 7 — Record probe metadata

After all agents complete:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs reconcile update-status \
  "<drift-path>" probed \
  --phase-data '{
    "agents_dispatched": [
      {"name": "a1-marco-mapper", "completed_at": "<ISO>", "drift_count": <n>},
      {"name": "Alex", "completed_at": "<ISO>", "drift_count": <n>}
    ],
    "in_sync_count": <n>
  }'
```

## Step 8 — Summarize for the user

> "Probe complete. <total> drifts found:
>  - MISSING: <n> (spec requires, code lacks)
>  - EXTRA:   <n> (code exists, not referenced in spec)
>  - DIVERGED:<n> (path/signature differs)
>  - STALE:   <n> (spec newer than code)
>  - In-sync: <n> (no drift)
>
>  Should I start Phase 4 (Report — generate Markdown report)?"

If yes: proceed to `04-report.md`.
If no: stop. Status `probed` persists.

## Edge cases

- **All targets IN_SYNC:** legitimate result. Phase 4 will produce a "clean"
  report. Do not skip Phase 4 — the user needs the artifact.
- **Agent timeout:** record the failure in `probe_notes[]`, continue with
  other agents. Do not block.
- **Agent suggests code edits:** Output-Contract violation. Re-ask once with
  "You are read-only, no code edits."
- **Repo path missing on disk:** mark every target in that repo as
  `class: MISSING` with `description: "repo not accessible: <reason>"`. The
  user decides whether to fix the path and re-run.
- **Conflict between agents:** if `a1-marco-mapper` says IN_SYNC and Alex
  says DIVERGED for the same artifact, keep both findings; Phase 4 dedups by
  picking the higher-severity class (DIVERGED > MISSING > EXTRA > STALE >
  IN_SYNC).
- **Alex returns prose instead of JSON:** This is a known failure mode. Re-ask
  once: "Your response was not a valid JSON array. Return ONLY the JSON array
  per Output Contract." If the second attempt also returns prose, record
  `probe_notes: [{agent: "Alex", status: "json-contract-failed", note: "returned prose twice"}]`
  and continue without Alex's findings.
