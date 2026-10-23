---
id: 2026-07-22-worktree-learnings-visibility
project: a1-specforge
title: Worktree-isolated features cannot see their own spec/plan in .a1/learnings/
status: fixed
created: 2026-07-22
phase_history:
- phase=report completed=2026-07-22T13:58:13.810Z
- phase=diagnose completed=2026-07-22T14:00:26.903Z
- phase=fix-start completed=2026-07-22T14:07:13.744Z
- phase=verify completed=2026-07-22T14:08:03.546Z
fix_commit: 3c0492c
found_by: code agent, a1-new-feature spec 004-xs-quick-lane Wave 4 (self-reported
  mid-run)
recommended_code_agent: a1-walter-web-developer
severity: MAJOR
verify_result: 55/55 a1-worktree + 13/13 a1-pack green; full regression sweep 24/25
  suites green (1 pre-existing unrelated env flake); live end-to-end probe confirmed
  spec file readable inside a freshly created worktree. Merged 3392190, pushed.
permalink: vault/project/a1-specforge/fixes/2026-07-22-worktree-learnings-visibility
---

# Worktree-isolated features cannot see their own spec/plan in `.a1/learnings/`

## Symptom

A code agent running inside a `git worktree add`-created worktree cannot read the spec or
wave-plan for the feature it is implementing, when that spec/plan lives in the repo-local
learning store (`.a1/learnings/projects/<slug>/spec/` / `.../plans/`). The file exists in the
primary checkout but not in the worktree.

**Expected:** spec/plan are readable inside the worktree at the same relative path.
**Actual:** the files are absent — the agent has to work from the orchestrating prompt alone,
or a human manually copies the files in.

## Reproduction steps

1. Create a feature spec/wave-plan under `.a1/learnings/projects/<slug>/spec/` (+ `plans/`) in
   the primary checkout.
