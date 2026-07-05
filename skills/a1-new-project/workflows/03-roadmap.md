# Phase 3: Roadmap (delegates to a1-roadmap)

Turn the confirmed scope into milestones, phases, and a `.a1/` phase scaffold by
invoking the **a1-roadmap** skill internally. Do not re-implement roadmap logic
here — reuse it.

## Hand the scope in — START a1-roadmap AT RESEARCH, not Discover

**Critical: a1-roadmap has NO skip-discovery flag.** Its Phase 1 (Discover) asks
the same 5 vision questions we already asked — deeper — in Phase 2. If you invoke
a1-roadmap normally, it will re-interview the user. We must NOT let that happen.

So we do not run a1-roadmap's Discover. Instead, our confirmed `.a1/scope.md`
**IS** a1-roadmap's Discover output. Enter a1-roadmap at **Phase 2 (Research)**
with the scope already in hand:

```
Run the a1-roadmap pipeline starting at its Phase 2 (Research) — SKIP its
Phase 1 (Discover) entirely. The Discover output is already produced and
confirmed; use this verbatim as a1-roadmap's vision summary:

  Product: <name>
  Vision: <one sentence>
  Users: <user + core problem>
  Stack: <stack + constraints>
  MVP: <MVP capabilities>
  Non-Goals: <non-goals>
  Success: <success criterion>

Then continue a1-roadmap: Research (02) → Structure (03) → Scaffold (04).
```

Build that brief by reading `.a1/scope.md` (not from context), so Phase 3 is
correct even on re-entry after a context reset. If at any point a1-roadmap
starts asking the user the vision questions again, that is a bug in this
hand-off — stop, do not let the user be double-interviewed, and tag the retro
`roadmap_handoff_failed`.

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
