---
phase: M11-audit-fixes
generated: 2026-07-12
based_on: .a1/phases/M11-audit-fixes/PLAN.md (draft, 7 waves, sourced from 3 parallel audit surveys 2026-07-12)
verified_against: HEAD 7217d29
---

# Research: M11-audit-fixes

## 1. Tech stack (unchanged by this phase — context only)

- **Runtime:** Node.js ≥ 18, zero npm dependencies. Single CLI facade `_shared/a1-tools.cjs`
  dispatches into `_shared/lib/{io,locks,worktree-registry,product,constitution,...}.cjs`
  (module-split completed in M10, facade now 561 lines, was 7196).
- **No package.json, no build step, no TypeScript.** Everything is CommonJS `.cjs` + Markdown.
- **Install mechanism:** `bin/install.sh` — pure bash, symlinks `skills/<name>/` →
  `~/.claude/skills/<name>/` and `agents/<name>.md` → `~/.claude/agents/<name>.md`, plus one
  `_shared` → `~/.claude/skills/_shared` symlink. Idempotent (`symlink_item()` checks `-L`
  before acting), no external calls, no npm install.
- **Alternate install path (README-documented, NOT touched by install.sh):** Claude Code
  plugin marketplace via `.claude-plugin/marketplace.json` + `plugin.json`. Verified: neither
  file hardcodes skill/agent counts or names — they reference `"source": "./"` (whole repo).
  **This means the plugin path is immune to the count-drift class of bug** (Wave 1's root
  cause) but a symlink-only assumption anywhere in agent/skill bodies (e.g. Victor's
  `~/.claude/skills/_shared/a1-tools.cjs`) *does* break under plugin install, since a plugin
  install does not guarantee that literal path. Confirms Task 4.2's premise independently.
