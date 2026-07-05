---
phase: M7-oss-ready
goal: An external user goes from `git clone` to first verified feature without editing a single file
spec: docs/roadmap.md (M7 section) + .a1/phases/M7-oss-ready/RESEARCH.md
waves: 5
status: audited
created: 2026-07-05
revised: 2026-07-05
---

# Plan: M7 OSS-Ready

## Goal
An external user goes from `git clone` to first verified feature without editing a single file.

## Success Criteria
- [ ] SC-1: Fresh-machine test (no vault, clean `~/.claude`, `A1_VAULT_ROOT` unset): install → a1-tools spec/fix/analyze writes land in repo-local `.a1/learnings/`, zero file edits by user
- [ ] SC-2: CI green on PRs — all fixture runners pass on ubuntu/node 20, incl. a new a1-phantom runner, plus install.sh smoke test on a clean `$HOME`
- [ ] SC-3: README is the single source of truth for the installed skill set (all 17 skills, honest metrics, quickstart, `A1_VAULT_ROOT` documented as optional)
- [ ] SC-4: `checkpoint/` removed from the public repo; Robert's local workflow keeps working
- [ ] SC-5: No `/Users/rob`, `~/code/a1-skills`, or `~/N3URAL-Vault` hardcodes in active skill code/shell snippets (whitelisted: `.a1/phases/` history, `_learning.md` retros)

**Explicit scope cap (language):** M7 unifies only user-facing SKILL.md fronts (description, trigger tables, language policy line) to English-first with German aliases. Full translation of German workflow bodies (a1-fix, a1-modernize, a1-analyze prompts) is deferred to M8. State this in the README language policy.

**Out of scope:** M8 launch content, plugin packaging, gate-packs, `lint.yml` hardcode-linter (nice-to-have, not an M7 success criterion), full workflow-body translation.

**Conventions for all tasks:** one commit per task, conventional commit format (`feat`, `fix`, `docs`, `test`, `chore`, `ci` with scope). Every Done-when is a command + expected exit code.

---

## Wave 1 — Vault fallback chain (foundation; everything else builds on it)

### Task 1.1: Implement vaultRoot() fallback chain + fixture test
**Goal:** `a1-tools.cjs` resolves the learning store via a 3-tier chain with no silent degradation, proven by a fixture test that runs with a fake HOME and unset env.

**Canonical contract (supersedes the RESEARCH.md "Vault Fallback Chain" reference implementation — its Tier 4 is DELETED; do not copy it verbatim):**
- Inside a git repo with nothing else resolving → **auto-create** repo-local `.a1/learnings/` (this is Tier 2, and it always succeeds inside a repo).
- Hard-fail (exit 2) ONLY when **not inside a git repo AND `A1_VAULT_ROOT` is unset AND no legacy vault exists**. The error must name `A1_VAULT_ROOT` and suggest running inside a git repo.

