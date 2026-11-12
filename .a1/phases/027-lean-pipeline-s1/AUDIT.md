---
plan: .a1/phases/027-lean-pipeline-s1/PLAN.md
verdict: PASS
blockers: 0
majors: 0
minors: 6
lanes_audited: 3
lane_split_check: PASS
generated: 2026-11-12
round: 2
---

# Plan Audit (round 2 of 2)

## Round 1 findings → resolution

| Id | Round-1 finding | Resolution in revised PLAN.md | Re-checked |
|---|---|---|---|
| B1 | Codex permit claimed, Codex review relied on in 3 places | Codex line removed from answer 4. Task 5.2 Goal and "Review and merge" state the denial and the Samuel + Reinhard path. New D11 says that no task asks for, records or waives a permit. A grep for `Codex`/`xprov` finds only denial statements and the two keep-list ids. | Resolved. `.a1/xprov.json` = `denied` (robert, 2026-11-11). |
| B2 | Quiet-host probe matched itself; no load, no re-check, no context in baseline | `$R/quiet.sh` uses the anchored 05-merge.md 5.3 pattern plus load5 < cpus, with 16 checks before each run and 1 after. `--host-context` has a strict schema, and BASELINE.json carries `host_load` per run plus `cpus` and `host_busy`. A busy run is repeated once, and the shared-host risk goes into STATUS. | Resolved. Measured: the anchored `pgrep -fa` through this shell gives rc=1 (no self-match). A planted `node -e … /x/a1-tools.cjs verify run` is listed (rc=0). The quiet.sh JSON line runs and prints `{"load5":1.65,"cpus":24,"proc_busy":false,"wait":false}`. |
| M1 | Hardcoded main-checkout paths | New "Execution location" section. Probes in 1.2, 1.3, 3.3 and 8.1 are repo-relative or use `$(git rev-parse --show-toplevel)`. The one absolute read (1.1 action 7) is explained. Branch ≠ `main` preconditions are in 7.1 and 8.1, and the carry-over of the `docs/product/*` edits is added. | Resolved |
| M2 | SC-007 post-merge check unmeasurable for prompt ids | Split into 6 deterministic ids (phase-time rows), 4 prompt ids (retro evidence until FR-019) and 2 xprov ids (`n/a`). The SC trailer is reworded. | Resolved |
| M3 | Licence to change a1-xprov asserts | The licence is replaced by "any a1-xprov red is a STOP". `_test-fixtures/a1-xprov/**` is removed from lane gates. Wave 7 and SC-9 assert zero changes there. | Resolved. Re-measured on a `git archive` copy with the exact Task 4.1 row inserted, cwd an empty non-git dir. The 10 SC9 `--base` values print 81-161 chars without the row and 163-243 with it, which matches the plan exactly (bound < 600). I also ran **shard a**, which the plan had not measured (part 37 calls `xprov scope` and lives in shard a), on that copy: `a1-xprov: 2610 passed, 0 failed`, rc=0. Shard b was not re-run (plan R9: 1608/0). |
| M4 | Unconditional second `run record` call | A `case` guard on `PHASE="<phase_name>"` skips an empty value, `none` and `"<"*`. It stays one block, so the count is 6 and the order `DCMGRP`. The RR-guard case is add-only. | Resolved. Measured: `<phase_name>`, empty and `none` print SKIP, and `027-lean-pipeline-s1` runs. |
| m1 | Step name in commit/PR/`node -e` | The rule is in "Execution location" and Task 6.1 | Resolved |
| m2 | "line count does not grow" | Now "777 to 778" | Resolved |
| m3 | Red comparison on `git archive` snapshot | Comparison now runs in a clean a1-worktree (`worktree prepare … --base main`; the `--base` flag exists in `worktree.cjs:478`) | Resolved |
| m4 | Loose BASELINE details | `base_sha` = `$MB`, `host_label` instead of the hostname, `--base "$MB"`, command count = glob + 1 | Resolved (see n4 for one wording slip) |
| m5 | Regex built from step name | String comparison of the trimmed value, plus W14k3 and a RED-proof for a regex build | Resolved |
| m6 | RED-proof lines only comments | New RED-proof rule: 19 mutations applied on a scratch copy, logged and counted in 7.1 action 9 (4+2+1+3+5+4 = 19 checks out) | Resolved, but see n1 |
| m7 | retro-validate, depth-pass missing from 4.1 action 6 | Added | Resolved |