- **CI:** single workflow `.github/workflows/test.yml`, 4 steps — syntax check, fixture
  suites (`_test-fixtures/*/run*.sh` + one nested schema-check parser), install smoke test
  (fresh `$HOME`, asserts 3 specific symlinks exist/don't exist), vault-free CLI check
  (`A1_VAULT_ROOT` unset, asserts repo-local `.a1/learnings/` tier activates). **No step
  currently asserts skill/agent set completeness or install↔README parity** — confirms
  Wave 2's premise: the README's "bijective install/README check" claim (README.md:13,
  in an HTML comment) describes a check that does not exist anywhere in `bin/` or `.github/`.

## 2. Repository ground truth (measured 2026-07-12, HEAD 7217d29)

| Set | Actual count | Actual members |
|---|---|---|
| `agents/*.md` | **21** | 18 original + `a1-samuel-security`, `a1-diana-docs`, `a1-dario-devops` (added commit `2f22541`, never wired into install.sh or README) |
| `bin/install.sh` AGENTS array | **18** | missing the 3 above — confirms Wave 1's BLOCKER |
| README.md "Agents (18)" table | **18 rows** | same gap, plus the heading itself says 18 |
| `skills/*/` directories | **18** | 17 installed (`SKILLS` array in install.sh) + `hero-animation-builder` (deliberately excluded, no exclusion-list file exists yet) |
| `bin/install.sh` SKILLS array | **17** | matches README "Skills (17)" heading and table row count — **this side is currently in sync**, only the agents side drifted |
| `_shared/language-policy.md` | **does not exist** | confirmed via `test -f` — Task 3.1 creates a new file, not an edit |
| `bin/verify-install-sync.sh` | **does not exist** | Task 2.1 creates a new file |
| `bin/install-exclusions.txt` | **does not exist** | Task 1.3 creates a new file |
| `_test-fixtures/install-sync/` | **does not exist** | Task 2.2 creates a new fixture suite |

**Correction to PLAN.md wording:** the plan's SC-1 talks about "21 agents" as the fresh-install
target and Wave-1 evidence is accurate; but note the *skills* side (17 installed, 1 deliberately
excluded) is currently consistent and must **stay** that way through this phase — Wave 1/2 must
not accidentally touch the SKILLS array while fixing AGENTS.

## 3. `_test-fixtures/CONVENTIONS.md` — fixture-suite contract (binding for Waves 2 and any new suite)

Read in full; key constraints for Task 2.2 (`_test-fixtures/install-sync/`) and Task 2.4:

- **Runner filename standard:** `run-tests.sh`, glob-matched by CI as `run*.sh`. The
  CONVENTIONS.md file **explicitly claims this was unified 2026-07-12** ("the historical mix
  of `run.sh` / `run-test.sh` / `run-tests.sh` was unified 2026-07-12").
  **Verified false as of HEAD 7217d29:** `_test-fixtures/a1-cmd-injection/run.sh` is the only
  holdout — all other 21 suites already use `run-tests.sh`. Task 2.4 must resolve this one
  file, either by renaming it (preferred — matches every other suite, keeps the CONVENTIONS.md
  claim true retroactively) or by softening the CONVENTIONS.md claim. **Recommendation:
  rename** — it is a 1-file, low-risk change and the CI glob `run*.sh` matches either name so
  CI is unaffected either way; renaming is strictly the smaller diff and removes the
  inconsistency instead of documenting it.
- **Runner pattern:** `set -u`, `pass=0 fail=0` counters, `assert_rc`/`assert_true` helpers
  printing `PASS`/`FAIL  <name>`, final two lines are a summary echo + `[[ $fail -eq 0 ]]`
  (this is the script's exit code). New `install-sync/run-tests.sh` must follow this exactly.
- **Isolation:** all mutable state in `mktemp -d`, never write into the repo tree or a fixed
  path; CI additionally runs with `HOME=$(mktemp -d)`. For `install-sync/run-tests.sh` this
  means: **do not run `bin/verify-install-sync.sh` against the live repo state for the seeded
  drift cases** — copy the repo's relevant lists (skills dirs, install.sh arrays, README
  tables) into a temp dir, mutate the copies, and point the checker at the copies. (Task 2.2's
  own wording — "copies repo lists into a temp dir" — already reflects this; confirmed
  correct against CONVENTIONS.md.)
- **JSON assertions via `node -e`, not shell string matching** — not directly relevant here
  since install-sync parsing is plain-text list diffing, not JSON, but worth flagging if the
  checker script ever needs to parse install.sh arrays: prefer a simple bash array literal
  parse (grep between markers) over anything more clever, consistent with the rest of `bin/`.
- **Mandatory "Hostile inputs" section:** path traversal, injection-shaped input, oversized
  values (≥10 000 chars) — PLAN.md Task 2.2 already names "dir name with spaces/newline,
  oversized exclusion file" as the two hostile cases for this suite. That satisfies (a)-ish
  (traversal-adjacent) and (c) directly; **(b) injection-shaped input has no obvious analog
  for a list-diffing checker** (no shell-evaluated input) — recommend documenting *why* (b) is
  N/A in the suite's own hostile-input section rather than silently omitting it, so a future
  reader doesn't flag it as a gap.
- **Reference style example:** `_test-fixtures/product-docs/run-tests.sh:820-871` (stale-lock
  cases) is cited as the house style for edge-case coverage — worth a skim before writing
  Task 2.2, not required reading for RESEARCH purposes.

## 4. `_shared/` CLI patterns relevant to this phase

- `_shared/a1-tools.cjs` is the single dispatcher; `node --check _shared/a1-tools.cjs` is the
  CI syntax gate (step 1) and the plan's own regression-gate snippet. **This phase does not
  touch `_shared/*.cjs` at all** (explicitly out of scope in PLAN.md and confirmed: no task
  references editing `_shared/a1-tools.cjs` or `_shared/lib/`). `bin/verify-install-sync.sh`
  (Task 2.1) is a **new standalone bash script**, not a CLI subcommand — this is the right
  call: it needs zero business logic, just three set-diffs, and adding it as a `.cjs`
  subcommand would be scope creep into the frozen CLI.
- `_shared/learning-schema.md` documents `_learning.md` living at
  `~/.claude/skills/<skill-name>/_learning.md` — this is a **legitimate** hardcoded-looking
  path, not a Task 4.2 target: `_learning.md` is explicitly a per-installation cache (the
  canonical store is the learning-store 3-tier resolution, `_learning.md` is documented
  elsewhere as "fast-access cache"). Confirmed by grep: 27 files under `skills/` reference
  `~/.claude/skills/` and on inspection every sample is either (a) a `_learning.md` cache
  path (`cat >> ~/.claude/skills/a1-check/_learning.md`) or (b) a pointer to another
  *installed* skill (`n3urala1-design` at `~/.claude/skills/n3urala1-design`) — both are
  correct as written, since skills genuinely do live there post-install regardless of
  symlink-vs-plugin mechanism (plugin installs also materialize skill dirs under a resolved
  skills path at runtime). **Task 4.2's scope ("Sweep the other 20 agent files") is correctly
  narrow** — do not expand it to `skills/*/` bodies; the actual bug class is specifically
  *executable CLI invocation paths inside agent prompts* pointing at `_shared/a1-tools.cjs`,
  where `agents/` (unlike `skills/`) has no reason to assume `~/.claude/skills/` at all since
  agents are symlinked to `~/.claude/agents/`, a sibling directory — the `_shared` path only
  resolves by accident of the skills-dir symlink existing.
- Confirmed 4 real hits in `agents/` for `~/.claude/skills`:
  1. `agents/a1-victor-verifier.md:94` — `node ~/.claude/skills/_shared/a1-tools.cjs phantom check ...` (Task 4.2 primary target)
  2. `agents/a1-victor-verifier.md:157` — `node ~/.claude/skills/_shared/a1-tools.cjs cost run ...` (Task 4.2 primary target)
  3. `agents/a1-reinhard-reviewer.md:51` — `ls ~/.claude/skills/ 2>/dev/null` — this one is a **legitimate registry enumeration** (Reinhard is listing installed skills to check for a relevant one), matches PLAN.md's own carve-out ("deliberate references to the *skills registry concept*"). Leave as-is.
  4. `agents/a1-ludwig-legal.md:73` — `Glob: ./**/SKILL.md  ~/.claude/skills/**/SKILL.md` — also a registry-enumeration glob pattern (searching both local and global skill locations), same carve-out as #3. Leave as-is.
  - **Net: Task 4.2's actual mechanical work is exactly 2 line-edits** (Victor 94, 157), replacing them with a repo-relative resolution. The "sweep the other 20" instruction should confirm zero *additional* executable-path hits exist (it does — verified above) and explicitly document #3/#4 as intentionally-kept registry references in the commit body, so a future auditor doesn't re-flag them.
- **Repo-relative resolution pattern to copy:** newer agents (Samuel, Diana, Dario) do not
  invoke `a1-tools.cjs` directly at all (grep for `a1-tools.cjs` in their files returns
  nothing), so there is **no existing repo-relative invocation example among agent files** to
  copy verbatim. The nearest convention is skills' own workflow files, which invoke it as
  `node _shared/a1-tools.cjs ...` (relative to repo root, since skills execute with the repo
  as cwd via the symlink target). For Victor — an agent, not a skill — the safest resolution
  given no cwd guarantee is a small discovery snippet (e.g. check `$CLAUDE_PROJECT_DIR` env
  var or fall back to walking up from cwd for a `_shared/a1-tools.cjs` marker) rather than a
  bare relative path, since agents may be invoked with an unpredictable cwd. **Flag this as a
  design decision for the plan/audit step**, not a mechanical one — Task 4.2 as currently
  worded ("resolve repo-relative... same convention as skills'") may need one extra sentence
  specifying the actual resolution snippet so the executor doesn't have to invent one.

## 5. Agent frontmatter format — full survey (all 21 files)

`tools:` field, verified by grep across all 21 agent files:

| Format | Count | Files |
|---|---|---|
| CSV (bare, unquoted, comma-space) | 13 | adam-auditor, alex-architekt, erik-executor, ludwig-legal, marco-mapper, pablo-planner, rafael-reverse-spec, rene-requirement-engineer, rico-researcher, theo-test-engineer, uwe-ux-expert, victor-verifier, vincente-vibe-optimizer |
| YAML array (bracketed) | 6 | dario-devops, diana-docs, falk-fault-finder, reinhard-reviewer, samuel-security, tobi-tester |
| **Missing entirely** | 2 | **aik-ai-engineer, walter-web-developer** — confirmed via grep, both silently inherit all tools |

This matches PLAN.md's Wave 5 evidence exactly (13 CSV / 6 array / 2 missing = 21 total).
**Note the pattern:** all 3 newest agents (samuel, diana, dario, added in `2f22541`) use the
bracketed array format — this is the newer convention. Recommend Task 5.1 standardize on
**bracketed YAML array** (not CSV) as the target format, since that's what the most recent
agents already use and what a strict YAML parser would produce if this frontmatter were ever
machine-validated (bare CSV after `tools:` is technically a YAML scalar string, not a list —
bracketed is the only form that is unambiguously a YAML sequence).

`model: opus` pins, verified: 4 total — `a1-reinhard-reviewer` (justified inline),
`a1-falk-fault-finder` (justified inline), `a1-samuel-security` (justified inline),
`a1-alex-architekt` (**bare `model: opus`, no comment** — confirmed, line 5, Task 5.2's sole
target). Matches PLAN.md exactly.

Delegation-table format, verified for the 4 named agents:

| Agent | Current format | Matches PLAN.md claim? |
|---|---|---|
| `a1-rafael-reverse-spec` | **Already a `\| Task \| Owner \|` table** | No — plan groups Rafael with the bullet-list agents, but Rafael is actually already in the target format. Only 3 of the 4 need conversion. |
| `a1-rico-researcher` | Bullet list (`- X → Y`) | Yes, needs conversion |
| `a1-marco-mapper` | Bullet list (`- X → Y`) | Yes, needs conversion |
| `a1-pablo-planner` | Bullet list (`- X → Y`) | Yes, needs conversion |

**Correction for the plan:** Task 5.3's actual mechanical scope is **3 agents** (Rico, Marco,
Pablo), not 4 — Rafael is already compliant and should be the copy-paste template for the
other three's conversion (its table has the exact `| Task | Owner |` header the other 20
agents use). Low-risk, content-preserving; the "Done when" grep (`all 21 present as a table`)
is still correct as the completion check, it will just show 21/21 with only 3 edits instead of 4.

