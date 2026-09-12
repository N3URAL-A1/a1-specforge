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
| `lane-split` | Plan (after Pablo) + Execute (before first lane) | deterministic | cheap | a1-plan (`03-plan.md` lane gate), a1-execute (multi-lane step 1) | blocking | NEW (2026-08-05). `a1-tools lane-split check --plan <p>` — exit 0/1/2. Validates a declared `lanes:` block: owns-overlap (reuses `code-scope.cjs` glob math), wave coverage, cross-lane `Depends on:`, cutover-wave-inside-lane. Plans without lanes exit 0 — free for the sequential default. No catch data yet. |
| `gate-0-self-report` | Execute (per wave) | deterministic | cheap | a1-execute | blocking | Self-report guard — executor claims cross-checked against artifacts. Added 2026-06/07, no catch data yet. |
| `gate-0.5-surface` | Execute (per wave) | deterministic | med | a1-execute | blocking | Surface-wiring coverage. Same failure class as reconcile (incomplete surface wiring), in-flight. Added 2026-06/07. |
| `gate-0.6-schema` | Execute (per wave) | deterministic | cheap | a1-execute | blocking | Schema/DB-checklist check. Cheap, keep as-is. Added 2026-06/07. |
| `gate-0.7-realpath` | Execute (per wave) | deterministic | cheap | a1-execute | blocking | NEW (P1). Any wave touching SQL / RLS / external-API must show one test run against the real backend (non-mock marker in evidence file). Kills `mock_tests_hide_sql_bugs`. |
| `gate-1-build` | Execute (per wave) | deterministic | med | a1-execute | blocking | Build / type-check must be green. |
| `gate-2-deploy` | Execute (per wave) | deterministic | med | a1-execute | blocking | Deploy/preview succeeds. |
| `gate-3-smoke` | Execute (per wave) | prompt | med | a1-execute | blocking | Per-wave FR-ACs verified live against real URL. Overlaps Phase-6 (P3 de-dup: Phase 6 ✓-references Gate-3 passes). |
| `gate-4.5-fr-consistency` | Execute / standalone | deterministic | cheap | a1-checklist (checks #9/#10) | blocking | FR-consistency gate: `checklist run <slug>/<feature> --only 9,10` (former a1-check, retired M13 — same engine, exit 0/1/2 unchanged). |
| `phase-6-verify` | Verify | prompt | high | a1-execute (a1-victor-verifier) | blocking | Goal-backward verification vs **spec** ACs. Re-runs only failed/re-touched ACs + cross-wave + edge/SC (P3). |
| `phantom` | Verify (Victor Step 6.5) | deterministic | cheap | a1-phantom | warning | CLI always exits 0 (standalone). Enforcement point (P4): PHANTOM verdicts on non-`# no-code` tasks become BLOCKER findings inside Victor's VERIFICATION.md. |
| `isolation-gate` | before Phase 5 Implement (a1-new-feature) / before any code change (a1-fix) | human | cheap | a1-new-feature (SKILL.md "Isolation Gate") + a1-fix (SKILL.md "Isolation Gate") | blocking | NEW (2026-09-11), registered after the fact: the gate has been a HARD RULE in both skills for months and retros already attributed to this id twice, but no row existed — so a1-evolve discarded those attributions silently (invariant 7 breach by omission, found while planning spec 007). No feature code in the primary checkout: work moves to a git worktree on a branch off `main`. Legitimate exception, declared at plan time and not deviated at execute time: phases whose write targets are external live symlinked repos (a worktree copy would miss the live symlinks) — see `pattern/a1-learnings/a1-execute.md` 2026-08. |
| `collect-roots` | a1-evolve Phase 1 (Collect) | deterministic | cheap | a1-evolve (`01-collect.md` §1a) | blocking | NEW (2026-09-11). `a1-tools learnings roots` — exit 0 roots / 2 bad `A1_CODE_ROOTS` / 3 nothing resolved. Guards the precondition of every synthesis: a collect phase whose globs match nothing must abort, not report "0 new entries". Added after the hardcoded `~/code` glob would have made the 6th run collect nothing while reporting success. Retro attribution: `{id: collect-roots, ...}` per `skills/a1-evolve/workflows/04-apply.md` Retro block. |
| `fix-integrity` | a1-fix | deterministic | cheap | a1-fix | blocking | Integrity-check / postmortem retro-integrity. Cheap, deterministic, keep as-is. |
| `checklist-preflight` | Pre-feature | prompt | med | a1-checklist | blocking | Launch/pre-feature readiness gate. |
| `reconcile-probe` | Post-hoc | deterministic | med | a1-reconcile | warning | Spec-drift / incomplete surface wiring, post-hoc (vs gate-0.5 in-flight). |
| `pr-reinhard` | Pre-merge | prompt | high | a1-pr-review (reinhard) | blocking | Diff-level review, pre-merge only (P6 scope). |
| `modernize-parity` | Modernize | deterministic | med | a1-modernize | blocking | Behaviour-parity check. |
| `modernize-g1..g6` | Modernize | human | high | a1-modernize | blocking | Six human approval gates (collapsed). Keep; auto-approval precedent needs an audit trail (FMEA-5). |
| `quick-eligibility` | entry (pre-Discover / pre-Pre-Flight) | deterministic | cheap | a1-quick / a1-new-feature+a1-fix | blocking | NEW (spec 004-xs-quick-lane, Wave 1). `quick eligibility` decides XS-lane admission (intent/file/diff budget, forbidden surface, clean tree, no reservation conflict) — no LLM, no network. |
| `quick-escalation` | exit (mid-run tripwire) | deterministic | cheap | a1-quick | blocking | NEW (spec 004-xs-quick-lane). Mid-run tripwire hard-stop that hands an in-progress quick run off to the full pipeline as a seed artifact. |
| `pre-flight-github-scope` | Phase 1 (pre-build) | deterministic | cheap | proorc-release | blocking | NEW (M11-P3, 2026-08-22). Checks `gh auth status` active account matches the repo owner (`n3urala1-rob`) and that `.github/workflows/release.yml` declares `permissions: contents: write` — **not** a `delete_repo`-scope check (that belongs to ProOrc's unrelated in-app repo-deletion feature). No catch data yet. |
| `version-consistency-gate` | Phase 2 (post-extraction) | deterministic | cheap | proorc-release | blocking | NEW (M11-P3, 2026-08-22). Validates `pubspec.yaml`-extracted version matches semver `X.Y.Z` before it is used for any build/tag/DMG-naming step. No catch data yet. |
| `tag-milestone-confirmation` | Phase 1 (pre-build) | human | cheap | proorc-release | blocking | NEW (M11-P3, 2026-08-22). Confirms with the user that a tag is milestone-worthy before tagging, per the "only tag bundled milestones" convention (CLAUDE.md). Declining routes to `proorc-quick-install` instead. No catch data yet. |
| `roadmap-gate` | Phase 0 (pre-Discover) | deterministic | cheap | a1-new-feature (`workflows/00-roadmap-gate.md`) | blocking | Registry backfill 2026-08-27: active since the skill's introduction and referenced in retros, but never registered (invariant 7). |
| `scope-claim` | Phase 4.5 / a1-fix Pre-Flight | deterministic | cheap | `_shared/parallel-spec-isolation.md` (a1-new-feature, a1-fix) | blocking | Registry backfill 2026-08-27. Scope-claim ordering of the parallel-spec-isolation convention. |
| `stop-gate-human` | Execute (plan-declared) | human | cheap | a1-execute | blocking | Registry backfill 2026-08-27. Generic pattern: a plan-declared STOP point for a decision the executor must not make alone. 1 catch (M11-P1 RETIRE decision). |
| `backup-gate-human` | Execute (Wave 0) | human | cheap | a1-execute | blocking | Registry backfill 2026-08-27. Backup confirmation before writing into live targets with no VCS safety net. |
| `settings-json-diff-gate-human` | Execute (config-touching wave) | human | cheap | a1-execute | blocking | Registry backfill 2026-08-27. Diff approval before edits to session-critical config (settings.json hooks). |
| `review-empirical-probes` | Pre-merge review | prompt | med | a1-reinhard-reviewer | blocking | Registry backfill 2026-08-27. Empirical probe requirement for high-blast-radius code — 3 catches in 3 runs, see `agent-lessons.md#reinhard-empirical-probes`. |


**Alias warning — ids are copied verbatim, never paraphrased.** a1-evolve's
gate-ROI step silently discards any `gates_fired[].id` absent from the table
above, so an invented id looks like data and counts as nothing. Observed
drifts (2026-08-27 synthesis, 8 of 12 ids in the corpus were unregistered):

- written `lane-split-check` → correct id is `lane-split`
- written `consistency-gate-4-5` → correct id is `gate-4.5-fr-consistency`
- written `full-regression-gate` → correct id is `gate-1-build` (full-suite variant)

**This warning demonstrably does not hold on its own.** It was written on
2026-08-27 naming `lane-split-check` explicitly; between then and 2026-09-11
that exact misspelling was written **seven more times**, plus
`consistency-gate-4-5` once and `full-regression-gate` once — 9 of 33
`gates_fired` entries in the corpus. Measured effect: `lane-split` counted 7
firings instead of 14, which is the difference between "not enough data" and a
retirement-candidate verdict. Prose in three places (here, `retro-template.md`,
and `02-cluster.md`) has now failed twice, so the fix has to be machine-checked
— tracked as spec `007-retro-gate-id-validator` in the learning store
(`$A1_VAULT_ROOT/project/a1-specforge/spec/`, alongside specs 001–006), not as
another paragraph here.

(Deliberately a bullet list, not a table: a markdown table here would share the
id-table's row shape, and any parser scraping `^| \`id\`` would then accept the
wrong-hand column as a valid id — the exact drift this section exists to stop.)

If the gate you ran has no row here, add one in the same commit as the retro
(invariant 7) rather than inventing a slug.
