---
plan: /Users/rob/N3URAL-Vault/project/a1-specforge/plans/021-dashboard-wave-plan.md
spec: /Users/rob/N3URAL-Vault/project/a1-specforge/spec/021-dashboard.md
goal: "a1-tools dashboard build writes one read-only, secret-free, phone-readable overview note project/<slug>/dashboard.md, refreshed on demand and at the three vault-sync hook points"
verdict: PARTIAL
passed: 23
gaps: 3
verified: 2026-10-26T16:50:00Z
head: d3ca2d6
---

# Verification: 021-dashboard

## Verdict: PARTIAL
**Cost:** Cost: 35862940 tokens (in 814, out 169186, cache 35692940) (cost run over ~/.claude/projects/-Users-rob-claude-projects-a1-specforge since 2026-10-24; includes this verification session)

Core behaviour is real, wired and tested: CLI, slug rule, exit contract, atomic owner-marked write, read seam with denylist and redaction, writer gate, cost panel on the 018 parser, three hook call sites, a1-progress line, intent-child refusal. Not PASS because of one data-fidelity defect in the Specs/Phases/Open points sections (FR-002), the missing GNU/Linux Docker run (FR-018 AC), and no `verify_run` record (full loop not re-run by instruction; SC-005 rests on the STATUS claim).

Evidence base: suite `unset A1_VAULT_ROOT; bash _test-fixtures/a1-dashboard/run-tests.sh` run by the verifier at d3ca2d6: rc=0, **325 passed, 0 failed** (part 01: 69, 02: 45, 03: 143, 04: 24, 05: 44), 22 s. Plus independent probes in a scratch fixture (own fs-trace preload, own tree hashes, own CLI calls) and one build on this repo against a scratch copy of the real vault.

## Acceptance Criteria Results (spec ACs quoted verbatim)

