# Phase 5 — Implement

**Goal:** Walk through the Wave-Plan one wave at a time. For each wave, propose the code
agent(s) and brief, wait for user confirmation, then dispatch. Track wave completion.

**Sub-agents:** Code agents per wave (Walter / Bernd / Aik / Felix / Alex / project-specific).
The skill **proposes**; the user **dispatches**.

**Status transition:** `planned` → `implementing` (on first wave start) → stays `implementing`
until Phase 6 closes it.

## Agent Routing

Before suggesting agents per wave, read the target project's CLAUDE.md (or CLAUDE.md in the project root).
Look for an "Agent Workflow" or agent table section. Project-specific agents take precedence over defaults.
Default fallbacks (if no project CLAUDE.md found): Walter (web/backend), Bernd (Cloud Functions), Aik (AI/ML), Felix (Flutter), Alex (architecture).

## Precondition

Spec status is `planned` and frontmatter `wave_plan_path` is set. Wave-plan file exists.

## Step 1 — Set status to implementing (first time only)

If status is still `planned`:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> implementing
```

## Step 2 — Read the wave-plan and pick the next wave

Read `<plan-path>`. Identify the next wave whose dependencies are satisfied (all earlier
waves marked complete in the plan, or "none"). If multiple waves are unblocked **and**
marked `Parallelizable: ja`, you may propose them as a parallel batch.

Track wave completion **inline in the wave-plan file** by appending a status line to each
wave heading after dispatch:

```markdown
## Wave N — <title>  ⟶ status: in-progress / done / failed
```

## Step 3 — Propose the agent(s) to the user

For the next wave, present (in German):

> "**Wave N — <Titel>**
>
> Goal: <goal>
> FRs: <list>
> Brief: <kurz zusammengefasst>
>
> Vorschlag: **<agent-name>** für <Sub-Aufgabe>.
>
> Soll ich den Agent so dispatchen, oder willst du einen anderen?"

Wait for user confirmation. Do **not** dispatch automatically.

## Step 4 — Dispatch

Once the user confirms (or names a different agent), spawn the agent via the Task tool with
this brief:

> Du bist <agent-name>. Du arbeitest an Wave N aus dem Wave-Plan unter `<plan-path>`.
> Die zugehörige Spec liegt unter `<spec-path>` (READ-ONLY für dich — keine Spec-Änderungen
> ohne Rückfrage).
>
> Dein Auftrag steht im Wave-Brief unter `## Wave N`. Implementiere strikt nach Brief.
> Wenn du beim Bauen merkst, dass die Spec wackelt: stoppe, melde dich, schlage eine
> Spec-Anpassung vor — der User entscheidet, ob die Spec ergänzt wird (das löst
> potentiell Phase 3/Phase 4-Rework aus).
>
> File-Ownership: <aus Wave-Brief>.
> Tests: schreibe oder ergänze die Tests, die zu den FR-### dieser Wave passen.
>
> Wenn fertig: melde "Wave N done. <kurze Zusammenfassung der Änderungen>."

If the wave is parallelizable and the user wants both agents at once, dispatch them in a
**single** assistant turn (parallel Task calls).

## Step 5 — Nach Agent-Meldung: Build + Deploy + Smoke-Test (Pflicht)

Wenn der Agent "Wave N done" meldet, NICHT sofort als `done` markieren.
Erst diese drei Gates durchlaufen:

**Gate 1 — Build**

Führe den projektspezifischen Build-Command aus (steht in CLAUDE.md, z.B. `npm run build`).
Bei Build-Fehler: Wave bleibt `in-progress`, Agent repariert. Kein Weiter.

**Gate 2 — Preview-Deploy**

```bash
vercel   # erzeugt Preview-URL
```

Notiere die Preview-URL für Gate 3 und für Phase 6. Kein Skip auch wenn "nur ein kleiner Fix".

**Gate 3 — Smoke-Test der Wave-Goal-Story**

Der Wave-Brief enthält `**Goal:** nach dieser Wave funktioniert X`. Teste genau dieses X
gegen die Preview-URL — manuell oder via Playwright. Konkret:

- Wenn die Wave eine neue UI-Route liefert: öffne sie, prüfe ob sie lädt (kein 404/500).
- Wenn die Wave eine API-Route liefert: sende einen echten Request (curl oder Browser-DevTools),
  prüfe den Response-Body und HTTP-Status-Code.
- Wenn die Wave einen Client + API kombiniert: führe den kompletten User-Flow einmal durch
  (klicken, absenden, Ergebnis sehen).

Bei Smoke-Test-Fehler: Wave `failed`, nicht `done`. Weiter mit dem Failure-Flow unten.

**Erst nach grünen Gates:**

Update the wave heading in the wave-plan file: `⟶ status: done`.
Loop to Step 2 for the next wave.

---

If a wave fails (agent reports blockers, tests stay red, Smoke-Test schlägt fehl):

1. Mark the wave `⟶ status: failed`.
2. Ask user: "Wave N failed — wollen wir den Brief anpassen, oder die Spec öffnen
   (zurück zu Phase 3)?"
3. Do not advance the spec status.

## Step 5b — E2E-Test vor letzter Wave-Freigabe (Pflicht)

Wenn alle Waves außer der aktuellen `done` sind (d.h. dies ist die letzte Wave):

Vor dem Übergang zu Phase 6 spawne den projektspezifischen QA-Agent (aus CLAUDE.md Agents-
Tabelle, z.B. `n3ural-qa`) oder Playwright-fähigen Agent mit folgendem Brief:

> "Schreibe einen Playwright-Test für den Golden Path der Spec unter `<spec-path>`.
> Der Test soll den vollständigen Happy Path der P1-User-Stories abdecken:
> <P1-Stories aus Spec, 3–5 Schritte pro Story>.
> Laufe gegen die Preview-URL `<preview-url>` (Auth-State falls nötig aus `.playwright/`).
> Der Test muss grün sein, bevor Phase 6 starten kann.
> Lege den Test unter `tests/e2e/<feature-slug>.spec.ts` ab."

Phase 6 startet erst wenn dieser E2E-Test grün läuft.
Wenn kein Playwright vorhanden ist: dokumentiere das explizit und eskaliere an Robert.

## Step 6 — All waves done?

When every wave in the plan is marked `done`:

- Tell the user (German): "Alle Waves abgeschlossen. Phase 6 (Verify) starten?"
- On yes: load `workflows/06-verify.md`. Status stays `implementing` until Verify passes.
- Do **not** set status to `done` here — that is Phase 6's job.

## Spec-drift guard

If at any point during a wave the user requests a change to the spec (new FR, changed AC):

1. Stop the current wave dispatch.
2. Run `update-status <spec-path> draft` to reopen the spec.
3. Return to Phase 2 or Phase 3 as appropriate.
4. After the spec is `clarified` again, re-evaluate the wave-plan with Vincente.

This is friction by design — silent spec drift is the most common cause of broken Phase 6
verifies.
