---
type: proposal
project: a1-specforge
title: "XS Quick Lane — a lean pipeline for tiny features and trivial fixes"
status: draft
created: 2026-07-22
author: "Fable 5 session in a1-skills (Robert)"
target_pipeline:
  - a1-new-feature
  - a1-fix
references:
  - "Size-triage S/M/L fast path: commit 7107a2b (2026-07-12) — 'phases scale, gates don't'"
  - "a1-check retirement: commits 4e1fd23 + 7f9d6cf (2026-07-12)"
  - "a1-fix isolation hard rule: skills/a1-fix/SKILL.md:112 ('no exceptions for one-liner')"
  - "Only size-sensitive skip precedent: a1-fix/workflows/03-fix.md:29-30 (scope-clarify skip)"
  - "Gate SSOT: _shared/gates-registry.md; CLI router: _shared/a1-tools.cjs:349-552"
  - "Retro contract: _shared/retro-template.md + _shared/learning-schema.md"
---

# Proposal: XS Quick Lane — lean pipeline for tiny features and trivial fixes

> **TL;DR (Deutsch):** Selbst ein Size-S-Feature durchläuft heute 7 Phasen, 5–6
> Agent-Spawns, ≥4 Pflicht-Artefakte und ≥3 User-Checkpoints; ein trivialer Bugfix in
> `a1-fix` hat gar keine Size-Triage und zahlt immer Worktree-Isolation, 2× Falk und ein
> Postmortem-Hard-Gate. Vorschlag: eine neue, eigenständige **XS Quick Lane** (`a1-quick`)
> — eine Session, null Sub-Agents, ein Artefakt, ein Checkpoint — mit deterministischem
> Eligibility-Gate am Eingang und harten Eskalations-Tripwires zurück in die volle
> Pipeline. Die Doktrin „Phasen werden nie übersprungen" bleibt für S/M/L unangetastet;
> XS wird als separate, gate-begrenzte Lane in der Constitution verankert.

## 1. Problem

The 2026-07-12 size triage (commit `7107a2b`) established "phases scale, gates don't":
Size-S features get a mini-spec, a 3-question clarify, and a single-wave plan — but every
phase, every deterministic gate, and every mandatory lane still runs. Measured against what
a genuinely tiny change needs, the floor is still high:

**Size-S feature today (a1-new-feature):**

| Cost driver | Count |
|---|---|
| Phases | 7 (none skippable, hard rule SKILL.md:350-352) |
| Mandatory agent spawns | 5–6 (Rene, Gate-C, Vincente, code agent, Reinhard, Diana) |
| Mandatory artifacts | ≥4 (spec, product-docs entry, wave plan, retro) + worktree + reservations |
| Deterministic gates | 5+ (roadmap, Gate C, Gate 4.5, reservations, scope claim, isolation) |
| User checkpoints | ≥3, incl. the 5-step lifecycle completion gate |

**Trivial fix today (a1-fix):** no size triage exists at all. Every bug — explicitly
including one-liners (SKILL.md:112) — pays 5 phases, ≥3 spawns (Falk ×2 + code agent),
mandatory worktree isolation, and the postmortem hard gate. The six most recent real-world
fix retros (2026-07-19..21, all `fix_wave_count` 0–2) show this hits mostly trivial fixes:
wrong favicon, dead button, over-broad URL detection.

**Learning loop:** the full retro contract runs per run regardless of size, and trivial
runs alone trigger the every-5th-entry a1-evolve prompt.

The framework's own adoption evidence (M8 contributor dry-run friction; the `7107a2b`
rationale "removes the 'do full depth even for trivial features' adoption blocker") says
this class of overhead is what stops the pipeline being used happily for small work.

## 2. Design principles

1. **Don't stretch S further — add a bounded XS lane.** S already is the compact form of
   the full pipeline. Shrinking it more would erode gates for everything. Instead, XS is a
   *separate* lane with its own contract.
