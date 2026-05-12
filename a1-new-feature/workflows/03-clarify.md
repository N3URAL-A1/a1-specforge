# Phase 3 — Clarify

**Goal:** Resolve every blocking `[NEEDS CLARIFICATION]` marker AND proactively surface hidden
scope assumptions that would otherwise cause rework during implementation.

**Sub-agent:** Rene (`~/.claude/agents/rene-requirement-engineer.md`).
**Model: `claude-opus-4-7`** — Clarify is the highest-leverage phase: wrong decisions here
cascade into multiple fix cycles. Use Opus for deeper reasoning.

**Status transition:** `draft` → `clarified`.

## Precondition

Spec exists with status `draft`. Run even if no `[NEEDS CLARIFICATION]` markers exist —
the proactive scope scan (Step 1) always runs.

## Step 1 — Enumerate markers + proactive scope scan

```bash
grep -n "\[NEEDS CLARIFICATION" <spec-path>
```

Then read the full spec and identify implicit scope gaps in these categories. Each gap
gets added to the question queue alongside the explicit markers:

| Category | What to look for |
|---|---|
| **UI: elements in/out** | Does the feature touch an existing screen? Which existing columns/buttons/links stay, which go? |
| **Navigation & routing** | How does the user reach the new screen? Where do they go after saving/completing an action? |
| **State after action** | After save/delete/submit — same page, redirect, toast, modal close? |
| **Empty & error states** | What does the user see when there's no data? When an API fails? |
| **Permissions / roles** | All tenant users, owner only, superadmin only? |
| **Mobile vs Desktop** | Does the spec mention responsive behavior? Is mobile parity required? |
| **Out of scope gaps** | Is there anything users will *expect* to work that is not explicitly excluded? |
| **Data / existing records** | Does the feature change existing data? What happens to records created before the feature exists? |

Add any discovered gaps as `[NEEDS CLARIFICATION: <question>]` inline in the spec before
spawning Rene, so Rene has a complete list in one pass.

## Step 2 — Spawn Rene with the Clarify brief (model: claude-opus-4-7)

Use the **Agent** tool with `subagent_type: "rene-requirement-engineer"` and
`model: "opus"` to spawn Rene with this brief:

> Du bist Rene. Die Spec in `<spec-path>` hat N offene `[NEEDS CLARIFICATION]`-Marker —
> sowohl die vom Specify-Schritt als auch frisch identifizierte Scope-Lücken.
> Dein Auftrag: jeden Marker klären. **Maximal 2 Fragen pro Turn**, auf **Deutsch**.
>
> **Vorgehen pro Marker:**
>
> 1. Lies die Stelle inkl. Kontext (Story, FR, SC, Edge Case, Scope-Gap-Kategorie).
> 2. Stelle dem User die konkrete Frage. Biete wo sinnvoll 2–3 Optionen mit einer klaren
>    Empfehlung an (1 Satz Begründung reicht). Faustregel: wenn die Antwort die
>    Implementation signifikant verändert → fragen; wenn es eine vernünftige Default-Wahl
>    gibt und Robert damit zufrieden wäre → empfehlen und nur bestätigen lassen.
> 3. Sobald die Antwort da ist:
>    - Ersetze den Marker durch den konkreten Wert/die Entscheidung.
>    - Hänge unter `## Clarifications` an:
>      ```
>      - **YYYY-MM-DD** — <Kategorie>: <Entscheidung>. Reason: <1-Satz>.
>      ```
> 4. Nächster Marker.
>
> **Scope-Gap-Fragen** (Kategorie-Tags in den Markern): Priorisiere diese zusätzlich nach
> Rework-Risiko. Ein falscher Annahme bei "Navigation after save" kostet 2 Fixes; ein
> falscher Default bei "Mobile" kostet 0 wenn wir Desktop-first bauen. Dementsprechend
> priorisieren.
>
> **Hard rules:**
> - Keine Marker ungefragt überschreiben.
> - Wenn beim Klären eine neue Ambiguität entsteht: sofort als Marker hinzufügen und
>   in dieser Session klären — kein Defer auf später.
> - Wenn der User "mach einfach" sagt: dokumentiere den gewählten Default als
>   Clarification-Eintrag mit "Default adopted:" und schließe den Marker.
> - Phase 3 endet erst wenn ALLE Marker weg sind (0 verbleibende).
>
> Wenn fertig: melde "Clarify komplett. N Klärungen gespeichert. Spec ist
> implementation-ready." und liste die Entscheidungen kurz auf.

