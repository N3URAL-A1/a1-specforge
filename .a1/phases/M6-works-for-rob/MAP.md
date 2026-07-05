---
focus: all (tech + arch + quality + concerns)
generated: 2026-07-04
---

# M6 "Works for Rob" — Codebase Map

## Executive Summary

The a1-specforge framework (`/Users/rob/code/a1-skills/`) is a Node.js + shell skills engine that orchestrates structured feature development via 7-phase pipelines (spec → clarify → plan → implement → verify). M6 focuses on **reliability hardening**: extending Gate 0.5 (surface coverage) to catch content-derived gaps, adding deterministic CLI schema checks, promoting security patterns into briefs, building cost tracking, and validating M5 (a1-modernize) end-to-end. The main codebase artifact is **`_shared/a1-tools.cjs` (5053 LOC)**, which provides deterministic file ops and CLI dispatch for 16 shipped skills.

---

## Tech Stack

| Component | Version / Tech | Purpose | Location |
|---|---|---|---|
| **Node.js CLI** | `node` (>=18) | Command dispatch, file ops, YAML frontmatter parsing | `_shared/a1-tools.cjs` |
| **Skill Pipeline** | 6–7 phase markdown workflows | Spec-driven feature orchestration | `a1-new-feature/workflows/`, `a1-modernize/workflows/`, etc. |
| **Config & State** | YAML frontmatter in `.md` files | Phase status, FR tracking, wave metadata | `projects/<slug>/spec/*.md`, `.a1/phases/*/` |
| **Learning Store** | Obsidian Vault (canonical) + `.md` cache | Pattern synthesis, retro corpus, taxonomy | `~/N3URAL-Vault/pattern/a1-learnings/` (or `.a1/learnings/` repo-local) |
| **Session Logs** | JSONL (hook events with token data) | Token usage tracking, cost analysis | `~/.claude/projects/-Users-rob-code-a1-skills/*.jsonl` |
| **Test Fixtures** | Shell scripts + nested markdown trees | Validation of deterministic gates/checks | `_test-fixtures/a1-{check,checklist,phantom,reconcile}/` |

**Shipped Skills (16):**
- Core pipeline: `a1-new-feature`, `a1-plan`, `a1-execute`, `a1-analyze`, `a1-modernize`
- Utilities: `a1-fix`, `a1-check`, `a1-checklist`, `a1-phantom`, `a1-reconcile`, `a1-pr-review`, `a1-worktree`, `a1-progress`, `a1-constitution`, `a1-new-project`

---

## Architecture

### High-Level Flow

```
User Request
    ↓
a1-[skill] (e.g., a1-new-feature)
    ├─ Phase 1–7 workflows (markdown with shell/LLM prompts)
    ├─ CLI calls to a1-tools.cjs for deterministic ops
    ├─ Sub-agents dispatch (Rene, Vincente, code agents)
    └─ Output: spec file + wave plans + VERIFICATION.md
    
a1-tools.cjs
    ├─ Command groups: spec, fix, analyze, constitution, modernize, reconcile, phantom, check, checklist, worktree, pr
    ├─ For each group: ~5–13 subcommands
    ├─ Shared helpers: readMd, writeMdAtomic, parseFlags, vaultRoot
    └─ Exit: JSON output or direct stdout (check/checklist/phantom own their output)
```

### File Organization

