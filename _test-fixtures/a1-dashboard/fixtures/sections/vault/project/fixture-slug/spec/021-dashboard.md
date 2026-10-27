---
id: 021-dashboard
project: a1-specforge
feature_slug: dashboard
title: "a1-dashboard: local read-only view of pipeline state"
status: implementing
created: 2026-10-22
phase_history:
  - "phase=discover completed=2026-10-22T22:16:34.465Z"
  - "phase=specify completed=2026-10-23T06:44:57.624Z"
  - "phase=clarify completed=2026-10-23T06:44:57.625Z"
  - "phase=plan completed=2026-10-23T06:49:32.047Z"
wave_plan_path: project/a1-specforge/plans/021-dashboard-wave-plan.md
verify_failures: []
permalink: vault/project/a1-specforge/spec/021-dashboard
size: M
type: spec
---

# a1-dashboard: local read-only view of pipeline state

> Spec ID: `021-dashboard` · Project: `a1-specforge` · Status: `implementing`

---

## Discovery — Problem

- Roadmap backlog and VISION idea #2: "local web UI over `.a1/` state (phases, waves, verifications, learnings, token spend)" so the founder persona sees the pipeline without reading files. Never specified until now.
- The owner is a non-developer. Today status comes from asking an agent (`a1-progress`, `product status`) or opening single files. There is no single page that answers "what is running, what is done, what is stuck, what did it cost".
- Overlap measured 2026-10-23: the vault cockpit (spec 010, status `implementing`) already mirrors `docs/product/*` and `.a1/phases/<phase>/{GOAL,PLAN,STATUS,VERIFICATION}.md` into `project/<slug>/product|phases/` so each file is readable in Obsidian on Mac, server and phone; `a1-progress` already composes status and runs `vault status`; the intent queue (spec 011) is the write path from the phone. What does NOT exist: one aggregated overview page; a view of learnings (counts, pending promotion); a cost/token panel (spec 018 `metrics` lives only on branch `feature/018-pipeline-metrics`; `a1-tools cost` has no list/aggregate subcommand on main).
- Honest delta: the dashboard adds aggregation and plain-language framing, not new data access. A web server adds nothing on phone or server that a vault note does not, and it adds an attack surface and a process to keep alive.

## Discovery — Primary User

- Robert (owner, non-developer, founder persona): wants status without reading files, on Mac and phone (Obsidian is his existing surface).
- Secondary: agents (`a1-progress`) that can point to the page instead of re-explaining.

## Discovery — User Journey

- Robert opens one page (`project/<slug>/dashboard.md` in Obsidian, or a localhost page if that form is chosen) and sees: what is in flight, the next recommended step in one sentence, spec list with status, latest phase/wave state and verification verdict, learnings counts, open clarification markers, cost when available.
- The page is refreshed by a command (`a1-tools dashboard build`) and, per clarification, by the same hook points that already refresh the vault mirror.

## Discovery — Acceptance Criteria

- Read-only: the build reads state and writes exactly one generated artifact; no `.a1/` file, spec, or hub note is modified.
- No secrets: files holding credentials or tokens are never read (reservations, xprov state, dispositions bodies, allowlists).
- Deterministic: no LLM, no network, no new npm dependency.
- A missing source degrades to "not available", never to a crash.

## Discovery — Success Metrics

- Owner can answer "what is in flight, what is stuck, what is next" from one page in under 30 seconds (checked by a fixture that asserts these three lines exist).
- 100 percent of excluded secret files absent from output in the leak fixture.
- Build runtime on this repo under 5 seconds.

## Discovery — Out of Scope

- Any write action from the dashboard (start a skill, edit a spec, approve a gate): the intent queue (spec 011) stays the only phone-to-pipeline write path.
- Live updating, push notifications, charts, authentication/multi-user, remote hosting, hosted SaaS.
- Replacing or changing the vault mirror, `a1-progress`, or `product status`.
- Cross-project portfolio view (one project per build in v1).

## Discovery — Edge Cases

- No vault configured (`A1_VAULT_ROOT` unset): CI fallback, no write; non-writer host (single-writer rule); Obsidian conflict copies of the note; very many specs or learnings (note size cap); phases without STATUS/VERIFICATION; VERIFICATION files with differing cost-line formats; secret-looking strings in spec titles; concurrent build and mirror write; project without `docs/product`.

