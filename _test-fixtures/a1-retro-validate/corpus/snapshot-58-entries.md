---
date: 2026-09-12
task: FROZEN CORPUS SNAPSHOT for V4 (SC-001) — spec 007-retro-gate-id-validator
project: a1-specforge
result: pass
issues: []
evidence: snapshot, not a real run
gates_fired:
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split-check, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: lane-split, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: false}
  - {id: plan-audit, verdict: pass, caught: false}
  - {id: plan-audit, verdict: pass, caught: false}
  - {id: plan-audit, verdict: pass, caught: false}
  - {id: plan-audit, verdict: pass, caught: false}
  - {id: plan-audit, verdict: pass, caught: false}
  - {id: roadmap-gate, verdict: pass, caught: false}
  - {id: roadmap-gate, verdict: pass, caught: false}
  - {id: roadmap-gate, verdict: pass, caught: false}
  - {id: roadmap-gate, verdict: pass, caught: false}
  - {id: gate-c-ac-dryrun, verdict: pass, caught: false}
  - {id: gate-c-ac-dryrun, verdict: pass, caught: false}
  - {id: gate-c-ac-dryrun, verdict: pass, caught: false}
  - {id: gate-c-ac-dryrun, verdict: pass, caught: false}
  - {id: stop-gate-human, verdict: pass, caught: false}
  - {id: stop-gate-human, verdict: pass, caught: false}
  - {id: stop-gate-human, verdict: pass, caught: false}
  - {id: gate-1-build, verdict: pass, caught: false}
  - {id: gate-1-build, verdict: pass, caught: false}
  - {id: gate-1-build, verdict: pass, caught: false}
  - {id: fix-integrity, verdict: pass, caught: false}
  - {id: fix-integrity, verdict: pass, caught: false}
  - {id: fix-integrity, verdict: pass, caught: false}
  - {id: consistency-gate-4-5, verdict: pass, caught: false}
  - {id: consistency-gate-4-5, verdict: pass, caught: false}
  - {id: consistency-gate-4-5, verdict: pass, caught: false}
  - {id: scope-claim, verdict: pass, caught: false}
  - {id: scope-claim, verdict: pass, caught: false}
  - {id: review-empirical-probes, verdict: pass, caught: false}
  - {id: review-empirical-probes, verdict: pass, caught: false}
  - {id: isolation-gate, verdict: pass, caught: false}
  - {id: isolation-gate, verdict: pass, caught: false}
  - {id: gate-4.5-fr-consistency, verdict: pass, caught: false}
  - {id: gate-4.5-fr-consistency, verdict: pass, caught: false}
  - {id: tag-milestone-confirmation, verdict: pass, caught: false}
  - {id: settings-json-diff-gate-human, verdict: pass, caught: false}
  - {id: pre-flight-github-scope, verdict: pass, caught: false}
  - {id: full-regression-gate, verdict: pass, caught: false}
  - {id: collect-roots, verdict: pass, caught: false}
  - {id: backup-gate-human, verdict: pass, caught: false}
one_line_learning: n/a — this file is a frozen test fixture, not a real retro.
---

# Provenance

This is a **synthetic replay**, not a copy of any real vault file. The vault's
per-skill retro files (`$A1_VAULT_ROOT/pattern/a1-learnings/<skill>.md`) are
MANY `---`-delimited entries concatenated in one file, and `retro validate`
(per its CLI contract — one retro document, one `gates_fired` block) parses
only the FIRST frontmatter block via `io.cjs`'s `parseFrontmatter`. Feeding it
a real multi-entry vault file directly would silently validate only that
file's first entry, not "the corpus" — which is not what SC-001 asks for and
would itself be a class-1 false-green (the case would not enter the branch
its name promises).

So this snapshot flattens every `gates_fired[].id` occurrence across the
ENTIRE live corpus into one synthetic `gates_fired` block, as measured
2026-09-12 against `$A1_VAULT_ROOT/pattern/a1-learnings/*.md`:

```bash
grep -oh '^  - {id: [a-zA-Z0-9._-]*' "$A1_VAULT_ROOT"/pattern/a1-learnings/*.md \
  | sed 's/^  - {id: //' | sort | uniq -c | sort -rn
```

**58 entries total** (this run's own count — NOT the 59 named in the wave
dispatch): 47 valid, 11 drift, 0 unknown.

**Discrepancy resolved by the orchestrator 2026-09-12: both counts were right,
measured over different scopes.** 58 is the vault store alone
(`$A1_VAULT_ROOT/pattern/a1-learnings/*.md`); 59 adds the repo-local stores
(`~/claude-projects/*/.a1/learnings/pattern/a1-learnings/*.md`), which hold one
further entry — `{id: lane-split, verdict: pass, caught: false}` in
`obsidian-lumen/a1-plan.md`. It is a VALID id, which is why only the valid count
differed (47 vs 48) and the drift set was identical in both measurements.

This is the same scope trap that has hit a1-evolve three times (2026-07-17
single-repo read, 2026-08-02 write-side omission, 2026-09-11 wrong glob root):
the vault is not the whole corpus. Neither number belongs in an assertion — the
snapshot below is frozen and self-contained precisely so this class cannot
affect the test.

Drift breakdown (3 spellings, matching the task brief):
- `lane-split-check` x7  -> canonical `lane-split`
- `consistency-gate-4-5` x3 -> canonical `gate-4.5-fr-consistency`
- `full-regression-gate` x1 -> canonical `gate-1-build`

`isolation-gate` (x2) is NOT drift in this snapshot: it was registered in
commit `26c398a` (Wave 1, this spec) before this snapshot was taken, so it
resolves `ok`. This is the correct, current behaviour — the historical
"4th alias" framing in the wave plan's opening measurement predates that
registration.

**Discrepancy found and reported, not silently absorbed:** the dispatch for
this wave states "59 `gates_fired` entries total, 48 valid, 11 drift" as the
authoritative 2026-09-12 re-measurement. Re-running the exact `grep`/`sort`/
`uniq -c` pipeline above against the live vault today (2026-09-12, same
session) yields **58** total / **47** valid / **11** drift — one fewer
total and one fewer valid than stated, with the same drift count and the same
three spellings. `grep -c '^  - {id:'` per file independently confirms 58 raw
list-item lines exist across all 11 corpus files; no line was missed by a
narrower id-shape regex. The likely explanation is a one-entry difference in
which retro was counted as "written" at the moment each measurement was
taken (this corpus keeps growing as this very spec's own waves write
retros) — not a parser defect. Per the plan's own instruction ("assert the
SET of flagged ids against the checked-in snapshot... never a count"), this
snapshot is pinned to the number this task actually measured (58/47/11), and
the live-store assertions in this suite check properties only, never a count
— so the one-entry discrepancy above does not affect anything this suite
verifies. Flagged here in full per the task's explicit request to report
plan/number errors rather than build around them silently.
