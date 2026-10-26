---
plan: /Users/rob/N3URAL-Vault/project/a1-specforge/plans/021-dashboard-wave-plan.md
spec: /Users/rob/N3URAL-Vault/project/a1-specforge/spec/021-dashboard.md
goal: "a1-tools dashboard build writes one read-only, secret-free, phone-readable overview note project/<slug>/dashboard.md, refreshed on demand and at the three vault-sync hook points"
verdict: PARTIAL
passed: 26
gaps: 0
residuals: 2
verified: 2026-10-26T17:45:00Z
head: 116d10b
previous: "PARTIAL at d3ca2d6 (3 gaps)"
---

# Verification: 021-dashboard (re-verification after Wave 6 review fixes)

## Verdict: PARTIAL
**Cost:** Cost: 43822815 tokens (in 980, out 248392, cache 43573443) (cost run over ~/.claude/projects/-Users-rob-claude-projects-a1-specforge since 2026-10-24; includes both verification sessions)

All 21 FRs and 5 SCs re-measured at 116d10b. No gap is left that a measurement here can close. All 3 earlier gaps are closed (Gap 1, Gap 3) or are now named CI residuals (Gap 2). The verdict stays PARTIAL for one reason only: the evidence gate. There is no `verify_run` record, because the caller told the verifier not to run the 2-hour full loop. So `verify check` cannot accept PASS (contract Step 4/5). Two named residuals turn this into PASS: (R1) GNU/Linux run of the suite (CI on the PR), (R2) full-loop `verify run --out` record (or green CI as its stand-in, if the orchestrator accepts that).

Evidence base, measured by the verifier at 116d10b (worktree clean, `unset A1_VAULT_ROOT`):
- `bash _test-fixtures/a1-dashboard/run-tests.sh`: rc 0, **423 passed, 0 failed** (was 325).
- `a1-intent`: rc 0, **1105 passed, 0 failed** (`intent-sandbox.cjs` changed on the branch).
- `a1-exit2-audit`: rc 0, 36/0. `a1-metrics`: 333/0. `a1-workflow-lint`: 16/0. `install-sync`: 12/0. `a1-gates-lint`: 90/0.
- `gates lint`, `workflow lint`, `bin/verify-install-sync.sh`: rc 0.
- Own probes in a scratch fixture: own fs trace preload with a liveness check (274 calls traced), own tree hashes, own CLI calls. Also one build on this repo against a scratch copy of the real vault (read-only copy; nothing written to `~/N3URAL-Vault`).

## Previous gaps

| Gap (d3ca2d6) | Status at 116d10b | Evidence |
|---|---|---|
| 1 `plain()` mangled spec ids, titles, phase names | CLOSED | `dashboard-sources.cjs`: `plain()` now runs only at lines 50-51 (Now/Next feature titles). `readSpec`, `phaseLine`, `verdictOf` and the Learnings watermark use `cleanText()`. Build on this repo: `- 007-retro-gate-id-validator — Three machine guards … — gate-id validator, imported-expectation — done`, `- 001-roadmap-gate-parallel-features — …`, phase line `007-retro-gate-id-validator — wave 4 done — verification: PASS`. Own probe: title `Leaky ghp_… title and/or CI/CD` -> `Leaky [REDACTED] title and/or CI/CD`. Suite 02.48-02.54 (real spec copies with SOURCES.txt) |
| 2 FR-018 GNU/Linux Docker run | OPEN, residual R1 (CI only) | Docker daemon is down. The CI run on the PR is the evidence |
| 3 `--slug` hint led to exit 1 / call-site prose | CLOSED | `FLAGS = { json, slug: 'value' }`. Probe in a repo without ROADMAP: no slug -> rc 2 `bad_slug: no docs/product/ROADMAP.md — pass <slug> or --slug <slug>`; `--slug fixture-slug --json` -> rc 0 `written`; `a --slug b` -> rc 1 `<slug> and --slug disagree`; `--slug` without value -> rc 1. The `--slug` prose in 04-audit.md:36-41, 02-execute.md:325-327, 03-verify.md:242-245 names both lines. `vault sync` takes `--slug` too (`vault-sync.cjs:42`), so the prose is true for both lines. Suite 05.46, 05.47 |

## Acceptance Criteria Results (spec ACs quoted verbatim)