## Discovery — Compliance

- No personal data. Output is derived from files the owner already has in the vault; credential-bearing files are excluded by an explicit denylist. If a local server were chosen: loopback only, GET only, no CORS, Host-header allowlist (DNS rebinding), random port, no secrets in responses.

## Discovery — Dependencies

- Spec 010 (vault root resolution, `projectsPath`, atomic write style, single-writer rule, excluded-file set, `vault lint` type contract).
- `a1-tools product status`, learning store reader, `cost` reader (VERIFICATION cost lines); spec 018 `metrics` only as a later optional panel.
- `intent-redact.cjs`, intent-child dispatch guard (spec 017/011 era).

## Discovery — Priority

- Backlog item "Someday / Maybe", valuable for the founder persona; not blocking other work. P1 = aggregated read-only overview; P2 = cost panel and auto-refresh; P3 = optional rendering variants.
- Size re-triage at end of Discover: the roadmap pre-set `L` assumed a web server (UI, routing, security surface). On the evidence-based recommended form (generated vault note) it is **M**: one lib module, one CLI group, one `a1-progress` edit, one fixture suite, no migration, no UI framework, no new dependency. If the owner chooses the local web server, size stays **L**.

---

## Overview

`a1-tools dashboard build` generates one read-only overview note for a project from `.a1/` state, `docs/product`, the spec list, the learning store and the mirrored VERIFICATION cost lines: what is in flight, what is next, spec and phase status with verification verdicts, new learnings, open clarification markers and cost. It makes the pipeline visible to a non-developer in the surface he already uses (Obsidian on Mac and phone), without reading files. It reads only non-secret state, writes only the one generated note, runs no server and sends nothing over a network. It is refreshed on demand and automatically at the three existing vault-mirror hook points.

## User Stories

### P1 (Must-have)

**US-021-1** — **As** the owner, **I want** one page that shows what is in flight, what is stuck and what comes next, **So that** I get project status without reading files or asking an agent.

**US-021-2** — **As** the owner, **I want** the view to be read-only and free of secrets, **So that** opening or sharing it cannot change the pipeline or leak credentials.

**US-021-3** — **As** the pipeline (a1-progress, a1-plan, a1-execute), **I want** a deterministic build command with a stable exit contract, **So that** the page can be refreshed and verified without an LLM.

### P2 (Should-have)

**US-021-4** — **As** the owner, **I want** a cost panel and automatic refresh, **So that** the page is current and answers "what did it cost".

## Note Layout (sketch)

Lists and headings only (phone-readable, no tables). Values below are illustrative.

```markdown
---
type: dashboard
project: "[[project/a1-specforge]]"
generated_by: a1-tools dashboard
generated: 2026-10-23T09:00:00.000Z
source_head: d169757
---

> Generated, do not edit; overwritten on every build.

## Now
- Vault cockpit contract: started
- Pipeline metrics: in review

## Next
- Recommended next: KRITIS profile (no unmet dependencies).

## Specs
- 021-dashboard — a1-dashboard — clarified
- 018-pipeline-metrics — Measure the pipeline — implementing

## Phases
- 018-pipeline-metrics — wave 4 of 5 done — verification: PASS

## Learnings
- 3 new learnings since the last evolve run (2026-10-22)

## Open points
- 006-specforge-kritis-profile: 2 open clarification markers

## Cost
- 1,234,567 tokens across 28 runs with a cost line
- 15 runs without cost line
- Source: VERIFICATION cost lines (phase runs only)
```

## Functional Requirements

- **FR-001** — `a1-tools dashboard build [<slug>] [--json]` runs inside the project's git repo (cwd, like `vault sync`) and resolves the slug by the same rule as `vault sync` (the `project:` key of `docs/product/ROADMAP.md`; an explicit slug must agree with it; without a ROADMAP the slug is required). It writes one Markdown note at `<vault>/project/<slug>/dashboard.md`. No server, no HTML output.
  - AC: on a fixture repo whose ROADMAP says `project: fixture-slug`, the command writes exactly one file, `project/fixture-slug/dashboard.md`, and prints its path; with `--json` it prints one object with the keys `ok`, `path`, `status` (`written`) and `degraded` (list of section names).
