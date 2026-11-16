---
focus: all (scoped to slice 2 files)
generated: 2026-11-16
---

# Codebase Map: 027 slice 2 (anchors only; RESEARCH.md not repeated)

Measured on main 45ee7f1. Line numbers are from `wc -l` and reads on that sha.

## Key Modules (anchors, size, headroom to 800)

| File | Lines | Headroom | Anchors |
|---|---|---|---|
| `_shared/lib/verify-run.cjs` | 551 | 249 | `resolveCommands` 200-217 (returns `{commands, skipped, envRed, source, noTestsReason, requiresEnv, flakyBase, eachCfg}`, validates keys via `hostLib.validateEnvRed(cfg)` at 203); `changeSet` 330; `headCommands` 476-485 (expands `each` on HEAD tree only when `sel.compareBase`); `runVerify` 495-547: `changed` 509, `withTimeout` 511, `headTimed` 514, `hash` 515, `runHead` 522, `applyEnvRed` call 532, return object 537-542; exports 551 (no `affected` helper). |
| `_shared/lib/verify-cli.cjs` | 86 | 714 | `KNOWN_FLAGS` 19 (bool flags are special-cased in `parseArgs` 31: `no-cache` skip; a new bool `affected` must be added to that skip at line 31); `parseArgs` 27-40 returns `{project, base, out, timeoutMs, noCache}`; `writeOut` 43; `cmdVerifyRun` 51-77 (record built 69, `--out` write 70, emit 76); router `cmdVerify` 80-84 (only `run`, `check`; usage string at 83 lists all subcommands, add `reuse` there). |
| `_shared/lib/verify-check.cjs` | 98 | 702 | `checkVerification` 62-81: reasons chain `verify_run_missing` 69, `verify_run_not_pass` 70, `head_sha_invalid` 71. Insert `scope` refusal after line 70 (before git work). `cmdVerifyCheck` 84 takes exactly one file and zero `--` args (exit 2 otherwise). Exports `gitRaw, headSha, splitNul, diffNames, readVerifyRun, SHA_RE` are reusable by `verify reuse`. |
| `_shared/lib/help-verify.cjs` | 13 | n/a | `VERIFY_HELP`: single template string, one block per subcommand; `verify check` text at the end (exit-code doc, invariant 7). Update both blocks. |
| `_shared/lib/workflow-lint.cjs` | 425 | 375 | `listWorkflowFiles` 203-232 (only `skills/*/workflows/*.md`); `cmdWorkflowLint` 375-412 (loop 391-400 scans each file, then `checkVaultSyncSteps` 283); output keys `root, scanned, vault_sync_checked, findings`; exports 415-424 (also consumed by `check-wave11-callsites.cjs`: `extractBashFenceLines`, `joinContinuations`). New rule fits as a sibling of `checkVaultSyncSteps` plus one concat after line 405; put it in a new module (e.g. `workflow-lint-verify.cjs`) to keep this file small. |
| `_shared/lib/pr-merge-check.cjs` | 281 | 519 | line 240 `runVerify({ project, base: baseRef, noCache: true })` only. |
| `bin/run-suites.sh` | 597 | 203 | header/help = `sed -n '2,24p'` (line 24 is the last help line: new flag docs must stay within lines 2-24 or the `-h` range must be widened); `rs_check_groups` 167-243 (ALLOWED_CALL regex at ~line 199 already allows `--flag [value]` before `--job`, so `--locale-native --job X` passes the allowlist as is; `ci_jobs` loops at 179-190 and 238 are the only places that need an `ci_extra_jobs` sibling); `rs_select_job` 156-165 (reads `RS_JOB_LINES`, `J<TAB>job<TAB>id`); `rs_load_groups` node parser lines ~88-113 (`isObj`, `isList`, `fail`, validates ci_jobs name regex at 105: reuse for `ci_extra_jobs`/`snapshot_incompatible`); `rs_main` option loop 508-519 (add `--locale-native` case; unknown `-*` dies at 517); `export LC_ALL=C` at 545 (guard with the flag; keep the comment FR-027). |
| `bin/run-suites-proc.sh` / `-report.sh` | 456 / 140 | 344 / 660 | not expected to change; `a1-suite-runner` copies the runner trio into inner trees (see below). |
| `_test-fixtures/suite-groups.json` | 140 | n/a | keys: `serial` (6), `no_count` (2-4), `ci_jobs` (6-72), `timings` at 74 (`measured`, `seconds`; max `a1-xprov/run-tests-b.sh` 316). |
| `.a1/verify.json` | 10 | n/a | single-line `ci_evidence` object (line 9); `timeout_ms` 7200000 at line 7. Every key edit changes the config fingerprint (see RESEARCH risk 1). |
| `.github/workflows/test.yml` | 233 | n/a | jobs: `checks` 21 (steps: `--check-groups` 53-57, workflow lint 84-91, gate wiring 93), `fixtures-xprov` 142, `fixtures-rest` 179, `enforcement` 217 (`needs` 219). Fixture job template 142-177: checkout (persist-credentials false), setup-node 20, gitleaks install, step `Fixtures` with `set -e`, an `echo "glob count: $(ls _test-fixtures/*/run*.sh | wc -l)"` line (keeps the `ci_globs` literal) and one `bash bin/run-suites.sh --job <name>` line. New job should copy this shape; the call line must be alone on its line. |
| `_shared/push-cadence.md` | 135 | n/a | P2 at 42-61 ("the suite" = CLAUDE.md commands, else workflow run steps, else package.json). |
| `_shared/gates-registry.md` | n/a | n/a | row `gate-1-build` at line 38 (long cell; edit text for `--affected`). |
| `_test-fixtures/a1-gates-lint/check-wave11-callsites.cjs` | 53 | n/a | `FLAGS['verify run']` at line 14 (add `affected`); `FILES` 21-28 lists the six wired files incl. `agents/a1-victor-verifier.md` (`<phase>` placeholder) with expected call counts; check at 45 requires `--phase <placeholder>` and `RC=$?` on the same joined line. A `verify run --affected` per-wave line must still carry both. |

