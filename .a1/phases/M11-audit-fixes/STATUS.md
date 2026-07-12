---
phase: M11-audit-fixes
updated: 2026-07-12
---

# Status: M11-audit-fixes

## Wave 1 — Close the install gap (BLOCKER)

**Status: DONE** (all 3 tasks complete, regression gate green after every
task touching `bin/`)

### Pre-execution note

The working tree already contained uncommitted, partially-correct changes
from an earlier concurrent-wave run before this execution started:
- `bin/install.sh` already had Task 1.1's exact AGENTS-array addition
  (samuel/diana/dario appended after `a1-theo-test-engineer`, no reordering).
  Verified correct against PLAN.md's task text and committed as-is.
- Unrelated to Wave 1: partial Wave 5 frontmatter changes (5 agent files:
  alex, marco, pablo, rafael, rico — `tools:` CSV → bracketed array) and
  partial Wave 3 language-policy sweep (a1-analyze, a1-constitution
  SKILL.md) were also present, plus harmless fixture-timestamp drift in
  two `a1-reconcile` test vault files. None of these belong to Wave 1 and
  were left untouched — they were not committed by this run since they are
  out of this wave's scope.

### Task 1.1 — Add the three agents to install.sh
- **Done.** `bin/install.sh` AGENTS array already had the correct edit in
  the working tree (pre-existing, uncommitted). Verified against current
  PLAN.md text: 3 entries appended after `a1-theo-test-engineer`, no
  reordering of the other 18.
- Verified: fresh `bash bin/install.sh` on a temp `$HOME` creates 21 agent
  symlinks; re-run is idempotent (still 21, exit 0, no errors).
- Regression gate: green (`node --check` + all 22 fixture suites).
- Commit: `cbc6844` — `fix(install): add samuel/diana/dario to AGENTS array`

### Task 1.2 — Update README to the real set
- **Done.** Updated 5 sites in README.md (one more than the plan's basis
  text explicitly named, but same class of stale count — left uncorrected
  it would recreate the exact drift this phase closes):
  1. Scope-note HTML comment (line ~15): "18 agent names" → "21 agent names"
  2. `## Agents (18)` heading → `## Agents (21)`
  3. Intro sentence: "symlinks 18 shared framework agents" → 21
  4. Plugin-install paragraph: "All 17 skills and 18 agents" → 21
  5. Structure-tree comment: `agents/  # 18 shared framework agents` → 21
     (not explicitly named in the task's basis text; fixed anyway — same
     stale-count class, low-risk one-line comment edit)
- Added 3 table rows for `a1-samuel-security`, `a1-diana-docs`,
  `a1-dario-devops` with short role descriptions derived from each agent's
  own frontmatter `description:`.
- Verified: README agent-table row count (21) == `ls agents/*.md | wc -l`
  (21) == install.sh AGENTS array length (21). No remaining "18 agent"
  references anywhere in README.md.
- Commit: `f9e3040` — `docs(readme): update agent set to the real 21`