- **FR-002** — The note holds these sections in this order: `Now` (in-flight features with stage, from `docs/product/index.json`), `Next` (one sentence from the product next cursor), `Specs` (id, title, status per spec file under `<vault>/project/<slug>/spec/`), `Phases` (per `.a1/phases/<phase>/`: latest wave state from `STATUS.md` and verdict from `VERIFICATION.md`), `Learnings` (the count reported by `learnings count-since-watermark` and its watermark date), `Open points` (count of open clarification markers per spec), `Cost`.
  - AC: fixture output contains the seven headings in that order.
- **FR-003** — The `Now` and `Next` lines use plain language (no file paths, no CLI flags, no gate IDs) and fit in 3 lines each.
  - AC: a regex check over those two sections finds no `/`-path, no `--flag`, no `gate-` token.
- **FR-004** — Read-only: the build writes only the dashboard note (and its temporary sibling). It never writes under `.a1/`, `docs/`, spec files, hub notes or the mirror folders (`product/`, `phases/`).
  - AC: file-tree hash of the fixture repo and vault, excluding `dashboard.md`, is identical before and after the build.
- **FR-005** — Secret exclusion: the build never opens `.a1/reservations.json`, `.a1/xprov.json`, `.a1/xprov-secret-allowlist.json`, `.a1/dispositions.json`, any lock file, any `.env*` file, or any basename matched by the mirror exclude list (`MIRROR_EXCLUDES` in `vault-contract.cjs`).
  - AC: leak fixture plants a distinctive marker string in each excluded file; the marker does not appear in the output; a trace of opened paths contains none of them.
- **FR-006** — Every text value taken from a source file (titles, verdicts, marker text) passes through `redact()` from `_shared/lib/intent-redact.cjs` before it is written.
  - AC: a spec title containing a token-shaped string appears redacted in the output.
- **FR-007** — Atomic write: the note is written to `<target>.tmp.<12 hex>` and renamed; a failed write leaves the previous note intact.
  - AC: fault-injected rename failure leaves the old note byte-identical and exits 2.
- **FR-008** — The note carries frontmatter (`type: dashboard`, `project`, `generated_by: a1-tools dashboard`, `generated` ISO timestamp, `source_head` short git hash if available) and a first-body banner "Generated, do not edit; overwritten on every build". The `generated` value comes from an injectable clock so output is byte-identical for identical inputs. An existing `dashboard.md` without `generated_by: a1-tools dashboard` is never overwritten: the build exits 2 with reason `foreign_note`.
  - AC: two builds with the same fixed clock produce identical bytes; a hand-written `dashboard.md` without the key stays byte-identical and the build exits 2.
- **FR-009** — Degradation: a missing or unreadable source (no `docs/product`, no phases, no learnings watermark, no cost data) renders that section as `not available (<reason code>)` and the build still exits 0; an existing but empty source (zero specs, zero phases) renders `none`. An invalid slug, a slug that disagrees with ROADMAP, a cwd outside a git repo, or a symbolic link at `project/<slug>/` or `dashboard.md` exits 2 and writes nothing.
  - AC: fixture repo without `docs/product` (slug passed) exits 0 with `Now` showing `not available`; a fixture with zero specs shows `none` under `Specs`; symlinked `project/<slug>/` exits 2 and writes nothing.
- **FR-010** — Exit codes: 0 = note written (sections may degrade) or skipped on a non-writer host; 1 = usage error (the shared `usage()` contract of every a1-tools group); 2 = unsafe path, slug mismatch, vault root missing (`A1_VAULT_ROOT` unset, CI fallback never written) or not writable, foreign note, write failure. No internal error exits 0.
  - AC: `dashboard build` with `A1_VAULT_ROOT` unset exits 2 with a one-line reason; an unknown flag exits 1.
