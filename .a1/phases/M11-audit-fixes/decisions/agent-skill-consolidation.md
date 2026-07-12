---
topic: agent + skill consolidation review
task: 7.4
status: decided
decision: per-candidate recommendations adopted — executed M12 Wave 3 where actionable
decided: 2026-07-12 (Robert delegated via "setze die angesprochenen Punkte um")
executed: Theo/Rafael/Ludwig/Marco-haiku = keep (no change); Diana = 3a wired into a1-new-feature Phase 6 Step 5.5; hero-animation-builder moved to _extras/ (symlink re-pointed); format axis A block-scalar sweep done; MAP c documented in CONTRIBUTING.md. Deferred as the doc recommends — format axis B (own follow-up phase), MAP b lifecycle-gates extraction (needs dedicated analysis), Ludwig-vs-legal-plugin empirical diff (open verification).
created: 2026-07-12
depends_on: Task 4.3 (landed, Wave 4), Task 5.4 (note-only, landed, Wave 5)
---

# Decision: agent + skill consolidation candidates

Six original candidates, two format-axis questions carried from Task 5.4,
and three additional candidates MAP.md §9 surfaced during planning. Each
gets keep/merge/drop (or adopt/leave-as-is for the format axes) with a
one-paragraph rationale and what breaks if the recommendation is taken.
Nothing in this document has been applied — this is a decision doc only.

---

## Candidate 1 — Theo (a1-theo-test-engineer)

**Evidence:** single caller, confirmed via grep — `a1-modernize` Phase 6
only. Referenced in `skills/a1-modernize/SKILL.md` (×3),
`workflows/06-execute.md`, `workflows/05-plan.md`, and has a dedicated link
file `skills/a1-modernize/agents/a1-theo-test-engineer-link.md`. No other
skill spawns Theo.

**Recommendation: keep.** A single caller is not evidence of low value —
Theo's job (test-skeleton generation with parity assertions, reviewed per
wave before Erik's executor run) is a distinct competency from both Erik
(implements) and Reinhard (reviews after the fact). Merging Theo into Erik
would make Erik responsible for both writing code and writing the tests
that check it, which undermines the parity check's independence. Merging
Theo into a1-modernize's own prompt logic (no separate agent) would work
mechanically but loses the reusability if a future skill (e.g. a
test-coverage-audit skill) wants to spawn the same test-pattern expertise
standalone.

**What breaks if dropped:** a1-modernize Phase 6 loses its
skeleton-test-before-implementation step; Erik would either skip it or
absorb the responsibility, losing the "review test quality per wave"
independence the current split provides.

---

## Candidate 2 — Rafael (a1-rafael-reverse-spec)

**Evidence:** single caller, confirmed — `a1-modernize` Phase 2 only.
Referenced in `SKILL.md` (×3), `workflows/02-reverse-spec.md`, and has a
link file `skills/a1-modernize/agents/a1-rafael-reverse-spec-link.md`.

