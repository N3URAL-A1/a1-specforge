---
phase: 027-lean-pipeline-s1
goal: Ship delivery slice 1 "Measure + protect" of spec 027-lean-pipeline as one PR. Every gate-log record and every verify-run command carries a measured duration. `metrics phase-time` and `run record` sum the durations and keep them after the worktree is gone, and a baseline is recorded with its host load. The Samuel trigger becomes the registered gate `pr-security-surface`, and a quality-invariant lint fails when any keep-list gate loses its invocation.
spec: /home/rob/N3URAL-Vault/project/a1-specforge/spec/027-lean-pipeline.md (slice 1 only: FR-001..FR-005, FR-033, FR-034, FR-035; SC-001, SC-007; US-027-1, US-027-12)
waves: 8
lanes:
  - id: measure
    waves: [1, 3, 5]
    owns:
      - "_shared/a1-tools.cjs"
      - "_shared/lib/gate-log.cjs"
      - "_shared/lib/project-slug.cjs"
      - "_shared/lib/pr-merge-check.cjs"
      - "_shared/lib/retro-gatelog.cjs"
      - "_shared/lib/run-record.cjs"
      - "_shared/lib/help-run.cjs"
      - "_shared/lib/help.cjs"
      - "_shared/lib/metrics.cjs"
      - "_shared/lib/metrics-phase-time.cjs"
      - "_shared/lib/help-metrics.cjs"
      - "_test-fixtures/a1-metrics/**"
      - "_test-fixtures/a1-gates-lint/run-tests.sh"
      - "_test-fixtures/a1-pr-merge-check/run-tests.sh"
      - "_test-fixtures/a1-pr-review/run-tests.sh"
      - "skills/a1-pr-review/workflows/05-merge.md"
      - "docs/adr/2026-10-14-gate-invoke-and-log.md"
    agent: a1-erik-executor
  - id: verify
    waves: [2]
    owns:
      - "_shared/lib/verify-run.cjs"
      - "_test-fixtures/a1-verify/**"
    agent: a1-erik-executor
  - id: gates
    waves: [4, 6]
    owns:
      - "_shared/gates-registry.md"
      - "_shared/quality-invariants.json"
      - "_shared/lib/quality-invariants.cjs"
      - "_shared/lib/gates-cli.cjs"
      - "_shared/lib/help-gates.cjs"
      - "skills/a1-pr-review/workflows/02-review.md"
      - "skills/a1-pr-review/SKILL.md"
      - "_test-fixtures/a1-gates-lint/run-wave14.sh"
      - "_test-fixtures/suite-groups.json"
    agent: a1-erik-executor
sequential_after_lanes: [7, 8]
status: revised
created: 2026-11-12
phase_kind: code
---

## Depth Pass

### 1 What a top professional would do
A senior build/infra engineer would treat the gate-log record as a security-relevant, append-only evidence format, not as a place to add fields freely. They would put a key whitelist and format validation on the in-process setter, and the chain verifier would check the new fields whenever a record carries them. They would measure durations at the one honest spot, the `spawnSync` of a command. A cache hit would read `null`, never `0`. They would prove backward compatibility on a byte copy of a real old log, not on synthetic lines. The keep-list lint would be root-relative, with one planted RED per id, so it cannot pass in a vacuum. Before writing any assert, they would look for every existing fixture that pins today's shape: the exact key list in `a1-gates-lint` F1, "5 fenced bash blocks" in `a1-pr-review`, "6 metrics modules" in `a1-metrics` AU4a, and the stderr bound in `a1-xprov` SC9 (measured: stays under its bound, so it is not touched). Each pinned fixture that must change is changed on purpose and named in the plan. The baseline would be a real measurement on a quiet host, with the host load recorded next to every number, because a baseline taken on a busy shared host makes the later SC-003 comparison meaningless.

### 2 Rawest material
- Actual source on `main` @ `2ac1a49`. I read `gate-log.cjs` (`appendGateLine` 193, `shapeProblem` 223, `installGateLog` 343, the "not inside a git work tree" notice at 320), `verify-run.cjs` (`runCommand` 257, `runBaseSide` 328, `runHeadSide` 340, `runVerify` 472, report `base_sha` at 503), `verify-base.cjs` (`resolveMergeBase` 40), `pr-merge-check.cjs` (`SLUG_RE` 35, `resolveBaseRef` 120, `projectSlug` 129, `cmdPrMergeCheck` 255), `xprov-scope.cjs` (`cmdXprovScope` flags: paths/base/head/repo only), `gates-lint.cjs`, `gates-cli.cjs`, `retro-gatelog.cjs`, `metrics.cjs`, `io-roots.cjs` (`peekVaultRoot`, `repoRoot`) and `fs-safe.cjs`.
- The real old-format gate log `.a1/phases/_unscoped/gate-log.jsonl` (records without `duration_ms`). It becomes the compatibility fixture.
- The real fixtures that pin today's shape. `a1-gates-lint/run-tests.sh:278` asserts the exact key list. `a1-pr-review/run-tests.sh:261-263` asserts 5 bash blocks in order DCMGP. `a1-metrics/parts/04-audit.sh:44-50` asserts the module count 6 and that no metrics module requires `child_process`. `a1-xprov/parts/27-scope.sh:297` bounds SC9 stderr at `< 600` chars; measured today on a `git archive` copy with the `pr-security-surface` row inserted: the 10 SC9 `--base` cases print 163-243 chars (without the row: 81-161), so the bound holds with margin and the suite needs no edit. `check-callsite-flags.cjs` checks call-site flags against `--help`.
- The real quiet-host probe of `skills/a1-pr-review/workflows/05-merge.md` 5.3, run today: the anchored pattern did not list its own shell, listed a real `pr merge-check --pr 16` of another session on this host (load5 2.69 on 24 CPUs), and listed a planted `node … a1-tools.cjs verify run` process (red run).
- `.a1/xprov.json`: `external_review: denied` (owner, 2026-11-11). No Codex review runs in this repo.
- `.a1/verify.json`: `each: _test-fixtures/*/run*.sh` (60 files today) plus 1 explicit command, so 61 commands today and 62 after `run-wave14.sh` exists.
- Measured red probes, run on `main` today and recorded under Verification (R1-R10).
- `_test-fixtures/suite-groups.json` timings: 60 suites, 1257 s total. That gives about 21 min for a serial head-only `verify run` and about 42 min for a serial base+head run. This is the "long path" the baseline measures.

### 3 Methods and tools
- Monotonic timing with `process.hrtime.bigint()`, integer ms, `started_at` from `new Date().toISOString()`.
- An allowlist plus format regexes for the setter: `input_hash` `^[0-9a-f]{64}$`, `reused` boolean, `ci_evidence_why` `^[a-z][a-z0-9_]{0,63}$`. Module state is replaced with a frozen object and never mutated, and it resets after each write.
- Writes are append-only, and the chain is checked with the existing `verifyChain`. Store writes go through a containment check (`assertAncestorInside`), lstat refuses symlinks, and the write is tmp+rename (`writeViaTmp`).
- Root-relative, line-based reading of `test.yml` with plain string comparison of the trimmed `name:` value, no YAML dependency and no regex built from a step name.
- Planted-tree fixtures (`--root <copy> --registry <copy>`) with one mutation per case and an in-suite RED proof. `node -e` handles JSON asserts, and `mk_workdir` provides isolation. Every new store-touching part sets `A1_VAULT_ROOT` explicitly.
- The anchored `pgrep` plus `os.loadavg()[1]` quiet-host check of 05-merge.md 5.3, looped for up to 15 minutes, with every check written as one JSON line.
- `lane-split check`, `bin/run-suites.sh --check-groups`, `gates lint`, `workflow lint`, the call-site flag sweep, a `git diff --numstat` check of deleted assert lines, and `wc -l` caps.

### 4 External evidence of correctness
- The fixture suites: the new parts `a1-metrics/parts/05-07`, `a1-verify/cases-durations.sh` and `a1-gates-lint/run-wave14.sh`, plus the existing `a1-gates-lint`, `a1-pr-merge-check`, `a1-verify`, `a1-pr-review`, `a1-xprov` (both shards, unchanged), `a1-probe`, `a1-kritis-profile`, `a1-dashboard`, `a1-retro-validate`, `a1-depth-pass`, `a1-lib-units`, `a1-cli-output` and `a1-exit2-audit`. All run through `bash bin/run-suites.sh` and GitHub Actions CI on GNU/Linux.
- `gates lint` on the real tree (CI step "Gate wiring lint").
- `git diff --numstat` against `origin/main`: zero deleted lines in `_test-fixtures/a1-pr-merge-check` and `_test-fixtures/a1-verify`, and no change at all under `_test-fixtures/a1-xprov`.
- The recorded `BASELINE.json`: real wall-clock measurements on the execution host, with `load5`, CPU count and a `host_busy` flag per run.
- Independent reviewers before merge: `a1-samuel-security` (merge dependency) and `a1-reinhard-reviewer`.

### Rewritten brief
Plan one PR that adds measured durations to the gate-log record (FR-001) and to `verify run` (FR-002). It adds `metrics phase-time` with live and store sources, `ci_evidence_why` counts and `--baseline` with recorded host load (FR-003..FR-005), and `run record` into the learning store, called from 05-merge.md before the worktree exit (FR-035). It registers `pr-security-surface` with its call running inside the worktree under `--phase pr-<n>` (FR-033), and adds a root-relative quality-invariant lint over 12 keep-list ids and 2 CI steps (FR-034).

Hard constraints:
- No existing assert is deleted. Exactly three fixtures that pin today's shape are changed on purpose and named (F1 key list, a1-pr-review block count/order, AU4a module count). `_test-fixtures/a1-xprov` is not changed at all.
- The setter accepts only whitelisted, format-checked fields and never overrides a core field.
- A cache hit reports `null`, never `0`.
- No metrics module requires `child_process`.
- `a1-tools.cjs` gets one dispatch line only and stays at or below 800 lines.
- The exit contract of `xprov scope` and every merge-check protection stay unchanged.
- The baseline is recorded from real `verify run` reports on a host that passed the quiet-host check, the load values are in the file, and it is committed from the feature branch, never from `main`.
- Execution happens in an a1-worktree, never in the primary checkout.
- No Codex review: the repo denied external review. Samuel and Reinhard review the PR before merge.

Split the work into three lanes with disjoint write sets (measure, verify, gates). Run the integration gate and the baseline recording after the lanes.

# Plan: 027-lean-pipeline-s1

## Goal
Ship delivery slice 1 "Measure + protect" of spec 027-lean-pipeline as one PR. Every gate-log record and every verify-run command carries a measured duration. `metrics phase-time` and `run record` sum the durations and keep them after the worktree is gone, and a baseline is recorded with its host load. The Samuel trigger becomes the registered gate `pr-security-surface`, and a quality-invariant lint fails when any keep-list gate loses its invocation.

## Execution location (read first)
- All work runs in the a1-worktree `/home/rob/claude-projects/a1-worktrees/027-lean-pipeline-s1/` on its own feature branch (created by a1-execute through `a1-specforge:a1-worktree`, never by a raw `git worktree add`). Lanes get their own worktrees from a1-execute; everything below applies to each of them.
- The primary checkout `/home/rob/claude-projects/a1-specforge` is on `main` with uncommitted spec-027 edits under `docs/product/`. Nothing in this plan writes there. The one exception is a **read**: Task 1.1 action 7 copies 3 lines of the gitignored real log, which exists only in the primary checkout.
- Every command and every Done-when probe runs with cwd = the worktree root and uses repo-relative paths. Where an absolute repo path is needed, use `"$(git rev-parse --show-toplevel)"`.
- `origin/main` below means the remote main after `git fetch origin main`. Run that fetch once at the start of Wave 7.
- Commits: never put the `checks` CI step name of Task 6.1 (it contains owner-only command words) into a commit message, a PR text or a `node -e`/`echo` string on a Bash command line; a PreToolUse hook denies such a command line (measured by the audit). Commit messages describe it as "the allowlist guard step".

## RED-proof rule (applies to every task)
Each task that lists "RED-proof" mutations must also apply each mutation once on a scratch copy of the worktree after the task's own commit: `S=$(mktemp -d); git archive HEAD | tar -x -C "$S"; git -C "$S" init -q && git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm snap` (so suites that need `.git` do not go red for the wrong reason; this host has no global git identity, so a bare `git commit` stops with "Author identity unknown"), apply the one mutation with Edit, run the named suite there and see the named case go red. Log one line per mutation in `STATUS-<lane>.md`: `RED-proof <task> <mutation> -> <case> red (rc=<n>)`. A mutation that does not turn its case red is a defect of the fixture: fix the fixture, never drop the line.