- **FR-011** — Single writer (ADR 2026-09-24 §2): on a host that is not the project's vault writer (`writerGateFor` in `vault-writer.cjs`), the build does not write, prints one stderr line `[a1-tools] dashboard skipped: this host is not the vault writer (<host> ≠ <writer>)`, reports `status: skipped-non-writer` in JSON and exits 0.
  - AC: fixture with a foreign `a1_writer_host` writes nothing, prints the skip line and exits 0.
- **FR-012** — `Cost` panel: sums the "Cost: N tokens" lines of the phase runs (`<vault>/project/<slug>/phases/*/VERIFICATION.md`, as mirrored) using the cost-line parser of spec 018 (`_shared/lib/metrics-cost.cjs`), not a second parser; fix runs are not counted in v1. It shows the token sum, the number of runs with a cost line, the number of runs without one (a `Cost: unavailable` line or a parse failure counts as without, never as zero) and the source.
  - AC: fixture with 3 VERIFICATION files, 2 with cost lines, shows the exact token sum and `1 run without cost line`; a file with `Cost: unavailable` counts as without.
- **FR-013** — Size cap: the note has at most 400 lines; longer lists truncate to the newest entries and end with `and N more`.
  - AC: fixture with 100 specs yields a note of at most 400 lines containing `and N more`.
- **FR-014** — Registry-free: `dashboard` is a CLI group with one subcommand (`build`); it is not a gate, adds no gate-registry row and no `--phase` call site. `help.cjs`, the CLI header and the unknown-group usage list in `a1-tools.cjs` list `dashboard`; `bin/verify-install-sync.sh` stays green.
  - AC: `gates lint` exit code unchanged; `a1-tools dashboard` without subcommand exits 1.
- **FR-015** — No network, no server, no child process in the new module: it uses only `fs`, `path` and existing in-repo libs (`source_head` comes from an existing in-repo git helper, not a new spawn).
  - AC: grep of the new module finds none of `http`, `https`, `net`, `dgram`, `child_process`, `eval`.
- **FR-016** — Intent children: `dashboard build` is on no intent action allowlist, so the existing dispatch guard (`guardDispatch` in `intent-child.cjs`) refuses it with exit 77 and `intent_child_refused` in child mode.
  - AC: fixture in child mode exits 77 and no note is written.
- **FR-017** — Vault contract: `dashboard.md` sits at the root of `project/<slug>/`; `vault lint` walks only the artifact subfolders and `vault sync --prune` plans extras only inside `product/` and `phases/`, so neither reports or deletes it. `type: dashboard` is not added to the exported `schema export` vocabulary (no contract version bump).
  - AC: on the fixture vault, `vault sync --prune --dry-run` lists at least one planned entry and none for `dashboard.md`; `vault lint` exit code and finding count are identical with and without the note.
- **FR-018** — Test isolation: the fixture suite `_test-fixtures/a1-dashboard/run-tests.sh` runs with `unset A1_VAULT_ROOT` plus a temporary vault, never touches the real vault, and covers every FR with at least one test; fixtures are copied from real `.a1/` and spec files, not derived from the parser.
  - AC: suite exits 0 on macOS and GNU/Linux Docker; a post-run check finds no new file in the real vault.
- **FR-019** — `a1-progress` prints one line with the dashboard path and its `generated` timestamp when the note exists; it never runs `dashboard build` (the skill stays read-only).
  - AC: fixture with an existing note prints the path line; without a note it prints none.
- **FR-020** — Auto refresh: in `skills/a1-plan/workflows/04-audit.md`, `skills/a1-execute/workflows/02-execute.md` and `skills/a1-execute/workflows/03-verify.md`, directly after the existing `vault sync <project-slug> --phases` call and inside the same `A1_VAULT_ROOT` guard, the workflow runs `dashboard build <project-slug>` (from `$WORK_PATH` in 02-execute); a non-zero exit prints one warning line and the workflow continues. Without `A1_VAULT_ROOT` nothing runs and nothing prints (ADR 2026-09-24 §5).
  - AC: grep finds exactly three `dashboard build` call sites, each after a `vault sync … --phases` line inside the `A1_VAULT_ROOT` guard and each followed by the warn-and-continue line; `workflow lint` stays green.
- **FR-021** — Phone-readable format: the note body uses headings and bullet lists only; no Markdown tables, no HTML tags, no embedded images.
  - AC: no body line of the fixture output starts with `|` or contains `<` followed by a letter.

