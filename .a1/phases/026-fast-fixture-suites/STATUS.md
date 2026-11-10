# STATUS — 026-fast-fixture-suites

## Wave 1 — Runner core (Tasks 1.1 and 1.2 done; Task 1.3 NOT run)

Date: 2026-11-10. Interpreter: `/bin/bash` 3.2.57 (arm64 macOS). Only `a1-suite-runner`, `a1-vault-fallback`
and `bin/verify-install-sync.sh` were run (another full suite run, spec 025, is active); no real suite set was
started by the runner; nothing touched `/tmp/a1-suite-runner-<uid>` (lock is a W1 stub, the harness sets the seam).

### Task 1.1 — red
`git 62683ce`: runner files absent, `bash _test-fixtures/a1-suite-runner/run-tests.sh` →
`a1-suite-runner: 16 passed, 61 failed` (rc 1). Reason: `bin/run-suites.sh` missing (S0 cases red, every runner start
returns rc 127). The 16 passes are negative asserts ("probe absent") that are vacuously true without a runner; each is
paired with an exit-code or positive assert that is red.

### Task 1.2 — green
`a1-suite-runner: 77 passed, 0 failed` (about 17 s). Same under the exact I1 environment
(`env -u A1_VAULT_WRITER_HOST A1_HOST_ID=leak A1_VAULT_ROOT=<empty> HOME=<fresh>`): 77/0, sentinel and fresh HOME empty afterwards.
`a1-vault-fallback`: `Total: 21 passed, 0 failed` (L1/L1b/L2 over `bin/run-suites*.sh`). `verify-install-sync`: PASS.
Not run (instruction): `a1-tmp-hygiene` (Wave-1 gate lists it), Task 1.3.

### Assert counts per part file
| File | Asserts | FRs |
|---|---|---|
| parts/01-discovery.sh | 25 | FR-001, FR-025 |
| parts/02-pool.sh | 23 | FR-002, FR-003 |
| parts/03-isolation.sh | 29 | FR-021 |
| total | 77 | |

### Mutation proof (git archive snapshot of HEAD in scratchpad, one mutation each; control: 77/0)
Every mutation turned at least the named case red (26 of 26, incl. the m03b rerun).
| # | Mutation | Red cases |
|---|---|---|
| m01 | drop the `run-parser.sh` append in discovery | D1a, D1b, D1c |
| m02 | glob widened to `*/*/run*.sh` | D1a, D1b, D1c, D1d |
| m03b | glob `*.sh` instead of `run*.sh` | D1a, D1b, D1c, D1e (first attempt m03 left D1a green: the list regex only matched `run*.sh`; regex fixed) |
| m04 | default workers without "- 2" | P1a, P1b, P1d, P1f, P1h |
| m05 | upper clamp 6 → 60 | P1c, P1e |
| m06 | lower clamp dropped | P1a, P1d, P1g, P1h |
| m07 | sysctl fallback dropped | P1e |
| m08 | `--workers 0` accepted (runner hangs; harness watchdog ends it) | P2a |
| m09 | `serial` ignored | P4a |
| m10 | whole directory `x/` forced into serial | P4d |
| m11 | pool width 99 instead of N | P3a (max overlap 4) |
| m12 | pool width 1 | P3b, P4d |
| m13 | declaration-file error not exiting 2 | D4/invalid, D4/shape, D4/nokey (3 asserts each) |
| m14 | HOME not replaced | I1a, I1d |
| m15 | `A1_HOST_ID=x` | I1b |
| m16 | `-u A1_VAULT_WRITER_HOST` dropped | I1c |
| m17 | outer `A1_VAULT_ROOT` passed through | I1d2, I1e |
| m18 | one shared sentinel/home dir | I1d, I1d2, L1c, L1c2 |
| m19 | sentinel emptiness check dropped | L1a, L1c, L1d, L1e |
| m20 | `head -n 3` removed from leak listing | L1e |
| m21 | per-run work dir not removed | H1 |
| m22 | a1-reconcile restore dropped | R1a, R1b, R1c |
| m23 | restore although local edits existed | R2b, R2c |
| m24 | no skip line outside a git work tree | R3b |
| m25 | reconcile check although not selected | D1g |

Scripts: `<scratchpad>/mutate.sh`, `<scratchpad>/mutlist.sh` (not in the repo).

### Notes for later waves
- **Task 1.3** needs: no foreign suite run (`ps -ax -o command= | grep -c '_test-fixtures/.*/run'`), `bash bin/run-suites.sh --workers 1`
  (alone) and a default-worker run (under load) on the real tree; per-suite rows come from the live lines
  `done: PASS|FAIL <id> (<n>s)` and the final `suite results:` table; logs under `${TMPDIR:-/tmp}/a1-suite-runs/<run id>/`.
  `timings.seconds` in `_test-fixtures/suite-groups.json` is empty and `serial` is empty. Start order is "unknown first", so
  with empty timings the order is alphabetical; set `a1-intent/run-tests.sh` first by giving it a large timing entry for the alone run.
  Measure `a1-vault-cockpit` I1 (nested re-run) under load; note the runner has no `--workers`-independent subset option until W4.
