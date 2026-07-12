# Phase 2: Scope-Interview — THE CRITICAL STEP

Set the initial project scope **clearly and unambiguously** BEFORE anything is
decomposed. An unclear scope poisons the roadmap, the feature split, and every
feature loop iteration. Spend one or two extra clarification rounds rather than
guess. Do NOT proceed to Phase 3 until the scope is confirmed in writing.

## How to run the interview

One topic per turn. Use the `AskUserQuestion` tool for the structured decisions
(it gives the user clean options and an "other" escape). Free-text follow-ups
are fine for the vision sentence and non-goals. User-facing output language: see
`_shared/language-policy.md` (artifacts English, conversation in the user's language).

Cover, at minimum, all six areas below.

### 1. Project goal / vision (one sentence)

Free text. Push for ONE crisp sentence: "What is the project in one sentence?"
If the answer is two paragraphs, reflect it back compressed and confirm.

### 2. Target users

Free text or AskUserQuestion if there are obvious segments.
"Who is the primary user and what is their core problem?"

### 3. Core capabilities — MVP scope vs. Later

Use `AskUserQuestion` (multi-select where supported). List candidate
capabilities, let the user mark each as **MVP** or **Later**. This split is the
seed of the feature backlog in Phase 4 — get it right here.
"Which core capabilities belong in the first usable version (MVP), and which
come later?"

### 4. Tech-stack preferences / constraints

Use `AskUserQuestion` with the common stacks the user works in (Next.js/Node,
Flutter/Dart, Python/FastAPI) plus "let me recommend one". Capture hard
constraints (existing systems to integrate, off-limits tech, hosting).

### 5. Explicit non-goals

Free text. "What are we deliberately NOT building?" This is as important as the goal —
non-goals stop scope creep in the feature loop. Write them down verbatim.

### 6. Success criterion

Free text. "How will we know the first version is successful?" Push
for something observable / measurable, not a feeling.

## Confirm before writing

Reflect the full scope back and get an explicit yes:

```
Here is the scope as I understood it:

**Vision:** <one sentence>
**Users:** <user + core problem>
**MVP capabilities:** <bullet list>
**Later:** <bullet list>
**Stack:** <stack + constraints>
**Non-goals:** <bullet list>
**Success criterion:** <measurable>

Is this correct? Should I sharpen anything before we plan the roadmap?
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
