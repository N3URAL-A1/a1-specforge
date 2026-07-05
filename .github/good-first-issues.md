# Good First Issues — drafts

Four well-scoped starter tasks for new contributors. Each is small, verifiable,
and touches a well-isolated part of the repo. The bottom section has the
ready-to-paste `gh` commands for Robert to publish these as labeled issues (the
CI account is read-only, so publication is a manual step — see "Publish").

Before starting any of these, read [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Issue 1: Add a fixture test for the `constitution` CLI subcommands

**Context:** `_shared/a1-tools.cjs` ships a `constitution` command group
(`init`, `discover`, `update-status`) but — unlike `spec`, `check`, `checklist`,
`pack`, `reconcile`, etc. — it has **no fixture suite** under `_test-fixtures/`.
CI runs every `_test-fixtures/*/run*.sh`, so an untested subcommand can silently
regress.

**Files:**
- New: `_test-fixtures/a1-constitution/run-tests.sh` (model it on
  `_test-fixtures/a1-reconcile/run-tests.sh`).
- Reference: the `constitution` handlers in `_shared/a1-tools.cjs` and its
  `--help` output (`node _shared/a1-tools.cjs --help`).

**Done when:**
- `bash _test-fixtures/a1-constitution/run-tests.sh` exits 0.
- The suite covers at least: `constitution init` creates the expected file,
  `constitution update-status` moves through a valid status transition, and one
  invalid-status case exits non-zero.
- The new runner is picked up by the fixture loop in `.github/workflows/test.yml`
  with no workflow change needed (it already globs `_test-fixtures/*/run*.sh`).

**Label:** `good first issue`

---

## Issue 2: Contribute a Gate-Pack from your own project's learnings

**Context:** A Gate-Pack is a versioned bundle of battle-tested gate patterns so
others import proven gates instead of re-collecting the same bugs. We ship one
worked example (`packs/postgres-rls/`) and want the community to grow the
catalog. This is the ideal first contribution if you've been running a1 on a
real project and have recurring patterns worth sharing.

**Files:**
- New: `packs/<your-pack-name>/` (a `pack.yaml` + one or more pattern files).
- Reference: `packs/postgres-rls/` (template) and the "Contributing a Gate-Pack"
  section of [CONTRIBUTING.md](../CONTRIBUTING.md).

**Done when:**
- `node _shared/a1-tools.cjs pack validate packs/<your-pack-name>/` exits 0.
- `pack.yaml` has real `provenance` (occurrences, severity, date_range, source),
  an `anonymization` level (A1/A2/A3), and every pattern has a valid
  `target{kind, skill, anchor}` and `evidence_schema`.
- The anonymization deny-regex passes (no `/Users/` paths, vault paths, e-mails,
  or tenant names in the output).

**Label:** `good first issue`

---

## Issue 3: Add a missing edge-case section to `a1-worktree/workflows/03-exit.md`

**Context:** The worktree-exit workflow documents the happy path (merge back,
remove the worktree) but does not cover the case where the worktree has
**uncommitted changes** or the branch **has diverged from its base**. New users
hit this and don't know whether it's safe to proceed. Adding a short, explicit
edge-case section removes the ambiguity.

**Files:**
- Edit: `skills/a1-worktree/workflows/03-exit.md` — add a section (e.g.
  `## Edge cases`) covering: uncommitted changes present, branch diverged from
  base, and worktree already removed.

**Done when:**
- The new section names each edge case and states the recommended action for it.
- Markdown structure/heading levels match the rest of the file (no restructuring
  of existing content).
- Prose is English (the repo is English-only — see the i18n gate).

**Label:** `good first issue`

---

## Issue 4: Improve `install.sh` error message when Node is older than 18

**Context:** `bin/install.sh` documents a Node ≥ 18 requirement in CONTRIBUTING,
but the script itself does not check the running Node version. On an older Node
the failure surfaces later as a confusing runtime error instead of a clear
up-front message. A small guard at the top of `install.sh` makes the requirement
actionable.

**Files:**
- Edit: `bin/install.sh` — add a version check near the top that reads the Node
  major version and, if `< 18`, prints a clear message (current version, the
  requirement, and how to upgrade) and exits non-zero **before** creating any
  symlinks.

**Done when:**
- On Node ≥ 18 the script behaves exactly as before (fresh-HOME smoke test still
  passes: `TMP_HOME=$(mktemp -d) HOME="$TMP_HOME" bash ./bin/install.sh`).
- Simulating an old Node (e.g. shadowing `node` with a stub that prints `v16.x`)
  makes the script exit non-zero with the friendly message and creates **no**
  symlinks.
- `bash -n bin/install.sh` still exits 0.

**Label:** `good first issue`

---

## Publish (Robert)

> The active `gh` account (`n3urala1-rob`) is **read-only** on
> `mellow-rob/a1-specforge`. Switch to the write-capable account first, then
> create one issue per draft. This pipeline must NOT run `gh issue create`
> itself — these commands are for you to run manually after review.

```bash
# 1. Switch to the account with write access
gh auth switch --user mellow-rob

# 2. Create one issue per draft (bodies are the sections above; save each to a
#    file first, or paste the body inline). Example using --body-file:

gh issue create --repo mellow-rob/a1-specforge \
  --title "Add a fixture test for the constitution CLI subcommands" \
  --body-file issue-1.md \
  --label "good first issue"

gh issue create --repo mellow-rob/a1-specforge \
  --title "Contribute a Gate-Pack from your own project's learnings" \
  --body-file issue-2.md \
  --label "good first issue"

gh issue create --repo mellow-rob/a1-specforge \
  --title "Add a missing edge-case section to a1-worktree/workflows/03-exit.md" \
  --body-file issue-3.md \
  --label "good first issue"

gh issue create --repo mellow-rob/a1-specforge \
  --title "Improve install.sh error message when Node is older than 18" \
  --body-file issue-4.md \
  --label "good first issue"

# 3. (Optional) switch back to the default account
gh auth switch --user n3urala1-rob
```

> Note: if the `good first issue` label does not yet exist on the repo, create
> it once with:
> `gh label create "good first issue" --repo mellow-rob/a1-specforge --color 7057ff --description "Good for newcomers"`