| Criterion (quoted verbatim) | Status | Evidence |
|---|---|---|
| FR-001 "on a fixture repo whose ROADMAP says `project: fixture-slug`, the command writes exactly one file, `project/fixture-slug/dashboard.md`, and prints its path; with `--json` it prints one object with the keys `ok`, `path`, `status` (`written`) and `degraded` (list of section names)." | PASS | Probe: `{"ok":true,"path":…/project/fixture-slug/dashboard.md,"status":"written","degraded":[…]}`. Same shape on this repo (`degraded: []`). Suite part 01 |
| FR-002 "fixture output contains the seven headings in that order." | PASS | This-repo note: Now (l.11), Next (16), Specs (19), Phases (44), Learnings (57), Open points (60), Cost (63). Ids/titles now whole (Gap 1 closed) |
| FR-003 "a regex check over those two sections finds no `/`-path, no `--flag`, no `gate-` token." | PASS | `grep -E '/\|--\|gate-'` over Now+Next of the this-repo note: 0 hits. Suite 02.54 |
| FR-004 "file-tree hash of the fixture repo and vault, excluding `dashboard.md`, is identical before and after the build." | PASS | Own shasum trees: REPO-SAME, VAULT-SAME. This repo: `git status --porcelain` 0 lines before and after |
| FR-005 "leak fixture plants a distinctive marker string in each excluded file; the marker does not appear in the output; a trace of opened paths contains none of them." | PASS | Markers in reservations/xprov/xprov-secret-allowlist/dispositions/.product-stage.lock.json, `.env`, `.env.local`, `x.lock`, observations.jsonl: 0 in note, stdout, stderr. Own fs trace (open/read/stat/lstat/readdir/exists/realpath): 0 of these paths touched; liveness: 120 fixture paths traced, the expected sources opened |
| FR-006 "a spec title containing a token-shaped string appears redacted in the output." | PASS | `- 099-secret — Leaky [REDACTED] title and/or CI/CD — planned`; raw `ghp_` count 0 |
| FR-007 "fault-injected rename failure leaves the old note byte-identical and exits 2." | PASS | Harness `--fail-rename`: `exit:2, reason write_failed`; `cmp` old note identical; no tmp sibling left |
| FR-008 "two builds with the same fixed clock produce identical bytes; a hand-written `dashboard.md` without the key stays byte-identical and the build exits 2." | PASS | Two harness builds, same clock: sha1 4064799… both. `# my notes` -> rc 2 `foreign_note`, content unchanged. New: FIFO at the note -> rc 2 `foreign_note … not a regular file` (no hang) |
| FR-009 "fixture repo without `docs/product` (slug passed) exits 0 with `Now` showing `not available`; a fixture with zero specs shows `none` under `Specs`; symlinked `project/<slug>/` exits 2 and writes nothing." | PASS | No-docs repo + `--slug` -> rc 0, `degraded` holds Now/Next. Zero specs `none` (suite 02.69). Symlinked project dir (hub present) -> rc 2 `unsafe_path`, target dir stays empty. Symlinked note -> rc 2, link target unchanged. `../x` -> rc 2, outside git -> rc 2. See finding F1 (order with the writer gate) |
| FR-010 "`dashboard build` with `A1_VAULT_ROOT` unset exits 2 with a one-line reason; an unknown flag exits 1." | PASS | rc 2 `no_vault_root: A1_VAULT_ROOT is not set; the dashboard needs an external vault root` (one line); `--bogus` rc 1, one line; no subcommand rc 1 via `usage()` |
| FR-011 "fixture with a foreign `a1_writer_host` writes nothing, prints the skip line and exits 0." | PASS | `A1_HOST_ID=me`, hub `a1_writer_host: other` -> `[a1-tools] dashboard skipped: this host is not the vault writer (me ≠ other)`, JSON `skipped-non-writer`, rc 0, no folder created |
| FR-012 "fixture with 3 VERIFICATION files, 2 with cost lines, shows the exact token sum and `1 run without cost line`; a file with `Cost: unavailable` counts as without." | PASS | 1,000 + 234 + unavailable -> `1,234 tokens across 2 runs with a cost line`, `1 run without cost line` |
| FR-013 "fixture with 100 specs yields a note of at most 400 lines containing `and N more`." | PASS | 101 specs: 71 lines, `- and 62 more`. Renderer now uses a fixed 40-line cap per section (7 x 42 + head < 400); suite asserts the cap on 103 specs |
| FR-014 "`gates lint` exit code unchanged; `a1-tools dashboard` without subcommand exits 1." | PASS | `gates lint` rc 0; no registry row (`grep dashboard gates-registry.md` 0); `dashboard` rc 1; `verify-install-sync.sh` rc 0 |
| FR-015 "grep of the new module finds none of `http`, `https`, `net`, `dgram`, `child_process`, `eval`." | PASS | `grep -nwE` over `_shared/lib/dashboard*.cjs`: 0 hits. Non-relative requires are now only `fs` and `path` (`crypto` removed, tmp name via `io.cjs tmpPathFor`). `peekVaultRoot()` no longer called: vault root comes from `A1_VAULT_ROOT` of the env only, no git child |
| FR-016 "fixture in child mode exits 77 and no note is written." | PASS | `A1_INTENT_CHILD=1` -> rc 77 `intent_child_refused`, no folder. a1-intent 1105/0 |
| FR-017 "on the fixture vault, `vault sync --prune --dry-run` lists at least one planned entry and none for `dashboard.md`; `vault lint` exit code and finding count are identical with and without the note." | PASS | Suite 05.6-05.16 green in the verifier run (count asserts beside the equalities) |
| FR-018 "suite exits 0 on macOS and GNU/Linux Docker; a post-run check finds no new file in the real vault." | PARTIAL (residual R1) | macOS rc 0, 423/0. Real vault: suite 05.44 count 0; own `find ~/N3URAL-Vault -name dashboard.md`: 0. GNU/Linux not run here (Docker daemon down) -> CI on the PR |
| FR-019 "fixture with an existing note prints the path line; without a note it prints none." | PASS | 01-scan.md:85-89 greps `generated:` only, no a1-tools call; suite 05.48-05.51 (hostile value, control chars, missing key) |
| FR-020 "grep finds exactly three `dashboard build` call sites, each after a `vault sync … --phases` line inside the `A1_VAULT_ROOT` guard and each followed by the warn-and-continue line; `workflow lint` stays green." | PASS | Exactly 3 call lines: 04-audit.md:50, 02-execute.md:336 (from `$WORK_PATH`), 03-verify.md:253; each inside `if [ -n "${A1_VAULT_ROOT:-}" ]`, after the `vault sync … --phases` line, followed by `⚠ dashboard build exit=$RC … continuing`. `workflow lint` rc 0, a1-workflow-lint 16/0 |
| FR-021 "no body line of the fixture output starts with `|` or contains `<` followed by a letter." | PASS | Body of the this-repo note and of the probe note: 0 hits. New inert pass for `[`/`]`, backtick, `<%` (suite 02.63-02.68) |
| SC-001 "On this repo, `dashboard build` completes in under 5 seconds and the note answers in-flight, next and open-points lines (3 lines present)." | PASS | 0.26 s wall; Now (3 lines), Next, Open points present |
| SC-002 "Leak fixture: 0 occurrences of any planted secret marker in the note, stdout, stderr and JSON output across all runs." | PASS | Own probe 0; suite part 03 |
| SC-003 "Read-only proof: tree hash outside `dashboard.md` identical before and after every fixture run (100 percent)." | PASS | Own hashes; suite part 03 |
| SC-004 "Degradation: 100 percent of missing-source fixtures exit 0 with a `not available` line; 100 percent of unsafe-path fixtures exit 2." | PASS | Missing docs/phases/watermark -> rc 0 with degraded sections; symlink dir (hub present), symlink note, FIFO note, `../x`, mismatch, no git, no vault -> rc 2. See F1 |
| SC-005 "Full existing fixture suites stay green and the new suite has at least one test per FR." | PARTIAL (residual R2) | Per-FR inventory 05.41 "missing: none". Re-run by the verifier, all green: a1-dashboard, a1-intent, a1-exit2-audit, a1-metrics, a1-workflow-lint, install-sync, a1-gates-lint (see Build/Test). Full 50-suite loop not re-run (caller instruction, about 2 h) |

