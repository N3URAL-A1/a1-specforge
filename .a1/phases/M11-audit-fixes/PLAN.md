---
phase: M11-audit-fixes
goal: Close all findings from the 2026-07-12 deep audit — install-set drift, missing CI drift gate, contradictory language policy, stale storage prose, hardcoded paths, agent frontmatter inconsistency, learning-loop coverage gap, and structural consolidation decisions
spec: inline (audit findings from three parallel surveys — skills, agents, tooling — 2026-07-12; evidence cited per task as file:line)
project: a1-specforge
waves: 7
status: planned
created: 2026-07-12
revised: 2026-07-12
audit_incorporated: RESEARCH.md + MAP.md (both dated 2026-07-12, verified against HEAD 7217d29) — every wave/task cross-checked against live tree during this revision; see "Revision note" below for what changed and why.
code_scope:
  - bin/install.sh
  - README.md
  - .github/workflows/test.yml
  - bin/verify-install-sync.sh
  - _test-fixtures/a1-cmd-injection/
  - _test-fixtures/install-sync/
  - _test-fixtures/CONVENTIONS.md
  - _shared/language-policy.md
  - _shared/learning-schema.md
  - skills/a1-analyze/SKILL.md
  - skills/a1-check/SKILL.md
  - skills/a1-check/workflows/01-run-check.md
  - skills/a1-checklist/SKILL.md
  - skills/a1-constitution/SKILL.md
  - skills/a1-evolve/SKILL.md
  - skills/a1-evolve/workflows/01-collect.md
  - skills/a1-evolve/workflows/04-apply.md
  - skills/a1-execute/SKILL.md
  - skills/a1-fix/SKILL.md
  - skills/a1-fix/_learning.md
  - skills/a1-modernize/SKILL.md
  - skills/a1-new-feature/SKILL.md
  - skills/a1-new-feature/workflows/02-specify.md
  - skills/a1-new-project/SKILL.md
  - skills/a1-new-project/workflows/02-scope.md
  - skills/a1-phantom/SKILL.md
  - skills/a1-plan/SKILL.md
  - skills/a1-pr-review/SKILL.md
  - skills/a1-progress/SKILL.md
  - skills/a1-reconcile/SKILL.md
  - skills/a1-roadmap/SKILL.md
  - skills/a1-worktree/SKILL.md
  - agents/
  - docs/roadmap.md
---

# Plan: M11-audit-fixes

## Goal

Close every finding from the 2026-07-12 deep audit (three parallel surveys: skills,
agents, tooling). Ordered by impact: (1) the install-set gap that breaks fresh
installs, (2) a deterministic CI gate so this class of drift cannot recur,
(3) the contradictory language policy, (4) stale storage prose + hardcoded paths,
(5) agent frontmatter consistency, (6) learning-loop coverage honesty,
(7) structural consolidation decisions that need Robert's sign-off.

## Revision note (this pass, 2026-07-12)

Adopted the draft; validated every wave/task against RESEARCH.md and MAP.md, both of
which independently re-verified the draft's evidence against the live tree (HEAD
`7217d29`) and found it accurate. **No structural change** — 7 waves kept, Wave 7
stays STOP-gated/decision-docs-only. Live re-verification during this pass (grep +
`wc -l` against the actual files, not just re-reading RESEARCH/MAP) confirms every
figure below independently a third time. Tightened, not restructured:

- **Task 2.4**: draft said "rename — or, if other `run.sh` remain, fix CONVENTIONS.md
  instead." Confirmed exactly 1 holdout (`a1-cmd-injection/run.sh`); all 21 other
  suites already comply. Removed the conditional — rename is now the sole instruction.
- **Task 4.2**: draft left the resolution mechanism as "resolve repo-relative... same
  convention as skills'" with a TODO-flavored caveat. RESEARCH.md/MAP.md resolved this:
  no agent uses a bare relative path; the 3 newest agents (samuel:109, dario:89,
  diana:92) establish a repo-local-with-env-override convention for the *learning
  store*, but none of them invoke `a1-tools.cjs` at all, so there is no existing
  agent-side executable-invocation example to copy verbatim. Task now specifies the
  actual resolution snippet (cwd-independent discovery via `$CLAUDE_PROJECT_DIR` or
  walk-up-from-cwd) instead of leaving it for the executor to invent.
- **Task 5.1**: draft left target format implicit. Fixed to bracketed YAML array
  explicitly (matches the 3 newest agents; bare CSV is not a valid YAML sequence).
- **Task 5.3**: draft said "4 agents" (Rico, Marco, Pablo + implied Rafael). Confirmed
  Rafael already uses the target table format — corrected to 3 agents, Rafael is the
  copy-paste template.
- **Task 4.1**: draft's basis paragraph names 3 sites; confirmed real count is 11
  files. The task's own sweep grep already covered this, so behavior doesn't change,
  but the basis text now states 11 up front instead of undercounting, and flags that
  2 of the 11 (`a1-evolve/workflows/01-collect.md:7`, `04-apply.md:26,49`) need a
  reframing edit (Vault: "primary" → "fallback sink"), not pure find-replace.