## Success Criteria

- **SC-001** — On this repo, `dashboard build` completes in under 5 seconds and the note answers in-flight, next and open-points lines (3 lines present).
- **SC-002** — Leak fixture: 0 occurrences of any planted secret marker in the note, stdout, stderr and JSON output across all runs.
- **SC-003** — Read-only proof: tree hash outside `dashboard.md` identical before and after every fixture run (100 percent).
- **SC-004** — Degradation: 100 percent of missing-source fixtures exit 0 with a `not available` line; 100 percent of unsafe-path fixtures exit 2.
- **SC-005** — Full existing fixture suites stay green and the new suite has at least one test per FR.

## Acceptance Scenarios

### US-021-1

**Given** a project with two in-flight features and a pending spec
**When** the owner opens `dashboard.md` after `dashboard build`
**Then** the `Now` section lists both features with their stage, `Next` names the recommended next step in one sentence, and `Specs` lists all specs with status.

### US-021-2

**Given** `.a1/xprov.json` and `.a1/reservations.json` hold distinctive strings
**When** `dashboard build` runs
**Then** neither string appears in the note and no repo or vault file besides `dashboard.md` changed.

### US-021-3

**Given** a host that is not the project's vault writer
**When** `dashboard build` runs
**Then** it prints the `dashboard skipped` line, writes nothing and exits 0; and in intent child mode it exits 77.

### US-021-4

**Given** three VERIFICATION files in the mirrored phases folder, two with cost lines
**When** the build runs
**Then** the `Cost` section shows the token sum of the two and `1 run without cost line`.

**Given** `A1_VAULT_ROOT` is set and a wave finishes in `a1-execute`
**When** the workflow runs its `vault sync --phases` step
**Then** it runs `dashboard build` right after, and a failing build prints one warning and does not stop the wave.

## Edge Cases

- No vault root: exit 2 with one-line reason; CI fallback never writes; the workflow hook does not run at all.
- Non-writer host: skip, exit 0 (FR-011).
- Obsidian conflict copy of `dashboard.md`: left untouched; `vault status` reports it (its conflict scan walks all of `project/<slug>/`).
- Hand-written note at `dashboard.md`: never overwritten, exit 2 `foreign_note` (FR-008).
- Phase with no STATUS or VERIFICATION: row shows `not available`.
- Cost-line formats differ across files: reader failure counts the run as without cost line, never as zero.
- Secret-looking text in a spec title: redacted (FR-006).
- Build while the mirror writes, or two builds at once: atomic rename means readers see old or new, never partial; last writer wins.
- More than 400 lines of content: truncated with `and N more`.
- Project without `docs/product`: slug must be passed; `Now`/`Next` degrade, build exits 0.
- Build from a worktree (02-execute hook): reads that worktree's state; `source_head` shows the commit.

## Out of Scope

- Any write action from the page (start skill, edit spec, approve gate); the intent queue stays the only write path.
- Live updating, push notifications, charts, trends/history, authentication, remote hosting.
- A local web server or HTML output (form decision 2026-10-23).
- Changes to the vault mirror, `a1-progress` logic beyond the one path line, `product status`, spec 018 metrics definitions.
- Fix-run cost and the escaped-defect metrics of spec 018 on the page.
- A hub relation line to the dashboard (hub notes stay untouched).
- A delete or clean command; the owner may delete the note, the next build recreates it.
- Cross-project portfolio page.

## Dependencies

- **Spec 018 (pipeline metrics) merged on main** — 021 implementation starts after 018 merges. Reuse the cost-line parser in `_shared/lib/metrics-cost.cjs`; on branch it exports only `cmdMetricsCost`, so 021's plan adds an export of the parser function (e.g. `costOfFile`) if 018 does not ship one.
- Spec 010 (implementing): vault root and `projectsPath`, atomic write style, writer gate (`writerGateFor`), `MIRROR_EXCLUDES`, conflict-copy scan. Plan must check file claims on `a1-progress` (SKILL.md, workflows/01-scan.md), `a1-plan/workflows/04-audit.md`, `a1-execute/workflows/02-execute.md` and `03-verify.md` against open work.
- ADR `docs/adr/2026-09-24-vault-mirror-single-writer.md`: §1 (repo canonical, vault a one-way sink), §2 (single writer, skip line), §5 (vault-free byte-identical), §7 (type vocabulary unchanged), §8 (test isolation) — satisfied by FR-004, FR-011, FR-020, FR-017, FR-018.
- Existing readers: product index/next cursor, `learnings count-since-watermark`, spec frontmatter; `intent-redact.cjs` and the intent-child dispatch guard.
- No migration, no new npm package, no ADR change.

