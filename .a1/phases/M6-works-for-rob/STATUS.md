# STATUS — M6-works-for-rob

## Wave 1 — Documentation gates + format spike + analyze fixture
Completed: 2026-07-04

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1.1 Gate 0.5 content-derived surfaces | ✓ DONE | fc84091 | 3 surfaces + umbrella rule + fail instruction + 2026-07-03 rationale |
| 1.2 request_scoped_not_module_global in briefs | ✓ DONE | e4c1941 | 04-plan.md, a1-pablo-planner.md, a1-erik-executor.md (canonical file — a1-modernize/agents/ has -link.md pointer files, no symlinks), learnings-index → Applied |
| 1.3 Cost JSONL format spike + fixture | ✓ DONE | 98f7c7a | Wave-2 entry condition satisfied: exact field paths in _shared/cost-format-notes.md |
| 1.4 add-findings --json fixture suite | ✓ DONE | 96f921e | 4/4 cases pass, self-cleaning temp dir |

### Deviations
- [Task 1.3] Plan-internal contradiction: action 4 asked for "representative" lines incl. structure of real logs, Done-when requires every fixture line valid JSON → shipped valid-only fixture; malformed-line skip-behavior deferred to Task 2.2 run.sh (noted in expected.md + observations.jsonl, pattern=vague_action).
- [Task 1.3 finding, feeds Wave 2] Streamed assistant messages duplicate usage per message.id (272 lines → 152 unique ids); cost MUST dedup by message.id. Sub-agent usage lives in <sessionId>/subagents/agent-*.jsonl and is NOT in main-session totals → must be added.

### Wave 2 entry condition
`_shared/cost-format-notes.md` exists with exact field paths (message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}, message.model, .timestamp, .sessionId). No fallback re-scope needed.
## Wave 2 — CLI implementation (schema-check + cost)
Completed: 2026-07-04

| Task | Status | Commit | Notes |
|---|---|---|---|
| 2.1a schema-check SQL parser + parser fixtures | ✓ DONE | 7f1497f | Bounded subset documented in HELP + comment block; `schema-check parse` debug mode; parser fixture PASS |
| 2.1b schema-check run (audit/RLS/FK) + 5 scenarios + gate hook | ✓ DONE | d4feaf6 | Exit codes 0/1/1/1/2 asserted; Gate 0.6 hook in 05-implement.md; pointer note in 04-plan.md migration checklist |
| 2.2 cost run v1 + fixture | ✓ DONE | 1ced18a | Dedup by message.id (last wins), subagents/*.jsonl added, totals 51100 exact match; --since window 25700; malformed-line skip test in run.sh per expected.md delegation |

Entry condition honored: implemented against `_shared/cost-format-notes.md` field paths; no fallback re-scope needed.

Regression after Wave 2: all 8 `_test-fixtures/*/run*.sh` runners PASS (analyze-cli, check, checklist, cost, pr-review, reconcile, schema-check, worktree); `node --check _shared/a1-tools.cjs` OK; `--help` dispatch OK.

### Deviations
- None. No plan gaps, no scope changes (no observations written — smooth execution).