**Actions:**
1. Edit `/Users/rob/code/a1-skills/_shared/a1-tools.cjs` — replace `vaultRoot()` (lines ~256–258) with the fallback chain:
   - Tier 1: `process.env.A1_VAULT_ROOT` if set (use as-is; create dir on first write).
   - Tier 2: if inside a git repo (`git rev-parse --show-toplevel` succeeds), use `<repo>/.a1/learnings/`; auto-create with `fs.mkdirSync(..., { recursive: true })`. When the directory is created for the first time, print `[a1-tools] created .a1/learnings/` to stderr.
   - Tier 3: legacy `~/N3URAL-Vault` ONLY if the directory already exists AND Tier 2 is unavailable (not in a git repo); print deprecation warning to stderr: `[a1-tools] Using legacy vault ~/N3URAL-Vault — set A1_VAULT_ROOT or run inside a git repo for repo-local .a1/learnings/`.
   - If none resolve (no env, not in a git repo, no legacy vault): exit 2 with a clear error telling the user to set `A1_VAULT_ROOT` or run inside a git repo. NO silent fallback. There is NO Tier 4.
   - **Status line (no silent degradation), emitted from `vaultRoot()` itself:** print once per process (module-level flag, first call only) to stderr: `[a1-tools] learnings root: <resolved path> (source: env|repo-local|legacy)`. This single choke point covers all 32 `vaultRoot()` call sites — including `spec next-number`, `fix next-suffix`, `analyze init`, `constitution init` AND every `wiki/`-writing subcommand (postmortem, promote, lessons/suggest). Do NOT emit per-subcommand.
   - Precedence note: env wins over repo-local; repo-local wins over legacy (Rob's machine keeps writing to the vault only via `A1_VAULT_ROOT` — document this in the function comment).
2. Create `/Users/rob/code/a1-skills/_test-fixtures/a1-vault-fallback/run.sh` (pattern: copy structure from `_test-fixtures/a1-check/run-tests.sh`). Cases, each with `env -u A1_VAULT_ROOT HOME=$(mktemp -d)`:
   - Case A (env wins): `A1_VAULT_ROOT=$TMP/vault node _shared/a1-tools.cjs spec next-number demo` → path under `$TMP/vault`, exit 0, stderr contains `source: env`.
   - Case B (repo-local): unset env, cwd = a fresh `git init` temp dir → file lands in `<tmp-repo>/.a1/learnings/projects/demo/spec/`, exit 0, stderr contains `source: repo-local`, dir auto-created.
   - Case C (legacy): unset env, cwd = non-git temp dir, `mkdir $FAKEHOME/N3URAL-Vault` → resolves legacy, exit 0, stderr contains deprecation warning.
   - Case D (repo-local auto-create + status): unset env, cwd = fresh `git init` temp dir with NO `.a1/` present → exit 0, `.a1/learnings/` created, stderr contains `created .a1/learnings/` AND `source: repo-local`.
   - Case E (hard fail): unset env, non-git cwd, no legacy dir → exit 2, error message mentions `A1_VAULT_ROOT`.
   - Case F (wiki subcommand, proves the choke point): unset env, cwd = fresh `git init` temp dir, invoke a `wiki/`-writing subcommand (e.g. the postmortem or lessons/suggest path — confirm exact CLI name in a1-tools.cjs) → exit 0, write lands under `<tmp-repo>/.a1/learnings/`, stderr contains `source: repo-local`.
3. Verify existing fixtures still pass: `for f in _test-fixtures/*/run*.sh; do bash "$f"; done`.
4. Commit: `feat(tools): vault fallback chain env > repo-local .a1/learnings > legacy, with status line + fixture`.
**Done when:** `bash _test-fixtures/a1-vault-fallback/run.sh` exits 0 (all 6 cases) AND all pre-existing fixture runners exit 0.
**Covers:** SC-1, SC-5

---

## Wave 2 — Hardcode sweep + checkpoint isolation (parallel; all independent file sets)

### Task 2.1: a1-evolve shell snippets → dynamic paths
**Goal:** a1-evolve works from any clone location without a vault.
**Actions:**
1. Edit `a1-evolve/workflows/01-collect.md:9` and `a1-evolve/workflows/04-apply.md:28` — replace `VAULT="$HOME/N3URAL-Vault"` with:
   ```bash
   VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"
   ```
2. Edit `a1-evolve/workflows/04-apply.md:58-59` (and any other `git -C ~/code/a1-skills` in that file) — replace with `REPO_ROOT="$(git rev-parse --show-toplevel)"` + `git -C "$REPO_ROOT" ...`.
3. Edit `a1-evolve/SKILL.md` description: "Commits applied changes to ~/code/a1-skills/" → "Commits applied changes to the skills repo (detected via git)".
4. Commit: `fix(evolve): dynamic vault + repo-root resolution in shell snippets`.
**Done when:** `grep -rn 'N3URAL-Vault\|~/code/a1-skills' a1-evolve/` returns no matches (exit 1 from grep).
**Covers:** SC-5

### Task 2.2: SKILL.md prose defaults sweep
**Goal:** All user-facing docs state the new default: repo-local `.a1/learnings/`, `A1_VAULT_ROOT` optional.
**Actions:**
1. Update the "Default vault root: ~/N3URAL-Vault/" prose in the 7 files inventoried in MAP.md ("Vault Hardcodes in Prose"): `a1-new-feature/SKILL.md:138`, `a1-modernize/SKILL.md:150`, `a1-reconcile/SKILL.md:133`, `a1-check/SKILL.md:68`, `a1-analyze/SKILL.md:119`, `a1-constitution/SKILL.md:114`, `a1-fix/workflows/00-preflight.md:46-47`. New wording everywhere: "Learning store defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` to use an external vault (e.g. Obsidian)."
2. Sweep for stragglers: `grep -rln 'N3URAL-Vault' --include='*.md' a1-*/ _shared/` and patch every active-skill hit (leave `_learning.md` retro bodies and `.a1/phases/` untouched — historical).
3. Commit: `docs(skills): learning store defaults to repo-local .a1/learnings, A1_VAULT_ROOT optional`.
**Done when:** `grep -rl 'N3URAL-Vault' a1-*/SKILL.md a1-*/workflows/` returns nothing (exit 1).
**Covers:** SC-3, SC-5

### Task 2.3: /Users/rob example cleanup
**Goal:** No personal paths in shippable skill files.
**Actions:**
1. Patch the inventory from MAP.md ("Personal Path References"): `a1-plan/_learning.md:45` (generalize path), `a1-modernize/workflows/01-scope.md:38` (replace with `<project-root>` placeholder). Then sweep: `grep -rn '/Users/rob' a1-*/ agents/ _shared/ bin/ README.md docs/` and generalize every hit in active files (`.a1/phases/` history is whitelisted).
2. Commit: `chore: remove personal path examples from skill files`.
**Done when:** `grep -rl '/Users/rob' a1-*/ agents/ _shared/ bin/ README.md docs/` returns nothing (exit 1).
**Covers:** SC-5

### Task 2.4: Remove checkpoint from public repo (private-overlay move)
**Goal:** `checkpoint/` (personal Cloud-Brain skill with `BRAIN_ROBERT_TOKEN` usage) is out of the OSS repo, and Robert's `~/.claude/skills/checkpoint` keeps working.
**Decision (simplest robust option):** Replace Robert's symlink with a **real directory** in `~/.claude/skills/checkpoint` — copy the content there before deleting from the repo. No private repo, no overlay script needed; the skill just lives where Claude Code reads it.
**Actions:**
1. Migrate locally first: `rm ~/.claude/skills/checkpoint && cp -R /Users/rob/code/a1-skills/checkpoint ~/.claude/skills/checkpoint` (verify `test -f ~/.claude/skills/checkpoint/SKILL.md && test ! -L ~/.claude/skills/checkpoint` — the copy must be a real directory, not a leftover symlink).
2. `git rm -r checkpoint/`.
3. Add `checkpoint/` to `.gitignore` (create/append) so it can never be re-committed.
4. Remove the checkpoint comment lines from `bin/install.sh` (~lines 55–56).
5. Add a migration note `docs/checkpoint-migration.md` (3 lines): checkpoint is personal tooling, removed in M7; it now lives as a plain directory in `~/.claude/skills/checkpoint`; external users skip it.
6. Commit: `chore(oss): remove personal checkpoint skill from public repo`.
**Done when:** `test ! -e checkpoint && grep -q '^checkpoint/' .gitignore && ! grep -qi checkpoint bin/install.sh && test -f ~/.claude/skills/checkpoint/SKILL.md && test ! -L ~/.claude/skills/checkpoint` — all true (exit 0).
**Covers:** SC-4

---

## Wave 3 — Phantom runner, README, language fronts (parallel)

### Task 3.1: a1-phantom fixture runner (deterministic nested-repo bootstrap)
**Goal:** The 3 phantom fixture dirs (`clean/`, `no-code-tag/`, `phantoms/`) run automatically and pass locally AND on a fresh clone.
**Key fact:** `git clone` never transports nested `.git/` dirs (they are stripped) and gitlinks clone empty. Therefore the runner must **never rely on committed `.git/` state** — it git-inits the nested fixture repos deterministically from the committed file trees on every run.
**Actions:**
1. Ensure the fixture *content files* (PLAN.md, src/, etc.) are committed in the main tree: run `git ls-files _test-fixtures/a1-phantom | head` and `git ls-tree HEAD _test-fixtures/a1-phantom/clean`. If step shows pure gitlinks (content NOT in the tree): `git rm --cached` the three subdirs, remove nested `.git/` dirs from tracking, re-add the file contents so a fresh clone carries them.
2. Create `_test-fixtures/a1-phantom/run.sh` (template: `_test-fixtures/a1-check/run-tests.sh`):
   - **Idempotent bootstrap step (runs unconditionally every time):** for each subdir, if `git -C "$dir" log -1` fails for ANY reason (no `.git`, empty `.git`, no commits), do `rm -rf "$dir/.git" && git -C "$dir" init -q && git -C "$dir" add -A && git -C "$dir" -c user.email=ci@test -c user.name=ci commit -qm fixture`. Missing-content detection uses **file presence** (e.g. `test -f "$dir/PLAN.md"`), NOT `git rev-parse` failure — a failed rev-parse is the *expected* fresh-clone state, not an error. There is NO "fail with a message listing what to restore" branch.
   - Run the phantom check (`node "$REPO_ROOT/_shared/a1-tools.cjs" phantom-check ...` — confirm the exact subcommand name in a1-tools.cjs / a1-phantom/SKILL.md and use it) against each subdir.
   - Expect: `clean/` → exit 0; `no-code-tag/` and `phantoms/` → exit non-zero with findings. Report pass/fail counts, exit 1 on any failure.
3. Commit: `test(phantom): fixture runner with deterministic nested-repo bootstrap`.
**Done when:** `bash _test-fixtures/a1-phantom/run.sh` exits 0, AND it also exits 0 when run from a fresh temp clone: `git clone . $(mktemp -d)/repo && bash <clone>/_test-fixtures/a1-phantom/run.sh` (this clone strips nested `.git/`, so it proves the bootstrap), AND running it twice in a row exits 0 both times (idempotence).
**Covers:** SC-2

### Task 3.2: README rewrite (single source of truth)
**Goal:** README documents exactly the installed skill set and honest project metrics; quickstart works verbatim.
**Actions:**
1. Rewrite `README.md` with sections:
   - What it is (spec-driven Claude Code skill framework), quickstart: `git clone` → `./bin/install.sh` → run a skill. No env vars required.
   - **Skill table — all 17 installed skills** (must match `bin/install.sh` SKILLS array exactly): a1-analyze, a1-check, a1-checklist, a1-constitution, a1-evolve, a1-execute, a1-fix, a1-modernize, a1-new-feature, a1-new-project, a1-phantom, a1-plan, a1-pr-review, a1-progress, a1-reconcile, a1-roadmap, a1-worktree. One-line purpose each.
   - Agents (17 shared framework agents), `_shared/a1-tools.cjs` CLI.
   - **Honest metrics:** CLI ~5.4k LOC, 10+ fixture test suites (incl. new vault-fallback + phantom runners), no inflated claims.
   - Configuration: `A1_VAULT_ROOT` optional; default repo-local `.a1/learnings/`; fallback chain summary.
   - Language policy: "English-first; German trigger phrases remain supported as aliases. Some workflow bodies are still mixed-language (full unification: M8)."
   - Note that `checkpoint` is not part of the public set.
2. **Bijective cross-check (both directions):** the skill set in install.sh and the skill set named in the README skill table must be *identical* — no missing skills, no extras (e.g. `checkpoint` or future M8 skills):
   ```bash
   diff <(grep -o 'a1-[a-z-]*' bin/install.sh | sort -u) \
        <(grep -o 'a1-[a-z-]*' README.md | sort -u)
   ```
   (If README legitimately mentions non-installed names in prose, scope the README grep to the skill-table section.)
3. Commit: `docs(readme): rewrite — full skill set, quickstart, honest metrics, A1_VAULT_ROOT optional`.
**Done when:** the bijective `diff` above exits 0 (empty diff, both directions), and README contains `A1_VAULT_ROOT` and `.a1/learnings`.
**Covers:** SC-3

### Task 3.3: Language unification — SKILL.md fronts only (capped)
**Goal:** All 17 SKILL.md files are English-first in description/trigger tables, German kept as aliases. **Cap: workflow bodies are NOT translated in M7** (deferred to M8).
**Actions:**
1. For each SKILL.md with German description or trigger table (inventory: MAP.md "Language Status" — a1-check, a1-fix, a1-modernize, a1-phantom, a1-pr-review, a1-worktree, plus the 5 undocumented: a1-plan, a1-execute, a1-progress, a1-roadmap, a1-evolve): rewrite description/triggers in English, append German phrases as aliases (e.g. `"bug in X" (alias: "X funktioniert nicht")`).
2. Add one line to each of the 17 SKILL.md files: `Language: English-first; German trigger aliases supported.`
3. Do NOT touch workflow bodies (00-*.md prompts stay as-is for M7).
4. Commit: `docs(skills): English-first SKILL.md fronts with German trigger aliases (workflow bodies deferred to M8)`.
**Done when:** `grep -L 'German trigger aliases' a1-*/SKILL.md` returns nothing (exit 1 from grep -L producing no output → check with `[ -z "$(grep -L ...)" ]` exit 0).
**Covers:** SC-3

---

## Wave 4 — CI

### Task 4.1: GitHub Actions test workflow (with POSIX-portability pre-flight)
**Goal:** Every push/PR runs all fixture suites, syntax-checks the CLI, and smoke-tests install.sh on a clean HOME.
**Actions:**
1. **POSIX portability audit (BEFORE enabling CI):** the existing fixture runners were written and tested only on macOS. Grep all runners and shell scripts for BSD/macOS-only idioms and port every hit to POSIX/GNU-compatible form:
   ```bash
   grep -rn "sed -i ''\|stat -f\|date -r\|date -j\|readlink [^-]\|mktemp -t " _test-fixtures/ bin/
   ```
   Typical ports: `sed -i ''` → write to temp file + `mv`; `stat -f` → `stat -c` guard or pure-shell alternative; BSD `date` flags → `date -d`/epoch arithmetic or node one-liner.
2. Create `.github/workflows/test.yml`:
   - Trigger: `on: [push, pull_request]`; `runs-on: ubuntu-latest`; `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: '20'`.
   - Step "Syntax check": `node --check _shared/a1-tools.cjs`.
   - Step "Fixtures": `set -e; for r in _test-fixtures/*/run*.sh; do echo "== $r"; bash "$r"; done` (this picks up a1-phantom/run.sh from Task 3.1 and a1-vault-fallback/run.sh from Task 1.1; a1-schema-check's parser/run-parser.sh is nested — add it explicitly if the glob misses it: `bash _test-fixtures/a1-schema-check/parser/run-parser.sh`).
   - Step "Install smoke test":
     ```bash
     export HOME="$(mktemp -d)"
     bash ./bin/install.sh
     test -L "$HOME/.claude/skills/a1-new-feature"
     test -L "$HOME/.claude/skills/_shared"
     test ! -e "$HOME/.claude/skills/checkpoint"
     ```
   - Step "Vault-free CLI check": `env -u A1_VAULT_ROOT HOME="$(mktemp -d)" node _shared/a1-tools.cjs spec next-number ci-demo` inside the checked-out repo → must exit 0 and write under `.a1/learnings/`.
2b. Ensure `.gitignore` covers `.a1/learnings/` (add if missing) so CI-generated files never pollute diffs.
3. Push branch, open PR (`gh` on the mellow-rob account — note gotcha: active gh account may be read-only; switch accounts), confirm the workflow run.
4. Commit: `ci: test workflow — fixtures, node --check, install.sh smoke on clean HOME`.
**Done when:** the portability grep from Action 1 returns zero unresolved hits, AND — if docker is available — the full fixture suite passes inside a linux container (`docker run --rm -v "$PWD":/repo -w /repo node:20 bash -c 'for r in _test-fixtures/*/run*.sh; do bash "$r" || exit 1; done'` exits 0; if docker is NOT available, record the untested-on-linux risk in the commit message and rely on the first CI run), AND `gh run watch --exit-status` (or `gh run list --workflow=test.yml --limit 1` shows `completed success`) — exit 0.
**Covers:** SC-2

---

## Wave 5 — Goal-backward proof + close-out

### Task 5.1: Fresh-machine simulation test
**Goal:** Prove SC-1 end-to-end: clean HOME, unset A1_VAULT_ROOT, temp clone, zero file edits.
**Note (expected behavior, do not be surprised):** the local-path `git clone` strips nested `.git/` dirs inside `_test-fixtures/a1-phantom/` — so if the phantom runner is exercised here, its deterministic bootstrap step (Task 3.1) WILL trigger. That is intentional and doubles as an integration test of the bootstrap.
**Actions:**
1. Run locally:
   ```bash
   export HOME="$(mktemp -d)"
   unset A1_VAULT_ROOT
   TMP="$(mktemp -d)" && git clone /Users/rob/code/a1-skills "$TMP/a1-specforge" && cd "$TMP/a1-specforge"
   bash ./bin/install.sh
   test -L "$HOME/.claude/skills/a1-new-feature" && test ! -e "$HOME/.claude/skills/checkpoint"
   node _shared/a1-tools.cjs spec next-number fresh-demo    # → .a1/learnings/projects/fresh-demo/spec/
   node _shared/a1-tools.cjs analyze init fresh-demo general
   test -d .a1/learnings/projects/fresh-demo
   git status --porcelain | grep -v '^??' | wc -l   # 0 tracked modifications = zero file edits
   ```
2. Capture the transcript into `.a1/phases/M7-oss-ready/VERIFICATION.md` (fresh-machine section) with each check's exit code.
3. Commit: `test(m7): fresh-machine simulation transcript in VERIFICATION.md`.
**Done when:** every command above exits 0; spec file exists under `.a1/learnings/`; zero tracked file modifications.
**Covers:** SC-1, SC-4

### Task 5.2: Roadmap update + retro
**Goal:** Close the milestone.
**Actions:**
1. Reconcile roadmap ↔ plan SCs: `docs/roadmap.md` M7 lists only 3 criteria but this plan has 5 (SC-4 checkpoint removal, SC-5 no personal paths are missing there). **Add the 2 missing criteria to the roadmap's M7 section first**, then check off all 5 with a one-line evidence pointer each (fixture name / CI run URL / README).
2. Write the retro to two places, explicitly:
   - Local cache: `~/.claude/skills/a1-execute/_learning.md` (✅ / ⚠ / 💡 format).
   - Vault canonical: because the new default resolves repo-local, writing to the Vault requires the env var set explicitly — `A1_VAULT_ROOT="$HOME/N3URAL-Vault" node _shared/a1-tools.cjs ...` (or append directly to `~/N3URAL-Vault/pattern/a1-learnings/a1-execute.md`). Do NOT rely on the default resolution here; unset it would land in `.a1/learnings/` instead.
3. Commit: `docs(roadmap): M7 OSS-Ready success criteria checked`.
**Done when:** `grep -c '\- \[x\]' docs/roadmap.md` increased by 5 in the M7 section (3 existing + 2 newly added); retro present in both locations.
**Covers:** SC-1, SC-2, SC-3 (bookkeeping)

---

## Verification
After all waves:
- [ ] `bash _test-fixtures/a1-vault-fallback/run.sh` (6 cases incl. wiki subcommand + hard-fail exit 2) and `bash _test-fixtures/a1-phantom/run.sh` exit 0
- [ ] `for r in _test-fixtures/*/run*.sh; do bash "$r" || exit 1; done` exits 0
- [ ] GitHub Actions `test.yml` green on the M7 PR
- [ ] `grep -rl 'N3URAL-Vault\|/Users/rob\|~/code/a1-skills' a1-*/ agents/ _shared/ bin/ README.md docs/` → no active-file hits (exit 1)
- [ ] `test ! -e checkpoint && test -f ~/.claude/skills/checkpoint/SKILL.md && test ! -L ~/.claude/skills/checkpoint` exits 0
- [ ] `diff <(grep -o 'a1-[a-z-]*' bin/install.sh | sort -u) <(grep -o 'a1-[a-z-]*' README.md | sort -u)` exits 0 (bijective)
- [ ] Fresh-machine transcript in VERIFICATION.md shows spec written to `.a1/learnings/` with zero file edits

---

## Revision Notes (2026-07-05, warning-patch after AUDIT.md PASS_WITH_WARNINGS)

- **M1 (Tier-4 contradiction):** Canonical contract stated in Task 1.1: auto-create repo-local `.a1/learnings/` inside a git repo (with `created .a1/learnings/` status line); hard-fail exit 2 ONLY outside a git repo with no env and no legacy. RESEARCH.md Tier 4 explicitly superseded. Fixture Case D repurposed (auto-create + status), new Case E (hard fail, exit 2).
- **M2 (wiki/ call sites):** Status line now emitted from `vaultRoot()` itself (module-level once-flag) — single choke point covering all 32 call sites incl. wiki subcommands. New fixture Case F proves a wiki subcommand resolves repo-local.
- **M3 (macOS idioms):** Task 4.1 gained Action 1: grep+port BSD idioms (`sed -i ''`, `stat -f`, BSD date, bare readlink) to POSIX before enabling CI; Done-when requires linux-container fixture run if docker available, else documented risk.
- **M4 (phantom fresh clone):** Task 3.1 bootstrap is now unconditional/idempotent (`rm -rf .git && git init && add && commit` whenever `git log -1` fails); missing-content check via file presence (`PLAN.md`), not rev-parse; "fail with clear message" branch removed. Done-when adds idempotence (two consecutive runs).
- **M5 (one-directional README check):** Task 3.2 check made bijective via `diff` of both sorted grep sets; also added to final Verification.
- **m1:** Task 2.4 done-when adds `test ! -L ~/.claude/skills/checkpoint`.
- **m2:** Task 5.1 now flags that the local clone strips nested `.git/` and the phantom bootstrap triggering is intentional.
- **m3:** Task 5.2 retro write to Vault now explicitly sets `A1_VAULT_ROOT` (default would resolve repo-local).
- **m4:** Task 5.2 adds the 2 missing criteria (SC-4, SC-5) to the roadmap M7 section before check-off; count expectation updated 3 → 5.
- No MINORs skipped. Waves/tasks otherwise unchanged; frontmatter set to `status: audited`.
