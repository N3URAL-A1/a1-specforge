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

> "Report preview for <project-slug>. Shall I publish it to Notion like this?"

Wait for confirmation. Do not publish without explicit approval.

## Step 3a — Publish to Notion (primary)

If Notion-MCP is available:

```bash
node <repo>/_shared/a1-tools.cjs modernize publish-notion \
  "<master-path>" \
  --notion-parent "<parent-page-id>"
```

The command creates:
- A sub-page under the parent with the compiled report
- Sections: Reverse-Spec, Approved/Rejected/Deferred Proposals, Wave List, Parity Verification
- Properties: `obsidian_master_path`, `repo_url` (if git remote available), `commit_range`

On success, update status:

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" published \
  --phase-data '{"notion_page_id": "<id>", "exported_at": "<iso8601>"}'
```

## Step 3b — Fallback: local Markdown export

If Notion-MCP fails or is not connected:

```
Notion-MCP not reachable. Creating local Markdown export.
→ projects/<slug>/modernize/<date>/modernize-export/report.md
```

Write the compiled report to that path. Update status to `published` with
`fallback_path` set.

```bash
node <repo>/_shared/a1-tools.cjs modernize update-status \
  "<master-path>" published \
  --phase-data '{"fallback_path": "projects/<slug>/modernize/<date>/modernize-export/report.md"}'
```

**Never silently skip publishing.** Always show the user where the report ended up.

## Step 4 — Final summary

```
Modernize run complete for <project-slug>.

📄 Report: <Notion URL or local path>
🔗 Obsidian: projects/<slug>/modernize/<date>-<focus>.md

Summary:
- FRs extracted: <N>
- Gaps found: <N> BLOCKER, <N> MAJOR, <N> MINOR
- Proposals: <N> approved, <N> rejected, <N> deferred
- Waves executed: <N>
- Tests added: <N>
- Open questions: <N> (documented in the Vault)
```

## Retro (Step 5, mandatory, every run)

After the final summary, write one retro entry per `_shared/retro-template.md`
(entry format + write targets: learning store first, dev cache best-effort),
with skill = `a1-modernize` and these **additional fields** beyond the base
schema:

```
result: <pass|partial|fail>
frs_extracted: <N>
gaps: <N blocker>/<N major>/<N minor>
waves_executed: <N>
issue_classes: [<from: fr_extraction_gap, gap_misclassified, proposal_scope_creep, migration_missing, test_mock_only, wave_too_large, spec_drift, publish_target_missing>]
```

Use the `issue_classes` tags consistently — they feed `patterns.md`
clustering. A run with zero issues still gets an entry (`issue_classes: []`).

### Threshold check

Count entries in the **learning store** (not the dev cache — plugin installs
have no cache):

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
ENTRY_COUNT=$(grep -c "^date:" "$VAULT/pattern/a1-learnings/a1-modernize.md" 2>/dev/null || echo 0)
```
If `$ENTRY_COUNT` is a multiple of 5:
> "5 new learnings accumulated in the learning store. Run `a1-evolve`?"

Show `suggested_next` from frontmatter.
