# Sub-Agent Brief Template (Phase 3 — Analyze)

This template is used by `workflows/03-analyze.md` to construct a focused brief
for each sub-agent dispatched via the `Task` tool. The four sections below MUST
all be present in every dispatch.

## Brief structure (fill these four sections)

```
Du bist <AGENT_NAME>. Aufgabe: <FOCUS_HUMAN>-Analyse eines bestehenden Projekts.

## Project Context

- Projekt-Slug: <PROJECT_SLUG>
- Lokaler Pfad: <ANALYZED_PATH>
- Tech-Stack: <TECH_STACK_LIST>
- LOC: <LOC> in <FILE_COUNT> Dateien
- Letzter Commit: <LAST_COMMIT> auf Branch <BRANCH>
- Commit-Aktivität (30 Tage): <COMMIT_COUNT_30D>

Analyse-Datei (für deine Referenz, NICHT editieren):
<ANALYSIS_PATH>

## Focus

<FOCUS_SPECIFIC_PROMPT>

(siehe Mapping unten je Agent.)

## Output Contract (HARD)

Liefere AUSSCHLIESSLICH eine JSON-Liste mit Findings. Pro Finding:

```json
{
  "severity": "BLOCKER" | "MAJOR" | "MINOR",
  "category": "short label (max 3 words)",
  "location": "file:line OR module/path",
  "description": "what is wrong, factual, 1-3 sentences",
  "recommendation": "what to do about it, actionable"
}
```

Severity-Definitionen:
- BLOCKER: Sicherheits-Hole, Daten-Verlust-Risiko, Compliance-Verletzung, defekter Core-Flow.
- MAJOR: Erhebliches Risiko / Qualität / Wartbarkeit, sollte vor Launch oder bald gefixt sein.
- MINOR: Polish, Style, kleine Verbesserung, Backlog-Material.

Free-Prosa-Antworten werden zurückgewiesen. Wenn du nichts findest: leeres JSON-Array `[]`.
Wenn du mehr Kontext brauchst: liefere `[]` und einen Hinweis in Prosa was du brauchst.

## Out of Scope

- KEINE Code-Änderungen. Du bist read-only.
- KEIN Test-Run, KEIN Build, KEIN Deploy.
- KEINE Files in <ANALYZED_PATH> modifizieren.
- KEINE neuen Files anlegen (kein Report-File schreiben — Findings als Tool-Output).
- KEINE Diskussion alternativer Architekturen, die nichts mit dem Focus zu tun haben.
- KEINE Empfehlungen, die nicht zu einem konkreten `recommendation`-Feld passen.
```

## Focus-specific prompts

### general

> Verschaffe einen High-Level-Überblick. Was sind die 5 wichtigsten Beobachtungen
> über dieses Projekt (Architektur, Qualität, Risiken)? Eine Beobachtung pro
> Finding. Severity nach echter Schwere, nicht nach Auffälligkeit.

### security

> Suche nach: hardcoded secrets, fehlende Input-Validierung, Auth-Bypass-Risiken,
> RLS-Lücken (bei Supabase/Postgres), unsichere Default-Configs, veraltete
> Dependencies mit bekannten CVEs, Logging von PII, fehlendes Rate-Limiting,
> XSS/CSRF-Vektoren. Priorisiere BLOCKER für alles, was Daten-Exfiltration oder
> Account-Takeover ermöglicht.

### architecture

> Bewerte Modul-Grenzen, Coupling, Konsistenz der Abstraktion, fehlende ADRs für
> nicht-triviale Decisions, Wachstums-Bottlenecks. Sind die wichtigsten
> Architektur-Entscheidungen irgendwo dokumentiert? Sind die Module so geschnitten,
> dass parallele Entwicklung möglich ist? BLOCKER nur bei strukturellen Schäden
> (z.B. Zirkular-Abhängigkeiten zwischen Core-Modulen).

### quality

> Prüfe Code-Qualität: Komplexität, Duplikation, fehlende Tests in kritischen
> Pfaden, Dead Code, inkonsistente Patterns, fehlerhafte Error-Handling-Praxis,
> übermäßig große Files (>800 Zeilen), tiefe Nesting (>4 Ebenen). BLOCKER nur
> bei systemischen Quality-Verletzungen, die Wartung verhindern.

### onboarding

> Aus Sicht eines neuen Entwicklers: was würde 80% des Onboarding-Wegs beschleunigen?
> Identifiziere fehlende READMEs, unklare Entry-Points, nicht-offensichtliche
> Abhängigkeiten, Mental-Model-Lücken. Findings hier sind primär MINOR/MAJOR —
> echte BLOCKER (z.B. "Projekt baut nicht ohne undokumentiertes Setup") sind selten.

## Dispatch checklist (workflow uses this)

- [ ] All four brief sections present
- [ ] Project Context filled from frontmatter discover[]
- [ ] Focus prompt from table above for the chosen focus
- [ ] Output Contract verbatim, no shortening
- [ ] Out of Scope verbatim, no shortening
- [ ] Agent name set
- [ ] Analysis file path passed (read-only reference)
