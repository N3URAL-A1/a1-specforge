---
goal: M6 "Works for Rob" — reliability hardening of a1-specforge framework
generated: 2026-07-04
---

# Research: M6 "Works for Rob" — Reliability Hardening

## Executive Summary

M6 focuses on **four interconnected reliability improvements** to make a1-specforge's 16-skill framework production-ready for Robert's daily feature builds. The main challenge: **content-derived surface coverage** (headings, classification lists, test fixtures) escaped the current Gate 0.5 and recurred 2026-07-03. Secondary work addresses security-scoped request handling, schema-flaw determinism, and cost tracking from session logs.

---

## Tech Stack

**Project:** a1-specforge (the framework itself — repo: `/Users/rob/code/a1-skills/`)

| Component | Version / Location | Notes |
|---|---|---|
| **Node.js CLI** | `~/.claude/skills/_shared/a1-tools.cjs` | 13 modernize subcommands, consistency-check gate, spec state mgmt |
| **Phase Workflows** | `a1-new-feature/workflows/` | 6 phases: discover → spec → clarify → plan → implement → verify |
| **Gate System** | Gate 0 (agent self-report), Gate 0.5 (surface-coverage), Gate 1-3 (build/deploy/smoke) | Gates are mandatory per-wave; Gate 0.5 is the improvement target |
| **Learning Loop** | `_learning.md` per skill + `a1-evolve` synthesis → Obsidian Vault | 17 runs captured, 12 patterns applied (threshold: 3+ same tag) |
| **Session Logs** | `~/.claude/projects/-Users-rob-code-a1-skills/*.jsonl` | JSONL per session with hook events + token usage |

**Active Skills:** 16 shipped (a1-new-feature, a1-fix, a1-plan, a1-execute, a1-analyze, a1-modernize, etc.)

---

## Relevant Codebase Patterns

### Gate 0.5 — Surface Coverage (Current Implementation)

**Location:** `/Users/rob/code/a1-skills/a1-new-feature/workflows/05-implement.md` lines 110–136

**Current scope (what it checks):**
```
For each new/changed DB column/entity field/domain concept:
  1. All write paths (grep INSERT/update/create across app/, lib/, packages/)
  2. Read path / JOIN (SELECT must include the field)
  3. Detail / list render (component displays the field)
  4. API response shape (correct envelope key: {items} vs {data})
  5. Sync / mirror logic (twin/shadow rows carry all relevant fields)
```

**Gap identified (2026-07-03, spec 001-homepage-redesign):**
- New case study added to the CRM platform
- Coverage checked: DB field ✓, API endpoint ✓, UI detail ✓
- **Missed:** Content-derived surfaces:
  - Heading count ("Three Products" text only appears in heading count, not as a variable)
  - Classification list (`AI_PRODUCT_SLUGS` enum/constant list in multiple places)
  - Test fixtures (fixture data must enumerate the new case study)
  - Second learning from same run: agent messaging order-of-operations (commit state not checked after dispatch)

**How Gate 0.5 currently works:**
- Executed manually by user/orchestrator during Phase 5 (Implement)
- Grep-based spot-check; no deterministic CLI validation
- Failures are caught during smoke-test (Gate 3) or post-deploy

**What needs to change:**
- Extend grep rule to catch `<new_entity_name>` in:
  - Heading text / copy (e.g., `"Three Products"` must be updated if count changes)
  - Slug/constant lists (e.g., `export const AI_PRODUCT_SLUGS = [...]`)
  - Test fixtures / mockdata (all entity-lists must include new instance)
- Rule: **for each new field/concept, grep the name across `copy/` + `lib/constants/` + `tests/_fixtures/` + main write/read surfaces**

---

### Schema-Flaw Checklist (Determinism Opportunity)

**Location:** `/Users/rob/code/a1-skills/a1-new-feature/workflows/04-plan.md` lines 123–139

