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

## Wave 9 — Close-out (2026-11-11, aiserver)

gate0: census `git grep "wave-inspect-xprov\|pr-diff-xprov\|xprov-hook-merge" -- skills agents hooks _shared _test-fixtures` → 35 files, all on the history allow-list: retired-id lists (`gate-ids.cjs`, `xprov.cjs` RETIRED_GATE_IDS, `xprov-waivers.cjs` comment), removed-gate notes (`gates-registry.md`, `learning-schema.md`), negative asserts (a1-pr-review run-tests, a1-xprov parts 01/06/20/25/33), legacy-state seeds and tests (parts 10/24/37, cases/legacy-state, cases/chat-waiver), frozen gates-lint corpus copy of 02-execute.md, copied historical docs (a1-metrics fixtures, a1-lib-units/real); no live reference in skills, agents or hooks
gate1: full loop `for r in _test-fixtures/*/run*.sh` with LC_ALL=C, A1_VAULT_ROOT unset → 55 of 57 exit 0 in 2224 s; a1-intent 1107 passed / 12 failed (X11, B22–B25, B6d, B19g-i, T5, T10, T21, T22, SM4: process/signal cases, environmental on aiserver, main shows 13); a1-vault-cockpit 1004/1 (I1 re-runs a1-intent); a1-xprov green incl. CA10 under LC_ALL=C; verify-install-sync PASS; tree clean after the loop
gate1: verdict → PASS with documented environmental exceptions; GitHub Actions on the PR is the binding run (FR-021)

## PR review (2026-11-11, aiserver)

review: branch rebased on origin/main 5cd83d1 (#73, #77, #78, #79), clean; a1-xprov 4164/0, gates-lint 90/0, pr-review 55/0, realpath-check 41/0 after the rebase
review: Reinhard round 1 → 0 BLOCKER, 3 MAJOR, 9 MINOR; Samuel (security surface fired) → 0 BLOCKER, 1 MAJOR (same as Reinhard MAJOR-1), 3 MINOR; no fail-open from removing the hook and the two gates
review: MAJOR-1 test leak → a fixture had committed an empty `planted commit` (author x@example.invalid) into this branch via `git -C ""`; dropped from history (empty diff verified), root cause fixed: run-tests.sh cds into the suite temp root, exports GIT_CEILING_DIRECTORIES and refuses to start if the suite root is inside a repo; `git_in` helper refuses empty/relative/non-repo dirs (parts 10, 14, 16, 17, 20, 27, 30, 32); only origin/feature/codex-architecture-only carried it, main and other branches checked clean
review: MAJOR-2 a1-execute 2b-d ran in the orchestrator cwd → now a subshell in `$WORK_PATH` with real exits; part 36 T9 (cwd matters) and T10 (text assert) prove it; the code agent's first fix claim was false (blocked edit, unchecked) and was caught by the re-review
review: MAJOR-3 FR-014 → an unchanged design file with a recorded REVISE is answered from the record (0 Codex calls) and stays a target so its warning is shown; non-verdict outcomes retry
review: Samuel MINOR fixed → gitleaks required for every outbound gate; frontmatter only `key: scalar` ≤ 200 chars; resolveDoc reads via fd with dev/ino check; findings_path only for a valid round and matching content
review: Reinhard re-review → all FIXED except MAJOR-2 (then fixed by the main session) and the remote still carrying the planted commit (removed by this push)
review: final local run → a1-xprov 4213/0, gates-lint 90/0, pr-review 55/0, lib-units 513/0, workflow lint [], gates lint [], verify-install-sync PASS; commit authors only the owner
