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
- Inform user: "Plan ready. No blockers found."
- Show PLAN.md summary (goal, wave count, success criteria)
- Suggest: "Run `a1-execute` to start implementation."

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

After every a1-plan run — PASS or revision-limit-reached — write one structured entry.
Takes ~2 minutes. Do not skip. Used by `a1-evolve` for pattern clustering.

**Append to local cache:**

```bash
cat >> ~/.claude/skills/a1-plan/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
phase: <phase-name>
project: <project-slug>
spec: <spec-path or "none">
result: <pass|pass-after-revision|blocked>
revisions: <0|1|2>
audit_findings: <total-blocker-count-across-rounds>
finding_classes: [<from: missing_acceptance_criteria, vague_tasks, no_success_criteria, wave_too_large, missing_dependency, unverifiable_goal, spec_omission>]
phase_that_produced_issues: [<from: research, map, plan>]
one_line_learning: <what would have prevented the main audit finding, or "no findings">
EOF
```

**Append the same entry to the Vault:**

```
~/N3URAL-Vault/pattern/a1-learnings/a1-plan.md
```

Use the `finding_classes` tags consistently — they feed into `patterns.md` clustering:
`missing_acceptance_criteria` | `vague_tasks` | `no_success_criteria` | `wave_too_large` | `missing_dependency` | `unverifiable_goal` | `spec_omission`

A run with zero findings is still useful data — write the entry with `audit_findings: 0`.
