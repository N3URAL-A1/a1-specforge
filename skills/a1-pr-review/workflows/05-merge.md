# Phase 5 - Merge

Goal: merge a reviewed PR. The assistant merges, never the user (standing instruction, 2026-09-09).
This file is the only merge path of the skill. Three code checks run first, in this order; each block
ends the run on a non-zero exit. `gh pr merge` runs only after all three exited 0. Every call passes
`--phase pr-<n>` (gate log scope, spec 017).

Preconditions:

- Reinhard reviewed the diff, every BLOCKER and MAJOR is fixed, the last push is done (`_shared/push-cadence.md`).
- Step 2.7 of `workflows/02-review.md` (`xprov gate --gate pr-diff-xprov --merge-check`) exited 0 after `git fetch origin`.
  The plugin Bash hook runs that check again on the merge command in step 4 and denies the merge when it is not 0.
- `A1_VAULT_ROOT` is set: step 2 reads the vault. An unset root exits 2 and ends the run.

## 5.1 Disposition review state (FR-025)

List the dispositions added or changed since the base: `git diff <base>...HEAD -- .a1/dispositions.json`.
Reinhard reviews each one; record every verdict. No changed disposition: nothing to record, go to 5.2.

```bash
node <repo>/_shared/a1-tools.cjs disposition review <fingerprint> --verdict <upheld|overturned> --reason "<why>" --by a1-reinhard-reviewer --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: disposition review exit=$RC, no merge"; exit "$RC"; fi
```

An `overturned` verdict blocks the merge in 5.3 (`disposition_overturned`); fix the finding, then run 5.1 again.

## 5.2 Vault-backed coherence (FR-034)

```bash
node <repo>/_shared/a1-tools.cjs product validate --spec-status --require-vault --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: product validate exit=$RC, no merge. Exit 1 = drift: run the reconciling command named in spec_status.violations[].reconcile. Exit 2 = A1_VAULT_ROOT unset."; exit "$RC"; fi
```

## 5.3 Merge check (FR-036, FR-037)

Add `--bug <fix-report-id>` for a test that is red on head AND base and has an a1-fix report (`base_red_unreported` otherwise).

```bash
node <repo>/_shared/a1-tools.cjs pr merge-check --pr <n> --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: pr merge-check exit=$RC, no merge. Read reasons[] on stdout."; exit "$RC"; fi
```

Exit 1 names every red reason in `reasons[]`. Fix the cause and run 5.1 to 5.3 again; never merge around it.

## 5.4 Merge

Run this as the only command of the Bash call (the hook allows one canonical form, `_shared/lib/xprov-hook-merge.cjs`).
PR bodies go in with `--body-file`, never inline.

```bash
gh pr merge <n> --squash --delete-branch
```

Then verify it landed (`gh pr view <n> --json state,mergedAt`), sync the primary checkout's `main`
with `_shared/push-cadence.md` P3 (never a bare `git pull`) and advance the registry
(`a1-tools pr mark-status`). Report what was merged and which findings there were.
Production deploys and migrations on a production database still need the user's word.

## Failure modes

- Any of 5.1 to 5.3 exits 1 or 2: no merge. Report the reason, fix, repeat from 5.1.
- `gh pr merge` denied by the hook: read the hint, fix the cause (head sha moved, local ref differs). Do not rephrase the command.
