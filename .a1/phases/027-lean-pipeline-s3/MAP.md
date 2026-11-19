---
focus: all (scoped to slice 3 files)
generated: 2026-11-18
---

# Codebase Map: 027 slice 3 (merge-check lazy base, runner long path, verify lock)

Companion to RESEARCH.md in the same dir (its FR mapping table and risk table were spot-checked and are not repeated).

## Structure
```
_shared/lib/  pr-merge-check.cjs 281 | pr-merge-guards.cjs 217 | pr-ci-evidence.cjs
              verify-run.cjs 561 (cap 800) | verify-base.cjs 305 | verify-host.cjs 163
              verify-cli.cjs 91 | verify-check.cjs 113 | verify-reuse.cjs 230 | verify-reporters.cjs 133
              verify-affected*.cjs | help-merge-check.cjs 53 | help-verify.cjs 18 | workflow-lint-verify.cjs 121
              (NEW: verify-lock.cjs, verify-runner-path.cjs)
bin/          run-suites.sh 756 | run-suites-proc.sh 456 | run-suites-report.sh 140
_test-fixtures/suite-groups.json  (serial: [], no_count, timings, ci_jobs, snapshot_incompatible: {})
_test-fixtures/a1-pr-merge-check/  run-tests.sh + cases-{envred,host,unchanged}.sh
_test-fixtures/a1-verify/          run-tests.sh + cases-{affected-*,durations,envred,host,mapreal,reuse,timeout}.sh
_test-fixtures/a1-suite-runner/    run-tests.sh + parts/ (06-lock.sh)
skills/a1-pr-review/workflows/05-merge.md  skills/a1-new-feature/workflows/06-verify.md
.github/workflows/test.yml  .a1/verify.json  _shared/gates-registry.md
```
Repo: initialised, 524 commits (`git rev-list --count HEAD`), branch main. Untracked: `.a1/phases/027-lean-pipeline-s3/`.

## Tech Stack
Node >= 18 CJS, bash 3.2/GNU (runner has a portability header: no `wait -n`, mapfile, assoc arrays, `timeout`). CI: ubuntu-latest, Node 20. No new dependencies.

## Architecture (relevant flow)
`mergeCheck` -> guards -> `ciDecision` (before any run) -> optional `head_moved` re-read -> `runVerify({noCache:true, base})` (base side first, all commands; then head side with inline `settle`) -> reasons -> report. Runner: `rs_main` discovers `$RS_ROOT/_test-fixtures/*/run*.sh`, reads groups from `$RS_ROOT/_test-fixtures/suite-groups.json`, per-suite worker with isolated HOME/vault, run lock `/tmp/a1-suite-runner-<uid>` (seam `A1_SUITE_LOCK_DIR`, must be absolute, fail-fast exit 2).

## Key Modules
| Module | Path | Purpose | Depends On |
|---|---|---|---|
| runVerify | _shared/lib/verify-run.cjs | head/base run orchestration, SUITE_ENV_DROP l.38 | verify-base, verify-host |
| verify-base | _shared/lib/verify-base.cjs | settle, NEVER_PRE_EXISTING, withSnapshot, applySkipIncrease | git archive |
| mergeCheck | _shared/lib/pr-merge-check.cjs | gate `pr-merge-check` | guards, ci-evidence, runVerify |
| runner | bin/run-suites*.sh | parallel suites, groups, lock, leak checks | suite-groups.json |
| CI | .github/workflows/test.yml | jobs: checks, fixtures-xprov, fixtures-rest, 5x fixtures-snapshot-locale-*, enforcement | `bin/run-suites.sh --job <literal>` |

