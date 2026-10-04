# Spawn policy — model tier and brief size

Binding for every skill that spawns an a1 agent. Source: token analysis 2026-10-04
(591 session logs, 35 days). Model-tier decisions themselves live in
`docs/adr/2026-07-05-model-routing-matrix.md`; this file only makes sure they take effect.

## S1 — Spawn by type, not by name

Spawn with `subagent_type: "a1-specforge:a1-<agent>"` and **no `name`**. The agent's
frontmatter `model:` then applies.

A named spawn becomes a teammate (`taskKind: in_process_teammate`) and **inherits the
session model** instead — frontmatter is ignored. Measured: executor waves spawned as
`erik-<spec>-w<n>` ran on the session's 1M-context top tier; one such wave alone consumed
504M tokens. If a name is genuinely needed (e.g. for SendMessage follow-ups), pass
`model` explicitly with the tier from the ADR (executor: `sonnet`).

The ADR escape hatch stays: a wave flagged `complexity: high` may dispatch the executor
with `model: opus` — explicitly, never by inheritance.

## S2 — Briefs carry paths, not documents

A brief names the files the agent must read; it does not paste their content. List only
what the task needs — "read all of X" pulls whole directories into a context that is
re-sent on every turn of the agent.

## S3 — No forks for routine work

A fork inherits the parent's full context. Use it only when that context is the point;
for wave execution, review and verification spawn a fresh typed agent.

## Self-check before dispatch

- [ ] `subagent_type` set, `name` absent — or `model` set explicitly
- [ ] Brief lists paths, no pasted plan/spec bodies
- [ ] Not a fork, unless the full parent context is required
