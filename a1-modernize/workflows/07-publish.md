# Phase 07 — Publish

Goal: publish the approved modernization report to Notion. If Notion is
unavailable, export to local Markdown. Output: Notion page (or local export),
status `published`.

**Stop-gate G6 before publish.** Robert sees the report preview first.

## Step 1 — Compile report

Assemble the full report from master file and phase artifacts:

```markdown
# Modernize Report: <project-slug>

**Run:** <YYYY-MM-DD> | **Mode:** <full/spec-only>
**Code path:** <analyzed_path>
**Status:** executed

## 1. Reverse-Spec Summary
<FR count, key user roles, data model overview>
<Link to full reverse-spec>

## 2. Gap Findings
| Severity | Count | Top finding |
|---|---|---|
| BLOCKER | <N> | <description> |
| MAJOR | <N> | ... |
| MINOR | <N> | ... |

## 3. Tech Proposals
| ID | Title | Decision | Risk | Effort |
|---|---|---|---|---|
| P-001 | <title> | approved | <risk> | <effort> |
| P-002 | <title> | rejected — <reason> | ... | ... |
| P-003 | <title> | deferred | ... | ... |

## 4. Waves Executed
| Wave | Title | Status | Tests | Parity |
|---|---|---|---|---|
| W-01 | <title> | ✅ done | <N> passing | ✅ |
| ... |

## 5. Parity Verification
All <N> parity assertions: ✅ green
Commit range: <first-commit>..<last-commit>

## 6. Deferred Proposals (Backlog)
<list of deferred proposals for next run>

## 7. Open Questions Remaining
<list of OQ-XXX not resolved in this run>
```

## Step 2 — Gate G6: preview report

Show the compiled report structure to Robert:

> "Report-Vorschau für <project-slug>. Soll ich so nach Notion publishen?"

Wait for confirmation. Do not publish without explicit approval.

## Step 3a — Publish to Notion (primary)

If Notion-MCP is available:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs modernize publish-notion \
  "<master-path>" \
  --notion-parent "<parent-page-id>"
```

The command creates:
- A sub-page under the parent with the compiled report
- Sections: Reverse-Spec, Approved/Rejected/Deferred Proposals, Wave List, Parity Verification
- Properties: `obsidian_master_path`, `repo_url` (if git remote available), `commit_range`

On success, update status:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" published \
  --phase-data '{"notion_page_id": "<id>", "exported_at": "<iso8601>"}'
```

## Step 3b — Fallback: local Markdown export

If Notion-MCP fails or is not connected:

```
Notion-MCP nicht erreichbar. Lokaler Markdown-Export wird erstellt.
→ projects/<slug>/modernize/<date>/modernize-export/report.md
```

Write the compiled report to that path. Update status to `published` with
`fallback_path` set.

```bash
node ~/.claude/skills/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" published \
  --phase-data '{"fallback_path": "projects/<slug>/modernize/<date>/modernize-export/report.md"}'
```

**Never silently skip publishing.** Always show the user where the report ended up.

## Step 4 — Final summary

```
Modernize-Lauf abgeschlossen für <project-slug>.

📄 Report: <Notion URL oder lokaler Pfad>
🔗 Obsidian: projects/<slug>/modernize/<date>-<focus>.md

Zusammenfassung:
- FRs extrahiert: <N>
- Gaps gefunden: <N> BLOCKER, <N> MAJOR, <N> MINOR
- Proposals: <N> approved, <N> rejected, <N> deferred
- Waves ausgeführt: <N>
- Tests hinzugefügt: <N>
- Offene Fragen: <N> (im Vault dokumentiert)
```

## Step 5 — Retro (mandatory, every run)

After the final summary, write one structured entry. Takes ~2 minutes. Do not
skip. Used by `a1-evolve` for pattern clustering.

```bash
PROJECT_NAME="<project-slug>"
DATE=$(date +%Y-%m-%d)
```

### Append to local cache

```bash
cat >> ~/.claude/skills/a1-modernize/_learning.md <<EOF
---
date: $DATE
project: $PROJECT_NAME
result: <pass|partial|fail>
frs_extracted: <N>
gaps: <N blocker>/<N major>/<N minor>
waves_executed: <N>
issue_classes: [<from tags below>]
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

Then append the **same entry** to the Vault mirror:

```
~/N3URAL-Vault/pattern/a1-learnings/a1-modernize.md
```

Use the `issue_classes` tags consistently — they feed `patterns.md` clustering:
`fr_extraction_gap` | `gap_misclassified` | `proposal_scope_creep` |
`migration_missing` | `test_mock_only` | `wave_too_large` | `spec_drift` |
`publish_target_missing`

A run with zero issues is still useful data — write the entry with `issue_classes: []`.

### Threshold check

```bash
ENTRY_COUNT=$(grep -c "^date:" ~/.claude/skills/a1-modernize/_learning.md 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 neue Learnings akkumuliert — in Vault unter [[pattern/a1-learnings/index]] gespeichert. `a1-evolve` ausführen?"

Show `suggested_next` from frontmatter.
