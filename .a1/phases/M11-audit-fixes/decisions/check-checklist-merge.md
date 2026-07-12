---
topic: a1-check ⊂ a1-checklist merge
task: 7.1
status: decided
decision: (a) merge with deprecated-alias transition — executed M12 Wave 3
decided: 2026-07-12 (Robert delegated via "setze die angesprochenen Punkte um")
executed: check #9 fr_coverage_bijective in checklist.cjs (reuses check.cjs primitives); a1-check SKILL.md = alias notice; 04.5 call site untouched per migration step 5
created: 2026-07-12
---

# Decision: merge `a1-check` into `a1-checklist`?

## Problem

`a1-check` runs 3 structural invariants (spec_path resolves, every spec FR-###
appears in exactly one wave, no plan FR-### is absent from spec).
`a1-checklist` runs 8 structural checks, one of which (spec status must be
`clarified`) sits directly adjacent to what `a1-check` verifies. Both are:

- thin, deterministic, no-LLM CLI wrappers
- pre-implementation gates with BLOCKER/MAJOR/MINOR-shaped or PASS/FAIL-shaped output
- invoked at almost the same point in the pipeline

`a1-check`'s own SKILL.md frontmatter already asserts the boundary explicitly
("Do NOT activate for: broader pre-flight readiness (→ a1-checklist, covers 8
structural+metadata checks)") and `a1-checklist`'s frontmatter asserts the
mirror ("Distinct from a1-check ... this is the broader readiness gate").
**Both skills already know about each other and have drawn a line.** Any
merge decision has to explicitly retire or rewrite those two description
paragraphs, not just merge the mechanics underneath them — otherwise the
frontmatter keeps advertising a boundary that no longer exists, which is the
exact class of drift this whole M11 phase exists to close.

## Live call-site inventory (verified 2026-07-12)

`a1-check` is invoked from exactly one production call site:
`skills/a1-new-feature/workflows/04.5-consistency-gate.md` (Phase 4.5, between
Plan and Implement — confirmed by grep across `skills/` and `agents/`; the
other hits — `a1-evolve/SKILL.md`, `a1-reconcile/SKILL.md`,
`a1-analyze/SKILL.md`, `a1-checklist/SKILL.md`, and 3 agent files — are all
either the frontmatter "distinct from" cross-reference or unrelated prose
matches on the word "check", not invocations).

`a1-check`'s CLI contract (`skills/a1-check/workflows/01-run-check.md`):
exit 0 = PASS, exit 1 = FAIL (content inconsistency), exit 2 = ERROR (missing
file / bad frontmatter). Consuming workflow branches on all three exit codes
distinctly (Step 3 — "Branch on exit code"). Any merge must preserve this
3-way exit-code contract for Phase 4.5's control flow, whether reimplemented
as `a1-checklist`'s check #9 or left standalone.

## Options

**(a) Merge `a1-check` into `a1-checklist` as check #9**, with its own
BLOCKER/MAJOR/MINOR severity mapping (FR-coverage gaps are structural
inconsistency — arguably BLOCKER, same as a1-checklist's other
implementation-blocking checks) and its own 3-way exit semantics preserved
internally. Keep `a1-check` as a deprecated thin alias for one release
(prints a deprecation notice, forwards to `a1-checklist --only-check-9` or
equivalent, keeps exit codes stable) so `04.5-consistency-gate.md` doesn't
need to change in the same commit that ships the merge.

- **Effort:** medium. Touches: `a1-checklist`'s check-runner logic (add
  check #9 with FR-coverage semantics), `a1-checklist/SKILL.md` frontmatter
  (extend description, drop the "distinct from a1-check" sentence),
  `a1-check/SKILL.md` (rewrite as deprecated-alias notice), the CLI
  implementation the two wrap (need to confirm both currently share or could
  share a code path — not verified in this pass, flag as an open
  implementation question for whoever executes this), and eventually
  `04.5-consistency-gate.md` once the alias period ends.
- **Risk:** low-medium. The 3-way exit-code contract must be preserved
  exactly or Phase 4.5's branching breaks silently. The BLOCKER/MAJOR/MINOR
  severity a1-checklist uses is coarser than a1-check's PASS/FAIL/ERROR;
  reconciling the two severity models needs a deliberate mapping decision,
  not an assumption.
- **Benefit:** one fewer pre-implementation gate skill to discover, maintain,
  and explain in trigger-routing tables; removes the now-explicit tension
  MAP.md §9 flagged (`a1-check` is a de-facto subset of `a1-checklist`'s gate
  logic — this is not a hypothesis, both frontmatters already assert
  awareness of each other).

**(b) Keep both, sharpen the boundary text.** No mechanical change; instead
rewrite both frontmatter descriptions to state the boundary as a positive
distinction rather than a negative exclusion (e.g. "a1-check verifies FR
traceability specifically; a1-checklist verifies plan hygiene broadly, and
calls a1-check internally as one of its 8 checks" — i.e. option (b) could
itself absorb some of (a)'s benefit via composition without a full merge).

- **Effort:** low. Frontmatter-only edit to both `SKILL.md` files.
- **Risk:** low. No CLI/exit-code contract changes.
- **Benefit:** none of the actual duplication is removed; the "de-facto
  subset" tension MAP.md flagged persists as two maintained gates that must
  be kept in sync by hand whenever FR-coverage logic changes.

## Recommendation

**(a), with the deprecated-alias transition.** The duplication is real (not
just a naming overlap — `a1-checklist`'s "spec status is `clarified`" check
and `a1-check`'s FR-coverage check both gate the same Plan→Implement
transition on structural spec/plan consistency), and (b) only defers the
same maintenance cost indefinitely. The one-release alias period keeps
`04.5-consistency-gate.md`'s exit-code-branching logic untouched during the
transition, de-risking the merge's most fragile part.

## Migration steps (if (a) is chosen)

1. Add check #9 to `a1-checklist`'s runner with a severity mapping decision
   (recommend: FR-coverage gaps → BLOCKER, mirroring a1-check's FAIL being a
   hard stop today).
2. Preserve a1-check's exact 3-way exit-code semantics (0/1/2) inside the new
   check #9's sub-path, since `04.5-consistency-gate.md` branches on exactly
   those three values.
3. Rewrite `a1-check/SKILL.md` to a deprecated-alias notice; the underlying
   CLI keeps working (forwards to a1-checklist) for one release.
4. Update `a1-checklist/SKILL.md`'s frontmatter to drop the "distinct from
   a1-check" sentence and instead document that FR-coverage is check #9.
5. **Do not touch `04.5-consistency-gate.md` in the same commit** — let it
   keep calling `a1-check` (now an alias) until the deprecation window ends,
   then switch its invocation to `a1-checklist` and remove the alias.
6. Update the global routing table (`~/.claude/rules/common/a1-framework.md`
   — outside this repo, Robert's call whether to touch it) if the trigger
   surface changes.

## Not done by this task

No code, frontmatter, or routing-table changes were applied. This document
is the entire deliverable for Task 7.1.
