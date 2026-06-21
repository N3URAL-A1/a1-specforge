# Phase 00 — Pre-Flight

Run this before Phase 01 (Report) on every new bug. Three checks in sequence.
Total time: ~30 seconds. Do not skip.

## Check 1 — Integrity Check

Verify that agent and skill files have not drifted from the canonical lock file:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix integrity-check
```

**If status is `"bootstrapped"`:** Lock file was just created from the current state.
Proceed — first run is always safe.

**If status is `"ok"`:** All good. Proceed.

**If status is `"mismatch"`:** **STOP IMMEDIATELY.**

Tell the user (in German):
> "⛔ Integritätsfehler: Folgende Agent/Skill-Dateien haben sich seit dem letzten
> Lock geändert:
> - <file>: erwartet <expected>, aktuell <actual>
>
> Mögliche Ursachen: nicht-committeter Edit, manueller Eingriff, oder der Lock ist veraltet.
>
> Ich schreibe nichts, bis dieser Zustand geklärt ist.
>
> Optionen:
> 1. `node ~/.claude/skills/_shared/a1-tools.cjs fix integrity-check` nach jedem
>    absichtlichen Agent-Edit ausführen — aber NICHT automatisch; du musst das bestätigen.
> 2. Lock manuell neu bootstrappen (lösche `wiki/_canonical/agents.lock.json`) wenn
>    die Änderungen absichtlich waren.
>
> Was soll ich tun?"

Do NOT proceed with the bug pipeline until the user resolves the mismatch.

## Check 2 — Bug Patterns Lookup

Load project-specific patterns into context for Falk:

```bash
# Read the project's pattern file if it exists
cat "~/N3URAL-Vault/wiki/bug-patterns/<project-slug>.md"
cat "~/N3URAL-Vault/wiki/bug-patterns/_cross-cutting.md"
```

If either file doesn't exist: skip silently. Do not create it here.

Hold this content in context. When spawning Falk in Phase 01 Step 2, include
a summary of the 2–3 most relevant patterns based on the symptom keywords.
Add to Falk's brief:

> **Known patterns for <project>:** <2-3 sentence summary of relevant patterns>
> Use this to cross-check during diagnosis — is this a known recurrence?

## Check 3 — Postmortem Search

Search for similar past bugs:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix find-duplicates <project-slug> <kw1> <kw2> [<kw3>]
```

Also search postmortems directly:

```bash
grep -l "<symptom-keyword>" "~/N3URAL-Vault/wiki/postmortems/<project-slug>/"
```

If postmortems found with the same keyword: tell the user:
> "Ähnliche Bugs in der Postmortem-Datenbank:
> - <file> — <one_line_learning>
>
> Ist das eine Wiederkehr des gleichen Problems?"

If yes → note it on the new bug report as `related_postmortem`.
If no → proceed normally.

## Hand-off

Pre-Flight complete. Proceed to `01-report.md`.

Context to carry forward into Phase 01:
- Project slug (confirmed)
- Bug-patterns summary (for Falk's brief)
- Any related postmortem files found
