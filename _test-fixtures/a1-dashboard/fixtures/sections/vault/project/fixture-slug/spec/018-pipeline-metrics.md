---
id: 018-pipeline-metrics
project: a1-specforge
feature_slug: pipeline-metrics
title: "Measure the pipeline: escaped-defect attribution and cost per feature"
status: done
created: 2026-10-15
phase_history:
  - "phase=discover completed=2026-10-15T08:05:15.577Z"
  - "phase=specify completed=2026-10-15T08:08:51.626Z"
  - "phase=clarify completed=2026-10-15T08:08:51.627Z"
  - "phase=plan completed=2026-10-15T08:12:53.138Z"
  - "phase=implement completed=2026-10-23T11:26:35.037Z"
  - "phase=verify completed=2026-10-23T11:26:35.038Z"
wave_plan_path: project/a1-specforge/plans/018-pipeline-metrics-wave-plan.md
verify_failures: []
permalink: vault/project/a1-specforge/spec/018-pipeline-metrics
roadmap_entry: continuous
size: M
type: spec
---

# Measure the pipeline: escaped-defect attribution and cost per feature

> Spec ID: `018-pipeline-metrics` · Project: `a1-specforge` · Status: `done`

---

## Discovery — Problem

- VISION success criterion (`docs/VISION.md:65`): "zero escaped BLOCKER bugs over a rolling 10-run window and visible cost per feature". Neither half is measurable today (analysis 2026-10-14, section A).
- Postmortem frontmatter written by `fix init-postmortem` (`_shared/lib/fix.cjs:328-341`) has `severity`, `root_cause_class`, `phase_that_produced_most_friction` but no `found_by` and no `should_have_caught`. Nothing reads postmortems back except promote-lessons. Nothing validates the postmortem frontmatter (no validator found for `root_cause_class`; `retro-validate.cjs` validates retro blocks only).
- Cost: `agents/a1-victor-verifier.md:165-177` mandates a `Cost:` line and runs `cost run` (`_shared/lib/cost.cjs`, exists, tested in `_test-fixtures/a1-cost/`). Measured: 28 of 43 VERIFICATION.md carry a cost line, a1-office 0 of 20 (analysis). Formats differ (`**Cost:** N tokens (...)`, `Cost: N tokens (...)`, `see cost line at bottom`). No aggregation CLI exists. a1-fix writes no cost line at all.
- Measured in the vault: 6 postmortems (`postmortems/`), 11 fix reports (`fixes/`), 6 postmortem files only for fixes that wrote one.

## Discovery — Primary User

- Robert (owner, non-developer): wants one number for "did the pipeline let a blocker through" and one for "what does a feature cost", without reading files.
- `a1-evolve` and `a1-reconcile` as consumers of the numbers (evidence for gate ROI, next to `gates_fired`).

## Discovery — User Journey

- a1-fix finishes: the postmortem records `found_by` and `should_have_caught`, and the fix report records a cost line. A bug found after merge by the user gets `found_by: user`, `should_have_caught: <gate/reviewer>`.
- Owner or evolve runs `a1-tools metrics escaped --last 10` and gets count plus the list of escaped postmortems; runs `a1-tools metrics cost` and gets tokens per feature/fix, with an explicit count of runs that report no cost.

## Discovery — Acceptance Criteria

- New postmortems carry both fields; invalid values are rejected at write time. Old postmortems (6) still validate and read as `unknown`.
- Escaped counter returns an exact integer and the evidence list for a fixture vault; cost report sums an exact token total for fixture VERIFICATION.md files and lists unreported runs.
- Everything is deterministic CLI code with fixtures copied from real vault files.

## Discovery — Success Metrics

- Escaped-BLOCKER count over the last 10 runs is computable in one command (VISION:65 becomes measurable).
- Cost coverage: share of runs with a parsable cost line is reported, baseline 28/43 (65 percent).

## Discovery — Out of Scope

- Changing gates, verifier or fix workflows beyond writing the new fields and the fix cost line (spec 017 owns enforcement).
- Money conversion (price per token), dashboards (a1-dashboard), historic backfill of cost for a1-office.
- Auto-blocking on a non-zero escaped count.

