# Spawn policy — model tier and brief size

Binding for every skill that spawns an a1 agent. Source: token analysis 2026-10-04
(591 session logs, 35 days). Model-tier decisions themselves live in
`docs/adr/2026-07-05-model-routing-matrix.md`; this file only makes sure they take effect.

## S1 — Spawn by type, not by name

Spawn with `subagent_type: "a1-specforge:a1-<agent>"` and **no `name`**. The agent's
frontmatter `model:` then applies.

A named spawn becomes a teammate (`taskKind: in_process_teammate`) and **inherits the
session model** instead — frontmatter is ignored. Measured: a1-erik-executor waves spawned as
`erik-<spec>-w<n>` ran on the session's 1M-context top tier; one such wave alone consumed
504M tokens. If a name is genuinely needed (e.g. for SendMessage follow-ups), pass
`model` explicitly with the tier from the ADR (executor: `sonnet`).

A higher tier for a single dispatch is always explicit `model`, never inheritance. (The ADR's
`complexity: high` wave flag is intent only — not yet wired into the plan schema or a1-execute.)

## S2 — Briefs carry paths, not documents

A brief names the files the agent must read; it does not paste their content. List only
what the task needs — "read all of X" pulls whole directories into a context that is
re-sent on every turn of the agent.

## S3 — No forks for routine work

A fork inherits the parent's full context. Use it only when that context is the point;
for wave execution, review and verification spawn a fresh typed agent.

## S4 — Fix briefs carry the plan's protections and measured facts only

A brief that asks an agent to fix review findings names the plan's protected items
(AS-list, must-not-touch lines, scope) verbatim, and states every platform or
environment fact as `measured: <command>` or hands it to the agent as a measurement
task. Measured 2026-10-14 twice: a fix brief without the AS-list made the executor
rewrite protected README lines on a reviewer's wish (a1-office infra-rename-cutover);
an unmeasured "Linux ping exit 2 = tool error" in a fix brief introduced a false-DOWN
regression that cost a full extra review round (my-smart-home 001). Same class in
captrader-llm 2026-10-13/15: report claims condensed from the data instead of
re-measured, caught only in review.

## Self-check before dispatch

- [ ] `subagent_type` set, `name` absent — or `model` set explicitly
- [ ] Brief lists paths, no pasted plan/spec bodies
- [ ] Not a fork, unless the full parent context is required
- [ ] Fix brief: the plan's protected list is included; every platform fact is tagged `measured:` or delegated as a measurement
