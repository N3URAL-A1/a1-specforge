# Phase 5 - Merge

Goal: merge a reviewed PR. The assistant merges, never the user (standing instruction, 2026-09-09).
This file is the only merge path of the skill. Three code checks run first, in this order; each block
ends the run on a non-zero exit. `gh pr merge` runs only after all three exited 0. `product validate` and
`pr merge-check` pass `--phase pr-<n>` (gate log scope, spec 017); `disposition review` is not a registry gate and rejects `--phase` (exit 2).

Preconditions:

- Reinhard reviewed the diff, every BLOCKER and MAJOR is fixed, the last push is done (`_shared/push-cadence.md`).
- Step 2.7 of `workflows/02-review.md` (`xprov gate --gate pr-diff-xprov --merge-check`) exited 0 after `git fetch origin`.
  The plugin Bash hook runs that check again on the merge command in step 4 and denies the merge when it is not 0.
- `A1_VAULT_ROOT` is set: step 2 reads the vault. An unset root exits 2 and ends the run.

## 5.1 Disposition review state (FR-025)

List the dispositions added or changed since the base: `git diff <base>...HEAD -- .a1/dispositions.json`.
Reinhard reviews each one; record every verdict with `--by a1-reinhard-reviewer`. The author of an entry never reviews it
(`disposition_self_reviewed`). No changed disposition: nothing to record, go to 5.2.

The merge check reads verdicts from the committed `HEAD`, not from the working tree (`dispositions_uncommitted`). After the
last verdict, commit and push the file in the same block (this is the review round's push, `_shared/push-cadence.md` P1), then run
5.3 again. Repeat the `disposition review` line once per fingerprint before the commit.

```bash
node <repo>/_shared/a1-tools.cjs disposition review <fingerprint> --verdict <upheld|overturned> --reason "<why>" --by a1-reinhard-reviewer; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: disposition review exit=$RC, no merge"; exit "$RC"; fi
git commit -m "chore(review): disposition verdicts for pr <n>" -- .a1/dispositions.json; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: commit of .a1/dispositions.json exit=$RC, no merge"; exit "$RC"; fi
git push; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: push exit=$RC, no merge"; exit "$RC"; fi
```

An `overturned` verdict blocks the merge in 5.3 (`disposition_overturned`); fix the finding, then run 5.1 again.

## 5.2 Vault-backed coherence (FR-034)

```bash
node <repo>/_shared/a1-tools.cjs product validate --spec-status --require-vault --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: product validate exit=$RC, no merge. Exit 1 = drift: run the reconciling command named in spec_status.violations[].reconcile. Exit 2 = A1_VAULT_ROOT unset."; exit "$RC"; fi
```

## 5.3 Merge check (FR-036, FR-037)

Add `--bug <fix-report-id>` for a test that is red on head AND base and has an a1-fix report (`base_red_unreported` otherwise).
The report must be a real a1-fix report (frontmatter `type: bug-report`, `bug_slug`, `status`) in the vault or committed at the base.
One `--bug` clears every base-red id; required checks red on head are never compared with the base.
`head_mismatch` means the local checkout is not the PR head on a clean tree: push or check out the PR head, then run again.
A changed `.a1/fidelity.json` blocks (`fidelity_config_changed`): clear it by an upheld `config_change` disposition from a second
reviewer, or pass `--accept-config-change "<reason>"` after the owner agreed (the report logs the reason).

```bash
node <repo>/_shared/a1-tools.cjs pr merge-check --pr <n> --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: pr merge-check exit=$RC, no merge. Read reasons[] on stdout."; exit "$RC"; fi
```

Exit 1 names every red reason in `reasons[]`. Fix the cause and run 5.1 to 5.3 again; never merge around it.

## 5.4 Merge

Run this as the only command of the Bash call (the hook allows one canonical form, `_shared/lib/xprov-hook-merge.cjs`).
PR bodies go in with `--body-file`, never inline. `<head_sha>` is `head_sha` from the stdout of 5.3 (40 hex): GitHub then merges
that commit or refuses, so a push between the check and the merge cannot slip in (spec 017 review SEC-1).

```bash
gh pr merge <n> --squash --delete-branch --match-head-commit <head_sha>
```

Then verify it landed (`gh pr view <n> --json state,mergedAt`), sync the primary checkout's `main`
with `_shared/push-cadence.md` P3 (never a bare `git pull`) and advance the registry
(`a1-tools pr mark-status`). Report what was merged and which findings there were.
Production deploys and migrations on a production database still need the user's word.

## Failure modes

- Any of 5.1 to 5.3 exits 1 or 2: no merge. Report the reason, fix, repeat from 5.1.
- `gh pr merge` denied by the hook: read the hint, fix the cause (head sha moved: run 5.3 again and use the new `head_sha`; local ref differs). Do not rephrase the command.
