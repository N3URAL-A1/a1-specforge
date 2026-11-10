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