## Call sites (exact lines)

| Site | Line | Text shape |
|---|---|---|
| `skills/a1-execute/workflows/02-execute.md` | 149 | `verify run --project "$WORK_PATH" --phase <phase_name>; RC=$?` (per wave; add `--affected`). Prose lines 144-145 (intent child skip), 156 (reading the record). |
| `skills/a1-new-feature/workflows/05-implement.md` | 271 | `verify run --project <dir> --phase <spec-id>; RC=$?` (per wave); prose 266-267, 276. |
| `skills/a1-execute/workflows/03-verify.md` | 30 | `verify run ... --out .a1/phases/<phase_name>/VERIFICATION.md --phase <phase_name>; RUN_RC=$?` (Verify, must stay full). |
| `skills/a1-new-feature/workflows/06-verify.md` | 74 | same, `<spec-id>`; verify check at 87. |
| `agents/a1-victor-verifier.md` | 85 | `node "$A1_TOOLS" verify run --out ".a1/phases/<phase>/VERIFICATION.md" --phase <phase>; RC=$?`; prose 89-93, 193, 202. Outside `workflows/`, not seen by `listWorkflowFiles`. |
| `skills/a1-pr-review/workflows/05-merge.md` | 64, 72 | prose and a `pgrep` line mentioning `verify run`; the `verify reuse` ban target (a `.md` in `workflows/`, covered by `listWorkflowFiles`; `pr-merge-check.cjs` is not). |

Fence-extraction: `extractBashFenceLines` / `joinContinuations` (workflow-lint.cjs 123, 163) return `{text, lineNo}`; reuse them in the new lint rule exactly as `check-wave11-callsites.cjs` does.

## Existing tests to extend (do not grow the big ones)

| Suite | Size | Notes |
|---|---|---|
| `_test-fixtures/a1-verify/run-tests.sh` | 778 (22 headroom) | already over the "keep small" bar; it sources `cases-durations.sh` (45), `cases-host.sh` (154), `cases-envred.sh` (130) at lines 773-775. Add `cases-affected.sh`, `cases-reuse.sh` and source them there (3 lines). Helpers used by cases: `check "<name>" <exit> '<js expr over j>' "<expected>"`, `newproj <label>` -> `$P` (line 92), `g "$P" ...` git wrapper. Existing sections to mirror: E (verify check, line 256), H (usage/hostile input, 288), K (result cache, 382), C3 (`--no-cache`, 677), M5 (`.a1/` never dirties the tree, 570). |
| `_test-fixtures/a1-workflow-lint/run-tests.sh` | 414 | has `snippets/` dir for planted trees; add a part or new runner (any new `run*.sh` needs one `ci_jobs` entry and a `timings` line, else `--check-groups` is red). |
| `_test-fixtures/a1-gates-lint/` | `run-tests.sh`, `run-wave13.sh`, `run-wave14.sh`, `check-callsite-flags.cjs` (192), `check-wave11-callsites.cjs` (53) | wired-call checks live here; `run-wave13.sh` also invokes workflow lint. `check-callsite-flags.cjs` is a second flag list: grep it for the `verify run` flag set before editing (not read in this map). |
| `_test-fixtures/a1-suite-runner/` | `run-tests.sh` 98 + 15 parts | parts are numbered 01..14 (some two share 08: `08-security.sh`, `08-subset.sh`); `08-subset.sh:95-98` has the `LC_ALL=C` asserts; `11-check-groups.sh` (184) is where planted-workflow shapes for `rs_check_groups` live: extend with a `ci_extra_jobs` case in a NEW part (e.g. `15-locale-extra-jobs.sh`), existing asserts untouched. Suite copies the runner into inner trees and the sorted `parts/*` glob here is C-ordered by the runner's LC_ALL. |
| `_test-fixtures/a1-vault-cockpit/run-tests.sh` | glob at 99-101 | `shopt -s nullglob; parts=("$SUITE"/parts/*.sh)` (line 100); the owner-approved fix is to sort the array (e.g. `LC_ALL=C` collation for the glob or `mapfile` over `printf | LC_ALL=C sort`; bash 3.2 compatible, no `mapfile`). Parts order: 01-schema-export, 02-mirror, 03-sync, 04a-transaction, 04c-suite-isolation, 05-hosts, 05b-writer, 05c-writer-cmd, 06a-lint, 06b-hub, 07-coherence. `H_LOCKS` set at `parts/05-hosts.sh:62`, used first in `05b-writer.sh:247`. Under en_US `05b` sorts before `05-` (hyphen ignored). |

