# STATUS — M8 Launch & Community

rollback_sha: fb0e5a30950c17789cf50fddf261e3810c3f2081

## Wave 1 — Plugin restructuring

- Task 1.1 — DONE — f3312c5 — move 17 skill dirs under skills/, install.sh + CONTRIBUTING + CONSTITUTION + learnings-index paths updated. History preserved (git log --follow = 9). Both sanity greps clean, evolve glob check clean.
- Task 1.2 — DONE (verification only, no fixes needed, no commit) — FIXTURES_EXIT=0 (15 runners + nested parser); SMOKE_OK on fresh HOME (symlinks → skills/a1-new-feature and root _shared); fresh-machine sim from local clone matched M7: install exit 0, spec next-number + analyze init exit 0, .a1/learnings/projects/fresh-demo EXISTS, tracked modifications 0. CI check deferred to orchestrator's post-1.3 push.
- Task 1.3 — DONE — dccb548 — .claude-plugin/plugin.json + marketplace.json created; JSON_OK; AGENTS_CLEAN; README contains "plugin install a1-specforge".
  - Plugin validation path taken: **5a (headless CLI)** — `claude plugin validate` + real `marketplace add` + `install --scope local` succeeded; `plugin details` showed Skills (17) + Agents (18) loaded; cleanly uninstalled + marketplace removed; user-scope symlinks intact. No fallback doc needed.
  - Deviation (schema fix, Rule 2): `claude plugin validate` is the authoritative schema, and it **rejected the MAP template**. Fixes vs. MAP: marketplace requires `owner{}` (object) and `plugins[].author` must be an **object** not a string; `displayName` is ignored (warning). plugin.json `skills`/`agents` **string** path fields are invalid — omitted them (convention defaults to `skills/` + `agents/`, confirmed by details showing all 17/18). Added a marketplace `description` to clear the last warning. Final `claude plugin validate <repo>` → "Validation passed".
  - NOT pushed / CI not watched (orchestrator handles push + CI, per dispatch deviation).

### Deviations (Wave 1)
- [Rule 2 / schema] Task 1.3: corrected plugin manifests to satisfy `claude plugin validate` (owner object, author object, omit skills/agents string fields, add marketplace description) — MAP template was invalid against the live validator.

## Wave 3 — Community polish
Completed: 2026-07-05

| Task | Status | Commit | Notes |
|---|---|---|---|
| 3.1 CODE_OF_CONDUCT + CONTRIBUTING additions | ✓ DONE | 4ab23f7 | Contributor Covenant 2.1, contact = GitHub issues (no email hardcode); CONTRIBUTING: postgres-rls worked-example pointer, "Using vs. contributing" section, review-expectation sentence. Done-when: COC_OK, postgres-rls=1, plugin(ci)=1. |
| 3.2 Good-first-issue drafts + gh command list | ✓ DONE | c5e7417 | 4 drafts: (a) constitution CLI fixture (confirmed uncovered), (b) contribute a gate-pack from own learnings, (c) a1-worktree/03-exit.md edge-case section, (d) install.sh Node<18 guard (confirmed absent). "Publish (Robert)" block has gh auth switch --user mellow-rob + one gh issue create per draft. Pipeline did NOT run gh issue create. Done-when: 4 Issue headings, gh issue create + gh auth switch present. |
| 3.3 Simulated external-contributor dry-run | ✓ DONE | 4db4f3d | Fresh clone → install.sh on temp HOME (exit 0, symlinks OK) → gate-pack path → PR-ready branch add-pack-dryrun-demo with pack validate exit 0, git status clean. 2 findings, both fixed in CONTRIBUTING. Scratch clone deleted. |

### Dry-run findings (Task 3.3) — the interesting part
1. **CONTRIBUTING gate-pack path led with `pack export`, which requires a pre-existing Vault/learnings `patterns.md` corpus.** A stranger with a fresh clone and no corpus hits `error: Vault patterns.md not found ... exit 2` at the very first documented step, with zero guidance. FIX (committed): restructured the "Author the pack" step into (a) export-from-corpus with an explicit "exits 2 on a fresh clone" warning and (b) a recommended hand-author-from-`packs/postgres-rls/`-template path that needs no corpus.
2. **No branch-naming convention was documented**, yet the "Pull requests" section and the dry-run assume one. FIX (committed): added `<type>-<short-slug>` branch convention line to the Pull requests section.
- Positive: `pack validate` on both the shipped `packs/postgres-rls/` and the hand-authored dummy pack exited 0; the trust model (validate-before-PR) works cleanly for a newcomer once past finding #1.

### Deviations (Wave 3)
- [Rule 4-adjacent / scope] Wave 2 (German→English sweep) is NOT yet done — German prose survives in skills/a1-fix/workflows/*.md. Out of my Wave-3 scope; noted here so good-first-issue candidate selection deliberately EXCLUDED the translation task (per Task 3.2 guidance). No translation performed.
- 2 dry-run findings → CONTRIBUTING fixes (commit 4db4f3d), logged in observations.jsonl (pattern: vague_action ×2).