### Task 1.3 — Document the deliberate exclusions
- **Done.** Created `bin/install-exclusions.txt` in the exact
  `<name>: <reason>` format specified (flat list, one entry per line).
  File contains zero content entries (header comment only) — agents-only
  scope, all 21 agents install today. `hero-animation-builder` deliberately
  NOT added (it's a skills-side exclusion with no file-based mechanism,
  already correctly absent from `install.sh`'s SKILLS array).
- Referenced the file from `bin/install.sh` (comment above the AGENTS
  array) and from README.md's Agents section intro sentence.
- Verified: file exists in agreed format (0 non-comment lines); both
  install.sh and README reference it; regression gate green.
- Commit: `6d57654` — `docs(install): document the (empty) agent-install exclusion list`

## Deviations from plan

- Task 1.2 fixed one additional stale-count site (README's `## Structure`
  code-block comment, `agents/  # 18 shared framework agents`) that the
  plan's basis paragraph did not explicitly enumerate but which is the
  identical defect class (SC-1/SC-2 concern: README claiming an agent
  count that doesn't match reality). Judged in-scope and low-risk; noted
  here for visibility rather than silently expanding scope.
- No other deviations. Task 1.1's AGENTS-array edit was found
  pre-existing and correct in the working tree (see pre-execution note
  above) rather than authored fresh by this run; content matches the
  plan's instruction exactly, so it was verified and committed as normal
  Task 1.1 output.

## Regression gate results

Ran after every task in this wave (all three touched `bin/`):
```
node --check _shared/a1-tools.cjs   → OK
22 fixture suites (_test-fixtures/*/run*.sh) → ALL-SUITES-GREEN
```
Green after Task 1.1, Task 1.2 (README-only, ran anyway), and Task 1.3.

## Commit log (this wave)

```
6d57654 docs(install): document the (empty) agent-install exclusion list
f9e3040 docs(readme): update agent set to the real 21
cbc6844 fix(install): add samuel/diana/dario to AGENTS array
```

## Wave 2 — Drift gate in CI (turn the README claim into a real check)

**Status: DONE** (all 5 tasks complete, including the optional Task 2.5;
regression gate green after every task touching `bin/`, `.github/`, or
`_test-fixtures/`)

### Pre-execution note

Working tree at Wave 2 start had no uncommitted Wave-2-scoped files (no
`bin/verify-install-sync.sh`, no `_test-fixtures/install-sync/` existed
yet). The pre-existing uncommitted Wave 3/5 leftovers noted in Wave 1's
pre-execution note (5 agent frontmatter files, 2 language-policy SKILL.md
edits, 2 harmless a1-reconcile fixture-timestamp diffs) were still present
but out of this wave's scope — left untouched throughout, never staged or
committed by this run.

### Task 2.1 — `bin/verify-install-sync.sh`
- **Done.** New script, four checks: (1) skills dirs vs install.sh SKILLS
  array vs README skills table, (2) agents dirs vs install.sh AGENTS array
  vs README agents table, (3) counts printed both sides, (4) README
  scope-note HTML-comment counts ("N skills + M agent") parsed and asserted
  against the live figures — the audit MAJOR-2 4th assertion.
- Parses `bin/install-exclusions.txt` (`<name>: <reason>` format) for
  future agent-side exclusions; hardcodes the one known skills-side
  exclusion (`hero-animation-builder`) per Task 1.3's scope note (no
  file-based mechanism exists for that side).
- Accepts `--repo-root` / `--install-sh` / `--readme` / `--exclusions-file`
  overrides so the fixture suite can point it at mktemp copies instead of
  the live tree.
- **Two bugs found and fixed during local verification before commit:**
  (a) initial README-table row regex (`^\| [a-zA-Z0-9_-]+ \|`) didn't match
  the actual table format (`| \`a1-xxx\` | ... |`, backtick-quoted first
  cell) — fixed the regex to `^\| \`[a-zA-Z0-9_-]+\` \|`; (b) `${arr[@]}`
  on a zero-length bash array under `set -u` on macOS's bash 3.2 throws
  "unbound variable" — fixed with the `${arr[@]+"${arr[@]}"}` guard idiom
  at both call sites.
- Verified: exits 0 on clean post-Wave-1 repo; exits 1 with a named
  `DRIFT` line when an extra skill dir is seeded (manual mktemp-copy test,
  ahead of Task 2.2's formal suite).
- Commit: `18fff6d` — `ci(install): add deterministic install/README sync checker`

### Task 2.2 — Fixture suite `_test-fixtures/install-sync/`
- **Done.** `run-tests.sh` follows house style (`set -u`, `pass=0 fail=0`,
  `assert_rc`/`assert_true`, mktemp-copy isolation — never points the
  checker at the live repo tree, only at copies of `bin/`, `agents/`,
  `skills/`, `README.md`).
- All four required seeded-drift cases present, each independently
  asserting exit 1: extra skill dir, agent missing from install.sh's
  AGENTS array, stale README table row (deleted via `node -e`), stale
  README scope-note comment count (regex-substituted via `node -e`).
- Hostile inputs: (a) path-traversal-style dir name with spaces — asserted
  handled as ordinary drift, not a crash; (b) injection-shaped input —
  documented as N/A in the suite's own comments (checker has no
  shell-evaluated input path: only `find`/`awk`/`grep` over filenames and
  README prose, nothing passed to `eval`/backticks); (c) oversized
  exclusion file (≥10 000 chars) — asserted completes in <5s and returns
  0 or 1, never hangs.
- 12/12 assertions pass locally. 23rd fixture directory, as predicted by
  the plan.
- Commit: `dc41bc6` — `test(install-sync): add fixture suite for the drift checker`

### Task 2.3 — CI step
- **Done.** Added "Install/README sync check" step to
  `.github/workflows/test.yml`, between "Install smoke test" and
  "Vault-free CLI check" — runs `bash bin/verify-install-sync.sh` against
  live repo state (no `HOME` override needed; this checker reads repo
  files, not `$HOME`-installed symlinks).
- Verified the "seeding the samuel-gap makes it fail" done-when criterion
  manually: temporarily deleted the `a1-samuel-security` line from
  `bin/install.sh`'s AGENTS array, confirmed the checker exits 1 with a
  named `agents-side count mismatch` diff, then restored the file and
  confirmed PASS again (working tree left clean, verified via `git status`
  before committing).
- Commit: `b60eeb2` — `ci: wire the install/README sync checker into the test workflow`

### Task 2.4 — Runner-naming consistency
- **Done.** `git mv _test-fixtures/a1-cmd-injection/run.sh` →
  `run-tests.sh`. Confirmed it was the sole holdout (`ls
  _test-fixtures/*/run*.sh | grep -v run-tests.sh` → exactly one hit,
  pre-rename). CI-neutral (glob `run*.sh` matched both names). Historical
  references to the old filename remain in `.a1/phases/M10-*` and
  `.a1/phases/M11-audit-fixes/{MAP,RESEARCH,PLAN}.md` — these are
  point-in-time planning artifacts, not live code/CI references, and were
  intentionally left untouched.
- Commit: `4263326` — `test(a1-cmd-injection): rename run.sh to run-tests.sh`

### Task 2.5 (optional hardening) — Redundant symlink assertion
- **Done — included** (judged low-risk, one line). Added
  `test -L "$HOME/.claude/agents/a1-samuel-security.md"` to the existing
  "Install smoke test" step, alongside the other symlink assertions.
- **Deviation from the task's literal snippet:** the plan's basis text
  wrote the assertion path without the `.md` suffix
  (`.../a1-samuel-security`); `bin/install.sh`'s `symlink_item` calls use
  `"${agent}.md"` as the destination filename, so the actual symlink is
  `a1-samuel-security.md`. Verified this by running a manual
  `HOME=$(mktemp -d) bash bin/install.sh` and inspecting the resulting
  `agents/` symlinks before writing the assertion — used the corrected,
  suffixed path so the assertion actually exercises what install.sh
  creates rather than always-failing on a path that never exists.
- Commit: `c178f8a` — `ci(install): add redundant symlink assertion for a1-samuel-security`

## Deviations from plan (Wave 2)

- Task 2.1: two implementation bugs found and fixed during local
  verification before the first commit (README-table regex, `set -u`
  empty-array handling under bash 3.2) — see Task 2.1 notes above. Neither
  changes the task's scope or Done-when criteria; both were caught by
  running the checker locally against the live repo before committing.
- Task 2.5: assertion path corrected from `a1-samuel-security` to
  `a1-samuel-security.md` to match what `install.sh` actually creates —
  see Task 2.5 notes above.
- No other deviations. All four required Task 2.2 drift cases implemented
  exactly as specified; Task 2.4's rename left CI-neutral as predicted.

## Regression gate results (Wave 2)

Ran after every task in this wave (all five touched `bin/`, `.github/`,
or `_test-fixtures/`):
```
node --check _shared/a1-tools.cjs   → OK
23 fixture suites (_test-fixtures/*/run*.sh) → ALL-SUITES-GREEN
```
Green after Task 2.1, Task 2.2, Task 2.3, Task 2.4, and Task 2.5. Also
ran the CI's extra `a1-schema-check/parser/run-parser.sh` invocation
manually — PASS.

## Commit log (Wave 2)

```
c178f8a ci(install): add redundant symlink assertion for a1-samuel-security
4263326 test(a1-cmd-injection): rename run.sh to run-tests.sh
b60eeb2 ci: wire the install/README sync checker into the test workflow
dc41bc6 test(install-sync): add fixture suite for the drift checker
18fff6d ci(install): add deterministic install/README sync checker
```

## Wave 3 — One language policy

**Status: DONE** (both tasks complete; no `bin/`, `.github/`, or
`_test-fixtures/` files touched by this wave, so the regression gate was
optional per the ground rules — ran it anyway, green)

### Pre-execution note

The working tree at Wave 3 start already contained, uncommitted:
- Task 3.1's exact deliverable, but already **committed** on `main` from an
  earlier concurrent-wave run before this execution started: commit
  `038f5ed` (`docs(shared): add single language-policy source of truth`)
  had already created `_shared/language-policy.md` (19 lines, two rules,
  matches the plan's spec exactly) and linked it from `CONTRIBUTING.md`.
  STATUS.md had not yet recorded this (an artifact of the earlier
  concurrent-wave bug). Verified content against current PLAN.md Task 3.1
  text — correct, no changes needed, nothing to (re-)commit.
- Two partially-correct, uncommitted Task 3.2 edits: `a1-analyze/SKILL.md`
  and `a1-constitution/SKILL.md` already had their local language rule
  replaced with the exact pointer sentence the plan specifies. Verified
  correct against current PLAN.md Task 3.2 text and kept as-is; folded into
  this wave's single sweep commit rather than redone.
- Unrelated, out-of-scope leftovers also present (untouched, not staged):
  5 agent frontmatter files (Wave 5 CSV→bracketed-array conversions:
  alex, marco, pablo, rafael, rico) and 2 harmless `a1-reconcile` fixture
  timestamp-drift files.

### Task 3.1 — `_shared/language-policy.md`
- **Done** (pre-existing, verified, no new commit needed). File exists,
  under 20 lines, exactly two rules (file artifacts always English;
  user-facing conversation output in the user's language), links to the
  README's German-trigger-alias note, and is itself linked from
  `CONTRIBUTING.md`. Confirmed absent-before via git history (did not exist
  before `038f5ed`), so the plan's "Done when" (file exists, confirmed
  absent today, linked from CONTRIBUTING.md) is satisfied.
- Commit (pre-existing, from earlier run): `038f5ed` — `docs(shared): add single language-policy source of truth`

### Task 3.2 — Sweep all SKILL.md + workflows
- **Done.** Replaced every local user-output language rule with the
  standard pointer line (`User-facing output language: see
  _shared/language-policy.md (artifacts English, conversation in the
  user's language).`) at all 9 explicit fix-list sites plus the a1-check
  self-contradiction:
  - `a1-analyze/SKILL.md:187` — already correct in working tree (verified, kept).
  - `a1-constitution/SKILL.md:154` — already correct in working tree (verified, kept).
  - `a1-fix/SKILL.md:216` — dual-marker line replaced with single pointer.
  - `a1-modernize/SKILL.md:186` — dual-marker line replaced with single pointer.
  - `a1-new-project/SKILL.md:159` — replaced (was two sentences: file-artifact
    rule + a German-specific conversation rule; both folded into the single
    pointer line, since the pointer already covers both cases).
  - `a1-reconcile/SKILL.md:176` — replaced.
  - `a1-worktree/SKILL.md:126` — replaced (kept the adjacent CLI-output-stays-English
    clause's intent implicitly covered by "artifacts English").
  - `a1-new-project/workflows/02-scope.md:12` — replaced.
  - `a1-check/SKILL.md:29` vs `:100` contradiction — **both** sites fixed:
    line 29's standalone "Language: English-first..." sentence and line
    100's "in German" Hard Rule both now point at the shared file; the
    factual note about `--format human` output was preserved (reworded to
    say the fix-path suggestion on top is in the user's language, not
    hardcoded German), so no CLI-behavior information was lost.
  - `a1-new-feature/workflows/02-specify.md:24` — left artifact-scoped
    ("in English") per the plan's explicit exception, but the sentence now
    also references `_shared/language-policy.md` so it's traceable to the
    single source of truth rather than reading as a third, disconnected rule.
- **Completion-gate grep verified:**
  `grep -rn "in German\|auf Deutsch\|in English" skills/*/SKILL.md skills/*/workflows/*.md`
  returns exactly one hit — the intentionally-kept
  `a1-new-feature/workflows/02-specify.md:24` artifact-scoped line. No other
  user-output language mandates remain anywhere in `skills/`.
- Regression gate: not required by the ground rules (task touches only
  `skills/`), ran anyway — green (`node --check` + all 23 fixture suites).
- Commit: `e8c77bc` — `docs(skills): sweep local language rules to shared policy pointer`
  (single sweep commit per the ground rules' "one commit per sweep, not per
  file" rule for tasks 3.2/4.1; covers all 8 newly-edited files plus folds
  in the 2 pre-existing correct edits from the working tree).

## Deviations from plan (Wave 3)

- Task 3.1 required no new commit: it was already correctly implemented and
  committed (`038f5ed`) before this wave's execution started, from the
  earlier concurrent-wave run. STATUS.md simply hadn't caught up — verified
  and recorded here rather than re-done.
- Task 3.2: `a1-new-project/SKILL.md:159` was originally two sentences (a
  file-artifact clause and a separate "German for Robert" conversation
  clause); both were collapsed into the single standard pointer line rather
  than only replacing the second sentence, since the pointer line already
  fully covers both the artifact and conversation cases the two original
  sentences addressed. Judged in-scope (same defect class: hardcoded
  language mandate) and lower-risk than leaving a redundant half-sentence.
- No other deviations. All other 7 sweep sites match the plan's fix list
  and replacement text exactly.

## Regression gate results (Wave 3)

Not required (no `bin/`, `.github/`, or `_test-fixtures/` files touched),
ran anyway for safety:
```
node --check _shared/a1-tools.cjs   → OK
23 fixture suites (_test-fixtures/*/run*.sh) → ALL-SUITES-GREEN
```

## Commit log (Wave 3)

```
e8c77bc docs(skills): sweep local language rules to shared policy pointer
038f5ed docs(shared): add single language-policy source of truth   (pre-existing, from earlier run)
```

## Wave 4 — Storage prose + hardcoded paths

**Status: DONE** (all 3 tasks complete; no `bin/`, `.github/`, or
`_test-fixtures/` files touched by this wave, so the regression gate was
optional per the ground rules — ran it anyway after every task, green
throughout)

### Pre-execution note

Checked the working tree before starting: none of Wave 4's target sites
(the 11 "Obsidian Vault" storage-prose sites, Victor's two hardcoded
`~/.claude/skills/_shared/a1-tools.cjs` paths, Marco's `python3 -c` /
`src/` fixation) had any pre-existing uncommitted changes — all were still
in their pre-Wave-4 state. The uncommitted, out-of-scope leftovers noted in
Wave 3's "Next wave" section (5 agent frontmatter files: alex, marco,
pablo, rafael, rico — Wave 5 CSV→bracketed-array `tools:` conversions —
plus 2 harmless `a1-reconcile` fixture timestamp-drift files) were still
present but out of this wave's scope; left untouched throughout, never
staged or committed by this run. Note: the Wave 5 partial edit to
`agents/a1-marco-mapper.md` (a `tools:` frontmatter-only change) does not
overlap with this wave's body-prose edits to the same file — both coexist
in the working tree without conflict.

### Task 4.1 — Correct storage sections
- **Done.** Reworded all 11 confirmed sites (`grep -rln "Obsidian Vault"
  skills/`) across 9 files: `a1-new-feature/SKILL.md` (2), `a1-modernize/SKILL.md`
  (2), `a1-reconcile/SKILL.md` (2), `a1-check/SKILL.md` (1),
  `a1-check/workflows/01-run-check.md` (1), `a1-execute/SKILL.md` (1),
  `a1-fix/SKILL.md` (2), `a1-fix/_learning.md` (1), `a1-analyze/SKILL.md` (3).
  9 straightforward sites now read "repo-local default; external vault via
  `A1_VAULT_ROOT` (e.g. Obsidian)".
- The 2 `a1-evolve` sites (`01-collect.md:7`, `04-apply.md:26,49`) got the
  deeper reframing the plan called for, not a word-swap: "primary — the
  brain" / "canonical is Obsidian Vault" both reworded to describe the
  learning store as primary and the vault as an optional external sink —
  matches `_shared/learning-schema.md`'s own 3-tier description and the
  `VAULT="${A1_VAULT_ROOT:-...}"` resolution logic both files already use.
- Before editing `a1-fix/_learning.md`: verified it's append-only (`cat >>`
  in `workflows/04-verify.md`, never regenerated wholesale) — safe to
  hand-edit the header; not a wasted no-op. Also reworded the adjacent
  "canonical source" framing in `04-verify.md` itself (not in the original
  11-site inventory, but same defect class on the same postmortem-storage
  claim, confirmed via `_shared/lib/fix.cjs`'s `vaultRoot()` that runtime
  behavior is already repo-local-by-default).
- Verified: `grep -rln "Obsidian Vault" skills/` returns empty (SC-4).
  README's existing 3-tier fallback description (lines ~115-131) is
  untouched — confirmed still correct, no edit needed.
- Regression gate: not required (only `skills/` touched), ran anyway —
  green.
- Commit: `e422198` — `docs(skills): correct storage prose from Obsidian-Vault-primary to repo-local-default`
  (single sweep commit per the ground rules' "one commit per sweep" rule).

### Task 4.2 — De-hardcode Victor
- **Done.** Replaced both hardcoded `~/.claude/skills/_shared/a1-tools.cjs`
  invocations in `agents/a1-victor-verifier.md` (Step 4.5 phantom check,
  Step 5 cost line) with the plan's exact cwd-independent resolution
  snippet: `$CLAUDE_PROJECT_DIR` first if set, else walk up from `$PWD`
  looking for the `_shared/a1-tools.cjs` marker file.
- Swept the other 20 agent files for `~/.claude/skills`: confirmed exactly
  the 2 hits the plan predicted, both legitimate registry enumeration —
  `a1-reinhard-reviewer.md:51` (`ls ~/.claude/skills/`) and
  `a1-ludwig-legal.md:73` (`Glob: ~/.claude/skills/**/SKILL.md`) — left
  as-is, documented in the commit body.
- Verified: `grep -rn "~/.claude/skills" agents/` returns only those two
  documented lines; sanity-checked the new bash snippet's syntax
  (`bash -n`) and ran it standalone to confirm it resolves correctly.
- Regression gate: green.
- Commit: `68b0ea0` — `fix(agents): de-hardcode a1-tools.cjs invocation paths in Victor`

### Task 4.3 — Marco: haiku pin vs prompt complexity
- **Done.** Two-part mechanical fix, model pin (`model: haiku`) left
  unchanged as instructed (cost discussion deferred to Wave-7 Task 7.4):
  (a) replaced the single `python3 -c` inline dependency-parsing one-liner
  with a plain `grep` over `package.json`'s dependencies/devDependencies
  blocks; (b) added a "Detect top-level source dirs" step (`$SRC_DIRS`,
  checks `src/`/`app/`/`lib/`/`packages/` at repo root, falls back to `.`)
  and replaced all 5 hardcoded `src/` references in the tech/quality/concerns
  focus-area scans with `$SRC_DIRS`.
- **Minor deviation:** after the first pass, `grep -c "src/"` still returned
  1 — the new step's own explanatory comment (`do not hardcode "src/"...`)
  contained the literal string. Reworded the comment to avoid the substring
  while keeping its meaning, to satisfy the mechanical grep-based
  done-when criterion exactly as specified.
- Verified: `grep -c "python3\? -c" agents/a1-marco-mapper.md` == 0;
  `grep -c "src/" agents/a1-marco-mapper.md` == 0; replacement text
  contains "Detect top-level source dirs" (spot-check phrase present).
  Sanity-checked the new `$SRC_DIRS` bash snippet with `bash -n` and a
  standalone run.
- Regression gate: green.
- Commit: `40a6bdb` — `fix(agents): simplify Marco's mapping pipelines for haiku-tier reliability`

## Deviations from plan (Wave 4)

- Task 4.1: also reworded `a1-fix/workflows/04-verify.md`'s "Canonical
  source: `wiki/postmortems/<project>/...`" framing and the `_learning.md`
  cache-comment inside it — same defect class as the 11-site inventory
  (stale Vault-as-canonical claim) discovered while verifying whether
  `_learning.md` was safe to hand-edit; not a scope expansion, just the
  adjacent prose that makes the same false claim about the same artifact.
- Task 4.3: one extra edit beyond the plan's literal instruction — the new
  "Detect top-level source dirs" step's own explanatory comment initially
  still contained the substring `src/`, tripping the mechanical
  `grep -c "src/" == 0` done-when check. Reworded the comment (meaning
  unchanged) so the check passes exactly as specified rather than treating
  it as a near-miss.
- **Git-hygiene deviation (Task 4.3 commit `40a6bdb`):** `git add
  agents/a1-marco-mapper.md` staged the *entire* file diff, which
  inadvertently included the pre-existing, out-of-scope, uncommitted Wave 5
  edit already sitting in the working tree on that same file (`tools:
  Read, Bash, Grep, Glob, Write` → `tools: [Read, Bash, Grep, Glob, Write]`,
  a Task 5.1 CSV→bracketed-array frontmatter conversion noted in Wave 3's
  "Next wave" section). Caught during this STATUS.md write-up, after the
  commit — not reverted, because (a) the content is correct and matches
  Task 5.1's target format exactly, (b) it makes no CLI-behavior change,
  (c) the commit already has a child commit and a history rewrite was
  judged higher-risk than leaving a one-line frontmatter change bundled
  into an otherwise-correct Wave 4 commit. **Net effect on Wave 5:** when
  Wave 5 executes, `agents/a1-marco-mapper.md`'s `tools:` line will already
  be in the target bracketed-array format — Wave 5 should verify-and-skip
  this one file's frontmatter (not re-edit it) rather than assume it still
  needs conversion, and its own commit for Task 5.1 should account for 20
  files needing the CSV→array conversion, not 21 (Marco already done, via
  this Wave 4 commit).
- No other deviations. All three tasks matched the plan's task text and
  Done-when criteria on the first or second pass.

## Regression gate results (Wave 4)

Not strictly required by the ground rules (no `bin/`, `.github/`, or
`_test-fixtures/` files touched by any Wave 4 task), ran anyway after every
task for safety:
```
node --check _shared/a1-tools.cjs   → OK
23 fixture suites (_test-fixtures/*/run*.sh) → ALL-SUITES-GREEN
```
Green after Task 4.1, Task 4.2, and Task 4.3.

## Commit log (Wave 4)

```
40a6bdb fix(agents): simplify Marco's mapping pipelines for haiku-tier reliability
68b0ea0 fix(agents): de-hardcode a1-tools.cjs invocation paths in Victor
e422198 docs(skills): correct storage prose from Obsidian-Vault-primary to repo-local-default
```

## Next wave

Wave 5 (Agent frontmatter consistency) and Wave 6 (Learning-loop honesty)
remain independent and ready. Note: uncommitted, out-of-scope Wave 5
partial work still sits in the working tree (5 agent frontmatter files:
alex, marco, pablo, rafael, rico — CSV→bracketed-array `tools:`
conversions) plus 2 harmless `a1-reconcile` fixture timestamp-drift files —
a future Wave 5 execution should verify and reuse the partial frontmatter
work per the same protocol used in Waves 1, 3, and 4, not redo it from
scratch. `agents/a1-marco-mapper.md` now carries both the pre-existing
uncommitted Wave 5 `tools:` frontmatter edit and this run's committed
Wave 4 body-prose edits — a future Wave 5 run should verify its frontmatter
diff still applies cleanly against the current file body.