```
/Users/rob/code/a1-skills/
├── _shared/
│   ├── a1-tools.cjs               [5053 LOC — main CLI; 11 command groups, 50+ subcommands]
│   ├── learnings-index.md         [Pattern cache, applied/monitoring]
│   └── learning-schema.md         [Metadata schema for retro entries]
├── _test-fixtures/
│   ├── a1-check/                  [3 scenarios: pass, fail-*, error-*]
│   ├── a1-checklist/              [7 scenarios: pass, blocker-*, major-*]
│   ├── a1-phantom/                [3 scenarios: clean, no-code-tag, phantoms]
│   ├── a1-reconcile/              [4 scenarios: single-{pass,missing,extra,diverged}]
│   └── a1-pr-review/              [TBD — minimal currently]
├── a1-new-feature/
│   ├── SKILL.md                   [Phases 1–6: discover → specify → clarify → plan → implement → verify]
│   ├── workflows/
│   │   ├── 01-discover.md         [User pain point → feature idea]
│   │   ├── 02-specify.md          [Specification + ACs]
│   │   ├── 03-clarify.md          [Opus: 10-cat scope scan + UX mockups]
│   │   ├── 04-plan.md             [Wave decomposition; DB-schema checklist (8 schema_flaw pattern occurrences)]
│   │   ├── 04.5-consistency-gate.md [Deterministic: bijective FR coverage, phantom check]
│   │   ├── 05-implement.md        [Executor dispatch; Gate 0.5 surface-coverage (lines 110–136)]
│   │   └── 06-verify.md           [a1-victor-verifier; cost summary template, retro format]
│   ├── agents/                    [Agent briefs for Rene, Vincente, code agents]
│   ├── _learning.md               [17 runs, 5 patterns extracted; 2026-07-03 surface-coverage recurrence]
│   └── templates/                 [spec-template.md — boilerplate for new specs]
├── a1-modernize/
│   ├── SKILL.md                   [7 phases: scope → reverse-spec → gap → tech-proposals → plan → execute → publish]
│   ├── workflows/
│   │   ├── 01-scope.md            [Mode select: spec-only vs full]
│   │   ├── 02-reverse-spec.md     [a1-rafael-reverse-spec: derive spec from code]
│   │   ├── 03-gap-analysis.md     [a1-reinhard-reviewer + a1-alex-architekt]
│   │   ├── 04-tech-proposals.md   [Stack-conditional agents propose fixes]
│   │   ├── 05-plan.md             [Wave decomposition for full mode]
│   │   ├── 06-execute.md          [a1-erik-executor + a1-theo-test-engineer]
│   │   └── 07-publish.md          [a1-victor-verifier → Notion publish]
│   └── agents/                    [Agent briefs for Rafael, Reinhard, Alex, Erik, Theo, Victor]
├── a1-analyze/
│   ├── SKILL.md                   [Forensic analysis: tech stack, quality, concerns; always read-only]
│   ├── workflows/                 [Discover → Analyze → Synthesize → Report]
│   ├── agents/
│   │   └── a1-marco-mapper.md     [Map codebase structure; MUST NOT write files (hard constraint)]
│   └── _learning.md               [Read-only enforcement gap; Marco breach 2026-06/07]
├── a1-fix/
│   ├── SKILL.md                   [Bug root-cause → postmortem → lesson → promote]
│   ├── workflows/                 [Report → Diagnose (Falk) → Postmortem → Promote]
│   ├── agents/
│   │   └── falk-bug-hunter.md     [Root-cause forensics; sibling-site sweep in step 3b]
│   └── _learning.md               [symptom_fix_loop pattern applied]
├── a1-new-project/                [Zero-to-backlog: roadmap → specs → backlog; calls a1-roadmap + a1-new-feature]
├── a1-pr-review/                  [PR → code review (Reinhard) → findings-summary → handoff]
├── a1-checklist/                  [Pre-flight readiness: spec clarity, dependency graph, agent coverage; blocker/major/minor severities]
├── a1-check/                      [Phase 4.5 consistency gate: bijective FR coverage, phantom-FR detection (deterministic, CLI-only)]
├── a1-phantom/                    [Task phantom detection: grep diff for keywords, prove each task has code]
├── a1-reconcile/                  [Spec-vs-impl drift analysis: missing/extra/diverged criteria]
├── a1-worktree/                   [Git worktree lifecycle: prepare → enter → status → exit → gc]
├── a1-progress/                   [Project status: active specs, phases in-flight, recent learnings]
├── a1-constitution/               [Project constraints: rules, 4-layer override precedence, per-project config]
├── a1-plan/                       [Waves-only: takes spec → produces wave-plan (no spec-phase logic)]
├── a1-evolve/                     [Pattern synthesis: read learnings corpus, cluster patterns, propose diffs]
├── a1-execute/                    [Waves executor: per-wave dispatch + verification; cost summary format]
├── checkpoint/                    [N3URAL.AI personal: robustness checks, not in OSS]
├── docs/
│   ├── roadmap.md                 [M0–M8 phases; M6 success criteria, M5 validation scope]
│   └── VISION.md                  [Product goals, OSS launch plan]
├── agents/                        [Global agent briefs: a1-aik-ai-engineer.md, a1-pablo-planner.md]
├── bin/                           [Install/lint scripts]
└── README.md, CONTRIBUTING.md     [Project intro, contribution path]
```

