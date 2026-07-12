---
phase: M11-audit-fixes
verified: 2026-07-12
verifier: independent (goal-backward, repo-state re-derivation, not a STATUS.md read-through)
head_at_verification: cca0faa
---

# Verification: M11-audit-fixes

## Method

Every Success Criterion below was re-derived from live repo state — fresh commands
run against HEAD `cca0faa`, not read from STATUS.md's narrative. Where a criterion
implied a test (fresh install, seeded drift, grep sweep), that test was actually
executed in this session. STATUS.md's claims were treated as hypotheses to falsify,
not facts.

---

## SC-1: Fresh install symlinks 21 agents incl. samuel/diana/dario; README lists exactly those 21; skills side (17, hero-animation-builder excluded) stays in sync

**Verdict: PASS**

- `ls agents/*.md | wc -l` → 21 (samuel/diana/dario present).
- `bin/install.sh` AGENTS array: 21 entries, samuel/diana/dario appended after
  `a1-theo-test-engineer`, no reordering of the other 18 — confirmed by direct read.
- Ran `HOME=$(mktemp -d) bash bin/install.sh` fresh: exit 0, **21 agent symlinks
  created**. Re-ran against the same temp HOME: still 21, exit 0 (idempotent).
- `bin/verify-install-sync.sh` run against live repo: `skills: dirs=17 install.sh=17
  readme=17 | agents: dirs=21 install.sh=21 readme=21` — all six counts agree.
- README's skills table (17) and SKILLS array remained untouched and in sync
  throughout, as required.

## SC-2: Deterministic sync check (repo dirs ↔ install.sh ↔ README, incl. the scope-note comment's claimed counts) exists, fails on seeded drift, runs in CI

**Verdict: PASS**

- `bin/verify-install-sync.sh` exists (7981 bytes, executable) and is wired into
  `.github/workflows/test.yml:39` as its own step (`run: bash bin/verify-install-sync.sh`).