**Recommendation: keep.** Rafael is explicitly the mirror of
`a1-rene-requirement-engineer` (forward-spec vs. reverse-spec) — a
conceptually distinct, well-scoped role even though only one skill
currently spawns him. His description's discipline ("never invents
behavior — unclear intent is flagged as open_question, not guessed") is a
real methodological constraint that would get diluted if folded into a
more general-purpose agent. Also: Rafael already uses the target
delegation-table format (Task 5.3's copy-paste template) — he's the
best-maintained of the "single caller" candidates, which weakly argues
against merging him away.

**What breaks if dropped:** a1-modernize Phase 2 (reverse-engineering specs
from undocumented code) loses its dedicated agent; the "don't invent
behavior" discipline would need to be re-asserted wherever the
responsibility lands instead.

---

## Candidate 3 — Diana (a1-diana-docs)

**Evidence:** **zero references in any `skills/` file** — confirmed via
`grep -rln "a1-diana-docs\|diana-docs" skills/` returning no hits. Diana is
genuinely orphaned: no skill spawns her, and her own agent file doesn't
resolve whether she's meant to be user-invoked directly or spawned by a
future skill. This is the one candidate in this list that is not a "should
we consolidate two things" question — it's "this agent currently has no
path to being used by the a1 pipeline at all."

**Recommendation: decide invocation path, don't drop.** Diana was added in
the 2026-07-12 specialization pass (`2f22541`) alongside Samuel and Dario —
both of *those* got wired into skills (Samuel into a1-analyze/a1-new-feature/
a1-fix; Dario referenced from the same specialization pass) but Diana did
not. This looks like an incomplete wiring, not a deliberate "documentation
agent should only ever be invoked manually" design choice — there's no
documented rationale for treating docs generation differently from security
review. Two concrete options:
  - **(3a)** Wire Diana into an existing skill's workflow — most natural
    fit is a1-new-feature's Verify phase or a1-modernize's final phase,
    generating/updating docs after a feature lands, mirroring how Samuel is
    an always-on lane in a1-analyze.
  - **(3b)** Leave Diana user-invoked-only, but say so explicitly in her own
    frontmatter description (currently silent on this) so a future auditor
    doesn't re-flag her as accidentally orphaned.

Recommend **(3a)** as the default unless Robert specifically wants docs
generation to stay a manual, on-demand action — in which case (3b) closes
the gap cheaply.

**What breaks if dropped:** nothing breaks today (she's already unreachable
via any skill), which is itself the argument for not quietly dropping her —
dropping an agent nobody can currently reach doesn't remove any capability
that's in active use, it just permanently forecloses the wiring option
without ever having tried it.

---

## Candidate 4 — Ludwig (a1-ludwig-legal)

**Evidence:** referenced from 3 skill-side sites (`a1-analyze/SKILL.md`,
`a1-analyze/agents/ludwig-link.md`, `a1-analyze/workflows/03-analyze.md`) —
not orphaned, actively wired into a1-analyze. The plan's basis text asks
whether Ludwig "largely duplicates the installed `legal` Claude Code
plugin." **This pass could not verify the plugin's presence or contents in
this environment** (no local plugin directory found under the paths
checked) — this is a gap in this decision doc, not a settled answer, and
should be treated as an open verification step rather than a recommendation
input.

**Recommendation: keep, pending a direct diff against the `legal` plugin.**
Ludwig's frontmatter claims EU/DACH-specific depth (GDPR, EU AI Act, DSA,
NIS2, IP, Impressum/AGB) and a GREEN/YELLOW/RED triage output format
tailored to this repo's a1 pipeline conventions (spawned inline by
a1-analyze, not a standalone invocation). Generic plugin tooling for
contract/compliance review is unlikely to natively produce a1-shaped
findings output or understand this repo's `constitution.md` convention. Do
not drop without first running both Ludwig and the `legal` plugin's
`compliance-check` skill on the same input and comparing outputs — the
actual overlap (or lack of it) is an empirical question this document
cannot answer without that comparison.

**What breaks if dropped:** a1-analyze loses its legal/compliance lane
entirely unless the `legal` plugin is wired in as a replacement — untested
whether it produces equivalent output shape.

---

## Candidate 5 — hero-animation-builder location

**Evidence:** confirmed structurally unlike every other skill — 56-line
`SKILL.md`, `references/` + `scripts/` dirs, **no `workflows/` directory**
(every other a1-convention skill has one). Deliberately excluded from
`install.sh`'s SKILLS array and from README's skills table (both already
correctly agree on 17, per Wave 1/2's work). Frontmatter description is a
plain single-line string (not the a1 pattern of MUST-trigger/Do-NOT-activate
enumeration used by the other 17 skills, though it does list trigger
phrases inline). It genuinely follows a different convention — this isn't
an oversight, it's a different kind of skill (a content-generation skill
with reference material and scripts, not an orchestration pipeline with
phases/workflows/agents).

**Recommendation: move out of `skills/` to a repo-root `_extras/` directory
(or a separate repo, if Robert wants Claude-Code-marketplace skills kept
fully independent of the a1-specforge pipeline conventions).** Leaving it
inside `skills/` alongside 17 a1-convention skills invites exactly the kind
of confusion the M11 audit is closing elsewhere (a reader assumes
`skills/*` all follow the same shape). A repo-root `_extras/` (sibling to
`_shared/`, `_test-fixtures/`) makes the exception visible in the directory
structure itself rather than requiring a reader to already know the
exclusion-list convention.

**What breaks if dropped (i.e., moved):** nothing functionally — it's
already excluded from install.sh/README, so moving it doesn't change what
gets installed. Any documentation or session history that references its
current `skills/hero-animation-builder/` path would need updating, and the
symlink-based Claude Code skill discovery mechanism (if it scans `skills/`
directories for auto-registration outside this repo's own install.sh) would
need to be re-pointed — verify how it's currently made available to Claude
Code sessions (marketplace.json? manual symlink?) before moving, since that
mechanism isn't documented in this repo's own install tooling.

---

## Candidate 6 — Marco's haiku pin (from Task 4.3's note)

**Evidence (from Task 4.3, Wave 4, already landed):** Task 4.3 already
removed the two concrete haiku-reliability risks — the `python3 -c` inline
pipeline (replaced with plain grep) and the `src/` fixation (replaced with
a "detect top-level source dirs" step). The remaining open question Task
4.3 explicitly deferred is the model pin itself: should Marco stay `haiku`
now that the prompt is simplified, or does codebase-structure mapping still
need sonnet-tier judgment for edge cases the simplification didn't reach
(e.g. monorepos with unconventional layouts, or judgment calls about what
counts as a "quality hotspot")?

**Recommendation: keep on haiku, revisit only if Marco's output quality is
observed to degrade in practice.** The global token-optimization rule
(`~/.claude/rules/common/token-optimization.md`, outside this repo) already
establishes "Routing, Klassifikation, Doku, Q&A" and worker agents with a
clearly-defined task as haiku-appropriate; Task 4.3's simplification was
specifically designed to make Marco's task match that profile (plain
grep/glob instead of inline Python, explicit dir-detection instead of
implicit `src/` assumption). Upgrading preemptively without observed
failures would be optimizing against a hypothetical, not a measured
problem — the a1-evolve learning loop is the right mechanism to catch this
if Marco's MAP.md output quality degrades in practice (a1-evolve would
surface it as a recurring pattern after 3+ occurrences).

