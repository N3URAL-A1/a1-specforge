# M5 Validation — a1-modernize end-to-end (Task 3.2)

**Date:** 2026-07-05 · **Test project:** disposable Node.js order service (2 endpoints, missing input validation, unexplained pricing constants 737/41) in session scratchpad · **Master files:** Vault `projects/m5-toy-spec-only/modernize/2026-07-05-spec-only.md`, `projects/m5-toy-app/modernize/2026-07-05-full.md`

Criteria per RESEARCH.md decomposition (used verbatim). Gates G1–G6 auto-approved as part of the M6 Task 3.2 validation harness (Robert approved the M6 plan).

## Criterion 1 — 7-phase pipeline works: PASS
Full mode ran Scope → Reverse-Spec → Gap-Analysis → Tech-Proposals → Plan → Execute → Publish; every phase produced its artifact and the status machine advanced scoped → spec-drafted → gap-analyzed → proposals-pending → planned → executing → executed → published (see master file phase_history). Publish used the documented local-markdown fallback (`modernize-export/report.md` written; no Notion in harness).

## Criterion 2 — 2 modes working (spec-only / full): PASS
Spec-only run on a fresh copy reached terminal `gap-analyzed` with a complete reverse-spec; `git status --porcelain` on the analyzed tree: 0 changes (read-only honored). Full mode covered by Criterion 1.

## Criterion 3 — 2 new agents integrated (Rafael, Theo): PASS
- a1-rafael-reverse-spec extracted 4 FRs with ACs, data model, flows, and **8 `open_question` entries** — including exactly the planted ambiguities (magic constants 737/41, missing-validation intent). Did not guess.
- a1-theo-test-engineer produced skeleton tests BEFORE implementation: 6 parity assertions (each marked `// PARITY:`, derived from the live behavior snapshot) green pre-change, 3 new-behavior skeletons todo. After wave W-01 (input validation): 9/9 green.
- Parity: `snapshot-behavior` before, live replay after — snapshot diff **identical**; `verify-parity` reports baseline; `complete-wave --snapshot-replay pass` accepted, `fail` correctly blocks (fixture-asserted).

## Criterion 4 — 13 CLI subcommands usable: PASS
Dispatch smoke (missing-args invocation; "OK" = usage/expected error, never unknown-command/crash):

| Subcommand | Result | Subcommand | Result |
|---|---|---|---|
| init | OK (usage, 1) | start-wave | OK (usage, 1) |
| next-slot | OK (usage, 1) | complete-wave | OK (usage, 1) |
| update-status | OK (usage, 1) | verify-parity | OK (usage, 1) |
| discover-stack | OK (usage, 1) | publish-notion | OK (usage, 1) |
| add-proposal | OK (usage, 1) | list | OK (0) |
| approve-proposal | OK (usage, 1) | | |
| add-wave | OK (usage, 1) | | |
| snapshot-behavior | OK (usage, 1) | | |

13/13 dispatch cleanly.

## Bugs found by this validation (fixed immediately, per-commit)
1. **Frontmatter round-trip:** `approve-proposal`/`start-wave`/`complete-wave` couldn't find just-created entries — writeMdAtomic serializes object arrays as JSON strings, lookups expected objects. Fix + regression fixture `_test-fixtures/a1-modernize-roundtrip/run.sh`: commit `3bb69ac`.
2. **parity_baseline convention mismatch:** `snapshot-behavior` set object properties on the key=val string array seeded by `init` — fields silently lost; `verify-parity` reported nulls. Fix (parityBaselineToMap, both commands) + fixture extension: commit `29ab286`.

Note: the validation deliberately exercised the state machine end-to-end — both bugs were unreachable by the dispatch smoke alone. This is the M5 "success criteria still open" gap the roadmap flagged: shipped but never end-to-end validated.

## Verdict
All 4 criteria PASS (after the two CLI fixes). M5 can be checked off in docs/roadmap.md.
