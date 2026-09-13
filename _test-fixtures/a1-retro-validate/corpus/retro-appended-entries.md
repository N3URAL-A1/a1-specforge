---
type: pattern
permalink: vault/pattern/a1-learnings/fixture-appended
---

# Fixture — the shape the real learning store actually has

V10. Copied in shape (not content) from
`$A1_VAULT_ROOT/pattern/a1-learnings/a1-fix.md` as measured 2026-09-13: a
`type: pattern` file header WITHOUT `gates_fired`, followed by retro entries
APPENDED as further `---`-delimited blocks. Every other fixture in this
corpus has exactly one frontmatter block with `gates_fired` inside it — the
shape the parser handles. None had this shape, which is why the parser's
whole-file `parseFrontmatter` call read only the header, found no
`gates_fired`, took the legitimate "read-only reporter skill" path and
exited 0 on all 34 `gates_fired` blocks present across five real store files.

The two entries below carry three ids: two registered (`plan-audit`,
`gate-1-build`) and one drift alias (`lane-split-check`). A correct parser
therefore reports valid=2, drift=1, unknown=0 and exits 1.

Red-making change: making the validator parse only the first frontmatter
block again (the 2026-09-12 behaviour) — it then reports entries=[] and
exits 0.

---
date: 2026-09-01
task: V10 fixture — first appended entry
project: a1-specforge
result: pass
issues: []
evidence: fixture
gates_fired:
  - {id: plan-audit, verdict: pass, caught: false}
one_line_learning: n/a — fixture.

---
date: 2026-09-02
task: V10 fixture — second appended entry, carries the drift alias
project: a1-specforge
result: pass
issues: []
evidence: fixture
gates_fired:
  - {id: gate-1-build, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: true}
one_line_learning: n/a — fixture.
