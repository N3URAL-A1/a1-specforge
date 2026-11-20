# Wave plan (stripped copy of vault project/ai-harness/plans/008-job-runner-wave-plan.md, real lines)

## Wave 1 — Measurement and probes (refuse-on-failure inputs) ⟶ status: in-progress
### Suggested agent(s)

**Suggested agent(s):** a1-walter-web-developer for M1–M5 and M8 (probe scripts, settings JSON, `srt` install); a1-aik-ai-engineer for M6 and M7 (headless-claude shapes, phrase corpus); a1-samuel-security reviews the evidence of M1, M2, M4, M5 (boundary measurements) before Wave 3 starts.


## Wave 2 — Foundation: config init, job record, runner git hygiene, run limits ⟶ status: in-progress
### Suggested agent(s)

**Suggested agent(s):** a1-walter-web-developer (Python stdlib modules, bash shims, test harness); a1-samuel-security reviews `gitenv.py` and `config.py` on the PR diff (runner git hygiene, credential helper, `a1_tools_path` validation).


## Wave 3 — Sandbox policy, environment scrub, start probe, secret scan