**Fixture-repo rule.** Every new fixture that builds its own git repo (GF1, VD2, RR9, PT3, W14c, W14l) holds its temp dir in a variable (`T=$(mktemp -d)`, removed on exit) and commits with a per-repo identity, the way the existing suites do (`a1-verify` `g()`): `git -C "$T" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm <msg>`. No fixture relies on a global git identity.

## Lane decision
Three lanes, with write sets taken from the task actions below (`lane-split check` exit 0 is required):
- **measure**: waves 1, 3, 5, with 8 tasks. It covers the gate-log record, the shared helpers, merge-check, `run record`, `metrics phase-time`, 05-merge.md and the ADR.
- **verify**: wave 2, with 1 task. It covers `verify-run.cjs` durations.
- **gates**: waves 4 and 6, with 2 tasks. They cover the registry row, 02-review.md and the invariant lint. `_test-fixtures/a1-xprov/**` is no longer in its write set (M3: measured, no edit needed).

Lanes only read each other's files. For example, the invariant lint reads 05-merge.md, and the measure fixtures read the registry. No path is written by two lanes. Waves 7 (carry-over and integration gate) and 8 (baseline recording) run after the lanes because they need the final tree, and they are the only waves that write `docs/product/**`, the phase folder and `.a1/phases/027-lean-pipeline/BASELINE.json`.

Realistic yield: verify and gates run beside the measure chain. Waves 7 and 8 stay serial, and wave 8 is about 65 min of measurement wall-clock plus up to 15 min quiet-host wait per run.

## Decisions (made in this plan, each tested)
- **D1 Setter allowlist.** `setRecordExtra` accepts only these keys:
  - `input_hash` (`^[0-9a-f]{64}$`)
  - `reused` (boolean)
  - `ci_evidence_why` (`^[a-z][a-z0-9_]{0,63}$`)

  Core keys (`ts, gate, verdict, exit, head_sha, scope, prev, started_at, duration_ms`) and unknown keys are rejected with one stderr note each. The setter is a no-op when the hook did not install, including in an intent child. The hook takes the pending extras in its exit handler and resets them to `null`, so they never leak into a second record. `ci_evidence_why` is added beyond the spec's `{input_hash, reused}` because FR-004 needs the same hand-off.
- **D2 Record layout.** Key order: `ts, gate, verdict, exit, head_sha, scope, started_at, duration_ms, input_hash?, reused?, ci_evidence_why?, prev`. Optional keys appear only when set. `shapeProblem` validates each new key only when it is present, so old lines stay valid with no migration.
- **D3 Verify durations.** The layout is:
  - `commands[i].duration_ms` is the first head run.
  - `commands[i].retry_duration_ms` is the retry run, or `null`.
  - `commands[i].base_duration_ms` is the base run, or `null` without `--base`.
  - The top-level `duration_ms` is `{head, base, total}`. `head` and `base` are the wall-clock of each side, including the snapshot. `base` is `null` without a base side. `total` is the wall-clock of the whole `runVerify`.

  Any value that comes from the cache is `null`.
- **D4 Project slug.** The new `_shared/lib/project-slug.cjs` owns `SLUG_RE`, `projectSlug(opts)` (moved, behaviour identical) and `repoProjectSlug(repo)`. `repoProjectSlug` returns the ROADMAP.md frontmatter `project`, or else the directory name of the **main checkout**, resolved with pure fs through `.git` → `gitdir:` → `commondir`. Without that resolution, `run record` from a worktree would file the record under the worktree folder name. The file name used for the store is validated against `^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$`. If it fails, the command exits 2.
- **D5 Store.** "No learning store" means one of two things:
  - `peekVaultRoot()` is `null`.
  - `<root>/pattern/a1-learnings` is not an existing directory. Repo-local tier 2 counts only when that directory already exists; nothing is created.

  `run record` writes only `<root>/pattern/a1-learnings/_runs/<project>.jsonl` (owner: `run-record.cjs`; `feature close` in slice 4 calls `run record` and never writes the file itself). It is idempotent per `(scope, pr)`, where a missing `pr` counts as `null`. Symlinked `_runs` directories and files are refused.
- **D6 phase-time dedup.** When the store holds a row for scope S, the live rows of S are printed with `also_in_store: true` and left out of the totals.
- **D7 Baseline input.** The `--baseline` file path is a constant: `<repo>/.a1/phases/027-lean-pipeline/BASELINE.json`. It belongs to the feature, not to this phase folder `027-lean-pipeline-s1`. Its inputs are two existing `verify run` JSON reports, one host-context file and one host label:
  - `--verify-report`: head-only, `duration_ms.base === null`.
  - `--merge-report`: `verify run --base <merge-base sha> --no-cache`. This is the same `runVerify({base, noCache:true})` that `pr merge-check` runs on its non-CI-evidence path, with the base given as the explicit merge-base sha that `resolveMergeBase` would compute for `origin/main`. It is labelled `path: "serial"`, because the slice-3 long path does not exist yet.
  - `--host-context`: the quiet-host measurements of Wave 8 (schema in Task 3.3 action 7).
  - `--host-label`: a label, never `os.hostname()` (the file is committed to an open-source repo).

  The command never starts those runs itself. A second write without `--force` exits 1 and leaves the file byte-identical. The file is committed. `.a1/phases/<x>/BASELINE.json` is not git-ignored (measured: `git check-ignore` exit 1; only `.a1/phases/*/gate-log.jsonl` is ignored).
- **D8 `pr-security-surface` log location.** `xprov scope` rejects `--project` (measured), and changing `projectDirOf` would change every gate. So the 02-review.md call runs inside the worktree with `SURF="$(cd "<worktree_path>" && node … xprov scope --repo "<worktree_path>" … --phase pr-<n>)"`. The hook then resolves cwd to the worktree. This needs no production code change in `xprov-scope.cjs` or `gate-log.cjs`. The exit contract stays the same: exit 0 on any classification, 2 on usage or IO. In a non-git cwd the hook adds one stderr line ("gate-log: not inside a git work tree, pr-security-surface (exit N) was not logged"); measured, this keeps `a1-xprov` SC9 under its bound (max 243 < 600).
- **D9 Invariant lint activation.** The lint reads `<root>/_shared/quality-invariants.json` and `<root>/.github/workflows/test.yml`, always relative to the resolved root and never to `__dirname`.
  - File present: the rules apply.
  - File absent under the default root (no `--root`, which is the CI and real-tree call): finding `invariant_file_missing`, exit 1.
  - File absent under an explicit `--root`: output `invariants: {status: "absent"}` with no finding. This keeps the ~30 existing planted-registry cases unchanged.

  The JSON is the only production copy of the keep-list. The fixture pins the 12 spec ids as a test oracle; there is no second production list.
- **D10 run record exit codes.** 0 means recorded or already recorded. 1 means a precondition is not met (`no_learning_store`, `no_gate_log`, `gate_log_untrusted`, `empty_gate_log`), and nothing changes. 2 means a usage error, a hostile value, an IO error or a refused write path. In 05-merge.md, exit 1 is a WARN and the close-out continues; exit 2 is STOP before the worktree exit. The second call (caller phase) is skipped in the block itself when no phase name was handed over.
- **D11 No Codex.** `.a1/xprov.json` is `external_review: denied` (owner, 2026-11-11). Neither `plan-review-xprov` nor `design-review-xprov` runs for this phase. No task asks for, records or waives a permit.

## Field owners (Step 3 #10)
| Field / list | Only writer | Readers |
|---|---|---|
| gate-log record (all fields) | `gate-log.cjs` facade hook (`appendGateLine`) | retro-gatelog, gates lint `--log`, phase-time, run record |
| `ci_evidence_why` value | `pr-merge-check.cjs` (from `CE.decide`, in-process hand-off, no CLI flag) | gate-log hook |
| `input_hash` / `reused` | none in this slice (accepted only; FR-020, slice 4) | — |
| `_runs/<project>.jsonl` | `run-record.cjs` | phase-time (store source) |
| keep-list ids + CI steps | `_shared/quality-invariants.json` | `quality-invariants.cjs` |
| project slug rule | `project-slug.cjs` | pr-merge-check, run-record, phase-time |
| `BASELINE.json` | `metrics-phase-time.cjs --baseline` | slices 2-3 (SC-003) |
| host-context values | Wave 8 quiet-host script (`$R/quiet.sh`, scratch, not committed) | `metrics-phase-time.cjs --baseline` |
| forbidden-surface list | `quick.cjs#FORBIDDEN_SURFACE_GLOBS` (unchanged, referenced by `xprov-scope-globs.json`) | quick eligibility, `xprov scope` |

Source: the spec named above (2026-11-12, status clarified), RESEARCH.md/MAP.md of this phase (generated 2026-11-12) and AUDIT.md of this phase (2026-11-12).

## Success Criteria
- [ ] SC-1 (FR-001): Every gate-log line appended through the facade hook carries `started_at` (ISO UTC, ends in `Z`) and `duration_ms` (non-negative integer). A byte copy of a real old-format log, with a new record appended, passes `gates lint --log` with 0 problems. `setRecordExtra` behaves per D1. Fixture: `a1-metrics/parts/05-gate-log-fields.sh`.
- [ ] SC-2 (FR-002): The `verify run` JSON carries the D3 fields. Live durations are non-negative integers. `duration_ms.total >= max(head, base)`. Cache hits are `null`. A 300 ms command reports at least 250. Fixture: `a1-verify/cases-durations.sh`.
- [ ] SC-3 (FR-003): `metrics phase-time --json` sums `duration_ms` per scope and gate from `live` and `store`, names the source per row, derives the project per D4 and counts `no_duration`, never as 0. Fixture: `a1-metrics/parts/06-phase-time.sh`.
- [ ] SC-4 (FR-004): The `pr-merge-check` gate-log record carries `ci_evidence_why` equal to the report's `ci_evidence.why`. `metrics phase-time` prints the count per value plus `unknown` for records without it. Fixture: `a1-pr-merge-check` appended cases plus part 06.
- [ ] SC-5 (FR-005): `--baseline` writes the D7 file with the schema in Task 3.3, including `base_sha`, `host_label`, `cpus` and a `host_load` object per run. A second call without `--force` exits 1 and leaves the file byte-identical. The real `BASELINE.json` is recorded after the quiet-host check, carries the measured load values and is committed on the feature branch (Wave 8).
- [ ] SC-6 (FR-033): The `pr-security-surface` row is registered (deterministic, blocking, `` `xprov scope` @ a1-pr-review ``) and wired in 02-review.md with `--phase pr-<n>` inside the worktree. `gates lint` exits 0 on the real tree and exits 1 naming `pr-security-surface` on a planted copy without the call. The log line lands in the worktree under `pr-<n>`. Fixture: `a1-gates-lint/run-wave14.sh`.
- [ ] SC-7 (FR-034): `_shared/quality-invariants.json` lists the 12 keep-list ids and the 2 CI steps. `gates lint` exits 1 naming the id for each removal (row removed: 12 asserts; invocation or owner anchor removed: 12 asserts), for a set `unwired_until`, for a changed class and for each missing CI step. The real tree is green. Fixture: run-wave14.sh.
- [ ] SC-8 (FR-035): `run record` appends exactly one line with scope, pr, head_sha and, per gate, `{id, verdict, caught, runs, duration_ms_sum, no_duration}`, plus `ci_evidence_why` counts for `pr-merge-check`. A second call adds nothing. With no store it exits 1 and changes nothing. 05-merge.md calls it after the merge and before the worktree exit; the caller-phase call is skipped when no phase name was handed over. Fixture: `a1-metrics/parts/07-run-record.sh` and the updated `a1-pr-review` block order.
- [ ] SC-9 (protect): `bash bin/run-suites.sh` is green, except `a1-intent` and `a1-vault-cockpit` when they are equally red on `main` in a clean a1-worktree on aiserver (known environment reds). `git diff --numstat origin/main...HEAD -- _test-fixtures/a1-pr-merge-check _test-fixtures/a1-verify` shows 0 deleted lines, and `git diff --name-only origin/main...HEAD -- _test-fixtures/a1-xprov` is empty. Every touched or new `_shared/lib/*.cjs` is at most 800 lines, and `_shared/a1-tools.cjs` is at most 800 lines. `gates lint`, `workflow lint` and `--check-groups` exit 0.
- [ ] SC-10 (review, merge dependency): `a1-samuel-security` and `a1-reinhard-reviewer` report no open BLOCKER or MAJOR on the final diff.
- Spec SC-001 and SC-007 are measured after merge (see Verification, post-merge checks). This PR makes SC-001 fully measurable and makes SC-007 measurable for the 6 deterministic keep-list ids only (gate-log rows); the 4 non-xprov prompt ids need retro evidence until FR-019 (slice 4), and the 2 xprov ids are not applicable in this repo.

---

## Wave 1 — Record fields and shared helpers (lane measure)