## Clarifications

<!-- Filled by Phase 3. Format: -->
<!-- - **YYYY-MM-DD** — <topic>: <decision>. Reason: <one-sentence>. -->
- **2026-10-23** — Form: generated read-only Markdown note `project/<slug>/dashboard.md` in the vault, no server, no HTML (option A); size stays M. Reason: owner answer.
- **2026-10-23** — Refresh: on demand plus automatically after the existing `vault sync --phases` calls (plan audit pass, after each wave, after verification), FR-020 (option B). Reason: owner answer.
- **2026-10-23** — Cost panel in v1: yes, from VERIFICATION cost lines only with the count of runs without a cost line (option A); parser reused from spec 018 `metrics-cost.cjs`, so 021 implementation starts after 018 merges. Reason: owner answer.
- **2026-10-23** — CLI surface: `dashboard build [<slug>] [--json]` with the `vault sync` slug rule (cwd repo, ROADMAP `project:`), replacing `--project <dir>`. Reason: orchestrator default — matches the real hook call sites, which pass `<project-slug>` (Gate C).
- **2026-10-23** — Exit codes: usage error exits 1 (shared `usage()`), unsafe path / vault / write errors exit 2. Reason: orchestrator default — the real CLI exits 1 on usage for every group (Gate C).
- **2026-10-23** — Non-writer host: ADR §2 skip line on stderr, `status: skipped-non-writer` in JSON, exit 0. Reason: orchestrator default — one skip format across all gated vault writes (Gate C).
- **2026-10-23** — Learnings section: shows the `learnings count-since-watermark` count and watermark date instead of "active / pending promotion". Reason: orchestrator default — no "active lessons" reader exists on main (Gate C).
- **2026-10-23** — UI elements in/out: one new note; the only change to an existing surface is one path line in `a1-progress` output (FR-019); layout per the sketch above. Reason: orchestrator default.
- **2026-10-23** — Navigation & routing: the owner opens `project/<slug>/dashboard.md` in Obsidian or follows the `a1-progress` path line; no hub link. Reason: orchestrator default — hub notes stay untouched (FR-004).
- **2026-10-23** — State after action: build prints the path (text) or one JSON object; no other output. Reason: orchestrator default.
- **2026-10-23** — Empty & error states: missing source = `not available (<reason>)`, empty source = `none` (FR-009). Reason: orchestrator default.
- **2026-10-23** — Permissions: single local owner; only the vault writer host writes (FR-011). Reason: orchestrator default.
- **2026-10-23** — Mobile parity: headings and bullet lists only, no tables or HTML (FR-021). Reason: orchestrator default — Obsidian mobile renders lists reliably.
- **2026-10-23** — Out of scope gaps: trends/history, fix-run cost, hub link and a delete command listed explicitly. Reason: orchestrator default.
- **2026-10-23** — Existing data: a hand-written `dashboard.md` without `generated_by` is never overwritten, exit 2 (FR-008). Reason: orchestrator default — no silent loss of owner notes.
- **2026-10-23** — Duplicate submit: concurrent builds need no lock; atomic rename, last writer wins. Reason: orchestrator default.
- **2026-10-23** — Navigation context carry: the slug and the cwd repo (or worktree) define the context; `source_head` records the commit. Reason: orchestrator default.
- **2026-10-23** — CRUD completeness: create and overwrite only; no edit, no delete command. Reason: orchestrator default.
- **2026-10-23** — ADR constraints: ADR 2026-09-24 vault mirror single writer §1, §2, §5, §7, §8 apply and are covered (see Dependencies); `type: dashboard` stays outside the exported vocabulary. Reason: orchestrator default.

