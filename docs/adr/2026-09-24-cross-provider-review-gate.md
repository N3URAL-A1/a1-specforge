# ADR: Cross-provider review gate — Codex as a read-only plan and wave reviewer

**Date:** 2026-09-24 · **Status:** accepted; §6 Live smoke recorded 2026-10-03, gates `blocking` · **Context:** On 2026-09-03 Robert decided (vault `record/2026-09-03-ai-harness-option-d.md`) that OpenAI Codex sits in the a1 pipeline as a read-only counter-reviewer: mandatory on `PLAN.md` after Adam's audit, mandatory on every wave diff before Victor. The architecture analysis of 2026-09-24 (`analyses/2026-09-24-architecture.md`) measured that nothing of this existed in the repo — no registry row, no adapter, no attribution slot (F-016, F-017, F-018) — and that the reviewer was not actually read-only: the global `~/.codex/config.toml` enables the `node_repl` MCP server and the claudex-loop runner forces `approval_policy="never"` per call, so a prompt-injected reviewer had an unattended code-execution path with the user's privileges (F-049, BLOCKER; plus F-050, F-051, F-052, F-057). F-049 was mitigated the same day outside the repo (`record/2026-09-24-codex-review-home-gehaertet.md`). Spec `009-cross-provider-review-gate` turns the decision into two gates and an adapter; this ADR records the architectural decisions the spec fixed in its Clarifications of 2026-09-24. It is not itself evidence of integration: the gate exists exactly to the extent that the registry rows `plan-review-xprov` and `wave-inspect-xprov` in `_shared/gates-registry.md` say so — both `blocking` since the Wave 7 flip (FR-005, §6).

## Decision

### 1. Runner-only use
a1 uses the claudex-loop `runner.py` in modes `review`, `inspect` and `check` and nothing else of the plugin. `a1-tools xprov run` invokes it with a fixed argv (`--host claude --repo <snapshot> --plan <absolute PLAN.md> --artifacts <0700 dir> --timeout <s>`, plus `--base` for inspect, `--feedback` for a plan-review round ≥ 2 — never `--resume`, see §6 *Round 2*); no extra flags, never the runner's default root `PLAN.md`; a1 writes `PLAN-REVIEW-LOG.md` itself because the runner has no `--log` (FR-011). Findings are data: validated, rendered as a table, never auto-applied; any change goes through a1-fix or a1-new-feature with a user checkpoint (FR-019, closes F-051).

**No `--model`.** The runner uses the CLI default; pinned variants return HTTP 400 with the ChatGPT login and invariant 6 forbids model ids in skills. The record carries `model_requested: "CLI default (unresolved)"`.

**Model honesty (FR-013).** Every XREVIEW.md section and `index.json` entry records `model_requested` (the passed value or the literal above) and `model_observed` (only from a measured field of the runner record or a captured CLI event stream, otherwise the literal `unknown`). `model_observed` is never copied from `model_requested`. Runner 2.1.0 reports `observed_models: []` for Codex, so it stays `unknown` until a captured fixture shows a field; the parser follows the fixture, never precedes it (testing rule, class 3). No fallback model or provider on failure.

**Closes F-019.** claudex-loop's ADR-FORMAT writes `docs/adr/0001-<slug>.md`; a1 writes `docs/adr/YYYY-MM-DD-<slug>.md`. a1 never invokes the claudex-loop SKILL.md orchestration (Phase 0–3, ADR-FORMAT, CONTEXT-FORMAT) inside an a1 project (FR-024), so no second numbering scheme can arise. a1's convention stands; this directory is its single owner.

### 2. Dedicated CODEX_HOME
`xprov run` sets `CODEX_HOME` for the runner process to `codexHome()`: the value of `A1_XPROV_CODEX_HOME`, or `~/.codex-a1-review` when the variable is unset or empty (`_shared/lib/xprov.cjs`). `xprov init-home` writes the compliant `config.toml` — `sandbox_mode = "read-only"`, `approval_policy = "on-request"`, `cli_auth_credentials_store = "file"` (Wave 7), and `[features]` with `plugins = false` / `remote_plugin = false` plus (Wave 7) six more pins, `apps`, `browser_use`, `computer_use`, `hooks`, `skill_mcp_dependency_install` and `memories`, all `false` — and links `auth.json` (0600) to `~/.codex/auth.json`, so one login exists to rotate. The `[features]` switch is the measured control, not a guess: during the fixture capture runs on 2026-09-24 Codex installed two remote plugins on its own into `plugins/cache/openai-curated-remote/` although the config had no `[plugins.*]` table; `codex features disable plugins remote_plugin` (codex-cli 0.155.1) writes exactly that table and stops the auto-install (`_shared/lib/xprov-preflight.cjs` header).