**What breaks if changed:** upgrading to sonnet doesn't break anything
functionally, it's a cost increase; staying on haiku risks silent
under-performance on codebases the simplified prompt doesn't handle well —
mitigated by the learning-loop's ability to catch and surface this pattern
if/when it recurs.

---

## Format axis A — `description:` frontmatter style

**Evidence (from Task 5.4, verified again live for this doc):** three
mixed styles across the 21 agents:
- **Quoted-single-line** (8 agents): alex, aik, ludwig, reinhard, tobi, uwe,
  vincente, walter
- **YAML block-scalar `description: |`** (4 agents): dario, diana, falk,
  samuel
- **Bare-unquoted** (9 agents): adam, erik, marco, pablo, rafael, rene,
  rico, theo, victor

The block-scalar style correlates exactly with the newest
specialization-pass agents (falk, reinhard, samuel, dario, diana — the
2026-07-12 additions/rewrites), suggesting it was adopted as the *de facto*
new default without a repo-wide retrofit.

**Recommendation: adopt block-scalar (`description: |`) repo-wide.** It's
already the newest convention, handles multi-sentence descriptions with
embedded punctuation/quotes more robustly than quoted-single-line (no
escaping concerns), and is what a YAML frontmatter linter would flag the
other two styles against if this repo ever adds one. This is a **mechanical,
low-risk sweep** (frontmatter-only, no content change) — recommend
executing it as a follow-up task, not bundling into this decision doc's
scope.

**What breaks if changed:** nothing functionally — `description:` is
read as prose either way; a YAML parser handles all three styles
correctly today (block-scalar isn't fixing a bug, it's fixing
inconsistency). Risk is purely diff-size (21-file touch) for a
non-functional change — low priority, batch it opportunistically.

---

## Format axis B — prompt-body dialect

**Evidence (verified live via grep for `<role>`/`<not_in_scope>` XML tags
across all 21 agent files):**

- **XML-tag dialect** (9 agents, non-zero tag count): adam (2), erik (2),
  marco (2), pablo (2), rene (2), rico (2), victor (2), theo (3), rafael (4)
- **Markdown-heading dialect** (12 agents, zero XML tags): aik, alex, dario,
  diana, falk, ludwig, reinhard, samuel, tobi, uwe, vincente, walter

This is a **different split than Task 5.4's original framing** (which said
"9 XML-tag agents vs. 4 newest Markdown agents") — live count shows 12
agents already use Markdown headings, not 4. The Markdown-heading group
includes both the 4 newest specialization-pass agents (dario, diana, falk,
samuel) *and* 8 older agents (aik, alex, ludwig, reinhard, tobi, uwe,
vincente, walter) that apparently never used XML tags in the first place.
The XML-tag dialect is actually the minority (9/21), concentrated in the
`a1-plan`/`a1-execute` pipeline agents (adam, erik, marco, pablo, rico,
victor — the original core pipeline) plus rafael, rene, theo.

**Recommendation: adopt Markdown-heading dialect repo-wide** (the majority
style, 12/21, and the style used by every agent added or rewritten in the
most recent specialization pass) — but this is a **higher-effort, higher-
risk sweep than Format axis A**: converting `<role>`/`<not_in_scope>` XML
tags to Markdown headings touches prompt *structure*, not just frontmatter,
for 9 files (adam, erik, marco, pablo, rafael, rene, rico, theo, victor) —
including some of the most load-bearing pipeline agents (Erik executes
every wave, Victor verifies every phase). Recommend treating this as its
own follow-up phase with its own plan, not a quick sweep — the risk of
subtly changing prompt-parsing behavior (if anything downstream greps for
`<role>` tags specifically) needs to be checked first
(`grep -rn "<role>\|<not_in_scope>" skills/ agents/ bin/` to confirm nothing
outside the agent files themselves depends on the XML shape) before
committing to the conversion.

**What breaks if changed:** if nothing downstream parses the XML tags
programmatically (needs verification, not yet done), converting is
purely cosmetic/consistency and low risk. If something does depend on the
tag structure (undetected in this pass), a blind conversion could silently
break that consumer — this is the reason to scope it as its own
follow-up phase with its own verification step, not fold it into this
decision doc's "keep/merge/drop" scope.