## AC Dry-Run

Surfaces read on main 2026-10-23: `_shared/a1-tools.cjs` (group dispatch, unknown-group list, `guardDispatch` call), `_shared/lib/help.cjs` (`usage()` exits 1), `vault-sync.cjs` (slug rule, prune extras, conflict scan), `vault-mirror.cjs`, `vault-contract.cjs` (`MIRROR_EXCLUDES`), `vault-writer.cjs` (`writerGateFor`), `vault-lint.cjs`, `intent-child.cjs`, `intent-redact.cjs`, `learnings.cjs`, `cost.cjs`, branch `feature/018-pipeline-metrics:_shared/lib/metrics-cost.cjs`, workflows `a1-plan/04-audit.md`, `a1-execute/02-execute.md`, `03-verify.md`, `a1-progress/SKILL.md`.

- FR-001: PASS — owner runs `a1-tools dashboard build` in the repo; NEW: `dashboard` group in `a1-tools.cjs` and `_shared/lib/dashboard.cjs`; slug via the `vault sync` rule; writes under `projectsPath(slug)`.
- FR-002: PASS — sources exist: `docs/product/index.json`/NEXT.md next cursor, vault `spec/*.md`, `.a1/phases/*/STATUS.md|VERIFICATION.md`, `learnings count-since-watermark`; NEW: section renderer.
- FR-003: PASS — regex over the NEW `Now`/`Next` render output.
- FR-004: PASS — tree hash of fixture repo and temp vault around the NEW build.
- FR-005: PASS — all five `.a1/*.json` names exist on disk; `MIRROR_EXCLUDES` is real; NEW: open-path trace seam.
- FR-006: PASS — `redact()` is exported by `intent-redact.cjs`.
- FR-007: PASS — atomic tmp+rename pattern as in `vault-mirror.cjs`; NEW: fault-injection seam.
- FR-008: PASS — NEW: frontmatter writer, injectable clock, `foreign_note` check.
- FR-009: PASS — fixture without `docs/product` takes the real `vault sync` no-ROADMAP branch (slug required); symlink check as in `vault-common.cjs` `isLink`.
- FR-010: PASS — `usage()` exits 1 (measured: `a1-tools vault` and unknown group exit 1); exit 2 for vault/path errors is NEW in the module.
- FR-011: PASS — `writerGateFor` exported by `vault-writer.cjs`; skip line format from ADR §2.
- FR-012: PASS — parser exists in 018's `metrics-cost.cjs` (`costOfFile`, `parseCost`), reads `project/<slug>/phases/*/VERIFICATION.md`; NEW: export, gated on 018 merge (Dependencies). Previous wording "existing cost reader" named `cost run`, which reads session JSONL — fixed.
- FR-013: PASS — NEW: truncation in renderer.
- FR-014: PASS — real `help.cjs` and unknown-group list at `a1-tools.cjs`; `gates lint` exists; missing subcommand exits 1 via `usage()`.
- FR-015: PASS — grep over the NEW module.
- FR-016: PASS — `guardDispatch` runs for every invocation (`a1-tools.cjs` line 175) and refuses any key not on `INTENT_CHILD_ALLOWLIST` with exit 77.
- FR-017: PASS — `vault lint` walks `ARTIFACT_TYPES` subfolders only; `extrasFor` covers `product`/`phases` only; `vault sync --prune --dry-run` exists.
- FR-018: PASS — NEW suite `_test-fixtures/a1-dashboard/run-tests.sh`.
- FR-019: PASS — `skills/a1-progress/SKILL.md` exists and is read-only (line "never runs `vault sync`"); NEW: one path line.
- FR-020: PASS — the three `vault sync <project-slug> --phases` call sites exist inside `A1_VAULT_ROOT` guards with the warn-and-continue pattern; NEW: one `dashboard build` line after each.
- FR-021: PASS — regex over NEW render output.

## Review Checklist

- [x] All P1 stories have at least one Acceptance Scenario
- [x] All FRs are binary and testable
- [x] All SCs are measurable
- [x] No open clarification markers remain
- [x] Out of Scope is non-empty (be explicit, not implicit)
- [x] Dependencies are listed or explicitly "none"