### Phantom BLOCKERs
none. The wave-plan format has no task checklist that `phantom check` parses (earlier run: `total_completed: 0`). Manual existence check of every Wave 6 artifact: 6b6b57c changes 5 dashboard modules, help, 3 real-file fixtures with SOURCES.txt entries, parts 01/02/03/05, 3 workflow files and 01-scan.md. All substantive.

### Verify manually (weak phantom matches)
none

## Gaps (what's missing or incomplete)
No open gap that a measurement here can close.

### Residual R1: FR-018 GNU/Linux run
- **Criterion affected:** FR-018
- **What was expected:** the suite exits 0 on GNU/Linux Docker.
- **What exists:** a macOS run only. The Docker daemon is down.
- **Close by:** a green CI run of the PR (GNU/Linux), or a docker `node:20` run as non-root.

### Residual R2: no `verify_run` record (full loop)
- **Criterion affected:** SC-005, evidence gate
- **What exists:** targeted suites are green. The 2-hour `verify run --out` was skipped by caller instruction, so `verify check` rejects PASS.
- **Close by:** `node _shared/a1-tools.cjs verify run --out .a1/phases/021-dashboard/VERIFICATION.md --phase 021-dashboard` at the final HEAD, then set the verdict to PASS. Green CI is the stand-in, if the orchestrator accepts it.

