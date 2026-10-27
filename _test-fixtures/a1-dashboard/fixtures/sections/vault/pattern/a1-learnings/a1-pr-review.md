---
date: 2026-09-25
task: PR review + merge for 009-cross-provider-review-gate waves 1–6 (PR
project: a1-specforge
result: pass
issues:
- ci-portability
- harness-argv-limit
evidence: project/a1-specforge/plans/009-cross-provider-review-gate-STATUS.md; PR
  https://github.com/N3URAL-A1/a1-specforge/pull/10; merge 4ee46d9
gates_fired:
- id: pr-reinhard
  verdict: pass
  caught: true
- id: review-empirical-probes
  verdict: pass
  caught: true
what_worked: Per-wave reviews (Samuel ×3, Reinhard ×2) before the full-diff read meant
  the PR review found only cross-module drift (duplicated helpers, log-before-permit,
  ADR vs shipped) — all real, all fixed in one commit; Reinhard's re-verification
  measured each MAJOR instead of reading the diff.
one_line_learning: A fixture suite that is green on macOS is not green in CI — `stat
  -f` and data-as-argv to `node -e` failed 6 cases on ubuntu; CONVENTIONS.md should
  require portable helpers (mode via python3 os.stat, JSON via file) and the executor
  should run the suite once under `docker run ubuntu` or at least grep for `stat -f`
  before the PR.
permalink: vault/pattern/a1-learnings/a1-pr-review
---


---
date: 2026-09-26
task: PR review + merge for 010-vault-cockpit-contract waves 1–8 (PR #11)
project: a1-specforge
result: pass
issues:
- ci-portability
- vault-less-side-effects
- test-written-from-code
evidence: project/a1-specforge/plans/010-vault-cockpit-contract-STATUS.md; PR
  https://github.com/N3URAL-A1/a1-specforge/pull/11; merge 26915b0
gates_fired:
- id: pr-reinhard
  verdict: fail-then-pass
  caught: true
- id: review-empirical-probes
  verdict: pass
  caught: true
what_worked: Reinhard ran main and branch side by side and measured stderr, which
  found the checklist code-roots line (M2) and the non-idempotent --fix-type (M3)
  that no suite covered. Splitting the fixes into two agents with disjoint files plus
  a spec agent finished 22 findings in one round; the re-review found only 1 MINOR.
one_line_learning: The same portability class as PR #10 hit again (`mktemp -d -t
  name` without XXX) despite last run's lesson — a lesson in a retro does not
  prevent anything; it only works as a check. Fixed by case L1 (a1-vault-fallback),
  which scans every fixture script for BSD-only traps. Second learning — a failing
  mktemp with an unguarded `cd "$empty"` ran scenarios inside the checkout; every
  temp var needs a non-empty-directory guard.
permalink: vault/pattern/a1-learnings/a1-pr-review
---

---
date: 2026-09-29
task: review + squash-merge NOURA M1-P1..P3 architecture docs (PR mellow-rob/noura#1)
project: noura
result: pass
issues: [contradictions_found_by_second_reviewer, three_review_rounds]
evidence: https://github.com/mellow-rob/noura/pull/1 merged as 747086c
gates_fired:
  - {id: pr-reinhard, verdict: pass, caught: true}
what_worked: Running a line-level reviewer (Reinhard) and an audience/fact reviewer (Bertram) in parallel on an outward-facing architecture doc — their findings converged on the same four contradictions, which made the fix list unambiguous; a short confirmation pass on only the open items closed the loop without a third full review.
one_line_learning: For documents going to a security lead, the fact/audience review finds the real blockers (overclaims like "nie", tier contradictions, board citations) that a green check script and a PASS verifier do not — schedule it before verification, not after; and after a squash merge the worktree exit needs --force-discard, so verify tree equality against main first.

---
date: 2026-10-19
task: PR review for 019-depth-pass-planning, 0 BLOCKER, 3 MAJOR, 6 MINOR; all fixed in one round except the deferred registry row; PR #51 opened; registry row landed after 016 released the claim; squash-merged 2026-10-20 as f6c7160
project: a1-specforge
result: pass
issues: [merge-pending-user-decision, registry-row-held-by-other-feature, reinhard-background-loop-unfinished]
evidence: https://github.com/N3URAL-A1/a1-specforge/pull/51; .a1-review/findings.json in the 019 worktree
gates_fired:
  - {id: pr-reinhard, verdict: pass, caught: true}
what_worked: Reinhard measured his claims (ENOENT reproduction, ls of _shared across projects) so every MAJOR was actionable without a second round; findings.json plus one Walter fix commit closed 8 of 9 items in ~15 minutes.
one_line_learning: Run the review's own hostile probes from a target-project cwd, not the a1-specforge repo, because repo-relative paths that work in fixtures fail in every real project.
---

---
date: 2026-10-22
task: PR review + merge for 017-enforced-self-checks (PR #55): 4 review rounds (Reinhard + Samuel), 1 BLOCKER and 6 MAJOR fixed, merge-check red twice on suite timeout, timeout raised via upheld config_change, squash-merged as a9135b4
project: a1-specforge
result: pass
issues: [merge_check_timeout_too_tight, gate_log_lost_with_worktree, permission_classifier_ci_bypass_stop, local_suite_runtime_hours]
evidence: https://github.com/N3URAL-A1/a1-specforge/pull/55 merged as a9135b4; fixes/2026-10-22-verify-merge-check-review-minors.md
gates_fired:
  - {id: spec-roadmap-status-coherent, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: true}
what_worked: Measuring per-suite durations from the CI log turned two identical timeout failures into a one-line config fix with a second-reviewer disposition instead of a third blind re-run.
one_line_learning: A new verify.json timeout must be set from the measured CI duration of the slowest suite (a1-vault-cockpit 27.5 min re-runs a1-xprov), and the worktree exit deletes .a1/phases/pr-<n>/gate-log.jsonl, so write the retro before the exit.
---

---
date: 2026-10-23
task: PR review + merge for 018-pipeline-metrics (PR #57): Reinhard full review (1 MAJOR, 3 MINOR, 1 NIT) plus re-review (APPROVE WITH NITS), all fixed; intent-sandbox line handed to evolve-run-8b by owner decision and pulled back in via main merge; CI green, merge-check ok after 4h44m locally; squash-merged as 6c156fb
project: a1-specforge
result: pass
issues: [merge_check_local_runtime_4h44m, code_scope_conflict_with_parallel_evolve_run, roadmap_status_not_set_by_origin_cleanup]
evidence: https://github.com/N3URAL-A1/a1-specforge/pull/57 merged as 6c156fb; f8aef4c (018 done)
gates_fired:
  - {id: pr-merge-check, verdict: pass, caught: false}
  - {id: spec-roadmap-status-coherent, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: true}
what_worked: Handing the single conflicting intent-sandbox line to the run that held the file, reverting it on the feature branch and merging main after that run landed, resolved a code-scope conflict without either branch waiting on the other's review.
one_line_learning: After origin-cleanup the roadmap feature status stays in-flight until `product stage --set done` runs, and the coherence gate (check 11) is the only thing that notices; run that gate right after `spec update-status done`, and expect the local merge-check to take several hours under load, so start it in parallel with CI, not after.
---

---
date: 2026-10-24
task: PR review + merge for 020-live-probes (PR #58): Samuel 4 rounds (14 SEC findings incl. 3 BLOCKER, 1 MAJOR), Reinhard 1 MAJOR (upper-case HTTP:// cleartext secret) + MINORs, Victor PASS 20/20 FR; CI green, merge-check ok after 3h23m locally; squash-merged as 057fabe
project: a1-specforge
result: pass
issues: [merge_check_local_runtime_3h23m, sec11_reviewed_file_bypass_classes, docker_git_239_lacks_check_attr_source]
evidence: https://github.com/N3URAL-A1/a1-specforge/pull/58 merged as 057fabe; 91c9ccc (020 done)
gates_fired:
  - {id: pr-merge-check, verdict: pass, caught: false}
  - {id: spec-roadmap-status-coherent, verdict: pass, caught: false}
  - {id: pr-reinhard, verdict: pass, caught: true}
what_worked: Every Samuel finding got a red test first and a mutation proof after the fix, so each of the four rounds shrank the bypass class instead of patching single instances; starting merge-check in parallel with CI kept the wait to one window.
one_line_learning: A "reviewed file only" guard must read the blob from the reviewed ref (git cat-file on origin/main with GIT_CONFIG env stripped), never the working tree, because local commits, clean filters, env config, symref HEAD and on-disk deletion each bypassed a worktree-based check.
---
