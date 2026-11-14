# Phase 5 - Merge

Goal: merge a reviewed PR. The assistant merges, never the user (standing instruction, 2026-09-09).
This file is the only merge path of the skill. Three code checks run first, in this order; each block
ends the run on a non-zero exit. `gh pr merge` runs only after all three exited 0. `product validate` and
`pr merge-check` pass `--phase pr-<n>` (gate log scope, spec 017); `disposition review` is not a registry gate and rejects `--phase` (exit 2).

Preconditions:

- Reinhard reviewed the diff, every BLOCKER and MAJOR is fixed, the last push is done (`_shared/push-cadence.md`).
- Samuel reviewed the diff when step 2.2b reported `security_surface: true` (`workflows/02-review.md`); every BLOCKER and MAJOR of both reviewers is fixed
  (`reinhard`, `samuel`, `reinhard+samuel` findings alike).
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
Four findings block, because a config or a deleted suite can switch checks off. No flag clears any; only a second reviewer does:

- `fidelity_config_changed`: `.a1/fidelity.json` differs from the base. The reason carries the `fingerprint`.
- `suite_red_on_head` with cause `verify_config_changed`: `.a1/verify.json` differs from the base. The fingerprint is `suites.config_changed.fingerprint` in the report.
- `suite_red_on_head` with cause `suite_removed`: an `each` suite the base names is gone at HEAD (a deleted red suite no longer fails). The fingerprint is `suites.suite_removed.fingerprint`; it covers exactly the removed id set (`suites.suite_removed.ids`).
- `probes_config_changed`: `.a1/live-probes.yaml` differs from the base (added, changed or deleted). The reason carries the `fingerprint`; the probe file names the hosts the next run connects to, so a PR cannot widen it unreviewed.

To clear one: `node <repo>/_shared/a1-tools.cjs disposition add --kind config_change --fingerprint <fp> --reason "<why>" --by <author>`
(`<fp>` = `suites.config_changed.fingerprint` or `suites.suite_removed.fingerprint` for `verify.json`, the reason's `fingerprint` for `fidelity.json` and `live-probes.yaml`); a reviewer other than
`<author>` records `disposition review <fp> --verdict upheld --reason "<why>" --by <reviewer>` (5.1); commit and push `.a1/dispositions.json`;
run 5.3 again. The fingerprint covers the exact head content: change the config again and the verdict no longer matches.
The suites run fresh on every merge check (`--no-cache`); no result cache is trusted.
When `.a1/verify.json` carries `ci_evidence` (same value at the base ref tip) and every job of the named workflow (`ci_evidence.workflow`, pull_request runs only) is green on the PR head, the check takes that as the suite result and skips the local runs (report field `ci_evidence.used`). A PR that changes `.a1/verify.json` or a path under `ci_evidence.unchanged`, a missing check name, `--no-ci-evidence` and an `A1_GH_BIN` override still run locally. The shortcut exists only for plans without counting reporters (reporter `none` everywhere); a base-red suite cleared with `--bug` needs `--no-ci-evidence` (CI red stays `ci_check_red`). Wait for CI before starting it.
List every CI job that waits on another job (`needs:`) under `ci_evidence.checks`: a job gh does not list yet cannot be judged, only a listed name is waited for.
Start it only on a quiet host: no other `verify run` or `pr merge-check` running and the 5-minute load below the CPU count.
If a `WAIT` line persists, re-check for at most 15 minutes, then start anyway and record `host_busy` plus the load values
(`load5`, `cpus`) next to the result. A red `reasons[]` entry from a run that started above that bar (timeout, `spawn_failed`,
a timing test green in CI) is re-run once on a quiet host before it counts; write the host and both load values next to any red claim.
The lines below (an `sh` block, not a gate block) print `WAIT` and do not stop the run (a precondition of the registered gate `pr-merge-check`, not a new gate).

```sh
command -v pgrep >/dev/null || echo "HOST: pgrep missing, quiet-host process check skipped"
pgrep -f '(^|/)node .*a1-tools[.]cjs (verify run|pr merge-check)' >/dev/null && echo "WAIT: another verify run or merge check is active"
node -e 'const os=require("os");const l=os.loadavg()[1],n=os.cpus().length;console.log(`load5=${l.toFixed(2)} cpus=${n}`);if(l>=n)console.log("WAIT: host load above CPU count")'
```

Preflight, before the long run (each miss costs a full re-run of 10+ minutes; run only the lines that apply):

- A suite that is red on base and has an a1-fix report: pass `--bug <report-id>` on the first run. The id is the report's file stem `<YYYY-MM-DD>-<bug-slug><suffix>` (vault `project/<slug>/fixes/<id>.md` or `.a1/fixes/<id>.md` committed at base; a report added by the PR branch does not count). With `ci_evidence` configured, also pass `--no-ci-evidence`.
- A config change (the first PR that adds `.a1/verify.json`, `verify_config_changed`) or a `skip_increase` stops the first run: the fingerprint comes from its report. Expect it: add the disposition, have Reinhard review it in the same round, commit and push, run once more.
- Push first, so the head matches (`gh pr view <n> --json headRefOid`).
- A suite that needs `.git` must tolerate the base run from a `git archive` snapshot (no `.git`); a split suite moves a known base-red case to a new id, so name it in the report.
- Never redirect stderr into an unset variable (`2>"$TMPDIR/x"`); guard the path first.

On a host new to this project, run the host check of a1-new-feature `workflows/06-verify.md` Step 0.6 first (owner of that check).

```bash
node <repo>/_shared/a1-tools.cjs pr merge-check --pr <n> --phase pr-<n>; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: pr merge-check exit=$RC, no merge. Read reasons[] on stdout."; exit "$RC"; fi
```

Exit 1 names every red reason in `reasons[]`. Fix the cause and run 5.1 to 5.3 again; never merge around it.

## 5.4 Merge

Run this as the only command of the Bash call. PR bodies go in with `--body-file`, never inline. `<head_sha>` is `head_sha` from the stdout of 5.3 (40 hex): GitHub then merges
that commit or refuses, so a push between the check and the merge cannot slip in (spec 017 review SEC-1).

```bash
gh pr merge <n> --squash --match-head-commit <head_sha>
```

No `--delete-branch`: run from a worktree it removes the folder behind the registry or fails locally after the remote merge.
Then verify it landed (`gh pr view <n> --json state,mergedAt`), sync the primary checkout's `main`
with `_shared/push-cadence.md` P3 (never a bare `git pull`) and advance the registry
(`a1-tools pr mark-status`). Close out in this order; the gate logs are gitignored and go with the worktree:

1. Retros, each with `retro validate --gate-log`, from inside the worktree: the retro of this skill (one retro, written
   now, after the merge, see `04-submit.md` Retro) and the caller's retro (a1-new-feature `workflows/06-verify.md` Step 6, written now;
   a1-fix: already written in `workflows/04-verify.md` Step 2b before the handoff, only check that its entry is present, do not append it again).