## Step 2b — UX Mockups (frontend features only)

**Skip this step if** the feature has no user-facing UI (pure API, background job, migration, etc.).

**Trigger:** feature spec mentions screens, pages, components, modals, forms, tables, or UI state changes.

### 2b-1 — Identify screens

Read the (now clarified) spec and list every screen that is **new** or **significantly changed**:

```
Screen 1: <name> — <what it shows / what user does here>
Screen 2: …
```

### 2b-2 — Determine design system skill

Check target project CLAUDE.md. Use the mapping from SKILL.md → `Design-System Skill per Project`.
For n3ural-platform: skill is `n3urala1-design` (`~/.claude/skills/n3urala1-design`).

### 2b-3 — Spawn Uwe

Use the **Agent** tool with `subagent_type: "uwe-ux-expert"` and this brief:

> Du bist Uwe. Wir sind in Phase 3 (Clarify) des a1-new-feature Flows für das Feature
> `<feature-name>`.
>
> **Dein Auftrag:** Baue für jeden der folgenden Screens **mindestens 2–3 Mockup-Varianten**
> (ASCII-Wireframe-Stil, klar beschriftet) und präsentiere sie Robert zur Abnahme.
>
> **Screens:**
> <list from 2b-1>
>
> **Design System:** Projekt `<project-name>`. Lade den Skill `<design-system-skill>` und
> halte alle Mockups konsequent darin: Farbpalette, Spacing-System, Typografie, Komponenten-
> Namen (Buttons, Badges, Cards, Tables, Modals) exakt so wie im Design System definiert.
>
> **Vorgehen pro Screen:**
> 1. Baue 2–3 Varianten (unterschiedliche Layouts / Interaktionsmuster — nicht nur kosmetische
>    Unterschiede). Jede Variante bekommt einen Namen und eine 1-Satz-Begründung.
> 2. Empfiehl eine Variante mit max. 2 Sätzen Begründung.
> 3. Präsentiere Robert die Varianten und bitte um Auswahl oder Feedback.
> 4. Nach Auswahl: dokumentiere die Entscheidung als `UX Decision` (Format unten).
>
> **Format UX Decision:**
> ```
> - **YYYY-MM-DD** — UX/<screen-name>: Variante <X> gewählt. Reason: <1-Satz>.
> ```
> Hänge alle UX Decisions unter `## Clarifications` in der Spec an:
> `<spec-path>`
>
> **Hard rules:**
> - Keine Variante ohne Design-System-Konformität präsentieren.
> - Wenn Robert "mach einfach" sagt: empfohlene Variante nehmen, als "Default adopted:" dokumentieren.
> - Wenn Robert eine eigene Idee einbringt: als Variante 0 aufnehmen und mit den anderen vergleichen.
> - Wenn der Screen responsiv sein muss: je Variante Desktop + Mobile zeigen.
>
> Wenn alle Screens abgenommen sind: melde "UX Mockups abgenommen. N Screens, N Entscheidungen
> gespeichert." und liste die gewählten Varianten kurz auf.

### 2b-4 — Verify UX decisions written

After Uwe finishes:

```bash
grep -c "UX/" <spec-path>
```

Must return ≥ 1 per screen identified in 2b-1.

## Step 3 — Verify all markers resolved

```bash
grep -c "\[NEEDS CLARIFICATION" <spec-path>
```

Must return `0` before proceeding. If not, repeat Step 2.

## Step 4 — Status update

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> clarified
```

Helper appends `phase: specify, completed: <iso>` and `phase: clarify, completed: <iso>` to
`phase_history` if not already present.

## Hand-off to Phase 4

Tell user (German): "Spec ist clarified. Soll Vincente jetzt den Wave-Plan bauen (Phase 4)?"

On yes: load `workflows/04-plan.md`.
On hold: stop. The spec sits at status `clarified` and can be picked up later without rework.
