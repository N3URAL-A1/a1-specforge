# Phase 4: Audit

Spawn `a1-adam-auditor` to validate the PLAN.md before execution.

## Prompt template

```
Audit this PLAN.md for quality and coverage gaps. Write AUDIT.md.

<files_to_read>
- .a1/phases/<phase_name>/PLAN.md
- .a1/phases/<phase_name>/RESEARCH.md
- .a1/phases/<phase_name>/MAP.md
- <spec_path> (if provided)
</files_to_read>

**Output path:** .a1/phases/<phase_name>/AUDIT.md
```

## Completion and routing

### If verdict is PASS
- Inform user: "Audit passed. No blockers found."
- **Then load `04b-xprov-review.md`** (Phase 4b, cross-provider plan review,
  gate `plan-review-xprov`). The PLAN.md summary and the "Run `a1-execute`"
  suggestion are given there, after the second provider has spoken — a PASS
  audit alone no longer ends the pipeline.

### If verdict is FAIL
- Inform user: "Plan has <N> blocker(s):"
- List each BLOCKER finding in one line
- Route back to Phase 3 (revision mode)
- Maximum 2 revision cycles — if still FAIL after 2, surface to user for manual decision

### Revision limit reached
If this is the second audit and still FAIL:
```
⚠ Plan still has blockers after 2 revision cycles.

Remaining blockers:
<list>

Options:
1. I can try to fix these manually — tell me which to address
2. Proceed anyway (I'll flag these as known risks)
3. Cancel and start fresh
```

---

## Retro (mandatory, every run)

After every a1-plan run — PASS (written once, after Phase 4b has routed) or
revision-limit-reached — write one retro entry per `_shared/retro-template.md`
(entry format + write targets: learning store first, dev cache best-effort),
with skill = `a1-plan` and these **additional fields** beyond the base schema:

```
phase: <phase-name>
spec: <spec-path or "none">
result: <pass|pass-after-revision|blocked>
revisions: <0|1|2>
audit_findings: <total-blocker-count-across-rounds>
finding_classes: [<from: missing_acceptance_criteria, vague_tasks, no_success_criteria, wave_too_large, missing_dependency, unverifiable_goal, spec_omission>]
phase_that_produced_issues: [<from: research, map, plan>]
```

Use the `finding_classes` tags consistently — they feed `patterns.md`
clustering. A run with zero findings still gets an entry (`audit_findings: 0`).

**`gates_fired` is required** — a1-plan runs registered gates (`plan-audit`,
`plan-review-xprov`, and `lane-split` on plans with a `lanes:` block). One
line per gate that ran, ids verbatim from `_shared/gates-registry.md`;
`04b-xprov-review.md` Step 4 defines the `plan-review-xprov` line. Add
`xprov_waived` to `issues` (the base field of `_shared/retro-template.md`;
a1-execute's retro uses its own `issue_classes` — a1-evolve reads both) when a
waiver exists for this phase. Validate before appending — capture-then-check,
never a pipe:

```bash
node <repo>/_shared/a1-tools.cjs retro validate "$RETRO_FILE"; RC=$?
if [ $RC -ne 0 ]; then echo "fix the gate ids above before the entry counts"; exit $RC; fi
```