## Discovery — Edge Cases

- Legacy postmortems without the fields; free-form legacy cost lines; `Cost: unavailable (...)`; VERIFICATION.md with several cost lines (delta runs, M12/M13 style); cost lines with thousands separators; bug found in a repo with no vault; a postmortem with `should_have_caught` naming a gate that no longer exists in the registry; fewer than N runs in history; hostile values (newlines, YAML injection) in the new fields.

## Discovery — Compliance

- No personal data. Cost lines hold token counts only, never session content. Local files only.

## Discovery — Dependencies

- Spec 017 (`017-enforced-self-checks`, status planned) excludes these items and claims `_shared/lib/fix.cjs`, `_shared/retro-template.md`, `_shared/lib/retro-validate.cjs`. Implementation of 018 starts after 017 merges (body-level `depends_on: 017-enforced-self-checks`; frontmatter has no such field).
- Existing: `_shared/lib/cost.cjs`, `_shared/lib/gate-ids.cjs`, `_shared/gates-registry.md`, `agents/a1-victor-verifier.md` cost step.

## Discovery — Priority

- Roadmap entry `continuous` (package 3 "Measure"). Size M. Follows 017 because of file claims.

---

<!--
  Phase 2 (Specify) content below.
-->

## Overview

The pipeline claims "zero escaped BLOCKER over 10 runs" and "visible cost per feature" but measures neither. This spec adds `found_by` and `should_have_caught` to the postmortem schema, defines an "escaped BLOCKER", and adds two read-only CLI reports: an escaped-BLOCKER counter over the last N runs and a token-cost aggregation over VERIFICATION.md and fix reports. It reuses `cost.cjs` and the existing Victor cost line; it adds no dependencies and gates nothing.

**Definitions (owner-confirmed 2026-10-15, see Clarifications):**
- *Run*: a spec with `status: done` or a fix report with `status: fixed`, ordered by completion date (specs: last timestamp in `phase_history`, else `created`; fixes: the `YYYY-MM-DD` filename prefix).
- *Escaped BLOCKER*: a postmortem with `severity: blocker`, `found_by` in {`user`, `post-merge-ci`, `production`} (found after merge by a party outside the pipeline), and `should_have_caught` naming a pipeline gate ID or reviewer agent (not `none`, not `unknown`).

## User Stories

### P1 (Must-have)

**US-018-1** — **As** the owner, **I want** each postmortem to record who found the bug and who should have caught it, **So that** escaped bugs are attributable to a specific gate or reviewer.

**US-018-2** — **As** the owner, **I want** one command that counts escaped BLOCKERs over the last N runs, **So that** the VISION metric is a number, not a feeling.

**US-018-3** — **As** the owner, **I want** one command that reports token cost per feature and per fix, **So that** cost per feature is visible and I can see which runs report no cost.

### P2 (Should-have)

**US-018-4** — **As** `a1-evolve`, **I want** the escaped list grouped by `should_have_caught`, **So that** the gate with the most misses is the next hardening target.

## Functional Requirements

- **FR-001** — `fix init-postmortem` (`cmdFixInitPostmortem`, flag table in `fix.cjs`) accepts `--found-by` and `--should-have-caught` and writes both as frontmatter keys `found_by` and `should_have_caught`; the default when a flag is absent is `unknown`.
  - AC: run with both flags, the file contains both keys with the given values; run without, both are `unknown`.
- **FR-002** — New CLI `fix validate-postmortem <file>` and `init-postmortem` both reject `found_by` values outside {registered gate ID, `reviewer:<agent>`, `user`, `post-merge-ci`, `production`, `unknown`} and `should_have_caught` values outside {registered gate ID, `reviewer:<agent>`, `none`, `unknown`}. A registered gate ID is a bare ID accepted by `isRegisteredId(id, expandRangeIds(parseRegistryIds(<gates-registry.md text>)))` from `gate-ids.cjs` (for example `gate-0.6-schema`); `<agent>` must match an `agents/<agent>.md` file name.
  - AC: `gate-9-nope` exits non-zero naming the field and value; `gate-0.6-schema` passes; `reviewer:a1-reinhard-reviewer` passes.