---

## Command Dispatch (a1-tools.cjs Structure)

### Command Groups & Subcommand Count

| Group | Subcommands | Primary Use |
|---|---|---|
| **spec** | 3 | next-number, update-status, list |
| **fix** | 9 | next-suffix, update-status, list, find-duplicates, integrity-check, init-postmortem, count-postmortems-since, update-promote-state, write-suggestion |
| **analyze** | 7 | next-slot, init, update-status, discover, add-finding, add-findings, list |
| **constitution** | 9 | init, discover, update-status, set-body, next-version, archive-current, write-mirror, link-claudemd, list |
| **modernize** | 13 | next-slot, init, update-status, discover-stack, add-proposal, approve-proposal, add-wave, snapshot-behavior, start-wave, complete-wave, verify-parity, publish-notion, list |
| **reconcile** | 6 | next-slot, init, parse-spec, update-status, add-drift, list |
| **check** | 1 | run (owns stdout, exit code) |
| **checklist** | 2 | run (owns stdout, exit code), list |
| **worktree** | 6 | prepare, enter, status, exit, list, gc |
| **pr** | 4 | list-handoff, mark-status, mark-pr-open, findings-summary |
| **phantom** | 2 | check (owns stdout), list-tasks |

**Total:** 11 command groups, ~63 subcommands

### Core Dispatch Pattern (lines 4933–5050)

```javascript
function main() {
  const argv = process.argv.slice(2);
  const [group, sub, ...rest] = argv;
  
  // Group-level dispatch (if-else chain)
  if (group === 'spec') {
    if (sub === 'next-number') result = cmdSpecNextNumber(rest);
    else if (sub === 'update-status') result = cmdSpecUpdateStatus(rest);
    // ...
  } else if (group === 'fix') {
    // ...
  }
  
  // Ownership: check/checklist/phantom own stdout + exit code (return early)
  // Others: fall through to JSON.stringify(result)
}
```

### Key Helper Functions (Shared)

| Function | Purpose | Signature |
|---|---|---|
| `readMd(path)` | Parse YAML frontmatter + body | → `{fm, body}` |
| `writeMdAtomic(path, fm, body)` | Atomic write (tmp + rename) | No error on collision (PID suffixed tmp) |
| `parseFlags(args, knownFlags)` | Extract `--flag value` pairs | → `{flag: value, _: [positional]}` |
| `vaultRoot()` | Resolve `A1_VAULT_ROOT` or `~/N3URAL-Vault` | → `path` |
| `resolveVaultPath(input)` | Convert relative vault path to absolute | → `path` |
| `appendPhaseHistory(fm, phaseName)` | Add phase completion timestamp | Mutates `fm.phase_history` |
| `parseFrontmatter(content)` | Extract YAML header (lines 1–3 delimiters) | → `{fm, body}` |
| `serializeFrontmatter(fm)` | Convert object back to YAML with key ordering | → `yamlString` |
| `nowIso()` | ISO 8601 timestamp | → `"YYYY-MM-DDTHH:MM:SSZ"` |

### State-Management Patterns

