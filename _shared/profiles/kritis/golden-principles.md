source: ~/.claude/skills/specforge/SKILL.md@sha256:32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54 lines 1851-2099

# Golden Principles (KRITIS profile)

> Migrated from SpecForge Anhang F (German original, re-measured 2026-10-28 against the
> hash-pinned archive above: `## Anhang F` starts at line 1851, the next heading `## Anhang G`
> starts at line 2100, so this Anhang's content ends at line 2099). Ten enforceable principles;
> each has a rule, an enforcement mechanism and check questions. Used by the `harness-auditor`
> stakeholder role (`stakeholder-roles.md`) during simulation.

Ids are unchanged from the source (`GP-01`..`GP-10`), per the Standard wave contract item 10.

## GP-01: Schema hygiene

**Rule:** Every API contract has matching fixtures and test coverage.

**Enforcement:** Spec-First Chain steps 2 (schema), 3 (fixture), 6 (contract tests).

**Check questions:**
- Does every endpoint have a schema (OpenAPI, JSON Schema, Protobuf)?
- Does every schema have at least one fixture file?
- Are there contract tests that validate schema + fixture against the real API?

**Severity on violation:** MAJOR

## GP-02: Spec-before-code

**Rule:** No implementation without a spec entry under `specs/`.

**Enforcement:** Spec-phase gate — checked before every task.

**Check questions:**
- Does every implemented endpoint/feature have a corresponding story in spec.md?
- Was the story written before the implementation (not retrofitted)?
- Were the Gherkin ACs written before the tests?

**Severity on violation:** BLOCKER

## GP-03: ADR discipline

**Rule:** Cross-module decisions need an ADR under `specs/decisions/`.

**Enforcement:** Review routing — System Architect and Contract Guardian check cross-module
changes.

**Check questions:**
- Does the change touch more than one module/service?
- Does the ADR state context, decision, consequences, status?
- Is the ADR filed at `specs/decisions/adr-NNN.md`?

**Severity on violation:** BLOCKER

> The ADR and execution-plan templates from the source (the source's `EP-NNN.md` shape) are not
> migrated into this profile. In this repo, ADRs follow `docs/adr/` (see `docs/adr/`) and
> execution planning follows the wave-plan format (`~/N3URAL-Vault/project/<slug>/plans/`), both
> already in force independently of this profile — a harness-auditor review should point to
> those, not to Anhang F's templates.

## GP-04: Execution-plan requirement

**Rule:** Tasks touching 5 or more files need a recorded execution plan.

**Enforcement:** Tasks-phase gate — count of files affected per task.

**Check questions:**
- How many files does this task touch?
- At 5 or more: is there a recorded execution plan (this repo: a wave plan under
  `~/N3URAL-Vault/project/<slug>/plans/`, not the source's `EP-NNN.md` shape)?
- Does it state order, dependencies, and a rollback strategy?

**Severity on violation:** MAJOR

## GP-05: Invariant traceability

**Rule:** Tests reference invariant ids from the architecture documentation.

**Enforcement:** Traceability matrix — invariants checked against test coverage.

**Check questions:**
- Are invariants given stable ids (`INV-NNN`)?
- Do tests reference those ids in comments or tags?
- Are there orphaned invariants with no test coverage?

**Severity on violation:** MAJOR

## GP-06: No stale markers

**Rule:** `TODO`/`TBD`/`FIXME` markers need a date and an owner. Maximum age: 14 days.

**Enforcement:** Freshness check — all artefacts scanned for stale markers.

**Check questions:**
- Does every marker carry a date and an owner?
- Is the marker older than 14 days?
- Past 14 days: is it tracked in a tech-debt tracker?

**Severity on violation:** MINOR (escalates to MAJOR past 30 days)

## GP-07: Document placement

**Rule:** All artefacts live in the folder convention's designated directories.

**Enforcement:** Folder convention check — file paths checked against the convention.

**Check questions:**
- Is the file in its correct convention directory?
- Does the filename follow the naming convention?
- Are there files outside the convention structure?

**Severity on violation:** MINOR

## GP-08: Principle inviolability

**Rule:** Violations of the Golden Principles block progress until resolved.

**Enforcement:** Self-assessment — every output checked against all GPs.

**Check questions:**
- Are there open BLOCKER violations against any GP?
- Are all BLOCKERs resolved before moving to the next phase?
- Are MAJOR violations documented with a deadline?

**Severity:** Meta-principle — backs every other GP.

## GP-09: Dependency direction

**Rule:** A consumer knows a provider's interface, never the provider's internals.

**Enforcement:** Review agents (Contract Guardian, System Architect).

**Check questions:**
- Does the consumer depend only on the provider's public interface?
- Are there direct dependencies on provider internals (DB schemas, internal classes)?
- Is the dependency direction documented in the architecture notes?

**Severity on violation:** MAJOR

## GP-10: Debt tracking

**Rule:** Every identified piece of technical debt is recorded in a tech-debt tracker.

**Enforcement:** Harness Auditor — checks that known debt is documented.

**Check questions:**
- Does every known piece of debt have a tracker entry?
- Does each entry carry an id, description, owner, priority, impact?
- Is there a recurring review of the tracker?

**Severity on violation:** MINOR (escalates to MAJOR if the debt affects an NFR)

## Compliance scorecard

```
GP score = number of GPs satisfied / 10

>= 9/10  excellent, implementation cleared
   8/10  good, implementation cleared with documented limitations
   7/10  borderline, rework recommended
<= 6/10  not cleared, blocked
```

Threshold for implementation readiness: GP score >= 8/10.