- **FR-003** — The validator accepts postmortems that lack both fields (legacy) and reports them as `legacy`, not as errors. All 6 current vault postmortems validate with exit 0.
  - AC: run the validator on copies of the 6 real postmortems; exit 0, six `legacy`.
- **FR-004** — The two new flags go through the existing line-break refusal in `init-postmortem` and, being closed-set values (FR-002), any value with characters outside `[A-Za-z0-9:._-]` is rejected before the file is written.
  - AC: a value with a newline, or with `--- x`, exits non-zero and creates no file.
- **FR-005** — `skills/a1-fix/workflows/04-verify.md` (the step that already references `root_cause_class` and the postmortem) instructs the agent to set both fields, and states that a bug found after merge by the user is `found_by: user`.
  - AC: `grep` of the workflow shows both flag names; a workflow lint run stays green.
- **FR-006** — `a1-tools metrics escaped --last <N> --project <slug> [--json] [--fail-above <n>]` (new `metrics` command group, vault from `A1_VAULT_ROOT` via `vaultRoot()`) prints the escaped-BLOCKER count over the last N runs and the list of matching postmortems (path, `found_by`, `should_have_caught`). N defaults to 10.
  - AC: fixture vault with 3 escaped, 2 non-escaped, 2 legacy postmortems prints 3 and lists exactly those 3.
- **FR-007** — Postmortems with `unknown` or missing fields are never counted as escaped; the report prints how many postmortems in the window were `unknown`/`legacy`.
  - AC: fixture count of unknown equals the printed number.
- **FR-008** — If the history has fewer than N runs, the command uses all runs and prints the actual run count; it exits 0.
  - AC: fixture with 4 runs and `--last 10` prints `runs: 4`.
- **FR-009** — `--group-by should-have-caught` prints counts per gate/reviewer, sorted by count descending, ties by name.
  - AC: deterministic output on a fixture with a tie.
- **FR-010** — `a1-tools metrics cost [--project <slug>] [--last <N>] [--json]` parses the cost line from each `<vault>/project/<slug>/phases/*/VERIFICATION.md` (one entry per phase directory, named by directory) and prints tokens per run plus the total; a run with no parsable line is listed as `unreported`.
  - AC: fixture copies of real VERIFICATION.md files (formats `**Cost:** N tokens (...)`, `Cost: N tokens (...)`, `see cost line at bottom`, `Cost: unavailable`) give exact expected totals and the correct unreported list.
- **FR-011** — When a VERIFICATION.md carries several cost lines, the parser uses the last one and prints a note naming the file.
  - AC: fixture with two lines yields the second value.
- **FR-012** — The cost report prints coverage as `reported/total` and percent; the baseline fixture reproduces 28/43 only if built from the same data (test uses its own fixture counts).
  - AC: fixture with 3 of 4 reporting prints `3/4 (75%)`.
- **FR-013** — `skills/a1-fix/workflows/04-verify.md` instructs the agent to append a `Cost: N tokens (in X, out Y, cache Z)` line to the fix report body (`<vault>/project/<slug>/fixes/*.md`), produced with `cost run --since <fix-start>` as in Victor's step; `metrics cost` includes fix reports with `status: fixed` as runs of kind `fix`.
  - AC: fixture fix report with a cost line is summed; one without is `unreported`.
- **FR-014** — Both commands read local files only: no network call, no new npm dependency, Node >= 18, no GNU-incompatible shell use.
  - AC: the fixture suite passes on GNU/Linux (Docker) and macOS; `package.json` dependencies unchanged.
- **FR-015** — By default both commands exit 0 regardless of the count and exit 2 only on I/O error. `metrics escaped --fail-above <n>` exits 1 when the escaped count is greater than `<n>`; the flag is off by default.
  - AC: fixture with 5 escaped exits 0 without the flag, 1 with `--fail-above 4`, 0 with `--fail-above 5`.