## 6. Language-policy contradiction — precise site inventory

Verified via `grep -rn "in German\|auf Deutsch\|in English" skills/*/SKILL.md skills/*/workflows/*.md`:

| Site | Text |
|---|---|
| `a1-constitution/SKILL.md:154` | "...references) stays in English." |
| `a1-analyze/SKILL.md:187` | "(frontmatter, findings, code refs) stays in English." |
| `a1-fix/SKILL.md:216` | "User-facing prompts and questions in **German**. File content stays in English." (dual marker — one line) |
| `a1-new-project/SKILL.md:159` | "All file artifacts (scope, backlog, frontmatter) stay in English." |
| `a1-modernize/SKILL.md:186` | "User-facing prompts and questions in German. File content ... in English." (dual marker) |
| `a1-reconcile/SKILL.md:176` | "...stays in English." |
| `a1-worktree/SKILL.md:126` | "...stays in English." |
| `a1-new-feature/workflows/02-specify.md:24` | "(in English — the output is a technical artifact)" — **artifact-scoped, arguably fine to keep as-is per the new policy's own artifact rule**, but should still point at the shared file for consistency. |
| `a1-new-project/workflows/02-scope.md:12` | "All user-facing text in German." |
| **`a1-check/SKILL.md:29`** | "Language: English-first; German trigger aliases supported." |
| **`a1-check/SKILL.md:100`** | "User-facing output (PASS/FAIL summary...) is in **German**." |

