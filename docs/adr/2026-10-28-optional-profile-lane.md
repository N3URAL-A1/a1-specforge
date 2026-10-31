# ADR: `--profile kritis` as an optional lane — additive, guarded, fail-closed

**Date:** 2026-10-28 (written in wave 1 of spec 006) · **Status:** accepted · **Context:** Two spec engines coexist. `~/.claude/skills/specforge/SKILL.md` (measured 2026-10-27: 2,933 lines, sha256 `32026458dc537a78c2ab29e74af887a17dbc33b8bddb347311160d85beb86d54`, **not under git and not in this repo**) writes specs, and so does `a1-new-feature` with Rene. The overlap is about 6 of SpecForge's 9 modes. Its exclusive value is three building blocks plus one simulation: EARS (Anhang C, line 1432), the KRITIS/NIS2 NFR catalogue (Anhang D, 1597, 41 items), STRIDE (Anhang E, 1703, 42 items in 6 categories) and the stakeholder simulation (Modus 6, 692). The duplication costs two vocabularies (`spec.md`/`plan.md`/`tasks.md` vs. `###-slug.md` plus wave plans), two folder conventions, two learning loops, and 2.9k lines of skill text loaded on trigger words that also match a1's. Spec `006-specforge-kritis-profile` (vault `project/a1-specforge/spec/`) folds the three assets in as an opt-in profile. This ADR fixes the mechanism every later wave reads.

## Decision

### 1. Opt-in and additive only — one spec format stays
The profile adds **sections and gates** to a1's existing `###-slug.md` spec and its wave plan. It introduces no second spec format, no second folder convention and no second learning loop. That is the point: folding SpecForge in must *end* the duplication, not relocate it. Profile assets live in `_shared/profiles/kritis/` as data (templates, catalogues) that the existing pipeline reads; they are not a parallel pipeline. SpecForge's Anhänge G, H and I (folder convention, spec-first chain, enforcement engine) are therefore **superseded by pointer**, not migrated — a1 already has a storage convention, phases and deterministic gates. Modus 8 (management and traceability) is **not ported**: `product status`, `product markers` and N3URAL Brain cover it (FR-006).

Corollary for the additive sections: they must not invent an ID shape the existing gates cannot see. Gate 4.5 check #9 matches requirement IDs with `_shared/lib/check.cjs:19` `/\bFR-\d{3,}(?:-\d+)?\b/g`, which matches `FR-012` but returns `null` for `FR-NFR-003` (measured). Either the injected catalogue entries use an ID the live pattern matches, or the pattern is widened deliberately in the wave that injects them — silently adding invisible IDs is not an option.

### 2. Profile prose lives only in guarded blocks, and the guard is measured
Every profile addition to a prompt file sits between `<!-- a1-profile:kritis -->` and `<!-- /a1-profile:kritis -->`, and the first line inside each block is the fixed guard sentence ``**KRITIS profile only** — skip this block unless the run profile is `kritis`.`` A fixture helper strips the blocks and compares the remainder byte-for-byte with golden copies captured from the base commit with `git show "$GOLDEN_COMMIT":<path>`.

This turns FR-008 ("byte-identical without the profile") from a promise into a measurement. It is already built and green: suite `_test-fixtures/a1-kritis-profile/run-tests.sh` reports 35 passed / 0 failed, and a line inserted outside a block was verified to turn the prompt-golden case red. The stripper itself fails closed — an unbalanced, nested or unguarded block exits 2 and strips nothing, so a malformed marker can never produce a passing comparison.

Amendment 2026-10-30 (approved by Robert in the PR review of spec 006, spec FR-008 amended): the `profile resolve` step is the one sanctioned unguarded line. It decides the run profile, so it cannot sit inside a block whose guard says "skip unless kritis" — there it was unreachable without `--profile`, and FR-001's auto-enable from `index.json` or the constitution marker never fired. It is read-only, prints `profile: null` without a declaration, and stops the run only on an unknown `--profile` value (exit 1) or a broken or unreadable declaration or repo root (exit 2, §3). `_test-fixtures/a1-kritis-profile/golden/prompts.allowed-diff` is the enforced register of every line outside a block (today: the German alias line and the resolve line with its blank separator); the prompt-golden case compares against it, so any other unguarded edit stays red.

### 3. Fail-closed resolution with a fixed precedence
Precedence, resolved per run and never cached: **flag > spec frontmatter > `index.json` > constitution marker**. With no source the result is `profile: null`, exit 0, repo tree hash unchanged.

An unknown value never falls back to the normal pipeline. `--profile kritiss` exits 1 (usage); `profile: kritiss` in a file or `a1-profile: krits` in the constitution exits 2 and names the file. A broken `index.json` returns null in a normal project — as silent as today — but exits 2 when its raw text contains `"profile"`, so a project that *intended* a profile cannot lose it to a parse error. No heuristics: a SpecForge-format constitution without the explicit marker never enables the profile.