### Task 1.1: Gate-log `started_at`, `duration_ms` and `setRecordExtra`
**Goal:** Every record appended by the facade hook carries `started_at` and `duration_ms`, and running code can hand whitelisted extras to the hook (D1, D2).
**Actions:**
1. In `_shared/lib/gate-log.cjs` add:
   - Constants: `WHY_RE = /^[a-z][a-z0-9_]{0,63}$/`, a frozen `EXTRA_RULES = { input_hash: v => typeof v === 'string' && HEX64_RE.test(v), reused: v => typeof v === 'boolean', ci_evidence_why: v => typeof v === 'string' && WHY_RE.test(v) }`, and a frozen `CORE_KEYS = ['ts','gate','verdict','exit','head_sha','scope','prev','started_at','duration_ms']`.
   - Module state: `let hookInstalled = false; let pendingExtra = null;`. Only whole-value reassignment is allowed, never mutation.
   - `sanitizeExtra(fields)`. It returns `{accepted: Object.freeze({...}), rejected: [{key, reason}]}` with reasons `core_field`, `unknown_key` and `bad_value`, plus `not_an_object` for non-plain-object input. Accepted keys appear in `EXTRA_RULES` order.
   - `setRecordExtra(fields)`. It writes one stderr line per rejected key: `gate-log: setRecordExtra ignored <key> (<reason>)`, with the key reduced to `[A-Za-z0-9_.-]` and capped at 40 characters. When `!hookInstalled` it returns `{active:false, accepted:[], rejected}` and stores nothing. Otherwise it sets `pendingExtra = Object.freeze({...(pendingExtra||{}), ...accepted})` and returns `{active:true, accepted:[keys], rejected}`. Add a JSDoc `@returns {{active: boolean, accepted: string[], rejected: {key: string, reason: string}[]}}`.
2. In `installGateLog`, inside the branch that registers the exit handler (after the `inChildMode()` return):
   - Take `const startedAt = new Date().toISOString(); const t0 = process.hrtime.bigint(); hookInstalled = true;`.
   - In the handler, compute `const durationMs = Number((process.hrtime.bigint() - t0) / 1000000n); const extra = pendingExtra; pendingExtra = null;`.
   - Call `recordRun(gateId, scope, code, dir, { startedAt, durationMs, extra })`.
   - Add no eager `require`s.
3. `recordRun(gateId, scope, exitCode, dir, timing)` passes `startedAt`, `durationMs` and `extra` to `appendGateLine`. In `appendGateLine`, build the record in D2 order:
   - Add `started_at` only when it is a string that `Date.parse` accepts and that ends in `Z`.
   - Add `duration_ms` only when `Number.isInteger(v) && v >= 0`.
   - Add extras from `sanitizeExtra(rec.extra).accepted` (defence in depth).
   - Keep `prev` last.
   - Do not change the `prev` computation or the lock.
4. `shapeProblem`: when present, `started_at` must be a parseable string, `duration_ms` a non-negative integer, `input_hash` hex64, `reused` boolean and `ci_evidence_why` must match `WHY_RE`. Absent keys are never a problem.
5. Export `setRecordExtra` (keep every existing export).
6. In `_test-fixtures/a1-gates-lint/run-tests.sh` line 278 (F1), change only the expected key list from `ts,gate,verdict,exit,head_sha,scope,prev` to `ts,gate,verdict,exit,head_sha,scope,started_at,duration_ms,prev`. Add a comment line `# spec 027 FR-001: started_at, duration_ms added to the record`. No other line of that file changes.
7. Create `_test-fixtures/a1-metrics/fixtures/gatelog/old-format.jsonl` as a byte copy of the first 3 lines of the real gate log. This is the one deliberate absolute path in the plan: the log is gitignored and exists only in the primary checkout, so read it from there (read only): `head -n 3 /home/rob/claude-projects/a1-specforge/.a1/phases/_unscoped/gate-log.jsonl > _test-fixtures/a1-metrics/fixtures/gatelog/old-format.jsonl` (cwd = worktree root). Line 1 has `prev` = 64 zeros. Check it with `node _shared/a1-tools.cjs gates lint --log _test-fixtures/a1-metrics/fixtures/gatelog/old-format.jsonl` (exit 0).
8. Create `_test-fixtures/a1-metrics/parts/05-gate-log-fields.sh`, sourced by the existing harness in NN order. Make temp repos with `mk_workdir` and pass `A1_VAULT_ROOT` explicitly per call. Cases:
   - GF1: run the real facade `realpath-check run --phase w1 --diff-base HEAD~1 --project .` in a temp repo. The line has `started_at` (ISO, `Z`, `<= ts`) and an integer `duration_ms >= 0`. `gates lint --log` exits 0. Repo setup per the fixture-repo rule (temp dir in a variable, per-repo identity on every commit).
   - GF2: copy `old-format.jsonl` to `<repo>/.a1/phases/w1/gate-log.jsonl`, then run the GF1 call. `gates lint --log` reports exit 0, 4 lines and 0 problems. The first 3 lines are byte-identical to the fixture.
   - GF3: in-process `node -e` with cwd = temp repo. Build `registryText` from the real `_shared/gates-registry.md` header row, its separator and the real `pr-merge-check` row, read at runtime. Call `installGateLog(['pr','merge-check','--phase','w2'], registryText)`, then `setRecordExtra({input_hash: <64 hex>, reused: true, ci_evidence_why: 'ok'})`, then exit 0. The record carries all three with the exact values.
   - GF4: same setup, `setRecordExtra({verdict:'pass', gate:'x', prev:'0'.repeat(64), foo:1, input_hash:'XYZ', reused:'yes', ci_evidence_why:'Bad Value!'})`, then `process.exitCode=1`. The record has `verdict` `fail`, exit 1, `gate` `pr-merge-check` and none of `foo`, `input_hash`, `reused`, `ci_evidence_why`. stderr has 7 `setRecordExtra ignored` lines. Also a 10000-character key: one stderr line of at most 120 characters.
   - GF5: `setRecordExtra({...valid})` without `installGateLog` returns `active:false`, and no `.a1` directory exists in the cwd repo afterwards.
   - GF6 (reset): in one process, `installGateLog` twice (two handlers), then `setRecordExtra({input_hash:…})` once. Line 1 carries `input_hash` and line 2 does not.
   - GF7: install, wait 300 ms with `setTimeout`, then exit. `duration_ms >= 250`.
   - GF8: a planted log line with `"duration_ms":-5` (chained correctly with `prev`) makes `gates lint --log` exit 1 with `malformed_line`.
9. Put RED-proof comment lines at the top of the part, and apply each once per the RED-proof rule:
   - `duration_ms` required in `shapeProblem` → GF2 red.
   - `pendingExtra = null` reset removed → GF6 red.
   - Allowlist check bypassed → GF4 red.
   - Constant `0` instead of hrtime → GF7 red.
**Done when:** `bash _test-fixtures/a1-metrics/run-tests.sh` and `bash _test-fixtures/a1-gates-lint/run-tests.sh` exit 0, `bash _test-fixtures/a1-retro-validate/run-tests.sh` exits 0, `wc -l _shared/lib/gate-log.cjs` is at most 800, and `STATUS-measure.md` has the 4 RED-proof lines of this task.
**Covers:** SC-1, SC-9

### Task 1.2: Shared project-slug helper
**Goal:** One module owns the project-slug rule (D4). `pr-merge-check` behaviour is unchanged.
**Actions:**
1. Create `_shared/lib/project-slug.cjs`. It requires only `fs`, `path` and `parseNestedFrontmatter` from `./io.cjs`, and never `child_process`. Exports:
   - `SLUG_RE` (moved verbatim from `pr-merge-check.cjs:35`).
   - `roadmapProject(dir)`: reads `docs/product/ROADMAP.md` frontmatter `project`, valid only when it matches `SLUG_RE`, else `null`. Read errors give `null`.
   - `projectSlug(opts)`: `opts.slug || roadmapProject(opts.project) || path.basename(opts.project)`, which is identical to today's behaviour.
   - `mainCheckoutDir(repo)`: lstat `<repo>/.git`. If it is a directory, return `repo`. If it is a file, parse `gitdir: <p>` (resolve relative to `repo`), read `<gitdir>/commondir` if present (resolve relative to gitdir) and, when the basename of the common dir is `.git`, return its parent. Otherwise, or on any error, return `repo`.
   - `repoProjectSlug(repo)`: `roadmapProject(repo) || path.basename(mainCheckoutDir(repo))`.
   - JSDoc `@returns` on each function.
2. In `_shared/lib/pr-merge-check.cjs`, delete the local `SLUG_RE` and `projectSlug` and `require('./project-slug.cjs')` for both. Remove `parseNestedFrontmatter` from the `io.cjs` import only if `grep -n parseNestedFrontmatter _shared/lib/pr-merge-check.cjs` shows no other use. Change no other logic.
3. Verify the behaviour is identical: `bash _test-fixtures/a1-pr-merge-check/run-tests.sh` exits 0 with no edit to that file in this task.
**Done when:** (cwd = worktree root) the a1-pr-merge-check suite exits 0, `grep -c "function projectSlug" _shared/lib/pr-merge-check.cjs` = 0, `node -e "const p=require('./_shared/lib/project-slug.cjs'); console.log(p.repoProjectSlug(process.cwd()))"` prints `a1-specforge`, and `node -e "const p=require('./_shared/lib/project-slug.cjs'); console.log(require('path').basename(p.mainCheckoutDir(process.cwd())))"` prints `a1-specforge` (the worktree folder is `027-lean-pipeline-s1`, so this line is red when the `commondir` resolution is missing).
**Covers:** SC-3, SC-8, SC-9

### Task 1.3: Export the `caught` rule from retro-gatelog
**Goal:** `run record` reuses the existing `firedYaml` rule instead of reimplementing it.
**Actions:**
1. In `_shared/lib/retro-gatelog.cjs`, add `gatesFired(records)` that returns `[...last.entries()].map(([id, verdict]) => ({ id, verdict, caught: failed.has(id) }))` from `lastVerdicts(records)`, with a JSDoc `@returns {{id: string, verdict: string, caught: boolean}[]}`.
2. Rewrite `firedYaml` to build its items from `gatesFired`. The output must stay byte-identical.
3. Add `lastVerdicts` and `gatesFired` to `module.exports` (keep the existing five).
**Done when:** (cwd = worktree root) `bash _test-fixtures/a1-retro-validate/run-tests.sh` exits 0 with no fixture edit, and `node -e "const r=require('./_shared/lib/retro-gatelog.cjs'); console.log(typeof r.gatesFired, typeof r.lastVerdicts)"` prints `function function`.
**Covers:** SC-8

---

## Wave 2 — Verify-run durations (lane verify)

### Task 2.1: Durations in `verify run`
**Goal:** The `verify run` JSON carries the D3 duration fields, measured at the spawn.
**Actions:**
1. In `_shared/lib/verify-run.cjs` `runCommand`, take `const t0 = process.hrtime.bigint()` right before `spawnGroup(...)` and `Math.round(Number(process.hrtime.bigint() - t0) / 1e6)` right after it. Add `duration_ms` to the returned raw object. Do this only in `runCommand`; there is no second timing site.
2. `runHeadSide`:
   - A cached first run uses `{ ...entry.raw, duration_ms: null }`, and a cached retry uses `{ ...entry.retry, duration_ms: null }`.
   - After `vb.settle(...)`, return `{ ...settled, duration_ms: <first-run raw duration_ms or null>, retry_duration_ms: <results[c.id].retry ? its duration_ms : null> }`. This way a retry never overwrites the first-run duration.
3. `runBaseSide` also returns `durations: new Map(plan.commands.map(c => [c.id, cached || results[c.id].raw.absent ? null : results[c.id].raw.duration_ms ?? null]))`.
4. `runVerify`:
   - Take `tTotal` at entry.
   - Time the base side (`runBaseSide` call) and the head side (the `withSnapshot`/`runHead` call) separately.
   - Add `base_duration_ms` to every element of `commands` (`base ? base.durations.get(c.id) ?? null : null`). Build new objects, no mutation.
   - Add the top-level `duration_ms: { head, base: base ? ms : null, total }`, where `total` is measured just before the `return`.
   - Leave `noCache`, snapshots, `settle`, `applySkipIncrease` and reasons untouched. Check that `applySkipIncrease` (in verify-base.cjs) spreads each command so the new fields survive. If it does not, re-add the fields after it in `runVerify`; do not edit verify-base.cjs.
