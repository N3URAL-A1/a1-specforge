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

## Wave 3 — Per-machine lock, takeover, process groups, seam (Tasks 3.1 and 3.2 done)

Date: 2026-11-10. `/bin/bash` 3.2.57 (arm64 macOS). Only `a1-suite-runner`, `a1-vault-fallback`, `verify-install-sync` ran; the runner
was only started on planted trees with `A1_SUITE_LOCK_DIR` set; `/tmp/a1-suite-runner-<uid>` was absent before and after
(part 06 K10 and part 07 X8 compare its state read-only). No process outside this wave's `$!` PIDs was signalled.

### Red -> green
- Task 3.1 red (`9e0ae3f`, parts 06 + 07 against the W1 stubs): `a1-suite-runner: 170 passed, 30 failed` (the 30: K1a-l, K2a/b, K3b/d, K4b, K5, K6b, K7, K8, K9b/c, X1-*).
- Task 3.2 green (`a705882`): `a1-suite-runner: 200 passed, 0 failed`; after the takeover fix and fixture widening: `206 passed, 0 failed`, 3 consecutive runs, about 45 s (budget 60 s).
- `a1-vault-fallback`: `Total: 21 passed, 0 failed`; `verify-install-sync`: PASS.

### Assert counts (W3 parts)
| File | Asserts | FRs |
|---|---|---|
| parts/06-lock.sh | 51 (K5 loops: 3 rounds x 3) | FR-008, FR-009, FR-026 |
| parts/07-interrupt.sh | 22 (3 signal cases x 7, plus X8) | FR-010 |