## Measurements added by this mapping
- `grep json-out|lock-wait|A1_VERIFY_LOCK` over `bin/*.sh` and `_shared/lib/*.cjs`: only `A1_SUITE_LOCK_DIR` hits (run-suites-proc.sh:222, :414). None of the new option/env names exist yet.
- `.a1/verify.json`: `each: _test-fixtures/*/run*.sh`, argv_prefix `bash`, one explicit command (run-parser.sh), `timeout_ms` 427500, `flaky_base: []`, `ci_evidence.unchanged` = `.github/`, `_test-fixtures/suite-groups.json`, `bin/run-suites.sh`, `bin/run-suites-proc.sh`, `bin/run-suites-report.sh`, `bin/ci-install-gitleaks.sh`, `_test-fixtures/a1-xprov/check-enforcement.sh`. Slice 3 touches most of these, so its own merge-check takes the local path (no CI evidence).
- `suite-groups.json`: `serial: []`, `snapshot_incompatible: {}` (both empty today), so FR-014/016 fixtures cannot rely on existing entries.
- 05-merge.md poll text confirmed: sentence "Start it only on a quiet host ..." plus `WAIT` re-check/15-min text, then the `sh` block (`pgrep -f ... verify run|pr merge-check`, load5 `node -e`). Owner decision keeps the sentence "A red reasons[] entry from a run that started above that bar ... is re-run once on a quiet host" and the `host_busy`/`load5` record; only the pgrep poll/WAIT text goes (FR-017). 06-verify.md:78 refers to that rule ("same quiet-host rule ... 15-minute cap and host_busy record") and must be reworded consistently.
- Gate registry: `pr-merge-check` row (gates-registry.md l.74) and `gate-1-build` row (l.38) describe `verify run` behaviour; both need text for lazy base / runner path / lock reasons (`lock_timeout`, runner exit 2 passthrough). `workflow-pipeline-exit` (l.69) is the lint precedent; a pgrep-poll lint rule belongs with `workflow-lint-verify.cjs` (gate id must be registered; quality-invariants: every reason class stays).
- CI: fixture job names are literal; `--check-groups` reads test.yml with a line regex. Any new suite file under `_test-fixtures/*/run*.sh` must be placed in `ci_jobs`, else `--check-groups`/test-fixtures gate fails. New `cases-*.sh` files inside existing suites avoid that.

## Quality Notes
- Existing fixtures are big (`a1-verify/run-tests.sh` 784, `a1-pr-merge-check/run-tests.sh` 681): add cases as new `cases-*.sh` files sourced by the run-tests, never edit existing assertions (FR-012 numstat).
- `verify-run.cjs` at 561 with `runVerify` ~60 lines: extraction needed. No spawn-counting seam exists.
- Runner suites nest runners via `A1_SUITE_LOCK_DIR` seams (a1-suite-runner, a1-vault-cockpit 04c); a new `A1_VERIFY_LOCK_DIR` seam must likewise be set by fixtures that run `verify run`/`merge-check` to avoid colliding with the real lock when the suites themselves run under the outer lock.

## Concerns (ordered)
1. Runner trust boundary: groups file read from head root while script from base (needs runner option; RESEARCH risk 1).
2. Evidence via validated `--json-out` only, private mkdtemp dir outside the snapshot, symlink refusal.
3. Timeout must stay out of pre-existing red; watchdog needs bash-3.2-safe build (polling, no `timeout`).
4. Runner copy from base must keep the filename `run-suites.sh` (lock liveness checks `ps` command string).
5. Slow own-merge-check (~50 min serial, measured in BASELINE.json); schedule once.
6. Samuel review required (verify-run/base/pr-merge-check/ci-evidence changed).

## Relevant for This Task
- Open decision is closed: re-run-on-quiet-host rule and `host_busy`/`load5` recording stay; plan only removes the pgrep/WAIT poll text and its `sh` block, and adjusts 06-verify.md l.78 wording.
- Settle order: `settle(first, retry, baseIds, flakyBase)` needs `baseIds` before a retry; today head side settles inline (verify-run.cjs runHeadSide l.356). Base consumers downstream: `base.ids`, `base.skipped`, `base.durations`, `base.cache`, `baseMs`; record already permits null base durations.
- Runner exit codes: 0 / 1 / 2; exit 2 also for lock held. Long-path mapping: runner exit not in {0,1} or JSON invalid/set mismatch -> merge-check exit 2, never red or green.
- Eligibility for the long path (all commands argv `bash <id>`, reporter `none`, id under `_test-fixtures/` discoverable) is a planner rule not in the spec; other repos stay sequential.
- Files that must change: verify-run.cjs, verify-base.cjs (maybe), pr-merge-check.cjs, help-merge-check.cjs/help-verify.cjs (new reasons/options), bin/run-suites*.sh, verify-lock.cjs (new), workflow-lint-verify.cjs + fixture, 05-merge.md, 06-verify.md, gates-registry.md rows, possibly test.yml (numstat step) and agent-lessons.md:393 (lesson text mentions pgrep; not a skill, lint scope is `skills/`).