- Actually seeded drift in a mktemp copy of the repo (removed `a1-samuel-security`
  from install.sh's AGENTS array): checker correctly failed —
  `DRIFT agents-side count mismatch ... install.sh=20 readme=21`, exit 1.
- Actually seeded drift **only** in the README scope-note comment's claimed counts
  (changed "21 agent names" → "18 agent names" while everything else stayed in
  sync): checker correctly failed on the **4th assertion independently** —
  `DRIFT README scope-note comment count mismatch expected: 17 skills + 21 agent
  actual: 17 skills + 18 agent`, exit 1. This confirms the 4th assertion (the
  post-audit MAJOR-2 fix) is not a no-op alongside the first three set-equality
  checks — it catches a class of drift the other three miss.
- Ran the fixture suite `_test-fixtures/install-sync/run-tests.sh`: 12/12 pass,
  covering all four required seeded-drift cases (extra dir, missing install entry,
  stale README row, stale scope-note comment) each independently asserting exit 1,
  plus 3 hostile-input cases (spaces-in-dirname, oversized exclusion file ×2,
  documented N/A for injection-shaped input).
- Fixture count: `_test-fixtures/install-sync/` is present and is the 23rd fixture
  directory (`ls -d _test-fixtures/*/ | wc -l` → 23), matching the claim.

## SC-3: One language-policy source of truth; zero skills contain local user-output language rules; a1-check's internal contradiction gone

**Verdict: PASS**

- `_shared/language-policy.md` exists, 19 lines, two rules (artifacts English /
  conversation in user's language).
- `grep -rn "in German|auf Deutsch|in English" skills/*/SKILL.md
  skills/*/workflows/*.md` returns exactly **one** hit:
  `a1-new-feature/workflows/02-specify.md:24`, which is the plan's own explicitly
  sanctioned artifact-scoped exception ("in English — the output is a technical
  artifact"). No stray "in German" mandates remain anywhere.
- `a1-check/SKILL.md`: line 29 and lines 102-105 both now point to
  `_shared/language-policy.md` with identical "artifacts English, conversation in
  the user's language" wording — the former self-contradiction (English-first vs.
  in German) is resolved.

## SC-4: No skill claims Obsidian Vault as default storage; storage sections state repo-local default + A1_VAULT_ROOT override; a1-evolve's "primary" framings reworded to "fallback sink"

**Verdict: PASS**

- `grep -rln "Obsidian Vault" skills/` returns **empty** — zero hits across the
  entire skills tree.
- `a1-evolve/workflows/04-apply.md:49`: "canonical is the learning store's
  pattern/a1-learnings/patterns.md, repo-local by default with A1_VAULT_ROOT for an
  optional external sink, e.g. Obsidian" — reframed as fallback sink, not
  word-swapped "primary".
- `a1-evolve/workflows/01-collect.md`: no "primary — the brain" framing remains
  (only a neutral "primary ... glob" reference to the a1-fix learning-store glob
  path, unrelated to the Vault-primacy claim the task targeted).

## SC-5: `agents/a1-victor-verifier.md` has no hardcoded `~/.claude/skills/` path; both a1-tools.cjs invocation sites resolve cwd-independently

**Verdict: PASS**

- `grep -n "~/.claude/skills" agents/a1-victor-verifier.md` → no matches.
- Both sites (Step 4.5 phantom check, Step 5 cost line) use the specified
  resolution: `A1_TOOLS="${CLAUDE_PROJECT_DIR:-}/_shared/a1-tools.cjs"` with a
  walk-up-from-cwd fallback loop — confirmed present at both locations.
- Full `agents/` sweep for `~/.claude/skills`: exactly 2 hits remain, both the
  documented, legitimate registry-enumeration references (`a1-reinhard-reviewer.md:51`
  `ls ~/.claude/skills/`, `a1-ludwig-legal.md:73` Glob pattern) — matches the
  plan's explicit allowance.

## SC-6: All 21 agents use bracketed YAML `tools:`; Aik + Walter declare tools explicitly; every `model: opus` pin carries a justification comment

**Verdict: PASS**

- `grep -c "^tools: [A-Za-z]"` (bare-CSV pattern) across `agents/*.md` → zero
  stragglers.
- `grep -l "^tools: \["` → 21/21 files use the bracketed array form.
- No file is missing `tools:` entirely (`grep -L "^tools:" agents/*.md` → empty).
- Aik and Walter both now declare `tools: [Read, Write, Edit, Bash, Grep, Glob]`
  explicitly.
- All 4 `model: opus` pins (Alex, Falk, Reinhard, Samuel) carry inline `#`
  justification comments — confirmed by direct grep, no bare pin remains.

## SC-7: a1-evolve's declared learning sources match reality; the 5 heavy pipeline skills gain a retro mechanism; exact learning-enabled skill set is named (no "all skills" claim)

**Verdict: PASS**

- `grep -rln '## Retro|Retro:' skills/{a1-plan,a1-roadmap,a1-reconcile,a1-modernize,a1-constitution}/workflows/*.md`
  → all 5 files match; `grep -l learning-schema` on the same 5 → all 5 also
  reference `_shared/learning-schema.md` by name.
- `a1-evolve/SKILL.md` §"Learning-enabled skill set (honesty note)" (line 59+)
  explicitly disclaims the "all skills" Philosophy-line phrasing and names the
  concrete set.
- Independently re-derived the count from scratch (not trusting the SKILL.md
  prose): grepped every `skills/*/SKILL.md` + `workflows/*.md` for a Retro marker
  → 16 distinct skills carry one (15 found by a broad glob + `a1-new-feature`,
  confirmed separately at `workflows/06-verify.md:278`), and `a1-progress` is
  confirmed as the only skill in the repo with **no** Retro/`_learning.md`
  mechanism anywhere in its files. This exactly matches a1-evolve's documented
  claim (16 named, `a1-progress` the sole exclusion) — the SKILL.md's own count is
  accurate, not just internally consistent.

## SC-8: Wave 7 produces one decision doc per topic; none of the four structural changes applied outside `decisions/`

**Verdict: PASS**

- `decisions/` contains exactly 4 files, one per named topic:
  `check-checklist-merge.md` (123 lines), `reinhard-samuel-boundary.md` (136),
  `postmortem-prose-extraction.md` (149), `agent-skill-consolidation.md` (370).
  Each contains an explicit recommendation (confirmed by content read during this
  verification, not just file existence).
- Verified none of the four structural changes leaked outside `decisions/`:
  - `a1-check` still exists as its own skill directory (not merged into
    a1-checklist); `a1-checklist/SKILL.md` shows no "check #9" addition.
  - `agents/a1-reinhard-reviewer.md` Phase 5 ("Security Audit") is still the
    original prose checklist — not converted to the proposed triage-and-escalate
    format.
  - No `_shared/agent-lessons.md` file was created (the proposed extraction
    target); `agents/a1-pablo-planner.md` and `agents/a1-erik-executor.md` still
    contain their original inline postmortem citations, untouched.
  - `git show --stat dd4ee5a` (the sole Wave-7 commit) confirms it touched
    **exclusively** the 4 files under `decisions/` — 778 insertions, 0 files
    outside that directory.

---

## Full regression gate (re-run this session)

```
node --check _shared/a1-tools.cjs
→ SYNTAX OK

for r in _test-fixtures/*/run*.sh; do bash "$r" || echo "FAILED: $r"; done
→ 23/23 suites green, 0 failures
```

Fixture-runner naming consistency (Task 2.4 claim) independently confirmed:
`ls _test-fixtures/*/run*.sh | xargs -n1 basename | sort | uniq -c` → `23
run-tests.sh` (zero `run.sh` / `run-test.sh` holdouts).

Working tree has two pre-existing, harmless uncommitted diffs
(`_test-fixtures/a1-reconcile/{single-missing,single-pass}/vault/projects/demo/drift-2026-05-13.md`)
— inspected directly: timestamp-only regeneration from re-running the a1-reconcile
fixture suite during this verification session, no content/logic change. Consistent
with STATUS.md's repeated note that these are out-of-scope, harmless artifacts.

`CLAUDE.md` at repo root does not exist (confirmed) — not applicable to this phase.

---

## Overall verdict: PASS

All 8 Success Criteria independently verified PASS against live repo state at HEAD
`cca0faa`. Every criterion that implied a runnable check was actually executed in
this session (fresh install to a temp HOME, seeded-drift tests against
`verify-install-sync.sh` including an isolated test of the 4th/scope-note
assertion, full grep sweeps for language-policy and Vault-prose violations,
frontmatter format greps, an independent from-scratch recount of the
learning-enabled skill set, and a structural-leak check on the Wave-7 commit) —
none of the 8 verdicts rest on trusting STATUS.md's prose alone.

STATUS.md's claims held up under adversarial re-verification with no discrepancies
found. Two STATUS.md self-corrections (Wave 6's finding that the plan's basis text
mischaracterized 4 skills as retro-free when they already had working Retro blocks,
and Wave 7's LOC/subsection corrections in the decision docs) were checked and are
themselves accurate — the executor's deviations improved correctness rather than
introducing drift.

No BLOCKER, MAJOR, or MINOR gaps found. Phase M11-audit-fixes is complete and its
Wave 7 decision docs are ready for Robert's review; no further action is required
to close this phase.
