# STATUS — 025-codex-architecture-only

Spec: `project/a1-specforge/spec/025-codex-architecture-only.md` · Plan: `project/a1-specforge/plans/025-codex-architecture-only-wave-plan.md`
Branch: `feature/codex-architecture-only` · Worktree (aiserver): `/home/rob/claude-projects/a1-worktrees/codex-architecture-only`

## History

- Waves 1–5: committed on 2026-11-11 (last `dca8f32`); their gate evidence is in the commit messages and `observations.jsonl`. This file starts with wave 6.

## Wave 6 — Model pin and `codex_unavailable` fallback (2026-11-11, aiserver)

Agents: code Walter; security review Samuel (two rounds). Task 6.1 (effort measurement) pending until the Codex quota window reopens; `EFFORT_PINNED = 'PENDING-6.1'` is a marked placeholder.
gate0: a1-xprov suite → 4057 passed, 1 failed; the one failure is CA10 (sort without LC_ALL=C under LC_COLLATE=en_US.UTF-8, same on main a2d136e; fixed by spec 026 FR-027)
gate0: parts/35-model-pin.sh alone → 72 passed, 0 failed; red-first 10 passed / 31 failed against the unchanged code
gate0: mutation proofs (scratch tree copies, tree unchanged) → M1, M3–M6, M6-load, M7d, M8c–e, M9–M15, M16a, M16b each flip their case
gate0: lib-units 512/0; gates lint findings []; workflow lint findings []; check-enforcement ok
gate0: security review round 1 (Samuel) → 0 BLOCKER, 3 MAJOR (self-triggered outage via --timeout 1; runner validation errors fail-open; outage clears open REVISE findings), 3 MINOR (empty TOML path segment; marker bound to live PLAN.md; withheld refusal text) → all fixed
gate0: security review round 2 (Samuel) → SEC-1, 3, 4, 5, 6 FIXED; SEC-2b MAJOR (generic Codex error counted as outage, provokable by a bloated plan) and SEC-7 MINOR (early kill counted as timeout) → fixed: outage allowlist = usage_limit, http_5xx, network, timeout with measured elapsed ≥ timeout − 2 s; minimum gate timeout 60 s
gate0: spec clarifications 2026-11-11 added (FR-019 outage scope; accepted risk: genuine outage in round 2 after a revision is accepted Claude-only)
gate0: FINDING test leak → a file `UNPARSEABLE` was committed in wave 4 (`64ddcc7`); tests that take `dirname` of an unparseable JSON path write into the cwd (e.g. parts/10 line 299, parts/30 line 435) during mutation runs. Removed in this wave; root-cause guard is open (see below)
gate2: SKIPPED preview deploy (CLI library, no web app)

Task 6.1 DROPPED 2026-11-11 (owner decision): effort stays at the Codex CLI default; follow-up vault `idea/a1-specforge-codex-effort-pin.md`; spec FR-016/SC-004 amended.
gate0: effort unpinned → isolated config pins only `model`; prior value `PENDING-6.1` removed by repair (logged `upgrade_pins`), any other effort value fails `model_pinned`; part 35 75/0, part 04 126/0; new mutation M1b (effort key written again) flips; M1, M2b, M3, M9, M13c still flip; lib-units 513/0; gates lint []; check-enforcement ok; rejection fixture is constructed (meta says so)

## Wave 7 — Design review wiring and legacy state (2026-11-11, aiserver)

Agents: 7.1, 7.2, 7.3 Walter in parallel (disjoint write sets).
gate0: 7.1 `xprov design-targets` → parts/36 red first 20 passed / 22 failed, final 42/0; mutants M1 (pass filter), M2 (glob filter), M3 (rev regex), M4 (plan mode scans docs/adr), M5 (deleted file listed), M6 (dedupe) each flip
gate0: 7.3 legacy state → parts/37 63/0; every command's exit/stdout/stderr equals the baseline without seeds, sha256 of all 6 seeded files unchanged; no reader needed a fix; mutants M1 (waiver passthrough), M2 (round counter), M4 (index writer drops unknown rows), M5 (readIndex rejects retired id) each flip
gate0: 7.2 skill wiring → 04b Step 1b and 02-execute 2b-d call design-targets then `xprov gate --gate design-review-xprov --doc` per target; gates-lint 90/0, wave13 10/0; corpus 02-execute.md deliberately not refreshed (frozen older snapshot, refreshing it unwires the a1-execute gate pairs R1/R1b/R1c/R4b)
gate0: full a1-xprov 4160 passed, 1 failed (CA10 locale, known); lib-units 513/0; a1-intent 12 failed vs 13 on main (environment, see wave 6); verify-install-sync PASS; workflow lint []; gates lint []; realpath-check PASS
gate0: test-leak root cause found → parts/19-review-quality.sh:177 wrote `printf … > "$(json_get …)"`, i.e. into the cwd as UNPARSEABLE when json_get failed; guarded (target must be absolute, under the suite TMPDIR, not UNPARSEABLE/undefined/null), failure path of the guard not separately exercised; no stray file after the final runs
gate2: SKIPPED preview deploy (CLI library, no web app)

## Wave 8 — ADR addendum (2026-11-11, aiserver)

gate0: `docs/adr/2026-09-24-cross-provider-review-gate.md` L1067–1075 `## Addendum 2026-11-09 — Codex reviews only architecture (spec 025)`; §6 Live smoke sha256 74301757…b88d before = after; check-enforcement exit 0; hook file name `hooks/xprov-merge-hook.sh` verified on origin/main
gate3: FR-023-AC1 PASS @wave8 2026-11-11 (addendum names removed gates + hook, design-review-xprov warning, model pin with effort at CLI default and the follow-up, codex_unavailable fallback; no measurement record exists, by owner decision)
