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

Open: task 6.1 (measure effort, replace placeholder and rejection fixture, re-run M9); test-leak guard (suite must refuse to write into the repo cwd).
