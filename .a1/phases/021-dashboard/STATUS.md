# STATUS — 021-dashboard

## Wave 1 — CLI scaffold, slug rule, exit contract, atomic owner-marked write
Completed: 2026-10-24

| Task | Status | Commit | Notes |
|---|---|---|---|
| CLI, slug rule, exit contract, atomic write, stubs, help, suite part 01 | DONE | 3f09541 | suite a1-dashboard 69/69 |

### Wave 2-4 contract (stub seam)
- Section: `{ name, state: 'ok'|'none'|'not_available', reason?, items: string[] }`.
- `dashboard-sources.cjs` `collectSections(ctx)` -> six sections (Now, Next, Specs, Phases, Learnings, Open points). W2 owns.
- `dashboard-cost.cjs` `costSection(ctx)` -> Cost section. W4 owns.
- `dashboard-render.cjs` `render(sections, meta)`; meta `{ slug, generated, sourceHead }`; frontmatter + banner format is tested by part 01. W2 owns.
- `dashboard-read.cjs` `readSource(path, ctx)`, `cleanText(v)`, `writerCheck(slug, root, env)` -> `{allow:true}` | `{allow:false, reason}` where reason is `this host is not the vault writer (<host> ≠ <writer>)` (dashboard.cjs prints `[a1-tools] dashboard skipped: <reason>`). W3 owns.
- ctx passed to readers: `{ cwd, env, clock, ops, trace, args, repoRoot, slug, root }`.
- Stub reason `not_implemented` is removed by the owning wave.
- Suite: parts/*.sh sourced in sorted order; helpers `expect`, `expect_has`, `expect_lacks`, `expect_count`, `tree_hash`, `mk_fixture_repo`, `mk_fixture_vault`, `vault_run`, `harness_run`, `json_get`.

### Deviations
- vault root via `peekVaultRoot()` (same tier rule as `externalVaultRoot()`), because the latter announces the learnings root on stderr.
- README runner count 49 -> 50 in this wave (gates-lint suite checks it). Wave 5 must not bump it again.
- Skip branch for non-writer implemented in dashboard.cjs now.

## Wave 4 — Cost panel on the 018 parser
Completed: 2026-10-24

| Task | Status | Commit | Notes |
|---|---|---|---|
| parseCost/costOfFile export, dashboard-cost.cjs, parts/04-cost.sh, fixtures/cost | DONE | see git log (feat(dashboard): cost panel) | part 04: 24 cases; suite 93/93 before W2/W3 parts landed; a1-metrics 333/0; a1-exit2-audit 31/0 |

### Mutation proofs (git-archive snapshot)
Parse failure counted as with-cost, sum not accumulated, symlinked phase dir followed, read seam bypassed, missing folder -> none, empty folder -> ok, unsorted opens: each turns at least one 04.x case red. Against the stub: 04.2/04.3/04.4/04.6 red.

### Deviations
- None against the plan. Fixture "unavailable" and "ambiguous" files are constructed (no real file carries them); recorded in fixtures/cost/SOURCES.txt.
- Output wording (`N tokens across K runs with a cost line`, `M runs without cost line`) follows the spec example; 04.5-04.10/04.17 assert substrings of the rendered note, so a Wave 2 escaping change could affect them.

## Wave 2 — Section readers, renderer, degradation, size cap
Completed: 2026-10-26

| Task | Status | Commit | Notes |
|---|---|---|---|
| dashboard-sources.cjs, dashboard-render.cjs, parts/02-sections.sh, fixtures/sections | DONE | 839706d | part 02: 45 cases pass, 0 fail; full suite 281/0 (incl. W3 part 03 as landed) |

### Deviations
- Learnings count: `learnings.cjs` runs process.exit and is not callable as a lib, so `dashboard-sources.cjs` reimplements the vault-mode count; part 02 cross-checks it against `learnings count-since-watermark` on the same vault (02.21, equal).
- Reads outside the repo and project/<slug>/ (pattern/a1-learnings, postmortems of any project) are allowed read-only by the Wave 3 seam (`allowedRoots`); needed for Learnings.
- Reason codes emitted: no_product_docs, no_phases, no_watermark, unreadable (all already in the frozen set; Cost owns no_phases_mirror). No help-text change needed.
- Test fix: 02.44 expected id 199-*, but the generated ids top out at 189 (n%90); expectation corrected to the first Specs line.
- Per-section cap 40 lines, total 400 lines incl. frontmatter; `and N more` is exact.

## Wave 3 — Input boundary
Completed: 2026-10-26

| Task | Status | Commit | Notes |
|---|---|---|---|
| dashboard-read.cjs (denylist, link/realpath refusal, size cap, FIFO, UTF-8, cleanText, writerCheck), parts/03-safety.sh, fixtures/leak | DONE | b327775 | part 03: 143 PASS, 0 FAIL; suite 281/0 |

### Mutation proofs (git-archive snapshot, live tree untouched)
D1 drop dispositions.json + generic .a1/*.json rule: 8 red (D1b generic rule only: fidelity red, 5) · D2 denylist after open/trace: 17 red · D3 drop `.env.*`: 6 red · D4 drop case-insensitivity: 2 red (.ENV) · C1 cleanText = String(v): 10 red · W1 writer always allows: 10 red · N1 `require('http')` planted: 1 red (03.17) · L1 no link refusal: 5 red · R1 no root check: 4 red. RED against the Wave 1 stub: leak/trace/link/redaction cases red (143 cases, ~100 failed before).

### Deviations
- Test helper `pj` was missing in the part; added (tolerant json_get). 03.2 threshold `>= 17` was wrong (16 planted refusals); now exact count from `$MARKERS`.
- Seam allows read-only roots beyond repo and project/<slug>/: `<vault>/pattern/a1-learnings` and `<vault>/project/<any>/postmortems` (Wave 2 Learnings count reads them through the seam). Other projects' spec folders and hub notes stay refused (03.5).
- Denylist adds any `*.json` directly in `.a1/` (03.1 plants `.a1/fidelity.json`), `*.pem`, `*.key` beyond the plan's list.
- Repo root for the seam = ctx.repoRoot, else nearest `.git` above ctx.cwd (dashboard.cjs passes bare ctx for ROADMAP). No dashboard.cjs edit needed.
- writerCheck builds the FR-011 line itself (no `of <slug>`; notWriterReason adds it); unreadable declaration reason keeps the vault-writer wording.
- Removed stray parts/03-safety.sh.bak.

## Wave 5 — Hook call sites, a1-progress line, intent-child classification, vault contract, suite audit, docs
Completed: 2026-10-26

| Task | Status | Commit | Notes |
|---|---|---|---|
| Three workflow call sites (04-audit, 02-execute from $WORK_PATH, 03-verify), a1-progress line + SKILL text, INTENT_CHILD_EXCLUSIONS (plan, execute) with DASHBOARD reason, exit2-audit D10/B entry, parts/05-wiring.sh, CONTRIBUTING + README | DONE | 286b997 | a1-dashboard 325/0 (part 05: 44 cases); a1-intent 1105/0; a1-exit2-audit 36/0; full loop 50/50 rc=0 (A1_VAULT_ROOT unset); workflow lint, gates lint, verify-install-sync green |

### Deviations
- Docker `node:20` run NOT done: Docker CLI present, daemon not running (cannot connect to ~/.docker/run/docker.sock).
- FR-016 refusal already worked via the generic guardDispatch (exit 77, `intent_child_refused`, reason `child_context_invalid` without a child lock); no dashboard code change. Only the classification (H7) needed the sandbox entries.
- Vault-contract cases run in an isolated parent dir (`$WORK/iso`): `vault sync` scans sibling repos and failed with "two repos claim project" otherwise.
- a1-progress case runs the documented scan block extracted from 01-scan.md as written (not a re-implementation).
- Case inventory (FR-018) counts FR-001..FR-021 named in section headers/case lines across parts; the real-vault check uses a `touch -t` start stamp derived from `$SECONDS` (portable, harness untouched).
- The full loop ran with stale foreign processes from earlier waves still alive in the same worktree (an old xprov/cockpit chain, PIDs not mine, not killed); the loop still passed.
- Not run: mutation of the call-site order in a snapshot; covered by controls 05.31/05.32 (checker turns red on a dropped warn line and on a misplaced call). H7 red-state checked by scan: plan and execute workflows contain `dashboard build`, so removing the exclusions leaves it unclassified.
