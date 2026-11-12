---
focus: all (scoped to spec 027 slice 1 "Measure + protect")
generated: 2026-11-12
---

# Codebase Map: 027 slice 1

Companion to `RESEARCH.md` (same dir). Facts below were re-measured on `main` @ `2ac1a49`. Working tree: only `docs/product/*` modified, plus untracked `.a1/phases/027-lean-pipeline-s1/` and `docs/product/features/027-lean-pipeline/`. Repo is a git repo with history (`git status` ran).

## Structure (only what this slice touches)

```
_shared/a1-tools.cjs            777 lines  facade; hook install ~408, group branches ~698-745, unknown-group msg ~765 (cap 800)
_shared/gates-registry.md       gate table; `pr-security-surface` count = 0 today (measured grep)
_shared/lib/
  gate-log.cjs        372  appendGateLine 193, shapeProblem 223, verifyChain 241, stripPhase 288, projectDirOf 306, recordRun 317, installGateLog 343
  verify-run.cjs      515  spawnGroup 250, runCommand 257, finishCommand 275, runBaseSide 328, runHeadSide 340, runVerify 472
  verify-base.cjs     292  cache (read/writeCache)
  verify-cli.cjs       86  writeOut -> VERIFICATION.md frontmatter `verify_run`
  verify-check.cjs     98  reads that block
  pr-merge-check.cjs  273  projectSlug 129, ciDecision 211, mergeCheck ~226, cmdPrMergeCheck 255
  pr-ci-evidence.cjs  115  decide() -> `why` tokens
  gates-lint.cjs      198  lintGates 178 (pure)
  gates-cli.cjs       131  cmdGatesLint, resolveInputs (yields root)
  gate-ids.cjs        392  invokeMap ~360
  retro-gatelog.cjs   106  lastVerdicts (private), firedYaml, readGateLog
  metrics.cjs          27  SUBCOMMANDS router; metrics-runs 117, metrics-cost 182; help-metrics 26; help-gates 42
  xprov-scope.cjs     213  cmdXprovScope 185; flags: paths, base, head, repo only
  io-roots.cjs        337  peekVaultRoot 59, resolveVaultRoot 74
  emit-exit.cjs        56
skills/a1-pr-review/workflows/02-review.md (176 lines; 2.2b xprov scope call at lines 62-77)
skills/a1-pr-review/workflows/05-merge.md  (124 lines; 5.3 merge-check line ~78; 5.4 close-out ~95-120)
.github/workflows/test.yml      steps: "xprov allowlist approve guard (committed wiring)" line 118, "Gate wiring lint" line 93, "Cross-provider enforcement flip" line 227
docs/adr/2026-10-14-gate-invoke-and-log.md   (ADR to amend)
_test-fixtures/{a1-metrics,a1-gates-lint,a1-verify,a1-pr-merge-check,a1-retro-validate,a1-xprov,a1-cli-output,a1-lib-units}
```

New files expected (none exist yet): `project-slug.cjs`, `metrics-phase-time.cjs`, `run-record.cjs`, `help-run.cjs`, `quality-invariants.cjs`, `_shared/quality-invariants.json`. All other modules named above are far below 800 lines; only `a1-tools.cjs` (23 lines headroom) is a cap risk.

## Tech Stack

Node >= 18 CJS, no npm deps in lib; Bash + `node -e` fixtures; GNU/Linux CI. Integers in ms for durations, ISO-8601 UTC for `started_at`.

## Architecture (data flow relevant to the slice)

1. `a1-tools.cjs` calls `gate-log.installGateLog(argv)` before dispatch. `matchInvoke` maps argv to a registered gate id via the registry `invoke` cell (`gate-ids.invokeMap`). On a match, `stripPhase` removes `--phase`, `projectDirOf` picks the repo (`--project` only, else cwd), and `process.on('exit')` runs `recordRun` -> `appendGateLine`, a hash-chained JSONL line (`prev` = sha256 of previous raw line) at `<repo>/.a1/phases/<scope>/gate-log.jsonl` (gitignored via info/exclude).
2. `emitExit` sets `process.exitCode` then exits, so the exit hook fires after the command's work. Duration and the extras setter must live in module state read by that handler.
3. `verify run`: `runVerify` -> `runBaseSide`/`runHeadSide` -> `runCommand` -> `spawnGroup` (the only spawnSync site). `finishCommand` spreads the raw result into `commands[]`, so a `duration_ms` on the raw result propagates. Cache stores `raw`, so a hit carries stale or no duration. `merge-check` uses `noCache: true`.
4. `pr merge-check`: `mergeCheck` builds `report.ci_evidence {used, why, checks}`; `cmdPrMergeCheck` emits via `emitExit`.
5. Learning store: `<root>/pattern/a1-learnings/` (siblings `_archive`, `_canonical`, `_state`, retros). `_runs/<project>.jsonl` is new.
6. Lint: `gates lint` -> `lintGates({registryText, skillsRoot, today})` pure; findings `{rule, gate, reason}`.