- **Wave 2 gained one optional hardening item (Task 2.5, new)**: RESEARCH.md/MAP.md
  both independently recommend a second, redundant assertion in the existing CI
  "Install smoke test" step (a direct `test -L` on one new agent symlink) as
  belt-and-suspenders alongside `verify-install-sync.sh` — the smoke test and the
  sync check test different failure modes (symlink creation vs. list membership).
  Added as its own small task rather than folded into 2.3, so it can be skipped
  independently if Robert judges it redundant.
- **Task 2.1 scope note added**: MAP.md §2 flags an asymmetry — skills exclude
  `hero-animation-builder` by silent omission from the SKILLS array (no file-based
  mechanism), while Task 1.3's exclusion file is agent-scoped only. Made explicit in
  Task 2.1 that the checker's skills-side comparison must independently account for
  `hero-animation-builder` (it is simply not in `install.sh`'s SKILLS array nor
  README's skills table — both already agree on 17, so the checker's skills-side
  logic is "compare directories minus this one known name" even without a shared
  exclusion-file entry). No file format decision needed for this — noted so Task 2.1
  isn't executed with an unstated assumption.
- **Task 6.2 scope tightened**: confirmed via direct read of
  `a1-evolve/SKILL.md`'s "Input sources" table (4 generic source *types*, not a
  skill-by-skill list) — task wording now says exactly what to add (an inline list
  near that table) instead of "name the exact learning-enabled skill set" without
  saying where.
- Everything else (waves 1, 3, 6-partial, 7, all Done-when criteria, all dependency
  ordering) matched the live tree exactly on re-verification — left as drafted.

## Executor ground rules (apply to EVERY task)

- **No behavior changes to the CLI.** This phase touches docs, skill/agent prompts,
  install tooling, and CI — never `_shared/*.cjs` command semantics.
- **Full regression gate after every task that touches `bin/`, `.github/`, or `_test-fixtures/`:**
  ```bash
  cd <repo> && node --check _shared/a1-tools.cjs && \
  ok=1; for r in _test-fixtures/*/run*.sh; do bash "$r" >/dev/null || { echo "SUITE FAILED: $r"; ok=0; break; }; done; [[ $ok -eq 1 ]] && echo ALL-SUITES-GREEN
  ```
- **One commit per task**, conventional commits (`fix(install): ...`, `ci: ...`, `docs(skills): ...`).
  For sweep tasks touching many files (3.2, 4.1), one commit per *sweep*, not per file.
- Line numbers below were re-verified live during this planning pass (HEAD 7217d29,
  working tree clean). Locate by content (grep for the quoted phrase) first if the
  repo has moved on since; line numbers are orientation only.
- Waves 1–6 are mechanical and executor-safe. **Wave 7 tasks each carry a STOP
  gate** — they produce decision documents / diffs for Robert, never auto-apply.

## Success Criteria (binary)

