# Phase 05 — Report (finalize + propose follow-ups)

Goal: render the final report sections, populate `suggested_next[]`, deliver a
compact summary to the user. Output: analysis file with `status: reported`,
filled Recommendations section, populated `suggested_next[]`.

This phase is LLM-driven, no sub-agents.

## Step 1 — Build suggested_next from findings

Apply this routing logic to the deduplicated findings:

| Finding type | Suggested follow-up skill |
|---|---|
| Any BLOCKER | `a1-fix` (one entry per BLOCKER, or grouped if same root cause) |
| MAJOR with structural change (multiple files, new module, refactor) | `a1-new-feature` (grouped by structural area) |
| MAJOR with compliance/legal scope | direct → Ludwig |
| All remaining MAJOR + MINOR (polish, style, small) | "Backlog" (no skill) |
| Architectural drift mentioned in Synthesis patterns | direct → a1-alex-architekt, or `a1-reconcile` (spec-vs-implementation drift detection) |

Each entry has: `skill`, `reason`, `target_findings` (list of F-IDs).

Examples:
- `{skill: "a1-fix", reason: "Session token in LocalStorage — Account-Takeover-Risk", target_findings: ["F-001"]}`
- `{skill: "a1-new-feature", reason: "RLS-Refactor over 3 tables, structural", target_findings: ["F-002", "F-003", "F-004"]}`
- `{skill: "backlog", reason: "Code style + naming polish", target_findings: ["F-011", "F-012", "F-013"]}`

## Step 2 — Persist suggested_next to frontmatter

```bash
node <repo>/_shared/a1-tools.cjs analyze update-status \
  "<analysis-path>" reported \
  --phase-data '{
    "suggested_next": [
      {"skill": "a1-fix", "reason": "...", "target_findings": ["F-001"]},
      {"skill": "a1-new-feature", "reason": "...", "target_findings": ["F-002","F-003","F-004"]},
      {"skill": "backlog", "reason": "...", "target_findings": ["F-011","F-012","F-013"]}
    ]
  }'
```

## Step 3 — Render the Recommendations section in the body

Use the Edit tool to replace the placeholder under `## Recommendations (Phase 5 — LLM)`.
Follow the shape from `~/.claude/skills/a1-analyze/templates/report-sections.md`:

```
## Recommendations

1. **a1-fix** — <reason>
   - Targets: F-NNN

2. **a1-new-feature** — <reason>
   - Targets: F-NNN, F-NNN, F-NNN

3. **Backlog** — <reason>
   - Targets: F-NNN, F-NNN, F-NNN
```

## Step 4 — Deliver the compact summary to the user

This is the user-facing handoff. Strict format:

```
Analysis complete: projects/<slug>/analyses/<file>

Findings:
• <n> BLOCKER — <one-line summary of biggest BLOCKER>
• <n> MAJOR — <one-line summary>
• <n> MINOR — <one-line summary>

Suggested next steps:
1. a1-fix for <short> — <why critical>
2. a1-new-feature for <short> — <why grouped>
3. Backlog for <short>

What would you like to do? (1 / 2 / 3 / nothing)
```

## Step 5 — Wait for the user's decision

Do NOT auto-activate any follow-up skill. The hard rule applies:
- Skill writes nothing in `projects/<slug>/fixes/`
- Skill writes nothing in `projects/<slug>/features/`
- Skill does not invoke `a1-fix` or `a1-new-feature`

When the user picks an option, formulate the next prompt:

- For `1` (a1-fix): "You can now say: 'Bug report: <BLOCKER-symptom>
  in <project>.' That activates a1-fix with a1-falk-fault-finder's triage interview."
- For `2` (a1-new-feature): "You can now say: 'New feature: <refactor-scope>
  in <project>.' That activates a1-new-feature."
- For `3` (Backlog): "Backlog documented in the analysis file (Recommendations
  section). No further skill needed."
- For `nothing`: "Understood. Analysis is at <path>. You can retrieve it at
  any time by referencing the analysis path."

## Step 6 — End of phase

