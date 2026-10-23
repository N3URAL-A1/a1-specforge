---
id: 015-docs-consolidation
project: a1-specforge
feature_slug: docs-consolidation
title: "Docs consolidation: roadmap single source of truth, README vault section moved out"
status: done
created: 2026-10-14
phase_history:
  - "phase=discover completed=2026-10-14T06:06:43.077Z"
  - "phase=specify completed=2026-10-14T06:06:43.122Z"
  - "phase=clarify completed=2026-10-14T06:06:43.122Z"
  - "phase=plan completed=2026-10-14T06:08:50.841Z"
  - "phase=implement completed=2026-10-14T07:26:04.579Z"
  - "phase=verify completed=2026-10-14T07:26:04.580Z"
wave_plan_path: project/a1-specforge/plans/015-docs-consolidation-wave-plan.md
verify_failures: []
permalink: vault/project/a1-specforge/spec/015-docs-consolidation
size: M
type: spec
---

# Docs consolidation: roadmap single source of truth, README vault section moved out

> Spec ID: `015-docs-consolidation` · Project: `a1-specforge` · Status: `done`

---

## Discovery — Problem

- Measured 2026-10-14 (analysis section D): `product validate --spec-status` exits 1 on main. Specs 005 and 014 were disagreements (already fixed in the vault); the remaining drift is feature `010-vault-cockpit-contract`, spec `implementing` but roadmap `planned` (waves merged in PRs #11, #13, #15).
- Two roadmap sources exist: `docs/roadmap.md` (hand-maintained, M0–M9) and `docs/product/ROADMAP.md` + `NEXT.md` (machine-validated). Readers cannot tell which is current.
- README carries about 25 lines of vault-cockpit reference (command table, check #11, two-host rules, no-vault behaviour, two env-var rows) that bury the quickstart.

## Discovery — Primary User

- Owner (Robert) and contributors who read the README first and the roadmap to learn what is next; plus the CI/gate tooling that reads `docs/product/`.

## Discovery — User Journey

- Reader opens README, follows "Roadmap" to the single current source; follows a short vault summary link to `docs/vault.md` for detail. Maintainer runs `product validate --spec-status` and gets a clean result.

## Discovery — Acceptance Criteria

- `product validate --spec-status` exits 0, zero violations, zero warnings. `docs/roadmap.md` has a history header. README Roadmap link targets `docs/product/ROADMAP.md`. Vault text lives in `docs/vault.md`; `bash bin/verify-install-sync.sh` exits 0.

## Discovery — Success Metrics

- Repo-wide validate clean; README shrinks by the moved block; zero command names or env vars lost.

## Discovery — Out of Scope

- Any code change, new CI gate that runs validate repo-wide, rewriting M0–M9 history, owner steps for feature 010 (plugin update on both hosts, Wave 9 step 6).

## Discovery — Edge Cases

- `product stage` vocabulary has no value `in-flight`: the status `in-flight` is reached through stage `started`. README scope comment forbids new matching tokens (skill/agent names, the shared CLI filename). Moved text must keep relative links valid from `docs/`.

## Discovery — Compliance

- None. Docs-only; no personal data. Files in English.

## Discovery — Dependencies

- Analysis `2026-10-14-autonomy-self-control.md` section D; decision record `2026-10-14-a1-autonomy-chat-consent.md`; `bin/verify-install-sync.sh`; `docs/product/SCHEMA.md`.

## Discovery — Priority

- P1. Size M. Removes the last known roadmap drift and the dual-source ambiguity.

---

## Overview

Consolidate the repo documentation so each fact has one home. The roadmap feature `010-vault-cockpit-contract` is moved to in-flight so the spec-status validation is clean, `docs/roadmap.md` becomes an explicit history file pointing to `docs/product/ROADMAP.md` and `docs/product/NEXT.md`, and the vault-mirror reference leaves the README for a new `docs/vault.md`. No code changes.

## User Stories

### P1 (Must-have)

**US-015-1** — **As a** maintainer, **I want** the roadmap entry of feature 010 to match its spec, **So that** `product validate --spec-status` is clean and can serve as a trustworthy check.

**US-015-2** — **As a** reader, **I want** one clearly named source for current and next work, **So that** I never act on the outdated M0–M9 file.

**US-015-3** — **As a** new user, **I want** a slim README, **So that** I reach install and quickstart without wading through vault-sync reference text, while the detail stays reachable.

## Functional Requirements

- **FR-001** — `docs/product/ROADMAP.md` lists feature `010-vault-cockpit-contract` with status `in-flight`, set through `a1-tools product stage` (not by hand-editing).
- **FR-002** — `node _shared/a1-tools.cjs product validate --spec-status` exits 0 and reports zero violations and zero warnings.
- **FR-003** — The first lines of `docs/roadmap.md` (above the existing title or directly below it) contain a header stating that `docs/product/ROADMAP.md` and `docs/product/NEXT.md` are the single source of truth for current and next work and that the file is history.
- **FR-004** — The M0–M9 content of `docs/roadmap.md` is unchanged; `git diff` for that file shows only added lines.
- **FR-005** — The README "Roadmap" section links to `docs/product/ROADMAP.md` and no longer links to `docs/roadmap.md`.
- **FR-006** — A new file `docs/vault.md` contains, verbatim, the README subsection "Vault mirror and cockpit (spec 010)": intro, command table, check #11 paragraph, "Two hosts, one vault", "No vault configured".
- **FR-007** — `docs/vault.md` also contains the `A1_HOST_ID` and `A1_VAULT_WRITER_HOST` table rows verbatim and the `A1_HOST_ID` / `vault writer <slug> --set` example lines.
- **FR-008** — The README no longer contains the `A1_HOST_ID` and `A1_VAULT_WRITER_HOST` rows or the `A1_HOST_ID` example lines, and the subsection heading "Vault mirror and cockpit (spec 010)" no longer carries the detailed text.
- **FR-009** — The README keeps a vault summary of at most 3 sentences that links to `docs/vault.md`.
- **FR-010** — Every `a1-tools` subcommand string and every `A1_*` environment variable name in the removed README text appears in `docs/vault.md`.
- **FR-011** — Relative links inside `docs/vault.md` (ADR, `SCHEMA.md`, Configuration anchor) resolve to existing targets from the `docs/` directory; the Configuration reference points to the README anchor.
- **FR-012** — `bash bin/verify-install-sync.sh` exits 0 after the change; the README still names exactly the installed skill and agent set.
- **FR-013** — `docs/vault.md` introduces no skill/agent-prefix token and no shared-CLI filename that `bin/install.sh` greps as part of the install set beyond those already in the README, and the README's mention of `docs/roadmap.md` in the Structure tree stays accurate.
- **FR-014** — The change touches only Markdown and `docs/product` data files; no file under `_shared/`, `skills/`, `agents/`, `bin/` changes.

## Success Criteria

- **SC-001** — Repo-wide `product validate --spec-status` returns exit 0 with 0 violations and 0 warnings.
- **SC-002** — `bash bin/verify-install-sync.sh` returns exit 0.
- **SC-003** — The README is at least 20 lines shorter than before and its vault summary is at most 3 sentences.
- **SC-004** — 100 percent of command names and `A1_*` variables from the moved text are found in `docs/vault.md` (grep count of missing = 0).
- **SC-005** — A reader following the README "Roadmap" link lands on `docs/product/ROADMAP.md` in one click; `docs/roadmap.md` states its history role in its first 10 lines.
- **SC-006** — The fixture suites (`for r in _test-fixtures/*/run*.sh`) still pass.

## Acceptance Scenarios

### US-015-1

**Given** feature 010 is `planned` on the roadmap and its spec is `implementing`
**When** the maintainer runs `product stage` for it and then `product validate --spec-status`
**Then** the roadmap shows `in-flight` and the validation exits 0 with no violations or warnings.

### US-015-2

**Given** a reader opens `docs/roadmap.md`
**When** they read the top of the file
**Then** a header names `docs/product/ROADMAP.md` and `docs/product/NEXT.md` as the single source of truth, and the M0–M9 text is unchanged below it.

**Given** a reader opens the README Roadmap section
**When** they follow the link
**Then** they reach `docs/product/ROADMAP.md`.

### US-015-3

**Given** the README before the change contains the vault subsection and two env-var rows
**When** the change is applied
**Then** the README holds a summary of at most 3 sentences with a link, `docs/vault.md` holds the full original text, and `verify-install-sync.sh` exits 0.

**Given** the list of `a1-tools` subcommands and `A1_*` variables extracted from the old README block
**When** each is searched in `docs/vault.md`
**Then** all are found.

## Edge Cases

- `product stage` has no stage value `in-flight`; the in-flight status results from stage `started`. If the command rejects the transition, the failure is reported, not worked around by hand-editing generated data.
- `product stage` also mirrors to the vault when `A1_VAULT_ROOT` is set; the run uses an isolated vault path or unsets it to avoid fixture leaks.
- Moved text uses links relative to the repo root (`docs/adr/...`, `docs/product/SCHEMA.md`); in `docs/vault.md` they must be rewritten to be valid from `docs/`, which is the only allowed deviation from "verbatim".
- The README scope comment forbids new matching tokens; the summary must not add a skill, agent or CLI-filename token.
- The `[Configuration](#configuration)` anchor inside the moved paragraph must point to the README, not to a missing local anchor.
- Table rows in the README Configuration section must remain a valid table after two rows are removed.

## Out of Scope

- Any code, gate or CI change (including a repo-wide CI run of `product validate`).
- Editing or deleting the M0–M9 history content.
- The owner steps of feature 010 (plugin update on both hosts, Wave 9 step 6) and moving it to done.
- Rewording the moved vault text beyond link repair.

## Dependencies

- `bin/verify-install-sync.sh` and the README scope comment.
- `docs/product/SCHEMA.md` stage vocabulary; the `product stage` command.
- ADR `docs/adr/2026-09-24-vault-mirror-single-writer.md` (link target).
- Specs 005 (`cancelled`) and 014 (`done`) already reconciled in the vault.

## Clarifications

## Review Checklist

- [x] All P1 stories have at least one Acceptance Scenario
- [x] All FRs are binary and testable
- [x] All SCs are measurable
- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Out of Scope is non-empty (be explicit, not implicit)
- [x] Dependencies are listed or explicitly "none"

## AC Dry-Run

Gate C, 2026-10-14, run inline by the orchestrator (docs/CLI feature, no UI routes; the "path" is the command and file sequence against the real repo). Note: status was set to `clarified` before this section was written; the gate result below was verified before Phase 4 started.

- FR-001: PASS — `a1-tools product stage --by 010-vault-cockpit-contract --set started`; `started` is a valid stage (`docs/product/SCHEMA.md:54`), status derives `in-flight`.
- FR-002: PASS — `a1-tools product validate --spec-status`; currently 1 warning (010), FR-001 removes it.
- FR-003: PASS — `docs/roadmap.md` exists; NEW: header block at the top.
- FR-004: PASS — verified by `git diff docs/roadmap.md` showing only `+` lines.
- FR-005: PASS — README `## Roadmap` (line 204) exists; link target `docs/product/ROADMAP.md` exists.
- FR-006: PASS — source `README.md:113-134` (### Vault mirror and cockpit); NEW: `docs/vault.md`.
- FR-007: PASS — source rows in README `## Configuration` (A1_HOST_ID, A1_VAULT_WRITER_HOST) and example lines.
- FR-008: PASS — same README ranges, removal checked by grep.
- FR-009: PASS — summary sits under `## Shared CLI` or `## Configuration` in README.
- FR-010: PASS — grep of moved command/env tokens in `docs/vault.md`.
- FR-011: PASS — link targets exist: `docs/adr/2026-09-24-vault-mirror-single-writer.md`, `docs/product/SCHEMA.md`; Configuration anchor is in README (link `../README.md#configuration`).
- FR-012: PASS — `bin/verify-install-sync.sh` exists, exit 0 today.
- FR-013: PASS — checked by running `bin/verify-install-sync.sh` plus grep for the CLI filename in `docs/vault.md`.
- FR-014: PASS — checked by `git diff --name-only`.
