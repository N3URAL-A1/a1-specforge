# ACCEPTED-RED — 027-lean-pipeline-s2

Recorded once for the whole phase (PLAN.md "Per-wave gate reds", audit round 2 m4), before the lanes fork.

- Date: 2026-11-16, host aiserver, load average 0.17 at start (quiet host)
- Worktree: a1-worktree `027-s2-main-compare` at 98b9027 (code identical to origin/main 45ee7f1 and to 3ebea7f; the extra commits were the PR #97 chore commits under `.a1/` and `docs/product/`)
- Locale: `LANG=en_US.UTF-8` (LC_ALL unset)
- Runs: serial, `bash _test-fixtures/<suite>/run-tests.sh`

## _test-fixtures/a1-intent/run-tests.sh — accepted in every wave

Result: exit 1, `a1-intent: 1105 passed, 14 failed`. Record `2026-11-11-intent-suite-signal-cases-aiserver`.
A wave's failing set is accepted when it is a subset of these case ids:

- `X11`
- `B5`
- `B22`
- `B23`
- `B6d`
- `B19g-i`
- `B24`
- `B25`
- `T5`
- `T10`
- `T14`
- `T21`
- `T22`
- `SM4`

## _test-fixtures/a1-vault-cockpit/run-tests.sh — accepted only in Waves 1-6

Result: exit 1, the harness aborts before printing a summary line:
`_test-fixtures/a1-vault-cockpit/parts/05b-writer.sh: line 247: H_LOCKS: unbound variable`
Cause (RESEARCH.md): the `parts/*.sh` glob sorts `05b` before `05-hosts` under en_US. Accepted only while the worktree lacks the Task 7.1 commit; from Wave 7 on and in Waves 9-10 it must be green.

## Narrowed 2026-11-17 — applies from Wave 9 follow-up on (Wave 10, Victor, merge check)

PR #98 (787390d, merged into this branch at 648e5b9) fixed the node-child lookup in T5/B22 that leaked a watcher and a lock holder; the bug report `2026-11-11-intent-suite-signal-cases-aiserver` is `fixed`. Measured on this branch at 2e55e96 (host aiserver, load 1.4-2.2, `LANG=en_US.UTF-8`): `a1-intent: 1118 passed, 2 failed` (X11, B5), 0 leftover stub processes.

From now on a1-intent is accepted only when its failing set is a subset of:

- `X11` — own cause: `/usr/bin/claude` exists on aiserver, `cases/06-run.sh:398` PATH includes `/usr/bin` (not fixed by PR #98)
- `B5` — kill-gap timing (499 vs 500 ms), unrelated to the leak

Every other a1-intent id is outside the list. T19 is not on it (owner decision 2026-11-17).
