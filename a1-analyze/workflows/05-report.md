# Phase 05 — Report (finalize + propose follow-ups)

Goal: render the final report sections, populate `suggested_next[]`, deliver a
compact German summary to Robert. Output: analysis file with `status: reported`,
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
| Architectural drift mentioned in Synthesis patterns | direct → Alex, or `a1-reconcile` (M3 — not yet built, mention as future) |

Each entry has: `skill`, `reason`, `target_findings` (list of F-IDs).

Examples:
- `{skill: "a1-fix", reason: "Session token in LocalStorage — Account-Takeover-Risk", target_findings: ["F-001"]}`
- `{skill: "a1-new-feature", reason: "RLS-Refactor over 3 tables, structural", target_findings: ["F-002", "F-003", "F-004"]}`
- `{skill: "backlog", reason: "Code style + naming polish", target_findings: ["F-011", "F-012", "F-013"]}`

## Step 2 — Persist suggested_next to frontmatter

```bash
node ~/.claude/skills/_shared/a1-tools.cjs analyze update-status \
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

## Step 4 — Deliver the compact German summary to Robert

This is the user-facing handoff. Strict format:

```
Analyse abgeschlossen: projects/<slug>/analyses/<file>

Findings:
• <n> BLOCKER — <one-line summary of biggest BLOCKER>
• <n> MAJOR — <one-line summary>
• <n> MINOR — <one-line summary>

Vorgeschlagene nächste Schritte:
1. a1-fix für <kurz> — <why critical>
2. a1-new-feature für <kurz> — <why grouped>
3. Backlog für <kurz>

Was tun? (1 / 2 / 3 / nichts)
```

## Step 5 — Wait for Robert's decision

Do NOT auto-activate any follow-up skill. The hard rule applies:
- Skill writes nothing in `projects/<slug>/fixes/`
- Skill writes nothing in `projects/<slug>/features/`
- Skill does not invoke `a1-fix` or `a1-new-feature`

When Robert picks an option, formulate the next prompt for him in German:

- For `1` (a1-fix): "Du kannst jetzt sagen: 'Bug-Report: <BLOCKER-Symptom>
  in <project>.' Dann aktiviert sich a1-fix mit dem Triage-Interview von Falk."
- For `2` (a1-new-feature): "Du kannst jetzt sagen: 'Neues Feature: <refactor-scope>
  in <project>.' Dann aktiviert sich a1-new-feature."
- For `3` (Backlog): "Backlog dokumentiert in der Analyse-Datei (Section
  Recommendations). Kein weiterer Skill nötig."
- For `nichts`: "Verstanden. Analyse liegt unter <path>. Du kannst sie jederzeit
  via 'Zeig mir die letzte Analyse von <project>' wieder aufrufen."

## Step 6 — End of phase

The skill ends here. Status `reported` is terminal for `a1-analyze`. The file
persists. Suggestions in `suggested_next[]` are machine-readable for future
orchestrators (Pablo, Vincente, or a future M3 skill).

## Edge cases

- **No BLOCKER, no MAJOR (only MINOR or none):** suggested_next has only a
  "backlog" entry (or is empty). Summary auf Deutsch sagt: "Keine kritischen
  Funde — Projekt ist im gewählten Fokus stabil."
- **All findings are BLOCKER (panic-mode):** suggested_next has multiple a1-fix
  entries. Summary explicitly states "Mehrere BLOCKER — sofort handeln empfohlen."
- **Robert wants to compare with a previous analysis:** mention that
  `a1-tools analyze list <slug>` returns all analyses sorted by date. Out of
  scope for this skill to do diff-reports — that's M3 `a1-reconcile`.