**Confirms PLAN.md's self-contradiction claim exactly**: `a1-check` states "English-first"
at line 29 and then mandates German user-output at line 100 — these are two different claims
in the same file (line 29 is about the skill's own written language / trigger-alias policy,
line 100 is a specific runtime behavior instruction) but read as contradictory to anyone
skimming the file, and functionally they *are* in tension with a policy that says
"conversation output = user's language" (hardcoding German is wrong regardless of which of
the two lines "wins"). Also found beyond PLAN.md's explicit list:
`a1-new-project/workflows/02-scope.md:12` and `a1-new-feature/workflows/02-specify.md:24` —
recommend Task 3.2's sweep grep command be run as the actual completion gate (it already is,
per PLAN.md's Done-when clause) rather than relying on the enumerated list, since the
enumerated list is not fully exhaustive of workflow files.

## 7. Storage prose ("Obsidian Vault" as default) — full site inventory

Verified via `grep -rln "Obsidian Vault" skills/`: **11 files**, not the 3 named in PLAN.md's
Wave 4 basis line (a1-fix:7, a1-analyze:120, a1-new-feature:274 — those 3 are real and
present). Full list:

| File | Lines | Note |
|---|---|---|
| `a1-new-feature/SKILL.md` | 7, 274 | frontmatter-state description + Storage section |
| `a1-evolve/workflows/01-collect.md` | 7 | "Read from Obsidian Vault (primary — the brain)" |
| `a1-evolve/workflows/04-apply.md` | 26, 49 | "Update Obsidian Vault — patterns.md (primary)"; code-comment "canonical is Obsidian Vault" |
| `a1-modernize/SKILL.md` | 11, 153 | frontmatter-state description + Storage section |
| `a1-reconcile/SKILL.md` | 10, 128 | frontmatter-state description + Storage section |
| `a1-check/SKILL.md` | 38 | "Both files must already exist on disk under the Obsidian Vault paths" |
| `a1-check/workflows/01-run-check.md` | 13 | "`<project-slug>` — the Obsidian Vault project folder name" |
| `a1-execute/SKILL.md` | 11 | "writes a Retro to the Obsidian Vault" |
| `a1-fix/_learning.md` | 3 | "Canonical source: `wiki/postmortems/` in Obsidian Vault" |
| `a1-fix/SKILL.md` | 7, 14 | frontmatter-state description + Postmortem destination |
| `a1-analyze/SKILL.md` | 8, 25, 120 | frontmatter-state description, Retro destination, Storage section |