**Status Sets (Enum):**
- `SPEC_STATUSES`: discovering, draft, clarified, planned, awaiting-consistency-fix, implementing, done, cancelled
- `BUG_STATUSES`: reported, diagnosed, fixing, fixed, cant-reproduce, wont-fix, duplicate, cancelled
- `ANALYSIS_STATUSES`: scoped, discovered, analyzed, synthesized, reported, cancelled
- `MODERNIZE_STATUSES`: scoped, spec-drafted, gap-analyzed, proposals-pending, planned, executing, executed, published, cancelled
- `MODERNIZE_WAVE_STATUSES`: planned, snapshotted, implementing, testing, verifying, done, blocked

**Frontmatter Key Ordering (per entity type):**
- `SPEC_KEY_ORDER`: type, project, title, status, fr_count, total_phrases, spec_completed_at, wave_plan_path, verify_failures, phase_history, tags
- `BUG_KEY_ORDER`: type, project, title, date, severity, status, terminal_status, symptoms, root_cause_class, fix_commit, verify_result, duplicate_of, phase_history, tags
- `MODERNIZE_WAVE_KEY_ORDER`: type, project, modernize_doc, wave_index, status, wave_goals, proposed_phase, snapshot_datetime, phase_history, tags

---

## Quality & Testing

### Test Fixture Structure

```
_test-fixtures/
├── a1-check/           [Consistency gate validation]
│   ├── pass/           [OK: bijective FR coverage, no phantoms]
│   ├── fail-duplicate-fr/
│   ├── fail-missing-fr/
│   ├── fail-wrong-link/
│   ├── fail-phantom-fr/
│   └── error-no-spec/
├── a1-checklist/       [Pre-flight readiness]
│   ├── pass/
│   ├── blocker-spec-not-clarified/
│   ├── blocker-no-plan/
│   ├── blocker-dep-cycle/
│   ├── major-missing-agents/
│   ├── major-missing-frontmatter/
│   └── major-missing-stories/
├── a1-phantom/         [Task phantom detection]
│   ├── clean/          [All tasks have code]
│   ├── phantoms/       [Some tasks missing code-tag]
│   └── no-code-tag/    [No code tags at all]
├── a1-reconcile/       [Drift detection]
│   ├── single-pass/
│   ├── single-missing/
│   ├── single-extra/
│   └── single-diverged/
└── a1-pr-review/       [TBD]
```

**Fixture Format:** Each scenario contains minimal vault structure (`projects/demo/spec/*.md` + `projects/demo/plans/*.md`) to test deterministic checks without network/agent overhead.

### Learning Corpus (17 a1-new-feature Runs)

| Pattern | Count | Applied? | Key Learning | File |
|---|---|---|---|---|
| `gate_enforcement_gap` | 4 | ✅ Yes | Gate 0: spot-check agent claims | workflows/05-implement.md |
| `feature_incomplete_surface_coverage` | 5 | ✅ Yes (G0.5) | New field at 1 surface, others stale | workflows/05-implement.md:110–136 |
| `schema_flaw` | 8 | ✅ Yes | Audit trigger, RLS, FK type, enum, migration hygiene, expand-migrate-contract | workflows/04-plan.md:123–139 |
| `spec_omission_crud` | 3 | ✅ Yes | CRUD missing in spec → wave surprises | workflows/03-clarify.md |
| `adr_constraint_too_late` | 3 | ✅ Yes | Architecture decision in wave brief, not Phase 2 | workflows/03-clarify.md |
| `multitenant_rls_not_in_plan` | 3 | ✅ Yes | RLS policy + GRANT gaps in wave | agents/a1-pablo-planner.md |
| `gate_fr_token_overcount` | 5 | ✅ Yes | FR token grammar: must be in `## Wave`, not narrative | workflows/04-plan.md |
| `agent_self_report_false` | 3 | ✅ Yes | "pre-existing", "green", "done" false → Gate 0 spot-check | workflows/05-implement.md |
| `parallel_migration_collision` | 2 | ✅ Yes | Parallel feature merge → shared migration numbers | workflows/06-verify.md |
| `http_self_call_in_server` | 4 | ✅ Yes | Server-side fetch to own endpoint → isolation, RLS-bypass risk | agents/a1-pablo-planner.md |
| `no_live_url_smoke_test` | 3 | ✅ Yes | Gate 3 smoke-test docs missing | workflows/06-verify.md |
| `symptom_fix_loop` | 2 | ✅ Yes | Same defect on 3 records → grep-root fix, not per-instance | a1-fix/workflows/02-diagnose.md |
| `request_scoped_not_module_global` | 1 | ⏳ Monitoring | Fluid Compute security: module-global state leaks across requests | learnings-index.md |
| `rls_grant_matrix_multitable` | 3 | ⏳ Monitoring | Multi-table RLS mutations need full matrix pre-audit | learnings-index.md |
| `context_propagation_matrix` | 1 | ⏳ Monitoring | Multi-screen nav routing (niimo) | learnings-index.md |
| `setstate_in_useeffect_lint` | 1 | ⏳ Monitoring | React cascading-render lint error | learnings-index.md |

