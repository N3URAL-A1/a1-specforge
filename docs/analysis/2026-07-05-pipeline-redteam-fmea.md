# Pipeline Red-Team — Failure-Mode Analysis

**Date:** 2026-07-05 · **Question:** *How does a false "done" still get through every gate today?* · Adversarial walkthrough of the verification chain, assuming a plausibly-lazy or unlucky agent at each step (not malice — drift). Ranked by (likelihood × damage).

## FMEA-1 — AC dilution between spec and plan (HIGH / HIGH)
**Attack path:** Spec AC says "invoice numbers race-safe under concurrent creation". Pablo's plan renders it as task "implement invoice numbering + tests green". Gate 4.5 passes (FR-### bijection is *structural* — it counts tokens, not meaning). Victor verifies **against PLAN.md** ("goal-backward" in practice reads the plan's success criteria). Tests green → PASS. The race condition ships.
**Evidence this is real:** M7 audit B1 — Pablo *did* silently drop a roadmap criterion; Adam caught it only because the auditor happened to cross-read the roadmap. One layer of luck.
**Mitigation ▸** Victor's brief must state: the verification target is the **spec's ACs verbatim**, PLAN.md is only the route. Add to VERIFICATION.md template: per-AC table quoting the spec sentence, not the plan task. (One-line brief change + template row.)

## FMEA-2 — Self-asserted parity: `complete-wave --snapshot-replay pass` (HIGH / MED)
**Attack path:** In a1-modernize, the CLI records whatever the caller claims: `complete-wave W-01 --snapshot-replay pass` succeeds without any snapshot ever being replayed. `verify-parity` only *reports* baseline metadata — the actual replay+diff is skill-side prose. A hurried executor (or orchestrator) writes `pass` and the wave completes.
**Evidence:** In the M6 validation run *I* supplied that flag after doing the replay manually — nothing would have stopped me without it.
**Mitigation ▸** `snapshot-behavior` stores a content hash of the snapshot artifact; `complete-wave` requires `--replay-file <path>`, re-hashes, diffs against baseline itself, and refuses `pass` when files are missing or differ. Turns a claimed gate into a computed one. (~30 LOC CLI.)

## FMEA-3 — Retro/learning self-reporting feeds evolve unverified (MED / HIGH-slow)
**Attack path:** The same model that ran the phase writes its retro. Rosy retros (`result: pass`, thin ⚠️ sections) accumulate; a1-evolve clusters them and *hardens the wrong things* — the self-improvement loop amplifies its own blind spots. Nobody cross-checks `result:` against VERIFICATION.md verdicts.
**Aggravator:** a1-fix writes to a `wiki/` store that a1-evolve never reads (see consistency audit C3) — the richest bug evidence is invisible to the optimizer, biasing the corpus toward feature-run self-reports.
**Mitigation ▸** (a) Retro schema gains mandatory `evidence:` refs (VERIFICATION.md path + verdict, commit hashes); (b) a1-evolve Phase 1 (Collect) cross-checks `result` vs the referenced VERIFICATION verdict and flags mismatches as `retro_integrity` findings; (c) unify the a1-fix store (audit C3 fix).

## FMEA-4 — Gate 0 spot-checks are discretionary and unlogged (MED / MED)
**Attack path:** Gate 0 tells the orchestrator to spot-check agent claims — but under context pressure the orchestrator skims, and there's no artifact proving checks ran. `agent_self_report_false` recurs silently the day discipline slips.
**Mitigation ▸** Gate 0 writes one evidence line per check into STATUS.md (`gate0: route /x → 200; symbol Y found at file:line`). Cheap, auditable by Victor, and makes skipping visible instead of invisible.

## FMEA-5 — "Gates implicitly approved" precedent (MED / MED)
**Attack path:** In the M6 validation the orchestrator auto-approved modernize G1–G6 as "part of the harness, Robert approved the plan". Reasonable there — but it establishes that an orchestrator may decide human gates are pre-approved. Next time the justification is thinner.
**Mitigation ▸** `update-status`/`approve-proposal`/`start-wave` accept `--approved-by <human|harness:reason>` and store it in phase_history. Auto-approval stays possible but leaves an audit trail; a1-tobi launch audits check for `harness:` entries in production-facing runs.

## FMEA-6 — Phantom heuristic satisfied by a comment (LOW / MED)
**Attack path:** `[X] Implement rate limiting` passes phantom if the diff touches a file whose name/token matches — a comment "// TODO rate limiting" in `rate-limit.ts` counts. Combined with phantom's always-exit-0 (see gate review P4), it's decorative against exactly the class it's named for.
**Mitigation ▸** P4 (enforce at Phase 6) + weak-match verdicts (2-weak-token matches) get listed in VERIFICATION.md as "verify manually" items rather than silent MATCH.

## FMEA-7 — Drift outside a1-fix's integrity check (LOW / MED)
Only a1-fix verifies skill/agent files against `agents.lock.json`. a1-new-feature/execute run on whatever is on disk — an inconsistent half-edited skill set (e.g. mid-evolve) silently changes pipeline behavior.
**Mitigation ▸** Extend integrity-check into the shared pre-flight of a1-new-feature/a1-execute (same CLI, one call).

## FMEA-8 — Concurrent sessions interleave learning state (LOW / LOW)
Observed today: a parallel a1-office session appended to `a1-plan/_learning.md` mid-M7-planning. Append-only markdown mostly tolerates this; `observations.jsonl` and `learnings-index.md` may not.
**Mitigation ▸** none urgent; note in a1-evolve to dedupe by (date, project, spec).

## Prioritized fix list
1. FMEA-2 (computed parity) — CLI change, deterministic, cheap
2. FMEA-1 (Victor verifies spec, not plan) — brief + template line
3. FMEA-3 (retro evidence refs + evolve integrity cross-check) — schema + collect step
4. FMEA-4 (Gate-0 evidence lines) — one instruction
5. FMEA-5 (--approved-by audit trail) — CLI flag
6. FMEA-6/7 — fold into gate review P4 and shared pre-flight

Items 1, 2, 4, 5 are deterministic or one-line changes — ideal M7/M8 wave candidates. Item 3 belongs in the next a1-evolve iteration.
