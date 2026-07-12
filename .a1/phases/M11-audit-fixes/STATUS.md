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

## Next wave

Wave 3 (One language policy) is independent of Wave 2 and only depends on
Wave 1 (per the plan's Dependencies section) — ready to start. Note:
uncommitted partial Wave 3 work already exists in the working tree
(`a1-analyze/SKILL.md`, `a1-constitution/SKILL.md`) from the earlier
concurrent-wave run — a future Wave 3 execution should verify and reuse
this partial work per the same protocol used in Wave 1, not redo it from
scratch.
