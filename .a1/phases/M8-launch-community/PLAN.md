---
phase: M8-launch-community
goal: Ship every adoption enabler for launch — marketplace-installable plugin, English-only workflows, contributor entry points, and publication-ready launch assets — while marking outcome metrics (stars, external PRs) as time-deferred.
spec: docs/roadmap.md (M8 section, lines 65-81) + RESEARCH.md + MAP.md
waves: 5
status: audited
created: 2026-07-05
---

# Plan: M8 — Launch & Community (Enablers)

## Goal
Ship every adoption enabler for launch — marketplace-installable plugin, English-only workflows, contributor entry points, and publication-ready launch assets — while marking outcome metrics (stars, external PRs) as time-deferred.

## Scope note on roadmap success criteria
Roadmap M8 mixes **buildable** SCs with **outcome** SCs that depend on the public's reaction after Robert/Sabine publish. This plan builds enablers only:
- Buildable, verified here: plugin installable via marketplace; gate-pack published (`packs/postgres-rls/` already exists in the public repo — satisfiable now, mark checked with a note).
- Time-deferred, NOT claimed by this plan: launch posts live, ≥100 stars, ≥1 external PR merged. Wave 5 marks these in the roadmap as `(time-deferred — enablers shipped M8, outcome pending publication)`.

**Out of scope:** actually publishing HN/Reddit/LinkedIn posts, star-count chasing, hosted pack registry, `_shared` architecture doc (stretch, not M8).

## Frozen naming decision (supersedes MAP)
The marketplace `name` in `.claude-plugin/marketplace.json` is canonically **`a1-specforge`** — identical to the plugin name. MAP.md's template value `"a1-specforge-marketplace"` is **superseded**; do not copy it. All install/uninstall commands in this plan (`a1-specforge@a1-specforge`, `claude plugin marketplace remove a1-specforge`) and the README string depend on this.

## Success Criteria
- [ ] SC-1: Repo is a valid self-hosted Claude Code plugin marketplace: `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` exist, 17 skills live under `skills/`, agents under `agents/`, and a local plugin-install validation passes (or a documented manual verification step for Robert exists if headless validation is impossible).
- [ ] SC-2: `install.sh` (dev/contributor path) still works post-move: fresh-HOME smoke test + all fixture suites + CI green after push.
- [ ] SC-3: Zero German prose lines remain in `skills/*/workflows/*.md` — grep gate returns 0 (excluding trigger aliases and `_learning.md` files).
- [ ] SC-4: Community entry points exist: `CODE_OF_CONDUCT.md`, 3-5 good-first-issue drafts + gh command list for Robert, CONTRIBUTING points to `packs/postgres-rls/` as worked example and distinguishes plugin-install (users) from clone+symlink (contributors).
- [ ] SC-5: A simulated external-contributor dry-run (fresh clone → CONTRIBUTING verbatim → pack export → PR-ready branch) succeeds; any friction found is fixed in this phase.
- [ ] SC-6: Launch assets committed: `docs/demo.tape` + rendered `docs/demo.gif` (referenced from README hero), and `docs/launch/{show-hn.md,reddit.md,linkedin.md}` drafts grounded in real numbers, hype-free, clearly marked DRAFT.
- [ ] SC-7: Roadmap M8 SCs updated (buildable checked, outcome time-deferred with note); retro written to `a1-plan` learning locations (local `_learning.md` + Vault via `A1_VAULT_ROOT`).

## Conventions (all waves)
- One commit per task, exact message given per task. Suggested agent per wave noted in the wave header.
- All commands run from `/Users/rob/code/a1-skills` unless stated.
- "Done when" = command(s) with expected exit code / output. Do not proceed to the next wave with a red gate.
- gh-account gotcha: active `gh` account (`n3urala1-rob`) has READ-only on `mellow-rob/a1-specforge`. Anything requiring write via `gh` (issue creation) is drafted as files + a command list for Robert instead.
- Fixture loop convention (used in Tasks 1.2 and 2.1): CI runs the nested parser runner as an extra step, so the local gate must too:
  ```bash
  fail=0; for r in _test-fixtures/*/run*.sh _test-fixtures/a1-schema-check/parser/run-parser.sh; do echo "== $r"; bash "$r" || fail=1; done; echo "FIXTURES_EXIT=$fail"; exit $fail
  ```

