---
type: plan
spec_path: project/a1-specforge/spec/021-dashboard.md
spec_id: 021-dashboard
spec: "[[021-dashboard]]"
project: a1-specforge
created: 2026-10-23
waves: 5
code_scope:
  - _shared/a1-tools.cjs
  - _shared/lib/help.cjs
  - _shared/lib/help-dashboard.cjs
  - _shared/lib/dashboard.cjs
  - _shared/lib/dashboard-read.cjs
  - _shared/lib/dashboard-sources.cjs
  - _shared/lib/dashboard-render.cjs
  - _shared/lib/dashboard-cost.cjs
  - _shared/lib/metrics-cost.cjs
  - _shared/lib/intent-sandbox.cjs
  - skills/a1-plan/workflows/04-audit.md
  - skills/a1-execute/workflows/02-execute.md
  - skills/a1-execute/workflows/03-verify.md
  - skills/a1-progress/SKILL.md
  - skills/a1-progress/workflows/01-scan.md
  - _test-fixtures/a1-dashboard/
  - _test-fixtures/a1-exit2-audit/run-tests.sh
  - CONTRIBUTING.md
  - README.md
lanes: none  # W2, W3, W4 run as one parallel batch (Parallelizable ja, disjoint write sets), but all three fan out of W1 (facade, module skeleton, section contract, suite harness) and fan back into W5 (call sites, intent-sandbox, audit); lanes cannot express the fan-in/fan-out
permalink: vault/project/a1-specforge/plans/021-dashboard-wave-plan
---

# Wave Plan — a1-dashboard (spec 021)

