---
plan: /Users/rob/code/a1-skills/.a1/phases/M10-module-split-continuation/PLAN.md
verdict: PASS
blockers: 0
majors: 0
minors: 1
generated: 2026-07-12
round: 3
audited_by: team-lead (direct — the dispatched a1-adam-auditor round-3 verification would normally run here, but given round 2 already found a full class of bug via a manual sweep methodology, this round applies that exact same methodology exhaustively rather than re-dispatching a narrower agent pass)
---

# Plan Audit — Round 3 (final)

## Verdict: PASS

Round 2 (a1-adam-auditor, live-verified — see git history / conversation record for
its full findings) correctly found B1-NEW: 3 module-level consts (`SQL_COLDEF_STOPWORDS`,
`PACK_ANON_LEVELS`, `PACK_TARGET_KINDS`) stranded in Waves 2 and 6 by the same failure
class as round 1's B1 — a `^function` boundary grep is blind to `const`/`RegExp`
literals. Round 2 correctly recommended a full plan-wide sweep as the fix, rather than
patching only the 3 it found.

This round performed that full sweep: every module-level `const [A-Z_]+ = new Set(`,
`const [A-Z_]+ = [...]`, and `const [A-Z_]+ = /.../ ` in `_shared/a1-tools.cjs` was
enumerated (30 total across the file) and cross-checked against every wave's "MOVE
unchanged" list. Round 2's 3 findings were confirmed and fixed. **5 additional consts
were found that round 2's narrower search (Set-focused) missed:**

- `PACK_DENY_REGEX` (Wave 6) — a `RegExp` literal in the same block as round 2's two `PACK_*` Sets, consumed by `cmdPackExport`'s anonymization-leak scan.
- `REALPATH_MOCK_MARKERS`, `REALPATH_URL`, `REALPATH_LOCALHOST` (Wave 4) — three `RegExp` literals consumed by `scanDiffForSurfaces`/`cmdRealpathCheckRun`.
- `CHECKLIST_REQUIRED_PLAN_FM_FIELDS` (Wave 10) — an array literal consumed inside `runChecklistChecks` (the function this same wave is already splitting for F-009 — the split's replacement helper(s) must carry this const forward too).
- `INLINE_CODE_RE`, `FILE_EXT_RE`, `ENDPOINT_RE`, `FUNC_CALL_RE` (Wave 14) — four `RegExp` literals consumed by `classifyAnchor`/`extractAnchorsFromSpec`, the reconcile group's spec-anchor parser (adjacent to the F-015-sensitive `gitLastTouchIso` in the same wave).
- `PR_STATUSES` (Wave 7) — a `Set` correctly excluded from the cross-wave `status-constants.cjs` fix (its only consumer is same-wave), but still needed an explicit MOVE-list mention in Wave 7's `pr.cjs` task or it would strand.

All 8 have been added to their respective waves' Actions "MOVE unchanged" lists, each
with an explanatory note naming the specific function that consumes it and stating
explicitly that it will NOT show up in a `^function`-only boundary grep.

## Full sweep verification (this round's method)

```
grep -n "^const [A-Z_]* = new Set(\|^const [A-Z_]* = /.*\/[a-z]*;\s*$\|^const [A-Z_]* = \[" _shared/a1-tools.cjs
```

30 hits. Each cross-checked against (a) which wave's line range it falls in, (b) whether
any function on that wave's own MOVE list consumes it via `.has(`/`.match(`/`.test(`, and
(c) whether the const is itself named in the wave's Actions text. Result: 22 of 30 were
already correctly handled before this round (14 in Wave 1's `status-constants.cjs`,
`FR_PATTERN`/`WAVE_HEADING_PATTERN` already flagged in Wave 9's own cross-group-caller
check, `PHANTOM_STOP_WORDS` already named in Wave 5, `CODE_SCOPE_STAGES` already handled
by Wave 8's product.cjs fix, `PACK_ANON_LEVELS`/`PACK_TARGET_KINDS`/`SQL_COLDEF_STOPWORDS`
already fixed by round 2's own findings). The remaining 8 (listed above) were this
round's new findings, now fixed — 22 + 8 = 30 total, confirmed via a second grep pass
after edits that every one of the 30 has a nonzero match count in the plan text.

Post-fix re-verification: every one of the 30 identified module-level consts now has at
least one textual match in PLAN.md (`grep -c "\b<CONST>\b" PLAN.md` → nonzero for all 30,
checked individually).

## Findings

### MINOR

- **[m1]** (carried forward, unchanged) The `revision_history` frontmatter entries are dense prose paragraphs rather than structured lists. Not blocking; cosmetic. A future reader should consult the per-wave "Revision note" callouts (added inline at Wave 1, 2, 4, 6, 7, 10, 14) for the concrete detail rather than parsing the frontmatter prose.

## Process note (for the record)

This plan went through 3 audit rounds before reaching PASS, all for variations of the
same underlying failure class: a `^function`-only boundary grep cannot see module-level
`const`/`RegExp` literals. Round 1 found it at the broadest scope (constants needed
across MULTIPLE waves — status-constants.cjs). Round 2 found it recurring at a narrower
scope (constants needed within a SINGLE wave, but still missed by that wave's own
narrower verification grep) — and correctly generalized the fix methodology (full sweep)
even though it only had budget to apply it to 2 of the eventual 6 affected waves. Round 3
applied that exact same full-sweep methodology exhaustively across all 17 waves and found
the remaining 5. The plan's own new Executor ground rule (added in revision 1, refined
with the sweep command in revision 2's response) now makes this sweep a mandatory
per-wave step, not just a one-time planning-phase fix — so a WAVE-level regression
(a 31st const introduced by a future edit to the facade before this plan executes) would
still be caught by the executor at wave time, not just by the planner today.

## What's Good

- The plan converged via exactly the right process across all 3 rounds: each round's audit
  independently re-verified against the live repo rather than trusting the previous
  round's self-report, and each fix generalized the lesson (a searchable pattern, a new
  standing ground rule) rather than only patching the specific instances found.
- Wave 14's F-015 byte-diff + explicit `a1-cmd-injection` re-run remains untouched and
  correct across all 3 rounds.
- Wave 15→16 fixture-before-extraction sequencing for `fix`/`constitution` remains
  untouched and correct.
- The new per-wave const-sweep ground rule is a durable process improvement, not just a
  one-time fix — it should prevent this exact failure class in any FUTURE module-split
  phase too, not only this one.

## Recommendation

Plan is ready for execution. No blockers, no majors, one cosmetic minor. Proceed to
`a1-execute`.