5. Create `_test-fixtures/a1-verify/cases-durations.sh`. The name must not match `run*.sh`, because `.a1/verify.json` uses `each: _test-fixtures/*/run*.sh`. It reuses the suite helpers (`newproj`, `stub`, `cfg`, `seal`, `vrun`, `check`). Add one line `. "$(dirname "${BASH_SOURCE[0]}")/cases-durations.sh"` to `_test-fixtures/a1-verify/run-tests.sh` directly before the final `echo "a1-verify: …"` line. That is the only change to run-tests.sh: zero deleted lines. Cases:
   - VD1: two stub commands with `--no-cache`. Both `commands[i].duration_ms` are integers `>= 0`, `base_duration_ms === null`, `duration_ms.base === null` and `duration_ms.total >= duration_ms.head`.
   - VD2: the same project committed on `main` plus `feat`, with `--base main`. `base_duration_ms` are integers `>= 0`, `duration_ms.base` is an integer and `total >= Math.max(head, base)`. Repo setup per the fixture-repo rule (temp dir in a variable, per-repo identity on every commit).
   - VD3: two runs on a clean tree without `--no-cache`. The second has `cache.head === 'hit'` and every `commands[i].duration_ms === null` (never 0).
   - VD4: a flaky stub (fails the first call, passes the second, via a marker file). `retry_duration_ms` is an integer `>= 0`, and `duration_ms` is an integer `>= 0`.
   - VD5: a stub that waits 300 ms with `node -e 'setTimeout(()=>{},300)'` (no fractional `sleep`). `duration_ms >= 250`.
   - VD6: `verify run --out <VERIFICATION.md>` followed by `verify check` on that file still exits 0, so the new keys do not break the check.
   - RED-proof comment (applied once per the RED-proof rule): a constant `0` in `runCommand` → VD5 red; a cache hit not nulled → VD3 red.
**Done when:** `bash _test-fixtures/a1-verify/run-tests.sh` exits 0, `git diff --numstat "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-verify/run-tests.sh` shows 0 deleted lines, `wc -l _shared/lib/verify-run.cjs` is at most 800, and `STATUS-verify.md` has the 2 RED-proof lines.
**Covers:** SC-2, SC-9

---

## Wave 3 — Merge-check field, run record, phase-time (lane measure)
**Depends on:** Wave 1

### Task 3.1: `ci_evidence_why` into the merge-check record
**Goal:** Every `pr merge-check` gate-log record that reaches a report carries `ci_evidence_why` (FR-004).
**Actions:**
1. In `_shared/lib/pr-merge-check.cjs` `cmdPrMergeCheck`, after the `try/catch` and before `emitExit`, add `require('./gate-log.cjs').setRecordExtra({ ci_evidence_why: result.report.ci_evidence.why });`. On the thrown path (exit 2) nothing is set.
2. Append cases to `_test-fixtures/a1-pr-merge-check/run-tests.sh` directly before the final `echo` line. Add only, delete nothing. Use the existing invocation form with `--phase fx-w10` and cwd `$P`, and read the last line of `$P/.a1/phases/fx-w10/gate-log.jsonl`. Cases:
   - CEW1: `--no-ci-evidence`. The record has `ci_evidence_why == "disabled_by_flag"`, and the stdout `ci_evidence.why` has the same value.
   - CEW2: a default run (no flag) whose report says `why=X`. The record has `ci_evidence_why == X`.
   - CEW3: a usage error (e.g. `--slug 'BAD SLUG'`, exit 2). The last record has verdict `error` and no `ci_evidence_why` key.
   - CEW4: every record written in CEW1-3 has an integer `duration_ms`.
   - RED-proof comment (applied once per the RED-proof rule): remove the `setRecordExtra` line → CEW1 and CEW2 red.
**Done when:** `bash _test-fixtures/a1-pr-merge-check/run-tests.sh` exits 0, `git diff --numstat "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-pr-merge-check` shows 0 deleted lines, and `STATUS-measure.md` has the RED-proof line.
**Covers:** SC-4, SC-9

### Task 3.2: `a1-tools run record`
**Goal:** Gate-log results and durations of a scope survive the worktree exit in the learning store (FR-035, D5, D10).
**Actions:**
1. Create `_shared/lib/run-record.cjs` (target under 250 lines). `cmdRun(sub, args)`:
   - `sub !== 'record'` → stderr usage, exit 2.
   - Flags via `parseFlags(args, { repo: 'string', scope: 'string', pr: 'string' })`. An unknown flag or a stray positional → exit 2.