## Verdict: PASS

No BLOCKER and no MAJOR remain. All 13 round-1 findings are resolved in the plan text. Every measurement the revision claims reproduced when I re-ran it, and the one gap in the M3 measurement (a1-xprov shard a) is now measured green. Slice coverage stays bijective: FR-001..FR-005, FR-033, FR-034 and FR-035 map to SC-1..SC-8. Spec SC-001 and SC-007 are deferred to post-merge with a method that is now honest per gate kind. No Codex step appears anywhere. The six MINOR items below are small fixes the executor can apply in place. The two worth applying before execution are n1 (the RED-proof command fails verbatim on aiserver) and n2 (the Wave 7 integration probe passes on an error record).

Measured during this audit (on `main` @ `2ac1a49`, aiserver):
- `lane-split check`: exit 0, PASS, 3 lanes, 0 findings.
- `plan depth-check --phase 027-lean-pipeline-s1`: exit 0, no offending sections.
- `.a1/xprov.json`: `external_review: denied`.
- Quiet-host probe, the M4 guard and the SC9 lengths: see the table above.
- a1-xprov shard a with the new row: 2610 passed, 0 failed.

## Findings

### BLOCKERS (must fix before execution)
None.

### MAJOR (high risk of failure)
None.

### MINOR (execution proceeds, but note)

- **[n1]** The RED-proof rule command fails verbatim on aiserver. The rule says `git init -q && git add -A && git commit -qm snap` inside the scratch copy. This host has no global git identity: `git config --global user.email` is empty, and no `GIT_AUTHOR_*`/`EMAIL` variables are set. The repo identity is `--local` only. A `git commit` in a freshly initialised scratch repo stops with "Author identity unknown"; I hit exactly this during this audit. The same applies to every new fixture that builds its own repo with commits: GF1 (`--diff-base HEAD~1`), VD2, W14c, W14l, RR9 and PT3. Existing suites solve this per repo, for example `a1-verify` `g()` with `-c user.name=t -c user.email=t@t` and `a1-gates-lint` with `git config user.email t@t.dev`. The rule also does not capture the `$(mktemp -d)` path it extracts into.
  > Fix: In the RED-proof rule, write `S=$(mktemp -d); git archive HEAD | tar -x -C "$S"; git -C "$S" init -q && git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm snap`. Add one line saying that every new fixture repo sets a per-repo identity the way the host suite already does.

- **[n2]** The Wave 7 integration probe (Task 7.1 action 8) uses a `--base` value that `xprov scope` refuses. `xprov scope … --base origin/main` exits 2 with `--base must be a commit sha (4-64 hex digits) or HEAD, got "origin/main"` (measured). The hook still writes a `pr-security-surface` line with verdict `error` and an integer `duration_ms`, so the stated check passes. But it then proves only the error path, not a live classification across the lanes.
  > Fix: Use `--base "$(git merge-base origin/main HEAD)"`, and also assert exit 0 and log verdict `pass`.

- **[n3]** In Task 8.1, the order of action 9 conflicts with the Done-when and with the a1-execute commit-landed gate. Action 9 writes STATUS.md *after* the BASELINE commit. The Done-when needs `git show --stat HEAD` to list only `BASELINE.json`. The a1-execute commit-landed gate (`02-execute.md`) then finds a dirty tree and sends Erik back to commit STATUS.md, which moves HEAD. Wave 7 has the same pattern: its carry-over commit has "exactly 8 paths", STATUS.md is written afterwards, and the Wave 8 precondition `git status --porcelain` empty holds only if that STATUS update was committed.
  > Fix: Say "STATUS.md is committed in a separate `docs(027): …` commit after the checks". Phrase the Wave 8 Done-when as "the commit that adds `BASELINE.json` touches only that file" (`git log -1 --format=%H -- .a1/phases/027-lean-pipeline/BASELINE.json` then `git show --stat` on that sha).

