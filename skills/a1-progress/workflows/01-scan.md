# Phase 1: Scan & Report

Read project state and present a clear status overview.

## Scan steps

### 1. Detect project root
```bash
# Look for .a1/, CLAUDE.md, .git
ls -la .a1/ 2>/dev/null
ls -la .git/ 2>/dev/null
cat CLAUDE.md 2>/dev/null | head -10
```

### 2. Read roadmap
```bash
cat .a1/roadmap.md 2>/dev/null
ls .a1/phases/ 2>/dev/null
```

### 3. For each phase directory
```bash
# Check plan existence and status
cat .a1/phases/*/PLAN.md 2>/dev/null | grep -E "^(phase:|goal:|status:|waves:)"
# Check execution status
cat .a1/phases/*/STATUS.md 2>/dev/null
# Check verification
cat .a1/phases/*/VERIFICATION.md 2>/dev/null | grep -E "^(verdict:|passed:|gaps:)"
```

### 4. Git state
```bash
git branch --show-current
git log --oneline -10
git status --short
```

### 5. Health checks
```bash
# Quick type-check
npx tsc --noEmit 2>&1 | tail -3
# Test count
npm test -- --passWithNoTests 2>&1 | tail -5
```

## Output format

```
━━━ Project Status ━━━━━━━━━━━━━━━━━━━━━━━━━

Project: <name>  Branch: <branch>

<if roadmap exists>
Milestone: <current milestone>
</if>

Phases:
  ✓ M1-P1-<name>        DONE        (verified)
  ✓ M1-P2-<name>        DONE        (verified)
  → M1-P3-<name>        EXECUTING   Wave 2/4 in progress
    M2-P1-<name>        PLANNED     ready for a1-execute
    M2-P2-<name>        NOT PLANNED —

Recent commits:
  <last 5 git log lines>

Build/Tests: <ok / N errors>

━━━ Next Action ━━━━━━━━━━━━━━━━━━━━━━━━━━━

→ <recommended next action with skill name>
```

## Routing decisions

| Condition | Recommendation |
|---|---|
| No `.a1/` | Start with `a1-roadmap` to plan the project |
| Phase has PLAN.md, no STATUS.md | `a1-execute` — ready to start |
| STATUS.md has incomplete waves | `a1-execute` — resume from Wave <N> |
| All waves done, no VERIFICATION.md | `a1-execute` — runs verification automatically |
| VERIFICATION.md PARTIAL/FAIL | `a1-execute` — targeted re-run for gaps |
| VERIFICATION.md PASS, next phase not planned | `a1-plan` — plan next phase |
| All phases DONE | 🎉 Done — suggest deploy or next milestone |
