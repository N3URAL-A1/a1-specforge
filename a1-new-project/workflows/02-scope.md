# Phase 2: Scope-Interview — THE CRITICAL STEP

Set the initial project scope **clearly and unambiguously** BEFORE anything is
decomposed. An unclear scope poisons the roadmap, the feature split, and every
feature loop iteration. Spend one or two extra clarification rounds rather than
guess. Do NOT proceed to Phase 3 until the scope is confirmed in writing.

## How to run the interview

One topic per turn. Use the `AskUserQuestion` tool for the structured decisions
(it gives the user clean options and an "other" escape). Free-text follow-ups
are fine for the vision sentence and non-goals. All user-facing text in German.

Cover, at minimum, all six areas below.

### 1. Project goal / vision (one sentence)

Free text. Push for ONE crisp sentence: "Was ist das Projekt in einem Satz?"
If the answer is two paragraphs, reflect it back compressed and confirm.

### 2. Target users

Free text or AskUserQuestion if there are obvious segments.
"Wer ist der primäre Nutzer und was ist sein Kernproblem?"

### 3. Core capabilities — MVP scope vs. Later

Use `AskUserQuestion` (multi-select where supported). List candidate
capabilities, let the user mark each as **MVP** or **Später**. This split is the
seed of the feature backlog in Phase 4 — get it right here.
"Welche Kern-Fähigkeiten gehören in die erste nutzbare Version (MVP), welche
kommen später?"

### 4. Tech-stack preferences / constraints

Use `AskUserQuestion` with the common stacks the user works in (Next.js/Node,
Flutter/Dart, Python/FastAPI) plus "ich empfehle einen". Capture hard
constraints (existing systems to integrate, off-limits tech, hosting).

### 5. Explicit non-goals

Free text. "Was bauen wir bewusst NICHT?" This is as important as the goal —
non-goals stop scope creep in the feature loop. Write them down verbatim.

### 6. Success criterion

Free text. "Woran erkennen wir, dass die erste Version erfolgreich ist?" Push
for something observable / measurable, not a feeling.

## Confirm before writing

Reflect the full scope back and get an explicit yes:

```
Hier ist der Scope, wie ich ihn verstanden habe:

**Vision:** <one sentence>
**Nutzer:** <user + core problem>
**MVP-Capabilities:** <bullet list>
**Später:** <bullet list>
**Stack:** <stack + constraints>
**Non-Goals:** <bullet list>
**Erfolgskriterium:** <measurable>

Stimmt das so? Soll ich noch was schärfen, bevor wir die Roadmap planen?
```

If the user corrects anything: update and re-confirm. Only when the user
confirms, write the file.

## Write `.a1/scope.md`

```markdown
---
type: project-scope
project: <slug>
created: <YYYY-MM-DD>
status: confirmed
---

# Scope: <project name>

## Vision
<one sentence>

## Target Users
<user + core problem>

## MVP Capabilities
- <capability>
- <capability>

## Later (out of MVP)
- <capability>

## Tech Stack
<stack + constraints>

## Non-Goals
- <non-goal>

## Success Criterion
<measurable outcome>
```

Also mirror the scope into the Vault project hub (created/extended in Phase 4):
hold it in context now; Phase 4 writes `projects/<slug>/` and can embed the
scope summary there.

## Output

A confirmed `.a1/scope.md`. Pass the in-context scope summary forward to
**Phase 3 (Roadmap)** so a1-roadmap does not re-interview the user from zero.