`xprov preflight` runs 22 checks, reports all of them and exits 1 on any FAIL, before any runner call (FR-014): `codex_home_is_global` (realpath comparison with `~/.codex`, never a string compare), `home_exists`, `config_exists`, `config_is_symlink` (must be a regular file), `home_mode_0700`, `sandbox_read_only`, `auth_store_file` (Wave 7: `cli_auth_credentials_store = "file"`, so the credentials stay in the auth.json symlink, never in a keyring), `mcp_servers_absent`, `plugins_disabled`, `remote_plugin_switch`, `features_pinned_off` (Wave 7: `apps`, `browser_use`, `computer_use`, `hooks`, `skill_mcp_dependency_install`, `memories` all `false`), `unexpected_config_key`, `plugins_cache_empty` (including the remote-install staging dir; a symlinked entry counts), `skills_system_only` (Wave 7: `skills/` holds only `.system` — `skills/<x>` is a user skill root), `skills_real_dirs` (Wave 7: `skills/` and `skills/.system` are real directories of the caller, checked with `lstat`, never a symlink), `home_no_symlinks` (Wave 7: an lstat walk over every directory of the home, runtime dirs included; the only accepted links are the top-level `auth.json` and Codex's own shims `tmp/arg0/codex-arg0<random>/…` whose realpath is the codex binary — measured: the native `vendor/<triple>/bin/codex` of the npm package), `session_tools_exec_only` (newest session log; only `exec`/`shell`/`local_shell` may appear), `etc_codex_absent` (Wave 7: no `/etc/codex/{config,requirements}.toml`), `auth_present` (exit reason `not_logged_in`), `runner_pin`, `python_version`, `codex_cli`. The config is checked against an allowlist, not a denylist: tables `''` and `features`, keys `sandbox_mode`, `approval_policy`, `model`, `model_reasoning_effort`, `cli_auth_credentials_store`, and the eight `features.*` pins (`plugins`, `remote_plugin` and the six above); anything else, including inline or dotted `mcp_servers` shapes, fails. `init-home --pin-features` adds missing pins to an existing home, additively.

**Built-in skills reset (Wave 7, Samuel m7).** `skills/.system` is a skill root Codex trusts as long as its marker file survives. Measured on a copy of the home with the network blocked (`codex debug prompt-input` only, the real home byte-identical by manifest): a canary skill planted next to an intact marker was loaded (m1); with `skills/.system` deleted (m2) or only its marker deleted (m3) Codex re-extracted the built-ins, identical by path, size and sha256, and the canary was gone. So `xprov run` deletes `skills/.system` right before every spawn, after refusing with `fail/preflight_failed` when the home holds a symlink or `skills` / `skills/.system` is not a real own directory.

**Tripwire (FR-015).** Read-only is verified, not trusted. Before the spawn `xprov run` writes a baseline into a `mktemp` file: `git status --porcelain --untracked-files=all` of the primary checkout, `$WORK_PATH` and the snapshot; the `.git` metadata a hostile reviewer could plant — `config`, `hooks/*`, `info/*` from the common git dir, and the `core.hooksPath` target — for checkout and `$WORK_PATH`; and every file of the dedicated home except Codex's runtime dirs and files (`sessions/`, `cache/`, `plugins/`, `*.sqlite`, `history.jsonl`, …), because a planted `AGENTS.md` there would be a persistent prompt injection for every future review. Under `skills/` only `.system` counts as runtime; anything else there is hashed. The runner's child environment is an allowlist (`PATH`, `TMPDIR`, `LANG`, `LC_*`, `TERM`, `USER`, `SHELL`) plus `CODEX_HOME` and `GIT_CONFIG_NOSYSTEM=1`. `HOME` is never the caller's: it is a fresh per-run directory `~/.a1-xprov/run-home-*` (0700, verified empty before the spawn, removed after the run); what the run left there is listed by name and size as an XREVIEW note. Any delta after the run is `fail/tripwire`: result discarded, snapshot delta reverted, BLOCKER note in XREVIEW.md, checkout and worktree untouched (closes F-049 and the read-only half of F-018). Evidence bar as in the vault record: the home's session log shows `exec` as the only tool and `codex mcp list` prints no servers.

### 3. Snapshot, not checkout
The runner never sees the live checkout. `xprov snapshot` builds the review target as a fresh, depth-limited repository in `mktemp -d` under the 0700 parent `~/.a1-xprov/snapshots/`: `git init` + `git fetch --depth 1 <source checkout> <commit>` + `git checkout FETCH_HEAD`, argv arrays, never a shell. A plan review fetches HEAD only; an inspect additionally fetches `<base>` with `--depth 1` (Wave 7, replacing the earlier `rev-list --count <base>..<commit>` + 1), so the runner's `--base` diff resolves inside the snapshot while no commit between base and head — and no secret from an earlier commit — is in its object store. Only tracked files exist in the clone — no untracked or ignored file, no worktree gitdir, no alternates — and it is removed after `normalize`; never a worktree, shared-object clone or directory copy (FR-016, hardened 2026-09-24). After checkout the repo-local Codex inputs `.codex/` (including hooks), `AGENTS.md`, `AGENTS.override.md` and (Wave 7) `.agents/` are removed from the snapshot's working tree and their presence is logged in XREVIEW.md, because Codex reads `AGENTS.md` from its cwd as instructions and the reviewed repo must not steer its own reviewer. Before dispatch every `git ls-files` entry is scanned with the shared secret-pattern list, nothing skipped: latin1 decoding for binary or NUL content, 5 MB windows with a 512-byte overlap, UTF-16LE/BE decoding on a BOM or alternating NULs, symlinks by their link text; a tracked path missing from the working tree (a stripped file) is scanned as its `HEAD:<path>` blob, because the reviewer can still read it from the object store; `files_skipped` must be 0. Wave 7 extends the scan to everything that leaves (see §6 and the `xprov-snapshot.cjs` header): the base-side blobs of every path the outbound diff touches, the PLAN.md and dispositions copies the runner receives, every outbound path name (never allowlisted, never echoed), plus a diff hash compared with the runner's `snapshot.diff_sha256`. `gitleaks detect --no-git` runs additionally when on PATH, with a1's own config, never the reviewed repo's. Any hit removes the snapshot and reports `fail/secret_in_snapshot` with the pattern name only (FR-017); runner output is filtered with the same list (`fail/secret_in_output`, no findings file, FR-018). Sending a repo to OpenAI needs a recorded permission via `xprov permit`: N3URAL repos by Robert, customer repos only with an a1-ludwig-legal record (FR-021, closes F-050). Artifacts live in a 0700 directory, `xprov gc` deletes runs older than 14 days, nothing is committed or synced to the vault (F-057).

### 4. Fail-closed mapping
The mapping is total and only one path yields `pass`: `status != "completed"` → `fail/runner_failed`; missing, empty or non-object file → `fail/malformed`; `mode` ∉ {`review`, `inspect`} → `fail/wrong_mode`; `APPROVED` → `pass`; `REVISE` → `fail-with-findings`; `BLOCKED` → `fail/blocked` (limitations verbatim); anything else → `fail/malformed` (FR-009). `pass` also requires the PLAN.md sha to equal `result.json.plan_sha256` (FR-010), a clean output filter and validated finding paths. Findings land in the Reinhard schema `{summary, blocker[], major[], minor[]}` (FR-008, FR-012; closes F-017). Provider outage is a `fail` that stops at the checkpoint — no retry beyond the runner timeout, no fallback. Caps: 2 plan-review rounds, 2 fix rounds per wave; a cap is a `fail`. The only way past a `fail` is a human `xprov waive --reason`, which never yields `verdict: pass` and tags the retro `xprov_waived` (FR-006, FR-007). Attribution: `xprov-codex` is the single allowed non-`a1-*` agent id (exception to invariant 5, owner `_shared/learning-schema.md`); retros carry `gates_fired` with the two registry ids so a1-evolve counts catches instead of discarding them (FR-025, FR-026).

### 5. Vendoring decision
`runner.py` is vendored at `_shared/vendor/claudex-loop/` with the MIT `LICENSE`, `VENDORED.md` (upstream, version 2.1.0, commit `8cf5e2c1771c5151d90c12642391d0ba8fa71b0e`, sha256, capture date, F-052 audit: stdlib only, no network, argv arrays, prompt via stdin) and a `SHA256SUMS` pin checked by `xprov preflight` and the fixture suite (FR-022, FR-023). a1 never resolves the runner from the plugin cache; a pin bump needs a `VENDORED.md` entry with the upstream diff summary in the same commit. Rejected: a fork into the N3URAL-A1 org — one file with a hash is cheaper than a second marketplace and equally removes the unreviewed-`plugin update` path (decided 2026-09-24).

### 6. Live smoke
Measured 2026-10-02 and 2026-10-03 on branch `feature/009-wave7-live-smoke` of this repository (base `2741abe`), codex-cli 0.155.1, vendored runner 2.1.0 (sha256 `962dfdfe…737c8c`), dedicated home `~/.codex-a1-review`, permission record `.a1/xprov.json` (Robert, record option D). Every run used `env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST -u A1_HOST_ID`. The final runs below are on HEAD `4abccf3` (the last code commit of the branch; the ADR commits after it are docs only); raw outputs are quoted in full under *Raw evidence* (only `$HOME` is shortened to `~`).

**Targets.** Spec 009 has no `PLAN.md` under `.a1/phases/` (its plan lives in the vault), and `xprov gate --phase X` resolves `<git toplevel>/.a1/phases/X/PLAN.md` — so the review runs on the real, committed phase `M13-residuals`. The inspect runs on a real wave of this repository that is NOT on `origin/main`: a wave already on the default branch is never allowlisted for wave-inspect (FR-030 b, `xprov-allowlist.cjs` resolveAnchor), so the target is Wave 7 itself, `2741abe..HEAD` of this branch.

**Preflight (SC-003), 2026-10-03 on `ae6c281`, re-run on `4abccf3`: 22/22 PASS.**
- `a1-tools xprov preflight` → exit 0, 22/22 PASS (including `features_pinned_off`, `auth_store_file`, `skills_system_only`, `skills_real_dirs`, `home_no_symlinks`, `etc_codex_absent`, `session_tools_exec_only: exec`).
- `A1_XPROV_CODEX_HOME=~/.codex a1-tools xprov preflight` → exit 1, `failed`: codex_home_is_global, auth_store_file, mcp_servers_absent (`table [mcp_servers.node_repl], table [mcp_servers.node_repl.env], table [mcp_servers.computer-use]`), plugins_disabled (9 enabled plugins), remote_plugin_switch, features_pinned_off, unexpected_config_key, plugins_cache_empty.

**Live review round 1 — final, HEAD `4abccf3`.** Command:
`a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov`
- 14:37:30Z–14:39:04Z, exit 1. stdout (full JSON below): `verdict: fail-with-findings`, `step: normalize`, `enforcement: blocking`, `allowlisted_hits: 21`, `uncovered: []`, `next.round_cmd` = the plain `--round 2` call.
- `result.json`: `status: completed`, `mode: review`, `plan_sha256: 903b53b7…` (= the phase's PLAN.md), `previous: null`. Three M13 findings (R1 high, R2 and R3 medium, all `_shared/lib/checklist.cjs`; this time Codex wrote `<file>: <symbol>` with the space, so the measured split applied), R4 quarantined `instruction_shaped`. normalize also wrote them to `a1-findings.json` in a1's run dir.
- Session log (`rollout-2026-10-03T16-37-33-01a10232-…jsonl`): `custom_tool_call:exec` ×5, no other tool; `grep -c '"mcp'` → 0; skill roots `r0 = ~/.codex-a1-review/skills/.system` only. Run-home manifest `entries: 0`.

**Round 2 — a fresh session, never a resume (Samuel, Wave 7 MAJOR).** `codex exec resume <session>` replays round 1 from the dedicated home's `sessions/…/rollout-*.jsonl` and/or `thread_history_1.sqlite` (a1-samuel-security's analysis) — runtime files that neither the tripwire nor the preflight covers, so an agent with Bash could plant developer or assistant items between the rounds and, under `blocking`, decide round 2. Since `4abccf3` no round resumes (`--resume` is refused by `gate` and `run` and is a forbidden runner token). Round N ≥ 2 after a REVISE gets `--feedback` that a1 builds itself: round N−1's findings from a1's own 0700 run dir (`a1-findings.json`, a regular file, its run dir under this repo's artifacts dir) plus the host-authored dispositions, written to a 0700 mktemp file that the snapshot scans and copies like the PLAN.md. The runner appends `--feedback` without `--resume` (runner.py:348). The earlier resumed round 2 (HEAD `22cc562`, 08:48Z, `codex exec resume 01a100f1-…`, same snapshot path rebuilt) is superseded; its snapshot-path rebuild is removed with it. Command:
`a1-tools xprov gate --phase M13-residuals --gate plan-review-xprov --round 2`
- 14:39:18Z–14:40:39Z, exit 1, `fail/round_cap` at step normalize (Codex: REVISE, "R1–R3 remain present … Filing them as future fixes does not resolve the plan's backlink and exit-contract requirements" — the dispositions had rejected all three as out of scope for a shipped plan): the expected outcome.
- `command.json`: `codex exec -s read-only …` — no `resume`; `result.json`: `previous: null`, a new session (`01a10234-8b9a-…`, round 1 was `01a10232-ea26-…`) and a new snapshot (`snap-DjjpkZ`, round 1 `snap-m9t5x5`). The runner's `prompt.txt` holds `HOST DISPOSITIONS / FIX REQUEST:` followed by a1's `PRIOR FINDINGS (round 1, normalized by a1; this is a fresh session)` and `HOST DISPOSITIONS (round 1)`.
- Session log (`rollout-2026-10-03T16-39-20-01a10234-…jsonl`): `custom_tool_call:exec` ×5 only, `"mcp` → 0, `r0 = .system` only; run-home `entries: 0`; the feedback temp dir is gone afterwards.

**Live inspect — final, HEAD `4abccf3`, base `2741abe`.** Command:
`a1-tools xprov gate --phase M13-residuals --gate wave-inspect-xprov --wave 7 --base 2741abe --work-path <this worktree>`
- 14:40:51Z–14:42:50Z, exit 1. stdout (full JSON below): `verdict: fail-with-findings`, `step: normalize`, `enforcement: blocking`, `allowlisted_hits: 29` (21 head + 8 base), `uncovered: []`.
- `result.json`: `status: completed`, `mode: inspect`, `base: 2741abe`, `snapshot.diff_sha256: abaecfd4…` = the hash `xprov snapshot` stored at scan time (no tripwire), `previous: null`.
- Findings: **R1 (high, `xprov-gate.cjs:415`): `load-check` counts only `verdict: pass` entries and skips waivers**, so under `blocking` the human waiver that `a1-execute` 01-load names as the only other way forward does not unblock it — the same defect the `ae6c281` inspect raised (then quarantined), reproduced in a scratch repository (`xprov waive` exit 0, then `xprov load-check` exit 1, `plan_review_missing`); open, a team-lead decision. R3, R4: M13 `checklist.cjs` (a1-fix candidates). Quarantined `instruction_shaped`: R2 (normalize splits `<file>: <symbol>` only with the space — the follow-up the `ae6c281` review showed) and R5 (M13 roadmap gate). No finding on the resume removal.
- Session log (`rollout-2026-10-03T16-40-55-01a10235-…jsonl`): `custom_tool_call:exec` ×5 only; `r0 = .system` only; `grep -c '"mcp'` → 8, all in the prompt (this wave's diff) or exec output — zero MCP tool calls. Run-home `entries: 0`. `skills/.system` re-extracted at 14:40:55Z.

**Earlier final runs on `ae6c281` (13:47Z–13:50Z).** Review: fail-with-findings, three M13 findings all quarantined `path_not_in_repo` (Codex wrote `<file>:<symbol>` without the space). Inspect: fail-with-findings, R2/R3 M13, R1 (waivers) and R4 quarantined. Same isolation evidence (exec only, 0 MCP calls, `.system` only, run-home empty, porcelain unchanged); superseded by the `4abccf3` runs above.

**Usage limit, 2026-10-03 11:13Z — observed fail-closed.** The first final inspect (HEAD `e07cb01`) hit the ChatGPT Codex quota. The event stream held one `{"type":"error","message":"You’ve hit your usage limit. …"}` event; runner 2.1.0 recorded `status: failed` and exited 1 with an empty stderr; the gate exited 1 with `fail/runner_failed` and wrote no findings — no retry, no fallback model or provider (§4). The reason was only in the run dir; since `ae6c281` `reason_detail` carries it (`runner exited 1: You’ve hit your usage limit…`, display-filtered, capped at 300 chars; fixture `cases/usage-limit.*`, captured from that run).

**Raw evidence — final runs on `4abccf3`.** `git status --porcelain --untracked-files=all`, taken by the caller around each gate call. Primary checkout (`~/claude-projects/a1-specforge`, `main`): empty before and after all three runs. `~/.a1-xprov/snapshots/`: the same single pre-existing entry before and after (`snap-jZtQHt`, 2026-10-02, not from these runs). This worktree (the gate's checkout and `$WORK_PATH`, so `run_porcelain.work` is `null`):

- review round 1, before:
```
(empty)
```
- review round 1, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
```
- review round 2, before (the dispositions file is the host's own write between the rounds):
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
```
- review round 2, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json
```
- inspect, before:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json
```
- inspect, after:
```
 M .a1/phases/M13-residuals/observations.jsonl
?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md
?? .a1/phases/M13-residuals/XREVIEW.md
?? .a1/phases/M13-residuals/xreview/index.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json
?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json
?? .a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json
```

The only delta is a1's own writes in `.a1/phases/M13-residuals/` (XREVIEW.md, PLAN-REVIEW-LOG.md, `xreview/*.json`, one observations.jsonl line per run). The snapshot's porcelain is in `run_porcelain.snapshot` below: empty before and after for every run.

**SC-007 (file list under `.a1/phases/M13-residuals/`).** Before round 1: `PLAN.md`, `STATUS.md`, `VERIFICATION.md`, `observations.jsonl`. After the three runs, additionally: `PLAN-REVIEW-LOG.md`, `XREVIEW.md`, `xreview/index.json`, `xreview/plan-review-xprov-plan-r1.findings.json`, `xreview/plan-review-xprov-plan-r1.dispositions.md` (host-authored), `xreview/plan-review-xprov-plan-r2.findings.json`, `xreview/wave-inspect-xprov-wave-7-r1.findings.json`. None of these files holds a diff (`grep -c '^diff --git\|^@@ '` → 0 each) or a transcript (no `response_item`, `custom_tool_call`, `thread_id` or `"type":"turn` in any of them); the session logs and the a1-built feedback stay outside the repo.

stdout of review round 1:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 1,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-s75o0v4x/result.json",
  "next": {
    "round_cmd": "node ~/claude-projects/a1-worktrees/009-wave7-live-smoke/_shared/a1-tools.cjs xprov gate --phase M13-residuals --gate plan-review-xprov --round 2",
    "dispositions_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md"
  },
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": "?? .a1/phases/M13-residuals/XREVIEW.md\n",
      "after": "?? .a1/phases/M13-residuals/XREVIEW.md\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of review round 2:
```json
{
  "verdict": "fail",
  "reason": "round_cap",
  "reason_detail": "REVISE at round 2 = cap",
  "step": "normalize",
  "gate": "plan-review-xprov",
  "phase": "M13-residuals",
  "wave": null,
  "lane": null,
  "round": 2,
  "mode": "review",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-undsp_h4/result.json",
  "next": null,
  "allowlisted_hits": 21,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

stdout of the inspect:
```json
{
  "verdict": "fail-with-findings",
  "reason": null,
  "reason_detail": null,
  "step": "normalize",
  "gate": "wave-inspect-xprov",
  "phase": "M13-residuals",
  "wave": 7,
  "lane": null,
  "round": 1,
  "mode": "inspect",
  "enforcement": "blocking",
  "findings_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/xreview/wave-inspect-xprov-wave-7-r1.findings.json",
  "xreview_path": "~/claude-projects/a1-worktrees/009-wave7-live-smoke/.a1/phases/M13-residuals/XREVIEW.md",
  "result_path": "~/.a1-xprov/artifacts/009-wave7-live-smoke/claudex-voumqw7f/result.json",
  "next": {
    "fix_round": 1
  },
  "allowlisted_hits": 29,
  "allowlist_anchor": "2741abe4c7d5a26e2f9d7c359e1ca55495f633d6",
  "allowlist_approved_blob": "d21e526d3448512f59c3593c4b6df8186c8bcd46963708094e7008599d762479",
  "allowlist_stale": [],
  "allowlisted": [
    {"path": ".a1/phases/M7-oss-ready/MAP.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M7-oss-ready/RESEARCH.md", "pattern": "secret_assignment", "count": 1, "class": "doc_example"},
    {"path": ".a1/phases/M9-robustness/RESEARCH.md", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "doc_example"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern"},
    {"path": "_test-fixtures/a1-vault-cockpit/parts/05-hosts.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/02-normalize.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "sk_prefixed_key_ext", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "github_pat_fine_grained", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/03-hardening.sh", "pattern": "bearer_token", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake"},
    {"path": "_shared/lib/xprov.cjs", "pattern": "pem_begin", "count": 2, "class": "code_pattern", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "slack_token_family", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "url_credentials", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/01-supply-chain.sh", "pattern": "password_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/05-run.sh", "pattern": "secret_assignment", "count": 1, "class": "fixture_fake", "side": "base"},
    {"path": "_test-fixtures/a1-xprov/parts/06-gate.sh", "pattern": "aws_access_key_id", "count": 1, "class": "fixture_fake", "side": "base"}
  ],
  "uncovered": [],
  "allowlist_note": null,
  "run_porcelain": {
    "checkout": {
      "before": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json\n",
      "after": " M .a1/phases/M13-residuals/observations.jsonl\n?? .a1/phases/M13-residuals/PLAN-REVIEW-LOG.md\n?? .a1/phases/M13-residuals/XREVIEW.md\n?? .a1/phases/M13-residuals/xreview/index.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.dispositions.md\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r1.findings.json\n?? .a1/phases/M13-residuals/xreview/plan-review-xprov-plan-r2.findings.json\n"
    },
    "snapshot": {
      "before": "",
      "after": ""
    },
    "work": {
      "before": null,
      "after": null
    }
  }
}
```

**Quarantine, live.** Findings whose evidence quotes an instruction marker are quarantined, not dropped: final review R4, final inspect R2 and R5 (see above), the `ae6c281` inspect's R1 and R4 and, earlier, R2 (`xprov-normalize.cjs`, quoting "ignore previous") and R6 are listed in XREVIEW.md under `### Quarantined` with reason `instruction_shaped`.

**SC-009 (snapshot allowlist), measured on `main`.** On `2741abe`: `a1-tools xprov snapshot --repo . --commit HEAD` → `ok: true`, `files_skipped: 0`, `allowlisted_hits: 21`, `allowlist_anchor: ed5d5fa`, `approved_blob: d21e526d…2479`, `stale: []`. Counter-tests: a dangling commit with one runtime-built AKIA fake → `secret_in_snapshot`, only that file uncovered; a fresh clone (another repo path, not approved) → `allowlist_invalid`. Re-measured on this branch after every wave-7 commit, last on `4abccf3`: `ok: true`, `allowlisted_hits: 21`, `uncovered: []`, `stale: []`, `files_skipped: 0`, 575 files scanned. Note on the counter-tests: the spec's "remove one entry → fail" counter-test was not run as such; it is replaced by the two above (a runtime-built AKIA fake that no entry covers, and a fresh clone at another path that is not approved), which prove the same two properties: an uncovered match fails, and an allowlist is only valid where it was approved.

**Canary measurements (skill roots), 2026-10-02.** `codex debug prompt-input` contacts `chatgpt.com:443` (13 CONNECT attempts behind a logging proxy) and renders the same output under `sandbox-exec (deny network-outbound)`, so it was used ONLY under that network block, against a copy of the home (the real home stayed byte-identical by a 128-entry manifest). Measured: `$HOME/.agents/skills` is a skill root that follows `$HOME`; `.agents/skills` at the git root of the cwd is a root (nothing above it); `$CODEX_HOME/skills/<x>` is a user root next to `skills/.system`; `/etc/codex` is absent. Consequences in this wave: a fresh, empty per-run HOME (`~/.a1-xprov/run-home-*`), `.agents` stripped from the snapshot, only `skills/.system` is runtime.

**What the smokes changed.** The live runs found ten defects the fixtures could not see; each was fixed with an arm that was RED first (or proven by mutation) before this flip: skill roots outside the dedicated home (ccc23e7, 64cacad), finding paths written as `file: symbol` (ccc23e7), fixtures that would have broken on the flip (ccc23e7), the run-home note tripping the tripwire and unfiltered run-home names (64cacad, 9e3962a), outbound content not scanned — base side, PLAN.md, dispositions (6ebc943), the plan-review resume that could never run (f2525b7), `xprov run` accepting unscanned inputs (77d9ff9), unscanned path names (00413c7) and stripped files readable as HEAD blobs (0e9e5d5). a1-samuel-security re-verified `035af5e..00413c7`: PASS. After the flip, reviews of the branch added `ae6c281`: the `skills/.system` reset and the symlink refusal (a1-samuel-security m7, measured in §2) and the runner's own error in `reason_detail` (found by the 11:13Z usage-limit run above); then `4abccf3`: no Codex resume (a1-built feedback, Samuel's MAJOR), the narrowed symlink exemption, linked plugin entries, one-line `reason_detail` for every line breaker and bidi control, and the inverted instruction check (only exact fixed runner messages are exempt).

**SC-005, SC-006.** SC-006: a1-reinhard-reviewer ran `grep -ril 'integrated' docs/ skills/ _shared/` over the branch; no hit makes a claim about Codex or xprov. SC-005 (`retro validate` and `a1-evolve` collect listing both gate ids with one firing each) needs the retros of the first a1-plan and a1-execute runs after the flip; it is an open post-merge item, not measured here.

**Enforcement.** Commit `4970b6b` flipped `plan-review-xprov` and `wave-inspect-xprov` from `warning` to `blocking` (FR-005, SC-004). `_test-fixtures/a1-xprov/check-enforcement.sh` (CI step after Fixtures) refuses any tree where a row says `blocking` while this section is a placeholder or lacks either `xprov gate` command.

## Consequences
+ Robert's 2026-09-03 decision becomes two registered gates with deterministic exit semantics instead of a belief held in a vault note (invariant 7 applied to the framework itself).
+ The reviewer's blast radius is bounded four times over: tool-less home, tripwire, secret-free snapshot, findings-as-data. A prompt-injected reviewer can produce a bad verdict, but no write, no exfiltrated untracked file, no auto-applied fix.
+ Supply chain is a one-file audit with a hash, redone per pin bump; upstream releases cannot change what runs with Robert's credentials.
− Every plan and wave costs one or two Codex calls from the ChatGPT Plus quota, roughly 30 s each; a provider outage stops the pipeline until a human waives.
− `model_observed` is `unknown` for now, so gate-ROI by model is not measurable until a captured Codex event stream shows the field.
− The two rows sat at `warning` until the Wave 7 flip (2026-10-03, §6); since then a `fail` blocks the pipeline until a human waives it, and check-enforcement.sh keeps the flip tied to the recorded live evidence (invariant 8).

## Addendum 2026-09-28 — Snapshot secret-scan allowlist (Wave 6b, FR-030)
**Context:** the Wave 7 live smoke stopped at `secret_in_snapshot` on this repository itself: 21 pattern matches in 10 tracked files, none a real credential (fixture fakes, two doc examples, and the pattern list in `_shared/lib/xprov.cjs`, which must contain the PEM header prefix). Robert chose a committed, reviewed allowlist (option a).

**Decision.** The scan counts every match and fingerprints the whole line that holds it; a hit passes only when `.a1/xprov-secret-allowlist.json` covers its `(path, pattern)` with that line fingerprint and within `max_count`. Four layers, each fail-closed to "every hit fails":
1. *Trust anchor, not the reviewed tree.* The file is read with `git cat-file blob` at the merge-base of the reviewed commit with `refs/remotes/origin/<default_branch>` in the primary checkout, verified against `git ls-remote origin` (non-interactive, 30 s timeout, the whole process group killed on timeout). `origin/HEAD`, local branches, the snapshot and every working tree are never read. Plan review of a default-branch commit steps to its first parent; wave-inspect of default-branch history applies no allowlist.
2. *No self-approval in a branch.* A reviewed range that touches the file fails with `allowlist_modified` before dispatch; the anchor's last allowlist commit must touch nothing else.
3. *Line fingerprints.* Several patterns match only a prefix (`pem_begin`, `slack_token`, `private_key_header`); a fingerprint over the match would bind no value. Any edit on an allowlisted line needs a new entry.
4. *Human approval (Robert, 2026-09-28).* The sha256 of the anchor's allowlist blob must be in `~/.a1-xprov/allowlist-approvals.json` (checked with `lstat`/`O_NOFOLLOW`, 0600 file in a 0700 directory, current user). Only `a1-tools xprov allowlist approve` writes it, and only from a terminal that is not Claude Code: TTY on stdin and stdout, no `CLAUDECODE`/`CLAUDE_PID`/`CLAUDE_CODE_*` variable, no Claude Code ancestor. A project PreToolUse hook (`.claude/hooks/xprov-deny-allowlist-approve.sh`) and deny rules for Edit/Write on both paths stop agents earlier; they are defence in depth, the guards in `approve` are the control.

gitleaks hits and reviewer output (`secret_in_output`) are never allowlisted.

**Measured for the ancestry guard (2026-09-28, macOS, no values recorded).** Command: `ps -o comm= -p $CLAUDE_PID; lsof -a -d txt -p $CLAUDE_PID -Fn | head -1`, plus a parent-pid walk from the Bash tool. Output: start name `claude`; executable `~/.local/share/claude/versions/2.1.281` (the `claude` on PATH is a symlink `~/.local/bin/claude → …/versions/2.1.283`); the walk from the Bash tool reaches `claude` two levels up; environment names `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_*` (plus `CLAUDE_EFFORT`, which the guard does not need). Fixture fakes are derived from this: macOS kills a copy of a system shell unless it is re-signed ad hoc (exit 137), and `/bin/sh` re-execs `/bin/bash`, so the fake parent is a re-signed `bash` copy on macOS and a `sh` copy on Linux (`node:20`: `/proc/<pid>/comm` = copy name, `exe` = copy path).

**Open measurement (Robert):** the Linux form of Claude Code on the aiserver — `cat /proc/$CLAUDE_PID/comm; readlink /proc/$CLAUDE_PID/exe` — to be recorded here. **Open (Robert, steps 3–4 of Wave 6b):** the allowlist commit on `main` and `approve` on every machine that runs the gate; SC-009 measured on a later commit of `main`.
