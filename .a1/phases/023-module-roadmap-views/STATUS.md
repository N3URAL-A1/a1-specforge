# STATUS — 023-module-roadmap-views

Spec: project/a1-specforge/spec/023-module-roadmap-views.md · Plan: project/a1-specforge/plans/023-module-roadmap-views-wave-plan.md
Branch: feature/023-module-roadmap-views · Worktree: a1-worktrees/023-module-roadmap-views

## Wave 2 — Pure module derivation and project NEXT sections

- commit 8560571 (10 files, +566/-37)
- gate0: run-derive.sh exits 0 with 29 passed / 0 failed → re-run by orchestrator, exit 0, 29 PASS, 0 FAIL
- gate0: product-modules.cjs exports (modulesInUse, moduleCursor, blockedReason, renderModuleNext, projectModuleSections, …) → node require lists 16 symbols
- gate0: product-derived.cjs return shape unchanged → exports readProductRoadmap/readProductFeature/roadmapFeatureIdSet/regenerateDerived
- gate0: red-seen evidence → 7 mutations reported by agent (base restore 7 FAIL; deps ignored 4 FAIL; last-vs-first dep 1 FAIL; section order 3 FAIL; None dropped 1 FAIL; cancelled not skipped 5 FAIL; cross fixture added after a surviving mutation)
- deviation (accepted): cursor skips only done/cancelled, in-flight stays eligible — matches spec FR-008/AC-1b; orchestrator brief was wrong on this point
- gate2: NOT APPLICABLE (CLI plugin, no deployment target)

## Wave 1 — Schema keys, validator, byte-identity guard

- commit c57fa61
- gate0: run.sh exits 0 with 51 passed → re-run by orchestrator, exit 0, 51 passed, 0 FAIL lines
- gate0: counter-test — golden file with one appended byte → exit 1, `FAIL golden-a-next-byte-identical`, 50 passed / 1 failed (the earlier "FAIL printed but exit 0" seen mid-wave by the Wave-2 agent is gone)
- gate0: FR-004 warning text present → product-validate.cjs:169
- gate0.8: test-fidelity --diff-base main → {"ok":true,"scanned":2,"count":0}
- gate1: verify run (all fixtures) → started in background, result recorded below
- gate2: NOT APPLICABLE (CLI plugin, no deployment target)

## Wave 3 — Module files in the all-or-nothing transaction

- commit 86831a3
- gate0: run-files.sh 115 passed → re-run by orchestrator, exit 0, 115 passed, 0 FAIL lines
- gate0: 8 regenerateDerived call sites wired → grep over the 6 caller files counts 8 `regenerateDerived(` and `derivedWrites(` is used in each file
- gate0: counter-test rollback → `A1_TEST_FAIL_RENAME_AT_INDEX=1 product changelog` on a copy of docs/product: exit 1, tree hash unchanged, no lock file left
- gate0: red-seen evidence → red run against `git archive HEAD` export: exit 1, 80 FAIL / 35 PASS; 7 deliberate mutants each exit 1
- gap (agent-reported): `_test-fixtures/a1-vault-cockpit/run-tests.sh` (also uses writeAllOrNothing) not run — timed out on the loaded machine; two foreign a1-vault-cockpit runs >90 min observed via ps; covered by the final verify run + CI before merge
- gate1: first full `verify run` started before wave 3 landed → result mixed, discarded; final `verify run` scheduled after wave 5 on the finished branch
- gate2: NOT APPLICABLE (CLI plugin, no deployment target)

## Wave 5 — Help text (step 3 blocked_by_021)

- commit b8f4462 (3 new files)
- gate0: run-help.sh pass=25 → re-run by orchestrator, exit 0, pass=25 fail=0
- gate0: pending patch applies → `git apply --check help-cjs.pending.patch` exit 0 (4 changed lines)
- gate0: help.cjs / a1-tools.cjs untouched → `git diff --quiet main -- …` clean
- gate0: help-product.cjs exports PRODUCT_MODULES_HELP → string, 3084 chars
- open: step 3 (require + usage line + insertion in help.cjs) blocked while 021-dashboard holds help.cjs; apply the patch after its release, then add the `a1-tools --help` contains `--module <slug>` assertion
- gate2: NOT APPLICABLE

## Wave 4 — index.json, schema contract, status, add-milestone flag