**Scope correction for Task 4.1:** the task's own "Done when" clause already says to sweep
beyond the 3 named sites (`grep -rn "Obsidian Vault" skills/`), so this is not a plan defect —
just confirming the real count is 11 files / ~15 lines, meaningfully more mechanical work than
the basis paragraph implies at a glance. Two of these are **not** SKILL.md Storage sections
but architectural framing in `a1-evolve`'s workflow files (Vault as "primary... the brain") —
those need judgment, not pure find-replace: per `_shared/learning-schema.md`'s own accurate
3-tier description (env > repo-local > legacy-vault-if-no-git-repo), the Vault is a *fallback*
sink today, not the primary. `a1-evolve/workflows/01-collect.md:7`'s heading "primary — the
brain" is the most stale of all 11 sites and should get explicit attention, not just a
word-swap. `a1-fix/_learning.md:3` is a **generated cache file** (per its own header, "Fast
access cache") — check whether it's regenerated on every run (in which case editing it by hand
is a wasted no-op) or hand-maintained before editing it in Task 4.1.

## 8. Learning-loop coverage — verified retro/learning presence

Grep for "Retro"/"learning" is a weak signal (matches prose mentioning "self-learning loop" as
a concept, not just actual Retro *sections*). Verified precisely by searching for an actual
`## Retro` (or equivalent) heading:

- **Confirmed present:** a1-execute, a1-analyze, a1-fix, a1-new-feature, a1-new-project,
  a1-checklist (per PLAN.md, "a1-checklist has one already"), a1-evolve (self-referential,
  writes about its own process not a retro of itself), a1-check (has language/policy prose but
  is a deterministic gate — no retro expected, consistent with Wave 6's framing).
- **Confirmed absent** (grep for `^## Retro` returns nothing): **a1-plan, a1-roadmap,
  a1-reconcile, a1-modernize, a1-constitution** — exactly the 5 named in PLAN.md Task 6.1.
  These 5 do mention "Obsidian Vault" / "learning" in passing prose (which is why the loose
  grep in section 7 above showed hits for a1-reconcile, a1-modernize, a1-constitution,
  a1-roadmap) but none has an actual structured Retro block. Confirms Task 6.1's target list
  is accurate and complete.
- **Confirmed absent by design** (gates/reporters, no LLM judgment): a1-phantom, a1-pr-review,
  a1-progress, a1-worktree — matches Task 6.2's framing that these are deliberately excluded.
  Note a1-check also fits this "no LLM judgment" bucket (already listed above).
- `a1-evolve/SKILL.md`'s "Input sources" table (lines ~48-56) is the authoritative list of what
  a1-evolve actually reads — it currently names 4 generic *source types* (per-skill
  `_learning.md`, `observations.jsonl`, the canonical learning store, a1-fix postmortems), not
  an explicit skill-by-skill enumeration. Task 6.2 asks a1-evolve to "name the exact
  learning-enabled skill set" — this requires adding a concrete list (the skills confirmed
  present above) somewhere near this table, plus a one-line explanation of why gates/reporters
  are excluded. This is a documentation addition, not a behavior change — a1-evolve's actual
  collection mechanism (glob over `_learning.md` files) already only picks up files that exist,
  so it is not literally claiming to read all 18 today; the honesty gap is in the *prose*
  ("Philosophy" section) implying broader coverage than exists, not in the collect logic itself.

