# VERIFICATION — M7 OSS-Ready

**Date:** 2026-07-05 · **Verdict: PASS (5/5 success criteria)**
**Cost:** see cost line at bottom (per a1-execute/workflows/03-verify.md rule)

## Per-criterion results

| SC | Criterion | Result | Evidence |
|---|---|---|---|
| SC-1 | Fresh-machine: clone → install → CLI writes land repo-local, zero file edits | ✅ | Transcript below — all 9 checks green, `tracked modifications: 0` |
| SC-2 | CI green incl. phantom runner + install smoke on clean HOME | ✅ | GitHub Actions run 28742174363 `completed success` (2nd run; 1st run red → workflow assert fixed in c4744d9) |
| SC-3 | README single source of truth | ✅ | Bijective diff install.sh↔README exit 0 (commit 7043c63); A1_VAULT_ROOT + .a1/learnings documented |
| SC-4 | checkpoint out of repo, Robert's setup intact | ✅ | `test ! -e checkpoint` ✓; `~/.claude/skills/checkpoint` real dir with SKILL.md ✓ (commit 1cd04cf) |
| SC-5 | No personal hardcodes in active files | ✅ | All three Done-when greps empty (commits c8cbad4, a83c56f, 919f077) |

## Fresh-machine transcript (Task 5.1, 2026-07-05T13:21:33Z)

```
clone: OK
install.sh: exit 0
a1-new-feature symlink: OK
no checkpoint: OK
spec next-number: exit 0
analyze init: exit 0
.a1/learnings/projects/fresh-demo: EXISTS
tracked modifications: 0 (expect 0)
phantom runner on fresh clone: exit 0   ← nested-.git bootstrap proved itself (plan note m2)
```

## Verification checklist (from PLAN.md)

- [x] a1-vault-fallback (6 cases incl. wiki choke-point + hard-fail exit 2) exit 0
- [x] a1-phantom runner exit 0 (local, fresh clone, twice/idempotent)
- [x] Full fixture suite (14 runners + nested parser) exit 0
- [x] GitHub Actions test.yml green (run 28742174363)
- [x] Hardcode greps empty (N3URAL-Vault / /Users/rob / ~/code/a1-skills in active files)
- [x] checkpoint removed + local real-dir intact + not a symlink
- [x] Bijective README↔install.sh diff exit 0
- [x] Fresh-machine transcript above, spec written to .a1/learnings/, zero edits

## Notable findings during execution

1. **install.sh was broken on every fresh machine** (missing `mkdir -p` for skills/agents dirs) — found by the CI smoke prep, fixed in 692a86b. The framework's own fresh-machine claim had never been true before M7.
2. Phantom fixtures were pure gitlinks — content never reached clones; rebuilt as tracked files + deterministic two-commit bootstrap (e5ab7b9).
3. First CI run red: workflow asserted on a read-only subcommand's side effect; fixed to assert on a writing subcommand (c4744d9). First-run-red → second-run-green is the expected instrument-then-fix loop.

Cost: 65314797 tokens (in 140083, out 357474, cache 64817240)
(cost run --since 2026-07-05T00:00:00Z — covers today's full session incl. deep-work; M7 execution share is a subset)