**Current implementation:** Narrative checklist in wave brief:
```
- Audit trigger? Does the table have audit_row AFTER-trigger?
- RLS + GRANT matrix? ENABLE+FORCE RLS + matching GRANTs?
- FK types match? FK column type == referenced PK type?
- Enum / CHECK values complete?
- Migration hygiene? -down.sql reversible, no embedded BEGIN/COMMIT?
- Expand→Migrate→Contract? 2-PR split on column drops?
```

**Recurrence pattern (8× across 17 feature runs):**
```
Bug class: schema_flaw
Examples:
  - Missing audit trigger on time_entries (Spec 004, 2026-06-04)
  - Connection leak: idle-in-tx blocking VACUUM (Spec 001, 2026-06-03)
  - FK type mismatch: string "klaus" into uuid FK (implied in checklist)
  - Enum/CHECK gaps: code writes 'declined'/'api' not in enum (Spec 010)
  - Expand→Migrate→Contract outage: deploy order reversed (Spec 006)
```

**Current friction:**
- Checklist is prose in the wave brief
- No deterministic CLI validation (human recall only)
- Failures caught at deploy time or Verify phase (late)

**Feasibility of deterministic check:**
- **Audit trigger:** `psql -c "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = '<table>' AND trigger_name LIKE '%audit%'"`
  - Feasible if project has consistent trigger naming (`audit_row`, `log_changes`, etc.)
  - Would need to be per-project config (naming convention varies)
- **RLS status:** `psql -c "SELECT rowsecurity FROM pg_tables WHERE tablename = '<table>'"`
  - Feasible; deterministic boolean
- **FK type mismatch:** Parse migration SQL + compare PK/FK column definitions
  - Harder (SQL parser needed) but doable with grep + schema introspection
- **Enum/CHECK completeness:** Requires code analysis (grep code for writes + compare to schema definition)
  - Feasible but not deterministic without semantic parsing

**Recommendation:** Implement a `a1-tools schema-check` subcommand for the 3 deterministic checks (audit-trigger, RLS-enable, FK-types) as Phase 5 pre-gate; keep the semantic checks (enum-completeness, expand-migrate-contract) in the wave brief.

---

### Request-Scoped vs Module-Global Pattern