The skill ends here. Status `reported` is terminal for `a1-analyze`. The file
persists. Suggestions in `suggested_next[]` are machine-readable for future
orchestrators.

## Step 7 — Optional: offer to publish into the product-docs audit surface

After the report is written (Step 4/5 delivered), check whether the target
project has a `docs/product/` directory. This is opt-in only — never automatic:

```bash
test -d "<project-root>/docs/product" && echo present || echo absent
```

- **`docs/product/` absent:** skip silently. Do not mention this step to the
  user at all — no prompt, no notice.
- **`docs/product/` present:** ask the user, in the same turn as the summary
  in Step 4 (or immediately after, if the user already responded to the
  `suggested_next` prompt): "Publish this analysis into the product-docs audit
  surface? (`product audit-publish --analysis <path>`)". Only run the command
  on explicit confirmation ("yes" / "1" / equivalent) — never invoke it
  without the user saying so first.

```bash
node <repo>/_shared/a1-tools.cjs product audit-publish --analysis "<analysis-path>"
```

If the user declines or ignores the prompt, do nothing further — this is not
a hard rule violation, it's simply skipped like any other opt-in offer.

## Edge cases

- **No BLOCKER, no MAJOR (only MINOR or none):** suggested_next has only a
  "backlog" entry (or is empty). Summary says: "No critical findings —
  project is stable in the chosen focus."
- **All findings are BLOCKER (panic-mode):** suggested_next has multiple a1-fix
  entries. Summary explicitly states "Multiple BLOCKERS — immediate action
  recommended."
- **User wants to compare with a previous analysis:** mention that
  `a1-tools analyze list <slug>` returns all analyses sorted by date. Out of
  scope for this skill to do diff-reports — for spec-vs-implementation drift
  use `a1-reconcile`.

## Retro (MANDATORY, every run — this closes the self-learning loop)

After every run — pass, partial, or fail — write one retro entry **before you
tell the user the analysis is done**, per `_shared/retro-template.md` (entry
format + write targets: learning store first, dev cache best-effort), with
skill = `a1-analyze`. This is not optional — without it `a1-evolve` is blind
and the skills stop improving.

### Additional fields beyond the base schema

```
focus: <general|security|architecture|quality|onboarding>
findings_total: <N>
findings_blocker: <N>
issue_classes: [<from: missing_coverage, arch_drift_found, quality_finding_actionable, simplification_opportunity, security_vuln, duplicate_critical_logic, agent_timeout, empty_findings, contract_violation, dispatch_error, vault_path_issue>]
simplify_lane: <ran|skipped>
security_lane: <ran|skipped>
```

The `issue_classes` tags are shared with `patterns.md` clustering —
`simplification_opportunity` and `security_vuln` come from the two always-on
lanes and are exactly the signal to feed forward into builds. A run with no
issues still gets an entry (`findings_total: 0`).

### Threshold check (hands off to a1-evolve)

Count entries written **since the last a1-evolve synthesis**, not the lifetime
total — otherwise the historical count keeps re-tripping "multiple of 5" on
every run. The synthesis watermark is the `updated:` date in the store's
`patterns.md` (the same date a1-evolve uses for de-duplication):

```bash
VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
PATTERNS="$VAULT/pattern/a1-learnings/patterns.md"
LAST_SYNTH=$(grep -m1 '^updated:' "$PATTERNS" 2>/dev/null | sed 's/updated:[[:space:]]*//')
# Count a1-analyze store entries dated after the last synthesis:
NEW_COUNT=$(awk -v cutoff="$LAST_SYNTH" '
  /^date:/ { d=$2; if (cutoff=="" || d > cutoff) c++ }
  END { print c+0 }' "$VAULT/pattern/a1-learnings/a1-analyze.md" 2>/dev/null || echo 0)
```

If `$NEW_COUNT` is ≥ 5, tell the user:
> "≥5 new a1-analyze learnings since the last synthesis. Run `a1-evolve` to
> evaluate patterns?"

Do not run it automatically — the user decides.
