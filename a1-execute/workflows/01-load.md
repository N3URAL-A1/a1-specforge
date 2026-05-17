# Phase 1: Load Plan

Read the plan and confirm with the user before executing.

## Steps

1. Find PLAN.md at `.a1/phases/<phase_name>/PLAN.md`
   - If not found: "No plan found. Run `a1-plan` first to create one."

2. Read PLAN.md — extract:
   - Goal
   - Wave count and names
   - Success criteria
   - Total task count

3. Check STATUS.md for already-completed waves:
   ```bash
   cat .a1/phases/<phase_name>/STATUS.md 2>/dev/null
   ```

4. Check git status:
   ```bash
   git status --short
   git log --oneline -5
   ```

5. Present to user:
   ```
   Ready to execute: <phase name>
   Goal: <one sentence>
   
   Waves:
   → Wave 1: <name> (3 tasks) [ready]
   ✓ Wave 2: <name> (2 tasks) [already done — skip]
   
   This will create ~<N> commits.
   
   Proceed? [y/n]
   ```

6. Wait for user confirmation before proceeding to Phase 2.
