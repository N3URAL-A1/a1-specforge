# Phase 04 — Synthesize (LLM, no sub-agents)

Goal: turn the raw findings list from Phase 3 into a prioritized, deduplicated,
and pattern-aware synthesis. Output: analysis file with `status: synthesized`,
filled Synthesis section, and computed `findings_count`.

This phase is LLM-driven (the skill itself), not sub-agent-dispatched. The
synthesis lives in the skill because cross-finding reasoning depends on full
context that we already have.

## Step 1 — Read all findings

Read the analysis file. Parse the frontmatter `findings[]` list. Each entry is
a string with `key=value; key=value` pairs. Decode into structured records:

```
[
  {id: "F-001", severity: "BLOCKER", category: "...", location: "...", description: "...", recommendation: "..."},
  ...
]
```

## Step 2 — Deduplicate

Two findings are duplicates if:
- Same `location` AND
- Similar `description` (substring overlap > 60% OR same category + same
  recommendation)

For each duplicate group: keep the highest-severity entry, mark the others as
"merged into F-NNN" in a transient note. Do NOT delete them from frontmatter
(audit trail); the synthesis section will reference only the kept IDs.

## Step 3 — Compute findings_count

Count occurrences per severity AFTER dedup logic:

```
{
  blocker: <n>,
  major: <n>,
  minor: <n>
}
```

## Step 4 — Identify cross-cutting patterns

Look for themes that span multiple findings, e.g.:
- "All BLOCKER findings are in the auth module" → pattern
- "3 of 4 MAJOR findings are missing input validation in API routes" → pattern
- "Quality issues cluster in the legacy `/lib/old/` directory" → pattern

Top 3 patterns max. Each pattern: one sentence + the F-IDs that exemplify it.

## Step 5 — Build priority items

Top 5 priority items, sorted by:
1. All BLOCKER first (regardless of category)
2. Then MAJOR with most cross-cutting reach (referenced in multiple patterns)
3. Then remaining MAJOR by severity-of-recommendation

For each priority item: F-ID, severity, one-sentence why-prioritized.

## Step 6 — Identify out-of-scope flags

Note anything that was NOT analyzed because of focus boundaries but seems
relevant, e.g.:
- "Focus was security; one of the agents noted potential performance issues
  in the auth path — not investigated here, may warrant a quality-focus follow-up."
- "Discover did not detect a test framework — test coverage was not assessable."

If nothing notable: write "none."

## Step 7 — Persist findings_count to frontmatter

```bash
node <repo>/_shared/a1-tools.cjs analyze update-status \
  "<analysis-path>" synthesized \
  --phase-data '{"findings_count": {"blocker": <n>, "major": <n>, "minor": <n>}}'
```

## Step 8 — Render the Synthesis section in the body

Use the Edit tool to replace the placeholder under `## Synthesis (Phase 4 — LLM)`.
Follow the shape from `~/.claude/skills/a1-analyze/templates/report-sections.md`:

```
## Synthesis

**Executive summary.** <1 paragraph>

**Cross-cutting patterns.**
1. <pattern> — F-NNN, F-NNN, F-NNN
2. ...
3. ...

**Priority items.**
1. **F-NNN (BLOCKER)** — <why>
2. **F-NNN (MAJOR)** — <why>
...

**Out-of-scope flags.** <text or "none.">
```

Also render the Findings section now (grouped by severity, as per template).

## Step 9 — Summarize for the user

> "Synthesize complete. <n> BLOCKER, <n> MAJOR, <n> MINOR.
>  Top-3 patterns: <keywords>.
>  Top recommendation: <short>.
>  
>  Should I start Phase 5 (Report — finalize + follow-up suggestions)?"

If yes: proceed to `05-report.md`.
If no: stop. Status `synthesized` persists.

## Edge cases

- **0 findings total:** that is a legitimate result. Synthesis says: "No
  findings in the chosen focus. This can mean: (a) project is clean, (b)
  sub-agents had too little context, (c) focus was too narrow.
  Recommendation: try re-analyzing with a different focus."
- **Only MINOR findings:** Top-5 becomes smaller than 5, that is fine.
  Synthesis should explicitly state that nothing critical was found.
- **Findings with unresolvable location:** keep them, mark in the Synthesis
  as "location unspecified".