- **[n4]** A measured claim is mis-worded. Task 8.1 action 6 says the label `aiserver` "appears in 33 committed STATUS files". The measurement gives 33 occurrences in **3** files (`git grep -c aiserver -- '.a1/phases/*/STATUS*.md'`). The label choice is still sound. Correct the number.

- **[n5]** The Done-whens of Tasks 2.1, 3.1 and 4.1 use `git diff --numstat origin/main -- …` (two-dot, against the working tree) before Wave 7 performs the `git fetch origin main`. That works as long as the local `origin/main` is the plan's base. If main advances during the run, the comparison picks up unrelated changes. Use `git diff --numstat "$(git merge-base origin/main HEAD)" -- …`, or state that origin/main is not fetched before Wave 7.

- **[n6]** a1-execute Step 0c (`01-load.md`) runs before the Isolation Gate. It writes `.a1/phases/027-lean-pipeline-s1/xreview/load-check.last-run.json` into the primary checkout, and that path is not git-ignored (`git check-ignore` exit 1). Two places leave the file out:
  - Task 7.1 action 2 carries over exactly 4 phase files, so the file never reaches the PR.
  - The post-merge clean-up in "Review and merge" removes only the carried copies, so the file stays behind untracked.

  With the denial, load-check returns `accepted: not_applicable` (exit 0) and no question to the owner, so this is clutter, not a stall. Name it in the post-merge clean-up step ("remove `xreview/` of this phase in the primary checkout after the pull"), or carry it over.

## Lane audit (lanes: measure, verify, gates)

- `lane-split check`: exit 0, PASS, 0 findings (re-run on the revised plan).
- Undeclared writes: none. Removing `_test-fixtures/a1-xprov/**` from lane gates matches Task 4.1, which now forbids edits there. RED-proof scratch copies are outside the repo. `STATUS-<lane>.md` is per lane, as a1-execute prescribes. Waves 7 and 8 write `docs/product/**`, the phase folder and `.a1/phases/027-lean-pipeline/BASELINE.json`, and they are sequential after the lanes.
- No wave touches a shared production resource. Wave 8 loads the shared host, and the plan now controls and records that.
- The yield statement is honest: verify and gates run beside measure. Waves 7 and 8 are serial, with about 65 min of measurement plus up to 2 × 15 min of quiet-host wait (the "per run" wording is correct).

## Keep-list check (spec `## Quality Invariants`)

Unchanged from round 1, and the remaining risk is closed: no keep-list gate is weakened. `pr-merge-check` gets only the slug move and the in-process setter. The `pr-security-surface` STOP branch on a non-zero exit stays. Wave 7 asserts that `xprov-scope.cjs`, `verify-base.cjs`, `pr-ci-evidence.cjs`, `quick.cjs` and `xprov-scope-globs.json` are unchanged. The only fixture edits are the three named value changes (F1 key list, `a1-pr-review` 5→6 / `DCMGP`→`DCMGRP`, AU4a 6→7) plus add-only cases. a1-xprov is now provably untouched and green with the new row in both shards.

## What's Good

- The revision answered measurements with measurements. SC9 lengths and the self-match behaviour of the anchored pgrep were measured before planning, and the M4 guard was run against all four inputs. Each reproduced exactly when I re-ran it.
- BASELINE.json is now a defensible oracle for SC-003. It carries the merge-base sha that stays reachable after the squash merge, per-run host load with `checks` and `host_busy` under a strict input schema with planted reds (PT10, 5 asserts), a host label instead of the hostname (PT8 greps for the real hostname), and a bounded repeat rule for a busy host.
- The RED-proof rule turns 19 comment-only mutations into executed, logged, counted red runs. Once n1 is fixed, every new assert has a demonstrated red.