2. **The doctrine survives via boundaries, not exceptions.** "Phases are never skipped"
   stays true *inside* a1-new-feature and a1-fix. The XS lane is a different pipeline whose
   entry (deterministic eligibility gate) and exit (verified commit, or escalation into the
   full pipeline) are themselves gates. Constitution invariant 7/8 gets one amendment
   sentence, not a loophole.
3. **Zero spawns, one artifact, one checkpoint.** The main session does spec-lite,
   implementation, and verification inline. Every removed spawn is removed latency and
   removed tokens.
4. **Cheap to enter, cheap to leave.** Misclassification must not be expensive: if any
   tripwire fires mid-run, the lane stops and hands its artifact to the full pipeline —
   nothing done in the lane is wasted.
5. **Still observable.** Every quick run leaves one machine-readable record so a1-evolve
   can measure escalation and regression rates and tighten/loosen criteria with data.

## 3. The XS Quick Lane (`a1-quick`)

A new standalone skill (17th), usable for both tiny features and trivial fixes. One
SKILL.md, no workflows/ directory, no sub-agents.

### 3a. Eligibility (entry gate `quick-eligibility`)

ALL must hold — checked by a new CLI subcommand (`a1-tools.cjs quick eligibility`), grep/
parse only, exit 0/1/2 like the other gates:

- exactly 1 intent (1 FR or 1 defect), statable in ≤2 sentences
- expected change ≤2 files, expected diff ≤ ~50 lines
- no data model / migration, no new route or screen, no new dependency
- diff paths must not match the forbidden-surface globs (auth/payment/tenant/security
  config — reuse the S-criteria list from a1-new-feature SKILL.md:91-97)
- working tree clean, no overlapping code-scope reservation (`check reservations` reused)

Anything else → normal routing (a1-new-feature ≥S, a1-fix).

### 3b. Flow (single session, 4 inline steps)

1. **Spec-lite** — 3 lines written into the run record: intent, 1–3 acceptance checks,
   expected files. No Rene, no clarify questionnaire; at most 1 inline question if the
   intent is ambiguous.
2. **Implement** — directly in the main session on a `quick/<slug>` branch (see 3d).
   No code-agent spawn.
3. **Verify inline** — run the project's affected tests/build, check each AC once. No
   Victor, no Reinhard full-diff review; instead a fixed 5-point self-review checklist
   (immutability, error handling, input validation, no secrets, no scope creep) recorded
   in the run record.
4. **Single checkpoint** — show Robert the diff + verify result in plain language; on
   confirmation: one atomic commit, branch merged, done. No 5-step lifecycle gate.

### 3c. Escalation tripwires (exit gate `quick-escalation`)

Hard STOP + handoff to the full pipeline when any fires mid-run:

