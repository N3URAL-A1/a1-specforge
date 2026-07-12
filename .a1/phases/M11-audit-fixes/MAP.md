---
phase: M11-audit-fixes
generated: 2026-07-12
based_on: .a1/phases/M11-audit-fixes/RESEARCH.md
verified_against: HEAD 7217d29 (working tree clean)
focus: all (tech + arch + quality + concerns), scope-narrowed to bin/install.sh, README.md,
  .github/workflows/test.yml, _test-fixtures/ (conventions + runner naming),
  skills/*/SKILL.md (language-policy + storage-prose + retro-block sites),
  agents/*.md (frontmatter formats, hardcoded paths, opus pins)
---

# Map: M11-audit-fixes

Every fact below was independently re-verified against the live tree (not copied from
RESEARCH.md) — all figures match RESEARCH.md exactly; no new discrepancy found. Where this
file adds detail beyond RESEARCH.md, it's marked **[MAP-new]**.

## 1. Structural inventory (ground truth, re-verified)

| Set | Path | Count | Detail |
|---|---|---|---|
| Agent files | `agents/*.md` | **21** | 18 original + samuel-security, diana-docs, dario-devops (commit `2f22541`) |
| Skill dirs | `skills/*/` | **18** | 17 installed + `hero-animation-builder` (excluded, no exclusion-file yet) |
| `install.sh` AGENTS array | `bin/install.sh:67-86` | **18** | missing samuel/diana/dario |
| `install.sh` SKILLS array | `bin/install.sh:38-56` | **17** | in sync — do not touch while fixing agents |
| README "Agents (18)" | `README.md:81-104` | 18 rows | same gap as install.sh, heading included |
| README "Skills (17)" | `README.md:57-79` | 17 rows | in sync |
| Fixture suites | `_test-fixtures/*/run*.sh` | **22 dirs** | 21 use `run-tests.sh`, 1 (`a1-cmd-injection`) uses `run.sh` |
| `_shared/*.cjs` total | — | 561-line facade + `lib/` modules | **out of scope this phase**, zero tasks touch it |

Files this phase creates (confirmed absent on disk, `test -f`/`test -d` all negative):
`_shared/language-policy.md`, `bin/verify-install-sync.sh`, `bin/install-exclusions.txt`,
`_test-fixtures/install-sync/`.

## 1a. Agent-drift severity — functional, not cosmetic **[MAP-new, via tooling-survey]**

Two facts sharpen the SC-1 finding from "count mismatch" to "active breakage on fresh
install":

- **The drift violates the README's own stated bijective check.** `README.md:12-21` (HTML
  comment) explicitly frames `bin/install.sh` as the single source of truth and claims the
  README names "exactly that set" — but both sides are stale in the same direction (both
  missing samuel/diana/dario), so the very check the comment describes is currently failing
  silently with nothing to catch it.
- **4 skills reference the 3 missing agents by name**, confirmed via
  `grep -rln "a1-samuel-security\|a1-diana-docs\|a1-dario-devops" skills/`:
  `a1-new-feature/SKILL.md`, `a1-new-feature/workflows/04-plan.md`,
  `a1-new-feature/workflows/05-implement.md`, `a1-fix/workflows/02-diagnose.md`,
  `a1-analyze/SKILL.md`, `a1-analyze/workflows/03-analyze.md`. Notably, `a1-analyze` spawns
  `a1-samuel-security` as an **always-on security lane** (per its own description) — on a
  fresh `./bin/install.sh` install (no `agents/a1-samuel-security.md` symlink materializes),
  that lane's spawn target does not exist. This elevates Wave 1 from a cosmetic/documentation
  fix to a functional-breakage fix for any user who installed before commit `2f22541` was
  wired in.

## 2. `bin/install.sh` — 95 lines, full structure

```
1-17   header, REPO_DIR/SKILLS_DIR/AGENTS_DIR resolution, mkdir -p
19-35  symlink_item() — idempotent via `[ -L "$dst" ]` check, backs up non-symlink existing
       targets to `${dst}.bak`
38-56  SKILLS array (17 entries)         ← Task 1.1 target: do NOT modify
59-61  skills symlink loop
64     _shared symlink (single line, not array-driven)
67-86  AGENTS array (18 entries)         ← Task 1.1/1.2 target: append 3 missing names
89-92  agents symlink loop
94-95  final echo
```

**[MAP-new]** The AGENTS array is declared with one name per line, alphabetically-ish but not
strictly sorted (rico, pablo, erik, victor, marco, adam, alex, falk, rene, reinhard, walter,
aik, vincente, tobi, uwe, ludwig, rafael, theo — roughly grouped by pipeline role, not name).
Appending samuel/diana/dario at the end (after theo, line 86) is the lowest-risk insertion
point — preserves existing diff-friendliness, no reordering needed. The **exclusion
mechanism** (Task 1.3, `bin/install-exclusions.txt`) has no existing analog in this script —
it is purely additive; nothing currently reads an exclusions file. Skills array has zero
excluded-entries handling either (hero-animation-builder is just absent from the array, no
comment explaining why) — **[MAP-new]** this asymmetry (skills exclude by silent omission,
agents will exclude by file) means Task 1.3's exclusion file needs to also cover
`hero-animation-builder` for the *skills* side if `verify-install-sync.sh` is meant to
validate both sets symmetrically. Confirm with PLAN.md whether Wave 2's checker validates
only agents or both sets — RESEARCH.md section 9.3 implies both list types share one
exclusion file format.

## 3. `.github/workflows/test.yml` — 43 lines, 4 steps

```
15-16  Syntax check         — node --check _shared/a1-tools.cjs
18-26  Fixtures              — for r in _test-fixtures/*/run*.sh; bash "$r"
                               + one hardcoded nested parser: a1-schema-check/parser/run-parser.sh
