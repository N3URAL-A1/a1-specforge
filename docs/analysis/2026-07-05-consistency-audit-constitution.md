# Prompt Consistency Audit + Framework Constitution (draft)

**Date:** 2026-07-05 · **Scope:** 18 SKILL.md, 18 agent briefs, all workflows, global rules (`~/.claude/rules/common/*`, `~/.claude/CLAUDE.md`) — first-ever full cross-read.

## Part A — Findings (severity-ordered)

### A1 — Split-brain learning store (CRITICAL)
a1-fix writes its entire learning output to `wiki/postmortems|bug-patterns|lessons/` — an IA that (a) the global rules explicitly ban ("KEINE wiki-Ordner, Wildwuchs-Verbot") and (b) **a1-evolve never reads** (it reads `pattern/a1-learnings/`). Consequence: the self-optimization engine is blind to the entire bug-fix corpus — the richest evidence of what actually breaks. The vault index itself flags this (`index.md:470`).
**Resolution ▸** Keep `wiki/`-style detail files as a1-fix's working store if desired, but make `fix promote-lessons` ALSO append a normalized entry to `pattern/a1-learnings/a1-fix.md`, and add `wiki/postmortems/` to a1-evolve's collect globs. Then legalize the folder in the rules (or migrate — decide once).

### A2 — Vault IA contradiction: `projects/` vs 7-Typen (CRITICAL, decide-once)
All 6 artifact-writing skills use plural `projects/<slug>/{spec,plans,fixes,analyses,modernize}/` (33 refs). The global rules mandate singular flat `project/<slug>.md` hubs and forbid new top-level trees. Both cannot be canonical.
**Resolution ▸** Declare **both, with roles**: `project/<slug>.md` = hub/spine (7-Typen), `projects/<slug>/…` = artifact store owned by a1-skills. One paragraph in `agents.md` + brain-ia.md ends the contradiction. (Migrating 33 refs is worse than legalizing reality.)

### A3 — a1-evolve self-contradiction on inputs (HIGH)
Its description says it reads the Vault; its own "Input sources" table omits the Vault and adds `learnings-index.md`. Combined with A1 this means nobody can say what the optimizer actually consumes.
**Resolution ▸** One canonical input list in SKILL.md body: `_learning.md` caches + `observations.jsonl` + Vault `pattern/a1-learnings/*.md` + (new) a1-fix postmortems; `learnings-index.md` = output cache, not input.

### A4 — Model references stale, two competing conventions (HIGH)
Pins mix bare aliases (`opus`, `sonnet`) with versioned IDs (`claude-opus-4-7`, `claude-sonnet-4-6`, dated haiku). Every versioned pin is now behind the current generation; prose in a1-new-feature/a1-fix hardcodes "Opus 4.7". → see ADR model-routing: **aliases only, versions nowhere**.

### A5 — Phantom agent names in shipped prompts (MED)
`Quak` (a1-fix, 3×) and `a1-verifier` (a1-phantom, 4×) don't exist; `code-simplifier` and `frontend-design` are unverified externals; first-name refs (`Walter`, `Bernd`) bypass the skills' own `*-link.md` indirection; a1-modernize mixes two link-file naming conventions.
**Resolution ▸** Sweep: full `a1-*` names everywhere; externals get availability-fallback lines.

### A6 — a1-modernize outside the learning loop (MED)
Only pipeline skill with no `_learning.md` and no retro block — it breaks the framework's own advertised invariant ("every run writes a retro"). Ironic given M5 validation just proved how much its runs teach.
**Resolution ▸** Add `_learning.md` + retro step in 07-publish.

### A7 — Language rules three-way split (MED)
3 skills mandate English UI, 6 mandate German, 1 defers to project, global CLAUDE.md says always German. M7 already caps translation scope — fold this decision in: **user-facing dialogue = German (global rule wins); file artifacts = English; SKILL descriptions = English-first with German trigger aliases.** Delete per-skill language rules.

### A8 — Redundancy clusters (LOW each, HIGH together)
Routing table ×4, learning-loop description ×5, vault-IA table ×3, isolation-gate text ×3 (verbatim), A1_VAULT_ROOT boilerplate ×6, commit conventions ×4. Every duplicate is a future contradiction (C1–C9 all began as copies).
**Resolution ▸** Constitution rule: each fact has ONE owner file; others link. Owners: routing → `rules/common/a1-framework.md`; isolation gate → `a1-worktree`; vault IA → `brain-ia.md`; commit → `git-workflow.md`; learning loop → `a1-evolve`.

## Part B — Framework Constitution (10 invariants, draft for adoption)

1. **One owner per fact.** Any rule stated in two files names its owner; the copy is a link.
2. **Every pipeline skill learns.** `_learning.md` + retro step are mandatory for any skill that orchestrates agents (checkpoint/progress exempt: no pipeline).
3. **Retros carry evidence.** `result:` must reference a verifiable artifact (VERIFICATION.md, commit, postmortem) — no evidence, no entry (feeds FMEA-3 fix).
4. **The optimizer reads everything.** No learning store outside a1-evolve's collect globs. New store ⇒ new glob, same commit.
5. **Agents are addressed by full name.** `a1-<vorname>-<rolle>` everywhere; no first-name shorthand in prompts; link-files follow one naming scheme.
6. **Model pins are aliases or absent.** `haiku|sonnet|opus` or inherit; versioned model IDs never appear in skills/agents/rules.
7. **Gates are registered.** A check that can block ships with: registry entry, deterministic exit semantics (or explicit prompt-gate label), and a retro attribution id (feeds gate-ROI).
8. **A gate that cannot fail is documentation.** Warning-only checks must say so; enforcement point named explicitly.
9. **Verification targets the spec.** Victor/Phase-6 verify spec ACs verbatim; plans are routes, not truth.
10. **German to Robert, English on disk.** Dialogue German; artifacts/commits/frontmatter English; triggers bilingual.

## Part C — Fix backlog (ordered, mostly mechanical → Opus-executable)
1. A1+A3: evolve input list + a1-fix→pattern bridge (small, high value)
2. A2: one-paragraph IA decision in rules + brain-ia.md
3. A5: dead-name sweep (Quak, a1-verifier, first-names, link naming)
4. A6: a1-modernize learning wiring
5. A4: alias-only model sweep (with ADR model-routing)
6. A7+A8: language rule consolidation + redundancy de-duplication (fold into M7 Wave 3 where files are already being touched)
7. Part B: adopt constitution as `docs/CONSTITUTION.md` after Robert's review, then wire into a1-evolve's propose-phase checks (evolve refuses diffs violating invariants).
