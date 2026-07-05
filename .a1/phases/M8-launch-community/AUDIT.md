---
plan: .a1/phases/M8-launch-community/PLAN.md
verdict: PASS_WITH_WARNINGS
blockers: 0
majors: 3
minors: 4
generated: 2026-07-05
---

# Plan Audit — M8 Launch & Community

## Verdict: PASS_WITH_WARNINGS

No blocker: every SC has a task with a measurable Done-when, wave ordering is correct (Wave 2 correctly uses post-move `skills/` paths, so it must follow Wave 1 — and it does), the move is committed atomically with both breaking consumers (install.sh, CONTRIBUTING), and the gh read-only and VHS-unavailable cases both have documented fallbacks. Three MAJOR findings should be fixed before or during execution — all are one-line plan corrections, none require re-planning.

## Verified against the live repo (not just MAP)

- `bin/install.sh` matches the plan's assumed structure exactly (18-entry SKILLS array incl. `_shared`, `symlink_item "$REPO_DIR/$skill"`). Plan's edit spec is correct.
- `.github/workflows/test.yml`: confirmed **no repo-layout `a1-*` path** — CI references only `_shared/`, `bin/install.sh`, `_test-fixtures/`, and runtime symlink paths (`$HOME/.claude/skills/a1-new-feature`). MAP's "CI needs no change" claim holds.
- Fixture runners: grep found zero root-level `a1-*/` references in `_test-fixtures/` — MAP's SAFE classification holds; `../../` depth unchanged.
- `_shared/a1-tools.cjs`: no repo-layout skill paths; `fix integrity-check` defaults to `~/.claude/skills` (runtime symlink — safe). No `a1-*/_learning.md` collect glob exists in the CLI; a1-evolve writes via `~/.claude/skills/...` symlink paths (04-apply.md) — safe post-move.
- `_shared/gates-registry.md` owning-file column uses skill **names** (`a1-execute`, `a1-check`), not paths — safe.
- `packs/postgres-rls/`: no path anchors — safe.
- README↔install.sh bijective diff: SKILLS array keeps bare names (only the loop's source path gains `skills/`), so the M7 name-diff still works. Task 4.3 step 2 is valid.
- Agent frontmatter: re-check in Task 1.3 is correct and cheap (MAP found 0 disallowed fields; live repo consistent).

## Findings

### BLOCKERS
None.

### MAJOR (high risk of failure)

- **[M1] Marketplace `name` contradiction: plan vs. MAP template.** Task 1.3 step 2 says marketplace `name: "a1-specforge"` "per the MAP template", but MAP's template says `"name": "a1-specforge-marketplace"`. The plan's own install/uninstall commands (`a1-specforge@a1-specforge`, `claude plugin marketplace remove a1-specforge`) and the README string in the Done-when all assume marketplace name = `a1-specforge`. If the executor copies the MAP template verbatim, the plan's validation commands fail.
  > Fix: State explicitly in Task 1.3: "MAP template's marketplace name is superseded — use `name: "a1-specforge"` in marketplace.json." One decision, frozen, both files consistent.

- **[M2] Task 1.1's sanity grep misses bare relative skill-path references — confirmed stale refs exist.** The grep pattern `'\$REPO_DIR/a1-\|"\./a1-\|(\./a1-'` only matches prefixed forms. Live repo contains unprefixed repo-layout references that become stale after the move and will NOT be caught:
  - `docs/CONSTITUTION.md` lines 13 and 56: `` `a1-evolve/workflows/03-propose.md` `` (reads as a repo path)
  - `_shared/learnings-index.md` lines 8–20: pattern anchors like `a1-new-feature/workflows/05-implement.md` (ambiguous: resolvable via `~/.claude/skills/` symlinks at runtime, stale as repo paths)
  These won't break install or CI (hence not a blocker), but a1-evolve and contributors navigate by these anchors.
  > Fix: Add a second, broader grep to Task 1.1 step 5: `grep -rn '\ba1-[a-z-]*/workflows/\|\ba1-[a-z-]*/SKILL\.md' docs/ _shared/ README.md CONTRIBUTING.md | grep -v '~/.claude\|skills/a1-'` — then either update the hits to `skills/a1-...` (CONSTITUTION.md) or add an explicit note that learnings-index anchors are `~/.claude/skills/`-relative by convention (symlink names unchanged, so runtime-safe) and leave them.

- **[M3] `gh run watch --exit-status` without a run ID is interactive** — it prompts for a run selection, which fails/hangs headless. Task 1.2 step 4's Done-when depends on it.
  > Fix: Use `gh run watch $(gh run list --branch <branch> -L1 --json databaseId -q '.[0].databaseId') --exit-status`, or poll `gh run list -L1 --json status,conclusion`.

### MINOR (execution proceeds, but note)

- **[m1] Local fixture loop is weaker than CI.** `_test-fixtures/*/run*.sh` misses the nested `_test-fixtures/a1-schema-check/parser/run-parser.sh`, which test.yml runs explicitly as an extra step. Task 1.2/2.1 local gates should append it (CI would still catch a break, but only after push — after the "green gate" was already declared locally).
- **[m2] German grep gate has false-negative risk, not just false-positive.** German lines containing neither umlauts nor the listed function words slip through (e.g. `"Magst du ..."` — MAP cites this exact string in a1-modernize/02-reverse-spec.md; "Magst"/"du" match nothing in the pattern). Mitigated because Task 2.1 works from the MAP inventory as primary source and the gate is secondary — acceptable, but the executor should treat the inventory, not the grep, as authoritative. False-positive risk (English "die", " das " ) is low and the manual-review step handles it.
- **[m3] Task 1.2 step 4 pushes mid-wave** — if pushing to main, the public repo briefly shows the moved layout without plugin manifests. Harmless (install.sh already updated in the same commit), but worth a conscious choice: push once after Task 1.3 instead, or use a branch.
- **[m4] Task 5.2 depends on Vault availability** (`$HOME/N3URAL-Vault/pattern/a1-learnings/a1-plan.md`); no fallback stated if the path is absent. One line ("if Vault missing, note in STATUS.md and keep local cache as source") would make the Done-when robust.

## What's Good

- **The move is genuinely atomic**: Task 1.1 puts `git mv` + install.sh + CONTRIBUTING in one commit with a recorded `rollback_sha` and a hard gate (Task 1.2: fixtures + fresh-HOME smoke + M7 fresh-machine replay + CI) before any manifest work — exactly the right shape for the HIGH-risk item.
- **Honest outcome/enabler split** (SC scope note + Wave 5 time-deferred markers) prevents the classic "checked a star-count SC we don't control" failure.
- **Every environment constraint has a fallback**: gh read-only → drafts + command list, no headless plugin CLI → manual verification doc, no VHS → tape + recording-steps doc with a README TODO. No task dead-ends on missing tooling.