28-35  Install smoke test    — fresh $HOME via mktemp -d, bash ./bin/install.sh, then:
                               test -L $HOME/.claude/skills/a1-new-feature   (positive)
                               test -L $HOME/.claude/skills/_shared          (positive)
                               test ! -e $HOME/.claude/skills/checkpoint     (negative)
37-42  Vault-free CLI check  — A1_VAULT_ROOT unset, asserts repo-local .a1/learnings/ tier
```

**No step references agent count, agent symlinks, README parity, or any drift assertion.**
The fixtures glob `run*.sh` already matches both `run.sh` and `run-tests.sh` — **[MAP-new]**
confirms RESEARCH.md's claim that Task 2.4's rename is CI-neutral either way (the glob pattern
itself needs zero changes regardless of which name a1-cmd-injection uses).

**[MAP-new] Wave 2 integration point:** the natural insertion for a new "Install-sync check"
CI step is between the existing "Install smoke test" step (line 28) and "Vault-free CLI check"
(line 37) — it can reuse the same `HOME="$(mktemp -d)"` pattern already established two steps
prior, and should run `bin/verify-install-sync.sh` against the *real* repo lists (unlike the
fixture suite, which per CONVENTIONS.md must use copied/mutated lists — the CI step itself is
the one place asserting against live repo state is correct and intended).

## 4. `_test-fixtures/` — conventions and current compliance

`_test-fixtures/CONVENTIONS.md` (80 lines) mandates:
- Runner filename: `run-tests.sh` (glob-matched `run*.sh` by CI) — **claims "unified
  2026-07-12"**, verified false: `a1-cmd-injection/run.sh` (6576 bytes) is the sole holdout.
  All other 21 suites already comply.
- Runner pattern: `set -u`, `pass=0 fail=0`, `assert_rc`/`assert_true` helpers, final
  `echo "<suite>: $pass passed, $fail failed"` + `[[ $fail -eq 0 ]]` exit gate.
- Isolation: `mktemp -d` for all mutable state, CI also sets `HOME=$(mktemp -d)`, checked-in
  fixture data is immutable (copy before mutate), JSON assertions via `node -e`.
- Mandatory "Hostile inputs" section per new suite: (a) path traversal, (b) injection-shaped
  input, (c) oversized values (≥10 000 chars).
- Reference style: `_test-fixtures/product-docs/run-tests.sh:820-871`.

**[MAP-new] Directory listing (22 total, alphabetical):** a1-analyze-cli, a1-check,
a1-checklist, a1-cmd-injection (holdout), a1-code-scope, a1-constitution, a1-cost, a1-fix,
a1-modernize-roundtrip, a1-pack, a1-phantom, a1-pr-review, a1-realpath-check, a1-reconcile,
a1-reservations, a1-schema-check, a1-vault-fallback, a1-worktree, product-adopt, product-docs,
product-import, roadmap-gate.

New suite `install-sync/` (Task 2.2) will be the 23rd directory. Given CONVENTIONS.md's own
hostile-input requirement, note per RESEARCH.md: (b) injection-shaped input has no natural
analog for a pure list-diff checker (no shell-evaluated input path) — the suite should
document this explicitly rather than silently skip it, to satisfy the "mandatory" framing of
the CONVENTIONS.md section without inventing a fake test case.

## 5. `agents/*.md` frontmatter — full re-verified survey (21/21 files read)

### 5a. `tools:` field format

| Format | Count | Files |
|---|---|---|
| CSV bare (`tools: Read, Write, Bash, ...`) | 13 | adam-auditor, alex-architekt, erik-executor, ludwig-legal, marco-mapper, pablo-planner, rafael-reverse-spec, rene-requirement-engineer, rico-researcher, theo-test-engineer, uwe-ux-expert, victor-verifier, vincente-vibe-optimizer |
| YAML bracketed array (`tools: [Read, Write, ...]`) | 6 | dario-devops, diana-docs, falk-fault-finder, reinhard-reviewer, samuel-security, tobi-tester |
| Missing entirely (inherits all tools) | 2 | aik-ai-engineer, walter-web-developer |

**[MAP-new]** All 6 bracketed-array files are recent (dario/diana/samuel added `2f22541`;
falk/reinhard/tobi are from the earlier specialization pass per git log `1360d0e`,
`345f3bb`). This is the newer, YAML-correct convention — bare CSV after `tools:` parses as a
single scalar string under strict YAML, not a sequence. Recommend bracketed array as Task 5.1's
target format (matches RESEARCH.md's recommendation).

### 5b. `model: opus` pins (4 total)

| Agent | Line | Justification comment present? |
|---|---|---|
| `a1-reinhard-reviewer` | `model: opus # deep reasoning IS the job: last review gate before PRs and deploys` | Yes |
| `a1-falk-fault-finder` | `model: opus # RCA on hard bugs — hypothesis formation from sparse evidence IS the job` | Yes |
| `a1-samuel-security` | `model: opus # adversarial reasoning IS the job — attacker-mindset hypothesis chains on sparse evidence justify the top tier` | Yes |
| `a1-alex-architekt` | `model: opus` (bare, line 5) | **No — Task 5.2's sole target** |

### 5c. Delegation-table format (Task 5.3 scope)

| Agent | Current format | Needs conversion? |
|---|---|---|
| `a1-rafael-reverse-spec` | `\| Task \| Owner \|` table at line 175 | **No — already compliant, use as template** |
| `a1-rico-researcher` | Bullet list `- X → Y` (lines 22-26) | **Yes** |
| `a1-marco-mapper` | Bullet list `- X → Y` | **Yes** |
| `a1-pablo-planner` | Bullet list `- X → Y` | **Yes** |

Confirmed: **3 agents to convert, not 4** — Rafael's table (visible at
`agents/a1-rafael-reverse-spec.md:175`, header row `| Task | Owner |`) is the exact target
shape and should be copy-pasted structurally for Rico/Marco/Pablo.

### 5f. Secondary inconsistency axes **[MAP-new, via agents-survey]** — flag only, don't scope-creep

Beyond the frontmatter items PLAN.md's Wave 5 scopes, two more structural-inconsistency axes
exist. **Only fix if a task explicitly names them** — otherwise leave, to keep Wave 5 mechanical:

- **`description:` frontmatter has 3 styles:** quoted-single-line (alex, aik, ludwig, reinhard,
  tobi, uwe, vincente, walter), YAML block-scalar `|` (dario, diana, falk, samuel), and
  bare-unquoted (adam, erik, marco, pablo, rafael, rene, rico, theo, victor). The block-scalar
  set correlates with the specialization-pass agents — same normalization trigger as §5a if M11
  chooses to unify. Not in PLAN.md today.
- **Two prompt-body dialects:** `<role>`/`<not_in_scope>` XML tags (adam, erik, marco, pablo,
  rico, rafael, rene, victor, theo) vs. Markdown headings (dario, diana, samuel, falk).
  Structural (body, not frontmatter) — out of scope unless a task names it explicitly.
- **Design-level (NOT mechanical — Wave 7 at most):** `a1-reinhard-reviewer` runs two full
  security phases (5 + 7) despite `a1-samuel-security` existing; the "escalate to Samuel"
  boundary is asserted in prose but not operationalized. This is a specialization-overlap
  *decision*, not a frontmatter fix — belongs in Wave 7's consolidation discussion if anywhere,
  never in the mechanical waves.

### 5d. Hardcoded `~/.claude/skills` paths — all 4 hits, categorized

| File:Line | Content | Category | Action |
|---|---|---|---|
| `a1-victor-verifier.md:94` | `node ~/.claude/skills/_shared/a1-tools.cjs phantom check ...` | Executable invocation | **Fix (Task 4.2)** |
| `a1-victor-verifier.md:157` | `node ~/.claude/skills/_shared/a1-tools.cjs cost run ...` | Executable invocation | **Fix (Task 4.2)** |
| `a1-reinhard-reviewer.md:51` | `ls ~/.claude/skills/ 2>/dev/null` | Registry enumeration | Leave — intentional |
| `a1-ludwig-legal.md:73` | `Glob: ./**/SKILL.md  ~/.claude/skills/**/SKILL.md` | Registry enumeration glob | Leave — intentional |

Zero other agent files reference `~/.claude/skills` or `a1-tools.cjs` at all — confirmed via
full-repo grep. **[MAP-new]** No agent references `~/.claude/agents` either (the directory
agents are actually symlinked into) — this asymmetry is expected since agents don't need to
discover other agents by filesystem path, they're invoked by the orchestrating skill.

**[MAP-new, resolves RESEARCH.md §4's open design question] The Victor fix is a copy of an
existing in-repo pattern, not an invention.** The 3 newest agents already reference the
learning store repo-relative and are the copy-paste template — verified verbatim:
- `a1-samuel-security.md:109`, `a1-dario-devops.md:89`, `a1-diana-docs.md:92` each read:
  *"…the repo-local learning store: `.a1/learnings/` by default, or the vault under
  `$A1_VAULT_ROOT` when set."*

So Task 4.2's resolution snippet is settled: resolve `a1-tools.cjs` cwd-independently using the
same repo-relative / `$A1_VAULT_ROOT`-aware convention the newest agents already establish (e.g.
`$CLAUDE_PROJECT_DIR` env or walk-up-from-cwd to a `_shared/a1-tools.cjs` marker) — **not** a
bare `../../..` relative path (which breaks if Victor is invoked from a different depth). This
closes the "needs one more design sentence" flag RESEARCH.md §4 left open for the audit step.

### 5e. `_shared/learning-schema.md` (110 lines) — relevant excerpt

Documents `_learning.md` as living at `~/.claude/skills/<skill-name>/_learning.md`, explicitly
framed as a **per-installation fast-access cache**, with the canonical store being the 3-tier
learning-store resolution (env > repo-local `.a1/learnings/` > legacy vault). This is the
correct, intentional shape — confirmed **not** a Task 4.2 target. 27 files under `skills/`
reference `~/.claude/skills/`; every sampled instance is either this cache-path pattern or a
pointer to another installed skill (e.g. `n3urala1-design`), both legitimate given skills
genuinely materialize under a resolved skills path post-install (plugin or symlink alike).

## 6. Language-policy contradiction — 11 sites, re-verified

```
grep -rn "in German\|auf Deutsch\|in English" skills/*/SKILL.md skills/*/workflows/*.md
```

| File:Line | Text | Note |
|---|---|---|
| `a1-constitution/SKILL.md:154` | "...stays in English." | plain |
| `a1-analyze/SKILL.md:187` | "(frontmatter, findings, code refs) stays in English." | plain |
| `a1-fix/SKILL.md:216` | "User-facing prompts...in German. File content stays in English." | dual-marker, one line |
| `a1-new-project/SKILL.md:159` | "All file artifacts...stay in English." | plain |
| `a1-modernize/SKILL.md:186` | "User-facing prompts...in German. File content...in English." | dual-marker |
| `a1-reconcile/SKILL.md:176` | "...stays in English." | plain |
| `a1-worktree/SKILL.md:126` | "...stays in English." | plain |
| `a1-new-feature/workflows/02-specify.md:24` | "(in English — the output is a technical artifact)" | artifact-scoped |
| `a1-new-project/workflows/02-scope.md:12` | "All user-facing text in German." | beyond PLAN.md's named list |
| **`a1-check/SKILL.md:29`** | "Language: English-first; German trigger aliases supported." | **contradicts line 100** |
| **`a1-check/SKILL.md:100`** | "User-facing output...is in **German**." | **contradicts line 29** |

The `a1-check` self-contradiction is the sharpest instance: line 29 states the skill's own
written-language/trigger-alias policy (English-first), line 100 hardcodes German for a
specific runtime behavior — these read as directly conflicting to anyone skimming the file,
independent of which line is "correct" by original intent. **[MAP-new]** No other skill has
both an "English-first" framing line AND a hardcoded-German runtime instruction in the same
file — a1-check is the unique dual-contradiction case; the other 9 files each state only one
side (artifact-language OR user-language), which is consistent with a *missing shared policy
file* (Task 3.1 creates `_shared/language-policy.md`) rather than each file individually
contradicting itself.

## 7. Storage prose ("Obsidian Vault" default) — 11 files, re-verified

```
grep -rln "Obsidian Vault" skills/
```

| File | Lines | Category |
|---|---|---|
| `a1-new-feature/SKILL.md` | 7, 274 | frontmatter-state description + Storage section |
| `a1-evolve/workflows/01-collect.md` | 7 | "primary — the brain" — **needs reframing, not word-swap** |
| `a1-evolve/workflows/04-apply.md` | 26, 49 | "Update Obsidian Vault (primary)"; code-comment "canonical is Obsidian Vault" |
| `a1-modernize/SKILL.md` | 11, 153 | frontmatter-state + Storage section |
| `a1-reconcile/SKILL.md` | 10, 128 | frontmatter-state + Storage section |
| `a1-check/SKILL.md` | 38 | "Both files must already exist...under the Obsidian Vault paths" |
| `a1-check/workflows/01-run-check.md` | 13 | "the Obsidian Vault project folder name" |
| `a1-execute/SKILL.md` | 11 | "writes a Retro to the Obsidian Vault" |
| `a1-fix/_learning.md` | 3 | "Canonical source: `wiki/postmortems/` in Obsidian Vault" — **generated cache, check regen-on-run before hand-editing** |
| `a1-fix/SKILL.md` | 7, 14 | frontmatter-state + Postmortem destination |
| `a1-analyze/SKILL.md` | 8, 25, 120 | frontmatter-state, Retro destination, Storage section |

Cross-reference against `_shared/learning-schema.md`'s accurate 3-tier description (env >
repo-local `.a1/learnings/` > legacy-vault-if-no-git-repo): the Vault is a **fallback sink
today**, not primary. `a1-evolve/workflows/01-collect.md:7`'s "primary — the brain" heading is
the most stale of the 11 and needs actual content revision (not find-replace), matching
RESEARCH.md's judgment call. **[MAP-new]** `a1-fix/_learning.md` header literally reads "Fast
access cache" — confirmed by direct read (not just grep) — before Task 4.1 edits this file,
verify whether it's regenerated by a1-fix's own Postmortem step (in which case a hand-edit
here is a wasted no-op that gets silently overwritten on next run) vs. hand-maintained.

**Overlap with language-policy sweep (Task 3.2):** a1-analyze, a1-fix, and a1-reconcile appear
in *both* the language-policy site list (section 6) and this storage-prose list (section 7) —
same files, different lines, different fixes. Confirms RESEARCH.md risk #4: recommend one
commit per sweep-task (not per file) to avoid needless commit fragmentation given this overlap.

## 8. Learning-loop / Retro coverage — re-verified, 3 buckets

**Note on detection method:** a literal `^## Retro` heading grep returns **zero** matches
across all `skills/*/SKILL.md` — the Retro mechanism is documented as prose/table-rows in
SKILL.md (e.g. `a1-new-feature/SKILL.md:54`: `| 6 | Verify + Retro | workflows/06-verify.md |
...`) and implemented inside `workflows/*.md` files, not as a dedicated heading in the
top-level SKILL.md. This matches the intended architecture (workflows carry mechanics,
SKILL.md carries orchestration) and is **not a defect** — just a note that any grep-based
"Done when" check in PLAN.md/Task 6.1 should search prose mentions of "Retro" plus workflow
files, not a specific heading string.

| Bucket | Skills | Evidence |
|---|---|---|
| **Has Retro mechanism** | a1-execute, a1-analyze, a1-fix, a1-new-feature, a1-new-project, a1-checklist | Confirmed via direct grep for "Retro" in SKILL.md prose (all 6 have explicit mentions of writing/appending a Retro) |
| **Missing Retro (Task 6.1 target, 5 confirmed)** | a1-plan, a1-roadmap, a1-reconcile, a1-modernize, a1-constitution | Each has a `workflows/04-*.md` file that mentions "Retro" only in passing (not a structured self-contained block); no SKILL.md-level Retro commitment found |
| **Excluded by design (gates/reporters, Task 6.2 framing)** | a1-phantom, a1-pr-review, a1-progress, a1-worktree, a1-check | No LLM judgment produced — deterministic gates/reporters, correctly excluded from Retro requirement |

**[MAP-new]** `a1-evolve` itself is self-referential (writes ABOUT the learning process, is
not a subject of its own retro) — correctly excluded from both buckets, matches RESEARCH.md.

`a1-evolve/SKILL.md`'s "Input sources" table (~lines 48-56) names 4 generic source *types*
(per-skill `_learning.md`, `observations.jsonl`, canonical learning store, a1-fix postmortems)
— not an explicit skill-by-skill enumeration. Task 6.2's fix is additive documentation (name
the actual learning-enabled skill set inline near this table + one sentence on why
gates/reporters are excluded) — **no logic change needed**, the collect mechanism already only
globs files that exist.

## 9. Structural consolidation candidates (Wave 7 decision-doc inputs)

| Candidate | Single-caller evidence | Notes |
|---|---|---|
| `a1-theo-test-engineer` | Referenced only in `a1-modernize/SKILL.md` (×3) + 2 workflow files (`06-execute.md`, `05-plan.md`) | Confirmed single-caller (Phase 6) |
| `a1-rafael-reverse-spec` | Referenced only in `a1-modernize/SKILL.md` (×3) + `02-reverse-spec.md` | Confirmed single-caller (Phase 2). Also the delegation-table format template (section 5c) |
| `a1-diana-docs` | **Zero references** in any `skills/` file | Newest agent, not installed (Wave 1 fixes), and has no spawn point at all — genuinely orphaned pending a decision (user-invoked directly, or should a skill spawn her?) |
| `a1-ludwig-legal` | N/A — usage question is duplication vs. the installed `legal` Claude Code plugin (`legal:brief`, `legal:compliance-check`, `legal:review-contract`, etc., visible in this session's skill list) | Task 7.4 should diff Ludwig's GDPR/EU-AI-Act specificity against plugin's generic tools |
| `hero-animation-builder` | 56 lines, `references/` + `scripts/` (no `workflows/`) — structurally unlike every other skill; present in the session's global skill list (usable via separate mechanism) but absent from `install.sh` SKILLS array and README table | Confirmed genuinely non-conformant to the a1 skill convention, not just "uninstalled" |

**[MAP-new, via skills-survey] Additional Wave-7 candidates** (planner's discretion — only if
Wave 7 scope allows; all are decision-doc inputs, not mechanical tasks):

- **`a1-check` ⊂ `a1-checklist`** — both read-only pre-implementation gates wrapping
  `a1-tools.cjs`; a1-check's 3 structural invariants are effectively a subset of a1-checklist's
  8-check gate. Merge/absorb candidate. (Note the tension: their SKILL descriptions already draw
  an explicit "distinct from" boundary, so any merge decision must reconcile that framing.)
- **Lifecycle-gate extraction** — `a1-new-feature` (SKILL + ~1507 workflow LOC, six hard-rule
  gates) and `a1-fix` (~224 LOC) share lifecycle-gate logic that could extract to a shared
  `_shared/lifecycle-gates.md` for readability. **Caveat:** this is a doc/prose extraction, not a
  `.cjs` change, so it stays inside this phase's frozen-CLI boundary — but verify it doesn't
  balloon into cross-wave scope creep.
- **"Versions" section present in only 4/18 skills** (a1-analyze, a1-constitution, a1-modernize,
  a1-reconcile) — minor consistency point; candidate for either standardizing or dropping.

## 10. Architecture note — what this phase deliberately does NOT touch

- `_shared/a1-tools.cjs` and `_shared/lib/*.cjs` — zero tasks edit CLI logic; the existing
  fixture suites + `node --check` remain the sufficient regression gate.
- `.claude-plugin/marketplace.json` / `plugin.json` — verified count-agnostic (`"source":
  "./"` references the whole repo), immune to the count-drift bug class; out of scope.
- `skills/*/` body prose beyond the two named sweeps (language-policy, storage-prose) and the
  Retro-gap fill — no other content changes are in scope per RESEARCH.md's task list.

## 11. Cross-wave coupling flagged for the plan step

1. **Task 1.3 (`bin/install-exclusions.txt` format) ↔ Task 2.1 (`verify-install-sync.sh`
   parser)** must agree on file format before either is written. Recommended:
   `<name>: <reason>` one-per-line, parseable via `cut -d: -f1`.
2. **Whether the exclusion file covers only agents or both agents+skills** (section 2 above) —
   `hero-animation-builder`'s skills-side exclusion currently has no file-based mechanism at
   all; decide symmetry before Task 2.1 is scoped.
3. **README.md:12-21 HTML-comment scope note** hardcodes "17 skills + 18 agent names" as a
   claimed-but-unenforced check — Task 1.2 must update the numbers; consider whether Task 2.1's
   checker should also validate this comment's claimed counts (4th assertion), or the comment
   itself becomes the next stale artifact.
4. **Task 7.4 (Marco haiku-pin note) depends on Task 4.3** already being done, per PLAN.md's
   dependency graph — Wave 7 docs should only be finalized after Waves 1-6 merge.

## Summary

All facts, counts, and site inventories from RESEARCH.md were independently re-verified
against the live tree at HEAD `7217d29` and match exactly — zero discrepancies found, and
cross-checked against three parallel survey agents (agents-survey, skills-survey,
tooling-survey) whose independent counts agreed on every core figure. This map adds: (a) precise
line-range structure of `install.sh` and `test.yml` for surgical edits, (b) the skills/agents
exclusion-mechanism asymmetry (open question for Wave 1/2 scoping), (c) the CI insertion point
for a new install-sync step, (d) confirmation that "Retro" is prose/table convention not a
heading (affects how Task 6.1's completion is grepped), (e) the overlap map between
language-policy and storage-prose sweeps (a1-analyze, a1-fix, a1-reconcile) for
commit-granularity planning, (f) **the resolved Victor-path fix mechanism** — copy the
`.a1/learnings/` + `$A1_VAULT_ROOT` repo-relative pattern the 3 newest agents (samuel:109,
dario:89, diana:92) already use, closing RESEARCH.md §4's open design question, and (g) two
secondary agent-inconsistency axes (description styles, prompt dialects) plus three extra Wave-7
consolidation candidates (a1-check⊂a1-checklist, lifecycle-gate extraction, Versions-section
gap) flagged as flag-only to prevent Wave-5 scope creep.
