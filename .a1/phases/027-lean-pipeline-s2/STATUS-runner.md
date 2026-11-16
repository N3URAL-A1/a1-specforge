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