| Criterion (quoted verbatim) | Status | Evidence |
|---|---|---|
| FR-001 "on a fixture repo whose ROADMAP says `project: fixture-slug`, the command writes exactly one file, `project/fixture-slug/dashboard.md`, and prints its path; with `--json` it prints one object with the keys `ok`, `path`, `status` (`written`) and `degraded` (list of section names)." | PASS | Probe: text mode prints the path, rc 0, 1 file; `--json` -> `{"ok":true,"path":…,"status":"written","degraded":["Cost"]}`. Slug mismatch -> rc 2 `bad_slug`. `_shared/lib/dashboard.cjs:175-197`, `:209-220` |
| FR-002 "fixture output contains the seven headings in that order." | PARTIAL | Headings Now, Next, Specs, Phases, Learnings, Open points, Cost in order (probe, line 11-35). Learnings count equals `learnings count-since-watermark` on the same vault (5 = 5). **Defect:** FR text requires "id, title, status per spec file"; `plain()` (`dashboard-sources.cjs:41-47`) is applied to spec id/title/status, phase names and Open-points ids and deletes every `gate-*` token and every `/`-word. On this repo 2 of 23 spec ids render wrong: `007-retro-gate-id-validator` -> `007-retro-`, `001-roadmap-gate-parallel-features` -> `001-roadmap-`; title "gate-id validator, imported-expectation" -> "validator, imported-expectation". See Gap 1. |
| FR-003 "a regex check over those two sections finds no `/`-path, no `--flag`, no `gate-` token." | PASS | `plain()` on Now/Next; NOW_MAX 3; suite part 02; this-repo note Now/Next free of paths/flags/gate tokens |
| FR-004 "file-tree hash of the fixture repo and vault, excluding `dashboard.md`, is identical before and after the build." | PASS | Own shasum trees before/after: REPO-SAME, VAULT-SAME (fixture) and repo-unchanged, vault-unchanged (this repo + vault copy); suite part 03 |
| FR-005 "leak fixture plants a distinctive marker string in each excluded file; the marker does not appear in the output; a trace of opened paths contains none of them." | PASS | Own probe: markers in reservations/xprov/xprov-secret-allowlist/dispositions/.product-stage.lock.json, `.env`, `.env.local`, `*.lock`, observations.jsonl -> 0 in note/stdout/stderr; own fs-level trace (node -r preload, all open/read/stat calls) shows none of them opened. Note: the process opens `~/.a1-intents/executor.lock` through the pre-existing `guardDispatch` (intent-child.cjs), not the dashboard module (informational). |
| FR-006 "a spec title containing a token-shaped string appears redacted in the output." | PASS | Probe title `Leaky ghp_AAAA… title` -> `- 099-secret — Leaky [REDACTED] title — planned`, raw token count 0 |
| FR-007 "fault-injected rename failure leaves the old note byte-identical and exits 2." | PASS | Harness `--fail-rename`: result `exit:2, reason write_failed`; `cmp` old note identical; no tmp sibling left. `dashboard.cjs:148-158` |
| FR-008 "two builds with the same fixed clock produce identical bytes; a hand-written `dashboard.md` without the key stays byte-identical and the build exits 2." | PASS | Two harness builds: same sha1 f656b44f…; hand-written `# my notes` -> rc 2 `foreign_note`, content unchanged. Clock is injectable at `buildDashboard(ctx)` level only (CLI uses wall clock) - matches spec |
| FR-009 "fixture repo without `docs/product` (slug passed) exits 0 with `Now` showing `not available`; a fixture with zero specs shows `none` under `Specs`; symlinked `project/<slug>/` exits 2 and writes nothing." | PASS | Probe: no-docs repo + positional slug -> rc 0, `Now: not available (no_product_docs)`; zero specs -> `- none`; symlinked project dir -> rc 2 `unsafe_path`, 0 files; symlinked note -> rc 2; outside git -> rc 2; `../x` -> rc 2. Minor: the no-ROADMAP error says "pass --slug <slug>", but `--slug` exits 1 (Gap 3) |
| FR-010 "`dashboard build` with `A1_VAULT_ROOT` unset exits 2 with a one-line reason; an unknown flag exits 1." | PASS | rc 2 `no_vault_root: no external vault root (tier repo-local); set A1_VAULT_ROOT` (one line); `--bogus` rc 1 via `usage()` |
| FR-011 "fixture with a foreign `a1_writer_host` writes nothing, prints the skip line and exits 0." | PASS | `A1_HOST_ID=other-host` -> stderr `[a1-tools] dashboard skipped: this host is not the vault writer (other-host ≠ fx-writer)`, JSON `status: skipped-non-writer`, rc 0 |
| FR-012 "fixture with 3 VERIFICATION files, 2 with cost lines, shows the exact token sum and `1 run without cost line`; a file with `Cost: unavailable` counts as without." | PASS | Own probe (1,000 + 234 + unavailable): `1,234 tokens across 2 runs with a cost line`, `1 run without cost line`. Parser reused: `metrics-cost.cjs` exports `parseCost, costOfFile`; `dashboard-cost.cjs:12` |
| FR-013 "fixture with 100 specs yields a note of at most 400 lines containing `and N more`." | PASS | Probe: 74 lines, `- and 61 more`. Deviation: per-section cap 40 truncates before the 400-line limit is reached |
| FR-014 "`gates lint` exit code unchanged; `a1-tools dashboard` without subcommand exits 1." | PASS | gates lint rc 0 on main and branch; no registry row; `dashboard` alone rc 1; help, header and unknown-group list name `dashboard`; `bin/verify-install-sync.sh` rc 0 |
| FR-015 "grep of the new module finds none of `http`, `https`, `net`, `dgram`, `child_process`, `eval`." | PASS | `grep -nwE` over `_shared/lib/dashboard*.cjs`: 0 hits. Notes: `dashboard.cjs:16` requires `crypto` (FR text: "only `fs`, `path` and existing in-repo libs"); `peekVaultRoot()` (existing io-roots.cjs) spawns `git rev-parse` when `A1_VAULT_ROOT` is unset; `source_head` is a new fs-only reader, not an existing helper. AC met; text deviations MINOR |
| FR-016 "fixture in child mode exits 77 and no note is written." | PASS | Probe `A1_INTENT_CHILD=1`: rc 77, `intent_child_refused`, 0 notes. Not on any allowlist; classified in `INTENT_CHILD_EXCLUSIONS` plan/execute (`intent-sandbox.cjs`) |
| FR-017 "on the fixture vault, `vault sync --prune --dry-run` lists at least one planned entry and none for `dashboard.md`; `vault lint` exit code and finding count are identical with and without the note." | PASS | Suite 05.6-05.16 (green in verifier run); schema export has no `dashboard` type |
| FR-018 "suite exits 0 on macOS and GNU/Linux Docker; a post-run check finds no new file in the real vault." | PARTIAL | macOS: rc 0, 325/0 (verifier run). Real vault: no file from this suite (05.44 and own `find -newer` stamp check). **GNU/Linux Docker node:20 run not done** (daemon down). See Gap 2 |
| FR-019 "fixture with an existing note prints the path line; without a note it prints none." | PASS | Own run of the 01-scan.md block: `dashboard: <path> (generated 2026-10-26T…)`; missing note -> no line. a1-progress holds no `dashboard build` call |
| FR-020 "grep finds exactly three `dashboard build` call sites, each after a `vault sync … --phases` line inside the `A1_VAULT_ROOT` guard and each followed by the warn-and-continue line; `workflow lint` stays green." | PASS | `04-audit.md:49-50`, `02-execute.md:335-336` (from `$WORK_PATH`), `03-verify.md:252-253`, each inside `if [ -n "${A1_VAULT_ROOT:-}" ]` after the vault sync line; `workflow lint` rc 0 |
| FR-021 "no body line of the fixture output starts with `|` or contains `<` followed by a letter." | PASS | awk/grep over body of probe note and this-repo note: 0 hits |
| SC-001 "On this repo, `dashboard build` completes in under 5 seconds and the note answers in-flight, next and open-points lines (3 lines present)." | PASS | Build on this repo (scratch vault copy): real 0.13 s; Now, Next, Open points present |
| SC-002 "Leak fixture: 0 occurrences of any planted secret marker in the note, stdout, stderr and JSON output across all runs." | PASS | Suite part 03 (143 cases) + own probe: 0 |
| SC-003 "Read-only proof: tree hash outside `dashboard.md` identical before and after every fixture run (100 percent)." | PASS | Suite part 03 + 2 own hash comparisons |
| SC-004 "Degradation: 100 percent of missing-source fixtures exit 0 with a `not available` line; 100 percent of unsafe-path fixtures exit 2." | PASS | Own probes: no docs, no phases, no watermark, no cost -> rc 0 + `not available (<code>)`; symlink dir, symlink note, bad slug, mismatch, no git, no vault -> rc 2 |
| SC-005 "Full existing fixture suites stay green and the new suite has at least one test per FR." | PARTIAL | Per-FR inventory: 05.41 "missing: none", 239 cases. Full 50-suite loop NOT re-run by the verifier (instructed; STATUS claims 50/50 rc 0). Re-run by verifier, all green: a1-dashboard 325/0, a1-exit2-audit 36/0, a1-metrics 333/0, a1-gates-lint 90/0, install-sync 12/0. a1-intent (intent-sandbox.cjs changed) not re-run: a parallel 023 a1-intent run was live on the same owner home |