### Finding F1 (MINOR, no gap): writer gate now runs before the target checks
- Wave 6 moved the writer gate before `checkTarget` (review item "writer gate first"). The vault-writer rule (`vault-writer.cjs:123`) says: `project/<slug>/` exists but has no hub -> `hub_missing`. A symlinked `project/<slug>/` without a hub is such a case. It now gives `dashboard skipped: writer declaration of s unreadable (hub_missing)` with rc 0, not rc 2. Nothing is written, so safety holds. With a hub present (the AC fixture case) the build exits 2, as FR-009 says. FR-009 does not say which check comes first. Spec owner: say whether the FR-009 unsafe-path exit 2 or the FR-011 skip wins.
- Related, informational: the first build in a project without a hub creates `project/<slug>/`, and the next build then skips with `hub_missing`. This is the same as the existing `vault sync` writer rule (hub before folder, FR-038 of spec 010). It is not new in 021.

## Build / Test Status
- TypeScript: n/a (Node CJS)
- Tests (verifier, macOS, 116d10b): a1-dashboard 423/0; a1-intent 1105/0; a1-exit2-audit 36/0; a1-metrics 333/0; a1-workflow-lint 16/0; install-sync 12/0; a1-gates-lint 90/0. a1-vault-cockpit (covers the 01-scan.md block of FR-019) started, but stopped by the verifier after 2 min without output: a parallel 023 run of the same suite had been running for 54 min. Not part of the evidence; the full loop or CI covers it.
- Lints: `gates lint`, `workflow lint`, `verify-install-sync.sh` rc 0.
- Full loop / `verify run`: NOT run (caller instruction, about 2 h). No `verify_run` record, so `verify check` exits 1 for PASS. Docker node:20: not run (daemon down), CI is the evidence.

## Deviations from Plan
- Closed since d3ca2d6: `crypto` removed (FR-015 text now met); `peekVaultRoot()` replaced by a pure env read (no git child); Phases are now sorted by STATUS/VERIFICATION mtime, newest first (FR-013 "newest" is now by time); the per-section cap is a fixed 40 (no budget sharing).
- Still open, accepted: `source_head` is a new fs-only reader, not an "existing in-repo git helper" (FR-015 text); the Learnings count is reimplemented (guarded by 02.21); the read seam allows `pattern/a1-learnings` and `project/*/postmortems`, now `*.md` only and links refused from the vault root; the denylist is broader than the spec.
- FR-011 wording vs `notWriterReason` (STATUS Wave 6 deviation 1): the plain non-writer line keeps the exact FR-011 text; the unreadable case uses `notWriterReason`. Acceptable.
- Wave 6 adds hardening outside the spec (hard-link refusal `nlink > 1`, FIFO note refusal, wikilink/code-span/template inertion, vault `project/` link refusal). This is in scope of FR-005/FR-008/FR-021 intent.

## Side observation (not 021)
During this run, `~/N3URAL-Vault/project/a1-specforge/product/{index.json,NEXT.md,ROADMAP.md}` and `product/features/023-module-roadmap-views/feature.md` changed at 18:26 local time. That is the product mirror of the 023-module-roadmap-views work. The a1-dashboard suite writes no `product/` files. No `dashboard.md` exists anywhere in the real vault.
