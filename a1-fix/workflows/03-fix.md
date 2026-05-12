# Phase 03 — Fix (Code Agent)

Goal: turn `status: diagnosed` into `status: fixing` while a project code agent
implements the fix, then record `fix_commit` once the commit lands. The skill
itself does NOT write code in this phase — it briefs the code agent and tracks
state.

## Inputs

- Vault path to the bug-report file (status must be `diagnosed`)
- `recommended_code_agent` set in frontmatter

## Step 1 — Read context

1. Read the bug report (full content).
2. Note `severity`, `affected_repos`, `recommended_code_agent`, and the
   `## Diagnosis` section (Confidence + Suggested fix approach).
3. If `severity` is `blocker` or `major`: a regression test BEFORE the fix is
   strongly recommended (so we have a red test that turns green).

## Step 1.5 — Scope-Clarify Gate (Opus 4.7, mandatory for UI changes)

**When to run:** Run this gate if the diagnosis involves ANY of:
- Adding or removing table columns, buttons, links, or form fields
- New UI component or screen section
- Changing an existing page layout or form
- A "fix" whose scope touches more than one isolated code path

**When to skip:** Pure logic bugs (wrong value, crash, null-pointer, wrong HTTP method,
type error) with no UI surface — skip directly to Step 2.

**How to run (model: `claude-opus-4-7`):**

Read the diagnosis and the affected UI surface, then ask the user **in German** up to
**3 questions** — only the ones that could cause a rework loop if answered wrong.
Pick from this catalogue the most relevant ones for this fix:

| Probe category | Example question |
|---|---|
| **In / Out — elements** | "Die Tabelle hat aktuell [X, Y, Z] Spalten. Welche sollen bleiben, welche weg?" |
| **Surrounding actions** | "Neben dem neuen Button gibt es [Löschen / Beleg]. Bleiben die, oder fällt auch einer weg?" |
| **State after save/action** | "Nachdem der User speichert — bleibt er auf der Seite oder geht er zur Liste?" |
| **Empty / error state** | "Was soll passieren wenn [kein Eintrag / API-Fehler]?" |
| **Permissions / visibility** | "Soll das für alle Tenant-User sichtbar sein oder nur Owner?" |
| **Mobile vs Desktop** | "Gilt das für die Desktop-Tabelle, die Mobile-Ansicht, oder beide?" |

Format the questions as a concise numbered list. Wait for answers before dispatching
the code agent. Incorporate answers into the code agent brief in Step 3.

If the user says "mach einfach" or waves the question away: use sensible defaults,
document the defaults in the bug report `## Notes` section, and proceed.

## Step 2 — Propose the code agent dispatch

Tell the user **in German**, summarizing the brief that would go to the agent:

> "Phase 3 — Fix. Vorschlag:
>
> - **Code-Agent:** <agent-name>
> - **Severity:** <severity> → <"Regression-Test ZUERST empfohlen" wenn ≥ MAJOR sonst "Test optional">
> - **Bug-Report:** `<vault-path>`
> - **Affected Repos:** <repos>
> - **Confidence der Diagnose:** <level>
> - **Fix-Ansatz (aus Diagnose):** <one-line summary>
>
> Soll ich `<agent-name>` mit diesem Brief anstoßen, oder willst du einen
> anderen Agenten / selbst übernehmen?"

If the user confirms a different agent: use that one. If the user wants to fix
manually: skip Step 3, jump to Step 4 once they have a commit hash.

## Step 3 — Spawn the code agent

Flip status to `fixing` BEFORE spawning, so the bug-report reflects the active
work:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixing
```

Spawn the code agent via the `Task` tool with this brief:

> **Auftrag:** Bug-Fix nach Diagnose.
>
> **Bug-Report (Single Source of Truth):** <ABSOLUTE_VAULT_PATH>
>   → Lies die Datei vollständig. Symptom, Repro Steps, Diagnose, Confidence
>   und vorgeschlagener Fix-Ansatz stehen drin.
>
> **Affected Repos:** <list with concrete files from Diagnosis>
>
> **Severity:** <severity>
>   → Wenn ≥ MAJOR: schreibe ZUERST einen Regression-Test, der das Symptom
>   reproduziert (rot). Erst dann fix. Test muss grün werden.
>
> **Hard Rules:**
> - Bug-Report-Frontmatter NICHT manuell editieren — der Skill kümmert sich.
> - Commit-Message: `fix(<scope>): <one-line> — <bug-report-filename>`
> - Nach Commit: dem Skill den Commit-Hash zurückmelden.
>
> **Erwartetes Output:** Commit-Hash + ein-Satz-Beschreibung was geändert wurde
> + bestätigung dass Reproduction Steps jetzt nicht mehr greifen (oder
> Begründung, warum die Diagnose erweitert werden muss).

## Step 4 — Record the fix commit

When the agent (or Robert) returns with a commit hash:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" fixing \
  --fix-commit <commit-hash>
```

Status stays `fixing` — the transition to `fixed` only happens after Phase 4
verifies the symptom is gone. Setting `fix_commit` while still in `fixing`
preserves the audit trail.

Also use the Edit tool to fill the `## Fix Plan (Phase 03 — filled by code agent)`
section in the bug report with the agent's summary (approach, files, regression
test path, risk).

## Step 5 — Hand off

Tell the user **in German**:

> "Fix-Commit aufgezeichnet: `<hash>`. Status bleibt `fixing` bis Phase 4
> bestätigt, dass das Symptom weg ist. Soll ich Phase 4 (Verify) starten?"

If yes: proceed to `04-verify.md`.

## Special exits from Phase 03

- **Code agent reports the diagnosis was wrong / incomplete:** do NOT set
  fix_commit. Run
  `a1-tools fix update-status <bug-path> reported`
  and offer to re-run Phase 2 with the new evidence in `## Notes`.
- **User cancels mid-fix:** run
  `a1-tools fix update-status <bug-path> cancelled`. Slot stays.