- **FR-016** — `help.cjs`, the CLI header, and the unknown-group usage string in `a1-tools.cjs` list the `metrics` group (`escaped`, `cost`) and `fix validate-postmortem`; `verify-install-sync.sh` stays green.
  - AC: `a1-tools metrics` without subcommand prints usage and exits 1.
- **FR-017** — A new suite `_test-fixtures/a1-metrics/run-tests.sh` covers FR-001 to FR-013 with fixtures copied from real vault files (postmortems, VERIFICATION.md), isolated by pointing `A1_VAULT_ROOT` at a temp vault copy (as `_test-fixtures/a1-fix/run-tests.sh` does).
  - AC: suite exits 0; fixture files byte-equal their sources except for the added fields.

## Success Criteria

- **SC-001** — `a1-tools metrics escaped --last 10` returns the exact count for the fixture vault in under 2 s.
- **SC-002** — All 6 existing postmortems validate unchanged (0 errors) after the schema change.
- **SC-003** — `a1-tools metrics cost` totals equal the hand-computed sum for the fixture set (exact integer match) and lists every unreported run.
- **SC-004** — 100 percent of a1-fix postmortems created after the change carry non-`unknown` `found_by` and `should_have_caught` unless the agent states a reason (measured by running the validator over new postmortems after 5 fixes).
- **SC-005** — The full fixture suite (`for r in _test-fixtures/*/run*.sh`) stays green and the new suite adds at least one test per FR.

## Acceptance Scenarios

### US-018-1

**Given** an a1-fix run ends with a bug the user found after merge
**When** the agent runs `fix init-postmortem` with `--found-by user --should-have-caught gate:<registered-id>`
**Then** the postmortem frontmatter holds both values and the validator passes.

**Given** a legacy postmortem without the fields
**When** the validator runs
**Then** it exits 0 and reports `legacy`.

### US-018-2

**Given** a vault with three blocker postmortems found by `user` with a gate named in `should_have_caught`
**When** `metrics escaped --last 10` runs
**Then** it prints 3 and lists the three files.

**Given** only legacy postmortems in the window
**When** the command runs
**Then** it prints 0 escaped and the legacy count, exit 0.

### US-018-3

**Given** VERIFICATION.md files in three formats and one without a cost line
**When** `metrics cost` runs
**Then** it prints the exact total, three per-run values and one `unreported` entry.

### US-018-4

**Given** escaped postmortems naming two different gates
**When** `metrics escaped --group-by should-have-caught` runs
**Then** counts per gate print in descending order.

## Edge Cases

- Legacy postmortems (6 today) and legacy cost formats: tolerated, counted as `legacy`/`unreported`, never fatal.
- `should_have_caught` names a gate later removed from the registry: kept as written for old files; rejected only for new writes (FR-002).
- Fewer than N runs; zero runs; empty vault.
- Several cost lines in one file (delta runs): last wins, noted.
- Thousands separators or `~` in token numbers (`~39,500,000`): parsed if the number is unambiguous, otherwise `unreported`.
- Hostile field values and file names with spaces/newlines.
- VERIFICATION.md files are per phase, not per spec; cost is reported per phase directory and no spec mapping is attempted.
- Postmortem exists without a matching fix report, or the reverse: each counted on its own.
- Vault absent (CI) or `A1_VAULT_ROOT` unset: command exits 2 with a clear message, no stack trace.
- Concurrent writes: reports only read; no lock needed.

## Out of Scope

- Enforcement of gates, verifier changes, test-fidelity checks (spec 017).
- Money conversion, price tables, dashboards (a1-dashboard).
- Backfilling cost or fields for old runs, including a1-office's 20 runs.
- Auto-blocking merges or releases on the escaped count.
- Post-deploy live probes and automatic bug-found-after-merge detection (the agent records it by hand at fix time).
- Changes to `_shared/retro-template.md` and `retro-validate.cjs` beyond what the postmortem validator needs (017 owns them until it merges).

## Dependencies

