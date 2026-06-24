# Phase 3: Roadmap (delegates to a1-roadmap)

Turn the confirmed scope into milestones, phases, and a `.a1/` phase scaffold by
invoking the **a1-roadmap** skill internally. Do not re-implement roadmap logic
here — reuse it.

## Hand the scope in (no re-interview)

`a1-roadmap`'s Phase 1 (Discover) is a vision interview. We already did a deeper
Scope-Interview in Phase 2, so feed the scope forward and tell a1-roadmap to
**skip its own discovery** and start from the confirmed scope:

```
Invoke a1-roadmap in new-project mode with this pre-confirmed scope
(from .a1/scope.md) as its Discover output — do NOT re-interview the user:

  Product: <name>
  Vision: <one sentence>
  Users: <user + core problem>
  Stack: <stack + constraints>
  MVP: <MVP capabilities>
  Non-Goals: <non-goals>
  Success: <success criterion>

Proceed to a1-roadmap Research → Structure → Scaffold.
```

Read the scope from `.a1/scope.md` to build that brief, so this phase is correct
even on re-entry after a context reset.

## What a1-roadmap produces

- `.a1/roadmap.md` — milestones + phases (format owned by a1-roadmap)
- `.a1/phases/M<N>-P<N>-<name>/GOAL.md` — one per phase

a1-roadmap confirms the milestone/phase breakdown with the user before
scaffolding. That confirmation stands in for ours — do not double-confirm the
same breakdown.

## Stack write-back

If the stack was undecided in Phase 1 and a1-roadmap's research settled it:
- Fill the remaining `{{STACK}}` / `{{STATUS}}` placeholders in `CLAUDE.md`.
- Append the stack-specific `.claudeignore` block (still never overwriting; only
  appending the missing patterns).

## Guard: roadmap hand-off

If a1-roadmap finishes but `.a1/roadmap.md` does not exist or has no milestones,
the hand-off failed. Do NOT proceed to Phase 4 on an empty roadmap — surface it
to the user and tag the retro with `roadmap_handoff_failed`.

## Output

A populated `.a1/roadmap.md` plus phase dirs. Proceed to **Phase 4
(Feature-Split)**.
