# Reference: Final Report Body Sections (Phase 5)

Workflow `05-report.md` overwrites the analysis file's body sections using Edit.
This file documents the target shape per section.

## Section: Discover

Populated end of Phase 2. Markdown table with key/value pairs from frontmatter
`discover[]`.

```
## Discover

| Key | Value |
|---|---|
| Tech stack | <comma-separated> |
| LOC | <n> |
| File count | <n> |
| Last commit | <ISO date> |
| Branch | <name> |
| Commits (30 days) | <n> |
```

## Section: Findings

Populated end of Phase 3 (initial dump) and refined in Phase 4 (after dedup).
Sorted by severity DESC then F-id ASC. Group by severity heading.

```
## Findings

### BLOCKER

- **F-001 — <category>** at `<location>`
  <description>
  → Recommendation: <recommendation>

### MAJOR

- **F-002 — <category>** at `<location>`
  ...

### MINOR

- **F-011 — <category>** at `<location>`
  ...
```

## Section: Synthesis

LLM-written in Phase 4. Max 6 paragraphs. Covers:

1. One-paragraph executive summary (what is this project, what state is it in)
2. Top 3 cross-cutting patterns (themes that recur across multiple findings)
3. Top 5 priority items (refer to F-ids, severity, why-prioritized)
4. Out-of-scope flags (anything notable that was not analyzed and why)

```
## Synthesis

**Executive summary.** <1 paragraph>

**Cross-cutting patterns.**
1. <pattern> — F-NNN, F-NNN, F-NNN
2. <pattern> — F-NNN, F-NNN
3. <pattern> — F-NNN

**Priority items.**
1. **F-NNN (BLOCKER)** — <why prioritized>
2. **F-NNN (MAJOR)** — <why prioritized>
...

**Out-of-scope flags.** <one paragraph, or "none">
```

## Section: Recommendations

LLM-written in Phase 5. Bullet list of suggested follow-up actions, mirroring
frontmatter `suggested_next[]`.

```
## Recommendations

1. **a1-fix** — <reason>
   - Targets: F-NNN, F-NNN

2. **a1-new-feature** — <reason>
   - Targets: F-NNN, F-NNN, F-NNN

3. **Backlog** — <reason>
   - Targets: F-NNN, F-NNN, F-NNN, ...

4. **Direct sub-agent follow-up** (optional) — <agent name>
   - Reason: <text>
```

## Section: Notes

Optional. Anything the skill wants to flag that does not fit the structured
sections (e.g. environment issues during the analysis, agents that failed to
respond, partial completeness flags).

## Editing strategy in workflow

The body is overwritten section-by-section via the Edit tool, using the existing
`## <Section>` heading as anchor. The template scaffolding inserted by
`analyze init` provides those anchors. Do not change anchor text — Edit relies on
it.
