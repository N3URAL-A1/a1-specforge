# Drift Report Body Template

Used by `workflows/04-report.md`. Frontmatter is owned by the CLI; this
template renders ONLY the body (everything after the closing `---`).

Placeholders are replaced by the skill. Keep heading levels and order intact —
downstream tools may parse this structure.

```markdown
# Drift Report — <SCOPE_LABEL> (<DATE>)

## Summary

- Scope: `<scope_mode>` over <target_count> target(s)
- Total drifts: <total>
  - MISSING:  <missing_count>
  - EXTRA:    <extra_count>
  - DIVERGED: <diverged_count>
  - STALE:    <stale_count>
- In-Sync confirmations: <in_sync_count>
- Probe coverage: <agents_completed>/<agents_dispatched> agents completed
<OPTIONAL_PARSE_WARNINGS_LINE>
<OPTIONAL_PROBE_NOTES_LINE>

Targets:
<TARGETS_BULLET_LIST>

## Drifts

### MISSING (<missing_count>)

<for each MISSING drift>
#### D-NNN — `<artifact>`

- Spec ref: `<spec_ref>`
- Code ref: `<code_ref or "n/a">`
- Description: <description>
- Recommendation: <recommendation>

</for>

### EXTRA (<extra_count>)

<same structure>

### DIVERGED (<diverged_count>)

<same structure>

### STALE (<stale_count>)

<same structure>

## In-Sync Confirmations

<one bullet per IN_SYNC entry, format: `- <spec_ref>: <artifact>`>

## Skipped Projects

<vault-sync only; one bullet per entry: `- <slug>: <reason>`>

## Phase History

| Phase | Status | Completed at |
|---|---|---|
<one row per phase_history entry>

## Suggested Next

<one bullet per suggested_next entry, format:
`- **<skill>**: <reason>. Targets: <comma-separated spec_refs>`>
```

## Rendering rules

- If a class has zero drifts, omit its entire subsection (no empty heading).
- "In-Sync Confirmations" is omitted if `in_sync_count == 0`.
- "Skipped Projects" is omitted if not `vault-sync` or if list is empty.
- `<OPTIONAL_PARSE_WARNINGS_LINE>`: render `- Parse warnings: <n>` (with a
  list below) only if `parse_warnings[]` is non-empty.
- `<OPTIONAL_PROBE_NOTES_LINE>`: same, for `probe_notes[]`.
- All file paths in inline code (backticks).
- All FR-IDs in inline code (backticks).
- No emoji, no separators, no horizontal rules.

## Hand-off mapping (used by Step 3 of 04-report.md)

| Class present | Skill | Reason text |
|---|---|---|
| MISSING (narrow, ≤ 2 FRs) | `a1-fix` | "Implement missing artefacts referenced by spec." |
| MISSING (broad, > 2 FRs) | `a1-new-feature` | "Substantial implementation gap; treat as new feature work." |
| EXTRA | `a1-new-feature` | "Update spec to cover orphan code, or remove the code via a1-fix." |
| DIVERGED | `a1-fix` | "Manual inspection required, then targeted edit." |
| STALE | (none — re-run) | "Re-run a1-reconcile after the next code change touches the area." |
| only IN_SYNC | (none) | "Clean state; schedule weekly vault-sync." |

The threshold "≤ 2 FRs" is a heuristic; the skill can override based on
finding density per file.