- a 3rd file needs touching, or diff exceeds ~50 lines
- the change turns out to touch a forbidden surface
- a second FR/defect emerges, or verify fails twice
- root cause is unclear after one focused look (fixes only — that's Falk territory)

On escalation the run record becomes the seed: for features it pre-fills Rene's mini-spec,
for fixes it becomes the Phase-1 bug report draft. The `quick/<slug>` branch is adopted by
the full pipeline's worktree flow (precedent: a1-worktree adopt mode).

### 3d. Isolation light

Instead of the mandatory worktree: clean working tree required (eligibility), work on a
short-lived `quick/<slug>` branch in the main checkout, exactly one atomic commit, merge on
checkpoint approval. Revert path = `git revert <sha>`. Rationale: the worktree registry
machinery is the single biggest fixed cost for one-liners; a branch + atomic commit gives
the same rollback guarantee at near-zero setup cost. The a1-fix hard rule at SKILL.md:112
is amended to: worktree for everything routed through a1-fix; XS-eligible bugs are routed
to the quick lane *before* that rule applies.

### 3e. One artifact + micro-retro

Single file `projects/<slug>/quick/<YYYY-MM-DD>-<slug>.md` with machine frontmatter
(`type: quick-run`, `kind: feature|fix`, `result`, `escalated`, `files`, `diff_lines`,
`verify`, `retro:` one line). This replaces spec + plan + bug report + postmortem + full
retro for XS runs. The learning store gets a lightweight collector: a1-evolve reads
quick-run frontmatter in aggregate; quick runs count ⅕ toward the every-5-entries evolve
trigger so trivial work stops spamming the synthesis prompt.

## 4. Framework integration points

| Where | Change |
|---|---|
| `skills/a1-quick/SKILL.md` | new skill — the lane itself |
| `_shared/a1-tools.cjs` router (:349-552) + `_shared/lib/` | new `quick` group: `eligibility`, `log`, `stats` |
| `_shared/gates-registry.md` | register `quick-eligibility`, `quick-escalation` |
| Constitution invariant 7/8 | one amendment sentence: XS quick lane is a separate gate-bounded pipeline; entry+exit deterministic |
| `skills/a1-new-feature/workflows/01-discover.md:64-79` | triage gains XS tier above S; XS → handoff to a1-quick before Phase 1 spends anything |
| `skills/a1-fix/SKILL.md` Phase 0 | NEW size triage (currently none): XS-eligible → handoff before pre-flight/isolation; everything else unchanged |
| `_shared/retro-template.md` | add quick-run micro-retro variant + ⅕ weighting rule |
| a1-evolve collect phase | read `projects/*/quick/*.md` frontmatter; new metrics (§5) |
| `~/.claude/rules/common/a1-framework.md` | routing row: "Kleinigkeit, Quick-Fix, Mini-Feature → a1-quick" — user-authored, Robert edits (outside repo/evolve scope) |

Secondary measure (independent, cheap): for bugs that are small but NOT XS, a1-fix merges
Phase 1+2 into a single Falk spawn (triage + diagnosis in one pass) when the reporter can
already point at the failing behavior — saves one spawn on every simple-but-real bug.
Precedent: the scope-clarify skip at 03-fix.md:29-30.

## 5. Safety & self-correction metrics

Tracked from quick-run frontmatter, surfaced by `quick stats` and a1-evolve:

- **escalation_rate** — >30% over a 10-run window ⇒ eligibility criteria too loose, propose tightening
- **regression_rate** — any a1-fix bug within 14 days touching a file last changed by a quick run ⇒ flag that run's class, propose moving it out of XS
- **runs / median wall-clock** — proves (or disproves) the lane's value

This is the same evidence-loop pattern the framework already uses (`gates_fired[].id` ROI
tracking) — the lane earns its permissiveness or loses it.

## 6. Expected impact

| | S feature today | trivial fix today | XS quick lane |
|---|---|---|---|
| Phases / sessions | 7 phases | 5 phases | 1 session |
| Agent spawns | 5–6 | ≥3 | 0 |
| Mandatory artifacts | ≥4 + worktree | ≥3 + worktree | 1 |
| User checkpoints | ≥3 | ≥2 | 1 |

## 7. Rollout (via a1-new-feature, size M)

- **Wave 1:** `a1-quick` SKILL.md + CLI `quick eligibility|log` + run-record schema + fixtures
- **Wave 2:** triage hooks (a1-new-feature XS tier, a1-fix Phase-0 triage), constitution amendment, gates-registry entries
- **Wave 3:** evolve collector + `quick stats` + retro-template variant; Robert updates the routing rule file

## 8. Open questions for Robert

1. File threshold 2 or 3? (2 = safer start; can be loosened by data via §5)
2. Should the single checkpoint come *before* the commit (Robert approves diff, then
   commit) or *after* (commit immediately, checkpoint approves merge)? Proposal: before.
3. Reinhard review as opt-in flag for quick runs (`--review`), or strictly never in XS?