2. Validation, all exit 2:
   - `--repo` is required, at most 4096 characters, has no NUL and is an existing directory.
   - `--scope` is required and passes `validateScope` from gate-log.cjs.
   - `--pr`, if given, matches `^[1-9][0-9]{0,6}$`.
   - The project is `repoProjectSlug(repo)` and must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$`.
3. Store (D5):
   - `peekVaultRoot()` is `null`, or `<root>/pattern/a1-learnings` is not a directory → stdout `{"status":"refused","reason":"no_learning_store",…}`, exit 1, nothing created.
   - `runsDir = <store>/_runs`. If it exists, `lstat` must show a real directory, and `assertAncestorInside(runsDir, realpath(store))` must pass. The file `<project>.jsonl`, if it exists, must be a regular file (not a symlink) of at most 20 MB. Any violation → exit 2.
4. Log:
   - `logPath = <repo>/.a1/phases/<scope>/gate-log.jsonl`. Apply `assertContained(repo, scope, logPath)` (symlink refusal → exit 2).
   - Read it with `readGateLog` from retro-gatelog.cjs. Code `A1_GATELOG` maps to exit 1: `no_gate_log` for a missing file, `gate_log_untrusted` for a broken chain. Zero records → exit 1 `empty_gate_log`.
5. Line (one JSON object, `\n`-terminated):

   ```
   { schema: 1, recorded_at: <ISO now>, project, scope, pr: <number|null>, head_sha: <last record head_sha>,
     gates: gatesFired(records).map(g => ({ id, verdict, caught, runs, duration_ms_sum, no_duration, ...(id === 'pr-merge-check' ? { ci_evidence_why: {<why>: count, unknown: count} } : {}) })) }
   ```

   - `duration_ms_sum` is the sum over records of that gate that carry `duration_ms`, or `null` when none do.
   - `no_duration` is the count of records without it.
6. Idempotence: parse the existing lines (skip unparsable ones) and look for `scope` equal and `(pr ?? null)` equal. On a hit, print `{"status":"already_recorded",…}`, exit 0 and do not write. Otherwise `writeTextAtomic`/`writeViaTmp` the file to the existing content plus the line, then print `{"status":"recorded","file",…}` and exit 0.
7. Create `_shared/lib/help-run.cjs` exporting `RUN_HELP`. The first line is exactly `  a1-tools run record --repo <path> --scope <spec-id> [--pr <n>]`, followed by indented lines describing the store path, idempotence and exits 0/1/2. In `_shared/lib/help.cjs`, require it and insert `${RUN_HELP}` on the line after `${METRICS_HELP}`.
8. In `_shared/a1-tools.cjs`, insert exactly one line between the `return;` of the `metrics` branch and `} else if (group === 'probe') {`:

   `    } else if (group === 'run') { require(path.join(__dirname, 'lib', 'run-record.cjs')).cmdRun(sub, rest); return;`

   Insert `"run", ` into the `expected` list of the unknown-group `usage(...)` message on that same existing line. The file goes from 777 to 778 lines.
9. Create `_test-fixtures/a1-metrics/parts/07-run-record.sh` (planted repos via `mk_workdir`, `A1_VAULT_ROOT` per call, records appended in-process through `appendGateLine` with `startedAt`/`durationMs`/`extra`). Cases:
   - RR1: gate X fail then pass, gate Y pass, `pr-merge-check` with why `ok` ×2 and one record without why. `run record --repo $P --scope pr-7 --pr 7` exits 0, and `_runs/fx-proj.jsonl` has 1 line with the exact gate objects: X `caught:true` `runs:2`, Y `caught:false`, merge-check `{ok:2, unknown:1}`, plus head_sha and pr 7.
   - RR2: a second call exits 0 with `already_recorded`, and the file sha256 is unchanged.
   - RR3: the same scope without `--pr`, then with `--pr 8`, appends 2 more lines (3 in total).
   - RR4: no store, two ways. (a) `A1_VAULT_ROOT=<empty dir>`: exit 1, `no_learning_store`, and `find <dir> -mindepth 1` is empty. (b) `A1_VAULT_ROOT` unset, `HOME=<empty temp>` and cwd a non-git temp dir: exit 1.
   - RR5: missing log → exit 1 `no_gate_log`. Tampered `prev` → exit 1 `gate_log_untrusted`. In both, the store file is unchanged.
   - RR6: log = the `old-format.jsonl` copy gives `duration_ms_sum: null` and `no_duration: 3`.
   - RR7: `_runs` as a symlink to an outside dir → exit 2 and the outside dir stays empty. `_runs/fx-proj.jsonl` as a symlink → exit 2.
   - RR8 (hostile input): `--scope ../../x` → 2; `--pr abc` → 2; `--repo` of 10000 characters → 2; `--bogus` → 2; `run` without sub → 2; `--scope` with `$(touch PWNED)` → 2 and no `PWNED` file anywhere in the work dirs.
   - RR9: `git worktree add` of a repo without ROADMAP (fixture-only temp repo, not a skill text), then `run record --repo <worktree>` writes `<main-checkout-basename>.jsonl` (D4). Repo setup per the fixture-repo rule (temp dir in a variable, per-repo identity on every commit).
   - RR10: `gatesFired` on planted records equals the parsed `firedYaml` items.
   - RED-proof comment (applied once per the RED-proof rule): idempotence check removed → RR2 red; store check uses `vaultRoot()` → RR4 red (creates dirs); `mainCheckoutDir` returns the worktree → RR9 red.
**Done when:** `bash _test-fixtures/a1-metrics/run-tests.sh` exits 0, `node _shared/a1-tools.cjs --help | grep -c "a1-tools run record"` = 1, `wc -l < _shared/a1-tools.cjs` is at most 800, `bash _test-fixtures/a1-lib-units/run-tests.sh` and `bash _test-fixtures/a1-cli-output/run-tests.sh` exit 0, and `STATUS-measure.md` has the 3 RED-proof lines.
**Covers:** SC-8, SC-9

### Task 3.3: `a1-tools metrics phase-time` with `--baseline`
**Goal:** Sum durations per scope and gate from `live` and `store`, count `ci_evidence_why` values, and write the baseline file with its host context (FR-003, FR-004, FR-005, D6, D7).
**Actions:**
1. Create `_shared/lib/metrics-phase-time.cjs`. It must not require `child_process`, `http`, `https`, `net` or similar, because `a1-metrics` AU4b enforces that. Use `fs`, `path`, `os`, `verifyChain`/`validateScope`/`SCOPE_RE` from gate-log.cjs, `peekVaultRoot`/`parseFlags`/`writeTextAtomic` from io.cjs, `assertAncestorInside` from fs-safe.cjs and `repoProjectSlug` from project-slug.cjs. Export `cmdMetricsPhaseTime(args)` with a JSDoc block. If the module would pass 400 lines, move the baseline part (actions 7a-7e) into `_shared/lib/metrics-baseline.cjs` — then AU4a counts 8, not 7 (adjust action 9 accordingly and say so in STATUS); prefer one module.
2. Flags: `repo`, `scope`, `last`, `json` (bool), `baseline` (bool), `force` (bool), `verify-report`, `merge-report`, `host-context`, `host-label`. Usage errors go through `usage()` from help.cjs (exit 1, the metrics convention):
   - unknown flag
   - `--last` not in 1..1000
   - `--scope` failing `validateScope`
   - `--repo` over 4096 characters
   - `--baseline` without all four of `--verify-report`, `--merge-report`, `--host-context`, `--host-label`
   - any of those four without `--baseline`
   - `--host-label` not matching `^[a-z][a-z0-9-]{0,39}$`

   An unreadable `--repo` (missing or not a directory) exits 2. The default `--repo` is found by walking up from `process.cwd()` to the first directory holding a `.git` entry (file or directory), with pure fs. None found → exit 2.
3. Live source: for every directory under `<repo>/.a1/phases/` whose `gate-log.jsonl` exists, run `verifyChain`. A broken chain adds `{scope, problem}` to `broken_logs`, writes one stderr line and sums nothing from that log. Rows: `{source:'live', scope, gate, runs, duration_ms_sum, no_duration, also_in_store}`. The scope is the directory name.
4. Store source: the root comes from `peekVaultRoot()`, and the file is `<root>/pattern/a1-learnings/_runs/<repoProjectSlug(repo)>.jsonl`. If it is absent, there are 0 store rows; this is not an error. Each line's `gates[]` becomes rows `{source:'store', scope, pr, gate, runs, duration_ms_sum, no_duration}`. Unparsable lines are counted in `store_unparsable`.
5. Dedup per D6. `--scope` filters both sources. `--last N` keeps the N scopes with the newest timestamp (live: max `ts`; store: `recorded_at`).
6. Totals: `{live:{duration_ms_sum, no_duration}, store:{…}}`, a top-level `no_duration`, and `ci_evidence_why: {<value>: count, unknown: count}`. Live: `pr-merge-check` records, where a missing field counts as `unknown`. Store: sum of the row maps. The JSON output (`--json`) is `{repo, project, rows, totals, no_duration, ci_evidence_why, broken_logs, store_unparsable}`. Without `--json`, print one table line per row (source first) plus the totals and why-count lines. Exit 0.
7. `--baseline` (D7):
   - a. Read both reports. Each must be at most 5 MB, valid JSON and carry a 40-hex `head_sha` and a `commands` array; otherwise exit 1. `verify-report` must have `duration_ms.base === null`; `merge-report` must have an integer `duration_ms.base` and a 40-hex `base_sha`; otherwise exit 1. The two `head_sha` values must be equal; otherwise exit 1.
   - b. Read `--host-context` (at most 64 KB, valid JSON). It must be an object with exactly the keys `verify_head_only` and `merge_check_long_path`. Each value must be an object with exactly the keys `load5_start` and `load5_end` (finite numbers `>= 0`), `cpus` (integer 1..4096), `host_busy` (boolean) and `checks` (integer 1..64, the number of quiet-host checks taken before the run). Any other shape, an extra key or a missing key → exit 1 `host_context_invalid` naming the key.
   - c. Target: `<repo>/.a1/phases/027-lean-pipeline/BASELINE.json` (constant `BASELINE_REL`). Refuse with exit 2 when an existing ancestor resolves outside `realpath(repo)` (`assertAncestorInside`) or when the target is a symlink. An existing file without `--force` → exit 1 `baseline_exists`, no write.
   - d. Write with `writeTextAtomic` (pretty JSON). No field holds `os.hostname()`:

     ```
     { schema: 1, feature: '027-lean-pipeline', host_label: <--host-label>, platform: os.platform(), node: process.version,
       cpus: os.cpus().length, date: <ISO now>,
       sha: <head_sha of the reports, the branch head; unreachable after the squash merge once the branch is deleted>,
       base_sha: <merge-report base_sha, the merge base on main; stays reachable after the merge>,
       gates: [{gate, runs, duration_ms_sum, no_duration}] (live+store, per gate, after dedup),
       verify_head_only: {head_sha, verdict, total_ms, commands: [{id, duration_ms}], host_load: <host-context.verify_head_only>},
       merge_check_long_path: {path: 'serial', source: 'verify run --base <merge-base sha> --no-cache (runVerify of pr merge-check)', head_sha, base_sha, verdict, head_ms, base_ms, total_ms, commands: [{id, duration_ms, base_duration_ms}], host_load: <host-context.merge_check_long_path>} }
     ```

   - e. stdout: `{"written": <path>, "host_busy": <true if either run's host_busy>}`. When either `host_busy` is true, also write one stderr line `metrics phase-time: baseline taken on a busy host (<which run>)`; the exit stays 0 (Wave 8 decides about the repeat).
8. In `_shared/lib/metrics.cjs`, add `'phase-time': ['metrics-phase-time.cjs', 'cmdMetricsPhaseTime']` to `SUBCOMMANDS`. Extend both usage strings with `metrics phase-time`; first check with `grep -rn "metrics escaped | metrics cost" _test-fixtures` that no fixture pins them. In `_shared/lib/help-metrics.cjs`, add a block whose first line is `  a1-tools metrics phase-time [--repo <path>] [--scope <scope>] [--last <N>] [--json] [--baseline --verify-report <file> --merge-report <file> --host-context <file> --host-label <label> [--force]]`, followed by indented lines describing sources, `no_duration`, the why counts, the baseline path, the host-context schema and exits.
9. In `_test-fixtures/a1-metrics/parts/04-audit.sh`, change AU4a's expected count from 6 to 7 and its label from "count 6" to "count 7". That is the only edit there. AU4b now also covers the new module.
10. Create `_test-fixtures/a1-metrics/parts/06-phase-time.sh`. Planted repos are built from the `old-format.jsonl` copy plus records appended through `appendGateLine`. The store files are hand-written per the Task 3.2 line schema, and the two verify reports are produced by running the real `verify run` on a planted two-stub project (the merge report with `--base <planted merge-base sha> --no-cache`). The host-context files are hand-written. Cases:
    - PT1: scope `_unscoped` (3 old lines plus 2 new records of the same gate, 100 and 250 ms) gives runs 5, `duration_ms_sum` 350, `no_duration` 3, source `live`.
    - PT2: scope `pr-7` with `pr-merge-check` records why `ok`, `ok`, `disabled_by_flag`, `protected_path_changed` and one without why gives exactly `{ok:2, disabled_by_flag:1, protected_path_changed:1, unknown:1}`.
    - PT3: store row for scope `pr-5` under project `fx-proj` (ROADMAP frontmatter) gives a row with source `store`. Without ROADMAP, the derived project is the planted repo's dir name. From a `git worktree` of that repo, it is the main checkout's dir name. Repo setup per the fixture-repo rule (temp dir in a variable, per-repo identity on every commit).
    - PT4: a store row for `pr-7` marks the live `pr-7` rows `also_in_store:true` and leaves them out of `totals.live`.
    - PT5: tampered chain in one scope gives `broken_logs[0].scope` equal to that scope, the other scopes still summed, exit 0.
    - PT6: `--scope pr-7` and `--last 1` filters.
    - PT7 (hostile): `--scope ../x` → 1; `--last 0` → 1; `--repo` of 10000 characters → 1; `--repo /nonexistent` → 2; `--bogus` → 1; `--host-label 'Bad Label'` with the other baseline flags → 1.
    - PT8 (baseline): exit 0 and the file at `$P/.a1/phases/027-lean-pipeline/BASELINE.json` has all schema keys. `sha` equals the report `head_sha`, `base_sha` equals the merge report `base_sha` and is 40 hex, `host_label` equals the flag, the file contains no occurrence of `os.hostname()`'s value (`grep -c "$(hostname)"` = 0), `merge_check_long_path.path === 'serial'`, `base_ms` is an integer, every `commands[].duration_ms` is an integer or `null`, and both `host_load` objects equal the planted host-context values. With a host-context where `merge_check_long_path.host_busy` is true: exit 0, stdout `host_busy: true`, one stderr line naming `merge_check_long_path`.
    - PT9: a second `--baseline` exits 1 with sha256 unchanged. `--force` exits 0 and rewrites.
    - PT10: reports with different `head_sha` → 1; a head-only report passed as `--merge-report` → 1; `--baseline` without reports → 1; `--baseline` without `--host-context` → 1; a host-context with an extra key, a missing `cpus`, `cpus: 0`, `load5_start: -1` or `host_busy: "no"` → 1 each with `host_context_invalid` (5 asserts); a 70 KB host-context → 1.
    - PT11: `.a1/phases/027-lean-pipeline` as a symlink to an outside dir → exit 2 and the outside dir stays empty.
    - PT12 (SC-001 shape): a scope written only through the real facade hook (`realpath-check run`) gives `no_duration` 0.
    - RED-proof comment (applied once per the RED-proof rule): records without duration summed as 0 → PT1 red; dedup removed → PT4 red; `--force` check removed → PT9 red; host-context key check removed → PT10 extra-key case red; `host: os.hostname()` written → PT8 hostname case red.
**Done when:** `bash _test-fixtures/a1-metrics/run-tests.sh` exits 0, `grep -Ec "child_process|require\(['\"]https?['\"]\)" _shared/lib/metrics-phase-time.cjs` = 0, `grep -c "os.hostname" _shared/lib/metrics-phase-time.cjs` = 0, `wc -l` of every file touched is at most 800, `node _shared/a1-tools.cjs metrics phase-time --repo "$(git rev-parse --show-toplevel)" --json` exits 0, and `STATUS-measure.md` has the 5 RED-proof lines.
**Covers:** SC-3, SC-4, SC-5, SC-9

---

## Wave 4 — Register `pr-security-surface` (lane gates)

### Task 4.1: Registry row, 02-review.md wiring, FR-033 fixture
**Goal:** The Samuel trigger is the registered, logged gate `pr-security-surface` (FR-033, D8).
**Actions:**
1. In `_shared/gates-registry.md`, insert one row directly after the `pr-merge-check` row (line 74). Use no unescaped `|` in the notes:

   ``| `pr-security-surface` | Review (a1-pr-review step 2.2b) | deterministic | cheap | a1-pr-review (`workflows/02-review.md`) | blocking | NEW (2026-11-12, spec 027-lean-pipeline FR-033). The Samuel trigger: `a1-tools xprov scope` classifies the PR diff; `security_surface: true` makes 02-review.md spawn a1-samuel-security, a non-zero exit is STOP (no merge). Exit 0 on every classification, so the log verdict is pass; the forbidden-surface list stays shared by reference (`xprov-scope-globs.json` include `quick.cjs#FORBIDDEN_SURFACE_GLOBS`). | | `xprov scope` @ a1-pr-review |``
2. In `skills/a1-pr-review/workflows/02-review.md` 2.2b:
   - Replace line 72 with `SURF="$(cd "<worktree_path>" && node <repo>/_shared/a1-tools.cjs xprov scope --repo "<worktree_path>" --base "$BASE_SHA" --head HEAD --phase pr-<n>)"; RC=$?`.
   - Add one prose sentence above the fence: "This call is the registered gate `pr-security-surface` (spec 027 FR-033): the facade hook appends one line to `.a1/phases/pr-<n>/gate-log.jsonl` of the worktree, so the call runs inside the worktree (`cd`) and carries `--phase pr-<n>`."
   - The strings `xprov scope --repo`, `--head HEAD`, `baseRefOid`, `RC=$?` and `xprov scope exit=$RC` must stay. `a1-pr-review/run-tests.sh:179,191,295` match them; do not edit that file in this lane (it belongs to lane measure). If it goes red, stop and report.
3. In `skills/a1-pr-review/SKILL.md` line 104, change "Step 2.2b runs `xprov scope`" to "Step 2.2b runs `xprov scope` (registered gate `pr-security-surface`)".
4. Create `_test-fixtures/a1-gates-lint/run-wave14.sh`. Its header follows `run-wave13.sh` (unset vault vars, `mk_workdir`, `ok`/`bad`, the `copy_tree` and `edit` helpers, and a "Measured red" comment block). FR-033 cases:
   - W14a: the real `gates lint` exits 0, and `wired` contains `{gate:'pr-security-surface', skill:'a1-pr-review', calls:1}`.
   - W14b: in a planted copy (skills plus agents), remove the line containing `a1-tools.cjs xprov scope` from `skills/a1-pr-review/workflows/02-review.md`. `gates lint --root <copy> --registry $REPO_ROOT/_shared/gates-registry.md` exits 1 with finding `unwired`, gate `pr-security-surface`.
   - W14c: build a temp primary repo with 2 commits and a `git worktree add` (fixture-only, not a skill text) with one more commit. Extract the line containing `a1-tools.cjs xprov scope` from the real 02-review.md and substitute `<repo>` → `$REPO_ROOT`, `<worktree_path>` → `$WT`, `<n>` → `9` and `$BASE_SHA` → the base sha. Run it with `bash -c` and cwd = the primary checkout. The result: `SURF` holds JSON with a boolean `security_surface`, `$WT/.a1/phases/pr-9/gate-log.jsonl` has exactly 1 line (gate `pr-security-surface`, verdict `pass`, scope `pr-9`; do not assert `duration_ms` here, so the lanes stay independent — Wave 7 covers it), and the primary checkout has no `.a1/phases`. Repo setup per the fixture-repo rule (temp dir in a variable, per-repo identity on every commit).
   - W14c-red: the same line with `cd "<worktree_path>" && ` removed puts the log in the primary checkout (`$PRIMARY/.a1/phases/pr-9/gate-log.jsonl` exists). This proves W14c discriminates.
   - W14d: a diff touching a path that `_shared/lib/xprov-scope-globs.json` classifies as security surface (pick one from the file) still exits 0 with `security_surface:true` and log verdict `pass`. `--base` set to an unknown sha exits 2 with log verdict `error`.
   - W14e: `node $REPO_ROOT/_test-fixtures/a1-gates-lint/check-callsite-flags.cjs $REPO_ROOT` exits 0 (`--phase` accepted on `xprov scope`).
5. Register the runner in `_test-fixtures/suite-groups.json`. Add `"a1-gates-lint/run-wave14.sh"` once, in the same `ci_jobs` list as `run-wave13.sh`, and a `timings.seconds` entry with the measured seconds of one run (rounded up). Run `bash bin/run-suites.sh --check-groups` (exit 0).
6. Run, using the selector form the runner accepts (`bash bin/run-suites.sh --help`): `a1-xprov/run-tests.sh`, `a1-xprov/run-tests-b.sh`, `a1-pr-review/run-tests.sh`, `a1-probe/run-tests.sh`, `a1-kritis-profile/run-tests.sh`, `a1-dashboard/run-tests.sh`, `a1-gates-lint/run-wave13.sh`, `a1-retro-validate/run-tests.sh` and `a1-depth-pass/run-tests.sh`. These suites call `xprov scope`, lint the real tree or read the real `gates-registry.md`.
   - `a1-xprov` was measured with the new row before this plan (see Depth Pass answer 2 and R9): SC9 stderr peaks at 243 chars against the `< 600` bound, and shard b passes. **Any `a1-xprov` red is a STOP: report it with the case name and the measured value; do not edit any file under `_test-fixtures/a1-xprov/`.**
   - Any other red in this list that is not equally red on `main` is a STOP as well.
**Done when:** `bash _test-fixtures/a1-gates-lint/run-wave14.sh` exits 0, `node _shared/a1-tools.cjs gates lint` exits 0, `bash bin/run-suites.sh --check-groups` exits 0, the suites of action 6 are green (or equal to `main` for the known aiserver reds), and `git diff --name-only "$(git merge-base origin/main HEAD)" -- _test-fixtures/a1-xprov` is empty.
**Covers:** SC-6, SC-9

---

## Wave 5 — 05-merge.md call and ADR note (lane measure)
**Depends on:** Wave 3

### Task 5.1: `run record` in the merge close-out
**Goal:** 05-merge.md persists the run record after the merge and before the worktree exit (FR-035, D10), and a standalone a1-pr-review run without a caller phase never stalls.
**Actions:**
1. In `skills/a1-pr-review/workflows/05-merge.md` § 5.4, insert the following between the paragraph ending "…go with the worktree:" and the numbered close-out list:
   - One prose paragraph: "Persist the run record first (spec 027 FR-035). The gate logs are gitignored and leave with the worktree; `run record` keeps scope, head sha, last verdict, `caught` and summed durations per gate in the learning store, once per scope and PR. Exit 1 (no learning store, no or untrusted gate log) does not stop the close-out: report it. Exit 2 is STOP before the worktree exit. Set `PHASE` to the phase name the caller handed over (a1-new-feature spec id, a1-execute phase); when a1-pr-review runs on its own, set it to `none`. The block skips the second call for an empty value, `none` or an unreplaced placeholder."
   - Then one fenced `bash` block (this exact text):

     ```bash
     node <repo>/_shared/a1-tools.cjs run record --repo "<worktree_path>" --scope pr-<n> --pr <n>; RC=$?
     if [ "$RC" -eq 2 ]; then echo "STOP: run record pr-<n> exit=2, worktree stays"; exit 2; fi
     if [ "$RC" -ne 0 ]; then echo "WARN: run record pr-<n> exit=$RC, durations not persisted"; fi
     PHASE="<phase_name>"
     case "$PHASE" in
       ""|none|"<"*) echo "SKIP: run record, no caller phase handed over" ;;
       *) node <repo>/_shared/a1-tools.cjs run record --repo "<worktree_path>" --scope "$PHASE" --pr <n>; RC=$?
          if [ "$RC" -eq 2 ]; then echo "STOP: run record $PHASE exit=2, worktree stays"; exit 2; fi
          if [ "$RC" -ne 0 ]; then echo "WARN: run record $PHASE exit=$RC, durations not persisted"; fi ;;
     esac
     ```

     The guard was run against the four inputs `<phase_name>`, empty, `none` and `027-lean-pipeline-s1`: the first three print SKIP, the last runs (R10). This block becomes the 5th of 6 bash blocks: after `gh pr merge` (index 3) and before `probe run`. The call stays in the same block, so the block count is 6 and the order is `DCMGRP`.
2. In `_test-fixtures/a1-pr-review/run-tests.sh`:
   - Line 261: change the expected count 5 → 6 and the labels "exactly 5" → "exactly 6" / "(want 5)" → "(want 6)".
   - Line 262: add `/run record/.test(x)?"R":` before `/probe run/` in the order map.
   - Line 263: change the expected `DCMGP` → `DCMGRP` (both occurrences) and the label to "…gh pr merge, run record, live probes".
   - Add a comment `# spec 027 FR-035: run record block after the merge, before probes`.
   - Append (add only) one case `RR-guard`: extract the `run record` block from the real 05-merge.md, replace `<repo>` with a stub dir whose `_shared/a1-tools.cjs` prints its argv and exits 0, `<worktree_path>` → a temp dir, `<n>` → `7`, and leave `<phase_name>` unreplaced. Run it with `bash`: exit 0, stdout contains `SKIP: run record` and the stub ran exactly once (`--scope pr-7`). Run it again with `<phase_name>` → `fx-phase`: the stub ran twice, the second with `--scope fx-phase`.
   - No assert is removed.
3. Run `node _shared/a1-tools.cjs workflow lint` (exit 0), `bash _test-fixtures/a1-pr-review/run-tests.sh`, `bash _test-fixtures/a1-probe/run-tests.sh` and `bash _test-fixtures/a1-gates-lint/run-wave13.sh`. The W13 sweep checks the `run record` flags (`--repo`, `--scope`, `--pr`) against `RUN_HELP`; the guard adds no new flag.
**Done when:** the three suites and `workflow lint` exit 0, `grep -c "a1-tools.cjs run record" skills/a1-pr-review/workflows/05-merge.md` = 2, `grep -c 'PHASE="<phase_name>"' skills/a1-pr-review/workflows/05-merge.md` = 1, and the RR-guard case passes.
**Covers:** SC-8

### Task 5.2: ADR note for the record fields and the invariant lint
**Goal:** The gate-log contract ADR documents the slice-1 changes. `.a1/xprov.json` is `external_review: denied` (owner, 2026-11-11): no Codex review runs; the ADR edit is reviewed by Reinhard (and Samuel, record contract) before merge.
**Actions:**
1. In `docs/adr/2026-10-14-gate-invoke-and-log.md`, add `### 3a. Record fields added by spec 027 (2026-11-12)` directly before `### 4. Dispositions`. Keep it to at most 20 lines covering:
   - `started_at` and `duration_ms` (hook-measured).
   - The D1 allowlist and formats.
   - The setter as an in-process no-op outside the hook, reset after each write, never overriding a core field.
   - The D2 order, no migration and new keys validated only when present.
   - `ci_evidence_why` from `pr merge-check`.
2. In `### 2. gates lint`, add one sentence: the `invariant_*` rules from `_shared/quality-invariants.json` (spec 027 FR-034), resolved relative to `--root`, with `invariant_file_missing` only under the default root.
**Done when:** `grep -c "^### 3a. Record fields added by spec 027" docs/adr/2026-10-14-gate-invoke-and-log.md` = 1, and the section is at most 20 lines (`awk '/^### 3a\./{f=1;next} /^### 4\./{f=0} f' docs/adr/2026-10-14-gate-invoke-and-log.md | wc -l` ≤ 20).
**Covers:** SC-1, SC-7

---

## Wave 6 — Quality-invariant lint (lane gates)
**Depends on:** Wave 4

### Task 6.1: `_shared/quality-invariants.json` and the `invariant_*` rules
**Goal:** `gates lint` fails when any keep-list gate is missing, exempted, reclassified or loses its invocation or owner anchor, or when a listed CI step disappears (FR-034, D9).
**Actions:**
1. Create `_shared/quality-invariants.json` with `{"schema":1,"source":"spec 027-lean-pipeline FR-034; shrink only with an owner-approved line in the spec ## Clarifications","gates":[…],"ci_steps":[…]}`.
   - `gates` (12 entries):
     - Deterministic, `{"id","kind":"deterministic"}`: `fix-integrity`, `scope-claim`, `test-fidelity`, `fix-class-sweep`, `pr-merge-check`, `pr-security-surface`.
     - Prompt, `{"id","kind":"prompt","owner_skill","owner_ref","must_contain"}`:
       - `pr-reinhard`: a1-pr-review, `skills/a1-pr-review/workflows/02-review.md`, `a1-reinhard-reviewer`.
       - `phase-6-verify`: a1-execute, `skills/a1-execute/workflows/03-verify.md`, `a1-victor-verifier`.
       - `plan-audit`: a1-plan, `skills/a1-plan/workflows/04-audit.md`, `a1-adam-auditor`.
       - `gate-c-ac-dryrun`: a1-new-feature, `skills/a1-new-feature/workflows/03-clarify.md`, `Gate C: AC dry-run walkthrough`.
       - `plan-review-xprov`: a1-plan, `skills/a1-plan/workflows/04b-xprov-review.md`, `--gate plan-review-xprov`.
       - `design-review-xprov`: a1-plan, `skills/a1-plan/workflows/04b-xprov-review.md`, `--gate design-review-xprov`.
   - `ci_steps` (2 entries, `{"file":".github/workflows/test.yml","job","name"}`):
     - Job `checks`: the exact `name:` value of the step at `.github/workflows/test.yml` line 118. Copy it with the Read tool and write it with Write/Edit only. A PreToolUse hook denies a Bash command line that contains the owner-only command words of that step name (measured by the audit: `node -e`, `echo … > file` and `git commit -m` with the name are denied; a read-only `grep -c` is allowed). Therefore never put the name into a Bash command line, a `node -e` string, a commit message or a PR text.
     - Job `enforcement`: `Cross-provider enforcement flip`.
   - Before writing, confirm every `must_contain` string occurs in its `owner_ref` file with the Read tool or `grep -c` (each count must be at least 1).
2. Create `_shared/lib/quality-invariants.cjs` (target under 220 lines, pure function plus a small loader). Export `checkInvariants({ root, defaultRoot, registryText, lintReport })`, which returns `{ status: 'checked'|'absent', file, ids, ci_steps, findings }`. Each finding is `{rule, gate|null, step?, reason}`. Rules:
   - `invariant_file_missing`: file absent and `defaultRoot === true`. With `defaultRoot === false`, the status is `absent` and there are no findings.
   - `invariant_file_invalid`: bad JSON, missing arrays, an `id` not matching `^[a-z0-9][a-z0-9.-]{0,80}$`, an unknown `kind`, a prompt entry missing a field, an `owner_ref` that is absolute or contains `..`, or a file over 256 KB.
   - `invariant_missing`: the id has no registry row (`parseRegistryRows`).
   - `invariant_class_changed`: the registry `class` does not equal `kind`.
   - `invariant_unwired_until`: the row carries an exemption (`rowInvokes(...).exemption`).
   - `invariant_unwired`: deterministic only. The invoke kind is not `command`, or `lintReport.findings` has `rule:'unwired'` for the id, or the id is absent from `lintReport.wired`.
   - `invariant_owner_lost`: prompt only. The registry `owning file` cell does not contain `owner_skill`, or `<root>/<owner_ref>` is missing, or the file does not contain `must_contain` (plain `String.prototype.includes`).
   - `invariant_ci_step_missing`: `<root>/<file>` is missing, or no line inside the job block carries the step name. The job block starts at the line whose `trimEnd()` equals `  <job>:` and ends before the next line that matches `^  [A-Za-z0-9_-]+:\s*$`. Inside it, a line counts when it matches `^\s*-\s+name:\s*` and the rest of the line, trimmed (and with one pair of surrounding `"` or `'` removed), is **string-equal** to the step `name`. Never build a regex from the step name (it contains parentheses).

   All paths resolve from `root`; nothing reads `__dirname`. JSDoc `@returns` on the export.
3. In `_shared/lib/gates-cli.cjs` `cmdGatesLint`:
   - After `lintGates`, call `checkInvariants({ root: inputs.root, defaultRoot: flags.root === undefined, registryText: inputs.registryText, lintReport: report })`.
   - Concatenate its findings into the printed `findings` and the exit decision, and add `invariants: {status, file, ids, ci_steps}` to the JSON output.
   - `formatFinding` must print `step` when `gate` is null.
   - `--log` mode is unchanged.
4. In `_shared/lib/help-gates.cjs`, extend the `gates lint` block with 2-3 indented lines naming the `invariant_*` rules, the file and the root-relative resolution.
5. Append FR-034 cases to `_test-fixtures/a1-gates-lint/run-wave14.sh`. The planted root is a copy of `skills/`, `agents/`, `_shared/gates-registry.md`, `_shared/quality-invariants.json` and `.github/workflows/test.yml`. Call `gates lint --root <copy> --registry <copy>/_shared/gates-registry.md`.
   - W14f: the real tree with no flags exits 0 with `invariants.status === 'checked'`, `ids === 12` and `ci_steps === 2`. The real JSON's sorted ids equal the 12 spec ids typed in the fixture (the test oracle).
   - W14g (12 asserts, loop): delete the registry row of id X → exit 1 with a finding `invariant_missing`, gate X.
   - W14h (12 asserts, loop):
     - Deterministic X: delete every line containing `a1-tools.cjs <subcommand of X>` in `skills/**/*.md` of the copy → exit 1, `invariant_unwired` gate X.
     - Prompt X: remove every occurrence of its `must_contain` in its `owner_ref` → exit 1, `invariant_owner_lost` gate X.
   - W14i: append `; unwired_until=2099-01-01; unwired_reason=fixture` to the invoke cell of `pr-merge-check` → exit 1 with `invariant_unwired_until`.
   - W14j: `pr-merge-check` class `deterministic` → `prompt` → exit 1 with `invariant_class_changed`.
   - W14k (2 asserts): remove each `ci_steps` step's `- name:` line from the copy's test.yml (by line number found via a `node` script file that reads the step names from the JSON, never by typing a name on a command line) → exit 1 with `invariant_ci_step_missing` naming the job.
   - W14k2: move the `enforcement` step's `- name:` line under job `checks` in the copy → exit 1 with `invariant_ci_step_missing` (job scope is enforced).
   - W14k3: quote the `checks` step value in the copy's test.yml (wrap it in `"…"` via the same node script) → exit 0 (the string comparison strips one pair of quotes and the parentheses do not break it).
   - W14l: a planted root without the JSON plus `--root` → exit 0 with `invariants.status === 'absent'`. A temp **git repo** holding the same copy minus the JSON, with cwd inside it and no `--root` → exit 1 with `invariant_file_missing`. Repo setup per the fixture-repo rule (temp dir in a variable, per-repo identity on every commit).
   - W14m: an `owner_ref` of `../../etc/passwd` in a planted JSON → exit 1 with `invariant_file_invalid`.
   - W14n: the planted copy with no removal → exit 0. This proves the copy itself is complete and the reds above are caused by the single removal.
   - Header RED-proof lines (applied once per the RED-proof rule): JSON or test.yml resolved from `__dirname` instead of `root` → W14l (`absent` case) and W14k red; `invariant_unwired` check removed → W14h red for the deterministic ids; job-scope check removed → W14k2 red; step name compared via an unescaped `new RegExp(name)` → W14f red on the real tree.
6. Update the `timings.seconds` entry for `run-wave14.sh` in `_test-fixtures/suite-groups.json` with the new measured duration.
**Done when:** `bash _test-fixtures/a1-gates-lint/run-wave14.sh` exits 0 with at least 24 per-id asserts passing, `bash _test-fixtures/a1-gates-lint/run-tests.sh` and `run-wave13.sh` exit 0 unchanged, `node _shared/a1-tools.cjs gates lint` exits 0, `bash bin/run-suites.sh --check-groups` exits 0, every touched module is at most 800 lines, and `STATUS-gates.md` has the 4 RED-proof lines.
**Covers:** SC-7, SC-6, SC-9

---

## Wave 7 — Carry-over and integration gate (sequential after lanes)
**Depends on:** Wave 2, 5, 6

### Task 7.1: Carry the spec-027 documents over, then full-tree checks
**Goal:** The PR contains the spec-027 product docs and phase artifacts, and the combined tree is green and inside every limit before measuring the baseline.
**Actions:**
1. Preconditions: `git rev-parse --abbrev-ref HEAD` is not `main`, and `git rev-parse --show-toplevel` is the worktree path (not `/home/rob/claude-projects/a1-specforge`). Otherwise STOP. Then `git fetch origin main`.
2. Carry-over (read the primary checkout, write only the worktree). For each path below: if the worktree copy is absent, `cp` it from `/home/rob/claude-projects/a1-specforge/<path>` (create parent dirs); if present and byte-identical (`cmp -s`), do nothing; if present and different, STOP and report (never guess which copy wins). Never `git stash`, never write or reset anything in the primary checkout.
   - `docs/product/CHANGELOG-archive.md`, `docs/product/ROADMAP.md`, `docs/product/index.json` (modified on `main`'s working tree)
   - `docs/product/features/027-lean-pipeline/feature.md`
   - `.a1/phases/027-lean-pipeline-s1/RESEARCH.md`, `MAP.md`, `PLAN.md`, `AUDIT.md` (the phase's `gate-log.jsonl` is gitignored and is not copied)
   Commit them as `docs(027): spec 027 product docs and slice-1 phase artifacts`.
3. Run `bash bin/run-suites.sh` (all suites). For any red suite, compare against `main` in a clean a1-worktree, never in a `git archive` snapshot (no `.git` there):
   - `node _shared/a1-tools.cjs worktree prepare /home/rob/claude-projects/a1-specforge 027-main-compare --base main`, then `worktree enter <id>`.
   - Run `bash _test-fixtures/<suite>/<runner>` there.
   - `node _shared/a1-tools.cjs worktree exit <id> --mode discard`.
   Only `a1-intent` and `a1-vault-cockpit`, when equally red on `main` in that worktree, are accepted. Record both results in STATUS.
4. Run each of these, all with exit 0:
   - `node _shared/a1-tools.cjs gates lint`
   - `node _shared/a1-tools.cjs workflow lint`
   - `bash bin/run-suites.sh --check-groups`
   - `bash bin/verify-install-sync.sh`
   - `node _shared/a1-tools.cjs lane-split check --plan .a1/phases/027-lean-pipeline-s1/PLAN.md --phase 027-lean-pipeline-s1`
   - `node _shared/a1-tools.cjs plan depth-check --plan .a1/phases/027-lean-pipeline-s1/PLAN.md --phase 027-lean-pipeline-s1`
5. Assert `git diff --numstat origin/main...HEAD -- _test-fixtures/a1-pr-merge-check _test-fixtures/a1-verify | awk '{d+=$2} END{print d+0}'` = 0, and `git diff --name-only origin/main...HEAD -- _test-fixtures/a1-xprov | wc -l` = 0.
6. Assert `wc -l` is at most 800 for `_shared/a1-tools.cjs` and for every `_shared/lib/*.cjs` in `git diff --name-only origin/main...HEAD`.
7. Assert `git diff origin/main...HEAD -- _shared/lib/xprov-scope.cjs _shared/lib/verify-base.cjs _shared/lib/pr-ci-evidence.cjs _shared/lib/quick.cjs _shared/lib/xprov-scope-globs.json` is empty: no change to the exit contract, the merge-check protections or the forbidden-surface list.
8. Integration check across lanes: run `node _shared/a1-tools.cjs xprov scope --repo "$(git rev-parse --show-toplevel)" --base "$(git merge-base origin/main HEAD)" --head HEAD --phase w7-integ` from the worktree root (`--base` accepts only a sha or `HEAD`; `origin/main` exits 2). Assert exit 0, and the last line of `.a1/phases/w7-integ/gate-log.jsonl` has gate `pr-security-surface`, verdict `pass` and an integer `duration_ms` (the field W14c leaves out).
9. Collect the RED-proof lines of all lanes into STATUS.md and check the count: Task 1.1 (4), 2.1 (2), 3.1 (1), 3.2 (3), 3.3 (5), 6.1 (4) = 19 lines.
10. Commit STATUS.md in a separate `docs(027): wave 7 integration status` commit after all checks; this is the wave's final commit, so the a1-execute commit-landed gate finds a clean tree and Wave 8's precondition holds.
**Done when:** every command in actions 1-10 meets its stated result, the carry-over commit lists exactly the 8 paths of action 2, STATUS.md lists the outputs and is committed in the wave's final commit, and `git status --porcelain` is empty.
**Covers:** SC-9, SC-1..SC-8 (integration)

---

## Wave 8 — Record the baseline (sequential after lanes)
**Depends on:** Wave 7

### Task 8.1: Measure on a quiet host and commit `BASELINE.json`
**Goal:** The FR-005 baseline exists, measured on the execution host after the quiet-host check, with the load values recorded per run, at the slice-1 head (SC-5, spec SC-003 reference).
**Actions:**
1. Preconditions (STOP if any fails): cwd = worktree root; `git rev-parse --abbrev-ref HEAD` ≠ `main`; `git status --porcelain` is empty; `git fetch origin main`; `MB=$(git merge-base origin/main HEAD)` is 40 hex. `MB` is the merge-base sha that `resolveMergeBase` computes for `origin/main`; it stays reachable on `main` after the squash merge.
2. Scratch dir outside the repo: `R=$(mktemp -d)`. Write `$R/quiet.sh` with the Write tool, this exact content (the pattern and the load check are the quiet-host block of `skills/a1-pr-review/workflows/05-merge.md` 5.3; the pattern does not match the calling shell, measured R9b):

   ```bash
   #!/usr/bin/env bash
   # usage: quiet.sh <out.jsonl> <max_checks>; one JSON line per check; exit 0 quiet, 3 still busy at the last check
   out="$1"; max="$2"
   for i in $(seq 1 "$max"); do
     p=0; pgrep -f '(^|/)node .*a1-tools[.]cjs (verify run|pr merge-check)' >/dev/null && p=1
     line="$(node -e 'const os=require("os");const l=os.loadavg()[1],n=os.cpus().length,p=process.argv[1]==="1";console.log(JSON.stringify({ts:new Date().toISOString(),load5:Number(l.toFixed(2)),cpus:n,proc_busy:p,wait:p||l>=n}))' "$p")"
     echo "$line" >> "$out"
     case "$line" in *'"wait":false'*) exit 0 ;; esac
     [ "$i" -lt "$max" ] && sleep 60
   done
   exit 3
   ```

   Write `$R/ctx.cjs` with the Write tool: it reads `$R/pre-head.jsonl`, `$R/post-head.jsonl`, `$R/pre-merge.jsonl`, `$R/post-merge.jsonl` and prints the host-context JSON of Task 3.3 action 7b. Per run: `load5_start` = `load5` of the last pre line, `load5_end` = `load5` of the post line, `cpus` from the last pre line, `checks` = number of pre lines, `host_busy` = true if any pre or post line has `wait: true`.
3. Head-only run:
   - `bash "$R/quiet.sh" "$R/pre-head.jsonl" 16` (one check plus up to 15 re-checks, one per minute; start it with `run_in_background` and wait for the completion notice — no foreground sleep). Exit 3 means the host stayed busy: start anyway (05-merge.md rule) and the run counts as `host_busy`.
   - `node _shared/a1-tools.cjs verify run --no-cache > "$R/head.json"`, started in the background, waiting for its exit (about 21 min). Exit 0 or 1 is accepted; exit 2 is a STOP.
   - Right after it ends: `bash "$R/quiet.sh" "$R/post-head.jsonl" 1` (one check; exit 3 only marks `host_busy`).
4. Long-path run, after step 3 has finished and never in parallel:
   - `bash "$R/quiet.sh" "$R/pre-merge.jsonl" 16` as in step 3.
   - `node _shared/a1-tools.cjs verify run --base "$MB" --no-cache > "$R/merge.json"` (about 40 min, same exit handling).
   - `bash "$R/quiet.sh" "$R/post-merge.jsonl" 1`.
5. Busy repeat: `node "$R/ctx.cjs" > "$R/ctx.json"`. If `host_busy` is true for a run, repeat that run once (its pre check, the run and its post check, overwriting its files), then rebuild `ctx.json`. Keep the second result even if it is busy again, and name it in STATUS ("baseline <run> taken on a busy host: load5 <start>/<end> on <cpus> CPUs, other active process: <pgrep -fa line>"). Always name the shared-host risk in STATUS: another session on this host can start `run-suites` or `verify run` during the run; slice 1 has no lock (it arrives with FR-018 in slice 3), and the post check is the only detection.
6. `node _shared/a1-tools.cjs metrics phase-time --repo "$(git rev-parse --show-toplevel)" --baseline --verify-report "$R/head.json" --merge-report "$R/merge.json" --host-context "$R/ctx.json" --host-label aiserver` (exit 0). Label choice: the label `aiserver` already appears 33 times in 3 committed STATUS files of this repo (measured, `git grep -c aiserver -- '.a1/phases/*/STATUS*.md'`), names no domain or IP and is the name slices 2-3 use for the same host. No `os.hostname()` value is written.
7. Check the written `.a1/phases/027-lean-pipeline/BASELINE.json`:
   - `host_label` = `aiserver`, and `cpus` is an integer.
   - `sha` equals `git rev-parse HEAD`, and `base_sha` equals `$MB`.
   - `merge_check_long_path.base_ms` and `.head_ms` are integers.
   - `verify_head_only.commands.length` equals the command count of the `verify run` resolution at HEAD: `$(ls _test-fixtures/*/run*.sh | wc -l) + 1` (the `each` glob plus the one explicit command of `.a1/verify.json`; 62 expected after `run-wave14.sh` exists), and it equals `merge_check_long_path.commands.length`.
   - Both `host_load` objects equal `ctx.json`.
8. Stage and commit only that file: `git add .a1/phases/027-lean-pipeline/BASELINE.json`, with the message `chore(metrics): record the 027 baseline on aiserver (FR-005)`.
9. Copy into STATUS.md: head-only `total_ms`, long-path `total_ms`, both `host_load` objects, `MB`, and every line of the four `quiet.sh` output files. Commit STATUS.md in a separate `docs(027): wave 8 baseline status` commit after the checks; it is the wave's final commit.
**Done when:** with `B=$(git log -1 --format=%H -- .a1/phases/027-lean-pipeline/BASELINE.json)`, `git show --stat --format= "$B"` lists exactly `.a1/phases/027-lean-pipeline/BASELINE.json`, `git branch --contains "$B"` does not list `main`, `git status --porcelain` is empty after the STATUS commit, and the action 7 checks hold.
**Covers:** SC-5

---

## Verification
After all waves, against the final branch head, cwd = worktree root:
- [ ] `node _shared/a1-tools.cjs metrics phase-time --json` exits 0 and the output has `rows`, `no_duration` and `ci_evidence_why`.
  - Red when: the `phase-time` subcommand is not routed.
  - Red run (R1, today on `main`): exit 1, `unknown metrics subcommand: phase-time`.
- [ ] `node _shared/a1-tools.cjs run record --repo . --scope <a scope with a log>` exits 0 or 1 with a JSON reason (never "unknown command group").
  - Red when: the `run` branch is missing in a1-tools.cjs.
  - Red run (R2, today): exit 1, `unknown command group: run`.
- [ ] `grep -c 'pr-security-surface' _shared/gates-registry.md` is at least 1, and `gates lint` exits 0.
  - Red when: the row is missing or the 02-review.md call was removed.
  - Red run (R3, today): count 0.
- [ ] `test -f _shared/quality-invariants.json`, and `gates lint` JSON has `invariants.ids === 12`.
  - Red when: the file is absent (default root gives `invariant_file_missing`).
  - Red run (R4, today): `test -f` exit 1.
- [ ] The newest line of any gate log written after the change has an integer `duration_ms`. Check: `tail -1 .a1/phases/w7-integ/gate-log.jsonl | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(Number.isInteger(r.duration_ms)?0:1)'`.
  - Red when: the hook does not add the field.
  - Red run (R5, today on the real `_unscoped` log): `has duration_ms: false`.
- [ ] A `verify run` on a one-command planted project has an integer `commands[0].duration_ms` and an object `duration_ms`.
  - Red when: `runCommand` does not time the spawn.
  - Red run (R6, today, planted project in the scratchpad): `duration=[null,null]`.
- [ ] `git diff --numstat origin/main...HEAD -- _test-fixtures/a1-pr-merge-check _test-fixtures/a1-verify` deleted sum = 0, and `git diff --name-only origin/main...HEAD -- _test-fixtures/a1-xprov` is empty.
  - Red when: any line is deleted in those suites, or any a1-xprov file changes.
  - Red run (R7, range `2ac1a49~2..2ac1a49~1` on a1-xprov + a1-pr-merge-check): deleted = 5 (red form works). Green form on the current branch: 0.
- [ ] `wc -l < _shared/a1-tools.cjs` is at most 800 (and the same for every touched lib module).
  - Red when: the facade grows past the cap.
  - Red run (R8, an 801-line stub in the scratchpad): test exit 1.
- [ ] `a1-xprov` SC9 stays inside its `< 600` stderr bound with the registered row.
  - Red when: the hook notice pushes a SC9 case to 600 chars or more.
  - Red run (R9, measured 2026-11-12 on a `git archive` copy with the row inserted, cwd an empty non-git dir): 10 SC9 `--base` cases print 163-243 chars with the row, 81-161 without; shard b on that copy: `a1-xprov: 1608 passed, 0 failed`, rc 0, the SC9 lines print `stderr stays bounded (163..243 chars)`. Green expected; no red form exists without editing the fixture, so this line is a measured margin (357 chars), not a red run.
- [ ] The quiet-host probe of Wave 8 detects an active verify run and does not match itself.
  - Red when: another `node … a1-tools.cjs verify run|pr merge-check` process runs.
  - Red run (R9b, today): a planted `node -e … a1-tools.cjs verify run` process was listed; the pgrep call's own shell was not listed; a real `pr merge-check --pr 16` of another session on this host was listed (so the host was busy at that moment).
- [ ] The 05-merge.md `run record` block skips the caller-phase call without a phase.
  - Red when: the block runs `run record --scope <phase_name>` with the placeholder.
  - Red run (R10, today, the guard snippet): `<phase_name>`, empty and `none` print SKIP, `027-lean-pipeline-s1` runs. The unguarded block of the previous plan revision would have run with the placeholder.
- [ ] `BASELINE.json` exists at `.a1/phases/027-lean-pipeline/`, is committed on the feature branch and carries `host_load` for both runs.
  - Red when: Wave 8 did not run, `--baseline` refused or the host context is missing.
  - Red run: `eyeball` of `git show --stat` (the file does not exist today: `ls .a1/phases/027-lean-pipeline/` shows only `gate-log.jsonl`).
- [ ] `bash bin/run-suites.sh` is green apart from the two known aiserver environment reds, which must be equally red on `main` in a clean a1-worktree.
  - Red when: any other suite fails.
  - Red run: the 19 RED-proof mutations of Tasks 1.1, 2.1, 3.1-3.3 and 6.1, each applied once on a scratch copy and logged in STATUS.md (Task 7.1 action 9), plus the in-suite W14c-red and W14n.

Post-merge checks (spec SCs that need the next feature run, reported by a1-progress, not by this PR):
- Spec SC-001: `metrics phase-time --scope <next feature scope> --json` → `no_duration` = 0 for records written after this merge.
- Spec SC-007, split by gate kind:
  - Deterministic ids (`fix-integrity`, `scope-claim`, `test-fidelity`, `fix-class-sweep`, `pr-merge-check`, `pr-security-surface`): `gates lint` is green on `main` after the merge, and each id that the next run's path invokes has at least one row in `metrics phase-time --json` for that run's scopes. This is what this PR makes measurable.
  - Prompt ids `pr-reinhard`, `phase-6-verify`, `plan-audit`, `gate-c-ac-dryrun`: they write no gate-log record (`invoke = none`). Evidence is the retro `gates_fired` entry and the agent spawn of the first feature run; a gate-log row is not measurable until FR-019 (slice 4).
  - `plan-review-xprov`, `design-review-xprov`: `n/a (repo denied external review, 2026-11-11)`.

## Review and merge (merge dependency)
- Review path in this repo: `a1-specforge:a1-samuel-security` plus `a1-specforge:a1-reinhard-reviewer` only. `.a1/xprov.json` is `external_review: denied` (owner, 2026-11-11): no Codex review of the plan or of the ADR edit runs, and nobody asks for or waives a permit.
- `a1-specforge:a1-samuel-security` reviews the full PR diff **before merge. This is a hard merge dependency** (spec Dependencies: slices 1-3). Brief points:
  1. The gate-log record contract: D1 allowlist, core keys never overridable, setter no-op outside the hook and reset after write, shape validation of new keys.
  2. The new vault write path `_runs/<project>.jsonl`: containment, symlink refusal, tmp+rename, idempotence, no write on exit 1.
  3. The `BASELINE.json` writer (containment, `--force`, host-context validation, no hostname in the file).
  4. `xprov scope` now writes a gate-log line, inside the worktree via `cd`, with the exit contract unchanged.
  5. `verify-run.cjs` timing: no change to `noCache`, snapshots, `NEVER_PRE_EXISTING` or settle.
  6. `pr-merge-check.cjs`: only the slug move and the in-process hand-off.
  7. Hostile-input cases RR8, PT7 and PT10.
  8. The 05-merge.md `case` guard: an unreplaced placeholder never reaches `run record`.
- `a1-specforge:a1-reinhard-reviewer` reviews the full diff once (via a1-pr-review).
- Every BLOCKER and MAJOR of both is fixed before `pr merge-check`.
- If a fix round changes code after Wave 8, `BASELINE.json` keeps its measured sha and `base_sha`. Do not re-record unless `verify-run.cjs` timing code changed.
- After the merge (orchestrator, not Erik): the primary checkout still holds the uncommitted copies of the carried-over `docs/product/*` files and the untracked phase/feature folders. Before `git pull` there, check `git diff --quiet origin/main -- <each carried path>` after the fetch; only when equal, discard the local copies (`git checkout -- <modified paths>` and remove the untracked copies) and pull. A difference is reported, never overwritten. Also remove the untracked artifact `.a1/phases/027-lean-pipeline-s1/xreview/` (written by a1-execute Step 0c, `load-check.last-run.json`, not git-ignored and not carried into the PR) from the primary checkout after the pull.

## Revision Notes
Revision 1 (2026-11-12), answering AUDIT.md (verdict FAIL, B1-B2, M1-M4, m1-m7):
- **B1** (Codex claims): removed the Codex line from Depth Pass answer 4; Task 5.2 Goal now states the denial and the Reinhard/Samuel path; "Review and merge" names Samuel plus Reinhard as the only review path and forbids asking for or waiving a permit. Added D11.
- **B2** (baseline host control): Task 8.1 uses the anchored `pgrep` plus load5 block of 05-merge.md 5.3 in `$R/quiet.sh`, with up to 15 one-minute re-checks before each run and one check right after each run, one repeat of a busy run, and the shared-host risk named in STATUS. Task 3.3 gains `--host-context` (strict schema, PT8/PT10 cases) and writes a `host_load` object per run plus `cpus`. Probe red/green measured (R9b).
- **M1** (paths): new section "Execution location"; every probe is repo-relative with cwd = worktree root (Tasks 1.2, 1.3, 3.3, 8.1 use `./_shared/...` or `$(git rev-parse --show-toplevel)`); Task 1.1 action 7 keeps the one absolute read of the gitignored real log and says why; Task 7.1 and 8.1 check the branch is not `main`. Task 7.1 now carries the uncommitted spec-027 `docs/product/*` files and the phase artifacts into the PR (read-only on the primary checkout, STOP on difference).
- **M2** (SC-007): the post-merge check is split into deterministic ids (phase-time rows), 4 prompt ids (retro evidence; gate-log not measurable until FR-019) and the 2 xprov ids (`n/a`). The SC trailer says exactly which part becomes measurable.
- **M3** (a1-xprov licence): measured SC9 now with the row inserted (max 243 chars vs bound 600) and ran shard b on that copy; the licence is replaced by "any a1-xprov red is a STOP". `_test-fixtures/a1-xprov/**` is removed from lane gates' `owns`, and Wave 7 plus SC-9 assert no a1-xprov file changes.
- **M4** (unconditional second call): the 05-merge.md block sets `PHASE="<phase_name>"` and a `case` skips empty, `none` and unreplaced placeholders (R10); still one block, so count 6 and order `DCMGRP` hold. Added the RR-guard case to `a1-pr-review/run-tests.sh` (add only).
- **m1**: commit/PR/`node -e` rule for the step name added to "Execution location" and Task 6.1. **m2**: "line count does not grow" replaced by "777 to 778". **m3**: Wave 7 compares reds against `main` in a clean a1-worktree, not a `git archive` snapshot. **m4**: `BASELINE.json` gets `base_sha` (explicit merge base `$MB`, reachable after the squash merge), `host_label` instead of `os.hostname()`, `--base "$MB"`, and the command count is defined as the `verify run` resolution (glob + 1). **m5**: CI step matching is a string comparison of the trimmed value (W14k3, RED-proof for a regex build). **m6**: new "RED-proof rule" — each mutation is applied once on a scratch copy and logged (19 lines, counted in Task 7.1). **m7**: `a1-retro-validate` and `a1-depth-pass` added to Task 4.1 action 6.
- Lanes kept (measure, verify, gates); the gates lane lost `_test-fixtures/a1-xprov/**`. `lane-split check` re-run after this revision.

Revision 2 (2026-11-12), post-PASS fix of the round-2 MINORs only (no re-audit):
- **n1**: RED-proof rule holds the scratch dir in `S` and commits with `-c user.name=t -c user.email=t@t -c commit.gpgsign=false`; new fixture-repo rule, referenced from GF1, VD2, RR9, PT3, W14c, W14l.
- **n2**: Task 7.1 action 8 uses `--base "$(git merge-base origin/main HEAD)"` and asserts exit 0 and verdict `pass`.
- **n3**: Waves 7 and 8 commit STATUS.md in a separate final `docs(027): …` commit; the Wave 8 Done-when checks the commit that adds `BASELINE.json`, not HEAD.
- **n4**: "33 occurrences in 3 committed STATUS files".
- **n5**: Done-whens of Tasks 2.1, 3.1 and 4.1 diff against `$(git merge-base origin/main HEAD)`.
- **n6**: post-merge clean-up removes the untracked `xreview/` folder of this phase in the primary checkout.
