# Phase 1: Discover

Interview the user to understand the project or milestone vision.

## For new projects

Ask (one question at a time, conversational):

1. "What are we building? Give me the one-paragraph pitch."
2. "Who is the primary user and what's their core problem?"
3. "What tech stack are you planning? (or should I recommend one?)"
4. "What does 'done' look like for the first usable version?"
5. "Any hard constraints? (deadline, existing systems to integrate, off-limits tech)"

After 5 answers: summarize and confirm.

```
Got it. Here's what I understand:

**Product:** <name>
**User:** <user type>
**Problem:** <problem>
**Stack:** <stack>
**MVP:** <MVP definition>
**Constraints:** <constraints>

Is this right? Any corrections before I plan milestones?
```

### Vision narrative + pillars (feeds `docs/product/VISION.md`)

Once the pitch/user/problem/MVP answers above are confirmed, distill them into
a machine-readable vision the Scaffold phase can hand to `product
vision-init` (schema v1.1). Keep it to two follow-up questions, same
one-at-a-time, conversational style as above — this is a natural extension
of the pitch just confirmed, not a separate interview:

6. "In one sentence, what's the mission — why does this product need to
   exist?" (this becomes the VISION.md mission statement / `--title`)
7. "What are the 2-4 pillars this product stands on? For each: a short title
   and a one-sentence summary." (e.g. "Speed — every action completes in
   under 200ms")

Summarize and confirm alongside the rest:

```
**Mission:** <one-sentence mission statement>
**Pillars:**
  1. <pillar title> — <one-sentence summary>
  2. <pillar title> — <one-sentence summary>
  [3-4 as given]

Sound right?
```

`pillars[]` MUST be non-empty per schema v1.1 (`docs/product/SCHEMA.md`) — if
the user gives fewer than 2, confirm at least 1 is captured before moving on;
do not proceed to Phase 2 with zero pillars.

## For new milestones

If project already has `.a1/roadmap.md`:

1. Read existing roadmap
2. Ask: "What should Milestone <N+1> achieve? What's the business goal?"
3. Ask: "Any new constraints or tech decisions since the last milestone?"

## Output

A vision summary (not written to file yet — held in context for Phase 2), plus
the confirmed mission statement and pillars (not written to file yet — held
in context through Phase 4/Scaffold, which passes them to `product
vision-init`).

Proceed to Phase 2 only after user confirms the summary.
