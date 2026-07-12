# PLAN — M12 Review Fixes

**Created:** 2026-07-12 · **Source:** External deep review (Fable 5, max effort) + the four
M11 Wave-7 decision docs (`.a1/phases/M11-audit-fixes/decisions/`), decided 2026-07-12 by
Robert's blanket instruction "setze die angesprochenen Punkte um" (decisions follow each
doc's own recommendation).

**Goal:** Close the review findings before launch — wire dead-but-tested CLI paths, remove
language-policy contradictions, centralize retro boilerplate, execute the four decision
docs, add a size-triage fast path to a1-new-feature, and sync the global rules file with
repo reality.

**Non-goals (explicitly deferred, per decision docs):** Format axis B (XML→Markdown prompt
dialect, own follow-up phase), lifecycle-gates extraction (needs dedicated analysis),
product.cjs module split, nested-YAML parser replacement, CWD-based vault resolution.

## Wave 1 — CLI wiring + hygiene (deterministic layer)

| # | Task | Done when |
|---|---|---|
| 1.1 | Wire `check reservations` scalar claims into Gate 4.5 (`04.5-consistency-gate.md`) — the gates-registry already claims this happens; make it true. Plan-declared migration numbers get claimed via `--claim migration:<nnn> --by <spec-id>`; exit 1 = collision = gate FAIL path. | Gate 4.5 workflow contains the claim step; gates-registry line matches reality. |
| 1.2 | Wire `pack validate` into a1-evolve Collect (`01-collect.md`): validate staged packs before ingesting their patterns; document `pack import` as the supported install path in `packs/postgres-rls/` docs. | 01-collect.md calls the CLI; pack docs name import command. |
| 1.3 | Add `sanitizeSlug()` to `io.cjs` (reject `..`, `/` prefixes, empty); apply at spec/fix/analyze/reconcile/modernize init + check/checklist entry points. | Hostile slug (`../x`) exits 2 with clear message; fixture added. |
| 1.4 | Translate hardcoded German human-format output in `check.cjs` + `checklist.cjs` to English (language policy: English-first). | No German strings in `_shared/lib/*.cjs`; all fixtures green. |

## Wave 2 — Skill-text consistency

| # | Task | Done when |
|---|---|---|
| 2.1 | `allowed-tools`: unify subagent tool name to `Agent` (canonical since Claude Code 2.1.63; `Task` is an alias) across 9 skills. | grep shows only `- Agent` in skills' allowed-tools. |
| 2.2 | Remove hardcoded "output in German" rules from `a1-phantom` (SKILL.md + workflows/01-check.md) and `a1-pr-review` (SKILL.md:113) → defer to `_shared/language-policy.md`. | No hardcoded output-language rules; policy referenced instead. |
| 2.3 | Create `_shared/retro-template.md` (canonical retro block; learning store FIRST as required target, `~/.claude/skills/<skill>/_learning.md` dev-cache as optional best-effort — fixes the plugin-install path break). Replace the ~15 near-identical per-skill retro blocks with short references keeping only skill-specific values (issues-tags, task naming). | Each retro-bearing skill ≤ 10 lines of retro text; template holds the mechanics. |
| 2.4 | Format axis A (decision doc 7.4): all 21 agent `description:` frontmatter fields → YAML block scalar (`description: |`). | 21/21 block-scalar; no content change. |

## Wave 3 — Decision-doc execution

| # | Task | Done when |
|---|---|---|
| 3.1 | check⊂checklist merge, option (a): FR-coverage becomes checklist Check #9 (BLOCKER) reusing `check.cjs` functions (export `extractSpecFRs`/`extractWaveFRs`/`diffFRCoverage`); `a1-check` SKILL.md rewritten as deprecated alias (CLI `check run` keeps working; 04.5 untouched this release). | Check #9 in checklist fixture; a1-check SKILL.md = alias notice; both frontmatters' "distinct from" text retired. |
| 3.2 | Reinhard Phase 5 → Security **Triage** with 4 named Samuel-escalation classes (draft text from decision doc 7.2); Phase 7 drops the duplicate trust-boundary bullet. | Reinhard prompt contains triage checklist + escalation; Phase 7 bullet gone. |
| 3.3 | Postmortem-prose extraction pilot (doc 7.3, option a): create `_shared/agent-lessons.md`; Pablo's dated tenant-context paragraph → one-line principle + pointer; `a1-evolve/workflows/04-apply.md` gets the append-to-lessons-file-not-prompt rule. | Pablo diff applied per doc's example; apply-rule present. |
| 3.4 | Diana wiring (doc 7.4 candidate 3, option 3a): docs-drift lane in `a1-new-feature` Phase 6 Verify (report-only); Diana frontmatter names her spawner. | 06-verify.md spawns Diana; her description says so. |
| 3.5 | Move `skills/hero-animation-builder/` → `_extras/hero-animation-builder/` (doc 7.4 candidate 5); re-point the manual symlink in `~/.claude/skills/`; update references. | Dir moved; symlink resolves; no dangling refs in repo. |
| 3.6 | CONTRIBUTING.md: document `## Versions` as opt-in for skills with major revisions (doc 7.4 MAP c). | Paragraph present. |
| 3.7 | Set the four decision docs' frontmatter `status: decided` + decision + date. | 4/4 updated. |

## Wave 4 — Fast path (size triage)

| # | Task | Done when |
|---|---|---|
| 4.1 | Size triage S/M/L in a1-new-feature Phase 1 (conservative S criteria: ≤2 FRs, no migration/new route/auth surface, ≤3 files expected; uncertain → M; user can override). S shrinks depth INSIDE phases (mini-spec, 3-question clarify, no mockup requirement, single-wave plan, one implement checkpoint, compact verify) — deterministic gates (0, 4.5, Gate C) stay. `size:` field in spec frontmatter. | SKILL.md documents triage + S path; workflows 01/03/04/05/06 carry size-S branches; "never skip phases" reworded to "phases always run, depth scales". |

## Wave 5 — Global sync + verification

| # | Task | Done when |
|---|---|---|
| 5.1 | Sync `~/.claude/rules/common/a1-framework.md` (outside repo): learning store = repo-local (vault optional via `A1_VAULT_ROOT`), routing table marks a1-check → deprecated (use a1-checklist). | Global rules match repo reality. |
| 5.2 | Full verification: all fixture suites, `verify-install-sync.sh`, `node --check`. | All green. |
| 5.3 | STATUS.md, VERIFICATION.md, observations.jsonl, retro to learning store. | Artifacts complete. |
| 5.4 | Push to origin/main. | CI green. |

## Ground rules

- Conventional commits, one atomic commit per task where sensible (wave-atomic for the
  multi-file text sweeps 2.3/2.4). No attribution lines (repo convention).
- Every wave ends with the full fixture suite green before its final commit.
- `04.5-consistency-gate.md`'s call to `a1-tools check run` is NOT switched to checklist
  in this phase (decision doc 7.1 step 5 — deprecation window).
