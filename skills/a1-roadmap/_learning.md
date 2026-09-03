# a1-roadmap — Learning Log

Entries appended automatically by Phase 4 (Scaffold) after every run.
Used by a1-evolve for pattern clustering (threshold: 3+ same tag = proposal).

Tags: vision_unclear | stack_mismatch | milestone_too_big | phase_split_wrong | research_skipped_wrongly | scaffold_collision | over_engineering

---

---
date: 2026-05-13
task: M2-Roadmap planning (a1-worktree, a1-pr-review, a1-phantom)
project: a1-skills
result: pass
issues: []
what_worked: Milestone-Struktur mit klaren Deliverables pro Skill; parallel Research-Agents für Stack-Checks
one_line_learning: Roadmap-Phasen müssen Abhängigkeiten explizit modellieren — a1-phantom brauchte a1-pr-review als Voraussetzung, was erst spät klar wurde
---

---
date: 2026-05-17
task: v1.0.0 Release-Roadmap und Agent-Convention-Refactor
project: a1-skills
result: pass
issues: []
what_worked: a1-[firstname]-[role] Convention klar definiert; Repo-Struktur mit Symlinks funktioniert
one_line_learning: Naming-Convention-Änderungen (GSD→a1, Bulk-sed) müssen mit Dry-Run verifiziert werden — Double-Prefix-Bug durch Bulk-sed hätte Tests benötigt
---

---
date: 2026-08-25
task: Adopt-Lauf captrader-consulting — Consulting-Repo ohne .a1/docs-product in schema-v1-Roadmap überführt (5 Milestones, 20 Features, 20 Specs mit User Stories) für Pro-Orc-Anzeige
project: captrader-consulting
result: pass
issues: []
evidence: docs/product/ROADMAP.md Changelog (adopt-Eintrag 2026-08-25) + git status (uncommitted)
what_worked: Evidenzableitung aus committeten Deliverables + Git-Log statt Interview; Pro-Orc-Renderer-Headings (Problem/User Journey/Acceptance Criteria) vorab im Quellcode verifiziert, dadurch Specs sofort drill-down-tauglich
one_line_learning: Bei Consulting-Repos (Deliverables statt Code) ersetzt die Deliverable-Dateiliste + Commit-Historie die VERIFICATION-Rungs der Evidenzleiter — done-Klassifikation vorher explizit im Changelog begründen, inkl. Hinweis dass finished-Datum = Adopt-Datum ist
---
date: 2026-09-03
task: new project — N3URAL Brain (Obsidian plugin, Notion-style vault UI) roadmap v3 with 6 milestones / 17 features + 2 follow-up specs in a1-skills
project: n3ural-brain
result: pass
issues: [scope_grew_in_discover, vision_reframed_mid_structure, cross_repo_spec_needed]
evidence: docs/product/ROADMAP.md (validate: valid, 0 errors), .a1/phases/M1-P*/GOAL.md, ~/code/a1-skills/.a1/learnings/projects/a1-specforge/spec/005-vault-first-artifacts.md + 006-specforge-kritis-profile.md
what_worked: Research (Rico) before Structure surfaced 3 expectation corrections (no Android widget, embeds gap, Bases too young) that reshaped M2 before scaffolding; asking the user for a PM-level gap review after v2 produced two whole milestones (Cockpit, Remote Trigger) that the pitch had only implied.
one_line_learning: Discover should ask "what other tools/systems already cover parts of this?" explicitly — Pro Orc and SpecForge overlap surfaced only after Structure, costing a roadmap v2→v3 rewrite; a one-question landscape check in Discover would have caught it.
---