**Last Synthesis:** 2026-06-30 (Spec 027 + 6 postmortems) — 12 patterns applied, 4 monitoring.

**Most Recent Failure:** 2026-07-03, Spec 001-homepage-redesign (n3ural-website):
- Bug: "Three Products" heading count outdated after adding case study
- Root: Content-derived surfaces (heading text, classification lists, test fixtures) not in Gate 0.5 scope
- Solution: Extend Gate 0.5 with 3 new grep patterns

---

## Concerns (Ordered by M6 Priority)

### P0 — Critical, Blocks Other Work

#### 1. Gate 0.5 Surface Coverage Incomplete
- **Problem:** 2026-07-03 recurrence: new entity added to CRM, coverage checked at DB/API/UI, but **content-derived surfaces** escaped:
  - Heading text ("Three Products" → "Four Products" in spec, but test still said "Three")
  - Classification lists (`AI_PRODUCT_SLUGS` enum updated in one file, but hardcoded constant elsewhere)
  - Test fixtures missing new case study instance
- **Impact:** HIGH — affects every content-rich feature (marketing sites, dashboards with static counts)
- **Current Gap:** Gate 0.5 lines 110–136 checks 5 surfaces; missing 3 new patterns
- **M6 Work:** Add 3 grep patterns; document in workflows/05-implement.md; test on 2–3 waves
- **Files to Change:**
  - `a1-new-feature/workflows/05-implement.md` (add patterns after line 136)

#### 2. Schema Flaws Still Slip Through
- **Problem:** 8 occurrences in 17-run corpus (highest-frequency bug class):
  - Missing audit trigger (GoBD compliance gap)
  - Connection leak: idle-in-tx blocks `VACUUM` / `CONCURRENTLY` (production outage, happened 2026-06-04)
  - FK type mismatch (string → uuid, crashes at insert)
  - Enum/CHECK incomplete (code writes undeclared values)
  - Expand-Migrate-Contract reversal (deploy order wrong, outage)
  - Migration not reversible (no `-down.sql`)
- **Impact:** HIGH — latent production risk, caught late in Verify phase
- **Current Enforcement:** Narrative checklist in Phase 4 brief (human recall only)
- **M6 Work:** Implement `a1-tools schema-check` subcommand for 3 deterministic checks (audit-trigger, RLS-enable, FK-types); keep semantic checks in brief
- **Files to Change:**
  - `_shared/a1-tools.cjs` (new subcommand group or extend `analyze`)
  - `_test-fixtures/` (add schema-check scenario)
  - `a1-new-feature/workflows/05-implement.md` (integrate new check)

### P1 — Important, Enables Reliability

#### 3. Request-Scoped vs Module-Global Pattern Not Enforced
- **Problem:** Identified pattern (1 occurrence) but not yet in agent briefs:
  - Fluid Compute (Vercel, Cloud Run) reuses processes across requests
  - Module-global state (e.g., `let globalWriter; init(w) { globalWriter = w; }`) carries wrong tenant/user context
  - Security leak: concurrent requests see each other's auth context
