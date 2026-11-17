RED-proof 7.1 revert-glob -> a1-vault-cockpit (H_LOCKS unbound) red (rc=1)
✓ Task 7.1 — b676728 — 15:13
RED-proof 7.2 (a) export guard removed -> L2b red (rc=1)
RED-proof 7.2 (b) extra-job call accepted without --locale-native -> E4 red (rc=1)
RED-proof 7.2 (c) .git refusal removed -> E11a red (rc=1)
RED-proof 7.2 (d) needs: check removed -> E9 red (rc=1)
RED-proof 7.2 (e) "rest" ignores other jobs' explicit ids -> E10b red (rc=1)
RED-proof 7.2 (f) exactly-once check removed -> E16a/b/c red (rc=1)
RED-proof 7.2 (g) A1_XPROV_ONLY ban removed -> E17a/b red (rc=1)
RED-proof 7.2 (h) ci_job_workers ignored -> E18a red (rc=1)
✓ Task 7.2 — e67e1e2 — 15:25
RED-proof 7.3 (a) 05 in XP_SHARD_B and XP_SHARD_C -> harness overlap check red (rc=1)
RED-proof 7.3 (b) run-tests-d.sh added -> runner-file assert red (rc=1)
RED-proof 7.3 (c) run-tests-c.sh calls --shard b -> exact-call-line check red (rc=1)
✓ Task 7.3 — 37879dd — 15:45

## Wave 7 — Harness glob and runner options (lane runner)
Tasks 7.1 b676728, 7.2 e67e1e2, 7.3 37879dd. xprov shards measured with `--workers 3` (load ~2): a 210 s, b 214 s, c 209 s; 35 parts, each once.
Full suite: only a1-intent (subset of accepted set) and a1-suite-runner red. vault-cockpit green (860, both locales).
BLOCKER: a1-suite-runner D3a (parts/01-discovery.sh:45) asserts suite-groups.json has exactly keys ci_jobs,no_count,serial,timings. ci_job_workers (7.3) makes it red; Wave 8 adds ci_extra_jobs, snapshot_incompatible. No-assert-change rule forbids the edit -> needs orchestrator/owner decision.
RED-proof 7.3-D3a ci_job_workers removed from the real suite-groups.json (scratch) -> D3a red
✓ D3a exact-key-set assert updated (owner exception) — 7507e11 — a1-suite-runner isolated: 569 passed, 0 failed (K5a was a flake)
Wave 7 COMPLETE. Wave 8 must extend D3a with ci_extra_jobs,snapshot_incompatible.

## Wave 8 (lane runner)
Task 8.1 92c6752 (suite-groups.json ci_extra_jobs + snapshot_incompatible, 5 CI jobs, D3a now exact seven-key set), Task 8.2 eb81847.
check-groups: ok, 63 suites in 2 ci jobs. test.yml diff: 0 removed lines; 5 --extra-job calls; a1-xprov 1056/0; a1-suite-runner 569/0; a1-pr-merge-check 242/0 (CU0-CU15 pass); pr-ci-evidence.cjs diff empty.
Shard selections: xprov-a [a1-xprov/run-tests.sh], xprov-b [run-tests-b.sh], xprov-c [run-tests-c.sh], heavy [a1-intent, a1-ux-studio], rest = "rest".
RED-proof 8.2 (a) unchanged line removed from decide (scratch) -> CU1..CU7 red
RED-proof 8.2 (b) pathsChanged false for prefix-entry lists (scratch) -> CU1..CU7 and CU9 red
Full suite: only a1-intent red (13 fails first run incl. T7, load 9); isolated rerun 12 fails, all within ACCEPTED-RED.
Wave 8 COMPLETE.