Why fail-open is unacceptable here specifically: in a regulated (NIS2/KRITIS) context the profile is what produces the threat model, the NFR coverage and the EARS-checkable requirements. A silent fallback would yield a spec that *looks* complete and passes the normal gates while the regulated evidence is simply absent — the failure is invisible at exactly the moment it matters, and discovered by an auditor rather than by CI. A stopped run costs one typo fix. A fail-open run costs the audit trail.

The last precedence rung is also a deliberate schema decision. `docs/product/index.schema.json` has `additionalProperties: false` at the root and in `project`, whose allowed keys are exactly `['id','title','status']` (measured). A profile in `index.json` is a schema violation **today**, so that rung exists only after a deliberate, reviewed schema addition — not as an undeclared key that happens to survive.

### 4. Blank slate is a flag, and its limits are stated
Under `kritis` the resolver sets `isolation: "blank_slate"` (Clarification 2026-10-27): no memories and no learnings are loaded into the run. What that **can** guarantee is a1-side: the pipeline does not feed its own learning store, retro corpus or project memory into a profiled run, and the resolver reports which sources it checked.

What it **cannot** guarantee: it is not a session sandbox. It does not clear a conversation already in progress, does not control what the operator pasted into the chat, does not reach context the host client injects (`CLAUDE.md`, user rules, MCP servers), and does not isolate a model provider's own caching. A clean-room run therefore needs a fresh session plus the flag; the flag alone is a loading policy, not an isolation boundary. Overclaiming it would be worse than not having it, because a regulated review would rely on a boundary that does not exist.

### 5. Provenance rests on a hash, so the source is archived hash-pinned
The source skill is not under git. Once the alias replaces it, the only provenance for the migration — which cites its line ranges — is the sha256 above. The old file is therefore kept as a hash-pinned archive, stored outside `~/.claude/skills/` so the retired skill cannot be re-discovered as an active one, and every migrated profile file opens with its `source: …@sha256:… lines <a>-<b>` header.

## Alternatives rejected

| Option | Why rejected |
|---|---|
| **Keep SpecForge as a separate skill** | Preserves exactly the cost that triggered the spec: two vocabularies, two folder conventions, two learning loops, 2.9k lines competing for the same trigger words. The duplication, not the content, is the defect. |
| **Hard fork the pipeline for regulated projects** | Two pipelines means every a1 gate, agent and fixture is maintained twice and drifts — and the regulated copy, used least often, drifts first. It also makes "unchanged without the profile" unprovable, because there is no single artifact left to compare. |
| **Make the profile always-on** | EARS, STRIDE and a 41-item NFR catalogue on every N3URAL feature is governance overhead with no regulator behind it, and it breaks FR-008 by construction: there would be no no-profile behaviour left to keep byte-identical. |
| **Second spec format alongside a1's** | A format is a vocabulary; a second one re-splits specs, tooling and gates. The three exclusive assets are *content*, and content fits into additive sections of one format. |
| **Resolve the profile from heuristics** (SpecForge-shaped constitution, folder names, keywords) | Guessing a regulated mode is both directions wrong: a false negative drops the evidence silently, a false positive imposes it. Only an explicit declaration enables the lane. |

## Consequences
+ "Unchanged without the profile" is a byte comparison against the base commit, not a claim — and a prompt edit outside a guarded block is CI-red unless it is listed in `prompts.allowed-diff` (see the §2 amendment).
+ A typo in a profile declaration stops the run instead of quietly producing an unregulated spec.
+ One spec format, one set of gates, one learning loop; the KRITIS lane is data plus guarded prose, so a1 changes do not have to be ported twice.
− Prompt files carry marker comments and a repeated guard sentence. That is visible noise in exchange for a measurable baseline, and it is the only way the strip-and-compare test can exist.
− Profile prose must stay inside its block. Wiring the lane in wave 8 touches every prompt file, so a careless edit is the most likely way to turn the golden red; the measurement catches it, but the rework is on the author.
− `index.json` as a profile source requires a schema change (`additionalProperties: false`), which must ship with the rung, not after it.
− The blank-slate flag is honest about covering only a1-side loading. Clean-room expectations beyond that need an operator step this spec does not provide.

## Handoff
Implementation is not this ADR's scope. The resolver, schema and persistence go to `a1-erik-executor` / `a1-walter-web-developer` in wave 2; the checkers in waves 3 to 6; the alias and hash-pinned installer in wave 7; the guarded prompt wiring, gate registration and end-to-end audit in wave 8. The gate rows the lane adds must appear in `_shared/gates-registry.md` with their `invoke` cell, per the wiring contract of 2026-10-14.