- **W2** (report): replaces `rs_parse_count`, `rs_print_table`, `rs_print_failures` in `bin/run-suites-report.sh`; the entry
  calls `rs_record_result <id> <rc> <sec> <log> <note>` and prints its own `done:` lines and `leaked:` lines (parts 03 greps
  `done: PASS|FAIL <id>` and `leaked: `, so keep those entry lines). `no_count` is parsed by the declaration loader but not yet used.
- **W3** (proc): `rs_default_workers`, `rs_is_posint` and the slot functions live in `bin/run-suites-proc.sh`; part 02 sources that
  file to test `rs_default_workers`, so keep them there. `rs_spawn_worker` sets `RS_LAST_PGID` instead of printing the pgid (a command
  substitution would make the worker a child of a subshell and break `wait`). `rs_lock_*` and `rs_export_marker` are no-op stubs.
  Finding: a runner started with `&` from a non-interactive shell inherits SIGINT as ignored (POSIX), and bash cannot trap an
  inherited-ignored signal. The W3 SIGINT fixture must start the runner under `set -m` (own process group) or use SIGTERM for the
  default case. Measured by hand: SIGTERM to the runner removes the worker group, the grandchild sleeper and the work dir.
- **W4**: unknown positional arguments exit 2 today ("unknown argument"); subset selection replaces that branch in `rs_main`.
- Harness differences from the Contract: the final lines follow CONVENTIONS (summary echo, then `[[ $fail -eq 0 ]]`);
  `rs_run` starts the runner in the background and polls it with a 60 s limit (kills only its own `$!`), so a hung runner turns one case red.

## Wave 2 — Logs, timing table, failure output, assert summaries (done)

Date: 2026-11-10. Commits: `217661c` (red parts 04/05), `342c05a` (report helper + 2-line entry hook), rename commit (U1 case ids).
Red: `a1-suite-runner: 116 passed, 17 failed` (parts 04/05 on the W1 report stub). Green: `133 passed, 0 failed`
(W1+W2); live tree with W3 parts present: `206 passed, 0 failed`. `a1-vault-fallback` 21/0, `verify-install-sync` PASS.
No real suite and no full run was started.

| File | Asserts | FRs |
|---|---|---|
| parts/04-report.sh | 32 | FR-004, FR-005, FR-006, FR-024 |
| parts/05-summary.sh | 33 | FR-007 |

Count = passed + failed of the last summary line (formats: `N passed, M failed` anywhere in the line, `pass=N fail=M`,
`passed: N  failed: M`). All 58 real `run*.sh` echo templates parse (checked by substituting the vars); only
`a1-schema-check/parser/run-parser.sh` has none -> `no_count` stays `[that one]` (static check, not the W1 log
directory: Task 1.3 has not run). Table row: `status seconds count identity` (identity last).

Mutation proof (git archive snapshot of HEAD, W3 parts removed, one mutation each; control 133/0):
| # | Mutation | Red cases |
|---|---|---|
| m1/m2/m3 | drop regex format 1 / 2 / 3 | C1a-d, N1c2 (+ most runs) / C1b / C1c, C1c2 |
| m4 | first instead of last match | C1d, C1d2 |
| m5 | accept `PASS:` line | C1e |
| m6 | drop no_count lookup | N1b, N1b2, N1c |
| m16 | drop the whole no-summary guard | N1a, N1a2, N1a3 |
| m17 | no no_count report line | N1c2 |
| m7 | sort ascending | T1a, T1d, T1h |
| m10 | count column fixed `n/a` | T1d |
| m11 | table skips a row | T1a, T1e, T1d, T1h, F1h, U1d, N1b2 |
| m8 | log stdout only | G1b |
| m9 | log name = basename | G1e, G1c |
| m19 | log dir line not printed first | G1d (+G1a-c, G1e) |
| m12 | failure line without log path | F1g, N1d |
| m13 | signal note dropped (rc>128 branch) | F1f |
| m18c | stop starting suites after the first failure | F1b, F1c, F1d, F1f, F1g, F1h |
| m14/m15 | identity basename in row / failure line | T1a, U1b, U1d, N1b2 / F1e, F1f, F1g, U1c, N1a2, N1d |
(m18 first attempt was a no-op mutation and stayed green; replaced by m18c.) Scripts in the scratchpad, not in the repo.

Deviations from the plan:
- `bin/run-suites.sh` touched (2 lines in `rs_on_suite_done`: `rs_summary_note`), because the live `done:` line is
  printed before the result is recorded; without it a no-summary suite would print `done: PASS` and fail only in the table.
- FR-004 "git status of the repo unchanged" is asserted for the planted tree only: the repo worktree is edited concurrently
  by Wave 3, so a repo-wide porcelain compare would be racy. The runner never writes outside `--root` copies/TMPDIR.
- Identity cases are named `U1*` (my `K1*` collided with W3's K-case names; renamed in a follow-up commit).
- `no_count` measured statically (see above), not from a W1 measurement run.
- `no_count` report line is printed at the end of `rs_print_table` (no new entry call site).