### Phantom BLOCKERs
none. `phantom check` on the wave plan returned `total_completed: 0` (the wave-plan format has no task checklist it can parse), so it proves nothing. Manual existence check instead: every artifact named in waves 1-5 exists and is substantive (`_shared/lib/dashboard{,-read,-sources,-render,-cost}.cjs` 835 lines, `help-dashboard.cjs`, `parts/01..05`, fixtures with SOURCES.txt, three workflow edits, a1-progress edits, intent-sandbox entries, metrics-cost export, README/CONTRIBUTING).

### Verify manually (weak phantom matches)
none

## Gaps (what's missing or incomplete)

### Gap 1: Spec ids, titles and phase names are mangled by the Now/Next plain-language filter
- **Criterion affected:** FR-002 (Specs: "id, title, status per spec file"), also Open points and Phases lines; FR-003 scopes the filter to `Now` and `Next` only.
- **What was expected:** Specs lines show the real spec id and title (redacted only, FR-006).
- **What exists:** `readSpec()` and `phaseLine()` pass id, title, status and phase name through `plain()` (`_shared/lib/dashboard-sources.cjs:41-47, 125-127, 172`), which deletes `\bgate-\S*` and every `/`-word. On this repo: `007-retro-gate-id-validator` shows as `007-retro-`, `001-roadmap-gate-parallel-features` as `001-roadmap-`, and the 007 title loses "gate-id". A title with `and/or` or `CI/CD` would lose that word. No suite case catches it (fixture spec ids hold no `gate-`).
- **Fix:** use `cleanText()` (redact + control chars) for Specs, Phases and Open points; keep `plain()` for Now/Next only. Add a part-02 case with a real spec copy whose id holds `gate-` (e.g. copy `007-retro-gate-id-validator.md`) asserting the exact id and title in Specs, plus a count assert.

