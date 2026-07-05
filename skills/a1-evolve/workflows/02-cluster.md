# Phase 2: Cluster

Group observations by pattern and identify what to improve.

## Clustering logic

### 2a. Group by pattern tag
From all observations, group by the `pattern` field:

```
missing_wiring: [obs1, obs2, obs3, obs4, obs5]
wave_ordering:  [obs1, obs2, obs3]
vague_action:   [obs1, obs2]
missing_import: [obs1]
```

### 2b. Group by affected skill/agent
For each pattern cluster, identify which skill/agent file is responsible:

| Pattern | Root cause | File to fix |
|---|---|---|
| `missing_wiring` | Planner doesn't include wiring as must-have | `agents/a1-pablo-planner.md` |
| `wiring_gap` | Planner misses "wire to router" task | `agents/a1-pablo-planner.md` |
| `wave_ordering` | Planner puts dependent tasks in same wave | `agents/a1-pablo-planner.md` |
| `vague_action` | Plan task actions aren't specific enough | `agents/a1-pablo-planner.md` |
| `missing_migration` | Researcher doesn't check for schema changes | `agents/a1-rico-researcher.md` |
| `env_var_undocumented` | Planner/executor doesn't add env var doc task | `agents/a1-erik-executor.md` |
| `research_stale` | Researcher uses cached/old library knowledge | `agents/a1-rico-researcher.md` |
| `test_gap` | Planner doesn't include test tasks | `agents/a1-pablo-planner.md` |
| `type_error_cascade` | Wave 1 type changes break Wave 2 | `agents/a1-pablo-planner.md` (wave design) |

### 2c. Score by impact

For each cluster, compute:
- **Frequency**: count of occurrences
- **Severity score**: minor=1, major=3, critical=5
- **Impact score**: frequency × average severity

Sort by impact score descending.

### 2d. Build cluster report

```
Pattern Analysis:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 missing_wiring (impact: 24)
   Occurrences: 8 | Avg severity: major
   Affected: a1-pablo-planner.md
   Sample: "Router wiring not in plan — had to add manually"
   
🟡 wave_ordering (impact: 9)
   Occurrences: 3 | Avg severity: major
   Affected: a1-pablo-planner.md
   Sample: "Wave 2 task depended on Wave 2 output from different task"

🟢 missing_import (impact: 3)
   Occurrences: 3 | Avg severity: minor
   Affected: a1-erik-executor.md (handling ok, just noting)
   → Below threshold for change (minor severity, executor handles it)
```

Only patterns with impact score ≥ 6 proceed to Phase 3.

## 2e. Gate-ROI (gate retirement candidates)

When **≥5 retros carry a `gates_fired` field** (see `_shared/learning-schema.md`),
compute per-gate return-on-investment. IDs come from `_shared/gates-registry.md` —
ids not in the registry are ignored.

For each registered gate, across all `gates_fired` entries:
- **Catch score** = Σ over its `caught: true` entries of the run's severity weight
  (minor=1, major=3, critical=5).
- **Cost class** = the gate's `cost` column in gates-registry.md (cheap/med/high).
- **ROI** = catch score ÷ cost weight (cheap=1, med=3, high=5).

**Retirement candidate rule:** a gate with **0 catches over 10+ runs** in which it
fired AND a **med or high** cost class becomes a `gate_retirement_candidate` finding.

```
🕳 gate_retirement_candidate: gate-3-smoke
   Fired: 14 runs | Catches: 0 | Cost: med
   → PROPOSAL ONLY. Suggest de-scope / merge into phase-6-verify.
```

**Constraints (constitution invariant 8 — "a gate that cannot fail is documentation"):**
- Retirement candidates are **proposals only**. Never auto-remove a gate; a human
  decides. Emit as a finding for Phase 3, flagged `proposal-only`.
- Cheap gates are never retirement candidates (keeping them costs ~nothing).
- Gates younger than 10 fired runs stay in `monitoring` — too little data (e.g. the
  2026-06/07 additions `gate-0`, `gate-0.5`, `gate-0.6`).
