# a1 Learning Schema

Shared format for all observation and learning data across the a1 skill set.

## observations.jsonl (per phase, written by agents during execution)

One JSON object per line. Written to `.a1/phases/<name>/observations.jsonl`.

```jsonl
{"ts":"2026-05-17T15:00:00Z","agent":"a1-erik-executor","skill":"a1-execute","phase":"M1-P2-auth","wave":2,"type":"deviation","severity":"minor","msg":"Had to add missing import in 3 files — not in plan","pattern":"missing_import"}
{"ts":"...","agent":"a1-erik-executor","skill":"a1-execute","phase":"M1-P2-auth","wave":3,"type":"blocker","severity":"major","msg":"Router wiring not in plan — had to add manually","pattern":"missing_wiring"}
{"ts":"...","agent":"a1-victor-verifier","skill":"a1-execute","phase":"M1-P2-auth","wave":null,"type":"gap","severity":"major","msg":"SC-2 endpoint existed but not registered in router","pattern":"wiring_gap"}
{"ts":"...","agent":"a1-pablo-planner","skill":"a1-plan","phase":"M1-P2-auth","wave":null,"type":"plan_quality","severity":"minor","msg":"Wave 2 had implicit dependency on Wave 1 output — should have been Wave 3","pattern":"wave_ordering"}
```

### Optional fields
- `lane` — lane id, on phases that ran multi-lane (a1-pablo-planner Step 4.5).
  Omit for sequential phases; absent and `null` mean the same. Without it,
  observations from concurrent lanes are indistinguishable during synthesis, and
  a pattern local to one lane reads as phase-wide.

### External reviewer attribution

`agent:` names an a1 agent by full name (constitution invariant 5:
`a1-<vorname>-<rolle>`). **One documented exception: `xprov-codex`** — the single
allowed non-`a1-*` value, written by `a1-tools xprov observe` when the cross-provider
review gate relays what an external reviewer found (registry ids `plan-review-xprov` /
`wave-inspect-xprov` in `gates-registry.md`; spec `009-cross-provider-review-gate`,
FR-025 / FR-026). This file OWNS the exception; `docs/CONSTITUTION.md` only links here
(invariant 1). Any other non-`a1-*` value is rejected by the writer (exit 1) and would be
invisible to a1-evolve. `skill`, `phase`, `wave` (`null` at Plan), `type`
(`gap` | `blocker`), `severity` and `msg` keep their meaning from above.

| Field | With `xprov-codex` | Value |
|---|---|---|
| `agent` | required | `xprov-codex` |
| `pattern` | required | `xprov_finding` — one relayed reviewer finding; `xprov_waived` — a gate result set aside by a recorded waiver (FR-007) |
| `provider` | optional | `codex` — the provider CLI the runner drove. No fallback provider is ever recorded. |
| `model_requested` | optional | the `--model` value passed to the runner, or the literal `CLI default (unresolved)` when none was passed (a1 passes none — ADR 2026-09-24) |
| `model_observed` | optional | ONLY a value measured from the runner record or a captured CLI event stream; otherwise the literal `unknown`. Never copied from `model_requested`. Runner 2.1.0 reports `observed_models: []` for Codex, so today this is always `unknown` — the parser follows a captured fixture, never precedes it. |

```jsonl
{"ts":"...","agent":"xprov-codex","skill":"a1-plan","phase":"M1-P2-auth","wave":null,"type":"gap","severity":"major","msg":"PLAN.md Wave 2 writes the migration but no task registers it in the router","pattern":"xprov_finding","provider":"codex","model_requested":"CLI default (unresolved)","model_observed":"unknown"}
```

### Observation types
- `deviation` — executor had to do work outside the plan
- `blocker` — task couldn't complete without unplanned work
- `gap` — verifier found something missing or not wired
- `plan_quality` — plan structure issue (wave ordering, ambiguous task, vague done-when)
- `research_miss` — something research should have caught but didn't
- `timing` — task took significantly more/less effort than expected

### Severity
- `minor` — resolved inline, no execution impact
- `major` — caused rework or partial completion
- `critical` — caused wave to block

