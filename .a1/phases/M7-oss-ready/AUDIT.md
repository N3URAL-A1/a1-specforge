---
plan: .a1/phases/M7-oss-ready/PLAN.md
verdict: PASS_WITH_WARNINGS
blockers: 0
majors: 5
minors: 4
generated: 2026-07-05
---

# Plan Audit — M7 OSS-Ready

## Verdict: PASS_WITH_WARNINGS

No hard blockers. Five MAJOR findings that each have a realistic path to silent failure or incomplete SC coverage if the executor proceeds without being aware. Four MINOR findings. The plan is executable but the executor must read the findings before starting Wave 1.

---

## Findings

### MAJORS (high risk of failure or incomplete result)

**[M1] Vault fallback hard-fail contract conflicts between PLAN and RESEARCH**
Task 1.1 says: "If none resolve … exit non-zero with a clear error." The RESEARCH.md reference implementation has a Tier 4 that *auto-creates* `.a1/learnings/` even outside a git repo (second `git rev-parse` call after the legacy-vault check). These are contradictory: one exits, the other silently succeeds. The fixture Case D tests the "exit non-zero" path, but if the executor copies the RESEARCH reference implementation verbatim, Case D will pass (Tier 4 auto-creates) rather than exit non-zero.
> Fix: Before touching a1-tools.cjs, decide which contract is canonical. The PLAN intent (clear fail message) is safer for OSS. Delete Tier 4 from the reference implementation in RESEARCH (or add a note in Task 1.1 that the RESEARCH pseudocode is superseded). Then fixture Case D is a reliable regression guard.

**[M2] `wiki/` subcommands are excluded from the fallback status line and fixture coverage**
Task 1.1 lists the vault-writing subcommands that should emit the `[a1-tools] learnings root:` status line as: `spec next-number`, `fix next-suffix`, `analyze init`, `constitution init`. But `vaultRoot()` has 32 call sites in a1-tools.cjs; at least 6 of those resolve paths under `wiki/` (postmortem, promote, lessons/suggest). These are exercised by `a1-fix` (postmortem gate) and the learning-loop promotion flow. If the fallback chain only emits the status line for the four listed subcommands, wiki-writes will silently resolve through the old hard-coded path on the legacy tier with no user signal. The fixture adds no wiki-subcommand cases. SC-1 ("zero file edits, writes land in repo-local `.a1/learnings/`") cannot be fully proven without this.
> Fix: Either (a) emit the status line from `vaultRoot()` itself (once, on first call, using a module-level flag) so all 32 call sites are covered, or (b) add a fixture Case E that invokes a wiki subcommand and asserts `source: repo-local`. Update Task 1.1 action step 1 to cover the wiki subcommands explicitly.

**[M3] CI ubuntu vs. macOS assumption: `sed -i ''` not present, but install.sh may have other bash-isms**
Task 4.1 creates a workflow with `runs-on: ubuntu-latest`. No `sed -i ''` was found in the test fixtures (good), but the plan's install.sh smoke test step uses `test -L "$HOME/.claude/skills/a1-new-feature"` which is portable. The risk is that *existing* fixture runners (a1-worktree, a1-check, etc.) were written and tested only on macOS. If any runner calls `stat -f`, `readlink` without `-f`, or uses BSD `date` syntax, it will fail on ubuntu. The plan does not include a step to audit existing runners for macOS-only utilities before enabling CI.
> Fix: Add a pre-CI action to Task 4.1 (or as a new sub-step): `grep -rn 'stat -f\|readlink -f\|sed -i '"'"''"'"'\|date -r' _test-fixtures/` and resolve each hit. Run `bash _test-fixtures/a1-worktree/run-tests.sh` on ubuntu locally or via act before merging the CI workflow.

**[M4] Phantom nested-`.git` dirs: MAP.md says they are full dirs, but the fixture bootstrap setup step is still coded defensively**
MAP.md explicitly states: "Each fixture subdirectory contains a **full `.git/` directory** (not a gitlink)." Task 3.1 Action 1 says to verify this with `git ls-tree`. If the MAP is correct, the runner's setup step (git init + commit if rev-parse fails) is harmless. But the runner is also supposed to cover the CI clone case — and nested `.git/` dirs inside a tracked repo are *not cloned* by `git clone` by default (git strips them, treating them as plain directories). So after `git clone`, `.git/` inside `_test-fixtures/a1-phantom/clean/` becomes an empty directory, and `git -C clean/ rev-parse` fails. The setup step will then `git init` a new empty repo with no commit history, and `git log -1` will also fail (no commits). The runner currently handles this with a conditional `git commit`, which is correct. However the "if fixture content itself is missing (gitlink cloned empty)" branch says "fail with a clear message listing what to restore" — but if nested `.git/` are stripped by clone (not gitlinks), the *content files* (PLAN.md, src/) will still be present. The runner would erroneously hit the "fail" branch thinking content is missing when only `.git/` internals are missing.
> Fix: Clarify the "missing" detection logic: check for `PLAN.md` absence (content missing), not for `git rev-parse` failure (which is expected on fresh clone). The setup step should unconditionally `git init && git add -A && git commit` if `git log -1` fails, regardless of whether content exists.