## Key Modules

| Module | Path | Purpose | Slice change | Depends on |
|---|---|---|---|---|
| gate-log | `_shared/lib/gate-log.cjs` | chained gate log + exit hook | add `started_at`, `duration_ms`, `extra`; export `setRecordExtra` (module state, frozen replace, whitelist, reset after write) | fs, git, locks |
| verify-run | `_shared/lib/verify-run.cjs` | verify engine | wrap `spawnGroup` with hrtime; `duration_ms`, `base_duration_ms`, `retry_duration_ms`, top-level `{head, base, total}`; cache hit -> null | verify-base |
| pr-merge-check | `_shared/lib/pr-merge-check.cjs` | merge gate | `setRecordExtra({ci_evidence_why})` after `mergeCheck`; import shared `projectSlug` | pr-ci-evidence |
| project-slug (new) | `_shared/lib/project-slug.cjs` | slug helper | move `projectSlug` unchanged (also needs SLUG_RE, parseNestedFrontmatter source) | io |
| retro-gatelog | `_shared/lib/retro-gatelog.cjs` | log -> retro | export `lastVerdicts` + helper `gatesFired(records)` | gate-log |
| metrics-phase-time (new) | `_shared/lib/` | `metrics phase-time` (live + store, `--baseline`) | new; router row in `metrics.cjs` SUBCOMMANDS + two usage strings; help in `help-metrics.cjs` | gate-log verifyChain, io-roots |
| run-record (new) | `_shared/lib/` | `run record` | new group `run`: one-line facade branch + unknown-group msg + HELP; `help-run.cjs` | peekVaultRoot, retro-gatelog, fs-safe |
| quality-invariants (new) | `_shared/lib/` + `_shared/quality-invariants.json` | FR-034 lint | called from `cmdGatesLint`; resolve from `--root`; rules `invariant_missing/_unwired_until/_unwired/_owner_lost/_ci_step_missing` | gates-lint, test.yml |
| registry row | `_shared/gates-registry.md` | `pr-security-surface` | class deterministic, blocking, invoke `` `xprov scope` @ a1-pr-review `` (prompt rows cannot hold invoke: rule `prompt_names_command`) | gate-ids |

## Measured facts that change the plan

- **`xprov scope` rejects `--project`** (ran `a1-tools.cjs xprov scope --base HEAD --project .`: `usage error: xprov scope unexpected argument "--project"`). RESEARCH option (a) (pass `--project`) therefore requires adding `project` to the `parseFlags` schema at `xprov-scope.cjs:186`, or option (b) extend `gate-log.projectDirOf` (lines 306-315, only `--project` today) to also honour `--repo`. The `02-review.md` call at line 71 uses `--repo "<worktree_path>"` and has no `--phase` yet.
- `xprov scope` exit is 0 on any successful run (`EXIT_PASS`, `emitJson(report, xprov.EXIT_PASS, true)`), usage error otherwise; keep it.
- `--repo` is only valid with `--base` (line 192).
- Registry: `pr-merge-check` row at line 74, `pr-reinhard` at line 54 (prompt, untouched this slice), `live-probes` at 75.
- Existing suite split: `a1-metrics` is parts-based (`parts/01-postmortem` 215, `02-escaped` 242, `03-cost` 192, `04-audit` 78 lines; `run-tests.sh` 79 lines globs `parts/*.sh` in NN order, so a new `05-*.sh` is picked up with no wiring). Fixtures dir: `_test-fixtures/a1-metrics/fixtures/{cost,escaped,fixes,postmortems,spec}`.
- `a1-gates-lint`: `run-tests.sh` 492 lines, `run-wave13.sh` 91 lines (precedent for a new `run-wave14.sh`; both listed in `suite-groups.json` lines 26-27 and timing at 88/114). A new runner file needs an entry in `suite-groups.json` (`ci_jobs` list once) and `bash bin/run-suites.sh --check-groups`.
- `a1-metrics/run-tests.sh` appears at `suite-groups.json` line 35 (timing 4 s).