### Pattern field (standardized tags — use these for clustering)
`missing_import` | `missing_wiring` | `wiring_gap` | `wave_ordering` | `vague_action` | `missing_migration` | `env_var_undocumented` | `test_gap` | `scope_creep` | `research_stale` | `router_not_updated` | `type_error_cascade` | `retro_integrity` | `xprov_finding` | `xprov_waived`

---

## _learning.md (per skill, accumulated across all runs)

Lives at `~/.claude/skills/<skill-name>/_learning.md`.

Append-only. One entry per execution run.

```markdown
## 2026-05-17 — n3ural-platform / M1-P2-auth

**Skill:** a1-execute  
**Outcome:** PARTIAL (1 gap — SC-2 not wired)  
**Project type:** Next.js + Postgres  
**evidence:** .a1/phases/M1-P2-auth/VERIFICATION.md (verdict: PARTIAL); commits abc1234, def5678  

### Observations (from agents)
- [executor/W2/major] Router wiring not in plan — added manually (pattern: missing_wiring)
- [executor/W1/minor] 3 missing imports — added inline (pattern: missing_import)
- [verifier/gap/major] SC-2: endpoint existed but not registered (pattern: wiring_gap)

### Retro
✅ a1-rico-researcher caught JWT version mismatch before it caused issues  
✅ Wave 1 ran cleanly — foundation tasks well-scoped  
⚠️ a1-pablo-planner consistently misses router registration as an explicit task  
⚠️ "Done when" on Task 2.3 was too vague — executor interpreted it differently  

### Suggested improvement
a1-pablo-planner should add "wire to router/index" as a standard Wave 3 task for API phases.
```

**`gates_fired:` field (REQUIRED for gated runs — feeds gate-ROI).** Replaces
free-text gate attribution. One entry per gate that ran this run; omit the field
only when the skill has no registered gates (read-only reporters). Required for
every a1-execute wave, a1-new-feature phase gate, and a1-fix verify run — see
`_shared/retro-template.md`, which owns the canonical entry format:

```yaml
gates_fired:
  - {id: gate-3-smoke,     verdict: pass, caught: false}
  - {id: gate-0.7-realpath, verdict: fail, caught: true}
  - {id: phase-6-verify,   verdict: pass, caught: false}
```

- `id` — a stable slug from `_shared/gates-registry.md` (single source of truth; ids
  not in the registry are ignored by a1-evolve's gate-ROI step).
- `verdict` — `pass` | `fail` (the gate's own outcome).
- `caught` — `true` | `false` (did this gate catch the run's escaping bug).

The legacy `gate_that_caught_most` free-text field is still supported for older
retros; new retros should prefer `gates_fired`. a1-evolve reads both.

**`evidence:` field (recommended — feeds FMEA-3 retro-integrity check).** A retro
whose `Outcome`/`result:` claims a pass SHOULD carry an `evidence:` reference to a
verifiable artifact: a VERIFICATION.md path (with its verdict), and/or commit
hashes, and/or an a1-fix postmortem path. a1-evolve's collect phase cross-checks
the claimed outcome against the referenced verdict; a retro claiming `pass` whose
referenced VERIFICATION says FAIL/PARTIAL (or is missing) is flagged as a
`retro_integrity` finding. No evidence ⇒ the entry is treated as `unverified`.

---

## learnings-index.md (global, cross-skill summary)

Lives at `~/.claude/skills/_shared/learnings-index.md`.

Updated by a1-evolve after each synthesis run.

```markdown
# Learning Index

Last synthesis: 2026-05-17
Total observations: 47
Patterns with 3+ occurrences:

| Pattern | Count | Affected Skills | Status |
|---|---|---|---|
| missing_wiring | 8 | a1-plan, a1-execute | → proposed fix in a1-pablo-planner.md |
| wave_ordering | 5 | a1-plan | → applied 2026-05-17 |
| vague_action | 4 | a1-plan | → pending review |
| missing_import | 3 | a1-execute | → monitoring |
```