### SIGINT decision
Part 07 proves SIGINT itself, not SIGTERM in its place. The runner of the SIGINT case is started under `set -m` (own process
group, default SIGINT disposition, as a terminal's Ctrl-C finds it) via `lk_start` with `LK_MONITOR=1`; the fixture signals only the
runner PID (`kill -s INT`), never the group. SIGTERM runs twice: under `set -m` and plain (no job control). All three cases assert:
lock existed before, worker and grandchild alive before, runner + worker + grandchild gone within 10 s, exit code 130/143, lock
and `a1-suite-XXXXXX` work dir removed, control `sleep` outside the runner alive afterwards.

### Finding fixed in this wave: takeover race
The first version (rename stale lock away, then mkdir, verify moved pid) let two runners both take over: measured with a four-runner
script, 3 of 12 rounds ran the suite twice (the rename grabbed a competitor's fresh lock, which could not be put back because the
path was already re-created). Fix (`d0e3a68`): takeovers are serialised by a `mkdir <lock>.takeover` guard (owner pid inside; a guard
whose owner is not a running runner is removed), the state is re-judged under the guard, then rename + mkdir + write. Afterwards 8
of 8 and 15 of 15 rounds ran exactly once. Residual: a runner that crashes between guard creation and writing its pid file leaves a
guard that costs the next runner about 1 s (pid-less guard counts as stale after the read wait).

### Mutation proof (git archive snapshot of HEAD, parts 01-05 removed for speed, one mutation each; control 73/0)
| # | Mutation | Red cases |
|---|---|---|
| m1 | command-line check dropped (live `sleep` PID blocks) | K4a, K4b, K4c |
| m2 | takeover guard dropped (`rs_guard_take` returns 0); probabilistic: 3 of 3 runs red with 8 racers (4 racers: 2 of 4 runs) | K5a, K5b (K5c in one run) |
| m3 | TERM and KILL to `$pid` instead of the process group (TERM alone stays green: the later group KILL ends the grandchild after 5 s) | X3-sigint, X3-sigterm, X3-sigterm-plain |
| m4 | release not guarded by run id | K6b |
| m5 | symlink check dropped | K7b only (the other defences still refuse; K7a/K7c stay green) |
| m6 | seam ignored (fixed path redirected to scratch first, real lock never touched) | 27 cases incl. K1, K3, K9, K2a/b |
| m7 | lock never released at exit | K1n, K3d, K5c, K9e, X5-* |
| m8 | default path built from the temp-dir variable | K2a, K2c |
| m9 | refusal without holder PID | K1i (first version of K1i stayed green: the run id contains the PID; assert tightened to `holder PID <pid>`) |
| m10 | log dir created before the lock | K1j |
| m11 | marker not exported | K1e |
| m12 | interrupt exit code not 130/143 | X4-* |
| m13 | SIGINT trap missing | X3-sigint, X4-sigint |
Not provable here: the "not owned by the current user" refusal (needs a second user; `[ -O ]` guard is unmeasured).
Scripts: scratchpad (`mutrun.sh`, `m3.sh`, `m9.sh`, `race.sh`), not in the repo.

### Deviations from the plan
- `bin/run-suites.sh` touched by one line: the log dir name uses `${RS_RUN_ID:-...}` so it equals the lock's run id (Contract: log dir `<run id>`).
- `rs_kill_workers`/`rs_on_signal` (W1 code) reworked in `bin/run-suites-proc.sh`: group-level liveness (`kill -0 -- -pgid`), zombie leaders
  reaped via `ps -o stat=` + `wait` (a zombie leader answers `kill -0`, which made the W1 version wait the full 5 s grace); `rs_lock_release` also
  stops workers still recorded (FR-010 "normal exit").
- Takeover uses a guard directory (`<lock>.takeover`) in addition to rename+mkdir (see finding). The takeover message line is `took over a stale lock`.
- Refusal exit code is 2 (the entry's `rs_lock_acquire || exit 2`); symlink, foreign owner, uncreatable dir also 2. W4 owns message wording checks.
- Run id format `YYYYmmdd-HHMMSS-<pid>`; marker `A1_SUITE_RUN_MARKER=<lock>/run_id:<run id>` (W4 must split on the last colon).
- K5 uses slowed `ps`/`mv` wrappers on PATH (fixture-owned) to widen the race window; no production test hook.
- Not run (instruction): `a1-tmp-hygiene`, any full run. Samuel review not done by this agent.

## Security fixes (Samuel SEC-1..5)
Files: `bin/run-suites.sh` (`rs_make_logdir`), `bin/run-suites-proc.sh`, new part `_test-fixtures/a1-suite-runner/parts/08-security.sh`;
G1d (04) and K1j (06) adjusted to the new log base name. Log dir is now `${TMPDIR:-/tmp}/a1-suite-runs-<uid>/<run id>` (base 700, leaf 700).

| Finding | Fix | Red (before) -> green (after) |
|---|---|---|
| SEC-1 | per-user base `mkdir -m 700`, then `-L` / `-O` / group-world-writable (`find -perm`) checks -> exit 2; leaf `mkdir -m 700` without -p | new S1a-S1q (symlink base, modes 770/702/777, fresh base 700, leaf race via spy mkdir): red against the old code (no per-user base), green now |
| SEC-2 | guard judged like the lock (`-L`, not dir, `! -O`, foreign files: refuse, never delete); `rs_lock_drop_dir` only on user-owned non-symlink dirs, `cd` + `pwd -P` == parent real path + name, relative names | S2a-S2j green; dead owner's own guard still cleaned (S2h) |
| SEC-3 | `mktemp -d "$lock.stale.XXXXXX"`, then `mv "$lock" "$stale/old"` | S3a-S3d (spy mv records the target: random dir, mode 700, none left) |
| SEC-4 | takeover only if the dir holds nothing but pid/pid.tmp/run_id/runner, else exit 2; seam absolute with existing parent else exit 2 | S4a-S4i |
| SEC-5 | `rs_lock_file_line` reads `head -c 32` of a regular, user-owned, non-symlink file only; `rs_lock_read_pid` uses it | S5a-S5e (pid symlink to a live holder not followed; FIFO as pid does not hang) |

Totals: a1-suite-runner 260/0 (was 195 + 65 new asserts incl. K/G adjustments), a1-vault-fallback 21/0, a1-tmp-hygiene 21/0, verify-install-sync PASS.
Runtime of the suite about 61 s (part 08 adds about 25 s; budget was 60 s, watch it).

### Mutation proof (copy of the tree, parts 01-03/05/07 removed, one mutation each; every mutation red)
| Mutation | Red cases |
|---|---|
| base without the uid suffix | G1d, S1a-S1q (19) |
| symlink check on the base dropped | S1a-S1d, S1i (7) |
| writable check dropped | S1f-S1i (12) |
| leaf made with `mkdir -p` | S1m, S1o-S1q |
| guard symlink check dropped | S2b |
| guard foreign-files check dropped | S2e2 (first version of S2e stayed green: the flat-file drop plus the guard timeout also end in exit 2; message assert added) |
| stale target predictable | S3b |
| takeover contents check dropped | S4a-S4c, S4e, S4i |
| relative seam accepted | S4f-S4i |
| pid read through a symlink | S5a, S5b |
Not provable here: refusal of foreign-owned base/guard/lock (`-O`, needs a second user); the 32-byte bound itself (no observable difference);
the TOCTOU windows (narrowed by owner check + `cd`/`pwd -P`, not removable in shell).

## Wave 4 — Subset runs, real-store guard, failure fixture, I1 handshake, worker locale (Tasks 4.1 and 4.2 done, 2026-11-11, aiserver)

Agents: 4.1 Walter, 4.2 Walter, security fixes Walter; review Samuel. Scope addition FR-027 (worker `LC_ALL=C`, decided by Robert 2026-11-11).
gate0: runner subset `a1-suite-runner a1-vault-cockpit a1-gates-lint a1-vault-fallback a1-tmp-hygiene` → 5 of 6 PASS; a1-gates-lint FAIL only `N1 README says '57', real count 58` (this branch adds a1-suite-runner/run-tests.sh; README count fixed in wave 5)
gate0: after security fixes, runner (LC_ALL=C) → a1-suite-runner 350/0, a1-vault-cockpit 881/0 in 23 s (I1 delegates via the handshake instead of re-running every suite)
gate0: red-first 4.1 → runner suite 330 passed / 14 failed before the runner change; mutations U1–U6, V1, V2, V4, F1, F2, F4–F6, U8 (FR-027) each flip their cases; no dedicated mutation for U7 (dedupe), F3 (table rows) and V3 (sentinel vault) — covered indirectly
gate0: security review (Samuel) → 0 BLOCKER, 0 MAJOR, 2 MINOR: SEC-1 marker forgeable by any live process named run-suites.sh (holder PID not bound to the I1 process) → fixed: holder must be an ancestor (PPID walk, 64 steps), decoy case in 04d, RED proof (ancestor check removed → decoy case 3 FAIL); SEC-2 real vault never listed → fixed: read-only name listing + digest of `$A1_SUITE_REAL_VAULT` before/after, skip line when absent, V6 self-proof; NOTE: workers see the real-vault path (by spec, nothing reads it)
gate0: selector parsing (Samuel) → PASS: exact string match against discovered ids, `../x`, absolute paths and globs exit 2 before lock/work/log dirs exist
gate0: a1-vault-cockpit run directly under LC_ALL=en_US.UTF-8 aborts at parts/05b-writer.sh:247 (`H_LOCKS: unbound variable`) because the parts glob orders 05b-writer.sh before 05-hosts.sh; under LC_ALL=C (CI, runner via FR-027) the order is right and the suite is green; same on a clean `git archive HEAD` → not caused by this wave
gate0: flake noted → K10/X8 (parts/06, 07) compare the real per-uid lock dir and fail while another real runner run is active
gate2: SKIPPED preview deploy (test tooling, no web app)

## Wave 5 — P1 close-out (in progress, 2026-11-11, aiserver)

gate0: 5.1 CONVENTIONS.md documents the runner; documented commands re-run by the main session → dir selector `a1-gates-lint` exit 0, unknown selector exit 2, `--help` and `a1-gates-lint/run-wave13.sh` PASS
gate0: README.md:183 runner count 57 → 58 (this branch adds a1-suite-runner/run-tests.sh; a1-gates-lint N1 then 90/0). Cross-scope one-line edit in a file held by spec 024, which also sets 58 on its branch: whichever of the two PRs lands second sets 59 (N1 catches it)

## Wave 6 — CI runs the runner; I1/I2 become a self-test (done, 2026-11-12, aiserver) — commit b8db005

Precondition: spec 025 (PR #80) merged, branch rebased on origin/main. FR-022 + FR-015 (owner decision 2026-11-10: doc edit in W6).
Changes: `.github/workflows/test.yml` Fixtures step = `echo "glob count: $(ls _test-fixtures/*/run*.sh | wc -l)"` + `bash bin/run-suites.sh` (name, gitleaks step before, Cross-provider flip after unchanged); `a1-vault-cockpit` 04c I1/I2 = self-test on a git copy (planted leaker → exit 1 + leaked path, clean run → 0, planted a1-reconcile edit → restored + clean); 04d handshake part removed; `CLAUDE.md` commands line, `CONTRIBUTING.md` pre-PR line + verify.json sentence, `_test-fixtures/CONVENTIONS.md` RED table.
Case ledger a1-vault-cockpit (assert count, baseline run directly, LC_ALL=C): before 1038 (1036 pass, 2 fail = I1 a1-intent exit 1, I1 a1-xprov exit 2, env-red on aiserver) → after 860/0.
Removed: 158 asserts of 04c I1/I2 old arm (per suite "I1 <suite> exits 0 / no project/ / leaves sentinel empty" over 52 suites, "I1 glob found 52 suites", "I2 a1-reconcile clean again") and 30 asserts of 04d (cases H valid, absent, dead PID, mismatch, unrelated, decoy). Reason: superseded by the self-test that the spec mandates. Added: 10 (I1a x4, I1b x2, I1c, I2 x3). 1038 - 158 - 30 + 10 = 860. X1 untouched.
gate0: runner subset `a1-vault-cockpit a1-test-fidelity a1-gates-lint a1-suite-runner a1-vault-fallback a1-tmp-hygiene` (LC_ALL=C, TMPDIR in ~/.cache) → 7 runners PASS (cockpit 860, test-fidelity 212, gates-lint 90+10, suite-runner 364, fallback 21, tmp-hygiene 21), 60 s wall; verify-install-sync PASS
gate0: cockpit run time 24 s (was 1194 s for the I1 loop under load)
gate0: RED proof on a snapshot copy: sentinel emptiness check dropped in bin/run-suites.sh → I1a x4 red; a1-reconcile checkout dropped → I2 x2 red
gate0: `test-fidelity --diff-base HEAD~1` → 0 findings (ci_glob literal kept in a run: line)
gate0: a1-xprov not in the subset run: wave 8 (parallel agent) edits it; CI read after push not done (no push by order)
Note: runner still exports A1_SUITE_RUN_MARKER and keeps rs_lock_is_runner (used by the lock); only the I1 consumer is gone.

## Wave 8 — a1-xprov per-part timing, sleep to bounded polling (done, 2026-11-12, aiserver, LC_ALL=C, A1_VAULT_ROOT unset)

Tasks 8.1 (xprov part timing), 8.2 (xprov sleeps), 8.3 (intent sleeps), 8.4 (part 12 audit) done by one executor in one commit.
Ledger (runner subset, same host, concurrent a1-xprov + a1-intent): a1-xprov before 4213/0 623 s, after 4213/0 617 s (alone); a1-intent before 1107 passed / 12 failed 281 s, after 1107 / 12 283 s, failing id set identical (B19g-i B22 B23 B24 B25 B6d SM4 T10 T21 T22 T5 X11, env-red on aiserver). a1-suite-runner 350 -> 364/0 (14 new part 12 asserts SA1..SA6c).
FR-018: a1-xprov prints `time  <part> <s>s` per part (34 lines = ls parts/*.sh) and a summary sorted by elapsed descending; same shell and order. A self-check (assert-neutral when green) compares timed parts with parts/*.sh. It caught a real bug in the first draft: parts reuse `$p`, so the name is captured into `xp_name` before sourcing.
FR-019: 59 sleep code lines remain in the two suites, all annotated; 7 polling loops were converted to `poll_until <bound> <cmd>` (defined in a1-intent/lib.sh; 06-run X3, 06b, 07-bounds x2, 08-tick x2, 10-doctor w10_feed). Annotated `# deliberate-timeout: <reason>`: 59 lines (xprov 21: pty feed, race window, hang under timeout, mtime granularity; intent 38: stand-in processes, dead pids, mtime granularity, settle after kill, sampler loops). Part 12 asserts polled + annotated = total.
Honest note: no xprov sleep is a plain condition wait (pty feed delays cannot be observed by the harness); the 0.3 s settle sleeps and sampler loops in intent were annotated, not converted. Wall-clock gain of the wave is small (a few seconds); the value is the audit and the per-part times (slowest: 30-dispose-secrets 83 s, 08-allowlist 58 s, 25-consent-hook 57 s, 23-consent-cli 53 s, 29-recovery 50 s).
gate0: part 12 red-first: SA2 failed on the unannotated tree (one bare line, 07b-security.sh), green after annotation; SA5a-e prove the scanner on planted files.
gate0: first full xprov run after the change had one RI3 failure (part 10, "runner WAS invoked"); not reproducible (part 10 with 08 twice 383/0, full rerun 4213/0), part 10 untouched by this wave; noted as a possible flake under concurrent load.
gate0: test-fidelity --diff-base HEAD 0 findings; verify-install-sync PASS; lane-split check findings [].