- **Impact:** MEDIUM-HIGH — affects serverless deployments, hard to debug post-deploy
- **Current Enforcement:** Optional learnings-index mention only
- **M6 Work:** Add mandatory section to Phase 4 wave briefs (deployment chain); update Walter + Bernd agent briefs
- **Files to Change:**
  - `a1-new-feature/workflows/04-plan.md` (add request-scoped subsection after line 140)
  - `agents/a1-pablo-planner.md` (mention in backend wave context)
  - `a1-modernize/agents/` (if backend agents present)

#### 4. Cost Tracking Missing
- **Problem:** No visibility into token spend per feature
  - Session logs exist (JSONL with hook events + token counts)
  - No aggregation by spec/phase/wave
  - VERIFICATION.md template lacks cost summary line
- **Impact:** MEDIUM — operational visibility + budget planning
- **Current Data:** Available in `~/.claude/projects/-Users-rob-code-a1-skills/*.jsonl` (JSONL format, token counts in hook events)
- **M6 Work:** Implement `a1-tools cost` subcommand; parse JSONL; aggregate and link to git history; add template to VERIFICATION.md
- **Files to Change:**
  - `_shared/a1-tools.cjs` (new `cost` subcommand group)
  - `a1-execute/workflows/03-verify.md` (add cost summary line example)

### P2 — Important for M5 Validation

#### 5. M5 (a1-modernize) Success Criteria Not Explicitly Validated
- **Problem:** Roadmap says "4 open criteria" but doesn't list them explicitly
  - Inferred from SKILL.md + commit 1cf66aa: 7-phase pipeline, 2 modes, 2 agents (Rafael, Theo), 13 CLI subcommands
  - No end-to-end test run yet on a real project
- **Impact:** MEDIUM — can't confirm M5 ready for M6 work
- **M6 Work:** Run a1-modernize end-to-end on a test project; verify 7 phases, 2 modes work; all 13 CLI subcommands functional; 2 agents deploy correctly
- **Files to Change:**
  - `.a1/phases/M6-works-for-rob/PLAN.md` (will include M5 validation wave)

### P3 — Quality & Ergonomics

#### 6. a1-analyze Agent Brief Missing Hard Read-Only Constraint
- **Problem:** Marco (a1-marco-mapper) wrote files during 2026-06/07 run, violating the design (analyze = forensic, read-only)
  - No enforcement in agent brief; only assumed behavior
- **Impact:** LOW (isolated incident) but indicates gap in directive clarity
- **M6 Work:** Add hard constraint to a1-analyze agent briefs: "return output as TEXT only; write NO files to disk. Any file write is a blocker."
- **Files to Change:**
  - `a1-analyze/agents/a1-marco-mapper.md` (add hard constraint section)
  - `a1-analyze/workflows/01-discover.md` (cascade constraint into phase-1 brief)

#### 7. No Deterministic Check for Consistency-Gate Phantoms
- **Problem:** Phantom detection (a1-phantom) exists, but is not integrated into Phase 4.5 consistency gate
- **Impact:** LOW — caught late (Phase 6 Verify) instead of Phase 4.5
- **M6 Work:** Already scoped (not blocking); no file changes needed unless a1-phantom integration desired
- **Rationale:** Phantom check requires git diff access; Phase 4 is still in wave-plan only. Gate 4.5 runs in worktree. Feasible but lower priority.

#### 8. No Unified `add-findings --json` Batch Mode
- **Problem:** RESEARCH.md mentions missing batch mode for analyze findings; workaround = repeated CLI calls
- **Impact:** LOW-MEDIUM — analyze retro friction, tooling gap
- **M6 Work:** Implement `a1-tools analyze add-findings --json <file|->` (batch mode + atomic write); add test fixture
- **Files to Change:**
  - `_shared/a1-tools.cjs` (enhance `cmdAnalyzeAddFindings`)
  - `_test-fixtures/a1-analyze/` (add batch scenario)

#### 9. M5 Validation Scope Not Explicit
- **Problem:** RESEARCH.md says "validate 4 criteria" but doesn't list them in one place
  - Scattered across roadmap.md + a1-modernize SKILL.md
