# a1-phantom — Learning Log

Local cache of retros. Canonical source is the Vault:
`~/N3URAL-Vault/pattern/a1-learnings/a1-phantom.md`

Append a new entry after every run (clean or phantoms_found). Format is
defined in `workflows/01-check.md` under "Retro (mandatory, every run)".

---

---
date: 2026-05-17
task: Niimo Spec 001 Wave 6 Deploy & validation
project: niimo
result: pass
issues: [phantom_found, spec_done_code_missing]
what_worked: Spec 001 was marked complete (PLAN.md all [X]) and all 6 Waves deployed to europe-west3 — no gap between PLAN checklist and actual deployed code
one_line_learning: Phantom detection works well for committed tasks; add live-environment validation (prod URL smoke test) to confirm no spec-completed features are silently missing from deployed build
---

---
date: 2026-05-13
task: Ship a1-phantom skill v1
project: a1-skills
result: pass
issues: [phantom_found]
what_worked: Phantom-task detection via git-diff vs PLAN.md `[X]` tasks with `# no-code` tag support, 3 fixtures all green — correctly identifies tasks marked done but code absent
one_line_learning: Test fixtures stored as actual git repos (mode 160000 gitlinks) are valid — GitHub's Gitlinks view is correct; ensure CI doesn't fail when fixtures are git submodules
---