- Spec 017 (`depends_on: 017-enforced-self-checks`): must merge first; it claims `_shared/lib/fix.cjs`, `_shared/retro-template.md`, `_shared/lib/retro-validate.cjs`. Rebase 018 on main after 017.
- Existing `_shared/lib/cost.cjs`, `_shared/lib/gate-ids.cjs`, `_shared/gates-registry.md`, Victor cost step.
- No new packages, no network, no migration. Roadmap entry: `continuous`.

## Clarifications

- **2026-10-15** — Legacy postmortems: accepted as `legacy`, never counted as escaped, no backfill. Reason: owner answer (option A); keeps the 6 existing files valid.
- **2026-10-15** — Run window: "10 runs" = last 10 done specs plus fixed fix reports by completion date; escaped postmortems counted by their date inside that span. Reason: owner answer (option A); works offline.
- **2026-10-15** — Fix cost location: `Cost:` line in the fix report body, same format as VERIFICATION.md. Reason: owner answer (option A); one parser, fixes without postmortem still count.
- **2026-10-15** — Non-zero count: report-only by default, opt-in `--fail-above <n>`. Reason: owner answer (option B); no surprise failures.
- **2026-10-15** — CLI surface: gate IDs are written bare (no `gate:` prefix) because registry IDs are already unique; vault is selected by `A1_VAULT_ROOT`, no `--vault` flag. Reason: orchestrator default (owner delegated autonomy 2026-10-14); matches `gate-ids.cjs` and `fix.cjs` as they are.
- **2026-10-15** — Run completion date: specs use the last `phase_history` timestamp, else `created`; fixes use the filename date. Reason: orchestrator default (owner delegated autonomy 2026-10-14); `phase_history` has no `done` entry (checked on spec 016).
- **2026-10-15** — Cost granularity: per phase directory (`phases/*/VERIFICATION.md`), not per spec. Reason: orchestrator default (owner delegated autonomy 2026-10-14); no spec-to-phase link exists in frontmatter.
- **2026-10-15** — Permissions and multi-user: not applicable (local read-only CLI, no tenants). Reason: orchestrator default (owner delegated autonomy 2026-10-14).
- **2026-10-15** — Duplicate/idempotency: both reports are pure reads, repeatable with identical output. Reason: orchestrator default (owner delegated autonomy 2026-10-14).
- **2026-10-15** — Mobile/UI/navigation/state-after-action/empty-error states: not applicable (CLI-only); empty history prints zero counts and exits 0. Reason: orchestrator default (owner delegated autonomy 2026-10-14).
- **2026-10-15** — Gate C: dry-run against real CLI surfaces ran; findings fixed in FR-001, FR-002, FR-004, FR-006, FR-010, FR-013, FR-016, FR-017. Reason: HARD GATE before `clarified`.
- **2026-10-22** — Implementation notes accepted in review (Reinhard, PR review of 018): the vault holds 9 postmortems at implementation time (FR-003/SC-002 assert the copied count, not 6); the vault is resolved from `A1_VAULT_ROOT` directly (`vaultOrExit2`), not `vaultRoot()`, because `vaultRoot()` creates `.a1/learnings` when the variable is unset and FR-015 requires exit 2; `found_by` accepts registered gate IDs and `reviewer:<agent>` as FR-002 states; on read, any `should_have_caught` other than `none`/`unknown`/absent counts (old free-text values included, consistent with the removed-gate edge case); `metrics cost --last N` limits phases and fixes per kind; usage errors exit 1, I/O and vault errors exit 2. The `cost run` intent exclusion lands via evolve-run-8b (owner decision; that run holds `intent-sandbox.cjs`). Reason: orchestrator default (owner delegated autonomy 2026-10-14).

## Review Checklist

- [ ] All P1 stories have at least one Acceptance Scenario
- [ ] All FRs are binary and testable
- [ ] All SCs are measurable
- [x] No open clarification markers remain
- [ ] Out of Scope is non-empty (be explicit, not implicit)
- [ ] Dependencies are listed or explicitly "none"