**[M5] SC-3 language-cap consistency: README criterion says "lists exactly the installed skill set" but the cross-check command is one-directional**
Task 3.2 Action 2 cross-checks that every skill in `bin/install.sh` appears in README. But the inverse (skills mentioned in README that are NOT in install.sh) is not checked. If the README accidentally lists `checkpoint` or an M8 skill, the done-when condition passes while SC-3 ("single source of truth") is violated. The `for s in $(grep -o 'a1-[a-z-]*' bin/install.sh | sort -u)` loop only checks one direction.
> Fix: Add a second check: `for s in $(grep -o 'a1-[a-z-]*' README.md | sort -u); do grep -q "\"$s\"" bin/install.sh || { echo "README mentions $s but not in install.sh"; exit 1; }; done`. Alternatively use `diff <(grep ... README) <(grep ... install.sh)`.

---

### MINORS (execution proceeds, but note)

**[m1] Task 2.4 checkpoint migration: the `cp -R` step runs before `git rm`, which is correct, but `test -f ~/.claude/skills/checkpoint/SKILL.md` in the done-when will always pass even if the copy failed silently (e.g., permissions issue), because `~/.claude/skills/checkpoint/` could be the old symlink's target still in memory. The done-when should also assert the target is a real directory, not a symlink: `test ! -L ~/.claude/skills/checkpoint`.**

**[m2] Task 5.1 fresh-machine simulation: the clone source is `git clone /Users/rob/code/a1-skills "$TMP/a1-specforge"` — a local path clone. This will NOT clone nested `.git/` dirs inside `_test-fixtures/a1-phantom/` (same issue as M4). So the phantom runner will be exercised under the gitless-fixture condition during Task 5.1. This is actually a good integration test, but the task description does not flag it as such — the executor may be surprised when the phantom runner triggers its bootstrap step.**

**[m3] Task 5.2 Action 2: "Write retro to `~/.claude/skills/a1-execute/_learning.md` and vault-canonical `pattern/a1-learnings/` via the fallback-aware path." After M7, the fallback-aware path for the retro write will resolve to `.a1/learnings/pattern/a1-learnings/` (repo-local), NOT `~/N3URAL-Vault/pattern/a1-learnings/`. If `A1_VAULT_ROOT` is unset (as it will be in the fresh-machine simulation), writing to the Vault canonical path requires explicitly setting `A1_VAULT_ROOT` first. The task is ambiguous — the executor may write the retro to the wrong location or skip it.**

**[m4] The plan has 5 success criteria (SC-1 through SC-5) but `docs/roadmap.md` M7 section lists only 3 success criteria. Task 5.2 Action 1 says "Check off the three M7 success criteria in `docs/roadmap.md`" but there are 5 SCs in PLAN.md. SC-4 (checkpoint removed) and SC-5 (no personal paths) are not represented in the roadmap. The roadmap will remain partially unchecked after M7 close-out — either the roadmap needs 2 more criteria added, or the PLAN.md needs to map its 5 SCs back to the roadmap's 3.**

---

## What's Good

1. **Wave ordering is sound.** Wave 1 (fallback chain) is a genuine prerequisite for Wave 2 (prose sweep that refers to the new default). Waves 2 and 3 are correctly identified as independent parallel work with no shared file sets. Wave 4 (CI) correctly waits for the phantom runner (Task 3.1) and the vault-fallback fixture (Task 1.1) to exist.

2. **Fixture case design for Task 1.1 is thorough.** Four cases (env wins / repo-local / legacy / hard-fail) with explicit `env -u A1_VAULT_ROOT HOME=$(mktemp -d)` isolation cover the contract's main branches. The pattern of using a fake HOME prevents the test from touching Rob's real environment.

3. **Checkpoint migration chooses the simplest robust option.** Using `cp -R` to a real directory in `~/.claude/skills/` avoids a private-repo dependency, an overlay script, and a broken-symlink state. The `.gitignore` addition prevents accidental re-commit. The migration note doc gives external users enough context without over-engineering.
