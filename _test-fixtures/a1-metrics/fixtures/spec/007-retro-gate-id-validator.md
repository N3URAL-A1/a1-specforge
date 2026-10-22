---
type: spec
id: 007-retro-gate-id-validator
project: a1-specforge
feature_slug: retro-gate-id-validator
title: "Three machine guards for false-green evidence — gate-id validator, imported-expectation"
status: done
created: 2026-09-11
phase_history:
  - "phase=discover completed=2026-09-11 (drafted by a1-evolve 6th synthesis run; all three"
  - "phase=specify completed=2026-09-11T09:53:08.143Z"
  - "phase=clarify completed=2026-09-11T09:53:08.143Z"
  - "phase=plan completed=2026-09-11T09:59:36.558Z"
  - "phase=implement completed=2026-09-12T10:52:29.037Z"
  - "phase=verify completed=2026-09-12T10:52:29.038Z"
wave_plan_path: project/a1-specforge/plans/007-retro-gate-id-validator-wave-plan.md
verify_failures: []
fixtures: []
permalink: vault/project/a1-specforge/spec/007-retro-gate-id-validator
proposal_source: "a1-evolve synthesis 2026-09-11 (learning store pattern/a1-learnings)"
roadmap_entry: continuous
size: M
---

# Three machine guards for false-green evidence

> Spec ID: `007-retro-gate-id-validator` · Project: `a1-specforge` · Status: `draft`
>
> **Kurzfassung (DE):** Drei Wächter, die alle dieselbe Wurzel haben: etwas meldet grün,
> ohne geprüft zu haben. (1) Ein Validator für `gates_fired[].id` in Retros — die Prosa-
> Warnung dagegen steht an drei Stellen und wurde nach ihrer Einführung neunmal verletzt.
> (2) Eine Lint-Regel gegen Erwartungswerte, die aus demselben Modul importiert werden wie
> die geprüfte Funktion. (3) Zweig-Coverage als Gate über die kritischen Module. Wächter 2
> und 3 wurden in M4-P1 (n3ural-contentbot) ausdrücklich empfohlen und bewusst nicht in
> jenem PR gebaut. Alle drei sind maschinell; keiner ersetzt eine Disziplinregel, sondern
> ersetzt eine, die nachweislich nicht getragen hat.

---

## Discovery — Problem

Three independent findings from the 2026-09-11 a1-evolve synthesis share one root cause:
**a check reports green without having checked.**

### G1 — Retro gate ids drift silently

`a1-evolve`'s gate-ROI step discards any `gates_fired[].id` that is absent from
`_shared/gates-registry.md`. It does so **silently**, so a misspelled id looks like data
and contributes nothing.

Prose warnings against this exist in three files (`gates-registry.md`,
`_shared/retro-template.md`, `skills/a1-evolve/workflows/02-cluster.md`), two of them
naming the offending spelling `lane-split-check` explicitly since 2026-08-27.

Measured on 2026-09-11, i.e. after those warnings were written: **9 of 33 `gates_fired`
entries in the corpus used an unregistered spelling** — `lane-split-check` 7×,
`consistency-gate-4-5` 1×, `full-regression-gate` 1×. Consequence: `lane-split` counted
7 firings instead of 14. Ten firings is the retirement-candidate threshold, so the drift
is the difference between "not enough data" and an actual verdict about a gate's worth.

Two synthesis runs have now reported this class (2026-08-27 as `gate_id_drift`, HIGH;
2026-09-11 as a repeat). Constitution invariant 7 says gates are registered; nothing
enforces it at write time.

### G2 + G3 — Green tests that prove nothing

2026-09-10/11, n3ural-contentbot `M4-P1-heartbeat-operator-alarm`: **eleven green tests in
one phase proved nothing** — 5 found while executing, 5 in code review, 1 in the security
review. Four classes (full incident record: `_shared/agent-lessons.md#theo-mutation-question`):

1. the test never enters the branch it names;
2. the promise is a process, the assertion checks the result;
3. the fake repeats the code's own error;
4. the expectation is imported from the module under test.

The decisive datum against relying on discipline: in the follow-up round the same class hit
**three different roles in one round** — the existing tests, the author fixing them, and the
counter-checker measuring the fix. The retro states it directly: it does not hang on anyone's
care, it hangs on the shape of the test.

The M4-P1 retro recommended two machine guards and deliberately did not build them in that
PR, on the sound ground that a new gate does not belong in a branch awaiting rollout. They
have not been built since.

## Functional requirements

- **FR-001** `a1-tools retro validate <retro-path>` parses every `gates_fired[].id` in the
  file and exits non-zero when an id is absent from `_shared/gates-registry.md`.
- **FR-002** The validator resolves the documented drift aliases and reports them as errors
  naming the canonical id (`lane-split-check` → `lane-split`), so the message is a fix
  instruction, not a rejection.
- **FR-003** The validator reads the registry's id column only, never the alias bullet list
  (that list is deliberately not a table — see the note in `gates-registry.md`).
- **FR-004** The check is registered in `_shared/gates-registry.md` per invariant 7, with
  deterministic exit semantics and its own retro attribution id.
- **FR-007** Each guard ships with a RED proof: a fixture that the guard actually rejects,
  committed alongside it. A gate whose first run is green has not been shown to work.

## Success criteria