---

## Wave 1 — Plugin restructuring (structural, HIGH risk, own rollback checkpoint)
**Suggested agent:** a1-executor (single agent, sequential tasks — these tasks share files and are NOT parallel; execute 1.1 → 1.2 → 1.3 in order within this wave).

**Rollback checkpoint:** Before Task 1.1, record `git rev-parse HEAD` into `.a1/phases/M8-launch-community/STATUS.md` as `rollback_sha`. If any Wave 1 gate fails and cannot be fixed forward, `git reset --hard <rollback_sha>`.

**Push policy (conscious choice per audit m3):** Do NOT push mid-wave after Task 1.2's local gates. Push once, after Task 1.3's commit, so the public repo never shows the moved layout without plugin manifests. Task 1.2's CI check therefore runs after that single push (see Task 1.2 step 4).

### Task 1.1: Move 17 skill dirs under `skills/` and update install.sh + CONTRIBUTING + stale doc paths
**Goal:** Repo layout matches plugin convention (`skills/` root dir) with git history preserved, and both breaking consumers (install.sh, CONTRIBUTING.md) plus all stale repo-layout doc references updated in the same commit.
**Actions:**
1. `mkdir skills`
2. History-preserving move of all 17 skill dirs (exact list = the 17 skill entries in install.sh's SKILLS array, i.e. everything except `_shared`):
   ```bash
   for d in a1-new-feature a1-fix a1-analyze a1-check a1-checklist a1-constitution a1-worktree a1-pr-review a1-phantom a1-reconcile a1-plan a1-execute a1-progress a1-roadmap a1-evolve a1-modernize a1-new-project; do git mv "$d" "skills/$d"; done
   ```
   Do NOT move `_shared/`, `agents/`, `_test-fixtures/`, `packs/`, `bin/`, `docs/`.
3. Edit `bin/install.sh`:
   - Remove `"_shared"` from the `SKILLS` array (keep the other 17 entries).
   - Change the skills loop source path to `"$REPO_DIR/skills/$skill"`.
   - After the loop, add an explicit line: `symlink_item "$REPO_DIR/_shared" "$SKILLS_DIR/_shared" "_shared"` (with a comment: `# _shared is a helper dir, not a skill — lives at repo root`).
4. Edit `CONTRIBUTING.md` skill-structure section (~lines 21-35): change layout example `a1-<name>/` → `skills/a1-<name>/`; in the "Adding a skill" steps, state new skills are created at `skills/a1-<name>/`.
5. Update known stale repo-layout references (these are repo-path references, not runtime symlink paths — update all to `skills/`-prefixed):
   - `docs/CONSTITUTION.md` lines ~13 and ~56: `a1-evolve/workflows/03-propose.md` → `skills/a1-evolve/workflows/03-propose.md` (2 occurrences).
   - `_shared/learnings-index.md` lines ~8-20 (pattern-anchor "owning file" column): `a1-<name>/workflows/...` → `skills/a1-<name>/workflows/...` — decision: these columns are repo-layout references, so prefix them.
   - `_shared/gates-registry.md` "owning file" column: audit confirmed it uses skill **names**, not paths — verify that's still true; if any entry is a path, prefix it with `skills/`.
6. Check a1-evolve collect globs: `grep -rn "a1-\*/_learning\|a1-\*/\*_learning\|a1-[a-z-]*/_learning" skills/a1-evolve/ _shared/ | grep -v '~/.claude\|skills/a1-'` — any repo-layout glob like `a1-*/_learning.md` must become `skills/a1-*/_learning.md`. (Runtime `~/.claude/skills/...` globs stay unchanged — symlink names are stable.)
7. Sanity-greps for remaining repo-layout references (exclude runtime `~/.claude/skills/` refs, which are symlink names and stay valid):
   ```bash
   # prefixed forms
   grep -rn '\$REPO_DIR/a1-\|"\./a1-\|(\./a1-' bin/ .github/ docs/ README.md CONTRIBUTING.md skills/ _test-fixtures/ 2>/dev/null | grep -v '~/.claude' || true
   # bare relative skill paths (workflows/SKILL.md anchors)
   grep -rn '\ba1-[a-z-]*/workflows/\|\ba1-[a-z-]*/SKILL\.md' docs/ _shared/ README.md CONTRIBUTING.md 2>/dev/null | grep -v '~/.claude\|skills/a1-' || true
   ```
   Fix any hits: update to `skills/a1-...` if it is a repo path; leave and document (in the commit body) only if it is provably a runtime `~/.claude/skills/`-relative anchor. (Per MAP: expect none in fixtures — `../../` depth is unchanged; CI test.yml needs no change.)
8. Commit: `refactor(layout): move 17 skill dirs under skills/ for plugin packaging (history-preserving git mv)`
**Done when:** `ls skills | wc -l` prints `17`; `ls -d a1-* 2>/dev/null` prints nothing; `git log --follow --oneline skills/a1-fix/SKILL.md | wc -l` ≥ 2 (history preserved); `bash -n bin/install.sh` exits 0; both sanity-greps in step 7 return no unexplained hits.
**Covers:** SC-1, SC-2

### Task 1.2: Verify the move — fixture suite + fresh-HOME install smoke + fresh-machine simulation
**Goal:** Prove nothing broke before adding plugin manifests; this is the rollback checkpoint gate.
**Actions:**
1. Run all fixture suites **including the nested parser runner** (the Conventions fixture-loop command — `_test-fixtures/*/run*.sh` alone misses `_test-fixtures/a1-schema-check/parser/run-parser.sh`, which CI runs explicitly):
   ```bash
   fail=0; for r in _test-fixtures/*/run*.sh _test-fixtures/a1-schema-check/parser/run-parser.sh; do echo "== $r"; bash "$r" || fail=1; done; echo "FIXTURES_EXIT=$fail"; exit $fail
   ```
2. Fresh-HOME install smoke (same pattern as CI and M7's transcript):
   ```bash
   export TMP_HOME=$(mktemp -d) && HOME="$TMP_HOME" bash ./bin/install.sh && HOME="$TMP_HOME" test -L "$TMP_HOME/.claude/skills/a1-new-feature" && HOME="$TMP_HOME" test -L "$TMP_HOME/.claude/skills/_shared" && HOME="$TMP_HOME" test -L "$TMP_HOME/.claude/agents/a1-rico-researcher.md" && echo SMOKE_OK
   ```
3. Fresh-machine simulation (reuse M7 VERIFICATION.md transcript commands — read `.a1/phases/M7-oss-ready/VERIFICATION.md` and re-run its fresh-machine block: clean-clone to a temp dir, run install.sh with a temp HOME, run one CLI command e.g. `node _shared/a1-tools.cjs --help` or the vault-free check, confirm writes land repo-local `.a1/learnings/` with zero file edits).
4. CI check is **deferred until after Task 1.3's single push** (see wave push policy). At that point confirm the run is green non-interactively — `gh run watch` without an ID prompts and hangs headless, so resolve the ID first:
   ```bash
   run_id=$(gh run list --workflow=test.yml --limit 1 --json databaseId --jq '.[0].databaseId') && gh run watch "$run_id" --exit-status
   ```
   (Read access suffices for watching.)
5. No commit for this task if all green (verification only). If fixes were needed, commit: `fix(layout): post-move path fixes found by fixture/smoke verification`
**Done when:** `FIXTURES_EXIT=0`; `SMOKE_OK` printed; fresh-machine simulation transcript matches M7 expectations; (after the Wave-1 push) `gh run watch "$run_id" --exit-status` exits 0.
**Covers:** SC-2

### Task 1.3: Add plugin.json + marketplace.json and validate plugin install locally
**Goal:** Repo is a self-hosted marketplace with a validated (or manually-verifiable, documented) plugin.
**Actions:**
1. Create `.claude-plugin/plugin.json` per the template in MAP.md ("Schema & Plugin Manifest Template" section): `name: "a1-specforge"` (frozen — immutable slug), version `1.0.0`, `skills: "skills"`, `agents: "agents"`, author Robert Heine, MIT, repo URL `https://github.com/mellow-rob/a1-specforge`. Omit the `commands`/`hooks`/`mcpServers` null fields entirely (cleaner than explicit nulls).
2. Create `.claude-plugin/marketplace.json`: marketplace `name: "a1-specforge"` — **MAP template's `"a1-specforge-marketplace"` is superseded, do not copy it** (see "Frozen naming decision" above); one plugin entry `name: "a1-specforge"`, `source: "./"`.
3. Confirm agent-frontmatter audit still holds (MAP found 0, re-verify): `grep -l 'hooks:\|mcpServers:\|permissionMode:' agents/*.md || echo AGENTS_CLEAN` — must print `AGENTS_CLEAN`.
4. `python3 -c "import json;[json.load(open(f)) for f in ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json']];print('JSON_OK')"`
5. Local plugin-install validation, attempt in this order (per research: [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [plugins-reference](https://code.claude.com/docs/en/plugins-reference)):
   a. Headless CLI: `claude plugin marketplace add /Users/rob/code/a1-skills && claude plugin install a1-specforge@a1-specforge --scope local` — then verify the plugin's skills are listed/loadable; afterwards uninstall + remove marketplace to avoid clobbering Robert's symlink setup (`claude plugin uninstall a1-specforge` / `claude plugin marketplace remove a1-specforge`). Use `--scope local` (project) precisely so user-scope symlinks stay untouched.
   b. If the `claude plugin` CLI subcommand is unavailable headless or errors non-actionably: install Anthropic's `plugin-dev` toolkit validation if reachable, else SKIP execution and instead write `docs/plugin-install-verification.md` — a step-by-step manual verification for Robert (`/plugin marketplace add mellow-rob/a1-specforge`, `/plugin install a1-specforge@a1-specforge`, `/reload-plugins`, check `@a1-specforge:` typeahead namespace, then uninstall). Record which path was taken in STATUS.md.
6. Add a "Install via plugin marketplace (users)" subsection to `README.md` install section with the 3-command flow, keeping `./bin/install.sh` documented as the contributor/dev path (live-edit symlinks).
7. Commit: `feat(plugin): add plugin.json + marketplace.json (self-hosted marketplace) + README plugin-install docs`
8. Push now (single Wave-1 push, per wave push policy), then run Task 1.2 step 4's CI check.
**Done when:** `JSON_OK` and `AGENTS_CLEAN` printed; EITHER local `claude plugin install` succeeded and was cleanly removed, OR `docs/plugin-install-verification.md` exists with the manual steps; README contains string `plugin install a1-specforge`; push done and CI green per Task 1.2 step 4.
**Covers:** SC-1

---

## Wave 2 — M7-rest German→English sweep
**Suggested agent:** a1-executor.

### Task 2.1: Translate all remaining German lines in workflow files, with grep gate
**Goal:** All ~55-60 German prose lines across the 19 workflow files inventoried in MAP.md are English; a pragmatic grep gate proves zero remain.
**Actions:**
1. Work strictly from the MAP.md inventory table ("German Workflow Content" section, 19 files — note post-move paths are now `skills/<name>/workflows/...`): `skills/a1-new-feature/workflows/06-verify.md`, `skills/a1-fix/workflows/00-preflight.md`, `skills/a1-new-project/workflows/{01-bootstrap,02-scope,04-feature-split,05-feature-loop}.md`, `skills/a1-fix/workflows/04-verify.md`, `skills/a1-modernize/workflows/{01-scope,02-reverse-spec,03-gap-analysis,04-tech-proposals,05-plan,06-execute,07-publish}.md`, `skills/a1-new-feature/workflows/04-plan.md`, `skills/a1-analyze/workflows/05-report.md`, `skills/a1-execute/workflows/03-verify.md`, `skills/a1-pr-review/workflows/01-detect.md`, `skills/a1-worktree/workflows/03-exit.md`.
2. Translate in-place, line-by-line: preserve exact Markdown structure, code fences, variable/placeholder syntax, and heading levels. No restructuring. User-facing prompt strings get natural English, not word-for-word calques.
3. Define and run the German-marker gate (umlauts/ß plus common German function words in prose; exclude `_learning.md` files and intentional trigger-alias lines — if a skill lists German trigger phrases as aliases in SKILL.md frontmatter/tables, those are out of scope since the gate only scans `workflows/`):
   ```bash
   grep -rnE '[äöüßÄÖÜ]| (der|die|das|und|nicht|wird|noch|schon|dann|wenn|für|über) ' skills/*/workflows/*.md | grep -v '_learning' ; test $? -eq 1 && echo GERMAN_ZERO
   ```
   Manually review any residual hits: fix real German; if a hit is a false positive (e.g. proper noun), whitelist it by adjusting the grep and document the exception in the commit body.
   **Note (audit m2): the grep gate has false-negative risk** — umlaut-free German lines without the listed function words slip through (e.g. `"Magst du ..."` in a1-modernize/02-reverse-spec.md). The MAP inventory is the authoritative source; the grep is a secondary safety net. After translating, additionally skim each inventoried file end-to-end for residual German.
4. Re-run the full fixture suite (the Conventions fixture-loop command, including the nested parser runner) — translations touch active workflow prompt strings; fixtures catch accidental structural breakage.
5. Commit: `docs(i18n): translate remaining ~60 German workflow lines to English (M7-rest sweep)`
**Done when:** `GERMAN_ZERO` printed (or documented whitelist exceptions only); all inventoried files visually confirmed German-free; `FIXTURES_EXIT=0`.
**Covers:** SC-3

---

## Wave 3 — Community polish
**Suggested agent:** a1-executor. Tasks 3.1 and 3.2 are parallel (disjoint files except CONTRIBUTING — 3.1 owns CONTRIBUTING edits); 3.3 runs after both.

### Task 3.1: CODE_OF_CONDUCT + CONTRIBUTING additions
**Goal:** Standard OSS trust signals and the two CONTRIBUTING gaps from RESEARCH.md closed.
**Actions:**
1. Create `CODE_OF_CONDUCT.md` at repo root: Contributor Covenant v2.1 verbatim, enforcement contact = GitHub issues on `mellow-rob/a1-specforge` (no personal email hardcode — M7 hardcode-sweep rule).
2. Append to `CONTRIBUTING.md`:
   - In the gate-pack section: "See `packs/postgres-rls/` for a complete worked example (pack.yaml + 3 patterns) — read it before authoring your first pack."
   - New short section "Using vs. contributing": plugin marketplace install for users; clone + `./bin/install.sh` symlinks for contributors (live-edit).
   - One sentence review expectation: PRs are typically reviewed within a few days; ping the issue if a week passes.
3. Commit: `docs(community): add CODE_OF_CONDUCT (Contributor Covenant 2.1) + CONTRIBUTING gap fixes`
**Done when:** `test -f CODE_OF_CONDUCT.md` exits 0; `grep -c 'postgres-rls' CONTRIBUTING.md` ≥ 1; `grep -ci 'plugin' CONTRIBUTING.md` ≥ 1.
**Covers:** SC-4

### Task 3.2: Seed good-first-issue drafts (files + gh command list for Robert)
**Goal:** 3-5 concrete, well-scoped starter tasks ready to publish as labeled issues.
**Actions:**
1. Create `.github/good-first-issues.md` containing 4 fully-written issue drafts, each with: title, body (context, exact files, done-criteria, pointer to CONTRIBUTING), and label line `good first issue`. Candidates (adjust to post-Wave-2 reality — do NOT include German translation if Wave 2 finished it): (a) add a fixture test for an uncovered CLI subcommand, (b) contribute a gate-pack from your own project's learnings (using postgres-rls as template), (c) add a missing edge-case section to a named workflow file, (d) improve install.sh error message when Node <18.
2. At the bottom, add a "Publish (Robert)" section with ready-to-paste commands — note the gh-account gotcha explicitly: run `gh auth switch --user mellow-rob` first (active account `n3urala1-rob` is read-only), then one `gh issue create --repo mellow-rob/a1-specforge --title "..." --body-file ... --label "good first issue"` per draft. Do NOT attempt `gh issue create` in this task.
3. Commit: `docs(community): seed 4 good-first-issue drafts + publish command list`
**Done when:** `grep -c '^## Issue' .github/good-first-issues.md` (or equivalent heading count) ≥ 3; file contains `gh issue create` and `gh auth switch`.
**Covers:** SC-4

### Task 3.3: Simulated external-contributor dry-run
**Goal:** A stranger following CONTRIBUTING verbatim reaches a PR-ready branch with a pack export; friction found becomes fixes.
**Actions:**
1. Fresh clone to scratch: `git clone /Users/rob/code/a1-skills /private/tmp/claude-501/-Users-rob-code-a1-skills/5c1d7d8c-4fb8-4a42-9d94-4715b3fdd8e9/scratchpad/contrib-dryrun && cd .../contrib-dryrun`.
2. Follow `CONTRIBUTING.md` literally, step by step, as written (no insider knowledge): setup (`./bin/install.sh` against a temp HOME), then the gate-pack contribution path: create a minimal dummy pack via the documented CLI export/validate flow (`node _shared/a1-tools.cjs` pack subcommands as CONTRIBUTING documents them), commit on a branch named per the documented convention, verify `git status` clean and the pack validates.
3. Log every point where the doc is wrong, ambiguous, or assumes missing context. For each finding, fix CONTRIBUTING.md (or install.sh/CLI help text) in the main repo — findings become fixes, not a report.
4. Delete the scratch clone.
5. Commit (main repo, only if findings existed): `docs(community): fix contributor-flow friction found in dry-run (<n> findings)`. If zero findings, no commit; note "0 findings" in STATUS.md.
**Done when:** Dry-run transcript shows pack `validate` exiting 0 on a PR-ready branch in the scratch clone; every logged finding has a corresponding fix committed (or "0 findings" recorded).
**Covers:** SC-5

---

## Wave 4 — Launch assets (drafts only — publication is Robert/Sabine, explicitly NOT this plan)
**Suggested agent:** a1-executor (4.1); a1-executor or a1-marco-mapper docs-mode (4.2). 4.1 and 4.2 are parallel; 4.3 depends on 4.1.

### Task 4.1: VHS demo tape + committed GIF
**Goal:** Reproducible terminal demo GIF from a committed `.tape` source, using a toy run against `_test-fixtures` — no live SaaS, no faked output.
**Actions:**
1. Check/install tooling: `which vhs ttyd ffmpeg || brew install vhs ttyd ffmpeg` (vhs pulls ttyd/ffmpeg as deps on brew).
2. Write `docs/demo.tape`: Set FontSize 16, Width 1200, Height 700, Output `docs/demo.gif`. Script a short (≤45s) real run against fixture infrastructure — e.g. `bash _test-fixtures/a1-check/run-tests.sh` or a `node _shared/a1-tools.cjs` command sequence (checklist run / pack validate on `packs/postgres-rls`) that shows real gate output. Use `Sleep` to pace; no fabricated echo output. Pick whichever fixture renders the clearest visible gate/check narrative.
3. Render: `vhs docs/demo.tape` → produces `docs/demo.gif`. Check size: `du -h docs/demo.gif` — if >5 MB, reduce dimensions/duration and re-render (GitHub README GIFs should stay small).
4. If vhs/ttyd cannot be installed in this environment: still commit `docs/demo.tape` plus `docs/launch/demo-recording-steps.md` with the exact render command for Robert, and note this in STATUS.md (Task 4.3 then skips the GIF embed and adds a TODO comment instead).
5. Commit: `docs(launch): add VHS demo tape + rendered demo GIF`
**Done when:** `test -f docs/demo.tape` exits 0 AND (`test -f docs/demo.gif` exits 0 OR the fallback recording-steps doc exists with STATUS.md note).
**Covers:** SC-6

### Task 4.2: Launch post drafts — Show HN, Reddit, LinkedIn raw material
**Goal:** Three publication-ready drafts in `docs/launch/`, concrete and hype-free, grounded in real numbers.
**Actions:**
1. Gather real numbers first (do not invent): 15 applied patterns (per phase-goal brief; cross-check `pattern/a1-learnings/patterns.md` in the Vault or `_shared/learnings-index.md` and use the actual current count), 17 skills, 18 agents, 15 fixture suites, dated provenance of the learning corpus, the gate mechanism (BLOCKER/MAJOR/MINOR), zero-dependency Node CLI.
2. Create `docs/launch/show-hn.md`: title `Show HN: a1-specforge – Spec-driven development pipeline for Claude Code with a self-learning quality-gate loop` (literal, no superlatives per HN guidelines); body = builder-voice explanation of the mechanism (retros → pattern clustering → gates applied back into skills), real numbers, honest limitations section; plus a prepared author top-level comment with technical depth. Header: `> DRAFT — publication is Robert's manual action. Do not post same-day as Reddit.`
3. Create `docs/launch/reddit.md` (r/ClaudeAI): show-don't-tell — embeds/links `docs/demo.gif`, first-person author disclosure, different copy from HN (not a cross-post), invites the good-first-issues. Same DRAFT header.
4. Create `docs/launch/linkedin.md`: explicitly RAW MATERIAL for Sabine, not a finished post — N3URAL.AI framing, "what we learned building a self-learning dev pipeline" angle, bullet metrics, gate examples; header notes Sabine adapts voice/format.
5. Forbidden-word self-check: `grep -inE 'revolutionary|game.chang|best|fastest|first ever|10x' docs/launch/*.md` must return nothing.
6. Commit: `docs(launch): draft Show HN + Reddit + LinkedIn launch content (drafts, hype-free)`
**Done when:** All three files exist under `docs/launch/`; each contains the string `DRAFT`; forbidden-word grep exits 1 (no matches).
**Covers:** SC-6

### Task 4.3: README hero section with demo GIF
**Goal:** README leads with the demo.
**Actions:**
1. Add the GIF directly under the README title: `![a1-specforge demo](docs/demo.gif)` plus a one-line caption naming what the demo shows. If Task 4.1 fell back to no-GIF: add `<!-- TODO(Robert): embed docs/demo.gif once rendered — see docs/launch/demo-recording-steps.md -->` instead.
2. Verify README skill table still matches install.sh (M7 bijective-diff invariant) — no drift introduced by M8: re-run the M7 diff check from its VERIFICATION.md; if the check script/commands aren't recoverable, do a manual name-by-name diff of README table vs. install.sh SKILLS array.
3. Commit: `docs(readme): add demo GIF hero section`
**Done when:** `grep -c 'demo.gif' README.md` ≥ 1; README↔install.sh skill-set diff is empty.
**Covers:** SC-6

---

## Wave 5 — Close-out
**Suggested agent:** a1-executor.

### Task 5.1: Roadmap M8 SC check-off with time-deferred markers
**Goal:** Roadmap honestly reflects enabler-vs-outcome status.
**Actions:**
1. Edit `docs/roadmap.md` M8 success criteria:
   - `[x] Plugin installable via marketplace` — append `(validated <date>, see .a1/phases/M8-launch-community/; manual /plugin verification step documented if applicable)`.
   - Split the mixed lines: `[x] ≥ 1 gate-pack published (packs/postgres-rls, live in public repo since M7/2026-07)`; `[ ] Launch posts live; ≥ 100 GitHub stars (time-deferred — drafts shipped in docs/launch/, publication is Robert/Sabine)`; `[ ] ≥ 1 external PR merged (time-deferred — enablers shipped: good-first-issue drafts, CoC, contributor dry-run validated)`.
2. Commit: `docs(roadmap): M8 close-out — buildable SCs checked, outcome SCs marked time-deferred`
**Done when:** `grep -c 'time-deferred' docs/roadmap.md` ≥ 2; the plugin and gate-pack SCs are `[x]`.
**Covers:** SC-7

### Task 5.2: Retro — local learning cache + Vault mirror
**Goal:** Standard a1 learning-loop entry for this plan/execution.
**Actions:**
1. Append a retro entry to `skills/a1-plan/_learning.md` (post-move path) in the standard format:
   ```
   ✅ Was gut war: ...
   ⚠️ Was nicht passte / verbessert werden könnte: ...
   💡 Suggestion: <one concrete improvement>
   ```
   Content: honest assessment of the M8 plan/execution (e.g. did the git-mv blast-radius prediction hold; was the plugin-install headless validation possible; dry-run finding count).
2. Mirror to the Vault with explicit root: `A1_VAULT_ROOT="$HOME/N3URAL-Vault"` → append the same entry to `$A1_VAULT_ROOT/pattern/a1-learnings/a1-plan.md` (create heading with date `2026-07-05`+actual execution date). Vault is canonical; local file is cache. **Fallback (audit m4):** if the Vault path is absent (`test -d "$A1_VAULT_ROOT/pattern/a1-learnings"` fails), skip the mirror, note "Vault unavailable — local cache is source until next sync" in STATUS.md, and the Done-when's Vault half is satisfied by that note.
3. Commit (repo file only; Vault is outside the repo): `chore(retro): M8 launch-community retro in a1-plan learning cache`
**Done when:** Local `_learning.md` contains a new dated M8 entry with the ✅/⚠️/💡 triple; Vault mirror written OR "Vault unavailable" noted in STATUS.md; `git log -1 --format=%s` matches the commit message.
**Covers:** SC-7

---

## Verification
After all waves complete, verify the goal was achieved:
- [ ] `ls skills | wc -l` = 17; `.claude-plugin/plugin.json` + `marketplace.json` valid JSON (marketplace name = `a1-specforge`); plugin install validated locally OR `docs/plugin-install-verification.md` exists for Robert.
- [ ] Fixture loop (incl. nested parser runner) all exit 0; fresh-HOME install smoke passes; latest GitHub Actions run green (via resolved run ID + `gh run watch --exit-status`).
- [ ] German-marker grep over `skills/*/workflows/*.md` returns zero (whitelisted exceptions documented); MAP inventory files skimmed clean.
- [ ] `CODE_OF_CONDUCT.md`, `.github/good-first-issues.md` (≥3 drafts + gh commands), CONTRIBUTING postgres-rls pointer + plugin-vs-dev section all present; contributor dry-run findings all fixed or "0 findings" in STATUS.md.
- [ ] `docs/demo.tape` committed; `docs/demo.gif` committed and referenced in README (or documented fallback); `docs/launch/{show-hn,reddit,linkedin}.md` exist, marked DRAFT, forbidden-word grep clean.
- [ ] Roadmap M8: 2 SC-parts checked, outcome parts marked time-deferred; retro present in local `_learning.md` and Vault `pattern/a1-learnings/a1-plan.md` (or documented Vault-unavailable note).
- [ ] No bare repo-layout `a1-*/` references remain in docs/CONSTITUTION.md, `_shared/learnings-index.md`, `_shared/gates-registry.md` (all `skills/`-prefixed or runtime-symlink anchors).

## Revision Notes (audit patch, 2026-07-05)
Revision after AUDIT.md verdict PASS_WITH_WARNINGS (0 blockers, 3 majors, 4 minors). Status set to `audited`.
- **M1 fixed:** Marketplace name frozen as `a1-specforge` everywhere; new "Frozen naming decision" section explicitly supersedes MAP's `a1-specforge-marketplace` template value; Task 1.3 step 2 warns the executor not to copy it.
- **M2 fixed:** Task 1.1 gained (step 5) explicit updates for `docs/CONSTITUTION.md` (2× `a1-evolve/workflows/03-propose.md`) and the `_shared/learnings-index.md` / `_shared/gates-registry.md` owning-file columns (decision: repo-layout references → `skills/`-prefixed); (step 6) an a1-evolve collect-glob check (`a1-*/_learning.md` → `skills/a1-*/_learning.md`); (step 7) a second, broader sanity grep catching bare `a1-*/workflows/` and `a1-*/SKILL.md` anchors. Done-when extended.
- **M3 fixed:** Task 1.2 step 4 now resolves the run ID non-interactively (`gh run list --workflow=test.yml --limit 1 --json databaseId --jq '.[0].databaseId'`) before `gh run watch <id> --exit-status`.
- **m1 fixed:** Fixture loop (Conventions + Tasks 1.2/2.1) now includes `_test-fixtures/a1-schema-check/parser/run-parser.sh`.
- **m2 fixed:** Task 2.1 notes false-negative risk of the German grep; MAP inventory declared authoritative, plus end-to-end skim of inventoried files.
- **m3 fixed:** Wave 1 push policy — single push after Task 1.3, CI check deferred to that point (no manifest-less public state).
- **m4 fixed:** Task 5.2 Vault-absent fallback (STATUS.md note, local cache as source).
- All passing tasks otherwise unchanged.
