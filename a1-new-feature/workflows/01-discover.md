# Phase 1 — Discover

**Goal:** Capture the raw feature idea via a structured interview. Produce a `discovering`-status
spec file with bullet-point answers to ten mandatory topics. No formal spec yet.

**Sub-agent:** Rene (`~/.claude/agents/rene-requirement-engineer.md`).

**Status transition:** (none yet) → `discovering`.

## Step 1 — Identify project + feature slug

Ask the user (in German) which project this feature belongs to and a short kebab-case slug
for the feature. Example: project `niimo`, slug `meal-swap-history`.

If the project has no `projects/<slug>/spec/` directory yet, create it via the helper before
the next step.

## Step 2 — Create spec file from template

```bash
# Get next sequence number for the project
node ~/.claude/skills/_shared/a1-tools.cjs spec next-number <project-slug>
```

Then `Read` the template `~/.claude/skills/a1-new-feature/templates/spec-template.md`, fill in:

- `id`: `<###>-<feature-slug>` (use the number returned by the helper)
- `project`: `<project-slug>`
- `feature_slug`: `<feature-slug>`
- `status: discovering`
- `created`: today's date (YYYY-MM-DD)
- Title: working title from the user

Write to `projects/<project-slug>/spec/<###>-<feature-slug>.md` (relative to vault root).

## Step 3 — Spawn Rene with the Discovery brief

Use the Task tool to spawn the `rene-requirement-engineer` agent with this brief:

> Du bist Rene und führst die Discovery für eine neue Feature-Idee. Dein Auftrag: ein
> strukturiertes Interview durchführen, **eine Frage pro Turn**, in **Deutsch**. Du musst
> die folgenden zehn Pflicht-Themen abdecken, in dieser Reihenfolge:
>
> 1. Problem — Was ist das Problem, das gelöst werden soll?
> 2. Primary User — Wer ist die Hauptpersona, die davon profitiert?
> 3. User Journey — Wie sieht der idealtypische Ablauf aus?
> 4. Akzeptanzkriterien — Woran erkennt der User, dass es funktioniert?
> 5. Erfolgsmetriken — Wie messen wir Erfolg? (quantitativ wenn möglich)
> 6. Out of Scope — Was gehört explizit NICHT dazu?
> 7. Edge Cases — Welche Sonderfälle musst du jetzt schon im Kopf haben?
> 8. Compliance — Datenschutz, Recht, Branchenregeln, Allergen-Safety, etc.?
> 9. Dependencies — Hängt das Feature von anderen Features, APIs, Daten ab?
> 10. Priorität — Wie dringlich? Welche User Story ist P1, welche P2/P3?
>
> Eine Frage pro Turn. Wenn die Antwort vage ist, präzisiere mit einer Folgefrage, bevor du
> zum nächsten Thema springst. Halte deine Sprache knapp und lass den User reden.
>
> Nach jedem User-Turn: hänge die Antwort als Bullet unter den passenden `## Discovery —
> <Thema>`-Header in der Spec-Datei an. Kein Schönschreiben jetzt — Rohnotizen reichen.
> Wenn alle zehn Themen durch sind, melde "Discovery komplett. Bereit für Phase 2 (Specify)?"

Rene appends to the spec file directly while the interview runs.

## Step 4 — Confirm completion

When Rene reports "Discovery komplett":

1. Verify all ten Discovery sections in the spec have at least one bullet.
2. Ask the user (German): "Discovery sieht so aus — passt das, oder fehlt was Wichtiges?"
3. On confirmation, do **not** advance status yet. Phase 2 (Specify) updates status to `draft`
   when Rene writes the formal spec.

## Hand-off to Phase 2

Tell the user (German): "Phase 1 abgeschlossen. Soll ich jetzt Rene die formale Spec
schreiben lassen (Phase 2)?"

If yes: load `workflows/02-specify.md`.
If the user wants to abandon the idea: run
`a1-tools spec update-status <spec-path> cancelled`.