- [ ] SC-1: Fresh `./bin/install.sh` on a clean `$HOME` symlinks **21** agents including `a1-samuel-security`, `a1-diana-docs`, `a1-dario-devops`; README agent table lists exactly those 21. The **skills** side (17 installed, `hero-animation-builder` excluded) stays unchanged and in sync throughout.
- [ ] SC-2: A deterministic sync check (repo dirs ↔ install.sh arrays ↔ README tables, **including the README scope-note comment's own claimed counts** — audit MAJOR-2 fix, 2026-07-12 — with a documented exclusion list) exists, fails on seeded drift in a fixture, and runs as a CI step. Re-introducing the samuel/diana/dario gap makes CI red.
- [ ] SC-3: Exactly one language-policy source of truth exists (`_shared/language-policy.md`); zero skills contain a local "in English"/"in German" user-output rule (sweep grep returns empty); a1-check's internal contradiction (SKILL.md:29 vs :100) is gone.
- [ ] SC-4: No active skill file claims artifacts "live in the Obsidian Vault" as default; all storage sections state repo-local `.a1/learnings/` default + `A1_VAULT_ROOT` override; the two `a1-evolve` "primary — the brain" framings are reworded to "fallback sink", not just word-swapped.
- [ ] SC-5: `agents/a1-victor-verifier.md` contains no `~/.claude/skills/` absolute path; both `a1-tools.cjs` invocation sites resolve cwd-independently.
- [ ] SC-6: All 21 agent files use one `tools:` frontmatter format (bracketed YAML array); `a1-aik-ai-engineer` and `a1-walter-web-developer` declare tools explicitly; every `model: opus` pin carries an inline justification comment.
- [ ] SC-7: a1-evolve's declared learning sources match reality: the 5 heavy pipeline skills without a retro mechanism gain one, and a1-evolve's SKILL.md names the exact learning-enabled skill set near its Input-sources table — no pauschal "all skills" claim.
- [ ] SC-8: Wave 7 produces one decision document per topic (check/checklist merge, Reinhard↔Samuel boundary, prose extraction, agent consolidation) with a clear recommendation each; none is auto-applied without Robert's confirmed choice.

---

## Wave 1 — Close the install gap (BLOCKER)

**Basis:** tooling survey — `bin/install.sh` AGENTS array (lines 67-86) lists 18
agents, repo has 21 (`ls agents/*.md` → 21); samuel/diana/dario added in `2f22541`
but never wired. A fresh install lacks `a1-samuel-security` although `a1-analyze`
spawns it as a mandatory security lane.

**Severity clarification (2026-07-12, tooling-survey follow-up, re-confirmed during
planning): this is not cosmetic, it is functionally broken on fresh install.**
`grep -rln "a1-samuel-security\|a1-diana-docs\|a1-dario-devops" skills/` shows all
three are actively referenced by 4 skills: `a1-new-feature` (SKILL.md +
`workflows/04-plan.md` + `05-implement.md`), `a1-fix` (`workflows/02-diagnose.md`),
`a1-analyze` (SKILL.md + `workflows/03-analyze.md` — spawns `a1-samuel-security` as
an always-on security lane per its own description). On a fresh `install.sh` run
that lane spawns an agent that doesn't exist as a symlink. Also note: README.md:12-21
contains an explicit "keeps the bijective install/README check honest" scope-note
comment claiming install.sh is Single Source of Truth for "17 skills + 18 agent
names" — that comment is itself now false (21 agents exist) and must be corrected
alongside the counts in Task 1.2, not left as stale prose.

**Confirmed unaffected:** the SKILLS array (`bin/install.sh:38-56`, 17 entries) and
README's "Skills (17)" table are currently in sync with each other and with the
18 skill directories minus `hero-animation-builder`. Wave 1 must not touch the
SKILLS array while fixing AGENTS.

### Task 1.1 — Add the three agents to install.sh
- Append `"a1-samuel-security"`, `"a1-diana-docs"`, `"a1-dario-devops"` to the
  AGENTS array in `bin/install.sh` (currently lines 67-86, 18 entries grouped
  roughly by pipeline role, not strictly alphabetical). Insert after the last
  existing entry (`"a1-theo-test-engineer"`, line 85) — lowest-risk insertion
  point, preserves diff-friendliness, no reordering of the other 18.
- **Done when:** `bash bin/install.sh` on a temp `$HOME` creates 21 agent symlinks; re-run is idempotent.

### Task 1.2 — Update README to the real set
- README.md: heading "Agents (18)" → "Agents (21)" (line 81); intro sentence
  "`install.sh` also symlinks 18 shared framework agents" → 21 (line 83); add three
  table rows (roles per agent description: security specialist / documentation
  specialist / devops-deploy specialist).
- Update the scope-note HTML comment (README.md:12-21) — it hardcodes "17 skills +
  18 agent names"; change to "17 skills + 21 agent names".
- **Done when:** README agent-table row count == `ls agents/*.md | wc -l` (21) == install.sh AGENTS array length (21).

### Task 1.3 — Document the deliberate exclusions
- `hero-animation-builder` sits in `skills/` (56 lines, `references/` + `scripts/`,
  no `workflows/` dir — structurally unlike every other skill) but is intentionally
  not installed and follows no a1 convention. Do NOT move it in this wave (Robert's
  call, see Task 7.4). It is a **skills-side** exclusion — see the scope note below
  for why it does NOT go in the file this task creates.
- **Format contract (fixes a cross-wave coupling flagged by RESEARCH.md §9.3 and
  MAP.md §11.1):** create `bin/install-exclusions.txt` as a flat list, one entry per
  line, format `<name>: <reason>`. This exact format is load-bearing for Task 2.1's
  parser (`bin/verify-install-sync.sh` reads this file to compute its exclusion
  set) — do not pick a different format (YAML, JSON, comma list) without updating
  Task 2.1 to match.
- **Scope (audit MAJOR-1 fix, 2026-07-12): agents only, file starts EMPTY.** All 21
  agents are meant to install — there are zero real agent-side exclusions today, so
  the file is created with zero content entries (a header comment stating its
  purpose and format is fine, e.g. `# <name>: <reason> — one entry per line, agents
  only`). Do **not** add `hero-animation-builder` to this file — it is a
  skills-side exclusion and has no file-based mechanism today (it's simply absent
  from the SKILLS array, which is already correct and in sync); Task 2.1's checker
  handles the skills side by comparing directories against the known-correct SKILLS
  array directly, not via this file. If a future agent-side exclusion is needed,
  add an entry to this same file/format rather than creating a second list.
- **Done when:** exclusion file exists in the agreed format (empty of content
  entries, header only), install.sh + README reference it, sync check (Wave 2)
  consumes it for the agents side.

---

## Wave 2 — Drift gate in CI (turn the README claim into a real check)

**Basis:** README:13 claims a "bijective install/README check" — no such check exists
in `.github/workflows/test.yml` (43 lines, 4 steps: syntax check, fixtures, install
smoke test, vault-free CLI check — confirmed by full read, none assert agent count or
README parity) or anywhere in `bin/`. Exactly this gap let Wave-1's drift happen one
day after the agents landed.

### Task 2.1 — `bin/verify-install-sync.sh`
- Deterministic bash (same conventions as fixture runners: `set -u`, no network):
  1. **Skills side:** `ls -d skills/*/` minus `hero-animation-builder` (the one known,
     currently-correct exclusion — no file dependency needed here since this side is
     already in sync) == install.sh SKILLS array == README skills table rows. All
     three should already agree (17 each) on a clean repo.
  2. **Agents side:** `ls agents/*.md` == install.sh AGENTS array == README agent
     table rows. All three should agree (21 each) after Wave 1.
  3. Counts printed for both sides; any mismatch → named diff to stderr, exit 1.
  4. **README scope-note comment (audit MAJOR-2 fix, 2026-07-12):** parse the two
     integers out of the README.md:12-21 HTML-comment claim ("17 skills + 21 agent
     names" after Task 1.2) — e.g. `grep -oE '[0-9]+ skills? \+ [0-9]+ agent'` or an
     equivalently tolerant pattern match against prose — and assert both numbers
     equal the live counts computed in checks 1–2. This is the 4th assertion; without
     it the comment itself becomes the next stale, unenforced claim (the exact defect
     this whole phase exists to close, per RESEARCH.md §9 risk #2 and MAP.md §11.3).
- Parse `bin/install-exclusions.txt` per the `<name>: <reason>` contract fixed in
  Task 1.3 for any *future* agent-side exclusions (empty today except the file's own
  existence) — if Task 1.3 changed the format, match it here instead of guessing.
- **Done when:** exits 0 on current (post-Wave-1) repo; exits 1 with a named diff when any of the four checks (both sides + the scope-note comment) is out of sync.

### Task 2.2 — Fixture suite `_test-fixtures/install-sync/`
- `run-tests.sh` per `_test-fixtures/CONVENTIONS.md` (verified: `set -u`,
  `pass=0 fail=0` counters, `assert_rc`/`assert_true` helpers, final summary echo +
  `[[ $fail -eq 0 ]]` exit gate — the house pattern, see
  `_test-fixtures/product-docs/run-tests.sh:820-871` for the reference style):
  copies repo lists into a `mktemp -d` (never mutate the live repo tree — per
  CONVENTIONS.md's isolation rule, point the checker at the copies, not
  `bin/verify-install-sync.sh` run directly against live state), asserts PASS on
  clean state, then seeds **four** drift cases (extra dir, missing install entry,
  stale README row, stale README scope-note comment count — audit MAJOR-2 fix,
  2026-07-12, mirrors Task 2.1's 4th assertion) and asserts exit 1 each.
- Include the mandatory "Hostile inputs" section (path traversal / oversized values
  per CONVENTIONS.md's 3-category requirement): dir name with spaces/newline,
  oversized exclusion file (≥10 000 chars). For the injection-shaped-input category
  (CONVENTIONS.md category b): document explicitly in the suite's own comments *why*
  it's N/A for a pure list-diff checker (no shell-evaluated input path) rather than
  silently omitting it — satisfies the "mandatory" framing without inventing a fake
  test case.
- **Done when (audit MINOR-1 fix, 2026-07-12):** suite green locally and via the CI
  glob; suite contains and exercises all four seeded-drift cases (extra dir, missing
  install entry, stale README row, stale scope-note comment count), each
  independently asserting exit 1, verifiable by
  `grep -c "assert.*rc.*1\|drift" _test-fixtures/install-sync/run-tests.sh` or
  equivalent; this becomes the 23rd fixture directory (22 exist today).

### Task 2.3 — CI step
- Add `bash bin/verify-install-sync.sh` as its own named step in
  `.github/workflows/test.yml`, inserted between the existing "Install smoke test"
  step and the "Vault-free CLI check" step (reuse the `HOME="$(mktemp -d)"` pattern
  already established one step prior; this step is the one place asserting against
  *live* repo state is correct — unlike the fixture suite, which must use copies).
- **Done when:** CI run green; seeding the samuel-gap locally makes the step fail.

### Task 2.4 — Runner-naming consistency
- `_test-fixtures/a1-cmd-injection/run.sh` is the sole holdout against
  CONVENTIONS.md's claim ("the historical mix of `run.sh` / `run-test.sh` /
  `run-tests.sh` was unified 2026-07-12") — confirmed: all other 21 suites already
  use `run-tests.sh`. Rename it to `run-tests.sh` (CI glob `run*.sh` is unaffected
  either way, so this is CI-neutral, purely a consistency fix — the smaller diff
  that makes the CONVENTIONS.md claim true rather than documenting an exception).
- **Done when:** `ls _test-fixtures/*/run*.sh` shows all 22 suites using `run-tests.sh`, matching CONVENTIONS.md's claim exactly.

### Task 2.5 (optional hardening, new this revision) — Redundant symlink assertion in the smoke test
- RESEARCH.md §9.1 and MAP.md §3 both independently flag: the existing "Install smoke
  test" CI step (`.github/workflows/test.yml`, currently asserts 3 specific symlinks:
  `a1-new-feature` positive, `_shared` positive, `checkpoint` negative) tests symlink
  *creation*; `verify-install-sync.sh` tests list *membership* — different failure
  modes. Add one more assertion to the existing step:
  `test -L "$HOME/.claude/agents/a1-samuel-security"`.
- This is optional belt-and-suspenders, not required for SC-2 (Task 2.1-2.3 alone
  satisfy SC-2). Include it if the executor judges the extra line low-risk; skip with
  a one-line note in the commit body if not.
- **Done when:** either the assertion is added and the smoke-test step still passes, or a commit-body note explains the skip.

---

## Wave 3 — One language policy

**Basis:** skills survey — contradictory user-output rules: "in English"
(a1-analyze:187, a1-constitution:154, a1-reconcile:176) vs "in German"
(a1-check:100, a1-phantom, a1-new-project:159 + workflows/02-scope.md:12,
a1-worktree:126, a1-pr-review); a1-fix:216 and a1-modernize:186 contain BOTH
markers on the same line; a1-check contradicts itself (line 29 "English-first" vs
line 100 "in German").

### Task 3.1 — `_shared/language-policy.md`
- Single source of truth, two rules only:
  1. **File artifacts** (specs, plans, frontmatter, IDs, reports written to disk): always English.
  2. **User-facing conversation output**: the user's language (never hardcode one).
- Keep it under ~20 lines. Note German trigger aliases stay supported (README language-policy section already says this).
- **Done when:** file exists (confirmed absent today) and is linked from CONTRIBUTING.md.

### Task 3.2 — Sweep all SKILL.md + workflows
- Replace every local user-output language rule with one line:
  `User-facing output language: see _shared/language-policy.md (artifacts English, conversation in the user's language).`
- Explicit fix list (verified live during planning, HEAD 7217d29):
  `a1-constitution/SKILL.md:154`, `a1-analyze/SKILL.md:187`, `a1-fix/SKILL.md:216`
  (dual marker, one line), `a1-new-project/SKILL.md:159`, `a1-modernize/SKILL.md:186`
  (dual marker, one line), `a1-reconcile/SKILL.md:176`, `a1-worktree/SKILL.md:126`,
  `a1-new-project/workflows/02-scope.md:12`, `a1-check/SKILL.md:29` vs `:100`
  contradiction. `a1-new-feature/workflows/02-specify.md:24` is artifact-scoped
  ("in English — the output is a technical artifact") — leave the sentence's
  meaning intact but point it at the shared file for consistency.
- **Done when:** `grep -rn "in German\|auf Deutsch\|in English" skills/*/SKILL.md skills/*/workflows/*.md` shows no user-output language mandates (trigger-alias mentions in skill descriptions/frontmatter are fine and must stay — this is the actual completion gate, not the enumerated list above, since new workflow files could exist beyond what was enumerated at planning time).

---

## Wave 4 — Storage prose + hardcoded paths

**Basis:** skills survey — "All artifacts live in the Obsidian Vault" prose predates
the M7 repo-local migration. Confirmed live: **11 files**, not 3 (the basis in the
original draft undercounted — full inventory below). Agents survey — Victor
hardcodes `~/.claude/skills/_shared/a1-tools.cjs` at two sites
(`a1-victor-verifier.md:94`, `:157`), breaking non-symlink installs (e.g. plugin
installs, per RESEARCH.md's `marketplace.json`/`plugin.json` check — the plugin path
is itself count-agnostic and immune to Wave 1's drift class, but a hardcoded symlink
path anywhere in agent bodies breaks under it regardless).

### Task 4.1 — Correct storage sections
- Full site inventory (`grep -rln "Obsidian Vault" skills/`, 11 files):
  `a1-new-feature/SKILL.md` (2 sites), `a1-evolve/workflows/01-collect.md` (1),
  `a1-evolve/workflows/04-apply.md` (2), `a1-modernize/SKILL.md` (2),
  `a1-reconcile/SKILL.md` (2), `a1-check/SKILL.md` (1),
  `a1-check/workflows/01-run-check.md` (1), `a1-execute/SKILL.md` (1),
  `a1-fix/_learning.md` (1), `a1-fix/SKILL.md` (2), `a1-analyze/SKILL.md` (3).
- For the 9 straightforward sites (SKILL.md Storage/frontmatter-state sections):
  reword to "repo-local default; external vault via `A1_VAULT_ROOT` (e.g.
  Obsidian)".
- For the 2 `a1-evolve` sites (`01-collect.md:7`, `04-apply.md:26,49`): these are
  **not** pure word-swaps — they currently frame the Vault as "primary — the brain".
  Per `_shared/learning-schema.md`'s own accurate 3-tier description (env >
  repo-local `.a1/learnings/` > legacy-vault-if-no-git-repo), the Vault is a
  *fallback sink* today, not primary. Reword the framing accordingly (repo-local is
  primary; Vault is the optional external sink), not just the literal phrase.
- Before editing `a1-fix/_learning.md` (a generated cache file, header reads "Fast
  access cache"): verify whether it's regenerated on every a1-fix Postmortem step —
  if so, a hand-edit here is a wasted no-op silently overwritten on next run; either
  edit the template/generator that produces it, or confirm it's hand-maintained
  before touching the file directly.
- **Done when:** `grep -rln "Obsidian Vault" skills/` returns empty (SC-4); the 3-tier fallback description in README stays untouched (it is already correct).

### Task 4.2 — De-hardcode Victor
- Replace both sites in `agents/a1-victor-verifier.md`:
  - line 94: `node ~/.claude/skills/_shared/a1-tools.cjs phantom check ...`
  - line 157: `node ~/.claude/skills/_shared/a1-tools.cjs cost run ...`
  with a cwd-independent resolution — **not** a bare relative path (breaks if Victor
  is invoked from a different depth). Concrete snippet: try `$CLAUDE_PROJECT_DIR`
  first if set, else walk up from cwd looking for a `_shared/a1-tools.cjs` marker
  file, e.g.:
  ```bash
  A1_TOOLS="${CLAUDE_PROJECT_DIR:-}/_shared/a1-tools.cjs"
  if [ ! -f "$A1_TOOLS" ]; then
    dir="$PWD"
    while [ "$dir" != "/" ]; do
      [ -f "$dir/_shared/a1-tools.cjs" ] && A1_TOOLS="$dir/_shared/a1-tools.cjs" && break
      dir="$(dirname "$dir")"
    done
  fi
  node "$A1_TOOLS" phantom check ...
  ```
  This is a **new pattern for this exact use** (no existing agent invokes
  `a1-tools.cjs` repo-relatively to copy verbatim — confirmed: the 3 newest agents
  reference the *learning store* repo-relatively, not `a1-tools.cjs` invocation), so
  don't search for a copy-paste template beyond the snippet above; do reuse the
  `.a1/learnings/` + `$A1_VAULT_ROOT` *wording convention* from
  `a1-samuel-security.md:109` / `a1-dario-devops.md:89` / `a1-diana-docs.md:92` if
  Victor's prose needs to describe the fallback verbally.
- Sweep the other 20 agent files for `~/.claude/skills` while at it — confirmed via
  full-repo grep only 2 more hits exist: `a1-reinhard-reviewer.md:51`
  (`ls ~/.claude/skills/ 2>/dev/null` — legitimate registry enumeration) and
  `a1-ludwig-legal.md:73` (`Glob: ... ~/.claude/skills/**/SKILL.md` — legitimate
  registry-enumeration glob). Leave both as-is; document them as intentionally-kept
  registry references in the commit body so a future auditor doesn't re-flag them.
- **Done when:** `grep -rn "~/.claude/skills" agents/` returns only the two documented registry-enumeration references (Reinhard:51, Ludwig:73), no executable invocation paths.

### Task 4.3 — Marco: haiku pin vs prompt complexity
- Agents survey: `a1-marco-mapper.md` is pinned `model: haiku` but instructs complex
  inline-Python/nested-grep pipelines, and fixates on `src/` (silently breaks on
  non-src layouts). Two-part mechanical fix: (a) simplify the mapping pipelines to
  plain grep/glob steps a haiku-tier model executes reliably, (b) replace `src/`
  fixation with "detect top-level source dirs first". Do NOT change the model pin
  in this wave (that would need a cost discussion — note it in the Wave-7 decision
  doc, Task 7.4 consumes this note).
- **Done when (audit MINOR-2 fix, 2026-07-12, split into two independently checkable clauses):**
  (1) `grep -c "python3\? -c" agents/a1-marco-mapper.md` == 0;
  (2) `grep -c "src/" agents/a1-marco-mapper.md` == 0 **and** the replacement text
  contains a dir-detection step (e.g. the phrase "detect top-level source dir" or
  equivalent — spot-checked via the commit message or a required phrasing).

---

## Wave 5 — Agent frontmatter consistency

**Basis:** agents survey — `tools:` field, verified across all 21 files: 13× bare
CSV, 6× bracketed YAML array, 2× missing entirely (`a1-aik-ai-engineer`,
`a1-walter-web-developer` — confirmed via grep, both silently inherit all tools);
Alex is the only opus pin without an inline justification
(`a1-alex-architekt.md:5`, confirmed bare `model: opus`, no comment — the other 3
opus pins, Falk/Reinhard/Samuel, all already carry justification comments).

### Task 5.1 — Unify `tools:` to bracketed YAML array across all 21 agents
- **Target format: bracketed YAML array** (`tools: [Read, Write, Bash, ...]`) —
  this is the format already used by the 3 newest agents (samuel, diana, dario) and
  by falk/reinhard/tobi from the earlier specialization pass; bare CSV after
  `tools:` parses as a single YAML scalar string, not a sequence, so bracketed array
  is the only form that's unambiguously correct if this frontmatter is ever
  machine-validated.
- Mechanical conversion for the 13 CSV files, no permission set may change EXCEPT
  Aik + Walter, which get an explicit `tools:` list matching their documented needs
  ("all tools" today — declare it deliberately, or scope it; if scoping, propose the
  list in the commit body for Robert's review rather than silently narrowing).
- **Done when:** `grep -c "^tools:" agents/*.md` == 21; every file uses the bracketed-array form; install smoke still green.

### Task 5.2 — Opus justification comment for Alex
- Add the same inline `# opus: ...` rationale comment style used by Falk/Reinhard/Samuel to `agents/a1-alex-architekt.md:5`.
- **Done when:** every `model: opus` line in agents/ carries a justification comment (grep-verifiable) — confirmed 4 total pins today (Alex, Falk, Reinhard, Samuel).

### Task 5.3 (MINOR) — Delegation-table format
- **Correction (2026-07-12, confirmed live during planning):** Rafael already uses a
  "Task | Owner" table (`agents/a1-rafael-reverse-spec.md:175`) — only **Rico
  (lines 22-26), Marco (lines 22-26), Pablo (lines 22-26)** actually use bullet
  lists where the other 18 use a table. Convert those three to the exact
  `| Task | Owner |` shape Rafael already has (use it as the copy-paste template).
  Content unchanged, format only.
- **Done when:** all 21 agents present their not-in-scope delegations as a table (was 20/21 pre-Wave-5 accounting for Rafael already being compliant; this task adds the remaining 3).

### Task 5.4 (MINOR, note-only — do not fix in this wave) — Two deeper format axes
- Agents survey follow-up identified two structural inconsistencies broader than
  frontmatter, explicitly flagged as decisions rather than mechanical fixes:
  (a) `description:` frontmatter has three mixed styles — quoted-single-line (alex,
  aik, ludwig, reinhard, tobi, uwe, vincente, walter), YAML block-scalar `|` (dario,
  diana, falk, samuel), bare-unquoted (adam, erik, marco, pablo, rafael, rene, rico,
  theo, victor) — the block-scalar style correlates exactly with the newest
  specialization-pass agents; (b) two full prompt-body dialects exist —
  `<role>`/`<not_in_scope>` XML tags (adam, erik, marco, pablo, rico, rafael, rene,
  victor, theo) vs. Markdown headings (dario, diana, samuel, falk). Both are real
  but out of scope for a mechanical audit-fix wave — carry them into the Wave-7
  consolidation decision doc (Task 7.4) as a named open question, do not silently
  pick one style here.
- **Done when:** Task 7.4's decision doc explicitly addresses both axes with a recommendation (adopt one style repo-wide, or leave as-is with reasoning).

---

## Wave 6 — Learning-loop honesty

**Basis:** skills survey — Retro coverage confirmed via direct SKILL.md prose
inspection (a literal `## Retro` heading grep returns zero matches everywhere —
Retro is documented as prose/table-rows in SKILL.md and implemented inside
`workflows/*.md`, which is the intended architecture, not a defect): 6 skills have
an explicit Retro-writing commitment (a1-execute, a1-analyze, a1-fix,
a1-new-feature, a1-new-project, a1-checklist), 5 gates/reporters are correctly
excluded by design (a1-phantom, a1-pr-review, a1-progress, a1-worktree, a1-check —
no LLM judgment produced), and 5 are the actionable gap. a1-evolve
(SKILL.md's "Input sources" table, ~lines 43-56) names 4 generic source *types*
(per-skill `_learning.md`, `observations.jsonl`, the canonical learning store,
a1-fix postmortems) — not an explicit skill-by-skill enumeration — while its
"Philosophy" prose implies broader coverage than exists.

**Clarification (2026-07-12, skills-survey follow-up, re-confirmed): the gap splits
into two groups.** 5 skills (a1-plan, a1-roadmap, a1-reconcile, a1-modernize,
a1-constitution) are LLM-judgment pipeline skills that should retro but don't —
Task 6.1 targets exactly those 5. The other excluded skills are legitimately
read-only/terminal and need no retro; `hero-animation-builder` is out of scope for
this repo's a1 conventions entirely (see Task 7.4) and was never a candidate.

### Task 6.1 — Retro mechanism for the 5 heavy pipeline skills
- Add the standard retro commitment (same pattern as a1-execute/a1-analyze: a
  reference in SKILL.md's phase table + the actual write step in the relevant
  `workflows/0N-*.md` file; schema per `_shared/learning-schema.md`) to: a1-plan,
  a1-roadmap, a1-reconcile, a1-modernize, a1-constitution. Confirmed today: each of
  these 5 has a `workflows/04-*.md`-ish file that mentions "Retro" only in passing,
  with no structured, self-contained write commitment.
- **Done when (audit MINOR-3 fix, 2026-07-12, added a concrete grep check):**
  `grep -rln '## Retro\|Retro:' skills/{a1-plan,a1-roadmap,a1-reconcile,a1-modernize,a1-constitution}/workflows/*.md`
  returns all 5 files; each match also references `_shared/learning-schema.md` by
  name (`grep -l learning-schema` on the same 5 files also returns all 5).

### Task 6.2 — Honest source list in a1-evolve
- The cheap deterministic gates (a1-check, a1-phantom, a1-checklist has one already)
  and read-only reporters (a1-progress, a1-pr-review, a1-worktree) deliberately have
  no retro. Add an explicit inline list near a1-evolve's "Input sources" table
  (SKILL.md, ~lines 43-56) naming the actual learning-enabled skill set (the 6
  confirmed-present + the 5 Task 6.1 adds = 11 total), plus one sentence explaining
  why gates/reporters are excluded (no LLM judgment → nothing to retro). This is a
  documentation addition only — the collect mechanism (glob over existing
  `_learning.md`/`observations.jsonl` files) already only picks up files that exist,
  so no logic change is needed; the honesty gap is specifically in the "Philosophy"
  section's implied "all skills" framing.
- **Done when:** a1-evolve SKILL.md lists the enabled set explicitly near the Input-sources table; the list matches reality (grep for Retro commitments == the list).

---

## Wave 7 — Structural decisions (each task: STOP gate, Robert decides)

**Rule for every task in this wave:** produce a short decision document under
`.a1/phases/M11-audit-fixes/decisions/<topic>.md` (options, recommendation,
effort, risk) plus — where useful — a ready-to-apply diff. **Never apply without
Robert's explicit choice.**

### Task 7.1 — a1-check ⊂ a1-checklist merge
- Skills survey: a1-check's 3 invariants are a de-facto subset of a1-checklist's
  gate logic; both are thin CLI wrappers, both pre-implementation gates. Note the
  tension flagged by MAP.md §9: their SKILL descriptions already draw an explicit
  "distinct from" boundary against each other, so any merge decision must reconcile
  that existing framing, not just the mechanics.
  Options: (a) merge a1-check into a1-checklist as check #9 with its own exit
  semantics, keep `a1-check` as deprecated alias one release; (b) keep both,
  sharpen the boundary text. Recommendation: (a).
- **Done when:** decision doc exists with migration steps incl. a1-new-feature Phase-4.5 wiring impact.

### Task 7.2 — Operationalize the Reinhard ↔ Samuel security boundary
- Agents survey: Reinhard runs two full security phases (phase 5 + AI-code audit,
  `a1-reinhard-reviewer.md:113-124`) before Samuel is ever considered — duplicated
  work; the "escalate to Samuel" boundary is asserted in prose but not
  operationalized. Proposal to draft: Reinhard's phase 5 becomes a short triage
  checklist with named escalation triggers ("finding class X/Y/Z → hand to
  a1-samuel-security"), Samuel owns depth.
- **Done when:** decision doc with the concrete replacement checklist text exists.

### Task 7.3 — Extract postmortem prose from Pablo/Erik/Victor prompts
- Agents survey: a1-evolve keeps appending dated postmortem paragraphs into agent
  prompts (Pablo 3.5-3.7, Erik 3c-ter/3c-quater) — knowledge drifts from principle
  to prose and grows unboundedly. Proposal: move recurring-lesson prose into
  referenced workflow/reference files; agent prompts keep one-line principles.
  Also define the a1-evolve rule going forward (append to reference file, not prompt).
- **Done when:** decision doc + example diff for one agent (Pablo) exists.

### Task 7.4 — Agent + skill consolidation review
- Candidates with evidence: Theo (single caller: a1-modernize Phase 6, confirmed via
  grep — referenced in SKILL.md ×3 + `06-execute.md`/`05-plan.md`), Rafael (single
  caller: a1-modernize Phase 2, confirmed — SKILL.md ×3 + `02-reverse-spec.md`),
  Diana (**zero** references in any `skills/` file — genuinely orphaned pending a
  decision: is she user-invoked directly, or should a skill spawn her? Currently
  neither skills nor her own agent file resolves this), Ludwig (largely duplicates
  the installed `legal` Claude Code plugin — diff Ludwig's GDPR/EU-AI-Act
  specificity against the plugin's generic contract/compliance tools before
  recommending drop vs. keep). Plus: hero-animation-builder's location outside the
  a1 skill convention (repo root `_extras/` or a separate repo — 56 lines,
  `references/`+`scripts/` only, no `workflows/`), and Marco's haiku pin (from Task
  4.3's note — this note is a hard dependency: Task 7.4 must run after Task 4.3
  lands so the note exists to consume).
  For each: keep / merge / drop with one-paragraph rationale and what breaks if dropped.
- **Also address (from Task 5.4):** the two deeper format axes — (a) `description:`
  frontmatter style (quoted-single-line vs YAML block-scalar vs bare-unquoted;
  block-scalar correlates with the 3 specialization-pass agents) and (b) prompt-body
  dialect (`<role>`/`<not_in_scope>` XML tags on 9 older agents vs Markdown headings
  on the 4 newest: dario, diana, samuel, falk). Recommend adopt-one-style-repo-wide
  vs leave-as-is, with reasoning — do not let these two quietly disappear into the
  "not this wave" gap between 5.4 and here.
- **Also address (new candidates surfaced by MAP.md §9, planner's discretion — include
  if time allows, these are decision-doc inputs not mechanical tasks):** (a) the
  `a1-check ⊂ a1-checklist` overlap is already Task 7.1's own topic — cross-reference
  rather than duplicate; (b) lifecycle-gate logic shared between a1-new-feature
  (~1507 workflow LOC, six hard-rule gates) and a1-fix (~224 LOC) is a candidate for
  extraction to a shared `_shared/lifecycle-gates.md` reference — note it but flag
  the risk of ballooning into cross-wave scope creep; (c) a "Versions" section exists
  in only 4/18 skills (a1-analyze, a1-constitution, a1-modernize, a1-reconcile) —
  minor consistency point, standardize or drop.
- **Done when:** decision doc covers all six original consolidation candidates, both format-axis questions, and the three MAP.md-surfaced additions, each with a recommendation; nothing deleted or reformatted.

---

## Dependencies

```
Wave 1 (install gap)  →  Wave 2 (drift gate needs the clean state to assert PASS)
Wave 3, 4, 5, 6       →  independent of each other; all after Wave 1 (avoid rebase noise in README)
Wave 7                →  last; consumes notes from 4.3 and 5.4; STOP-gated per task
```

## Explicitly out of scope

- Any `_shared/*.cjs` behavior change (CLI is frozen this phase).
- Executing Wave-7 decisions — this phase only produces the decision docs.
- The M8 launch tasks (posts, stars) — separate track, Robert's call.
- Moving hero-animation-builder — decision first (Task 7.4), move later if chosen.
- `.claude-plugin/marketplace.json` / `plugin.json` — verified count-agnostic
  (`"source": "./"` references the whole repo), immune to the count-drift bug class
  this phase fixes; no task touches them.
