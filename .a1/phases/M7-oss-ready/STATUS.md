# STATUS — M7 OSS-Ready

## Wave 1 — Vault fallback chain

### Task 1.1: Implement vaultRoot() fallback chain + fixture test — ✓ DONE

Replaced `vaultRoot()` in `_shared/a1-tools.cjs` with the 3-tier chain:
- Tier 1 `A1_VAULT_ROOT` (source: env)
- Tier 2 repo-local `<git-root>/.a1/learnings/`, auto-created with `created .a1/learnings/` stderr line (source: repo-local)
- Tier 3 legacy `~/N3URAL-Vault` only outside a git repo, with deprecation warning (source: legacy)
- else hard-fail exit 2 naming `A1_VAULT_ROOT`. No Tier 4.

Once-per-process status line `[a1-tools] learnings root: <path> (source: ...)` emitted from `vaultRoot()` itself (module-level `_vaultRootAnnounced` flag) — single choke point for all ~32 call sites incl. wiki subcommands. All stderr; stdout JSON contract untouched.

Fixture `_test-fixtures/a1-vault-fallback/run.sh` — 6 cases:
- A env wins — PASS
- B repo-local — PASS
- C legacy — PASS
- D repo-local auto-create + status — PASS
- E hard fail exit 2 — PASS
- F wiki subcommand (`fix write-suggestion`) choke-point proof — PASS

All pre-existing fixture runners re-run: 12/12 exit 0 (plus nested `a1-schema-check/parser/run-parser.sh` exit 0). No fixture patches required — env-setting fixtures use Tier 1, others use `--vault`/`--dest`/mktemp.

**Deviations:** none.

## Wave 2 — Hardcode sweep

### Task 2.1 — a1-evolve dynamic paths — DONE
- 01-collect.md:9 + 04-apply.md:28 → `VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"`
- 04-apply.md:58-59 → `REPO_ROOT="$(git rev-parse --show-toplevel)"` + `git -C "$REPO_ROOT"`
- 04-apply.md:103 (Vault retro path) generalized to `$VAULT/...` with default note
- SKILL.md:11,16,73 → skills-repo wording (git-detected)
- Done-when: `grep -rn 'N3URAL-Vault\|~/code/a1-skills' a1-evolve/` → exit 1 (empty) ✓
- Deviation [Rule 3-scope]: patched 04-apply.md:103 + SKILL.md:73 beyond the exact plan lines because 2.1 Done-when grep spans all of a1-evolve/.

## Task 2.4 — Remove checkpoint from public repo
✓ DONE — 1cd04cf — 2026-07-05
- git rm -r checkpoint/ (SKILL.md + push-to-brain.py)
- .gitignore: added `checkpoint/` and `.a1/learnings/` (Task 4.1 action 2b, owned here)
- bin/install.sh: removed 2 checkpoint comment lines
- docs/checkpoint-migration.md created
- Local: ~/.claude/skills/checkpoint already a real directory (not symlink), SKILL.md present — safety gate passed; local copy is newer than repo (Juli 5 vs Juli 4), preserved as-is (not clobbered with older repo version)
- Done-when exit 0

### Task 2.2 — SKILL.md prose defaults sweep — DONE
- 7 inventoried "Default vault root" prose lines → new wording ("Learning store defaults to repo-local `.a1/learnings/`; set `A1_VAULT_ROOT` to use an external vault (e.g. Obsidian).")
- Straggler sweep patched every ACTIVE N3URAL-Vault hit across SKILL.md + workflows/ (~30 lines in 20 files): retro-path references generalized to `$VAULT="${A1_VAULT_ROOT:-$(git rev-parse --show-toplevel)/.a1/learnings}"` or `<learning-store>` placeholder; CLI-default prose updated to repo-local `.a1/learnings/`.
- Whitelist honored: `*/_learning.md` retro bodies + `_shared/learnings-index.md` left untouched.
- Done-when: `grep -rl 'N3URAL-Vault' a1-*/SKILL.md a1-*/workflows/` → exit 1 (empty) ✓
- Deviation [Rule 3-scope]: patched far more than the 7 inventoried files (a1-fix wiki paths, a1-new-project VROOT, all skill retro paths) — required so no active SKILL.md/workflow hit remains.
