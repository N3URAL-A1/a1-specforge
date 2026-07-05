# a1 Framework Constitution

**Adopted:** 2026-07-05 · **Source:** Part B of `docs/analysis/2026-07-05-consistency-audit-constitution.md`

## What this is

Ten invariants that hold across the entire a1 skill set. They are the tie-breakers:
when two files disagree, the invariant decides. They exist because every past
contradiction (C1–C9 in the consistency audit) began as an unowned duplicate or an
unenforced rule.

**a1-evolve enforces this document.** Its propose phase
(`skills/a1-evolve/workflows/03-propose.md`) checks every proposed diff against these
invariants and flags any violation in the proposal, so the self-optimization engine
cannot evolve the framework into an inconsistent state.

## The 10 invariants

1. **One owner per fact.** Any rule stated in two files names its owner; the copy is
   a link. Owners: routing → `rules/common/a1-framework.md`; isolation gate →
   `a1-worktree`; vault IA → `brain-ia.md`; commit conventions → `git-workflow.md`;
   learning loop → `a1-evolve`.

2. **Every pipeline skill learns.** `_learning.md` + a retro step are mandatory for
   any skill that orchestrates agents (checkpoint/progress exempt: no pipeline).

3. **Retros carry evidence.** `result:` must reference a verifiable artifact
   (VERIFICATION.md, commit, postmortem) — no evidence, no entry. (Feeds the FMEA-3
   retro-integrity cross-check.)

4. **The optimizer reads everything.** No learning store exists outside a1-evolve's
   collect globs. A new store ⇒ a new glob, in the same commit.

5. **Agents are addressed by full name.** `a1-<vorname>-<rolle>` everywhere; no
   first-name shorthand in prompts; link-files follow one naming scheme.

6. **Model pins are aliases or absent.** `haiku | sonnet | opus` or inherit;
   versioned model IDs never appear in skills/agents/rules.

7. **Gates are registered.** A check that can block ships with: a registry entry,
   deterministic exit semantics (or an explicit prompt-gate label), and a retro
   attribution id (feeds gate-ROI).

8. **A gate that cannot fail is documentation.** Warning-only checks must say so;
   the enforcement point is named explicitly.

9. **Verification targets the spec.** a1-victor-verifier / Phase-6 verify the spec's
   ACs verbatim; plans are routes, not truth.

10. **German to Robert, English on disk.** Dialogue German; artifacts, commits and
    frontmatter English; triggers bilingual.

## Enforcement

a1-evolve is the enforcement mechanism. In its propose phase
(`skills/a1-evolve/workflows/03-propose.md`), every proposed diff is checked against the ten
invariants above. Any diff that would introduce a violation — e.g. a second owner for
a fact (invariant 1), a new learning store without a matching collect glob (invariant
4), a versioned model pin (invariant 6), or an unregistered blocking gate (invariant
7) — is flagged in the proposal with the violated invariant number. Flagged proposals
are surfaced to the user, not silently applied.