## 9. Risks specific to this phase

1. **Fresh-install path is CI-gated and easy to break silently.** The install smoke test in
   `.github/workflows/test.yml` only asserts 3 specific symlinks (`a1-new-feature`, `_shared`,
   negative-check on `checkpoint`) — it does **not** count agents or assert the samuel/diana/
   dario symlinks exist. This means **Wave 1 alone does not add CI coverage for its own fix** —
   Wave 2's drift gate is what actually prevents regression, confirming the plan's own
   dependency ordering (Wave 1 → Wave 2) is correct and necessary, not just nice-to-have
   sequencing. Recommend the install smoke test step also gain one assertion
   (`test -L "$HOME/.claude/agents/a1-samuel-security"` or count-based) as a second, redundant
   layer even after `verify-install-sync.sh` exists — belt-and-suspenders, since the smoke test
   step and the sync-check step test different things (symlink creation vs. list membership).
2. **README HTML-comment scope note (README.md:12-21) is itself a drift-prone artifact.** It
   hardcodes "17 skills + 18 agent names" inside a comment that exists specifically to keep the
   bijective check "honest" — but nothing currently parses or validates that comment. Task 1.2
   updates it to match the new counts; Task 2.1's sync checker should ideally also validate
   this comment's claimed counts against reality (or the comment becomes exactly the kind of
   stale claim this whole phase exists to close). Not in PLAN.md today — flag for
   plan refinement, low effort to add as a 4th assertion in `verify-install-sync.sh`.
