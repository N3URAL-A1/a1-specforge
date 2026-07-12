# a1 Gate Registry

**Single source of truth for gate IDs.** Every check that can block or warn in the
a1 pipeline is registered here with a stable slug. Retros reference these IDs
(`gates_fired[].id` — see `learning-schema.md`); a1-evolve computes per-gate ROI
(catches × severity ÷ cost) from those references and can propose retiring
low-value gates, not only adding new ones.

Constitution rules this table enforces:
- **Gates are registered** (invariant 7): a check that can block ships with a registry
  entry, deterministic exit semantics (or an explicit prompt-gate label), and a retro
  attribution id.
- **A gate that cannot fail is documentation** (invariant 8): warning-only checks are
  labelled `warning`, and their real enforcement point (if any) is named in Notes.

**Class:** `deterministic` = CLI/exit-code, `prompt` = LLM agent judgement,
`human` = manual approval. **Cost class:** cheap / med / high.
**Enforcement:** `blocking` = can fail the pipeline · `warning` = advisory only.

| id | phase | class | cost | owning file | enforcement | notes |
|---|---|---|---|---|---|---|
| `gate-c-ac-dryrun` | end of Clarify (pre-Phase-4) | prompt | cheap | a1-new-feature | blocking | NEW (P2). Per FR-AC, narrate the user path against the app's real nav/layout — no build. Catches spec-level blindness. |
| `plan-audit` | Plan | prompt | med | a1-plan (a1-auditor) | blocking | AUDIT.md — plan coverage vs spec ACs. |
| `check-reservations` | Plan / merge | deterministic | cheap | a1-new-feature (Gate 4.5, PASS path) | blocking | NEW (P7), wired M12. `.a1/reservations.json` (migration numbers, route claims): Gate 4.5 claims plan-declared values via `a1-tools check reservations --claim` before dispatching Phase 5 — prevents `parallel_collision`. |
| `gate-0-self-report` | Execute (per wave) | deterministic | cheap | a1-execute | blocking | Self-report guard — executor claims cross-checked against artifacts. Added 2026-06/07, no catch data yet. |
| `gate-0.5-surface` | Execute (per wave) | deterministic | med | a1-execute | blocking | Surface-wiring coverage. Same failure class as reconcile (incomplete surface wiring), in-flight. Added 2026-06/07. |
| `gate-0.6-schema` | Execute (per wave) | deterministic | cheap | a1-execute | blocking | Schema/DB-checklist check. Cheap, keep as-is. Added 2026-06/07. |
| `gate-0.7-realpath` | Execute (per wave) | deterministic | cheap | a1-execute | blocking | NEW (P1). Any wave touching SQL / RLS / external-API must show one test run against the real backend (non-mock marker in evidence file). Kills `mock_tests_hide_sql_bugs`. |
| `gate-1-build` | Execute (per wave) | deterministic | med | a1-execute | blocking | Build / type-check must be green. |
| `gate-2-deploy` | Execute (per wave) | deterministic | med | a1-execute | blocking | Deploy/preview succeeds. |
| `gate-3-smoke` | Execute (per wave) | prompt | med | a1-execute | blocking | Per-wave FR-ACs verified live against real URL. Overlaps Phase-6 (P3 de-dup: Phase 6 ✓-references Gate-3 passes). |
| `gate-4.5-fr-consistency` | Execute / standalone | deterministic | cheap | a1-check | blocking | FR-consistency CLI. Same engine as a1-check standalone entrypoint (no double cost). |
| `phase-6-verify` | Verify | prompt | high | a1-execute (a1-victor-verifier) | blocking | Goal-backward verification vs **spec** ACs. Re-runs only failed/re-touched ACs + cross-wave + edge/SC (P3). |
| `phantom` | Verify (Victor Step 6.5) | deterministic | cheap | a1-phantom | warning | CLI always exits 0 (standalone). Enforcement point (P4): PHANTOM verdicts on non-`# no-code` tasks become BLOCKER findings inside Victor's VERIFICATION.md. |
| `fix-integrity` | a1-fix | deterministic | cheap | a1-fix | blocking | Integrity-check / postmortem retro-integrity. Cheap, deterministic, keep as-is. |
| `checklist-preflight` | Pre-feature | prompt | med | a1-checklist | blocking | Launch/pre-feature readiness gate. |
| `reconcile-probe` | Post-hoc | deterministic | med | a1-reconcile | warning | Spec-drift / incomplete surface wiring, post-hoc (vs gate-0.5 in-flight). |
| `pr-reinhard` | Pre-merge | prompt | high | a1-pr-review (reinhard) | blocking | Diff-level review, pre-merge only (P6 scope). |
| `modernize-parity` | Modernize | deterministic | med | a1-modernize | blocking | Behaviour-parity check. |
| `modernize-g1..g6` | Modernize | human | high | a1-modernize | blocking | Six human approval gates (collapsed). Keep; auto-approval precedent needs an audit trail (FMEA-5). |