> **Kurzfassung (DE).** 5 Wellen. Zuerst das CLI-Gerüst mit Slug-Regel, Exit-Codes, atomarem
> Schreiben und Frontmatter, dazu feste Stub-Module mit einem Abschnitts-Vertrag. Dann drei
> Wellen parallel: Abschnitte und Darstellung, Sicherheit (Secret-Sperre, Redaktion,
> Nur-Lesen, Writer-Host, kein Netz) und das Kosten-Panel mit dem Parser aus 018. Zuletzt die
> drei Hook-Aufrufe, die a1-progress-Zeile, die Intent-Klassifizierung und der Suite-Audit.
> Start erst nach Merge von 018 (PR #57).

**Precondition (hard): spec 018-pipeline-metrics is merged (PR #57, branch
`feature/018-pipeline-metrics`; state OPEN at plan time 2026-10-23).** 021 branches from
**post-018 `main`**. Files 018 also edits (all held in 018's code-scope reservation):
`_shared/a1-tools.cjs` (facade: `metrics` group), `_shared/lib/help.cjs` (help includes),
`_shared/lib/metrics-cost.cjs` (021 adds one export, see Wave 4), `README.md`, `CONTRIBUTING.md`.
Wave 1 re-reads the facade and `help.cjs` as 018 left them; Wave 4 re-reads `metrics-cost.cjs`
(on the branch it exports only `cmdMetricsCost`; `parseCost`/`costOfFile` exist as internal
functions); Wave 5 re-reads `README.md` and `CONTRIBUTING.md`.

**Files shared with spec 020 (planned, not started) — orchestrator sequences the two features:**

| File | 021 wave | 020 wave |
|---|---|---|
| `_shared/a1-tools.cjs` (group dispatch, CLI header, unknown-group usage list) | 1 | 1 |
| `_shared/lib/help.cjs` (one help include) | 1 | 1 |
| `_shared/lib/intent-sandbox.cjs` (exclusion entries) | 5 | 6 |
| `_test-fixtures/a1-exit2-audit/run-tests.sh` (group entry) | 5 | 6 |
| `README.md` (CLI section) | 5 | 6 |
| `CONTRIBUTING.md` (suite list) | 5 | 6 |

No skill workflow is shared: 021 edits `a1-plan/04-audit.md`, `a1-execute/02-execute.md`,
`a1-execute/03-verify.md`, `a1-progress/{SKILL.md,workflows/01-scan.md}`; 020 edits
`a1-new-feature/06-verify.md`, `a1-pr-review/05-merge.md`, `a1-fix/04-verify.md`,
`agents/a1-victor-verifier.md`. All shared edits are additive one-liners (one dispatch case, one
include, one exclusion entry, one list line), so either order works; the second feature rebases
and re-reads. Recommendation: whichever feature starts second takes its Wave 1 only after the
first has merged its Wave 1 facade edit, and its last wave only after the other's last wave
merged (intent-sandbox, README, CONTRIBUTING).

**Parallelization yield:** 5 waves; W2 ∥ W3 ∥ W4 run as one batch = 3 of 5 waves parallel
(60 %), ~55 % of effort. `lanes: none` (reason in frontmatter). Estimate ~16 agent-hours
sequential (W1 4 h, W2 4 h, W3 3 h, W4 2 h, W5 3 h); critical path W1 → W2 → W5 ≈ 11 h
wall-clock.

**Test infrastructure:** present — bash fixture suites under `_test-fixtures/` (CI loop
`for r in _test-fixtures/*/run*.sh`), shared `_test-fixtures/lib/tmp.sh` (`mk_workdir`),
`node --check` over `_shared/lib/*.cjs` by glob in CI (no CI edit needed), `workflow lint`,
`gates lint`, `a1-intent` (H7), `a1-vault-cockpit`. No Wave 0. Every wave is **TDD-enforced,
autonomous loop**: fixture cases written red first, then code turns them green.

## Depth Pass

### 1 What a top professional would do

A senior tooling engineer building a generated status page over a pipeline that also stores
credentials treats it as a read-only projection with a hard input boundary: one read helper
through which every file open passes (denylist, size cap, symlink refusal, trace hook), so the
"never opens a secret file" claim is enforced in one place and testable by an open-path trace
rather than by grepping output. They would make the output a pure function of inputs plus an
injected clock (byte-identical rebuilds, golden-file tests), write atomically with an ownership
marker so a hand-written note is never clobbered, reuse the existing parsers (018 cost parser,
vault slug rule, writer gate, `MIRROR_EXCLUDES`, `redact()`) instead of writing second copies,
and wire the hook calls warn-and-continue so a dashboard failure never stops a wave. Each rule is
proven by a mutation (remove the denylist entry → leak case red).

### 2 Rawest material

- Real source: `_shared/lib/vault-sync.cjs` (slug rule from ROADMAP `project:`, prune extras),
  `vault-mirror.cjs` (tmp+rename atomic write), `vault-contract.cjs` (`MIRROR_EXCLUDES`),
  `vault-writer.cjs` (`writerGateFor`, `notWriterSkip`), `vault-common.cjs` (`isLink`,
  `isInside`, `externalVaultRoot`, `rootProblem`), `vault-lint.cjs`, `intent-child.cjs`
  (`guardDispatch`), `intent-redact.cjs` (`redact`), `intent-sandbox.cjs`
  (`INTENT_CHILD_EXCLUSIONS`), `learnings.cjs` (count-since-watermark), the facade dispatch in
  `_shared/a1-tools.cjs`, `help.cjs` `usage()`.
- 018 branch `_shared/lib/metrics-cost.cjs` (`parseCost`, `costOfFile`, `COST_LINE_RE`,
  `UNAVAILABLE_RE`) and the real cost-line variants in this repo's
  `.a1/phases/M6-works-for-rob/VERIFICATION.md`, `M7-oss-ready`, `M8-launch-community`
  (plain, comma-grouped, bold, "see cost line at bottom", a command instead of a number).
- Real inputs for fixtures: `docs/product/index.json`, `NEXT.md`, `ROADMAP.md`, vault
  `project/a1-specforge/spec/*.md`, `.a1/phases/*/STATUS.md|VERIFICATION.md`, the three real
  `vault sync … --phases` call sites (04-audit.md:47, 02-execute.md:333, 03-verify.md:250).
- ADR `docs/adr/2026-09-24-vault-mirror-single-writer.md` §1, §2, §5, §7, §8.

### 3 Methods and tools

- Single read seam `dashboard-read.cjs` (`readSource(path, ctx)`: realpath, refuse links,
  denylist by basename and `.a1/` relative path, `.env*` glob, `*.lock`, `MIRROR_EXCLUDES`,
  256 KiB cap, optional `ctx.trace` array) plus `cleanText(value)` = `redact()` + control-char
  strip; every other new module reads only through it.
- Section contract frozen in Wave 1: `{ name, state: 'ok'|'none'|'not_available', reason?,
  items: string[] }`; renderer is a pure function `render(sections, meta) → string`.
- Injectable clock and fs ops as function parameters (no behaviour-changing env var).
- Golden-file comparison, file-tree hash before/after (`find … -type f | sort | xargs cksum`,
  GNU and BSD portable), open-path trace, planted-marker byte search with count asserts,
  mutation proofs on a `git archive` snapshot.
- Docker `node:20` run for GNU portability; `gates lint`, `workflow lint`, `a1-intent` H7,
  `vault lint`, `vault sync --prune --dry-run`.

### 4 External evidence of correctness

- The suite `_test-fixtures/a1-dashboard/run-tests.sh` on macOS and in Docker `node:20`
  (GNU/Linux), with mutation cases (drop a denylist entry, skip `redact`, skip the writer gate,
  skip the foreign-note check — each turns a named case red).
- The repo's deterministic gates: `gates lint` (exit code unchanged), `workflow lint`, the
  `a1-intent` suite (H7 classification of the three new call sites), `a1-vault-cockpit` and
  `a1-exit2-audit` suites, `bin/verify-install-sync.sh`.
- Real vault commands on the fixture vault: `vault lint` finding count and `vault sync --prune
  --dry-run` plan with and without the note.
- A timed real run `dashboard build a1-specforge` against a temp copy of this repo's vault
  folder (< 5 s, SC-001).

### Rewritten brief

Build `a1-tools dashboard build [<slug>] [--json]` as a deterministic, read-only projection that
writes exactly one owner-marked note `project/<slug>/dashboard.md` atomically, on the vault writer
host only. Order: (1) CLI, slug rule, path safety, exit contract, atomic write, ownership marker
and a frozen section contract with stub modules; (2) in parallel — the section readers and the
phone-readable renderer with degradation and size cap; the input boundary (one read seam with
denylist, redaction, trace; writer gate; read-only and no-network proofs); the cost panel on
018's parser; (3) the three warn-and-continue hook calls, the `a1-progress` path line, intent-child
refusal and classification, the vault-contract proof and a per-requirement suite audit. Every rule
ships red-first with a mutation proof; no test touches the real vault.

## Standard wave contract (applies to every wave)

1. **Start:** rebase on post-018 main; re-read the touched files before editing.
2. **Fixtures:** copied from real files (spec files from vault `project/a1-specforge/spec/`,
   `STATUS.md`/`VERIFICATION.md` from `.a1/phases/`, `docs/product/index.json|NEXT.md|ROADMAP.md`),
   source path cited in a comment at the top of the fixture dir's `SOURCES.txt`; never derived
   from the parser. Edits to copies (planted markers, renamed slug) are listed there too. Every
   equality assert has a count assert beside it.
3. **Isolation:** `run-tests.sh` starts with `unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID`,
   uses `mk_workdir`, guards temp vars (`: "${WORK:?}"`), sets `GIT_CONFIG_NOSYSTEM=1
   GIT_TERMINAL_PROMPT=0`. Vault env is set **per call** only (`A1_VAULT_ROOT="$VAULT"
   A1_HOST_ID=fx-writer node …`), with a temp vault whose hub `project/<slug>.md` declares
   `a1_writer_host: fx-writer`; never exported. No case writes to `~/N3URAL-Vault`.
4. **Done when:** `node --check` on every touched `.cjs`; full loop
   `for r in _test-fixtures/*/run*.sh; do bash "$r" || break; done` green;
   `node _shared/a1-tools.cjs workflow lint` and `gates lint` exit 0;
   `bash bin/verify-install-sync.sh` green.
5. **Portability:** no `sed -i ''`, no BSD `date`/`stat`/`mktemp -t`; Node ≥ 18 core modules
   `fs`, `path` only in `dashboard*.cjs` (plus in-repo libs); no new npm dependency.
6. **Exit codes:** 0/1/2 as in the spec; internal errors exit 2 with a one-line message through
   `redact()`, no stack trace.
7. **Module size:** each new `.cjs` < 400 lines, functions < 50 lines; no module-global mutable
   state (context object per call); returned objects frozen.
8. **Deployment chain (all waves):** DB migrations none · RLS/grants none · ENV vars none new
   (reads existing `A1_VAULT_ROOT`, `A1_HOST_ID`, `A1_VAULT_WRITER_HOST`, `A1_INTENT_CHILD`) ·
   services to restart none.
9. **Request-scoped state:** clock, fs ops, trace and env are parameters of `buildDashboard(ctx)`;
   no `let x = null; init(x)` pattern.

## Coverage matrix

| FR | Wave | Verification (suite `a1-dashboard`, part) |
|----|------|--------------------------------------------|
| FR-001 | 1 | `parts/01-cli.sh`: ROADMAP slug → one file at `project/fixture-slug/dashboard.md`; `--json` keys |
| FR-007 | 1 | `parts/01`: injected rename failure → old note byte-identical, exit 2 |
| FR-008 | 1 | `parts/01`: same clock → identical bytes; hand-written note untouched, exit 2 `foreign_note` |
| FR-010 | 1 | `parts/01`: vault unset → exit 2 one line; unknown flag → exit 1 |
| FR-014 | 1 | `parts/01`: `dashboard` alone exit 1; help/header/usage list it; `gates lint` exit unchanged |
| FR-002 | 2 | `parts/02-sections.sh`: seven headings in order (count 7) |
| FR-003 | 2 | `parts/02`: Now/Next regex: no path, no `--flag`, no `gate-` |
| FR-009 | 2 | `parts/02`: no `docs/product` → `not available`, exit 0; zero specs → `none`; symlinked project dir → exit 2 |
| FR-013 | 2 | `parts/02`: 100 specs → ≤ 400 lines, `and N more` |
| FR-021 | 2 | `parts/02`: no body line starts with `\|` or holds `<letter` |
| FR-004 | 3 | `parts/03-safety.sh`: tree hash of repo + vault minus `dashboard.md` unchanged |
| FR-005 | 3 | `parts/03`: planted markers count 0 in note/stdout/stderr/JSON; trace holds none of the excluded paths |
| FR-006 | 3 | `parts/03`: token-shaped title → redacted |
| FR-011 | 3 | `parts/03`: foreign writer → skip line, `skipped-non-writer`, exit 0, no file |
| FR-015 | 3 | `parts/03`: grep `dashboard*.cjs` for `http`, `https`, `net`, `dgram`, `child_process`, `eval` count 0 |
| FR-012 | 4 | `parts/04-cost.sh`: 3 VERIFICATION files, 2 with cost → exact sum, `1 run without cost line` |
| FR-016 | 5 | `parts/05-wiring.sh`: `A1_INTENT_CHILD=1` → exit 77 `intent_child_refused`, no note |
| FR-017 | 5 | `parts/05`: `vault sync --prune --dry-run` ≥ 1 entry, none for `dashboard.md`; `vault lint` same count |
| FR-018 | 5 | `parts/05`: per-requirement case inventory ≥ 21; real-vault post-run check; Docker `node:20` run |
| FR-019 | 5 | `parts/05`: a1-progress scan prints path line with note, none without |
| FR-020 | 5 | `parts/05`: exactly 3 `dashboard build` call sites after `vault sync … --phases` inside the guard; `workflow lint` 0 |

Dependency DAG: 1 → {2, 3, 4}; {2, 3, 4} → 5. No cycles; no wave depends on a later one.

## Scope check

conflict with 018-pipeline-metrics on `_shared/a1-tools.cjs`, `_shared/lib/help.cjs`,
`_shared/lib/metrics-cost.cjs`, `README.md`, `CONTRIBUTING.md` (2026-10-23) — decision: wait for
the holder; 018 releases its claim after PR #57 merges, which is already the hard precondition
above. `code_scope` unchanged.

## Wave 1 — CLI scaffold, slug rule, exit contract, atomic owner-marked write

**Goal:** `dashboard build` resolves the slug, refuses unsafe paths, writes an owner-marked note atomically with deterministic frontmatter, and honours the 0/1/2 contract; section modules exist as stubs behind a frozen contract.
**Depends on:** none (precondition: 018 merged)
**Parallelizable:** nein — single unblocked wave; writes `_shared/a1-tools.cjs`, `help.cjs`, `help-dashboard.cjs`, `dashboard.cjs`, the four stub modules and the suite harness every later wave builds on
**FRs covered:**
- FR-001 — AC: After `dashboard build` runs in a fixture repo whose ROADMAP says `project: fixture-slug`, exactly one new file exists, `<vault>/project/fixture-slug/dashboard.md`, and stdout is its path; with `--json` stdout is one object with keys `ok`, `path`, `status: "written"`, `degraded` (array); an explicit slug that disagrees with ROADMAP exits 2.
- FR-007 — AC: After a build with an injected rename failure (fs-ops parameter in the node harness), the previous `dashboard.md` is byte-identical, no `.tmp.` sibling remains, and the build exits 2.
- FR-008 — AC: After two builds with the same fixed clock on unchanged inputs, the two notes are byte-identical and carry `type: dashboard`, `project`, `generated_by: a1-tools dashboard`, `generated`, `source_head` and the banner line; after a hand-written `dashboard.md` without `generated_by` is present, the build exits 2 with `foreign_note` and the file is byte-identical.
- FR-010 — AC: After `dashboard build` runs with `A1_VAULT_ROOT` unset it exits 2 with one stderr line and writes nothing; an unknown flag exits 1 via `usage()`; a cwd outside a git repo exits 2.
- FR-014 — AC: After the change, `a1-tools dashboard` with no subcommand exits 1; `help`, the CLI header comment and the unknown-group usage list name `dashboard`; `gates lint` exit code equals its pre-change value; `bin/verify-install-sync.sh` is green.
**Stories advanced:** US-021-3

### Brief for code agents

Start: rebase on post-018 main; re-read `_shared/a1-tools.cjs` (group dispatch, unknown-group
usage line, `guardDispatch` call), `help.cjs` (`usage()`, include style of `help-vault.cjs`),
`vault-sync.cjs` (slug rule), `vault-mirror.cjs` (tmp+rename), `vault-common.cjs`
(`externalVaultRoot`, `rootProblem`, `isLink`, `isInside`). Standard wave contract applies.

1. **`dashboard.cjs`** — `cmdDashboard(args)` (subcommand `build` only; missing/unknown → `usage()`
   exit 1; flags `--json`; optional positional slug) and `buildDashboard(ctx)` with
   `ctx = { cwd, env, clock, ops, trace }`. Steps: git-repo check (walk up for `.git` dir or file,
   fs only) → slug by the `vault sync` rule: call the exported `resolveSlug(requested, roadmap)`
   of `vault-sync.cjs` (its ROADMAP frontmatter reader is internal — read
   `docs/product/ROADMAP.md` through `readSource()` and pass `{exists, project}`; map its
   `vaultError('input', …)` to exit 2) → vault root via `externalVaultRoot()` (unset or CI fallback → exit 2)
   → target `projectsPath(slug)/dashboard.md`, refuse a link at the project dir or the target
   (exit 2) → writer gate hook point (Wave 3 fills it; here a pass-through call into
   `dashboard-read.cjs`) → collect sections → render → foreign-note check → write
   `<target>.tmp.<12 hex>` via `ops.writeFileSync` then `ops.renameSync`; on failure unlink the
   tmp and exit 2. Frontmatter writer with `generated` from `ctx.clock()`; `source_head` from an
   existing in-repo git helper that needs no new spawn in this module; if none fits, read
   `HEAD` via fs (`.git` dir or `gitdir:` file, loose ref, `packed-refs`), omit the key when
   unreadable.
2. **Stub modules with the frozen section contract** `{ name, state, reason?, items }`:
   `dashboard-sources.cjs` (`collectSections(ctx)` → six sections, all `not_available
   (not_implemented)`; owned by Wave 2 afterwards), `dashboard-render.cjs` (`render(sections,
   meta)`: frontmatter + banner + `## <name>` + `- item` bullets; owned by Wave 2),
   `dashboard-read.cjs` (`readSource(path, ctx)` plain read with `ctx.trace` push, `cleanText(v)`
   identity, `writerCheck(slug, root, env)` → allow; owned by Wave 3), `dashboard-cost.cjs`
   (`costSection(ctx)` → `not_available`; owned by Wave 4). The stub reason
   `not_implemented` is removed by the owning wave; Wave 5 greps for it (count 0).
3. **Facade + help:** `dashboard` group in `_shared/a1-tools.cjs` (lazy require), CLI header
   comment, unknown-group usage list; NEW `help-dashboard.cjs` with the **final** help text
   (usage, slug rule, sections, exit codes, skip line, read-only promise), one include in
   `help.cjs`. No gates-registry row, no `--phase`.
4. **Suite harness** NEW `_test-fixtures/a1-dashboard/run-tests.sh` (isolation per contract item
   3, helpers `expect`/`expect_count`/`tree_hash`/`mk_fixture_repo`/`mk_fixture_vault`, sources
   `parts/*.sh` by glob in sorted order so later waves add parts without editing it, summary,
   exit code), `fixtures/harness.cjs` (requires `dashboard.cjs` by path, injects clock/ops/trace,
   prints JSON), `fixtures/repo/` and `fixtures/vault/` copied from real files, `SOURCES.txt`,
   `parts/01-cli.sh` with the cases above.

**RED proof:** every case fails before step 1 (group unknown → exit 1 with the unknown-group
line); mutation: drop the foreign-note check → hand-written-note case red; mutation: write
directly to the target → rename-failure case red.

Acceptance: `bash _test-fixtures/a1-dashboard/run-tests.sh` exit 0; `gates lint` exit unchanged.

### Suggested agent(s)

- **a1-walter-web-developer** for `dashboard.cjs`, the stubs, facade, `help-dashboard.cjs`
- **a1-theo-test-engineer** for the harness, real-file fixtures and `parts/01-cli.sh` (red first, in parallel at wave start)

## Wave 2 — Section readers, phone-readable renderer, degradation, size cap

**Goal:** the note shows Now, Next, Specs, Phases, Learnings, Open points and Cost in order, in plain language, lists only, degrading per section and capped at 400 lines.
**Depends on:** Wave 1
**Parallelizable:** ja — runs beside Waves 3 and 4; write set `_shared/lib/dashboard-sources.cjs`, `_shared/lib/dashboard-render.cjs`, `_test-fixtures/a1-dashboard/parts/02-sections.sh`, `_test-fixtures/a1-dashboard/fixtures/sections/` is disjoint from Waves 3 and 4
**FRs covered:**
- FR-002 — AC: After a build on the real-file fixture (2 in-flight features in `index.json`, 3 specs, 2 phases), the note holds exactly seven `## ` headings in the order Now, Next, Specs, Phases, Learnings, Open points, Cost; Now lists both features with stage, Specs lists id, title and status of all 3, Phases shows the latest wave state and the verdict per phase.
- FR-003 — AC: After a build, the Now and Next sections hold at most 3 lines each and a regex over them finds no `/`-path, no `--flag` and no `gate-` token (count 0).
- FR-009 — AC: After a build in a fixture repo without `docs/product` with the slug passed it exits 0 and Now shows `not available (no_product_docs)` and `degraded` in JSON lists it; with zero spec files Specs shows `none`; with `project/<slug>/` as a symlink it exits 2 and writes nothing.
- FR-013 — AC: After a build on a fixture vault with 100 spec files, the note has at most 400 lines and the Specs section ends with `and N more` (N = the truncated count, newest entries kept).
- FR-021 — AC: After a build, no body line of the note starts with `|` and no body line contains `<` followed by a letter (count 0); there are no image embeds.
**Stories advanced:** US-021-1, US-021-3

### Brief for code agents

Start: rebase on main; re-read `dashboard.cjs` (section contract), the stub
`dashboard-sources.cjs`/`dashboard-render.cjs`, and the readers to reuse: product index and next
cursor (`_shared/lib/product*.cjs`), spec frontmatter reader, `learnings.cjs`
(count-since-watermark as a lib call, not a spawn). Standard wave contract applies.

- `dashboard-sources.cjs`: every repo/vault file read goes through `readSource()` of
  `dashboard-read.cjs` (never `fs.readFileSync` directly — Wave 5 greps this); every text value
  passes `cleanText()` (Wave 3 makes it redact). If an existing reader opens files itself (product
  index, learnings), call it only on paths under `docs/product/` resp. the learning store, and
  note that in a module comment. Open points = count of open clarification markers per spec
  (the same marker string the spec template uses; read it, do not invent). Reason codes are a
  closed frozen set (`no_product_docs`, `no_phases`, `no_watermark`, `unreadable`, …) listed in
  `help-dashboard.cjs` (one-line help edit is owned by Wave 5 if new codes appear; record in STATUS).
- Plain-language mapping for Now/Next: stage ids → words (`in review`, `started`), feature titles
  instead of ids where the index has them; strip anything matching path/flag/gate patterns.
- `dashboard-render.cjs`: pure `render(sections, meta)`; headings and `- ` bullets only;
  per-section truncation newest-first with `- and N more`, total budget 400 lines (frontmatter
  included); escape a leading `|` and any `<letter` in source text.
- `parts/02-sections.sh` + `fixtures/sections/` (100-spec vault generated by copying one real
  spec file with renamed ids — record that in `SOURCES.txt`).

**RED proof:** all cases fail against the stubs (`not_implemented`); mutation: drop truncation →
100-spec case red; mutation: emit a table for Specs → `|` case red.

Acceptance: `parts/02-sections.sh` green; SC-001 (three status lines present), SC-004 (degradation half).

### Suggested agent(s)

- **a1-walter-web-developer** for `dashboard-sources.cjs` and `dashboard-render.cjs`
- **a1-theo-test-engineer** for `parts/02-sections.sh` and the section fixtures

## Wave 3 — Input boundary: secret denylist, redaction, read-only, writer gate, no network

**Goal:** the build provably never opens credential files, redacts every source value, writes nothing but the note, writes only on the vault writer host, and the new modules hold no network or process code.
**Depends on:** Wave 1
**Parallelizable:** ja — runs beside Waves 2 and 4; write set `_shared/lib/dashboard-read.cjs`, `_test-fixtures/a1-dashboard/parts/03-safety.sh`, `_test-fixtures/a1-dashboard/fixtures/leak/` is disjoint from Waves 2 and 4
**FRs covered:**
- FR-004 — AC: After a build on the fixture repo and temp vault, the file-tree hash of both, excluding `dashboard.md`, equals the hash taken before the build (and no `.tmp.` sibling remains).
- FR-005 — AC: After the leak fixture plants a distinct marker in `.a1/reservations.json`, `.a1/xprov.json`, `.a1/xprov-secret-allowlist.json`, `.a1/dispositions.json`, a `*.lock`, `.env` and `.env.local` and one `MIRROR_EXCLUDES` basename, the byte search of note, stdout, stderr and `--json` counts 0 per marker, and the open-path trace from the harness lists none of those paths.
- FR-006 — AC: After a spec title holds a token-shaped string (shape taken from the `intent-redact.cjs` patterns), the note shows the redacted form and the raw token counts 0 (unit case on `cleanText` here; the end-to-end Specs case runs in the Wave 5 audit).
- FR-011 — AC: After a build on a fixture vault whose hub declares `a1_writer_host: other-host` (with `A1_HOST_ID=fx-writer`), no file is written, stderr holds exactly `[a1-tools] dashboard skipped: this host is not the vault writer (fx-writer ≠ other-host)`, `--json` holds `status: "skipped-non-writer"`, and the exit code is 0.
- FR-015 — AC: After the change, a grep of `_shared/lib/dashboard*.cjs` for `require('http')`, `https`, `net`, `dgram`, `child_process` and `eval` counts 0.
**Stories advanced:** US-021-2, US-021-3

### Brief for code agents

Start: rebase on main; re-read the stub `dashboard-read.cjs`, `vault-contract.cjs`
(`MIRROR_EXCLUDES`), `vault-writer.cjs` (`writerGateFor`, `notWriterSkip` — reuse its line format,
do not re-type it), `intent-redact.cjs`. Standard wave contract applies.
**Security surface — Samuel reviews this module.**

- `readSource(path, ctx)`: resolve `realpath`; refuse when the path or any parent inside the
  repo/vault root is a link, when it lies outside the repo root or `projectsPath(slug)`, when the
  basename is on the denylist (the four `.a1/*.json` names, `*.lock`, `.env*`, every
  `MIRROR_EXCLUDES` entry) — the check happens **before** `open`, the denied path is not pushed
  to the trace and returns `{ok:false, reason:'excluded'}`; size cap 256 KiB → `too_large`;
  push every opened path to `ctx.trace` when present. Frozen denylist exported for the tests.
- `cleanText(v)`: `redact()` then strip control chars and newlines; returns a string.
- `writerCheck(slug, root, env)`: `writerGateFor`; on deny return the skip object; `dashboard.cjs`
  already calls this hook (Wave 1) — no edit to `dashboard.cjs` in this wave. If the hook
  signature needs a change, stop and record it for Wave 5 instead of editing outside the write set.
- `parts/03-safety.sh`: tree-hash case, leak case (markers via `printf` into copies of the real
  `.a1/*.json` shapes), trace assert, writer-gate skip case, grep case, mutation cases.

**RED proof:** leak and trace cases fail against the stub (plain read); mutation: remove
`dispositions.json` from the denylist → its marker count 1, case red; mutation: skip the writer
check → skip case red.

Acceptance: `parts/03-safety.sh` green; SC-002, SC-003.

### Suggested agent(s)

- **a1-walter-web-developer** for `dashboard-read.cjs`
- **a1-theo-test-engineer** for `parts/03-safety.sh` and the leak fixtures
- **a1-samuel-security** (review only, after the wave): denylist completeness, link/realpath handling, redaction coverage, skip-path correctness

## Wave 4 — Cost panel on the 018 parser

**Goal:** the Cost section sums the mirrored VERIFICATION cost lines with 018's parser and counts runs without a cost line honestly.
**Depends on:** Wave 1
**Parallelizable:** ja — runs beside Waves 2 and 3; write set `_shared/lib/metrics-cost.cjs` (one export line), `_shared/lib/dashboard-cost.cjs`, `_test-fixtures/a1-dashboard/parts/04-cost.sh`, `_test-fixtures/a1-dashboard/fixtures/cost/` is disjoint from Waves 2 and 3
**FRs covered:**
- FR-012 — AC: After a build on a fixture vault with three `project/<slug>/phases/*/VERIFICATION.md` files (two with cost lines copied from the real M6 and M7 files, one with `Cost: unavailable`), the Cost section shows the exact token sum of the two, `2 runs with a cost line`, `1 run without cost line` and the source line; a file with an unparseable cost line also counts as without, never as zero; fix runs are not read.
**Stories advanced:** US-021-4

### Brief for code agents

Start: rebase on post-018 main; re-read `_shared/lib/metrics-cost.cjs` as merged (`parseCost`,
`costOfFile`, regexes, exports) and the stub `dashboard-cost.cjs`. Standard wave contract applies.

- `metrics-cost.cjs`: add `parseCost` (and `costOfFile` if 018 does not already export it) to
  `module.exports`; no other change; the `a1-metrics` suite stays green unchanged.
- `dashboard-cost.cjs`: list `projectsPath(slug)/phases/*/VERIFICATION.md` (link-free, sorted),
  read each via `readSource()` and parse with `parseCost(text)` — not `costOfFile`, so every open
  stays in the read seam and its trace. A result with `tokens` counts as with; any `reason`
  counts as without. No phases folder → `not_available (no_phases_mirror)`; folder without
  VERIFICATION files → `none`. Numbers rendered with a fixed thousands separator (deterministic,
  no locale).
- `parts/04-cost.sh` + `fixtures/cost/` copied from the real VERIFICATION files (cite paths).

**RED proof:** case fails against the stub; mutation: count a parse failure as 0 tokens →
`without` count case red.

Acceptance: `parts/04-cost.sh` green; `a1-metrics` suite green.

### Suggested agent(s)

- **a1-walter-web-developer** for the export and `dashboard-cost.cjs`
- **a1-theo-test-engineer** for `parts/04-cost.sh`

## Wave 5 — Hook call sites, a1-progress line, intent-child classification, vault contract, suite audit, docs

**Goal:** the note refreshes after the three existing vault-sync calls, a1-progress points to it, intent children are refused and the calls are classified, the vault contract is proven, and the suite covers every requirement on macOS and GNU/Linux.
**Depends on:** Wave 2, Wave 3, Wave 4
**Parallelizable:** nein — single unblocked wave; final audit over all earlier write sets and the only writer of `intent-sandbox.cjs`, the three workflows and the docs
**FRs covered:**
- FR-016 — AC: After `A1_INTENT_CHILD=1 dashboard build` in the fixture repo it exits 77 with `intent_child_refused` and no note is written.
- FR-017 — AC: After a build on the fixture vault, `vault sync --prune --dry-run` lists at least one planned entry and none for `dashboard.md`, and `vault lint` exit code and finding count are identical with and without the note; `schema export` output holds no `dashboard` type.
- FR-018 — AC: After `bash _test-fixtures/a1-dashboard/run-tests.sh` runs on macOS and in Docker `node:20`, it exits 0, holds at least one named case per requirement (inventory count ≥ 21), and a post-run check finds no file under the real `~/N3URAL-Vault` newer than the suite's start stamp named `dashboard.md` (check skipped with a printed SKIP when the vault is absent).
- FR-019 — AC: After the a1-progress scan block runs against a temp vault with an existing note it prints one line `dashboard: <path> (generated <timestamp>)`; without the note it prints none; the skill holds no `dashboard build` call.
- FR-020 — AC: After the edits, a grep finds exactly three `dashboard build <project-slug>` call sites (04-audit.md, 02-execute.md from `$WORK_PATH`, 03-verify.md), each directly after its `vault sync <project-slug> --phases` line inside the same `A1_VAULT_ROOT` guard and followed by a one-line warn-and-continue; `workflow lint` exits 0.
**Stories advanced:** US-021-3, US-021-4

### Brief for code agents

Start: rebase on main; re-read the three workflows at the call sites (04-audit.md ~L47,
02-execute.md ~L333, 03-verify.md ~L250), `a1-progress/SKILL.md` and `workflows/01-scan.md`,
`intent-sandbox.cjs`, the `a1-intent` H7 test, `_test-fixtures/a1-exit2-audit/run-tests.sh`.
Standard wave contract applies.

- **Workflows:** after each `vault sync … --phases` + its `if [ $RC -ne 0 ]` line, inside the same
  guard: `node <repo>/_shared/a1-tools.cjs dashboard build <project-slug> >/dev/null; RC=$?` (in
  02-execute: `(cd "$WORK_PATH" && …)`), then `if [ $RC -ne 0 ]; then echo "⚠ dashboard build
  exit=$RC — dashboard not refreshed, continuing"; fi`. No `--phase` (not a gate). Without
  `A1_VAULT_ROOT` the guard already skips everything.
- **a1-progress:** in `01-scan.md` vault block, one shell line that reads
  `$A1_VAULT_ROOT/project/<slug>/dashboard.md` frontmatter `generated:` with `grep`/`head` (no
  `a1-tools` call, so no new H7 entry for progress) and prints the path line when the file exists;
  `SKILL.md` output list gains the line and restates "never runs `dashboard build`".
- **intent-sandbox.cjs:** `dashboard build` stays off every allowlist; add it to
  `INTENT_CHILD_EXCLUSIONS.plan` and `.execute` with a reason constant
  `DASHBOARD = 'writes the generated vault note project/<slug>/dashboard.md; vault writes run owner-side on the writer host (spec 021)'`.
  Check the H7 inventory for any other action whose workflows now reach the call (new-feature
  delegates to a1-plan/a1-execute workflows — verify, do not assume). Run the `a1-intent` suite.
- **exit2-audit:** add `dashboard build` if the suite enumerates groups (vault unset → exit 2,
  unknown flag → 1, help lists it); grep `dashboard*.cjs` for `not_implemented` count 0.
- **`parts/05-wiring.sh`:** intent child case, vault-contract case (real `vault sync --prune
  --dry-run`, `vault lint`, `schema export` on the temp vault), call-site greps with count asserts
  and order check, a1-progress block run against a temp vault, end-to-end redacted Specs title,
  `readFileSync` grep over `dashboard-sources.cjs`/`dashboard-cost.cjs` count 0, per-requirement
  case-name inventory over all parts (≥ 21), real-vault post-run check, timed run < 5 s on a copy
  of this repo's fixture vault (SC-001).
- **Docs:** `CONTRIBUTING.md` suite list gains `a1-dashboard`; `README.md` CLI section lists
  `dashboard build` (one line, read-only note). No version bump unless the release asks.

**RED proof:** before the workflow edits the call-site grep counts 0; before the sandbox entry the
`a1-intent` H7 case is red (unclassified skill call); mutation: drop the warn line in 03-verify →
order case red.

Acceptance: SC-001…SC-005; full loop green on macOS and in Docker `node:20`.

### Suggested agent(s)

- **a1-walter-web-developer** for workflow, a1-progress, intent-sandbox and docs edits
- **a1-theo-test-engineer** for `parts/05-wiring.sh`, the exit2-audit entry, the inventory and the Docker run

## Review routing

- **a1-reinhard-reviewer** (opus) once on the full PR diff before merge (spec ↔ code facts,
  immutability, module size, call-site wording).
- **a1-samuel-security (required, focused).** The build reads a directory that also holds
  credentials and writes into a synced vault. Samuel reviews `dashboard-read.cjs` and the path
  handling in `dashboard.cjs`: denylist completeness against every credential-bearing file under
  `.a1/` and the vault, check-before-open order, symlink/realpath/`isInside` handling, redaction
  coverage of every emitted value (note, stdout, stderr, JSON), writer-gate skip path, atomic
  write and foreign-note refusal. Best timing: after Wave 3 and once more on the final diff
  together with Reinhard.
