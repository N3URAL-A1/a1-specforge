# Phase 4 — Adopt & Reconcile (Registry ↔ Disk Recovery)

**Goal:** Bring an out-of-band git worktree (created via raw `git worktree
add`, or a registry that has drifted from disk) back in sync with the
a1-worktree registry, without losing work.

**Sub-agent:** none. All checks are deterministic and live in the CLI.

## When to use

- A worktree exists on disk (`git worktree list` shows it) but there is no
  registry entry for it — typically because it was created with a raw
  `git worktree add` instead of `worktree prepare` + `worktree enter`.
- `worktree exit <id> --mode <keep|discard|handoff>` fails with
  "no registry entry" for a worktree the user can see on disk.
- The registry and the on-disk `git worktree list` output may have drifted
  (e.g. a worktree directory was deleted manually with `rm -rf` instead of
  `worktree exit`) and you need to know which side is stale before acting.

## Step 1 — Adopt an existing git worktree

Call the CLI:

```bash
node <repo>/_shared/a1-tools.cjs worktree adopt <repo-root> <slug> [--worktree-path <abs>] [--branch <name>] [--base <branch>]
```

Candidate matching priority (first that applies wins):

1. `--worktree-path <abs>` — exact match against `git worktree list` paths.
2. `--branch <name>` — match by branch name.
3. Neither given — match by `basename(worktree_path) === <slug>`.

JSON shape on success:

```json
{
  "id": "20260711-1530-manual-feat",
  "slug": "manual-feat",
  "repo_root": "...",
  "worktree_path": "...",
  "branch": "feature/manual-feat",
  "base_branch": "main",
  "status": "active",
  "commit_count": 3,
  "adopted": true
}
```

Exit codes: 0 success, 1 (`NOT_FOUND` / `AMBIGUOUS` / already-registered
guard), 2 (invalid slug, not a git repo).

- `NOT_FOUND` — zero git worktrees match the given selectors. stdout lists
  `candidates` (all non-main worktrees in the repo) so the user can pick a
  more specific `--worktree-path`.
- `AMBIGUOUS` — more than one git worktree matches; re-run with
  `--worktree-path` to disambiguate.
- Already-registered guards — refuses if an **active** registry entry
  already exists for this `<repo-root, slug>` pair, or if the worktree path
  is already registered under a different (non-cleaned) entry.

Once adopted, the entry behaves exactly like one created via `prepare` +
`enter`: `worktree exit <id> --mode handoff` (or `keep`/`discard`) works
normally on it. This is the standard recovery path for the "no registry
entry" incident.

## Step 2 — Reconcile registry vs. disk

Use `reconcile` to see, in one shot, both directions of drift before
deciding what to adopt or clean up:

```bash
node <repo>/_shared/a1-tools.cjs worktree reconcile <repo-root> [--prune]
```

JSON shape:

```json
{
  "repo_root": "...",
  "in_sync": false,
  "stale": [
    { "id": "...", "slug": "...", "path": "...", "reason": "registry entry has no git worktree and path missing on disk" }
  ],
  "pruned": [],
  "adopt_candidates": [
    { "path": "...", "branch": "feature/x", "hint": "a1-tools worktree adopt <repo-root> <slug> --worktree-path <path>" }
  ],
  "prune": false
}
```

- **`stale`** — registry entries whose worktree is gone from both `git
  worktree list` and disk. Remediation: none needed if the branch/work is
  already merged or abandoned; run again with `--prune` to mark them
  `cleaned`.
- **`adopt_candidates`** — git worktrees with no matching registry entry.
  Remediation: run the `hint` command from Step 1 (`worktree adopt`) for
  each one you want tracked.

## Hard rules

- **Read-only without `--prune`.** `reconcile` never mutates the registry
  unless `--prune` is explicitly passed — the flag itself is the
  confirmation, no separate interactive prompt.
- **Reconcile before gc** whenever the registry and disk may have drifted
  (manual `rm -rf` of a worktree dir, worktree created outside the CLI,
  etc.) — running `gc` against a stale-but-unreconciled registry can miss or
  misreport entries. Reconcile first, then adopt or `--prune`, then `gc`.
- Never run raw `git worktree add` and expect it to show up in the registry
  automatically — always follow up with `worktree adopt` (or `prepare` +
  `enter` from the start).
- `adopt` never mutates git state (no branch creation, no worktree
  creation) — it only reads git truth and writes a registry entry.
