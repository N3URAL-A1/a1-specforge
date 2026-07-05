# Phase 3: Propose

Generate concrete, targeted improvement proposals for each high-impact pattern.

## Proposal format

For each pattern above threshold, produce:

```
━━━ Proposal #1: missing_wiring ━━━━━━━━━━━━━━━━━━

Pattern: missing_wiring
Impact: 24 (8 occurrences, avg severity: major)
Confidence: HIGH (5+ occurrences)
File: agents/a1-pablo-planner.md

Problem:
a1-pablo-planner consistently misses "wire to router/index" as an explicit task when
creating API phases. Executor has to add it as an unplanned deviation every time.

Proposed change (diff):
--- agents/a1-pablo-planner.md
+++ agents/a1-pablo-planner.md
@@ ## Goal-backward decomposition @@
 3. **What must be WIRED** for those artifacts to function? (integrations, imports, configs)
+
+**Wiring checklist (always verify for API/backend phases):**
+- [ ] New endpoint registered in router/index
+- [ ] New service imported where called
+- [ ] New env vars documented in `.env.example`
+- [ ] DB model referenced in at least one service

Rationale:
These were missed in 8 of 8 API phase plans. Adding as explicit checklist prevents
the planner from omitting wiring tasks.
```

## Proposal rules

- **One proposal per pattern** — don't batch multiple patterns into one change
- **Minimal diff** — smallest change that fixes the problem
- **Explain the why** — rationale shows where the data came from
- **Never propose removing content** unless it's clearly wrong
- **Test mentally** — would this change have prevented the observed failures?
- **Check against the constitution** — every proposed diff is checked against the
  ten invariants in `docs/CONSTITUTION.md`. If a diff would introduce a violation
  (e.g. a second owner for a fact, a new learning store without a matching collect
  glob, a versioned model pin, an unregistered blocking gate), flag it in the
  proposal with the violated invariant number and surface it to the user rather than
  applying it silently.

## After all proposals

Present summary:
```
━━━ Evolution Proposals ━━━━━━━━━━━━━━━━━━

<N> improvements proposed based on <M> observations:

1. [HIGH] missing_wiring → a1-pablo-planner.md (8 occurrences)
2. [MED]  wave_ordering  → a1-pablo-planner.md (3 occurrences)

Proceed to review? [y to see diffs / n to cancel]
```