Convention reminder: runs on GNU/Linux CI and macOS: bash 3.2 compatible code, no `sed -i ''`, no GNU-only flags.

## Architecture notes relevant to slice 2

- Data flow of `verify run`: `cmdVerifyRun` -> `runVerify` (plan from working-tree `.a1/verify.json` when no `--base`) -> `resolveCommands` (`each` expanded from HEAD git tree) -> `withTimeout` -> `commandHash` -> `runHeadSide` (cache) -> record. `--affected` filtering has one natural seam: after `resolveCommands` at 504 and before `withTimeout` (511-514) so `hash`, `cache` and `duration_ms` all see the subset. `plan.skipped` and `plan.envRed` stay full (see RESEARCH, applyEnvRed at 532).
- `opts` reaches `runVerify` only from `cmdVerifyRun` (verify-cli) and `pr-merge-check.cjs:240`; there is no third caller (check with `grep -rn "runVerify" _shared`).
- Report copy belongs after line 69 in `cmdVerifyRun`, guarded by `opts.base === undefined`; `git rev-parse --git-common-dir` is already used by `vb.ensureCacheExcluded` (verify-base.cjs).
- `verify check` reads only the VERIFICATION.md frontmatter (`readVerifyRun` handles object or JSON-string); a new `scope` key in the record is therefore visible to it with no parser change.

## Quality Notes

- Sizes: all files above stay well under 800 with the proposed splits; only `a1-verify/run-tests.sh` (778) cannot take more content.
- Tests exist for: verify run (A..S sections), verify check (E), result cache (K), workflow lint (snippets), call-site wiring (wave11/13/14), runner groups (11-check-groups.sh), runner locale (08-subset.sh).
- No existing test for: `--affected`, `scope`, `verify reuse`, report copy, `--locale-native`, `ci_extra_jobs`, `snapshot_incompatible`, `timeout_ms` vs `timings` agreement (grep of those names found no fixture; they are new surface).

## Concerns (map-level, ordered)

1. `a1-vault-cockpit` harness glob (owner decision): is sorted-glob only; the suite is the only measured locale defect, so the new locale job's first CI run is the sole proof.
2. `bin/run-suites.sh` help range is fixed (`sed -n '2,24p'`, header already ends at line 22-24): new flag documentation can silently be cut off.
3. `rs_check_groups` is an inline node program inside a bash heredoc string (single-quoted): any new JS must avoid single quotes (existing code uses `\x27` for them, e.g. the `--job` regex) or it breaks the shell quoting.
4. Two flag lists exist for gate call sites (`check-wave11-callsites.cjs` line 14 and `check-callsite-flags.cjs`); an unnoticed second list would turn `a1-gates-lint` red.
5. `verify-cli.cjs` `parseArgs` skips the plain-value check only for `no-cache` (line 31); a new bool flag not added there fails with `usage` (`needs a plain value`).

## Relevant for This Task

- Edit set in dependency order that the fixtures imply: verify-run/verify-cli/verify-check/help-verify (+ new `verify-affected.cjs`, `verify-reuse.cjs`) -> `check-wave11-callsites.cjs` + `check-callsite-flags.cjs` flag lists + gate-1-build registry text -> five call sites (02-execute:149, 05-implement:271 get `--affected`; 03/06/Victor stay full) -> workflow-lint rule + file list incl. `agents/a1-victor-verifier.md` -> push-cadence P2 -> runner (`--locale-native`, `ci_extra_jobs`, `snapshot_incompatible`, `rs_check_groups`) -> `suite-groups.json` -> `test.yml` job -> `.a1/verify.json` (last, config fingerprint) -> disposition commit.
- New suite runners need `ci_jobs` + `timings` entries or `--check-groups` fails in the `checks` job; adding a part file to an existing runner needs neither.
- Samuel is not auto-triggered for `verify-run.cjs` (slice 1 lesson, in RESEARCH).