- **SC-001** Replaying the corpus through FR-001 flags every drift entry and nothing else.
  **Do not hard-code the count.** Measured during implementation the number moved three
  times in one day: "9 of 33" (first estimate, repo-local stores not counted) → 11 of 54
  (measured at plan time) → 11 of 59 in 3 spellings (after `isolation-gate` was registered
  as a real gate, and because this run's own retros kept adding `gates_fired` lines). The
  moving target is the point: assert the SET of flagged ids against a checked-in corpus
  fixture, and against the live store assert only that every flagged id is absent from the
  registry and every unflagged one is present.
- **SC-002** Mutating a registry id in a passing fixture turns the validator red.
- **SC-003** The four M4-P1 test classes: classes 1 and 4 are the subject of spec
  `008-false-green-test-guards` (project repos, JS toolchain required) and are NOT claimed
  here. Classes 2 and 3 remain discipline. This spec does not claim coverage it does not have.
- **SC-004** No guard carries an exception list that grows by default; an exception needs a
  named reason. (M4-P1 evidence: the security gate needed three attempts, and the version
  with an exception list left exactly the risky file unchecked.)

## Added from the 2026-09-11 code review (Reinhard, opus)

The review of the collect-root fix surfaced two more guards of the same family —
both earned by measured defects in that very commit, so they belong here rather
than in a new spec:

- **FR-008 (glob liveness).** A fixture helper that, for every glob a CLI emits,
  plants a matching fixture directory and asserts at least one match. Evidence:
  three occurrences of "a glob that matches nothing, reported as no data" in six
  synthesis runs — `~/code` (2026-09-11), the `projects/` vs `project/` typo in
  the *same* commit that fixed it, and the 2026-07-17 single-repo read. Past the
  3× pattern threshold. Note the review's sharpest point: the fixture case that
  was supposed to cover this checked only 2 of 4 emitted globs, so the dead glob
  shipped under a green test.
- **FR-009 (pipeline exit propagation).** A review/lint check that flags any
  documented `cmd | parser || fallback` shell snippet in a workflow file, since
  `$?` is the parser's status, not `cmd`'s. Evidence: the abort guard added on
  2026-09-11 to stop a synthesis on exit 3 could not fire, because the documented
  snippet piped into `python3` — the tool exited 3, python parsed the valid
  `{"roots": []}` payload and returned 0. A guard against silent emptiness that
  was itself silently empty. The repo's workflow files use this shape widely.

- **SC-005** Replaying each of the three historical dead globs through FR-008
  flags all three; a glob whose target exists is not flagged.
- **SC-006** FR-009 flags the exact snippet as committed on 2026-09-11 and does
  not flag the corrected capture-then-parse form.

## Decisions (Clarify, 2026-09-11, Robert)

- **Scope:** FR-001–004, FR-007, FR-008, FR-009 — all buildable in this repo.
  The lint rule and the branch-coverage gate were **split out into spec
  `008-false-green-test-guards`** on 2026-09-11 (together with their two open
  questions), because a1-specforge has no `package.json`, no ESLint and no
  Vitest: it tests through bash fixtures. They target the project repos
  (n3ural-contentbot et al.). The split happened during this spec's own Gate-4.5
  run, which correctly refused a plan that left two FRs unassigned — a spec
  should only carry requirements buildable in its target repo. Nothing was
  dropped; see spec 008.
- **OQ-001 → write time.** The gate-id validator runs in the skills' Retro step,
  where the wrong id is produced, so the author gets the correction immediately.
  This also reaches the vault store (`A1_VAULT_ROOT`), which a repo-local CI
  check cannot see. Trade-off accepted: hand-written retros that bypass a1
  skills are not covered.
- **OQ-004 → deterministic CLI check.** FR-009 becomes an `a1-tools` command
  over `skills/*/workflows/*.md` that runs in CI, not a checklist item for the
  reviewer. Rationale from this run's own evidence: the gate-id warning existed
  as prose in three files and was violated seven times afterwards; a judgement
  step is exactly what failed.

## Open questions

- **OQ-001** ANSWERED (see Decisions: write time). Does FR-001 run inside the skills' retro step (write time, best signal) or as a
  CI check over the learning store (catches everything, later)? Write time is preferred, but
  the store is partly outside the repo (`A1_VAULT_ROOT`), so CI cannot see all of it.
- **OQ-004** ANSWERED (see Decisions: deterministic CLI check). FR-009 targets prose in markdown workflow files, not source code —
  is that a `a1-tools` check over `skills/*/workflows/*.md`, or part of
  Reinhard's review checklist? A lint over prose is unusual but deterministic.

## Out of scope

- The imported-expectation lint rule and the branch-coverage gate — spec
  `008-false-green-test-guards` (project repos).
- Rewriting the eleven M4-P1 tests (done in PR #5/#6 already).
- Changing `~/.claude/rules/common/testing.md` — Robert owns that file; these guards
  enforce the rule it already states (constitution invariant 1).
- A general mutation-testing framework. Real mutation runs stay targeted at
  high-blast-radius modules before merge, as decided in M4-P1.

## Evidence

| Claim | Source |
|---|---|
| 9 of 33 gate ids drifted, 7× `lane-split-check` | a1-evolve synthesis 2026-09-11, gate-ROI computation |
| `lane-split` 14 firings vs. 7 counted | same run, after alias normalization |
| warning existed since 2026-08-27 and was violated after | `_shared/gates-registry.md` alias section + corpus dates |
| 11 green tests without evidentiary value in one phase | `pattern/a1-learnings/a1-execute.md`, 2026-09-10 entry |
| same class hit 3 roles in one round | `pattern/a1-learnings/a1-execute.md`, 2026-09-11 entry |
| both guards recommended, deliberately not built | same entry, 💡 Suggestion block |
