# Phase 02 — Diagnose (Root Cause by Falk)

Goal: turn `status: reported` into `status: diagnosed` by identifying the most
likely root cause with file:line evidence and a confidence level. Output: the
`## Diagnosis` section of the bug report is filled, `recommended_code_agent` is
set in frontmatter.

## Inputs

- Vault path to the bug-report file
- Bug-report frontmatter must be in `status: reported`

If status is not `reported`, abort and explain to the user in German which phase
is actually next based on the current status.

## Step 1 — Read the bug report and the project

1. Read the bug-report file (Read tool, full content).
2. Identify `affected_repos` in frontmatter. For each repo:
   - Read its `CLAUDE.md` (project root) to learn structure and Agent Workflow table.
   - Note recent commits with `git log --oneline -20` in the repo.
3. If reproduction steps point at specific routes, files, or services: use
   Glob and Grep to find them. **Do not** read entire files end-to-end; targeted
   reads only.

## Step 2 — Spawn Falk for diagnosis

Use the `Task` tool to spawn Falk (`~/.claude/agents/falk-bug-hunter.md`) with this brief:

> Du bist Falk im Diagnose-Modus. Aufgabe: aus dem Bug-Report die wahrscheinlichste
> Root Cause ableiten und mit Evidenz belegen. Niemals fixen, niemals committen,
> niemals Files schreiben außerhalb des Bug-Reports.
>
> **Vault-Pfad zum Bug-Report:** <ABSOLUTE_PATH>
> **Affected Repos:** <list>
> **Symptom + Repro Steps:** (in der Datei)
>
> **Vorgehen:**
> 1. Bug-Report lesen, Symptom + Reproduction Steps verinnerlichen.
> 2. Stack-Trace folgen, falls vorhanden — Glob/Grep, nicht Volltextlesung.
> 3. Git-Log der affected files im Verdachtsfenster prüfen
>    (`related_deploy` als Anker).
> 4. Hypothese formulieren mit:
>    - **Root Cause** (eine Aussage, was wirklich kaputt ist)
>    - **Evidence** (Datei:Zeile-Verweise, Log-Auszüge, Commit-Hashes)
>    - **Confidence** (low / medium / high) — explizit begründet
>    - **Recommended code agent** (walter / bernd / aik / toni / felix / alex),
>      basierend auf Stack des affected repo
>    - **Suggested fix approach** (ein Absatz, kein Code)
>
> **Hard Rules:**
> - Niemals raten ohne Evidenz. Wenn keine Evidenz: "Confidence low,
>   weitere Reproduktion nötig" und stop.
> - Wenn die wahrscheinlichste Hypothese das Symptom nur teilweise erklärt:
>   das explizit sagen, nicht beschönigen.
> - Antwort auf Deutsch an Robert, technische Inhalte (file:line, code-Begriffe)
>   bleiben Englisch.
>
> Output: kompletter Diagnose-Block (Markdown) im Format der `## Diagnosis`-Sektion
> des Bug-Report-Templates, plus eine Empfehlung, ob Phase 03 starten soll.

## Step 3 — Update the bug report

When Falk returns:

1. Use the Edit tool to replace the `## Diagnosis (Phase 02 — filled by Falk)`
   block in the bug report with Falk's filled-in content.
2. Run the CLI to flip status and set the recommended agent:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs fix update-status \
  "<bug-path>" diagnosed \
  --recommended-code-agent <agent-name>
```

This appends `phase=diagnose completed=<iso>` to phase_history and sets
`recommended_code_agent` atomically.

## Step 4 — Hand off

Tell the user **in German**:

> "Diagnose abgeschlossen. Root Cause: <one-line summary>. Confidence: <level>.
> Vorgeschlagener Code-Agent: **<agent>**. Soll ich Phase 3 (Fix) anstoßen?"

If yes: proceed to `03-fix.md`.
If no: stop. State persists.

## Special exits from Phase 02

- **Confidence too low to proceed:** Falk says diagnosis is unsafe. Do NOT flip
  status to `diagnosed`. Tell Robert in German that more reproduction data is
  needed and recommend extending Phase 1 with additional logging or scenarios.
- **Discovery: it's a duplicate:** if Falk's diagnosis points to a known earlier
  bug, run
  `a1-tools fix update-status <bug-path> duplicate --duplicate-of <path-to-original>`
  and stop.
- **Discovery: it's intended behaviour (wont-fix):** flip status to `wont-fix`
  with a note explaining why; surface to user before flipping.
