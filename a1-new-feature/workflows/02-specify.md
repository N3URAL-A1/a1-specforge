# Phase 2 — Specify

**Goal:** Convert the Discovery bullets into a formal Spec-Kit-compatible spec — User Stories
(P1/P2/P3), Functional Requirements (FR-###), Success Criteria (SC-###), Acceptance Scenarios,
Edge Cases, Review Checklist. Mark anything ambiguous with `[NEEDS CLARIFICATION]`.

**Sub-agent:** Rene (`~/.claude/agents/rene-requirement-engineer.md`).

**Status transition:** `discovering` → `draft`.

## Precondition

The spec file exists with status `discovering` and all ten Discovery sections filled. If not,
return to Phase 1.

## Step 1 — Spawn Rene with the Specify brief

Use the Task tool to spawn `rene-requirement-engineer` with this brief:

> Du bist Rene. Phase 1 (Discovery) ist abgeschlossen, die Antworten stehen in
> `<spec-path>` unter den `## Discovery —`-Headern. Dein Auftrag: schreibe eine vollständige
> Spec im Spec-Kit-Format **direkt in die selbe Datei**, unterhalb der Discovery-Sektionen.
>
> Die Spec MUSS folgende Abschnitte haben (auf Englisch, der Output ist ein technisches
> Artefakt):
>
> 1. **Overview** — 2–4 Sätze, was das Feature ist und warum.
> 2. **User Stories** — gegliedert nach Priorität:
>    - `### P1 (Must-have)` — mindestens eine Story.
>    - `### P2 (Should-have)` — optional.
>    - `### P3 (Nice-to-have)` — optional.
>    Jede Story als `**As a** [role], **I want** [action], **So that** [outcome].`
>    plus Story-ID `US-<###>-N` (### = Spec-Sequenznummer aus Frontmatter).
> 3. **Functional Requirements** — FR-### (zero-padded to 3 digits), je eine binäre,
>    testbare Aussage. Aim 5–20 FRs.
> 4. **Success Criteria** — SC-### messbar, ergebnis-orientiert (nicht "Code geschrieben"
>    sondern "User kann X in <2s tun"). Aim 3–8 SCs.
> 5. **Acceptance Scenarios** — pro User Story mindestens ein Szenario im
>    Given/When/Then-Format. Diese sind später die Verify-Checkliste in Phase 6.
> 6. **Edge Cases** — Bullet-Liste der bekannten Sonderfälle aus Discovery, plus weitere
>    die dir während des Schreibens auffallen.
> 7. **Out of Scope** — Bullet-Liste, was NICHT enthalten ist.
> 8. **Dependencies** — andere Features, APIs, Migrations, ADRs.
> 9. **Clarifications** — anfangs leer; wird in Phase 3 gefüllt.
> 10. **Review Checklist** — Standard-Liste:
>     - [ ] All P1 stories have at least one Acceptance Scenario
>     - [ ] All FRs are binary and testable
>     - [ ] All SCs are measurable
>     - [ ] No `[NEEDS CLARIFICATION]` markers remain
>     - [ ] Out of Scope is non-empty (be explicit, not implicit)
>     - [ ] Dependencies are listed or explicitly "none"
>
> **Wichtige Regel:** Wenn dir beim Schreiben etwas unklar ist (Zahlenwerte, Schwellen,
> Geschäftsregeln, exakte Fehlermeldungen), markiere die Stelle inline mit
> `[NEEDS CLARIFICATION: <konkrete Frage>]`. Erfinde keine Werte. Phase 3 (Clarify)
> wird die Marker auflösen.
>
> Schreibe nicht über die Discovery-Sektionen — diese bleiben als Trail erhalten. Hänge die
> Spec-Sektionen darunter an.
>
> Wenn fertig: melde "Spec-Draft fertig, N FRs, N SCs, N offene Clarifications."

## Step 2 — Status update

After Rene reports completion:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> draft
```

The helper appends `phase: discover, completed: <iso-timestamp>` to `phase_history`.

## Step 3 — Quick sanity scan

Read the spec file. Confirm:

- Every P1 story has at least one Acceptance Scenario.
- FR-### and SC-### are zero-padded and contiguous (FR-001, FR-002, …).
- The Review Checklist is present (boxes unchecked is fine at this stage).

If anything is missing, ask Rene to fix it before proceeding.

## Hand-off to Phase 3

Count `[NEEDS CLARIFICATION]` markers in the file:

```bash
grep -c "\[NEEDS CLARIFICATION" <spec-path>
```

- If **>0**: tell user (German) "Spec-Draft steht, N offene Punkte. Soll ich Phase 3
  (Clarify) starten?" → `workflows/03-clarify.md`
- If **0**: skip Phase 3, ask "Spec ist sauber. Direkt zu Phase 4 (Plan)?" — when confirmed,
  update status to `clarified` and load `workflows/04-plan.md`.
