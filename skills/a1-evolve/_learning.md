# a1-evolve — Learning Log

Entries appended automatically by Phase 4 (Apply) after every run.
Meta-skill: tracks how well synthesis itself performs.

Tags: low_signal | false_pattern | diff_too_big | vault_index_stale | threshold_too_loose | threshold_too_tight | proposal_rejected | applied_then_reverted

---

---
date: 2026-05-17
task: a1-evolve Skill gebaut (4 Workflows: collect → cluster → propose → apply)
project: a1-skills
result: pass
issues: []
what_worked: Pattern-Clustering mit 3+ Threshold ist kalibriert; Vault als canonical Learning-Store funktioniert
one_line_learning: Evolve ist nutzlos ohne Seed-Daten — Learning-Loop in allen Execution-Skills war die fehlende Voraussetzung; zuerst Daten sammeln, dann clustern
---
---
date: 2026-05-22
task: synthesize learnings → propose+apply improvements
project: a1-skills (meta)
result: pass
issues: []
what_worked: 28 entries across 14 skills, 5 actionable patterns above threshold (3+); all 5 applied in one session
one_line_learning: no issues — seeding _learning.md files before running a1-evolve is mandatory; without seed data the engine has nothing to cluster
---
---
date: 2026-07-12
task: synthesize learnings → propose+apply improvements
project: a1-skills (meta)
result: pass
issues: []
what_worked: cross-checking each high-impact cluster against current agent/skill files before proposing prevented 6 redundant proposals (patterns already structurally addressed by Consistency Gate, goal-backward verify, Clarify phase); kept the diff surgical (2 targeted proposals from 47 observations instead of a blanket rewrite)
one_line_learning: on a first-ever synthesis run with no watermark, always verify each candidate pattern against the CURRENT file content before proposing — historical retro volume often reflects the events that already motivated a fix, not a live gap