2. Run the Isolation Gate (`a1-new-feature` Phase 5 or `a1-fix`'s Isolation Gate) — both
   force `git worktree add` via `_shared/lib/worktree.cjs`'s `cmdWorktreeEnter`.
3. A code agent inside the new worktree tries to read
   `.a1/learnings/projects/<slug>/spec/<slug>.md`.

**Result:** file missing (gitignored, so `git worktree add` never materializes it in the new
checkout).

**Concretely verified:** spec `004-xs-quick-lane`, Wave 4's code agent running in
`/Users/rob/code/a1-worktrees/xs-quick-lane` reported that
`.a1/learnings/projects/a1-specforge/spec/004-xs-quick-lane.md` and its wave-plan were absent,
despite existing in `/Users/rob/code/a1-skills`. Wave 5 required a manual `cp` of both files
into the worktree before the agent could proceed. Documented as an open item in
`.a1/learnings/projects/a1-specforge/spec/004-xs-quick-lane-VERIFICATION.md:105-113`.

## Root cause

`.gitignore:5` excludes `.a1/learnings/` from version control (correct — it's local/vault
state, not repo content). `git worktree add` creates a plain checkout of tracked content
only; gitignored/untracked files from the primary checkout are never carried over. This is
correct, expected git behavior — the bug is that the two independently-correct mechanisms
(repo-local learning store since M7, mandatory worktree isolation) were never reconciled: no
code path copies or links the relevant learning-store subtree into a newly created worktree.

**Diagnosis anchor:** `_shared/lib/worktree.cjs`, `cmdWorktreeEnter` (around line 141), the
actual `git worktree add` invocation at lines 164–170. `cmdWorktreePrepare` (line 28) only
creates the registry entry and does not run `add` — the copy/symlink step belongs after the
successful `add` inside `cmdWorktreeEnter`, not in `prepare`.

## Impact

Every worktree-isolated feature (`a1-new-feature` Phase 5, `a1-fix`'s Isolation Gate — both
mandatory, no exceptions) whose spec/plan lives in the repo-local learning store loses access
to its own spec/plan inside the worktree. Deterministic, not a race — happens on every
occurrence. Risk: a code agent may silently implement without spec context if a human doesn't
notice and manually copy the files (as happened in Wave 4 of spec 004, until the gap was
caught and fixed for Wave 5).

## Affected components

- `_shared/lib/worktree.cjs` — `cmdWorktreeEnter` (fix location)
- `skills/a1-worktree/SKILL.md` — documents the flow, likely needs a matching doc update
- Indirectly: `a1-new-feature/SKILL.md` (Isolation Gate section), `a1-fix/SKILL.md`
  (Isolation Gate section) — both delegate to `a1-worktree` or run the same `git worktree add`
  inline; neither needs code changes if the fix lands in the shared `worktree.cjs` path, but
  should be spot-checked for any inline (non-delegated) worktree creation that would bypass
  the fix.

## Expected fix

After a successful `git worktree add` in `cmdWorktreeEnter`, copy (not symlink — worktrees are
meant to be independently disposable/mergeable, and a stale symlink surviving worktree removal
would be worse than a stale copy) the relevant `.a1/learnings/` subtree from the primary repo
root into the new worktree at the same relative path, best-effort (missing subtree is not an
error — not every worktree corresponds to a learning-store feature, e.g. ad-hoc fixes with no
spec file).

## Diagnosis

**Hypothesis:** `git worktree add` creates a plain tracked-content checkout; gitignored paths
are never carried over by design. Since `.a1/learnings/` is gitignored (`.gitignore:5`), the
entire repo-local learning store is absent from the new worktree. `cmdWorktreeEnter` runs
`worktree add` but copies nothing afterward — the isolated code agent cannot find its own
spec/wave-plan.

**Evidence:**
- `.gitignore:5` → `.a1/learnings/` excluded project-wide.
- `_shared/lib/worktree.cjs:164-170` — `cmdWorktreeEnter` builds `gitArgs = ['worktree','add', …]`
  and calls `git(entry.repo_root, gitArgs, …)`. Immediately after (~line 176+), only the
  registry status flips to `active` — **no store transfer**.
- `_shared/lib/worktree.cjs:6-7` — currently imports only `usage`, `parseFlags`, `nowIso`;
  neither `vaultRoot`/`projectsPath` (from `io.cjs`) nor a copy utility are in scope.
- Reproduction documented in
  `.a1/learnings/projects/a1-specforge/spec/004-xs-quick-lane-VERIFICATION.md:105-113`.

**Confidence:** high — full path read end-to-end (gitignore rule, exact `add` call site with
no follow-up copy, the store's 3-tier resolution). Deterministic defect, not a race.

**Recommended code agent:** a1-walter-web-developer.

**Fix approach:** After the successful `git worktree add` (right after the error guard,
**before** the registry status flips to `active`), mirror the relevant store subtree from the
primary checkout into the fresh worktree. **Reuse, don't reinvent:** `_shared/lib/pack.cjs:251`
already has `copyDirRecursive(src, dest)` (recursive mkdir + `fs.copyFileSync`, no external
deps) — lift it into a neutral lib module (e.g. `io.cjs`) and export it, rather than writing a
third copy implementation. `fs.cpSync(src, dest, {recursive: true})` (Node ≥16.7) is a lighter
alternative, but the codebase doesn't use `cpSync` anywhere yet, so hoisting the existing
utility is the more consistent path.

**Critical path nuance — pass to Phase 3 verbatim:** the store path is NOT
`projects/<worktree-slug>/`. `vaultRoot()` (`_shared/lib/io.cjs:32-64`) resolves repo-local via
**CWD-based** `git rev-parse --show-toplevel` — the fix must take the store root explicitly
from the **primary checkout** (`entry.repo_root`), not CWD/the worktree (source =
`path.join(entry.repo_root, '.a1', 'learnings')`, destination =
`path.join(entry.worktree_path, '.a1', 'learnings')`). The learning-store **project slug**
(e.g. `a1-specforge`) is an explicit CLI argument (`spec next-number <project-slug>`,
`_shared/lib/spec.cjs:31-33` via `projectsPath`) and matches neither the repo basename
(`a1-skills`) nor the worktree/branch `slug` (`entry.slug`, e.g. `xs-quick-lane`) — a fix that
copies `projects/<entry.slug>/` would copy nothing real. **Recommendation:** mirror the entire
`.a1/learnings/` tree (slug-agnostic, robust) rather than guessing the right
`projects/<project-slug>/` subtree. A symlink was considered and rejected — it would make the
isolated store write-shared with the primary checkout, defeating the point of isolation; copy
is the semantically correct choice for an isolation gate.

**Edge cases:**
- `entry.repo_root/.a1/learnings/` doesn't exist (feature with no store) → no-op, not an error.
- Idempotency: re-entering an existing worktree should overwrite/merge the destination, not
  crash — `copyDirRecursive`'s `mkdirSync(recursive)` already satisfies this.

**Regression test (severity MAJOR ⇒ write before the fix):** fixture — create a gitignored
file under `<repo>/.a1/learnings/projects/<slug>/spec/x.md`, run `worktree prepare` +
`worktree enter`, assert `<worktree_path>/.a1/learnings/projects/<slug>/spec/x.md` exists and
is content-identical.