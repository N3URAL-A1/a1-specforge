# Phase 4 — Plan

**Goal:** Convert the clarified spec into a Wave-Plan (sequenced, parallelizable implementation
units with explicit code-agent assignments and dependencies).

**Sub-agent:** Vincente (`vincente-vibe-optimizer`).

**Status transition:** `clarified` → `planned`.

## Precondition

Spec status is `clarified` and contains zero `[NEEDS CLARIFICATION]` markers. If not, return
to Phase 3.

## Step 1 — Determine wave-plan path

```
plan_path = projects/<project-slug>/plans/<###>-<feature-slug>-wave-plan.md
```

`<###>` is the same sequence number as the spec. If `projects/<slug>/plans/` does not exist,
create it (use Bash with the absolute vault root).

## Step 2 — Spawn Vincente with the Plan brief (model: claude-opus-4-7)

Use the **Agent** tool with `subagent_type: "vincente-vibe-optimizer"` and
`model: "opus"` to spawn Vincente with this brief:

> Du bist Vincente. Die Spec liegt unter `<spec-path>` mit Status `clarified`. Dein Auftrag:
> einen Wave-Plan bauen und unter `<plan-path>` speichern.
>
> **Pflicht-Inputs aus der Spec:**
> - User Stories (P1/P2/P3) → Wave-Reihenfolge orientiert sich an Priorität.
> - FR-### → werden auf Waves verteilt, jeder FR landet in genau einer Wave.
> - SC-### → bleibt für Phase 6, du nimmst sie nur als Fitness-Check pro Wave.
> - Dependencies → bestimmen die Reihenfolge.
>
> **Wave-Plan-Struktur (Markdown mit YAML-Frontmatter):**
>
> ```yaml
> ---
> spec_path: <spec-path>
> spec_id: <###>-<feature-slug>
> project: <project-slug>
> created: YYYY-MM-DD
> waves: <count>
> ---
> ```
>
> Pro Wave:
>
> ```markdown
> ## Wave N — <kurzer Titel>
>
> **Goal:** <1 Satz, was nach dieser Wave funktioniert>
> **Depends on:** Wave M (oder "none")
> **Parallelizable:** ja/nein (mehrere Code-Agents in dieser Wave?)
> **FRs covered:** FR-001, FR-002, …
> **Stories advanced:** US-<###>-1, …
>
> ### Brief für Code-Agents
>
> <Konkreter Auftrag, File-Ownership-Hinweise (lib/ vs functions/src/),
> erwartetes Test-Verhalten, Acceptance-Bezug>
>
> ### Suggested agent(s)
>
> - **<agent-name>** für <konkrete Sub-Aufgabe in dieser Wave>
> ```
>
> **Code-Agent-Vorschläge:**
> - Frontend / Web: Walter
> - Backend / API / Cloud Functions: Bernd (Niimo) oder Walter (generisch)
> - AI/ML/RAG/LLM: Aik
> - Flutter Mobile: Felix (oder projekt-spezifisch flutter-toni)
> - System-Design / ADRs (vor einer Wave nötig?): Alex
>
> Du **schlägst** die Agents vor; der User dispatched in Phase 5 selbst.
>
> **HTTP-Contract-Pflicht (für jede Wave die API + Client kombiniert):**
> Wenn eine Wave sowohl eine API-Route als auch einen Client (React-Component, fetch-Call,
> Link-href) liefert, muss der Wave-Brief explizit festhalten:
> - HTTP-Methode: muss im Route-Handler-Export (`export async function DELETE`) UND im
>   Client-fetch-Call (`method: "DELETE"`) identisch sein — nie implizit lassen.
> - Response-Shape: welche Keys gibt die Route zurück, welche liest der Client?
>   (z.B. `{ expenses: [...] }` nicht `{ data: [...] }`)
> - URL-Pattern: bei `<Link href=...>` relative vs. absolute Pfade explizit angeben.
>   Relative hrefs aus einer Listenseite (`ausgaben/`) verdoppeln das Segment —
>   korrekt ist `${id}/` nicht `ausgaben/${id}/`.
>
> **Hard rules:**
> - Jeder FR muss in genau einer Wave landen.
> - Keine Wave ohne expliziten Acceptance-Bezug.
> - Wenn eine Wave > 5 FRs trägt: in zwei Waves splitten.
> - Wenn unklar bleibt, welcher Agent passt: vorschlagen mit Kommentar `(unsicher: …)`.
>
> Wenn fertig: melde "Wave-Plan fertig: N Waves, M FRs verteilt, K parallelisierbar."

## Step 3 — Update spec frontmatter

After Vincente reports completion, link the wave-plan back into the spec:

```bash
node ~/.claude/skills/_shared/a1-tools.cjs spec update-status \
  <spec-path> planned --wave-plan-path "<plan-path>"
```

Helper sets `wave_plan_path` and appends `phase: plan, completed: <iso>` to `phase_history`.

## Step 4 — Sanity check

Read the wave-plan. Verify:

- Every FR from the spec appears in exactly one Wave (`grep -c "FR-"` on the plan should
  equal the FR count in the spec; if not, ask Vincente to reconcile).
- Every Wave has `Suggested agent(s)`.
- Dependencies form a DAG (no cycles, no Wave that depends on a later Wave).

## Hand-off to Phase 5

Tell the user (German):

> "Wave-Plan steht: N Waves, vorgeschlagene Agents pro Wave sind drin. Soll ich Phase 5
> (Implement) starten? Wir gehen Wave für Wave durch — du bestätigst den Agent vor jedem
> Dispatch."

On yes: load `workflows/05-implement.md`.