**Location (where it's documented):** `/Users/rob/code/a1-skills/_shared/learnings-index.md`

```
Monitoring (watch, below/at threshold or partly covered):
  request_scoped_not_module_global (1) — module-global injected state (writer/handler) 
  leaks across concurrent requests on Fluid Compute; pass request-scoped (security-relevant)
```

**Impact:** Security leak on Fluid Compute (Google Cloud Run, Vercel Serverless) where multiple requests share the same process. Module-global state (e.g., `let globalWriter = null; export function init(w) { globalWriter = w; }`) can carry the wrong tenant/user context across requests.

**Where to enforce:** Agent briefs for backend/web developers:
- **Walter** (generic web/backend agent)
- **Bernd** (Cloud Functions backend)
- **Project-specific backend agents** (if present in CLAUDE.md)

**Current enforcement:** Only in learnings-index (optional). Need to add to:
1. `a1-new-feature/workflows/04-plan.md` — add to HTTP contract section (after line 100)
2. Backend/Bernd wave brief template
3. Any project using Fluid Compute or serverless

**How to document:** Add a subsection to the Deployment Chain section:

```
**Request-scoped state (mandatory for serverless/Fluid Compute):**
If the wave touches any module-global state (injected dependencies, cached connections, 
auth context), ensure:
- State is instantiated per-request, not once at module load
- No `let globalX = null; init(x) { globalX = x }` pattern
- Pass context as function parameters or request-scoped containers
- Specifically check: Database connections, auth handlers, config loaders
```

---

## External Dependencies

| Dependency | Current | Required | Notes |
|---|---|---|---|
| **Claude Code session logs (JSONL)** | Located in `~/.claude/projects/-Users-rob-code-<project>/` | Available now | Token data structure: explore format, extract model/usage/cost fields |
| **Obsidian Vault** | `~/N3URAL-Vault/pattern/a1-learnings/` (canonical) | Optional, default `.a1/learnings/` | Learning store migration happens in M7; M6 can read both |
| **PostgreSQL schema introspection** | Project-dependent (Cloud SQL or local) | Needed for schema-check CLI | `psql` or `pg_dump` required |

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Gate 0.5 extension incomplete** | Surface gaps slip to production (like 2026-07-03) | Write 3 concrete grep patterns (heading/slug/fixture); test on real wave before shipping |
| **Schema-check CLI too rigid** | Project-specific naming conventions don't match; false positives | Make trigger name configurable per project; provide override in constitution |
| **Session log structure unknown** | Token tracking subcommand can't extract cost data | Immediately inspect JSONL format on this machine (done below) |
| **Request-scoped not adopted** | Fluid Compute security leak remains in codebase | Add to Bernd + Walter briefs + constitution security section; require in Phase 4 (Plan) brief |
| **M5 success criteria undefined** | Can't validate which 4 criteria to check off | Infer from SKILL.md: (1) 7-phase pipeline works, (2) 2 modes (spec-only/full), (3) 2 new agents deployed, (4) 13 CLI subcommands functional |

---

## Research Findings

### 1. Gate 0.5 Current State

**File:** `/Users/rob/code/a1-skills/a1-new-feature/workflows/05-implement.md` lines 110–136

The gate is narrative, not deterministic. It checks 5 surfaces per new DB field:
1. Write paths (grep INSERT/update)
2. Read path / JOIN
3. Detail / list render
4. API response shape
5. Sync / mirror logic

**2026-07-03 recurrence proof:** Spec 001-homepage-redesign (n3ural-website), bugs #1-2 found in Phase 6:
- New case study added
- Bug: "Three Products" heading text became "Four Products" but test still said "Three"
- Bug: AI_PRODUCT_SLUGS list was updated but one file had the old hardcoded count
- Root cause: Content-derived surfaces (heading copy, classification constants, fixtures) not in the grep scope

**Required extension:** Add 3 new surface types:
- **Heading count / copy:** `grep "Three Products\|Four Products" app/ lib/ tests/` (updated text must appear in ALL surfaces)
- **Classification lists:** `grep "AI_PRODUCT_SLUGS" app/ lib/ packages/ (new slug must be in all list definitions)
- **Test fixtures:** `grep "<new_entity_name>" tests/_fixtures/ tests/mocks/ (new instance in all fixture files)

---

### 2. Schema-Flaw Determinism

**Pattern source:** `/Users/rob/code/a1-skills/_shared/learnings-index.md` (8 occurrences, high-impact)

**Deterministic checks available:**

```bash
# Audit trigger check
psql -c "SELECT COUNT(*) FROM information_schema.triggers 
WHERE event_object_table = '$TABLE' AND trigger_name ~ 'audit|log'" 

# RLS enable check
psql -c "SELECT rowsecurity FROM pg_tables WHERE tablename = '$TABLE'"

# FK type check (requires parsing migration files + schema)
# Less deterministic; recommend grep-based validation
```

**Recommendation:** Implement `a1-tools schema-check <table-name>` for the 2 deterministic ones (audit-trigger, RLS); keep the rest (enum-completeness, expand-migrate-contract) in the narrative checklist.

---

### 3. Session Log Structure (Token Tracking)

**Location:** `~/.claude/projects/-Users-rob-code-a1-skills/` contains:
- `5c1d7d8c-4fb8-4a42-9d94-4715b3fdd8e9.jsonl` (842 KB, current session)
- `dc31e5b8-f57c-46cf-b8b2-7ddd2e7dcf60.jsonl` (1.9 MB, previous session)
- `10f9feac-7026-4b51-85fe-1e97f3218c01.jsonl` (617 KB)
- Plus sub-agent logs in `subagents/` folder (`.meta.json` + `.jsonl` per agent)

**JSONL structure sample (first line):**
```json
{"type":"last-prompt","leafUuid":"9eb030cd-0cae-422b-9569-50ffbd57abe7","sessionId":"5c1d7d8c-4fb8-4a42-9d94-4715b3fdd8e9"}
```

**Token data location:** Grep for `"token"` or `"usage"` fields in JSONL:
```bash
grep -i "token\|usage\|cost" ~/.claude/projects/-Users-rob-code-a1-skills/5c1d7d8c-4fb8-4a42-9d94-4715b3fdd8e9.jsonl | head -3
```
Returns hook events with embedded token counts (22,675 tokens to read, 311,791 spent on work).

**Format:** Token data is embedded in `hook_success` events with `"type":"hook_success"` and a `content` field containing structured JSON with `hookSpecificOutput.additionalContext`.

**Feasibility:** High — token data exists in structured form. A cost-tracker subcommand would:
1. Parse all `.jsonl` files in project directory
2. Extract token counts from hook events
3. Map to spec/phase/wave (via session metadata + git history linking)
4. Aggregate and report per feature

---

### 4. Request-Scoped Pattern Adoption

**Current mention:** `/Users/rob/code/a1-skills/_shared/learnings-index.md` (monitoring list, 1 occurrence)

**Not yet enforced in:**
- `a1-new-feature/workflows/04-plan.md` wave-brief template
- Agent briefs for Walter, Bernd, or project-specific backend agents
- `a1-constitution` security layer

**Security relevance:** High on Fluid Compute (Vercel, Cloud Run) where process reuse across requests is the deployment model.

**Fix required:** Add mandatory security check in Phase 4 (Plan) and Phase 5 (Implement) briefs for any wave touching:
- Database connections
- Auth context / tokens
- Dependency injection / IoC containers
- Module-global state

---

### 5. M5 Success Criteria (Implicit)

**Source:** Roadmap says "4 open a1-modernize success criteria" but doesn't list them explicitly.

**Inferred from a1-modernize SKILL.md and commit 1cf66aa:**

The 4 criteria likely correspond to:
1. **7-phase pipeline functional** — Scope → Reverse-Spec → Gap-Analysis → Tech-Proposals → Plan → Execute → Publish (Phase 1–3 for spec-only, all 7 for full mode)
2. **2 modes working** — spec-only (phases 1–3, read-only), full (all 7 phases with code changes)
3. **2 new agents integrated** — a1-rafael-reverse-spec (Phase 2) + a1-theo-test-engineer (Phase 6)
4. **13 CLI subcommands usable** — a1-tools modernize: init, next-slot, update-status, discover-stack, add-proposal, approve-proposal, add-wave, snapshot-behavior, start-wave, complete-wave, verify-parity, publish-notion, list

**Validation approach (M6):** Run a modernize end-to-end on a real project (or test case) covering all 4 areas, check that Phase outputs are valid and CLI commands execute without errors.

**Current status:** No production modernize run yet (noted in project memory as "Kein produktiver Lauf noch").

---

## Recommendations

### 1. **Extend Gate 0.5 with content-derived surfaces** (P0 — highest risk)
   - Add 3 new grep patterns: heading text, classification lists, test fixtures
   - Document in `/Users/rob/code/a1-skills/a1-new-feature/workflows/05-implement.md`
   - Test on next 2–3 waves to validate catch rate
   - Target: "Gate 0.5 catches a content-derived gap or 5 clean runs pass" ✓ (roadmap success criterion)

### 2. **Implement `a1-tools schema-check` subcommand** (P1 — medium friction)
   - Add deterministic CLI validator for audit-trigger + RLS-enable + FK-types
   - Make trigger naming configurable per project (constitution section)
   - Run as optional pre-gate in Phase 5 before wave sign-off
   - Complement with narrative checklist for semantic checks (enum-completeness, expand-migrate-contract)

### 3. **Promote `request_scoped_not_module_global` into agent briefs** (P1 — security)
   - Add mandatory section to Phase 4 wave briefs (deployment chain area)
   - Update Walter + Bernd agent briefs to mention serverless context
   - Add security-rule to `constitution.md` (all projects: "no module-global state on serverless")
   - Document common patterns: request-scoped containers, parameter-passing, connection pooling

### 4. **Build cost-tracker v1** (P2 — visibility, not critical)
   - Implement `a1-tools cost` subcommand to parse session logs
   - Extract token counts from JSONL hook events
   - Aggregate per spec/phase/wave (with git history linking)
   - Add summary line to VERIFICATION.md: "Cost: NNN tokens (XXX input, YYY reasoning, ZZZ output)"
   - Target: "Cost per feature visible in VERIFICATION.md for 3 consecutive specs" ✓

### 5. **Validate M5 success criteria end-to-end** (P2 — quality gate)
   - Run a full a1-modernize pipeline on a real or test project
   - Verify: 7 phases complete, 2 modes functional, 2 agents deploy correctly, all 13 CLI subcommands execute
   - Document outcome + any blockers
   - Check off: "M5 criteria all checked" ✓

---

## Key File References

| File | Purpose | Lines/Status |
|---|---|---|
| `/Users/rob/code/a1-skills/a1-new-feature/workflows/05-implement.md` | Phase 5 (Implement) orchestrator; Gate 0.5 documented here | Lines 110–136 (surface-coverage) |
| `/Users/rob/code/a1-skills/a1-new-feature/workflows/04-plan.md` | Phase 4 (Plan) brief template; schema-flaw checklist | Lines 96–139 (schema checklist) |
| `/Users/rob/code/a1-skills/_shared/learnings-index.md` | Pattern library; schema_flaw + request_scoped noted | Lines 17, 25 (patterns) |
| `/Users/rob/code/a1-skills/a1-new-feature/_learning.md` | 17 feature runs, 12 patterns extracted; 2026-07-03 recurrence | Lines 300–309 (surface-coverage failure) |
| `/Users/rob/code/a1-skills/a1-modernize/SKILL.md` | M5 skill definition; 7 phases, 13 CLI subcommands | Lines 1–199 (full spec) |
| `/Users/rob/code/a1-skills/docs/roadmap.md` | M6 scope + M5 criteria | Lines 12–35 (M6), 118 (M5 history) |
| `~/.claude/projects/-Users-rob-code-a1-skills/5c1d7d8c-4fb8-4a42-9d94-4715b3fdd8e9.jsonl` | Current session logs with token data | JSONL format (hook events) |
| `/Users/rob/code/a1-skills/_shared/a1-tools.cjs` | CLI helper; consistency-check gate, spec state, modernize subcommands | Lines 1–50+ (structure) |

---

## Data Availability Summary

| Data Point | Available? | Location | Format |
|---|---|---|---|
| **Gate 0.5 implementation** | ✓ Yes | `a1-new-feature/workflows/05-implement.md:110–136` | Markdown narrative |
| **Schema-flaw pattern** | ✓ Yes | `_shared/learnings-index.md`, `a1-new-feature/_learning.md` | Markdown with examples |
| **2026-07-03 surface-coverage failure** | ✓ Yes | `a1-new-feature/_learning.md:300–309` | Learning entry (homepage-redesign spec) |
| **Request-scoped security pattern** | ✓ Yes | `_shared/learnings-index.md` | Pattern entry (1 occurrence, monitoring) |
| **M5 skill definition** | ✓ Yes | `a1-modernize/SKILL.md` | Full skill documentation |
| **Session token logs** | ✓ Yes | `~/.claude/projects/-Users-rob-code-a1-skills/*.jsonl` | JSONL (hook events with token counts) |
| **M5 success criteria (explicit list)** | ⚠️ Implicit | `docs/roadmap.md`, memory, a1-modernize SKILL.md | Inferred from architecture (4 areas) |

---

## Next Steps for Executor

1. **Validate Gate 0.5 extension:** Create 3 concrete grep patterns for heading/slug/fixture coverage; document in workflow
2. **Explore JSONL token format:** Run cost-tracker spike on one session log to confirm data extraction feasibility
3. **Draft schema-check CLI:** Implement 2 deterministic checks (audit-trigger, RLS-enable); test on a project schema
4. **Update agent briefs:** Add request-scoped-state mandatory check to Phase 4 wave template + Bernd/Walter agent links
5. **Plan M5 validation run:** Identify a test project for end-to-end modernize pipeline (small codebase, clear tech stack)

---

**Status:** Research complete. Ready for planning phase.
**Risk level for M6 execution:** MEDIUM (Gate 0.5 extension needed before any waves; schema-check + cost-tracker are parallel work).