### Gap 2: FR-018 GNU/Linux Docker run not done
- **Criterion affected:** FR-018 AC ("suite exits 0 on macOS and GNU/Linux Docker").
- **What was expected:** suite green in Docker `node:20` (non-root).
- **What exists:** macOS run only; Docker daemon was not running.
- **Fix:** start Docker, run the a1-dashboard suite in `node:20` as non-root (CI on GNU/Linux would also give this evidence on the PR).

### Gap 3 (minor): misleading hint on the no-ROADMAP path
- **Criterion affected:** FR-009 / FR-010 (one-line reason quality).
- **What exists:** `dashboard build` without slug and without ROADMAP prints `bad_slug: no docs/product/ROADMAP.md — pass --slug <slug>` (message inherited from `vault-sync.cjs` `resolveSlug`); following it (`--slug x`) exits 1 `unknown flag --slug`. Dashboard takes a positional slug.
- **Fix:** map the message in `slugFor()` to "pass the slug as argument: dashboard build <slug>".

## Build / Test Status
- TypeScript: n/a (Node CJS)
- Tests: a1-dashboard 325 passed / 0 failed (verifier run, macOS, d3ca2d6); a1-exit2-audit 36/0; a1-metrics 333/0; a1-gates-lint 90/0; install-sync 12/0. `gates lint`, `workflow lint`, `verify-install-sync.sh` rc 0.
- Full loop / `verify run`: NOT run by the verifier (caller instruction: 2-hour loop already green per STATUS). No `verify_run` record in this file, so `verify check` cannot accept a PASS. Docker node:20: not run (daemon down).

## Deviations from Plan
- `crypto` required in `dashboard.cjs` (tmp suffix), against plan contract item 5 and FR-015 text "only fs, path"; AC grep unaffected. Acceptable, or switch to an in-repo tmp helper (`io.cjs` exports `tmpPathFor`).
- `source_head` comes from a new fs-only reader in `dashboard.cjs`, not an "existing in-repo git helper" (FR-015 text). No spawn, so the intent holds.
- Vault root via `peekVaultRoot()`; that existing helper spawns `git rev-parse` when `A1_VAULT_ROOT` is unset (before the refusal). Not in the new module.
- Learnings count reimplemented in `dashboard-sources.cjs` (learnings.cjs exits the process); equal to the CLI on the same vault (verifier check 5 = 5). Drift risk if the CLI rule changes; part 02.21 guards it.
- Read seam allows `<vault>/pattern/a1-learnings` and `project/*/postmortems` of all projects (needed for the Learnings count).
- Per-section cap 40 lines; Phases sorted by name descending, so `M*` phases sort above numeric phases ("newest" in FR-013 is lexical, not by date). No effect at today's 11 phases.
- Denylist broader than spec (any `.a1/*.json`, `*.pem`, `*.key`) - acceptable.
- Plan done-when lists the Docker `node:20` run in the coverage matrix (FR-018); not met (Gap 2).

## Side observation (not 021)
During this verification, `~/N3URAL-Vault/project/golden-a|golden-b|golden-c/product/{index.json,NEXT.md,ROADMAP.md}` appeared in the real vault at 17:44:11 local time. The name comes from `_test-fixtures/product-modules/` in the 023-module-roadmap-views worktree, whose suites were running in parallel. The a1-dashboard suite finished before that (17:41) and holds no `golden-*` string. Not deleted (no rm in the vault); route to the 023 run.