- **M6 Work:** Create explicit 4-item checklist in PLAN.md wave for M5 validation
- **Files to Change:**
  - `.a1/phases/M6-works-for-rob/PLAN.md` (M5 validation wave)

---

## Relevant for M6 Execution

### What the Planner Must Know

1. **Gate 0.5 is the top blocker** — 2026-07-03 failure recurred AFTER the gate existed, proving the gap is real and high-impact. The 3 new grep patterns (heading, slug, fixture) must be documented and tested before Phase 5 waves launch.

2. **a1-tools.cjs is the single point of CLI dispatch** — Adding `schema-check` and `cost` subcommands requires:
   - New command group and 3–5 subcommands per group
   - Integration into main() dispatcher (lines 4933–5050)
   - Shared helper function(s) for schema introspection / JSONL parsing
   - Test fixtures in `_test-fixtures/` (schema-check scenario; cost fixture JSONL)

3. **Frontmatter key ordering is canonical** — Each entity type has a `*_KEY_ORDER` array (lines ~346–428). New subcommands that create/update .md files must respect these orderings to pass serialization tests.

4. **Request-scoped pattern is security-relevant** — Must be added to **Phase 4 wave briefs** (both a1-new-feature and a1-modernize), not just learnings. Affects Walter + project-specific backend agents.

5. **VERIFICATION.md template format is critical** — Cost summary line must fit the existing verdict format (✅ PASS / ⚠ PARTIAL / ❌ FAIL). See `a1-execute/workflows/03-verify.md` lines 1–58 for the template.

6. **M5 validation is dependent, not parallel** — Can't call M5 criteria "checked" until end-to-end run completes. This is a prerequisite for M6 sign-off, not a side task.

### Key Files for Planning

| File | Why It Matters | Lines / Size |
|---|---|---|
| `a1-new-feature/workflows/05-implement.md` | Gate 0.5 definition + locations to extend | 110–136 (Gate 0.5) |
| `a1-new-feature/workflows/04-plan.md` | DB-schema checklist (8 patterns); HTTP contract | 96–148 (checklist + HTTP) |
| `_shared/a1-tools.cjs` | CLI dispatch; 11 command groups; helpers | 1–5053 LOC |
| `_shared/learnings-index.md` | Pattern status (applied vs monitoring) | 1–26 (cache) |
| `a1-new-feature/_learning.md` | 17-run corpus; 2026-07-03 surface-coverage recurrence | Lines 300–309 (recurrence) |
| `a1-execute/workflows/03-verify.md` | VERIFICATION.md template format; cost summary line | Lines 1–112 |
| `docs/roadmap.md` | M6 scope + success criteria | Lines 12–34 (M6); 118+ (M5 history) |
| `.a1/phases/M6-works-for-rob/RESEARCH.md` | Full context + recommendations | Full (this file is derived from it) |

### Implementation Sequence (Dependency-Aware)

1. **Gate 0.5 extend** → Foundation; all other gates depend on this. Document 3 patterns first.
2. **Schema-check subcommand** → New CLI infrastructure; test fixture required. Parallel with Gate 0.5.
3. **Request-scoped briefs** → Documentation update; no CLI changes. Can happen in parallel.
4. **Cost-tracker subcommand** → JSONL parsing; new CLI group. Parallel with schema-check.
5. **M5 validation end-to-end** → Prerequisite check; can run in parallel if isolated test project available.
6. **Finalize VERIFICATION.md template** → Last, integrates cost summary from step 4.

### Success Criteria (from roadmap.md)

- [ ] Gate 0.5 catches a content-derived surface gap on a real run (or 5 clean runs pass)
- [ ] `add-findings --json` lands with fixture test
- [ ] Cost per feature visible in VERIFICATION.md for 3 consecutive specs
- [ ] M5 criteria all checked

---

## Architecture Layers (Conceptual)