- commit 96a9f28 (9 files)
- gate0: run-index.sh 51 passed → re-run by orchestrator, exit 0, passed 51 failed 0
- gate0: SCHEMA.md v1.2, `## 8. Modules (v1.2)`, Vault mirror renumbered `## 9.`, docs/vault.md → §9 → grep confirms (lines 366/421; vault.md:5)
- gate0: `product status` on the repo's own no-module roadmap → keys unchanged [features, milestones, next, project]
- gate0: counter-test on a copy with `modules: [platform, crm-core]` — `add-milestone --module immobilien` → exit 1, error names the validator text, tree hash unchanged
- gate0: positive test — `add-milestone --module platform` → exit 0, `modules/platform/{ROADMAP,NEXT}.md` created, index.json `modules:[platform]`, milestone module keys {null, platform}, no lock file left (closes the agent's "no-lock-left may be weak" note)
- gate2: NOT APPLICABLE

## Branch-level gates (all waves)
- gate0.8 (branch): test-fidelity --diff-base main → {"ok":true,"scanned":5,"count":0}
- walkthrough (orchestrator, independent fixtures built only via CLI, old CLI = main 4965ec2): 27/30 PASS; the 3 FAILs were script defects, each re-checked: AC-6a passes Walter's `check_index_against_schema` + `check_index_deep` (exit 0); AC-3a ROADMAP.md identical old vs new; AC-4a error names milestone by index + value (spec FR-002 satisfied; id parity fixed in rework MINOR 6)
- SC-007 perf-run.cjs → median with 104 ms / without 91 ms / diff 14 ms (limit 1000 ms)
- gate1: first fresh verify run stopped (tree changed by rework) → re-run after rework

## Phase 6 Step 0 — Reinhard full-diff review (2026-10-26)
- Verdict: BLOCK. B1 `product-derived.cjs deriveModuleOutputs` + `locks.cjs`: stale-module cleanup deletes any regular file in slug-named `modules/<x>/` dirs and follows symlinks (reviewer probes P7 symlinked `modules/` → file outside repo deleted, exit 0; P1 no-module project with pre-existing `modules/foo/notes.md` → deleted, violates FR-005; P4 symlinked module dir → files written outside). Tests cemented the behaviour.
- MINOR 1 rollback loses file mode (0600→0644) · MINOR 2 fs error inside lock → `internal error` + lock left · MINOR 3 `derivedWrites` hardcodes lock path · MINOR 4 bare `--module` silently ignored · MINOR 5 FR-015 not met at merge while 021 holds help.cjs; `git apply --check` assertion can redden a foreign PR · NITs (doc comments, FR-012→FR-018, dead lines, grep filter, SCHEMA §8 null note, writeAllOrNothing length)
- Confirmed by reviewer: transaction ordering, byte-identity vs current main, fault injection 0–10 clean, path traversal blocked, a1-vault-cockpit `04a-transaction` 117/0.
- Action: rework dispatched (B1 + MINOR 1–6 + NITs); then Samuel security review of the fix + Reinhard re-check; FR-015 stays OPEN (blocked_by_021) and is reported as such, not ticked.

## Rework after review (commits ec4840e refactor(locks), b66f58b fix(product))
- gate0: orchestrator re-ran reviewer probes on the reworked tree — P1 no-module project with `modules/foo/notes.md`: exit 0, file survives, stderr warning · P7 symlinked `modules/` root with module in use: exit 1, outside untouched, no lock · P4 symlinked in-use module dir: exit 1, nothing written outside, no lock · `modules` as regular file: clean abort, tree unchanged, no lock · stale generated dir removed while hand-written lookalike kept (1 warning) · bare `--module`: non-zero, tree unchanged · validator error names index+id+value · mode 0600 restored after injected rollback
- gate0: suites re-run → run 51/0 · run-derive 29/0 · run-files 142/0 · run-index 59/0 · run-help 25/0 · product-adopt/audit-mirror/docs/import/schema-v11 all exit 0
- open (orchestrator): no-module project with a symlinked `modules/` aborts every product command (rc=1) — bends FR-005; decision: warn and continue instead; to be fixed in final pass after Samuel/Reinhard re-check
- FR-015 remains OPEN (blocked_by_021): help.cjs untouched, patch `_test-fixtures/product-modules/help-cjs.pending.patch` ready

## Samuel security review of the B1 fix (2026-10-26) — FIX FIRST
- SEC-1 BLOCKER `product-derived.cjs:206-221`: on a case-insensitive FS (macOS APFS, confirmed here: `touch a; [ -e A ]` → yes) a symlink `modules/Alpha` is not a slug, so it is treated as a foreign entry, while the writer resolves `modules/alpha/` through it → ROADMAP.md/NEXT.md written outside the repo, exit 0. Reproduced by orchestrator with Samuel's p1.sh (outside/ received both files). Fix: lstat/realpath on the exact path the writer uses for every in-use id (not the directory listing), case-insensitive collision = error, plus realpath check of each target's parent in `prepareOps` (defense in depth for all callers).
- SEC-2 MINOR: in-use `modules/alpha/ROADMAP.md` as symlink → backup reads through the link; on rollback the foreign content is materialised as a regular file in the repo. Fix: lstat-based backup, symlink → abort or restore as link; never read the target.
- SEC-3 MINOR [theoretical]: stale-dir scan reads whole files before checking the name → >512 MB file blocks every command. Fix: check name first, read only the prefix.
- SEC-4 MINOR: rmdir rollback restores dir with default mode (0700→0755). Fix: remember mode, chmod on rollback.
- SEC-5 MINOR: write-target backup uses 'utf8' (not binary-safe); delete backups are Buffers. Fix: Buffer everywhere.
- SEC-6/7 [theoretical]: TOCTOU between check and rename; tmp-file symlink pre-planting (needs PID guess). Accepted as residual risk; documented.
- Policy (Q6): Samuel agrees — no module in use → skip `modules/` entirely with a warning (no readdir/lstat of children, no writes); module in use → hard abort stays; stale slug-named symlink → treat as foreign entry (warn, keep) instead of abort.
- Confirmed OK by Samuel: symlinked root/in-use dir abort; unlink/rmdir never follow links; delete-rollback keeps 0600 and is binary-safe; rollback failure not swallowed ("PARTIAL ROLLBACK"); every caller passes its own lockPath; slug regex blocks traversal/unicode.

## Reinhard re-check (2026-10-26) — APPROVE WITH NITS
- B1 FIXED (P1/P4/P7a/P7b re-probed), MINOR 1–6 FIXED with red-seen evidence against 96a9f28, NITs applied, writeAllOrNothing split behaviour-neutral (fault sweep 7/10/8 unchanged), byte-identity vs main 4965ec2 holds.
- New MINOR: `product-derived.cjs:191` reads every file in a stale dir before the name check → unreadable foreign file (chmod 000) aborts every command, also in no-module projects (FR-005) · `product-derived.cjs:208` stale slug-named symlink not in use aborts (should warn) · `locks.cjs:297` target symlink read through on backup, rollback materialises foreign content as regular file (same as Samuel SEC-2) · NITs: tmp leftover when prepare read fails, redundant check 208/212, SCHEMA §8 "non-empty", warnings repeat on every call, fixture suites run against the real Vault via A1_VAULT_ROOT (stray `project/w3`, `project/bi` created and removed by the reviewer).
- Policy agreed and broadened: no module in use → never abort because of `modules/`; module in use → abort only for `modules/` root and in-use dirs; stale/unreadable/symlink entries → warn, keep.
- Final combined rework dispatched (SEC-1..5 + Reinhard MINORs/NITs + policy + fixture vault hygiene).

## Final rework (commits 3b764bd fix(product) SEC-1..5, 0a063d6 test(product) hardening + vault isolation) — orchestrator gate0 2026-10-26 18:17
- gate0: tree clean at 0a063d6 (`git status --short` 0 tracked changes); Samuel `p1.sh` (case-insensitive `modules/Alpha` symlink, in use): exit=1, `error: modules/alpha is a symbolic link — refusing to follow it`, `outside/ROADMAP.md` still `VICTIM` → SEC-1 closed · `p2.sh` P2b fault injection idx 0–6: victim `SECRET-CONTENT`, link stays `symlink` at every index (SEC-2 closed) · P3/P4 exit=0.
- gate0: Reinhard `probe.sh <tree>` with isolated `A1_VAULT_ROOT`: P1 keeps `modules/foo/notes.md` rc=0 · P7a/P4 rc=1 refuse symlink, outside tree hash unchanged · P7b outside untouched · N1/N1b/N7 rc=1 "all changes rolled back" · N2–N6, N8 no lock left; no `OUTSIDE CHANGED`, no `LOCK LEFT`.
- gate0: suites, each exit=0 — product-adopt 26/0 · product-audit-mirror 20/0 · product-docs 76/0 · product-import 30/0 · product-modules run 51/0, run-derive 29/0, run-files 174/0, run-help 25/0, run-index 59/0 · product-schema-v11 91/0.
- vault hygiene: strays `project/w3` (18:10, produced by probe.sh without A1_VAULT_ROOT) and `project/w4` (17:32) removed; `project/bi` not present; re-check after all probes → no strays. Suites and probes now run with a temp `A1_VAULT_ROOT`.
- next: Samuel confirmation of SEC-1..5 fix, final `verify run` → VERIFICATION.md, lifecycle complete/review/verify, retro, handoff to a1-pr-review. FR-015 stays OPEN (blocked_by_021).

## Phase 6 verify run #1 (18:18–20:25, stopped) — 2 regressions found by the full suite, fixed in 1d-commit
- `verify run` reached the flaky re-run: `a1-gates-lint` h13 **89/1** (N1: README says 49 fixture runners, real 54 — the 5 new product-modules runners) and `a1-vault-cockpit` h36 **994/2** (I1: gates-lint and vault-fallback exit 1 under the sentinel vault; vault-fallback L1: BSD-only `stat -f` in run-files.sh:40). Both suites pass on main (90/0, 18/0) → branch regressions, not pre-existing.
- Fix (orchestrator, 2 one-line edits, run inside the skill's Phase-6 rework): `mode_of` → python3 `os.stat` idiom (same as a1-xprov), README.md:179 count 49→54. README.md is in 021-dashboard's scope — one-line count change, flagged in PR body.
- Re-run on the fixed tree: run-files.sh 174/0 · a1-gates-lint 90/0 · a1-vault-fallback 18/0, each exit 0. All other h-files of run #1 (incl. a1-intent 1105/0) show 0 failed.
- Note: the verify run itself cost ~2 h because a1-vault-cockpit (~80 min) runs every other suite again under a sentinel vault; next run started after this commit.

## Samuel confirmation review of the SEC-1..5 fix (2026-10-26, tree 3b764bd/0a063d6) — APPROVE
- SEC-1..5 CLOSED on the tree (p1.sh exit 1, `outside/ROADMAP.md` stays VICTIM; p2.sh idx 0–6 link stays symlink; Buffer backups; dir/file mode restore).
- Q6 PARTIAL, accepted: a no-module project still reads `modules/` and removes its own stale generated files without a message (documented SCHEMA.md:393-408) — wording deviates from "skip entirely", security-equivalent.
- New: SEC-6 TOCTOU between check and rename [theoretical], SEC-7 absolute paths in stderr [INFO]. Note that `guardTarget` acts repo-wide — orchestrator checked all 8 `derivedWrites` callers write only under `docs/product`.

## Phase 6 verify run #2 (20:31–23:59 CET, exit 0) — PASS
- `verify run` on fda3936 (base 4965ec2, 40 changed files): verdict pass, 54 runners exit 0, flaky [], pre_existing_red []. VERIFICATION.md written (frontmatter `verify_run`), `verify check` ok. Runtime 3.5 h under load ≈8 from three parallel sessions (a1-vault-cockpit alone ≈2.5 h).
- `gate-4.5-fr-consistency` re-fired on the final tree into this worktree's gate log (0 blockers). The original Phase 4.5 / scope-claim / quick-eligibility lines live in the primary checkout's gate log (separate hash chain; logs are not concatenated).
- Verdict PARTIAL: 12/12 ACs PASS, 7/7 SCs PASS, FR-015 OPEN (blocked_by_021) recorded in the spec's `verify_failures`. Next: lifecycle stage `verify`, retro, handoff to a1-pr-review.

## Pre-merge review (a1-pr-review, Reinhard, 2026-10-27, HEAD 4a930e0 on c348e6f) — APPROVE WITH NITS
- SEC-1..5 fix re-probed on HEAD with temp `A1_VAULT_ROOT` (case-variant symlink, lowercase symlinked files, in-use dir as file, foreign header, chmod 000, real-dir case variant, symlinked product dir; no-module: symlinked/unreadable `modules/`, symlinked stale slug): all as policy. Suites run 51/0 · run-derive 29/0 · run-files 174/0 · run-index 59/0 · run-help 25/0 · a1-gates-lint 90/0. Real vault unchanged.
- 0 BLOCKER, 0 MAJOR, 3 MINOR: (1) records cite pre-rebase SHAs → rebase note added to VERIFICATION.md; (2) spec FR-013 not reconciled with the agreed foreign-entry/symlink policy → follow-up: Clarification entry or `a1-reconcile` before the spec moves to `done` (spec is `implementing`, not edited mid-flight); (3) repo-wide symlink-target refusal documented only in SCHEMA §8 → general "Write safety" paragraph added in SCHEMA §1 and named in the PR body as an intended behaviour change.
- Codex (`pr-diff-xprov`): not_applicable, external review denied for this repo (2026-10-19).