2. Run record (the worktree exit deletes the gate logs):

Persist the run record (spec 027 FR-035). `run record` keeps scope, head sha, last verdict, `caught` and summed durations per gate in the learning store, once per scope and PR. Exit 1 (no learning store, no or untrusted gate log) does not stop the close-out: report it. Exit 2 is STOP before the worktree exit. Set `PHASE` to the phase name the caller handed over (a1-new-feature spec id, a1-execute phase); when a1-pr-review runs on its own, set it to `none`. The block skips the second call for an empty value, `none` or an unreplaced placeholder.

```bash
node <repo>/_shared/a1-tools.cjs run record --repo "<worktree_path>" --scope pr-<n> --pr <n>; RC=$?
if [ "$RC" -eq 2 ]; then echo "STOP: run record pr-<n> exit=2, worktree stays"; exit 2; fi
if [ "$RC" -ne 0 ]; then echo "WARN: run record pr-<n> exit=$RC, durations not persisted"; fi
PHASE='<phase_name>'
case "$PHASE" in
  ""|none|"<"*) echo "SKIP: run record, no caller phase handed over" ;;
  *) node <repo>/_shared/a1-tools.cjs run record --repo "<worktree_path>" --scope "$PHASE" --pr <n>; RC=$?
     if [ "$RC" -eq 2 ]; then echo "STOP: run record $PHASE exit=2, worktree stays"; exit 2; fi
     if [ "$RC" -ne 0 ]; then echo "WARN: run record $PHASE exit=$RC, durations not persisted"; fi ;;
esac
```

3. `a1-worktree` exit `discard`, then origin cleanup (03-exit Step 4.5 deletes the remote branch). Both need no
   confirmation when the PR is merged and a plain `discard` (no `--force-discard`) passes: the CLI verifies the
   branch content is on `origin/<base>` and the tree is clean (03-exit Step 4). If it refuses, confirm.
4. The caller's remaining lifecycle stages (a1-new-feature `workflows/06-verify.md` §5 steps 3-5).

The merge ends the PR, not the feature. Report what was merged and which findings there were.
Production deploys and migrations on a production database still need the user's word.

## 5.5 Live probes (spec 020)

Runs after the merge in 5.4 landed (`gh pr view <n> --json state,mergedAt` shows MERGED) and the deploy of the merged `main` is live.
It measures the merged effect from outside with `.a1/live-probes.yaml`; the project dir is the checkout of the merged `main` with `origin` fetched (the probe file is read from the git blob and must equal the one on `origin/main`).
Exit 1 or 2: report the merged PR as not verified live and name the failing probe; the merge itself stays done. `no_probes`
is reported as "not verified live (no_probes)", never as "verified live". Owner-side only: an intent child is refused with exit 77.

```bash
node <repo>/_shared/a1-tools.cjs probe run --project <dir> --phase pr-<n> --wait 120; RC=$?
if [ "$RC" -ne 0 ]; then echo "STOP: probe run exit=$RC (1 = a probe failed or was not measured, 2 = usage error or hostile file), not verified live"; exit "$RC"; fi
```

## Failure modes

- Any of 5.1 to 5.3 exits 1 or 2: no merge. Report the reason, fix, repeat from 5.1.
- 5.5 exits 1 or 2: the merge stays done; report "not verified live" with the failing probe ids, fix forward.
