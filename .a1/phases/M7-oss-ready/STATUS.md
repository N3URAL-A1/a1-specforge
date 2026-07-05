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
