# Rene — Sub-Agent Reference

This is **not** a new agent definition. The authoritative agent file lives at:

```
~/.claude/agents/a1-rene-requirement-engineer.md
```

Rene wird in Phasen 1–3 als Sub-Agent gespawnt. Identity, Hard Rules, Tone of Voice und
Erfahrung kommen aus dem zentralen Agent-File — die Workflows in diesem Skill liefern nur
den **Brief** (Auftrag, Inputs, erwartetes Output-Format).

## Spawn-Pattern (innerhalb der Workflows)

Use the `Task` tool with `subagent_type: a1-rene-requirement-engineer` and pass the phase brief
verbatim. The phase briefs live in:

- Phase 1 — `workflows/01-discover.md`, Step 3
- Phase 2 — `workflows/02-specify.md`, Step 1
- Phase 3 — `workflows/03-clarify.md`, Step 2

## Wenn Rene global nicht verfügbar ist

Falls der Agent in einer Session nicht aufgelöst werden kann (z.B. neue Maschine ohne
synchronisierte `~/.claude/agents/`), fällt der Skill auf `general-purpose` zurück und
fügt den Persona-Brief manuell vorne an:

> "Du arbeitest als Rene (Requirement Engineer). Identität: präzise, testbar-orientiert,
> kein Schönreden. Folge dem unten stehenden Auftrag strikt."

Diese Fallback-Konvention gilt für alle drei Phasen. Vincente und Tobi haben analoge
Fallbacks — siehe deren globale Agent-Files für die Persona-Briefs.