```
┌─────────────────────────────────────────────────────────┐
│  User Request (e.g., "new feature for project-x")       │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Skill (a1-new-feature/a1-modernize/a1-analyze/etc.)   │
│  - Phase workflows (markdown + shell/prompt)            │
│  - Sub-agent delegation                                 │
│  - Phase-state transitions                              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  a1-tools.cjs (CLI Dispatch Layer)                      │
│  - Command group routing (spec, fix, analyze, etc.)     │
│  - Deterministic file ops (readMd, writeMdAtomic)       │
│  - Status set validation                                │
│  - Frontmatter serialization + key ordering             │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Data Layer (Files + Vault)                             │
│  - Specs: projects/<slug>/spec/NNN-*.md (YAML + body)   │
│  - Plans: projects/<slug>/plans/*-wave-plan.md          │
│  - Learning: pattern/a1-learnings/index.md              │
│  - Session logs: ~/.claude/projects/*/X.jsonl           │
└─────────────────────────────────────────────────────────┘
```

---

## Known Limitations & Tech Debt

| Issue | Scope | Impact | Priority |
|---|---|---|---|
| **No schema introspection library** | Schema-check subcommand | Audit-trigger check requires `psql` CLI; FK type check needs SQL parser | M6 (mitigated by partial checks + narrative) |
| **JSONL token-count location unclear** | Cost-tracker subcommand | Hook event structure must be inspected before implementation | M6 (RESEARCH.md has initial probing) |
| **Phantom check not in Phase 4.5 gate** | a1-check consistency gate | Catches phantoms late (Phase 6) instead of Phase 4.5 | M6 (deferred, requires git access) |
| **Module-global pattern enforcement** | Agent briefs | Current: optional learnings mention; needs hard constraint in briefs | M6 (text-only changes) |
| **Install.sh drift** | Deployment | checkpoint skill deliberately excluded but not documented; drift between skills/ and install.sh | M6 scope (not blocking M6) |
| **Hardcoded `/Users/rob/` paths** | Portability | ~30 sites; M7 will unify to `A1_VAULT_ROOT` + repo-local | M7 (not M6 blocker) |

---

## Testing & Validation Approach

### Deterministic Checks (No Flake)

- **Gate 0.5 (surface coverage):** Grep-based; 100% deterministic. Validate on 2–3 real waves before shipping.
- **Consistency-gate (Phase 4.5):** FR bijection + phantom detection. Fixtures exist; add new `fail-surface-gap` scenario.
- **Schema-check:** Deterministic for 3/6 checks (audit-trigger, RLS, FK); semantic 3 remain in narrative.

### Learning Retro Format

Every execution records structured `_learning.md` entry (see `a1-execute/workflows/03-verify.md` lines 66–112):
```yaml
date: YYYY-MM-DD
phase: <phase-name>
project: <project-slug>
result: pass | partial | fail
waves_executed: N
observations_total: M
observations_major_plus: K
issue_classes: [tag1, tag2, ...]
phase_that_produced_most_issues: <phase>
one_line_learning: <what would prevent the issue>
```

Threshold: 5 entries → recommend `a1-evolve` synthesis run.

---

## Summary for Executor

**M6 "Works for Rob" targets 4 core improvements:**

1. **Extend Gate 0.5** to catch content-derived surfaces (heading counts, classification lists, test fixtures) that slip through today's 5-surface check.

2. **Add CLI schema validation** (`a1-tools schema-check`) for deterministic pre-flight checks (audit-trigger, RLS-enable, FK-types) before wave implementation.

3. **Promote security pattern** (request-scoped state on serverless) from optional learnings to hard constraint in Phase 4 wave briefs for Walter + backend agents.

4. **Build cost tracker** (`a1-tools cost`) to parse session logs, aggregate token spend per spec/phase/wave, and surface summary in VERIFICATION.md.

**Prerequisite:** Validate M5 (a1-modernize) end-to-end on a test project to confirm all 4 success criteria.

**Main artifact:** `_shared/a1-tools.cjs` will grow by ~200–300 LOC (schema-check + cost subcommands, JSONL parsing helpers). Workflows will change minimally (text additions to briefs). Test fixtures will add 2–3 new scenarios.

---

**Status:** Map complete. Ready for PLAN.md (Phase 2) and wave decomposition.