---

## MAP.md-surfaced addition (a) — a1-check ⊂ a1-checklist overlap

Already Task 7.1's own topic — see
`.a1/phases/M11-audit-fixes/decisions/check-checklist-merge.md`. Cross-
referenced here per the plan's instruction, not duplicated.

---

## MAP.md-surfaced addition (b) — shared lifecycle-gates extraction

**Evidence (verified live, corrects the plan's basis text):** the plan's
basis paragraph cites "a1-fix (~224 LOC)" for its lifecycle-gate logic.
Live `wc -l` on `skills/a1-fix/workflows/*.md` totals **724 lines**, not
224 — the plan's figure appears stale or was scoped to a narrower subset
of a1-fix's workflow files than "all of them." `skills/a1-new-feature/
workflows/*.md` totals **1508 lines**, roughly matching the plan's "~1507"
figure. Both skills implement hard-rule gates (state transitions, spec
status checks, STOP conditions) with their own bespoke logic and prose.

**Recommendation: flag as a real candidate, but explicitly out of scope for
extraction in this phase — defer to a dedicated follow-up.** A shared
`_shared/lifecycle-gates.md` reference (state-machine transition rules,
STOP-gate conventions, spec-status vocabulary) could reduce duplication
between a1-fix's and a1-new-feature's independently-maintained gate logic,
and likely other pipeline skills (a1-modernize, a1-plan) that also
implement state transitions. But this is exactly the kind of extraction
that risks the scope creep the plan's own text warns about ("flag the risk
of ballooning into cross-wave scope creep") — the two skills' gate logic,
while conceptually similar, is not verified here to be *textually*
duplicative (i.e., it may already be appropriately specialized per-skill
rather than copy-pasted). Recommend a future `a1-analyze` run scoped
specifically to "gate logic duplication across pipeline skills" before
committing to an extraction — don't extract based on LOC-count similarity
alone.

**What breaks if not extracted:** nothing — status quo, two independently
maintained gate implementations. Risk is only maintenance drift over time
(a fix to one skill's gate logic not propagating to the other's similar
logic), not a current defect.

---

## MAP.md-surfaced addition (c) — "Versions" section consistency

**Evidence (verified live):** exactly 4 of 18 skills have a `## Versions`
section: `a1-analyze`, `a1-constitution`, `a1-modernize`, `a1-reconcile`
(confirmed via `grep -lc "^## Versions" skills/*/SKILL.md`).

**Recommendation: drop the convention rather than standardize it
everywhere.** A `## Versions` section is most valuable for skills that have
undergone visible behavioral revisions worth documenting for a returning
user (a1-analyze went v1→v2 with a documented architecture change;
a1-modernize and a1-reconcile are similarly evolution-heavy). Skills with a
stable, single-shot design (e.g. a1-check, a1-phantom) don't need one —
forcing a `## Versions` section onto all 18 would produce empty or
one-line-forever sections on the majority. Recommend keeping it as an
opt-in convention for skills that have actually had a documented major
revision, and noting this explicitly in `CONTRIBUTING.md` (or equivalent)
so it reads as a deliberate choice rather than an inconsistency.

**What breaks if left as-is (i.e., this recommendation is "drop the
expectation of universality," which requires no file changes):** nothing —
this is already the de facto state; the only change needed is documenting
that it's intentional, not fixing 14 "missing" sections.

---

## Summary table

| Candidate | Recommendation | Effort to execute | Risk |
|---|---|---|---|
| 1. Theo | keep | n/a | n/a |
| 2. Rafael | keep | n/a | n/a |
| 3. Diana | wire into a skill (3a) or document as manual-only (3b) | low (3b) / medium (3a) | low |
| 4. Ludwig | keep, pending empirical diff vs. `legal` plugin | medium (the diff itself) | low |
| 5. hero-animation-builder | move to repo-root `_extras/` | low-medium | low, pending discovery-mechanism check |
| 6. Marco haiku pin | keep, revisit only on observed degradation | none now | low |
| Format axis A (description style) | adopt block-scalar repo-wide | low | low |
| Format axis B (prompt-body dialect) | adopt Markdown-heading repo-wide | medium-high | medium, needs downstream-dependency check first |
| MAP (a) check⊂checklist | see Task 7.1 doc | — | — |
| MAP (b) lifecycle-gates extraction | defer, needs dedicated analysis first | n/a (deferred) | low if deferred |
| MAP (c) Versions section | drop the universality expectation, document as opt-in | none (documentation only) | none |

## Not done by this task

No agent, skill, or frontmatter file was merged, moved, dropped, or
reformatted. This document is the entire deliverable for Task 7.4.