## Where new fixture cases go

| Requirement | Location | Notes |
|---|---|---|
| FR-001 gate-log fields, `setRecordExtra`, chain compat with old log, whitelist rejects | new `_test-fixtures/a1-metrics/parts/05-gate-log-fields.sh` (or `a1-gates-lint/run-wave14.sh`); hook cases F1-F4 live in `a1-gates-lint/run-tests.sh` ~268-310 | real old-format log line as fixture; RED-proof: make `duration_ms` required |
| FR-002 verify durations | `_test-fixtures/a1-verify/run-tests.sh` (774 lines; do not grow much, add a sourced part or new small script) | live durations non-negative ints; cache hit null; zero deleted assert lines |
| FR-003/004/005 phase-time, baseline, `ci_evidence_why` | `a1-metrics/parts/06-phase-time.sh`; merge-check three `why` values via `a1-pr-merge-check/run-tests.sh` (661 lines, `A1_GH_BIN` fake gh) | baseline with temp `--out`; second write exits 1 |
| FR-035 run record | `a1-metrics/parts/07-run-record.sh` | `unset A1_VAULT_ROOT` then point to `mk_workdir`; no-store case exits 1 and changes nothing |
| FR-033 wiring | `a1-gates-lint` (new wave file) + `a1-retro-validate/run-tests.sh` real-corpus registry `a1-gates-lint/corpus/registry-real-rows.md` | run real call text against a worktree copy |
| FR-034 invariants | `a1-gates-lint` planted-tree (`--root <copy> --registry <file>`), one assert per keep-list id (12), plus one per extra rule | real tree exit 0 plus planted RED |
| Facade/help | `a1-cli-output`, `a1-lib-units` (run, do not edit blindly) | check for export-list or group-list freezes |

CONVENTIONS (`_test-fixtures/CONVENTIONS.md`): `mk_workdir` from `lib/tmp.sh`, no BSD or GNU only idioms, hostile-input case per new subcommand, RED-proof line per guard.

## Quality Notes

- Test files in scope are large (`a1-retro-validate` 884 lines, `a1-verify` 774); adding parts or new files avoids exceeding 800.
- Slowest suites: `a1-xprov` shards (~310 s each); registering `xprov scope` makes every call log a line, so run `a1-xprov` and `a1-intent` before pushing.
- Samuel review is required (verify-run, pr-merge-check, gate-log record contract, new vault write path).

## Concerns (by severity)

1. HIGH: `setRecordExtra` into a chained log is an injection path; needs key whitelist and format checks, no override of `ts, gate, verdict, exit, head_sha, scope, prev`.
2. HIGH: lint reading `test.yml` or `quality-invariants.json` via `__dirname` would make planted-tree fixtures vacuous; resolve from `--root`.
3. HIGH: tests writing into the real vault; every new part sets an explicit temp `A1_VAULT_ROOT`.
4. MED: `xprov scope` log lands in the wrong repo unless the `--repo`/`--project` question is solved; also no `--phase` so it would land in `_unscoped`.
5. MED: `a1-tools.cjs` 777/800; one-line branches only.
6. MED: cache-hit durations; retry double counting; live vs store dedup in `phase-time`.
7. LOW: ADR edit triggers `design-review-xprov` (needs `.a1/xprov.json` permit; ask owner once via chat if missing, never waive).

## Relevant for This Task

- Order that keeps suites green: gate-log fields and setter, verify durations, `project-slug` and `retro-gatelog` exports, `phase-time` plus `ci_evidence_why`, `run record` plus `05-merge.md` call (after 5.4 merge verification, before worktree exit), then `pr-security-surface` row and `02-review.md` wiring, `quality-invariants` lint last.
- `shapeProblem` ignores unknown fields, so old and new records share one chain without migration.
- `gate-log.cjs` is the single record writer; `setRecordExtra` must be a no-op when the hook is not installed.
- Run-record store file: `<root>/pattern/a1-learnings/_runs/<project>.jsonl`; idempotent per `scope + pr`; decide "no store" via `peekVaultRoot()` (read-only), not `vaultRoot()`.
- Baseline path is a constant for feature `027-lean-pipeline`, not this phase folder `027-lean-pipeline-s1`; plan decision: consume existing `verify run` JSON and a merge-check record, label `path: serial`.
- No open owner questions; open technical decisions are listed in RESEARCH.md "Risks" and "Recommendations".
