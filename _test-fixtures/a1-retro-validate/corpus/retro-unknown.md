---
date: 2026-09-12
task: V3 fixture — one id with no known canonical (truly unregistered)
project: a1-specforge
result: pass
issues: []
evidence: fixture
gates_fired:
  - {id: plan-audit, verdict: pass, caught: false}
  - {id: never-registered-gate, verdict: pass, caught: false}
one_line_learning: n/a — fixture.
---

Fixture body — not read by retro-validate.cjs. Uses `never-registered-gate`
rather than `isolation-gate` (the wave plan's original example): isolation-gate
was registered in commit 26c398a before this wave started, so it now resolves
`ok`, not `unknown` — using it here would make this case pass for the wrong
reason (it would never enter the `unknown` branch it names). A synthetic id
that is neither a table row nor a KNOWN_ALIASES key exercises the real branch.