3. **`bin/install-exclusions.txt` (Task 1.3) must be consumed by `verify-install-sync.sh`
   (Wave 2), meaning Task 1.3's file format needs to be decided with Wave 2's parser in mind.**
   Recommend one-entry-per-line, `<name>: <reason>` format (matches the plan's own description)
   and keep it trivially parseable (`cut -d: -f1`) so Wave 2 doesn't need anything beyond basic
   shell. This is a cross-wave coupling worth calling out explicitly in the plan so Task 1.3
   and Task 2.1 aren't executed by two different people with two different assumed formats.
4. **Wave 3/4 sweep-and-replace tasks touch every SKILL.md** — 18 files for language policy,
   11 for storage prose (2 overlap: a1-analyze, a1-fix, a1-reconcile appear in both sweeps).
   Recommend one commit per *sweep*, not per file (PLAN.md's "one commit per task" rule already
   implies this — Task 3.2 is one task covering 9+ files, Task 4.1 is one task covering 11
   files), otherwise Wave 3+4 alone could produce 20+ commits, which is excessive per-task
   granularity for pure find-replace edits. No plan change needed, just confirming the
   commit-per-task rule already handles this correctly.
5. **Task 4.2's Victor fix touches the only agent file with real executable hardcoded paths** —
   low blast radius (2 lines) but the resolution mechanism (repo-relative discovery from
   unpredictable cwd) is a genuine design decision, not pure mechanics (see section 4 above).
   Recommend the plan gain one clarifying sentence on the exact snippet before Wave 4 executes,
   to avoid an executor inventing a fragile ad-hoc solution (e.g. blind `../../..` relative
   paths that break if Victor is invoked from a different depth).
6. **CI has no step measuring "no behavior change to the CLI"** beyond `node --check` (syntax
   only) and the fixture suites (which only cover `_shared/a1-tools.cjs` subcommands, not
   agent/skill prose). Since every task in this phase explicitly avoids touching `_shared/*.cjs`,
   the existing fixture suites are a sufficient regression gate for the "no CLI behavior change"
   ground rule — no new fixture is needed purely for that rule; Wave 2's new fixture suite
   (`install-sync/`) is needed for a different reason (asserting the new sync-check script's own
   correctness), which the plan already scopes correctly.
7. **Wave 7 decision docs are the only non-mechanical output of this phase** — verified they
   carry no execution risk (STOP-gated, no auto-apply) but their *content quality* depends on
   Waves 1-6 already being merged (e.g., Task 7.4's Marco haiku-pin note depends on Task 4.3
   having been done first, per the plan's own dependency graph). No new risk found beyond what
   PLAN.md's "Dependencies" section already states.

## 10. Structural consolidation candidates — supporting evidence for Wave 7

Verified counts/usage for Task 7.4's candidates (spawned-by greps):

- **`a1-theo-test-engineer`:** `grep -rl "a1-theo-test-engineer" skills/` → only
  `a1-modernize` (Phase 6, per PLAN.md). Confirms single-caller claim.
- **`a1-rafael-reverse-spec`:** `grep -rl "a1-rafael-reverse-spec" skills/` → only
  `a1-modernize` (Phase 2, per PLAN.md). Confirms single-caller claim.
- **`a1-diana-docs`:** newest agent (added `2f22541`), not yet wired into install.sh (Wave 1
  fixes that) — but also not yet referenced by name as "spawned by" in any SKILL.md, matching
  "thin usage path." Once Wave 1 lands, Diana becomes installable but still has no automatic
  spawn point — worth noting in the Wave 7 decision doc as context (is Diana meant to be
  invoked directly by the user, or should some skill spawn her? Currently neither skills nor
  the agent file itself resolves this ambiguity).
- **`a1-ludwig-legal`:** exists alongside an installed `legal` Claude Code plugin (visible in
  this session's available skills list: `legal:brief`, `legal:compliance-check`,
  `legal:review-contract`, etc.) — supports PLAN.md's "largely duplicates the installed legal
  plugin" claim; worth Task 7.4 explicitly diffing Ludwig's unique value-add (GDPR/EU-AI-Act
  specificity) against the plugin's generic contract/compliance tools before recommending
  drop vs. keep.
- **`hero-animation-builder`:** confirmed 56 lines, no `workflows/` subdirectory (has
  `references/` and `scripts/` instead — a genuinely different, simpler internal structure
  than every other skill), not in install.sh SKILLS array, not in README's skill table. It IS
  in the global skill-availability list surfaced to this session (confirms it's usable via a
  different install mechanism — likely a separate/manual symlink or its own listing — outside
  this repo's own install.sh path). This is consistent with PLAN.md's framing that it
  "follows no a1 convention" — genuinely structurally different, not just uninstalled.

---

## Summary of corrections/refinements for the planning step

1. **SC-1 evidence stands** (18→21 agents), but the **skills side (17) is currently in sync**
   and must not regress while Wave 1/2 fix the agents side.
2. **Task 2.4:** only 1 file needs renaming (`a1-cmd-injection/run.sh`), not a broader cleanup —
   rename is the recommended resolution (smaller diff, makes CONVENTIONS.md's claim true).
3. **Task 4.1:** real site count is 11 files (not 3) — task's own sweep grep already covers
   this correctly, just flagging the basis paragraph undersells the mechanical scope. Two sites
   in `a1-evolve/workflows/` need judgment (Vault reframed from "primary" to "fallback sink"),
   not pure word-swap.
4. **Task 4.2:** exactly 2 real executable-path hits (Victor:94, Victor:157); 2 additional
   `~/.claude/skills` hits in agents/ (Reinhard:51, Ludwig:73) are legitimate registry-glob
   references and should be explicitly left alone (document in commit body). Resolution
   mechanism needs one more sentence of design specificity (cwd-independent discovery, not a
   bare relative path) before execution.
5. **Task 5.1:** recommend the target format be the **bracketed YAML array** (matches the 3
   newest agents already using it), not left ambiguous between CSV/array.
6. **Task 5.3:** only 3 agents need conversion (Rico, Marco, Pablo) — Rafael already uses the
   target table format and should be the copy-paste template.
7. **Task 6.2:** the honesty gap is in a1-evolve's "Philosophy" prose framing, not its actual
   collect-phase mechanics (which already only globs existing files) — the fix is additive
   documentation (name the explicit skill set + exclusion rationale), no logic change needed.
8. No additional drift source found in `.claude-plugin/marketplace.json`/`plugin.json` — both
   are count-agnostic, out of scope for this phase, no new task needed.
9. **New cross-wave coupling to make explicit in the plan:** Task 1.3's exclusion-file format
   must be decided jointly with Task 2.1's parser (recommend `<name>: <reason>` one-per-line).
10. **New optional hardening (not currently in plan, low-cost):** extend the install smoke-test
    CI step with a direct symlink assertion for one of the 3 new agents, as a second
    independent layer alongside the new `verify-install-sync.sh` step.
