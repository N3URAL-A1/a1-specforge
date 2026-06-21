# Phase 04 — Write

Goal: deterministic, atomic deployment of the reviewed constitution. No LLM
in this phase — pure CLI sequence + final user-facing summary.

## Preconditions

- Vault file exists with `status: reviewed`.
- `CONST_PATH` is set.
- `REPO_ROOT` is set (from Phase 1 payload, or re-ask the user if missing).

If status ≠ `reviewed`: route to the matching phase.

## Step 1 — Archive current repo file (if any)

Check if `<repo-root>/constitution.md` already exists. If yes, the version in
the vault is already considered the next version (because Phase 1 Step 3
ran `archive-current` on the previous vault file before re-init). So no
additional archiving needed here.

But if this is a **re-write of an existing vault constitution** (rare: user
went `written` → fresh Phase 4 without re-init), we still need to ensure the
history is consistent. We rely on Phase 1's archiving logic — Phase 4 itself
does NOT archive. It only writes.

(Reasoning: archiving on init is correct because we want to snapshot the
"last known good" before discovery starts. Archiving in Phase 4 would
snapshot the current draft, which is not what audit-history is for.)

## Step 2 — Write the repo mirror

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution write-mirror \
  <project-slug> \
  --repo-root "<REPO_ROOT>"
```

Parse JSON. Capture `mirror_path` and `bytes`.

## Step 3 — Ensure CLAUDE.md cross-link

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution link-claudemd \
  <project-slug> \
  --repo-root "<REPO_ROOT>"
```

Parse JSON. Capture `action` (`appended` or `updated`).

If the CLI fails with "CLAUDE.md not found": surface the error and stop
WITHOUT setting status to `written`. The vault constitution remains at
`reviewed` so the user can fix CLAUDE.md and re-run Phase 4.

## Step 4 — Transition status to `written`

```bash
node ~/.claude/skills/_shared/a1-tools.cjs constitution update-status \
  "<CONST_PATH>" written
```

This appends `phase=write completed=<iso>` to `phase_history` and sets
`last_written_at` to the current ISO timestamp.

## Step 5 — Final report

Tell the user:

```
Constitution written.

  Project:           <slug>
  Version:           v<N> (from vault frontmatter)
  Vault file:        projects/<slug>/constitution/constitution.md
  Repo mirror:       <REPO_ROOT>/constitution.md (<bytes> bytes)
  CLAUDE.md link:    <action> (appended | updated)

  Phase history:
    - discover: <iso>
    - draft:    <iso>
    - review:   <iso>
    - write:    <iso>

  Single source of truth: the vault file. If the repo file is ever changed
  or lost: just run `a1-constitution` requesting a re-mirror — the vault
  rebuilds it.
```

## Step 6 — Soft hand-off recommendations (no auto-spawn)

Append to the report:

```
What you can do next (optional):

  - Commit: CLAUDE.md + constitution.md belong in one commit
    ("docs(constitution): add behavioral rules v<N>").
  - Ask Reinhard to do a compliance review on the latest PR — he is NOT yet
    constitution-aware (M3-roadmap), but you can explicitly give him the link
    to the constitution.
  - If other projects don't have a constitution yet: run a1-constitution for
    those — one constitution per project.
```

## Hard rules

- This phase has zero LLM calls. Pure CLI.
- The order is strict: write-mirror → link-claudemd → update-status. Why:
  if link-claudemd fails (no CLAUDE.md), the mirror is already written but
  status stays at `reviewed` — that is correct, because we have not yet
  declared a successful write. update-status is the commit point.
- If write-mirror fails (e.g. repo-root permission), do NOT call link-claudemd.
  Status stays at `reviewed`.
- Frontmatter changes only via CLI. Body changes are forbidden in Phase 4.
- No automatic git operations. the user commits manually when he wants.

## Retro (mandatory, every run)

After every run — pass or fail — write one structured entry. Takes 2 minutes. Do not skip.

**To local cache:**
```bash
cat >> ~/.claude/skills/a1-constitution/_learning.md <<'EOF'
---
date: <YYYY-MM-DD>
task: <new constitution | update constitution>
project: <project-slug>
result: <pass|fail|partial>
issues: [<relevant tags: claudemd_missing, alex_incomplete_draft, redraft_loop_long, mirror_write_failed, link_claudemd_failed, vault_drift, interview_too_thin, ...>]
what_worked: <one sentence>
one_line_learning: <what would have prevented the main issue, or "no issues">
EOF
```

**To Vault:**
Append the same entry to:
`~/N3URAL-Vault/pattern/a1-learnings/a1-constitution.md`

A run with no issues is still useful data — write the entry.
